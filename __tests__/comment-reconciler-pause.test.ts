/**
 * The comment sweep leaves a paused account alone: it used to re-queue every
 * failed comment every five minutes, each one refused again by Instagram.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockAdd, mockComments, mockPaused } = vi.hoisted(() => ({
  mockPrisma: {
    automation: { findMany: vi.fn() },
    dmLog: { findMany: vi.fn() },
    operationalEvent: { create: vi.fn() },
    $queryRaw: vi.fn(),
  },
  mockAdd: vi.fn(),
  mockComments: vi.fn(),
  mockPaused: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/queue/client", () => ({ getDMQueue: () => ({ add: mockAdd }), MESSAGE_JOB_NAME: "process-message" }));
vi.mock("@/lib/instagram/messaging-pause", () => ({ messagingPaused: mockPaused }));
vi.mock("@/lib/instagram/provider", () => ({
  getRecentMediaComments: mockComments,
  getUserMedia: vi.fn(),
  createInstagramContext: vi.fn(async () => "context"),
  MetaApiError: class MetaApiError extends Error {},
}));

import { reconcileComments } from "../lib/polling/comment-reconciler";

const automation = {
  id: "auto_1",
  name: "Guide",
  postId: "media_1",
  matchAnyPost: false,
  matchAnyWord: false,
  keywords: ["GUIDE"],
  wholeWordMatch: true,
  publicReplyEnabled: false,
  workspaceId: "ws_1",
  instagramAccount: {
    id: "row_1",
    instagramId: "ig_1",
    username: "alpy",
    accessToken: "enc",
    provider: "META",
    workspaceId: "ws_1",
    zernioAccountId: null,
  },
};

describe("comment sweep and a paused account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.automation.findMany.mockResolvedValue([automation]);
    mockPrisma.dmLog.findMany.mockResolvedValue([]);
    mockPrisma.operationalEvent.create.mockResolvedValue({});
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockComments.mockResolvedValue([
      { id: "c1", text: "GUIDE", from: { id: "u1", username: "u1" }, timestamp: new Date().toISOString() },
    ]);
  });

  it("queues nothing and reads nothing while messaging is off", async () => {
    mockPaused.mockResolvedValue(true);
    await reconcileComments();
    expect(mockPaused).toHaveBeenCalledWith("ig_1");
    expect(mockComments).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
    // Said in the sweep's own log, so the dashboard shows why.
    expect(mockPrisma.operationalEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ level: "WARNING", payload: expect.objectContaining({ errors: [expect.stringMatching(/Allow access to messages/)] }) }),
      })
    );
  });

  it("answers the missed comment once messaging is back", async () => {
    mockPaused.mockResolvedValue(false);
    await reconcileComments();
    expect(mockAdd).toHaveBeenCalledWith("process-comment", expect.objectContaining({ commentId: "c1", source: "POLLING" }));
  });
});

describe("message DMs missed while messaging was off", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.automation.findMany.mockResolvedValue([]);
    mockPrisma.operationalEvent.create.mockResolvedValue({});
  });

  const row = (id: string, account = "ig_1") => ({
    commentId: `dm:${id}`,
    commentText: "GUIDE",
    commenterId: `sender_${id}`,
    instagramAccount: { id: `row_${account}`, instagramId: account },
  });

  it("re-queues only rows refused for that reason, inside the 24-hour window", async () => {
    mockPaused.mockResolvedValue(false);
    mockPrisma.dmLog.findMany.mockResolvedValue([row("m1")]);
    const { recoverMissedMessages } = await import("../lib/polling/comment-reconciler");
    await expect(recoverMissedMessages()).resolves.toBe(1);
    const where = mockPrisma.dmLog.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      status: "FAILED",
      commentId: { startsWith: "dm:" },
      errorMessage: { contains: "Allow access to messages" },
    });
    expect(Date.now() - where.createdAt.gt.getTime()).toBeLessThan(24 * 60 * 60 * 1000);
    expect(mockAdd).toHaveBeenCalledWith(
      "process-message",
      { instagramAccountId: "ig_1", accountConnectionId: "row_ig_1", messageId: "m1", messageText: "GUIDE", senderId: "sender_m1" },
      { jobId: `recover-dm-${Buffer.from("m1").toString("base64url")}` }
    );
  });

  it("answers a message once even when several campaigns logged it", async () => {
    mockPaused.mockResolvedValue(false);
    mockPrisma.dmLog.findMany.mockResolvedValue([row("m1"), row("m1")]);
    const { recoverMissedMessages } = await import("../lib/polling/comment-reconciler");
    await expect(recoverMissedMessages()).resolves.toBe(1);
  });

  it("waits while the account is still paused", async () => {
    mockPaused.mockResolvedValue(true);
    mockPrisma.dmLog.findMany.mockResolvedValue([row("m1")]);
    const { recoverMissedMessages } = await import("../lib/polling/comment-reconciler");
    await expect(recoverMissedMessages()).resolves.toBe(0);
    expect(mockAdd).not.toHaveBeenCalled();
  });
});
