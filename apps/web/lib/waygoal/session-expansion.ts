import { NODE_WIDTH, NODE_HEIGHT, type WaygoalPoint } from "./types";
import { TURN_WIDTH, TURN_HEIGHT, type BoardCard, type BoardSession, type projectTurnBoard } from "./turn-board";

export const SESSION_HEADER = 80;
export interface SessionSize { width: number; height: number }

/** Folding is a projection of the same real turns. A shared prefix is shown
 * once, under an expanded member; its key and original identities never change. */
export function expandedTurns(graph: ReturnType<typeof projectTurnBoard>, sessions: (BoardSession & { position: WaygoalPoint })[], expanded: string[], origins: Record<string, WaygoalPoint> = {}) {
  const open = new Set(expanded), owners = new Map<string, string>();
  const groups = new Map<string, BoardCard[]>();
  for (const card of graph.cards) {
    const owner = open.has(card.sessionId) ? card.sessionId : card.members.find(member => open.has(member.sessionId))?.sessionId;
    if (!owner) continue;
    owners.set(card.key, owner);
    groups.set(owner, [...(groups.get(owner) ?? []), card]);
  }
  const bases = { ...origins };
  const sizes: Record<string, SessionSize> = {}, offsets: Record<string, WaygoalPoint> = {};
  for (const session of sessions) {
    if (!open.has(session.id)) continue;
    const cards = groups.get(session.id) ?? [];
    const x = origins[session.id]?.x ?? (cards.length ? Math.min(...cards.map(card => card.position.x)) : 0);
    const y = origins[session.id]?.y ?? (cards.length ? Math.min(...cards.map(card => card.position.y)) : 0);
    if (cards.length) bases[session.id] = { x, y };
    sizes[session.id] = {
      width: cards.length ? Math.max(...cards.map(card => card.position.x + TURN_WIDTH)) - x : TURN_WIDTH,
      height: SESSION_HEADER + (cards.length ? Math.max(...cards.map(card => card.position.y + TURN_HEIGHT)) - y : 80) + 90,
    };
    offsets[session.id] = { x: session.position.x - x, y: session.position.y + SESSION_HEADER - y };
  }
  const cards = graph.cards.flatMap(card => {
    const owner = owners.get(card.key), offset = owner && offsets[owner];
    return offset ? [{ ...card, position: { x: card.position.x + offset.x, y: card.position.y + offset.y } }] : [];
  });
  return { cards, sizes, offsets, owners, bases };
}

/** Opening a session reserves space beside its neighbours. These temporary
 * display offsets never overwrite the user's saved collapsed arrangement. */
export function placeExpandedSessions<T extends { id: string; position: WaygoalPoint }>(sessions: T[], sizes: Record<string, SessionSize>, obstacles: ({ x: number; y: number } & SessionSize)[] = []): T[] {
  if (!Object.keys(sizes).length) return sessions;
  const placed = [...obstacles];
  const positions = new Map<string, WaygoalPoint>();
  const ordered = [...sessions].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y || a.id.localeCompare(b.id));
  for (const session of ordered) {
    const size = sizes[session.id] ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
    const box = { ...session.position, ...size };
    let hit;
    while ((hit = placed.find(other => box.x < other.x + other.width + 40 && box.x + box.width + 40 > other.x && box.y < other.y + other.height + 40 && box.y + box.height + 40 > other.y))) box.x = hit.x + hit.width + 56;
    positions.set(session.id, { x: box.x, y: box.y }); placed.push(box);
  }
  return sessions.map(session => ({ ...session, position: positions.get(session.id)! }));
}
