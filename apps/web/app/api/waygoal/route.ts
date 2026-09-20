import { migrateLegacyOrigins } from "@/lib/waygoal/lineage-migration";
import { recoverForkOperations } from "@/lib/waygoal/fork-service";
import { NextResponse } from "next/server";
import { allowFileRoot } from "@/lib/file-access";
import { getRpcSessionInfos, getRunningRpcSessionIds } from "@/lib/rpc-manager";
import { attachSessionProjectInfo, listAllSessions, mergeSessionLists } from "@/lib/session-reader";
import { applyCanvasPatch, buildSnapshot, buildTicketSnapshot, canvasSessions, workspaceSessions, resolveWorkspaceCwd } from "@/lib/waygoal/store";
import { readTreeInfos } from "@/lib/waygoal/tree";
import { addCanvas, readWorkspaceRecord, recentWorkspaces, registerSession, rememberWorkspace, resolveScope, scopeFor } from "@/lib/waygoal/workspaces";
import type { WaygoalCanvasPatch, WaygoalSnapshotResponse } from "@/lib/waygoal/types";

export const dynamic = "force-dynamic";

// GET /api/waygoal?cwd=<dir>&canvas=<id>&force=1
// Reads existing Pi sessions for one workspace, the local canvas record, and
// the workspace's own local Markdown tracker files. It never touches Pi: no
// sessions created, no prompts sent. What it writes is only Waygoal's own
// records: the canvas record when a newly discovered session or ticket needs a
// position, and the workspace record — which directory was opened, which
// canvas it is stopped on, and which canvas a session nobody placed is on.
export async function GET(req: Request) {
  try {
    recoverForkOperations();
    const url = new URL(req.url);
    const cwd = resolveWorkspaceCwd(url.searchParams.get("cwd"));
    allowFileRoot(cwd);
    // Opening a directory is what makes it the one to come back to.
    rememberWorkspace(cwd);
    const scope = scopeFor(cwd, url.searchParams.get("canvas"));
    const [persisted, runtime] = await Promise.all([
      listAllSessions({ force: url.searchParams.get("force") === "1" }),
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    const sessions = mergeSessionLists(persisted, runtime);
    const migration = migrateLegacyOrigins(sessions, true);
    // Branch points and the active leaf come from each real session file; the
    // canvas record never stores them.
    const trees = await readTreeInfos(canvasSessions(scope, sessions).map(session => session.id));
    const snapshot = buildSnapshot(scope, sessions, getRunningRpcSessionIds(), trees, migration);
    // Tickets come straight from the workspace's files on every read, so a file
    // created or edited outside Waygoal shows up on the next refresh.
    const workspace = readWorkspaceRecord(cwd);
    const response: WaygoalSnapshotResponse = {
      ...snapshot,
      tickets: buildTicketSnapshot(scope, snapshot.nodes),
      workspace: { cwd, canvasId: scope.canvasId, canvases: workspace.canvases, recent: recentWorkspaces(), sessions: workspaceSessions(cwd, sessions).map(session => ({ id: session.id, title: session.name || session.firstMessage || "未命名会话", canvasId: workspace.sessionCanvas[session.id] ?? workspace.canvases[0].id })) },
    };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

// PATCH /api/waygoal
// body: { cwd, canvas?, registerSession?, positions?, view?, lastViewed?,
//         lastViewedEntry?, origin?, ticketSession?, ticketExpanded?,
//         ticketLast?, addGroup?, groupCollapsed?, removeGroup?, addLink?,
//         removeLink?, mapCheck? }
// Stores layout, the last viewed position, where a fork came from, and which
// ticket a discussion is held under. Restoring later reads only.
export async function PATCH(req: Request) {
  try {
    const { cwd: given, canvas, registerSession: started, ...patch } = await req.json() as { cwd?: unknown; canvas?: unknown; registerSession?: unknown } & WaygoalCanvasPatch;
    if (typeof given !== "string" || !given) throw new Error("cwd is required");
    const cwd = resolveWorkspaceCwd(given);
    allowFileRoot(cwd);
    // A delayed write belongs to its canvas, but does not open it again.
    const scope = resolveScope(cwd, typeof canvas === "string" ? canvas : null);
    // Which canvas a session is on is the workspace's record, not the
    // canvas's: a session started from a canvas belongs to that canvas and no
    // other, and must not end up on two of them.
    if (typeof started === "string" && started) {
      const [persisted, runtime] = await Promise.all([listAllSessions({ force: true }), attachSessionProjectInfo(getRpcSessionInfos())]);
      if (!workspaceSessions(cwd, mergeSessionLists(persisted, runtime)).some(session => session.id === started)) throw new Error("这段会话不在当前工作目录里。");
      registerSession(scope, started);
    }
    // The rest of the patch goes on whole: applyCanvasPatch checks every field
    // it accepts and ignores the rest, so re-listing the fields here would
    // only be a second place to forget when one is added.
    const record = applyCanvasPatch(scope, patch);
    return NextResponse.json({ ok: true, updatedAt: record.updatedAt });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

// POST /api/waygoal
// body: { cwd, name }
// Adds another canvas to this working directory. It is not switched to, and
// nothing is copied onto it: a new canvas starts empty.
export async function POST(req: Request) {
  try {
    const { cwd: given, name } = await req.json() as { cwd?: unknown; name?: unknown };
    if (typeof given !== "string" || !given) throw new Error("cwd is required");
    const cwd = resolveWorkspaceCwd(given);
    allowFileRoot(cwd);
    return NextResponse.json({ ok: true, canvas: addCanvas(cwd, typeof name === "string" ? name : "") });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
