import type { SessionEntry } from "../types";
import type { WaygoalTurn, WaygoalTurns } from "./turns";

/** Full Pi ancestry, including entries which have no card of their own. */
export function entryIndex(entries: SessionEntry[]) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const parentById = Object.fromEntries(entries.map(entry => [entry.id, entry.parentId]));
  const path = (leaf: string | null) => {
    const result: SessionEntry[] = [], seen = new Set<string>();
    for (let entry = leaf ? byId.get(leaf) : undefined; entry && !seen.has(entry.id); entry = entry.parentId ? byId.get(entry.parentId) : undefined) {
      seen.add(entry.id); result.push(entry);
    }
    return result.reverse();
  };
  return { byId, parentById, path };
}

export function findEntryTurn(history: WaygoalTurns | undefined, entryId: string | null): WaygoalTurn | undefined {
  if (!entryId || !history) return undefined;
  const anchor = history.entryToTurn?.[entryId];
  return history.turns.find(turn => anchor ? turn.id === anchor : turn.id === entryId || turn.endId === entryId || turn.entryIds.includes(entryId));
}

/** Build once per history revision; long copied prefixes must not scan all
 * turns again for each inherited entry. */
export function turnLookup(history: WaygoalTurns): Map<string, WaygoalTurn> {
  const result = new Map<string, WaygoalTurn>();
  const turns = new Map(history.turns.map(turn => [turn.id, turn]));
  for (const turn of history.turns) for (const id of [turn.id, turn.endId, ...turn.entryIds]) result.set(id, turn);
  for (const [id, anchor] of Object.entries(history.entryToTurn ?? {})) {
    const turn = turns.get(anchor);
    if (turn) result.set(id, turn);
  }
  return result;
}
