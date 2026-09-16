import type { AssistantMessage, SessionEntry } from "../types";
import { splitFinalAssistantBlocks } from "../message-display";
import { materialSources, type MaterialSource } from "./materials";

export interface WaygoalTurn {
  /** Session ID + this original entry ID is the identity, never a display index. */
  id: string;
  parentId: string | null;
  entryIds: string[];
  endId: string;
  question: string;
  answer: string;
  kind: "turn" | "compaction" | "summary" | "continuation";
  active: boolean;
  sources: MaterialSource[];
  /** Server digest of complete visible entries, used only with recorded fork ancestry. */
  fingerprint?: string;
}

export interface WaygoalTurns {
  sessionId: string;
  activeLeafId: string | null;
  turns: WaygoalTurn[];
}

export function messageText(message: { content?: unknown; output?: string }): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return message.output ?? "";
  return message.content.flatMap(block => block?.type === "text" && typeof block.text === "string" ? [block.text] : []).join("\n");
}

/** One pass over append-ordered, uncontracted Pi entries. Metadata inherits
 * its preceding turn; a fork inside an answer starts an explicit continuation
 * so sibling answers can never be concatenated into the same card. */
export function projectTurns(sessionId: string, entries: SessionEntry[], activeLeafId: string | null): WaygoalTurns {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const activeIds = new Set<string>();
  for (let entry = activeLeafId ? byId.get(activeLeafId) : undefined; entry && !activeIds.has(entry.id); entry = entry.parentId ? byId.get(entry.parentId) : undefined) activeIds.add(entry.id);
  const firstChildren = new Map<string | null, string>();
  for (const entry of entries) if (!firstChildren.has(entry.parentId)) firstChildren.set(entry.parentId, entry.id);
  const owners = new Map<string, WaygoalTurn>();
  const divergentMetadata = new Set<string>();
  const turns: WaygoalTurn[] = [];
  for (const entry of entries) {
    const parent = entry.parentId ? owners.get(entry.parentId) : undefined;
    const isUser = entry.type === "message" && entry.message.role === "user";
    const kind = entry.type === "compaction" ? "compaction" : entry.type === "branch_summary" ? "summary" : isUser ? "turn" : "continuation";
    const visible = entry.type === "message" || entry.type === "compaction" || entry.type === "branch_summary" || (entry.type === "custom_message" && entry.display);
    const divergent = firstChildren.get(entry.parentId) !== entry.id || Boolean(entry.parentId && divergentMetadata.has(entry.parentId));
    const starts = isUser || kind === "compaction" || kind === "summary" || (visible && (!parent || divergent));
    if (!visible && divergent) divergentMetadata.add(entry.id);
    let turn = parent;
    if (starts) {
      turn = { id: entry.id, parentId: parent?.id ?? null, entryIds: [], endId: entry.id,
        question: isUser && entry.type === "message" ? messageText(entry.message) : kind === "compaction" ? "历史压缩" : kind === "summary" ? "分支摘要" : "继续这段回答",
        answer: "", kind, active: false, sources: [] };
      const parsed = materialSources(turn.question);
      turn.question = parsed.question;
      turn.sources = parsed.sources;
      turns.push(turn);
    }
    if (!turn) continue;
    owners.set(entry.id, turn);
    if (!divergent || starts) turn.endId = entry.id;
    turn.active ||= activeIds.has(entry.id);
    if (visible) turn.entryIds.push(entry.id);
    if (entry.type === "compaction" || entry.type === "branch_summary") turn.answer = entry.summary;
    if (entry.type === "message" && entry.message.role === "assistant") {
      const message = entry.message as AssistantMessage;
      const answer = messageText({ content: splitFinalAssistantBlocks(message).answerBlocks });
      if (answer) turn.answer = answer;
    }
  }
  for (const turn of turns) turn.active = activeIds.has(turn.endId);
  return { sessionId, activeLeafId, turns };
}
