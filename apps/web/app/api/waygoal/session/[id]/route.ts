import { NextResponse } from "next/server";
import { pathToEntry, type WaygoalSessionTreeResponse } from "@/lib/waygoal-branches";
import { readSessionTree } from "@/lib/waygoal-tree";

export const dynamic = "force-dynamic";

// GET /api/waygoal/session/[id]?entry=<entryId>
// The real branch structure of one Pi session: its branch points, each path's
// leaf, and the leaf the session would continue from. With `entry`, also says
// whether that position still exists here — a saved position that is gone must
// be reported, never resolved to some other history. Read-only: it never
// navigates the tree, so looking at a sibling path cannot move the agent.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tree = await readSessionTree(id);
  if (!tree) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const entry = new URL(req.url).searchParams.get("entry");
  const body: WaygoalSessionTreeResponse = {
    sessionId: tree.sessionId,
    activeLeafId: tree.activeLeafId,
    branchPoints: tree.branchPoints,
    ...(entry ? { entryFound: pathToEntry(tree.tree, entry).length > 0 } : {}),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
