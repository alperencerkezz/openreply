/**
 * An Instagram account whose messaging is switched off, and what to do about it.
 *
 * When the account's "Allow access to messages" setting (Connected tools) is
 * off, Meta refuses every send with "The account owner has disabled access to
 * Instagram Direct Messaging". Nothing on this side can fix that, and every
 * retry was another refused call: each job three attempts, each attempt a
 * button send and then a plain-text fallback, and the comment sweep re-queued
 * every failed comment every five minutes -- 340 refused calls an hour on
 * 2026-09-29, against an account Instagram had just restricted.
 *
 * So the first refusal pauses that account for a while: queued jobs fail at
 * once without calling Meta, and the sweep leaves it alone. When the pause runs
 * out, one send finds out whether messaging is back. When it is, the sweep
 * answers everything from the last 72 hours that never got its DM, because a
 * failed comment is never marked as handled.
 */
import { getRedisConnection } from "@/lib/queue/client";

export const MESSAGING_PAUSE_SECONDS = 15 * 60;

const DISABLED = /disabled access to Instagram Direct Messaging/i;

export const MESSAGING_DISABLED_HELP =
  'Instagram refused this DM because "Allow access to messages" is turned off for this account. ' +
  "Turn it on in the Instagram app: Settings → Messages and story replies → Message controls → Connected tools → Allow access to messages. " +
  "Replies resume by themselves within 15 minutes, and comments from the last 72 hours that were missed are answered then.";

/** Whether this error is Instagram saying the account's messaging is off. */
export function isMessagingDisabled(error: unknown): boolean {
  return error instanceof Error && DISABLED.test(error.message);
}

const key = (instagramId: string) => `openreply:messaging-disabled:${instagramId}`;

/** Stop sending for this account until the pause runs out. Never throws. */
export async function pauseMessaging(instagramId: string): Promise<void> {
  try {
    await getRedisConnection().set(key(instagramId), new Date().toISOString(), "EX", MESSAGING_PAUSE_SECONDS);
  } catch (error) {
    console.error("[Messaging pause] Could not record the pause:", error instanceof Error ? error.message : error);
  }
}

/**
 * Whether sends for this account are paused. An unreachable Redis reads as not
 * paused: sending as before is better than refusing everything.
 */
export async function messagingPaused(instagramId: string): Promise<boolean> {
  try {
    return (await getRedisConnection().exists(key(instagramId))) === 1;
  } catch {
    return false;
  }
}
