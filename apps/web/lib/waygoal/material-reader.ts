import { SessionManager, buildContextEntries } from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "../rpc-manager";
import { resolveSessionPath } from "../session-reader";
import { splitFinalAssistantBlocks } from "../message-display";
import type { SessionEntry } from "../types";
import { MATERIAL_SCOPES, type MaterialScope, type MaterialSnapshot } from "./materials";
import { messageText, projectTurns } from "./turns";

async function managerFor(id: string) {
  const rpc = getRpcSession(id);
  if (rpc?.isAlive()) return rpc.inner.sessionManager;
  const file = await resolveSessionPath(id);
  if (!file) throw new Error("来源会话已找不到，请重新选择材料。");
  return SessionManager.open(file);
}

/** Resolve scope against real entries once. The returned immutable text is
 * both the review surface and the eventual prompt; sending does not re-read. */
export async function captureMaterial(sourceId: string, turnId: string, targetId: string, scope: MaterialScope, excerpt?: string): Promise<MaterialSnapshot> {
  if (!Object.hasOwn(MATERIAL_SCOPES, scope)) throw new Error("未知引用范围。");
  const source = await managerFor(sourceId);
  const target = sourceId === targetId ? source : await managerFor(targetId);
  const entries = source.getEntries() as SessionEntry[];
  const turn = projectTurns(sourceId, entries, source.getLeafId()).turns.find(turn => turn.id === turnId);
  if (!turn) throw new Error("来源轮次已找不到，请重新选择材料。");
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  let ids = scope === "path" ? source.getBranch(turn.endId).map(entry => entry.id) : turn.entryIds;
  if (scope === "answer" || scope === "excerpt") {
    const answer = ids.findLast(id => {
      const entry = byId.get(id);
      return entry?.type === "message" && entry.message.role === "assistant" && messageText({ content: splitFinalAssistantBlocks(entry.message).answerBlocks }).trim();
    });
    ids = answer ? [answer] : [];
  }
  const existing = sourceId === targetId ? new Set(buildContextEntries(target.getEntries(), target.getLeafId()).map(entry => entry.id)) : new Set<string>();
  const parts: MaterialSnapshot["parts"] = [];
  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) throw new Error("来源历史不完整。");
    let role: string = entry.type, text = "";
    if (entry.type === "message") {
      role = entry.message.role;
      if (scope === "user" && role !== "user") continue;
      if ((scope === "answer" || scope === "excerpt") && role !== "assistant") continue;
      text = entry.message.role === "assistant" && (scope === "answer" || scope === "excerpt")
        ? messageText({ content: splitFinalAssistantBlocks(entry.message).answerBlocks })
        : messageText(entry.message);
    } else if ((scope === "turn" || scope === "path") && (entry.type === "compaction" || entry.type === "branch_summary")) text = entry.summary;
    if (!text.trim()) continue;
    if (scope === "excerpt") {
      if (!excerpt?.trim()) throw new Error("请从回答原文中选择摘录。");
      if (!text.includes(excerpt)) continue;
      text = excerpt;
    }
    // Same-session IDs are unique. Copied fork IDs are scoped to their session
    // and are intentionally not guessed to be equivalent across files.
    if (!existing.has(id)) parts.push({ entryId: id, role, text });
  }
  if (!parts.length) throw new Error("所选文字已在当前有效上下文中，或该范围没有可引用文字。");
  if (parts.reduce((sum, part) => sum + part.text.length, 0) > 200_000) throw new Error("材料超过 20 万字符，请缩小引用范围。");
  return { sessionId: sourceId, turnId, scope, capturedAt: new Date().toISOString(), targetLeafId: target.getLeafId(), parts };
}
