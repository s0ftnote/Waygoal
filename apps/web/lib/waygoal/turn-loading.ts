import { forkFamily } from "./fork-family";
import type { BoardSession } from "./turn-board";

/** Load the visible discussions and their source families, not every collapsed
 * session on the canvas. Missing parent IDs still connect copied siblings. */
export function sessionsToLoad(sessions: BoardSession[], requested: string[]): string[] {
  const available = new Set(sessions.map(session => session.id));
  const family = forkFamily(sessions.flatMap(session => session.origin ? [[session.id, session.origin.sessionId] as const] : []), requested);
  return [...family].filter(id => available.has(id)).sort();
}
