import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockGetCurrentWorkspaceContext, mockCanManageWorkspace } =
  vi.hoisted(() => ({
    mockPrisma: {
      workspace: {
        update: vi.fn(),
      },
    },
    mockGetCurrentWorkspaceContext: vi.fn(),
    mockCanManageWorkspace: vi.fn(),
  }));

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mockGetCurrentWorkspaceContext,
  canManageWorkspace: mockCanManageWorkspace,
}));

import { GET, PATCH } from "../app/api/workspace/pause/route";

beforeEach(() => {
  vi.clearAllMocks();
});

function patchRequest(body: unknown) {
  return new Request("https://openreply.example.com/api/workspace/pause", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as Parameters<typeof PATCH>[0];
}

describe("PATCH /api/workspace/pause", () => {
  it("rejects unauthenticated requests", async () => {
    mockGetCurrentWorkspaceContext.mockResolvedValue(null);

    const response = await PATCH(patchRequest({ paused: true }));

    expect(response.status).toBe(401);
    expect(mockPrisma.workspace.update).not.toHaveBeenCalled();
  });

  it("rejects members who cannot manage the workspace", async () => {
    mockGetCurrentWorkspaceContext.mockResolvedValue({
      workspaceId: "workspace_123",
      role: "MEMBER",
      workspace: { pausedAt: null },
    });
    mockCanManageWorkspace.mockReturnValue(false);

    const response = await PATCH(patchRequest({ paused: true }));

    expect(response.status).toBe(403);
    expect(mockPrisma.workspace.update).not.toHaveBeenCalled();
  });

  it("pauses the workspace for an admin, setting pausedAt", async () => {
    mockGetCurrentWorkspaceContext.mockResolvedValue({
      workspaceId: "workspace_123",
      role: "ADMIN",
      workspace: { pausedAt: null },
    });
    mockCanManageWorkspace.mockReturnValue(true);
    mockPrisma.workspace.update.mockResolvedValue({
      pausedAt: new Date("2026-09-16T00:00:00.000Z"),
    });

    const response = await PATCH(patchRequest({ paused: true }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.pausedAt).toBe("2026-09-16T00:00:00.000Z");
    expect(mockPrisma.workspace.update).toHaveBeenCalledWith({
      where: { id: "workspace_123" },
      data: { pausedAt: expect.any(Date) },
      select: { pausedAt: true },
    });
  });

  it("resumes the workspace by clearing pausedAt", async () => {
    mockGetCurrentWorkspaceContext.mockResolvedValue({
      workspaceId: "workspace_123",
      role: "OWNER",
      workspace: { pausedAt: new Date() },
    });
    mockCanManageWorkspace.mockReturnValue(true);
    mockPrisma.workspace.update.mockResolvedValue({ pausedAt: null });

    const response = await PATCH(patchRequest({ paused: false }));
    const payload = await response.json();

    expect(payload.pausedAt).toBeNull();
    expect(mockPrisma.workspace.update).toHaveBeenCalledWith({
      where: { id: "workspace_123" },
      data: { pausedAt: null },
      select: { pausedAt: true },
    });
  });

  it("rejects invalid input", async () => {
    mockGetCurrentWorkspaceContext.mockResolvedValue({
      workspaceId: "workspace_123",
      role: "OWNER",
      workspace: { pausedAt: null },
    });
    mockCanManageWorkspace.mockReturnValue(true);

    const response = await PATCH(patchRequest({ paused: "yes" }));

    expect(response.status).toBe(400);
    expect(mockPrisma.workspace.update).not.toHaveBeenCalled();
  });
});

describe("GET /api/workspace/pause", () => {
  it("returns the workspace's current paused state", async () => {
    const pausedAt = new Date("2026-09-16T00:00:00.000Z");
    mockGetCurrentWorkspaceContext.mockResolvedValue({
      workspaceId: "workspace_123",
      role: "MEMBER",
      workspace: { pausedAt },
    });

    const response = await GET();
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.pausedAt).toBe(pausedAt.toISOString());
  });

  it("rejects unauthenticated requests", async () => {
    mockGetCurrentWorkspaceContext.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });
});
