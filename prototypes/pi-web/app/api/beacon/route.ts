import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { beaconCwd, beaconSnapshot, bindings, saveBinding } from "@/lib/beacon-store";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { allowFileRoot } from "@/lib/file-access";
import type { SessionInfo } from "@/lib/types";

export const dynamic = "force-dynamic";
const globals = globalThis as typeof globalThis & { beaconLocks?: Map<string, Promise<unknown>> };
const locks = globals.beaconLocks ??= new Map();
export async function GET(req: Request) {
  try {
    const cwd = beaconCwd(new URL(req.url).searchParams.get("cwd") || undefined);
    allowFileRoot(cwd);
    const snapshot = beaconSnapshot(cwd);
    for (const map of snapshot.maps) for (const ticket of map.tickets) {
      ticket.running = Boolean(ticket.binding && getRpcSession(ticket.binding.id)?.isRunning());
    }
    return NextResponse.json(snapshot);
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 400 }); }
}
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (typeof body.cwd !== "string" || (body.action !== "open" && body.action !== "start")) throw new Error("Invalid request");
    const cwd = beaconCwd(body.cwd);
    const snapshot = beaconSnapshot(cwd);
    const map = snapshot.maps.find(m => m.id === body.mapId);
    const ticket = map?.tickets.find(t => t.id === body.ticketId);
    const key = body.action === "start" ? "origin" : ticket?.id;
    if (!key) throw new Error("找不到这个节点");
    if (ticket?.blocked && !ticket.binding) throw new Error("先解决它依赖的问题，再开始这段对话");
    if (ticket?.status === "resolved" && !ticket.binding) throw new Error("这个节点已有结论；可以在地图中阅读原始票据");
    const lockKey = `${cwd}:${key}`;
    let pending = locks.get(lockKey);
    if (!pending) {
      pending = (async () => {
        const saved = bindings(cwd)[key];
        const live = saved && getRpcSession(saved.id);
        const file = saved ? await resolveSessionPath(saved.id) : null;
        if (file && realpathSync(SessionManager.open(file).getCwd()) !== cwd) throw new Error("会话不属于当前工作目录");
        if (live && realpathSync(live.inner.sessionManager.getCwd()) !== cwd) throw new Error("会话目录不匹配");
        const reuse = Boolean(live?.isAlive() || file);
        if (!reuse && key === "origin" && (typeof body.idea !== "string" || !body.idea.trim())) throw new Error("先写下你的想法");
        allowFileRoot(cwd);
        const { session, realSessionId } = await startRpcSession(reuse ? saved.id : `beacon-${randomUUID()}`, reuse ? file || "" : "", cwd, {
          ...(!reuse ? { initialModel: { provider: "openai-codex", modelId: "gpt-5.6-luna" }, allowInitialModelFallback: false, thinkingLevel: "low" as const } : {}),
          persistPreferences: false,
        });
        const binding = { id: realSessionId, path: session.sessionFile, started: reuse && saved?.started === true };
        const name = ticket?.title || "为这个想法找方向";
        if (!binding.started) {
          const prompt = ticket
            ? `/skill:wayfinder 继续地图「${map!.title}」（${map!.id}），本次只处理「${ticket.title}」（${ticket.id}）。先读取地图和这张票据。按配置的本地 tracker 更新原文件，完成时更新地图并将新看清的问题开成票据。HITL 问题等我回答，不能代替我做决定。research 可以调用 Agent 子代理，模型使用 openai-codex/gpt-5.6-luna。用中文交流。`
            : `/skill:wayfinder ${body.idea}\n在当前工作目录使用本地 Markdown tracker（.scratch/<effort>/map.md 和 issues/NN-*.md）。先与我澄清目的地，再按 skill 创建地图。HITL 等我回答。research 子代理模型使用 openai-codex/gpt-5.6-luna。用中文交流。`;
          saveBinding(cwd, key, binding);
          await session.send({ type: "set_session_name", name });
          await session.send({ type: "prompt", message: prompt });
          binding.started = true;
          saveBinding(cwd, key, binding);
        }
        const now = new Date().toISOString();
        const info: SessionInfo = { id: realSessionId, path: session.sessionFile, cwd, name, created: now, modified: now, messageCount: 0, firstMessage: name };
        return { session: info, running: session.isRunning(), reused: reuse };
      })();
      locks.set(lockKey, pending);
      pending.finally(() => { if (locks.get(lockKey) === pending) locks.delete(lockKey); }).catch(() => {});
    }
    return NextResponse.json(await pending);
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
