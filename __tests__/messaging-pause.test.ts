/**
 * An account whose Instagram messaging is switched off is paused, not hammered.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, mockRedis } = vi.hoisted(() => {
  const store = new Map<string, { value: string; ttl: number }>();
  return {
    store,
    mockRedis: {
      set: vi.fn(async (key: string, value: string, _ex: string, ttl: number) => {
        store.set(key, { value, ttl });
        return "OK";
      }),
      exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    },
  };
});

vi.mock("@/lib/queue/client", () => ({ getRedisConnection: () => mockRedis }));

import {
  isMessagingDisabled,
  messagingPaused,
  pauseMessaging,
  MESSAGING_PAUSE_SECONDS,
  MESSAGING_DISABLED_HELP,
} from "../lib/instagram/messaging-pause";

describe("messaging pause", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("recognises Instagram's refusal, and nothing else", () => {
    expect(
      isMessagingDisabled(
        new Error(
          "The account owner has disabled access to Instagram Direct Messaging. (/v25.0/1/messages) [code=200 sub=- type=IGApiException trace=x]"
        )
      )
    ).toBe(true);
    expect(isMessagingDisabled(new Error("This message is sent outside of allowed window."))).toBe(false);
    expect(isMessagingDisabled("disabled access to Instagram Direct Messaging")).toBe(false);
    expect(isMessagingDisabled(null)).toBe(false);
  });

  it("pauses one account, for a limited time", async () => {
    await pauseMessaging("ig_1");
    await expect(messagingPaused("ig_1")).resolves.toBe(true);
    await expect(messagingPaused("ig_2")).resolves.toBe(false);
    expect(mockRedis.set).toHaveBeenCalledWith(
      "openreply:messaging-disabled:ig_1",
      expect.any(String),
      "EX",
      MESSAGING_PAUSE_SECONDS
    );
  });

  it("sends as before when Redis cannot be reached, rather than refusing everything", async () => {
    mockRedis.exists.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(messagingPaused("ig_1")).resolves.toBe(false);
    mockRedis.set.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(pauseMessaging("ig_1")).resolves.toBeUndefined();
  });

  it("tells the owner exactly which setting to change", () => {
    expect(MESSAGING_DISABLED_HELP).toMatch(/Connected tools → Allow access to messages/);
  });
});
