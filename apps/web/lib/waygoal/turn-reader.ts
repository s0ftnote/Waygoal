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
  return projectTurns(sessionId, manager.getEntries() as SessionEntry[], manager.getLeafId());
}
