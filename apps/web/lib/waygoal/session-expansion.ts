import { NODE_WIDTH, NODE_HEIGHT, type WaygoalPoint } from "./types";
import { TURN_WIDTH, TURN_HEIGHT, TURN_GAP, type BoardCard, type BoardSession, type projectTurnBoard } from "./turn-board";

export const SESSION_HEADER = 80;
export interface SessionSize { width: number; height: number }

/** Folding is a projection of the same real turns. A shared prefix is shown
 * once, under its original session; folding does not move ancestors into a branch. */
export function expandedTurns(graph: ReturnType<typeof projectTurnBoard>, sessions: (BoardSession & { position: WaygoalPoint })[], expanded: string[], origins: Record<string, WaygoalPoint> = {}) {
  const open = new Set(expanded), owners = new Map<string, string>();
  const groups = new Map<string, BoardCard[]>();
  const bySession = new Map(sessions.map(session => [session.id, session]));
  for (const card of graph.cards) {
    const source = bySession.get(card.sessionId)?.origin?.sessionId;
    const peer = source && !bySession.has(source) ? card.members.find(member => open.has(member.sessionId) && bySession.get(member.sessionId)?.origin?.sessionId === source)?.sessionId : undefined;
    const identityOwner = card.ownerSessionId;
    const owner = identityOwner !== card.sessionId && bySession.has(identityOwner) ? (open.has(identityOwner) ? identityOwner : undefined) : open.has(card.sessionId) ? card.sessionId : peer;
    if (!owner) continue;
    owners.set(card.key, owner);
    groups.set(owner, [...(groups.get(owner) ?? []), card]);
  }
  const bases = { ...origins };
  const sizes: Record<string, SessionSize> = {}, offsets: Record<string, WaygoalPoint> = {};
  for (const session of sessions) {
    if (!open.has(session.id)) continue;
    const cards = groups.get(session.id) ?? [];
    const sharedOwner = cards.length && cards.every(card => card.sessionId !== session.id) ? cards[0].sessionId : session.id;
    const origin = graph.newStarts.has(session.id) ? undefined : origins[sharedOwner];
    const x = origin?.x ?? (cards.length ? Math.min(...cards.map(card => card.position.x)) : 0);
    const y = origin?.y ?? (cards.length ? Math.min(...cards.map(card => card.position.y)) : 0);
    if (cards.length) bases[session.id] = { x, y };
    sizes[session.id] = {
      width: cards.length ? Math.max(TURN_WIDTH, Math.max(...cards.map(card => card.position.x + TURN_WIDTH)) - x) : TURN_WIDTH,
      height: SESSION_HEADER + (cards.length ? Math.max(80, Math.max(...cards.map(card => card.position.y + TURN_HEIGHT)) - y) : 80) + 90,
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
export function placeExpandedSessions<T extends { id: string; position: WaygoalPoint; origin?: { sessionId: string } | null }>(sessions: T[], sizes: Record<string, SessionSize>, obstacles: ({ x: number; y: number } & SessionSize)[] = []): T[] {
  if (!Object.keys(sizes).length) return sessions;
  const byId = new Map(sessions.map(session => [session.id, session]));
  const familyOf = (id: string) => {
    const seen = new Set<string>();
    while (!seen.has(id)) {
      seen.add(id);
      const parent = byId.get(id)?.origin?.sessionId;
      if (!parent) return id;
      id = parent;
    }
    return [...seen].sort()[0];
  };
  const families = new Map<string, T[]>();
  for (const session of sessions) {
    const root = familyOf(session.id);
    families.set(root, [...(families.get(root) ?? []), session]);
  }
  const boxes = [...families].map(([id, members]) => {
    const x = Math.min(...members.map(member => member.position.x));
    const y = Math.min(...members.map(member => member.position.y));
    const right = Math.max(...members.map(member => member.position.x + (sizes[member.id]?.width ?? NODE_WIDTH)));
    const bottom = Math.max(...members.map(member => member.position.y + (sizes[member.id]?.height ?? NODE_HEIGHT)));
    return { id, members, x, y, width: right - x, height: bottom - y };
  }).sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));
  const placed = [...obstacles], offsets = new Map<string, number>();
  for (const family of boxes) {
    const box = { x: family.x, y: family.y, width: family.width, height: family.height };
    let hit;
    while ((hit = placed.find(other => box.x < other.x + other.width + 40 && box.x + box.width + 40 > other.x && box.y < other.y + other.height + 40 && box.y + box.height + 40 > other.y))) box.x = hit.x + hit.width + 56;
    for (const member of family.members) offsets.set(member.id, box.x - family.x);
    placed.push(box);
  }
  return sessions.map(session => ({ ...session, position: { x: session.position.x + offsets.get(session.id)!, y: session.position.y } }));
}

/** Reserve one free branch column at creation. Existing nodes never move. */
export function placeNewFork(source: WaygoalPoint, occupied: { position: WaygoalPoint; width: number; height: number }[]): WaygoalPoint {
  const point = { x: source.x + TURN_WIDTH + TURN_GAP, y: source.y + TURN_HEIGHT + TURN_GAP - SESSION_HEADER };
  // Reserve the column below the boundary for continuous growth, including
  // already expanded internal Pi branches in the parent's conversation.
  while (occupied.some(box => box.position.y + box.height > point.y && box.position.x < point.x + TURN_WIDTH + 20 && box.position.x + box.width + 20 > point.x)) point.x += TURN_WIDTH + TURN_GAP;
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
