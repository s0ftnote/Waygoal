import { NextResponse } from "next/server";
import { createAgentSessionFromServices, createAgentSessionServices, getAgentDir, SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { readTurns } from "@/lib/waygoal/turn-reader";
import { generateTakeaway } from "@/lib/waygoal/generate-takeaway";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { projectTrustReloadOptions } from "@/lib/project-trust";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let temporary: AgentSession | undefined;
  try {
    const { id } = await params;
    const { turnId } = await req.json();
    if (typeof turnId !== "string") return NextResponse.json({ error: "请选择一轮讨论。" }, { status: 400 });
    const turn = (await readTurns(id))?.turns.find(item => item.id === turnId);
    if (!turn) return NextResponse.json({ error: "这轮讨论已不可读取。" }, { status: 404 });
    if (!turn.answer.trim()) return NextResponse.json({ error: "这轮还没有回答，可以先自己记下问题。" }, { status: 409 });
    const file = await resolveSessionPath(id);
    const existing = getRpcSession(id);
    if (!existing?.isAlive() && !file) return NextResponse.json({ error: "会话已不可读取。" }, { status: 404 });
    let source: AgentSession;
    if (existing?.isAlive()) {
      await existing.waitUntilReady?.();
      source = existing.inner as unknown as AgentSession;
    } else {
      // Resuming a disk session may append model/thinking metadata. Restore an
      // in-memory copy instead so annotating an old turn never writes Pi history.
      const saved = SessionManager.open(file!);
      const cwd = saved.getCwd(), agentDir = getAgentDir();
      const services = await createAgentSessionServices({ cwd, agentDir,
        resourceLoaderReloadOptions: projectTrustReloadOptions(cwd, agentDir),
      });
      const sessionManager = SessionManager.inMemory(cwd, undefined, [saved.getHeader()!, ...saved.getEntries()]);
      temporary = (await createAgentSessionFromServices({ services, sessionManager, tools: [] })).session;
      source = temporary;
    }
    const text = await generateTakeaway(source.agent, turn.question, turn.answer, req.signal);
    return NextResponse.json({ text, status: "draft", fingerprint: turn.fingerprint }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally { temporary?.dispose(); }
}
