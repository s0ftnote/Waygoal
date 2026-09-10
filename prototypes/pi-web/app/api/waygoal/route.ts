import { NextResponse } from "next/server";
import { allowFileRoot } from "@/lib/file-access";
import { getRpcSessionInfos, getRunningRpcSessionIds } from "@/lib/rpc-manager";
import { attachSessionProjectInfo, listAllSessions, mergeSessionLists } from "@/lib/session-reader";
import { applyCanvasPatch, buildSnapshot, buildTicketSnapshot, resolveWorkspaceCwd, workspaceSessions } from "@/lib/waygoal-store";
import { readTreeInfos } from "@/lib/waygoal-tree";
import type { WaygoalCanvasPatch, WaygoalSnapshotResponse } from "@/lib/waygoal-types";

export const dynamic = "force-dynamic";

// GET /api/waygoal?cwd=<dir>&force=1
// Reads existing Pi sessions for one workspace, the local canvas record, and
// the workspace's own local Markdown tracker files. It never touches Pi: no
// sessions created, no prompts sent. The only write is the canvas record
// itself, when a newly discovered session or ticket needs a position.
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
    // Tickets come straight from the workspace's files on every read, so a file
    // created or edited outside Waygoal shows up on the next refresh.
    const response: WaygoalSnapshotResponse = { ...snapshot, tickets: buildTicketSnapshot(cwd, snapshot.nodes) };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

// PATCH /api/waygoal
// body: { cwd, positions?, view?, lastViewed?, lastViewedEntry?, origin?,
//         ticketSession?, ticketExpanded?, ticketLast? }
// Stores layout, the last viewed position, where a fork came from, and which
// ticket a discussion is held under. Restoring later reads only.
export async function PATCH(req: Request) {
  try {
    const { cwd: given, ...patch } = await req.json() as { cwd?: unknown } & WaygoalCanvasPatch;
    if (typeof given !== "string" || !given) throw new Error("cwd is required");
    // The patch goes on whole: applyCanvasPatch checks every field it accepts
    // and ignores the rest, so re-listing the fields here would only be a
    // second place to forget when one is added.
    const record = applyCanvasPatch(resolveWorkspaceCwd(given), patch);
    return NextResponse.json({ ok: true, updatedAt: record.updatedAt });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
