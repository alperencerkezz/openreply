/**
 * Emails when sending breaks, the repeat-DM cap, and the worker-down check.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, mockRedis, mockPrisma, mockFetch, mockHealth } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    mockRedis: {
      incr: vi.fn(async (key: string) => {
        const n = Number(store.get(key) ?? 0) + 1;
        store.set(key, String(n));
        return n;
      }),
      expire: vi.fn(async () => 1),
      set: vi.fn(async (key: string, value: string, ..._args: unknown[]) => {
        if (store.has(key)) return null;
        store.set(key, value);
        return "OK";
      }),
    },
    mockPrisma: { workspaceMember: { findMany: vi.fn() } },
    mockFetch: vi.fn(),
    mockHealth: vi.fn(),
  };
});

vi.mock("@/lib/queue/client", () => ({ getRedisConnection: () => mockRedis }));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/ops/worker-health", () => ({ getWorkerHealth: mockHealth }));
vi.stubGlobal("fetch", mockFetch);

import { sendOwnerAlert } from "../lib/ops/alerts";
import { guardSend, SEND_CAPS, SendCapError } from "../lib/ops/send-guard";
import { GET as checkWorker } from "../app/api/cron/check-worker/route";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Alpy <hello@tryalpy.com>";
  delete process.env.ALERT_EMAIL;
  mockPrisma.workspaceMember.findMany.mockResolvedValue([{ user: { email: "owner@example.com" } }]);
  mockFetch.mockResolvedValue({ ok: true, text: async () => "" });
});

describe("owner alerts", () => {
  it("emails the workspace owners through Resend", async () => {
    await expect(sendOwnerAlert({ key: "k1", workspaceId: "ws", subject: "DMs stopped", text: "body" })).resolves.toBe(true);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(init.body)).toMatchObject({ to: ["owner@example.com"], subject: "OpenReply: DMs stopped", text: "body" });
    expect(mockPrisma.workspaceMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "OWNER", workspaceId: "ws" } })
    );
  });

  it("sends one email per problem, however often it happens", async () => {
    await sendOwnerAlert({ key: "same", subject: "s", text: "t" });
    await expect(sendOwnerAlert({ key: "same", subject: "s", text: "t" })).resolves.toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("ALERT_EMAIL overrides the recipients", async () => {
    process.env.ALERT_EMAIL = "a@x.com, b@x.com";
    await sendOwnerAlert({ key: "k2", subject: "s", text: "t" });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).to).toEqual(["a@x.com", "b@x.com"]);
    expect(mockPrisma.workspaceMember.findMany).not.toHaveBeenCalled();
  });

  it("never throws when the email cannot be sent", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => "down" });
    await expect(sendOwnerAlert({ key: "k3", subject: "s", text: "t" })).resolves.toBe(false);
  });
});

describe("repeat-DM cap", () => {
  it("lets honest retries through and stops a loop, with one email", async () => {
    for (let i = 0; i < SEND_CAPS.comment; i++) await guardSend("comment", "ig_1", "c1");
    await expect(guardSend("comment", "ig_1", "c1")).rejects.toBeInstanceOf(SendCapError);
    await expect(guardSend("comment", "ig_1", "c1")).rejects.toThrow(/repeat-DM safety cap/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).subject).toBe("OpenReply: a DM loop was stopped");
    // Other recipients are untouched.
    await expect(guardSend("comment", "ig_1", "c2")).resolves.toBeUndefined();
  });

  it("counts for a day, then starts again", async () => {
    await guardSend("person", "ig_1", "u1");
    expect(mockRedis.expire).toHaveBeenCalledWith("openreply:sends:person:ig_1:u1", 24 * 60 * 60);
  });

  it("sends as before when Redis cannot be reached", async () => {
    mockRedis.incr.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(guardSend("comment", "ig_1", "c9")).resolves.toBeUndefined();
  });
});

describe("worker-down check", () => {
  const request = (secret: string) =>
    ({ headers: new Headers({ authorization: `Bearer ${secret}` }) }) as unknown as Parameters<typeof checkWorker>[0];

  beforeEach(() => {
    process.env.CRON_SECRET = "cron";
  });

  it("emails when the worker has stopped", async () => {
    mockHealth.mockResolvedValue({ healthy: false, heartbeat: null, ageMs: null });
    const response = await checkWorker(request("cron"));
    expect((await response.json()).data).toMatchObject({ healthy: false, alerted: true });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).subject).toBe("OpenReply: the DM worker is not running");
  });

  it("says nothing while it runs", async () => {
    mockHealth.mockResolvedValue({ healthy: true, heartbeat: {}, ageMs: 5000 });
    await checkWorker(request("cron"));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a caller without the cron secret", async () => {
    const response = await checkWorker(request("wrong"));
    expect(response.status).toBe(401);
  });
});
