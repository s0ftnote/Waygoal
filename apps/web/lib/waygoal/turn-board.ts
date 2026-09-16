import type { WaygoalNodeOrigin, WaygoalPoint, WaygoalTurnLayout } from "./types";
import type { WaygoalTurn, WaygoalTurns } from "./turns";
import type { MaterialSource } from "./materials";

export const TURN_WIDTH = 278, TURN_HEIGHT = 150, TURN_GAP = 46;
export const turnKey = (sessionId: string, turnId: string) => JSON.stringify([sessionId, turnId]);
export interface BoardSession { id: string; title: string; origin: WaygoalNodeOrigin | null; running?: boolean }
export interface TurnMember { sessionId: string; turn: WaygoalTurn }
export interface BoardCard extends TurnMember { key: string; members: TurnMember[]; position: WaygoalPoint }
export interface BoardEdge {
  key: string;
  kind: "history" | "fork" | "reference" | "association";
  from: string;
  to: string;
  source?: MaterialSource;
  /** Original endpoint identities are retained even when the visual is shared. */
  fromSession: string;
  toSession: string;
  pair?: [string, string];
}

/** A read-only visual projection. A copied prefix is shared only along an
 * explicit recorded fork and after full visible-entry digests match. Alias
 * membership is never used to rewrite history or compile model context. */
export function projectTurnBoard(sessions: BoardSession[], data: Record<string, WaygoalTurns>, layout: WaygoalTurnLayout,
  previous: Record<string, WaygoalPoint> = {}, legacy: Record<string, WaygoalTurnLayout> = {}) {
  const ordered: BoardSession[] = [], seen = new Set<string>();
  const bySession = new Map(sessions.map(session => [session.id, session]));
  const visit = (session: BoardSession) => {
    if (seen.has(session.id)) return;
    seen.add(session.id);
    const parent = session.origin && bySession.get(session.origin.sessionId);
    if (parent) visit(parent);
    ordered.push(session);
  };
  // Session recency changes while chatting; it must not renumber the board.
  [...sessions].sort((a, b) => a.id.localeCompare(b.id)).forEach(visit);
  const aliases = new Map<string, string>(), cards: BoardCard[] = [], byKey = new Map<string, BoardCard>();
  const anchors: Record<string, WaygoalPoint> = {};
  const findTurn = (sessionId: string, entryId: string | null) => data[sessionId]?.turns.find(turn => turn.id === entryId || turn.endId === entryId || (entryId !== null && turn.entryIds.includes(entryId)));
  const keyFor = (sessionId: string, turnId: string) => aliases.get(turnKey(sessionId, turnId)) ?? turnKey(sessionId, turnId);
  const reserved = Object.entries({ ...previous, ...layout.positions }).filter(([key]) => {
    try { return bySession.has(JSON.parse(key)[0]); } catch { return false; }
  }).map(([, point]) => point);
  const vacant = (point: WaygoalPoint): WaygoalPoint => {
    const p = { ...point };
    while ([...reserved, ...cards.map(card => card.position)].some(point => Math.abs(point.x - p.x) < TURN_WIDTH + 20 && Math.abs(point.y - p.y) < TURN_HEIGHT + 25)) p.x += TURN_WIDTH + TURN_GAP;
    return p;
  };
  for (const session of ordered) {
    const origin = session.origin;
    const sourceTurn = origin?.entryId ? findTurn(origin.sessionId, origin.entryId) : undefined;
    const allowed = new Set<string>();
    const sourceById = new Map((origin ? data[origin.sessionId]?.turns ?? [] : []).map(turn => [turn.id, turn]));
    for (let turn = sourceTurn; turn && !allowed.has(turn.id); turn = turn.parentId ? sourceById.get(turn.parentId) : undefined) allowed.add(turn.id);
    const sourceCard = sourceTurn && origin ? byKey.get(keyFor(origin.sessionId, sourceTurn.id)) : undefined;
    const base = sourceCard ? { x: sourceCard.position.x + TURN_WIDTH + TURN_GAP, y: sourceCard.position.y + TURN_HEIGHT + TURN_GAP }
      : { x: cards.length ? Math.max(...cards.map(card => card.position.x)) + TURN_WIDTH + TURN_GAP : 0, y: 0 };
    anchors[session.id] = vacant(base);
    let first = true;
    for (const turn of data[session.id]?.turns ?? []) {
      const key = turnKey(session.id, turn.id), original = sourceById.get(turn.id);
      const member: TurnMember = { sessionId: session.id, turn };
      const parentsMatch = original && (turn.parentId === null && original.parentId === null || turn.parentId && original.parentId && keyFor(session.id, turn.parentId) === keyFor(origin!.sessionId, original.parentId));
      if (origin && allowed.has(turn.id) && turn.fingerprint && turn.fingerprint === original?.fingerprint && parentsMatch) {
        const shared = byKey.get(keyFor(origin.sessionId, turn.id));
        if (shared) { aliases.set(key, shared.key); shared.members.push(member); continue; }
      }
      const parent = turn.parentId ? byKey.get(keyFor(session.id, turn.parentId)) : undefined;
      const old = legacy[session.id]?.positions[turn.id];
      const proposed = old ? { x: base.x + old.x, y: old.y } : first ? anchors[session.id]
        : parent ? { x: parent.position.x, y: parent.position.y + TURN_HEIGHT + TURN_GAP } : anchors[session.id];
      const position = layout.positions[key] ?? previous[key] ?? vacant(proposed);
      const card: BoardCard = { key, ...member, members: [member], position };
      aliases.set(key, key); byKey.set(key, card); cards.push(card);
      if (first) anchors[session.id] = position;
      first = false;
    }
  }
  const edges: BoardEdge[] = [], edgeIds = new Set<string>();
  const add = (edge: BoardEdge) => { if (edge.from !== edge.to && !edgeIds.has(edge.key)) { edges.push(edge); edgeIds.add(edge.key); } };
  for (const session of ordered) {
    const turns = data[session.id]?.turns ?? [];
    const firstOwn = turns.find(turn => keyFor(session.id, turn.id) === turnKey(session.id, turn.id));
    const origin = session.origin;
    const source = origin?.entryId ? findTurn(origin.sessionId, origin.entryId) : undefined;
    if (origin && source && firstOwn) {
      const from = keyFor(origin.sessionId, source.id), to = keyFor(session.id, firstOwn.id);
      add({ key: `fork:${session.id}`, kind: "fork", from, to, fromSession: origin.sessionId, toSession: session.id });
    }
    for (const turn of turns) {
      const to = keyFor(session.id, turn.id);
      if (turn.parentId && !(firstOwn === turn && source)) {
        const from = keyFor(session.id, turn.parentId);
        add({ key: `history:${from}:${to}`, kind: "history", from, to, fromSession: session.id, toSession: session.id });
      }
      // An inherited turn retains the original visual's reference edges.
      if (to !== turnKey(session.id, turn.id)) continue;
      turn.sources.forEach((source, index) => add({ key: `reference:${to}:${index}`, kind: "reference", from: keyFor(source.sessionId, source.turnId), to, source, fromSession: source.sessionId, toSession: session.id }));
    }
  }
  const links: [string, string][] = [...layout.links];
  for (const [sessionId, saved] of Object.entries(legacy)) for (const [a, b] of saved.links) links.push([turnKey(sessionId, a), turnKey(sessionId, b)]);
  for (const pair of links) {
    const [a, b] = pair, from = aliases.get(a) ?? a, to = aliases.get(b) ?? b;
    add({ key: `association:${[from, to].sort().join(":")}`, kind: "association", from, to, pair, fromSession: byKey.get(from)?.sessionId ?? "", toSession: byKey.get(to)?.sessionId ?? "" });
  }
  return { cards, edges, aliases, anchors };
}
