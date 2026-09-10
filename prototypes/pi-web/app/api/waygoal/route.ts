import { NextResponse } from "next/server";
import { allowFileRoot } from "@/lib/file-access";
import { getRpcSessionInfos, getRunningRpcSessionIds } from "@/lib/rpc-manager";
import { attachSessionProjectInfo, listAllSessions, mergeSessionLists } from "@/lib/session-reader";
import { applyCanvasPatch, buildSnapshot, resolveWorkspaceCwd, workspaceSessions } from "@/lib/waygoal-store";
import { readTreeInfos } from "@/lib/waygoal-tree";
import type { WaygoalCanvasPatch } from "@/lib/waygoal-types";

export const dynamic = "force-dynamic";

// GET /api/waygoal?cwd=<dir>&force=1
// Reads existing Pi sessions for one workspace and the local canvas record.
// It never touches Pi: no sessions created, no prompts sent. The only write is
// the canvas record itself, when a newly discovered session needs a position.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const cwd = resolveWorkspaceCwd(url.searchParams.get("cwd"));
    allowFileRoot(cwd);
    const [persisted, runtime] = await Promise.all([
      listAllSessions({ force: url.searchParams.get("force") === "1" }),
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    const sessions = mergeSessionLists(persisted, runtime);
    // Branch points and the active leaf come from each real session file; the
    // canvas record never stores them.
    const trees = await readTreeInfos(workspaceSessions(cwd, sessions).map(session => session.id));
    const snapshot = buildSnapshot(cwd, sessions, getRunningRpcSessionIds(), undefined, trees);
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

// PATCH /api/waygoal  body: { cwd, positions?, view?, lastViewed?, lastViewedEntry?, origin? }
// Stores layout, the last viewed position and where a fork came from.
// Restoring later reads only.
export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown } & WaygoalCanvasPatch;
    if (typeof body.cwd !== "string" || !body.cwd) throw new Error("cwd is required");
    const cwd = resolveWorkspaceCwd(body.cwd);
    const record = applyCanvasPatch(cwd, {
      positions: body.positions, view: body.view,
      lastViewed: body.lastViewed, lastViewedEntry: body.lastViewedEntry, origin: body.origin,
    });
    return NextResponse.json({ ok: true, updatedAt: record.updatedAt });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
