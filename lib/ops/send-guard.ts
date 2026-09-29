/**
 * A hard cap on how often one recipient can be messaged in a day.
 *
 * Nothing stopped a loop: from 2026-09-27 three commenters were sent the same
 * DM over and over for more than a day, because each "failure" was retried
 * and re-queued although the DM had been delivered. That cause is fixed; this
 * is the backstop for the next one. Every send attempt to a recipient is
 * counted for 24 hours, and past the cap the send is refused before Meta is
 * called, with one email to the owner.
 *
 * Attempts, not deliveries, are counted, and the caps leave room for honest
 * retries: a comment job may try three times, each as a button and then as
 * text (6); a person may be sent the reveal, a follow-up and several follow
 * prompts (10). A loop passes either within an hour.
 */
import { getRedisConnection } from "@/lib/queue/client";
import { sendOwnerAlert } from "@/lib/ops/alerts";

export const SEND_CAPS = {
  /** Private replies to one comment. */
  comment: 6,
  /** Direct messages to one person from one account. */
  person: 10,
  /** Public replies under one comment. */
  publicReply: 3,
} as const;
export type SendTarget = keyof typeof SEND_CAPS;

const DAY_SECONDS = 24 * 60 * 60;
const REDIS_TIMEOUT_MS = 1000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export class SendCapError extends Error {
  constructor(target: SendTarget, cap: number) {
    super(
      `Blocked by the repeat-DM safety cap: this ${target === "person" ? "person" : "comment"} was already messaged ${cap} times in 24 hours.`
    );
    this.name = "SendCapError";
  }
}

/**
 * Count one send attempt, and refuse it past the cap. An unreachable Redis
 * lets the send through: sending as before beats sending nothing.
 */
export async function guardSend(target: SendTarget, instagramAccountId: string, recipient: string): Promise<void> {
  const key = `openreply:sends:${target}:${instagramAccountId}:${recipient}`;
  let count: number;
  try {
    // Bounded: the queue's Redis client waits for a connection indefinitely,
    // and a send must never hang on the counter meant to protect it.
    count = await withTimeout(
      (async () => {
        const redis = getRedisConnection();
        const n = await redis.incr(key);
        if (n === 1) await redis.expire(key, DAY_SECONDS);
        return n;
      })(),
      REDIS_TIMEOUT_MS
    );
  } catch {
    return;
  }
  const cap = SEND_CAPS[target];
  if (count <= cap) return;
  await sendOwnerAlert({
    key: `send-cap:${target}:${instagramAccountId}:${recipient}`,
    subject: "a DM loop was stopped",
    text:
      `OpenReply blocked a message because it would have been attempt ${count} to the same ${target === "person" ? "person" : "comment"} ` +
      `within 24 hours (the limit is ${cap}). That almost always means something is sending the same DM over and over.\n\n` +
      `Instagram account: ${instagramAccountId}\n${target === "person" ? "Recipient" : "Comment"}: ${recipient}\n\n` +
      `Nothing more is sent to them for the rest of the 24 hours. Check the DM logs in the dashboard for this recipient.`,
  });
  throw new SendCapError(target, cap);
}
