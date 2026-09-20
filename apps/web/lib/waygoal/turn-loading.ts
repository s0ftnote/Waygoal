import type { BoardSession } from "./turn-board";

/** Load the visible discussions and their source families, not every collapsed
 * session on the canvas. Missing parent IDs still connect copied siblings. */
export function sessionsToLoad(sessions: BoardSession[], requested: string[]): string[] {
  const available = new Set(sessions.map(session => session.id));
  const adjacent = new Map<string, string[]>();
  for (const session of sessions) {
    const parent = session.origin?.sessionId;
    if (!parent) continue;
    adjacent.set(session.id, [...(adjacent.get(session.id) ?? []), parent]);
    adjacent.set(parent, [...(adjacent.get(parent) ?? []), session.id]);
  }
  const seen = new Set<string>(), queue = [...requested];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (!id || seen.has(id)) continue;
    seen.add(id); queue.push(...(adjacent.get(id) ?? []));
  }
  return [...seen].filter(id => available.has(id)).sort();
}
