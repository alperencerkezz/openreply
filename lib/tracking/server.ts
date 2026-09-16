import { createHash, randomBytes } from "node:crypto";

export function generateTrackedLinkSlug() {
  return randomBytes(7).toString("base64url");
}

export function hashClickIp(ipAddress: string | null | undefined) {
  if (!ipAddress) return null;

  const salt = process.env.NEXTAUTH_SECRET ?? "campaigncue-click-salt";
  return createHash("sha256").update(`${salt}:${ipAddress}`).digest("hex");
}

export function getRequestIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? null;
  }

  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    null
  );
}

export function slugifyUtmValue(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "campaign"
  );
}

/**
 * Appends campaign attribution params to a tracked link's destination so
 * click-through analytics on the receiving side (e.g. Alpy) can attribute
 * signups back to the originating automation. Existing query params on the
 * destination are preserved; utm_* params are overwritten to keep them
 * consistent with the automation that owns the link.
 */
export function appendCampaignUtmParams(
  destinationUrl: string,
  params: { campaign: string; content?: string | null }
): string {
  let url: URL;
  try {
    url = new URL(destinationUrl);
  } catch {
    return destinationUrl;
  }

  url.searchParams.set("utm_source", "instagram");
  url.searchParams.set("utm_medium", "dm");
  url.searchParams.set("utm_campaign", slugifyUtmValue(params.campaign));
  if (params.content) {
    url.searchParams.set("utm_content", slugifyUtmValue(params.content));
  }

  return url.toString();
}
