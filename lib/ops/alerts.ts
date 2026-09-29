/**
 * Email the workspace owner when sending breaks.
 *
 * Problems used to reach only the dashboard, which nobody watches: on
 * 2026-09-28/29 every DM was refused for eleven hours before anyone noticed,
 * and three commenters were sent the same DM over and over for a day until
 * one of them complained. Each of those is one email now.
 *
 * Every alert has a key and is sent at most once per its quiet period, so a
 * problem that lasts all day is one email, not hundreds. Sent through Resend
 * when RESEND_API_KEY is set (as sign-in links are), else SMTP (EMAIL_SERVER).
 * ALERT_EMAIL overrides the recipients; otherwise every OWNER of the
 * workspace, or of every workspace for an alert that belongs to none.
 */
import nodemailer from "nodemailer";
import { prisma } from "@/lib/db/client";
import { getRedisConnection } from "@/lib/queue/client";

export interface OwnerAlert {
  /** Identifies the problem: one email per key per quiet period. */
  key: string;
  workspaceId?: string | null;
  subject: string;
  text: string;
  /** Seconds before the same key may email again. */
  quietSeconds?: number;
}

const DEFAULT_QUIET_SECONDS = 6 * 60 * 60;

async function recipients(workspaceId?: string | null): Promise<string[]> {
  const override = (process.env.ALERT_EMAIL ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  if (override.length) return override;
  const owners = await prisma.workspaceMember.findMany({
    where: { role: "OWNER", ...(workspaceId ? { workspaceId } : {}) },
    select: { user: { select: { email: true } } },
  });
  return [...new Set(owners.map((o) => o.user.email).filter((e): e is string => Boolean(e)))];
}

async function deliver(to: string[], subject: string, text: string): Promise<boolean> {
  const from = process.env.EMAIL_FROM ?? "OpenReply <login@example.com>";
  if (process.env.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!response.ok) throw new Error(`Resend ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return true;
  }
  if (process.env.EMAIL_SERVER) {
    await nodemailer.createTransport(process.env.EMAIL_SERVER).sendMail({ from, to, subject, text });
    return true;
  }
  return false;
}

/**
 * Send one alert, unless the same key was sent within its quiet period.
 * Never throws: an alert that cannot be sent must not break the send path
 * that raised it. Returns whether an email went out.
 */
export async function sendOwnerAlert(alert: OwnerAlert): Promise<boolean> {
  try {
    const claimed = await getRedisConnection().set(
      `openreply:alert-sent:${alert.key}`,
      new Date().toISOString(),
      "EX",
      alert.quietSeconds ?? DEFAULT_QUIET_SECONDS,
      "NX"
    );
    if (claimed !== "OK") return false;
    const to = await recipients(alert.workspaceId);
    if (!to.length) {
      console.warn(`[Alert] No one to send "${alert.subject}" to: set ALERT_EMAIL.`);
      return false;
    }
    const sent = await deliver(to, `OpenReply: ${alert.subject}`, alert.text);
    if (sent) console.log(`[Alert] Sent "${alert.subject}" to ${to.length} recipient(s)`);
    else console.warn(`[Alert] "${alert.subject}" not sent: no RESEND_API_KEY or EMAIL_SERVER`);
    return sent;
  } catch (error) {
    console.error("[Alert] Could not send:", error instanceof Error ? error.message : error);
    return false;
  }
}
