import { createHash } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "../rpc-manager";
import { resolveSessionPath } from "../session-reader";
import type { SessionEntry } from "../types";
import { projectTurns } from "./turns";

/** Read only. Opening SessionManager never creates an AgentSession or runs tools. */
export async function readTurns(sessionId: string) {
  const rpc = getRpcSession(sessionId);
  const file = rpc?.isAlive() ? null : await resolveSessionPath(sessionId);
  if (!rpc?.isAlive() && !file) return null;
  const manager = rpc?.isAlive() ? rpc.inner.sessionManager : SessionManager.open(file!);
  const entries = manager.getEntries() as SessionEntry[];
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const result = projectTurns(sessionId, entries, manager.getLeafId());
  for (const turn of result.turns) turn.fingerprint = createHash("sha256")
    .update(JSON.stringify(turn.entryIds.map(id => byId.get(id)))).digest("hex");
  return result;
}
