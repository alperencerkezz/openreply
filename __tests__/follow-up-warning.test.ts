/**
 * A follow-up can only follow a tap: Instagram allows one private reply to a
 * comment and no second DM until the person taps a button or writes back. The
 * campaign builder let it be switched on for campaigns with nothing to tap.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const builder = readFileSync("components/campaign-builder.tsx", "utf8");
const worker = readFileSync("lib/queue/dm-worker.ts", "utf8");

describe("follow-up needs a tap", () => {
  it("is only ever scheduled after a tap or an inbound message, never from a comment reply", () => {
    const body = (name: string) => {
      const at = worker.indexOf(`async function ${name}(`);
      const next = worker.indexOf("\nasync function ", at + 1);
      return worker.slice(at, next === -1 ? undefined : next);
    };
    expect(body("processComment")).not.toContain("FOLLOWUP_JOB_NAME");
    expect(body("processPostback")).toContain("FOLLOWUP_JOB_NAME");
    expect(body("processMessage")).toContain("FOLLOWUP_JOB_NAME");
  });

  it("warns, in the builder, when there is nothing to tap", () => {
    expect(builder).toMatch(/\{!openingDmEnabled && !requireFollow && \(\s*<p role="alert"/);
    expect(builder).toMatch(/This follow-up will not be sent\./);
    expect(builder).toMatch(/Turn on the opening DM above, or the follow gate/);
  });
});
