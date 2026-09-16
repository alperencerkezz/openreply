import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

const pauseSchema = z.object({
  paused: z.boolean(),
});

// Workspace-wide emergency stop: pausing here overrides every automation's
// own isActive flag in the worker (lib/queue/dm-worker.ts), so it stops all
// connected Instagram accounts in one action without touching per-campaign
// settings.
export async function PATCH(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can pause the workspace" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = pauseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const workspace = await prisma.workspace.update({
    where: { id: context.workspaceId },
    data: { pausedAt: parsed.data.paused ? new Date() : null },
    select: { pausedAt: true },
  });

  return NextResponse.json({ success: true, pausedAt: workspace.pausedAt });
}

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  return NextResponse.json({ success: true, pausedAt: context.workspace.pausedAt });
}
