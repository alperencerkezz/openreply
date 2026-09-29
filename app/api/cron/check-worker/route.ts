import { NextRequest, NextResponse } from "next/server";
import { getWorkerHealth } from "@/lib/ops/worker-health";
import { sendOwnerAlert } from "@/lib/ops/alerts";

/**
 * Email the owner when the DM worker has stopped.
 *
 * The worker is what sends every DM, and when it is down nothing says so:
 * comments keep arriving, jobs queue up, and the dashboard looks fine. It
 * writes a heartbeat every 30 seconds that expires after two minutes, so a
 * missing heartbeat means no worker. Checked by scripts/cron.sh every five
 * minutes; one email per hour while it stays down.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const health = await getWorkerHealth();
  let alerted = false;
  if (!health.healthy) {
    alerted = await sendOwnerAlert({
      key: "worker-down",
      quietSeconds: 60 * 60,
      subject: "the DM worker is not running",
      text:
        `OpenReply's DM worker has not reported in ${health.ageMs === null ? "for over two minutes" : `for ${Math.round(health.ageMs / 60000)} minutes`}. ` +
        `No DMs are being sent until it is running again.\n\n` +
        `On the server: cd /opt/openreply && docker compose -f docker-compose.prod.yml up -d worker`,
    });
  }
  return NextResponse.json({ success: true, data: { healthy: health.healthy, ageMs: health.ageMs, alerted } });
}
