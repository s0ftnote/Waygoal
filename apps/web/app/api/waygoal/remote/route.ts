import { NextResponse } from "next/server";
import { allowFileRoot } from "@/lib/file-access";
import { retryRemoteCapture } from "@/lib/waygoal/remote-store";
import { resolveWorkspaceCwd } from "@/lib/waygoal/store";
import { scopeFor } from "@/lib/waygoal/workspaces";

export const dynamic = "force-dynamic";

// POST /api/waygoal/remote
// body: { cwd, ticket }
// Reads again the raw result one delivery pointed at, for a ticket whose
// reference could not be read when it was delivered. It talks to no platform
// and needs no login of its own: the Agent already produced the result, and
// this only takes another look at where it left it. Nothing is ever written
// to the source.
export async function POST(req: Request) {
  try {
    const { cwd: given, ticket } = await req.json() as { cwd?: unknown; ticket?: unknown };
    if (typeof given !== "string" || !given) throw new Error("cwd is required");
    if (typeof ticket !== "string" || !ticket) throw new Error("ticket is required");
    const cwd = resolveWorkspaceCwd(given);
    allowFileRoot(cwd);
    return NextResponse.json({ ok: true, ...retryRemoteCapture(scopeFor(cwd, null), ticket) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
