import { turnLookup } from "../sessions/entry-index";
import type { WaygoalNodeOrigin, WaygoalPoint, WaygoalTurnLayout } from "../../shared/waygoal-types";
import type { WaygoalTurn, WaygoalTurns } from "../sessions/turns";
import type { MaterialSource } from "../materials/materials";

export const TURN_WIDTH = 278, TURN_HEIGHT = 150, TURN_GAP = 46;
export const turnKey = (sessionId: string, turnId: string) => JSON.stringify([sessionId, turnId]);
export interface BoardSession { id: string; title: string; origin: WaygoalNodeOrigin | null; running?: boolean }
export interface TurnMember { sessionId: string; turn: WaygoalTurn }
export interface BoardCard extends TurnMember { key: string; ownerSessionId: string; members: TurnMember[]; position: WaygoalPoint }
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
  status?: "resolved" | "source-start" | "outside-canvas" | "loading" | "missing" | "origin-unrecorded" | "conflict";
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
    else if (session.origin) {
      // Visiting a new descendant must not pull its parent ahead of an older
      // sibling and change which real session carries the common prefix.
      sessions.filter(peer => peer.origin?.sessionId === session.origin!.sessionId && peer.id.localeCompare(session.id) < 0)
        .sort((a, b) => a.id.localeCompare(b.id)).forEach(visit);
    }
    ordered.push(session);
  };
  // Session recency changes while chatting; it must not renumber the board.
  [...sessions].sort((a, b) => a.id.localeCompare(b.id)).forEach(visit);
  const aliases = new Map<string, string>(), cards: BoardCard[] = [], byKey = new Map<string, BoardCard>();
  const anchors: Record<string, WaygoalPoint> = {};
  const newStarts = new Set<string>();
  const indexes = new Map(Object.entries(data).map(([id, history]) => [id, turnLookup(history)]));
  const findTurn = (sessionId: string, entryId: string | null) => entryId ? indexes.get(sessionId)?.get(entryId) : undefined;
  const ancestorCache = new Map<string, Set<string>>();
  const ancestors = (sessionId: string, entryId: string | null) => {
    const cacheKey = JSON.stringify([sessionId, entryId]);
    const cached = ancestorCache.get(cacheKey);
    if (cached) return cached;
    const turns = new Map((data[sessionId]?.turns ?? []).map(turn => [turn.id, turn]));
    const ids = new Set<string>();
    for (let turn = findTurn(sessionId, entryId); turn && !ids.has(turn.id); turn = turn.parentId ? turns.get(turn.parentId) : undefined) ids.add(turn.id);
    ancestorCache.set(cacheKey, ids);
    return ids;
  };
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
    const inherited = origin?.entryId ? ancestors(session.id, origin.entryId) : new Set<string>();
    // A recorded common source also proves sibling lineage when that source
    // is absent. Both fork boundaries constrain sharing; matching text alone
    // never connects unrelated sessions or merges post-fork discussion.
    const sources = origin ? (data[origin.sessionId] ? [{ id: origin.sessionId, allowed: ancestors(origin.sessionId, origin.entryId) }]
      : ordered.slice(0, ordered.indexOf(session)).filter(peer => peer.origin?.sessionId === origin.sessionId && peer.origin.entryId && origin.entryId)
        .map(peer => ({ id: peer.id, allowed: new Set([...ancestors(peer.id, peer.origin!.entryId)].filter(id => inherited.has(id))) })))
      .map(source => ({ ...source, turns: new Map((data[source.id]?.turns ?? []).map(turn => [turn.id, turn])) })) : [];
    const sourceCard = sourceTurn && origin ? byKey.get(keyFor(origin.sessionId, sourceTurn.id)) : undefined;
    const base = sourceCard ? { x: sourceCard.position.x + TURN_WIDTH + TURN_GAP, y: sourceCard.position.y + TURN_HEIGHT + TURN_GAP }
      : { x: cards.length ? Math.max(...cards.map(card => card.position.x)) + TURN_WIDTH + TURN_GAP : 0, y: 0 };
    anchors[session.id] = vacant(base);
    let first = true;
    for (const turn of data[session.id]?.turns ?? []) {
      const memberKey = turnKey(session.id, turn.id);
      let ownerId = session.id;
      const walked = new Set<string>();
      while (!walked.has(ownerId)) {
        walked.add(ownerId);
        const parent = bySession.get(ownerId)?.origin;
        if (!parent?.verified || !ancestors(ownerId, parent.entryId).has(turn.id)) break;
        const parentTurn = findTurn(parent.sessionId, turn.id);
        if (parentTurn && parentTurn.fingerprint !== turn.fingerprint) break;
        ownerId = parent.sessionId;
      }
      let key = turnKey(ownerId, turn.id);
      // Conflicting copied payloads must never share a visual identity.
      if (byKey.has(key) && byKey.get(key)!.turn.fingerprint !== turn.fingerprint) { key = memberKey; ownerId = session.id; }
      const member: TurnMember = { sessionId: session.id, turn };
      const shared = sources.flatMap(source => {
        const original = source.turns.get(turn.id);
        const parentsMatch = original && (turn.parentId === null && original.parentId === null || turn.parentId && original.parentId && keyFor(session.id, turn.parentId) === keyFor(source.id, original.parentId));
        const card = source.allowed.has(turn.id) && turn.fingerprint && turn.fingerprint === original?.fingerprint && parentsMatch
          ? byKey.get(keyFor(source.id, turn.id)) : undefined;
        return card ? [card] : [];
      })[0];
      if (shared) { aliases.set(memberKey, shared.key); shared.members.push(member); continue; }
      const parent = turn.parentId ? byKey.get(keyFor(session.id, turn.parentId)) : undefined;
      const old = legacy[session.id]?.positions[turn.id];
      const proposed = old ? { x: base.x + old.x, y: old.y } : first ? (parent && parent.sessionId !== session.id ? { x: parent.position.x + TURN_WIDTH + TURN_GAP, y: parent.position.y + TURN_HEIGHT + TURN_GAP } : anchors[session.id])
        : parent ? { x: parent.position.x, y: parent.position.y + TURN_HEIGHT + TURN_GAP } : anchors[session.id];
      const position = layout.positions[key] ?? previous[key] ?? layout.positions[memberKey] ?? previous[memberKey] ?? vacant(proposed);
      // A formerly shared prefix can become this session's own visible start
      // when its source leaves the canvas. Its old origin then belongs to a
      // different set of cards and must not offset the newly revealed history.
      if (first && !layout.positions[key] && !previous[key] && !layout.positions[memberKey] && !previous[memberKey]) newStarts.add(session.id);
      const card: BoardCard = { key, ownerSessionId: ownerId, ...member, members: [member], position };
      aliases.set(memberKey, key); byKey.set(key, card); cards.push(card);
      if (first) anchors[session.id] = position;
      first = false;
    }
  }
  const edges: BoardEdge[] = [], edgeIds = new Set<string>();
  const add = (edge: BoardEdge) => { if (edge.from !== edge.to && !edgeIds.has(edge.key)) { edges.push(edge); edgeIds.add(edge.key); } };
  for (const session of ordered) {
    const turns = data[session.id]?.turns ?? [];
    const origin = session.origin;
    const outside = origin && !bySession.has(origin.sessionId);
    const inherited = origin?.entryId ? ancestors(session.id, origin.entryId) : new Set<string>();
    const firstOwn = turns.find(turn => keyFor(session.id, turn.id) === turnKey(session.id, turn.id) && !inherited.has(turn.id));
    const sourceSessionId = outside || origin && !data[origin.sessionId] ? session.id : origin?.sessionId;
    const source = origin?.entryId && sourceSessionId ? findTurn(sourceSessionId, origin.entryId) : undefined;
    if (origin && source) {
      const from = keyFor(sourceSessionId!, source.id);
      const to = firstOwn ? keyFor(session.id, firstOwn.id) : `session:${session.id}`;
      // A newly created session has no new turn yet: its existing session
      // header is the endpoint. Do not invent a message just to draw a fork.
      if (firstOwn || byKey.get(from)?.sessionId !== session.id) add({ key: `fork:${session.id}`, kind: "fork", from, to, fromSession: origin.sessionId, toSession: session.id });
    }
    if (origin && !edges.some(edge => edge.key === `fork:${session.id}`)) add({ key: `fork:${session.id}`, kind: "fork", from: `session:${origin.sessionId}`, to: firstOwn ? keyFor(session.id, firstOwn.id) : `session:${session.id}`, fromSession: origin.sessionId, toSession: session.id,
      status: origin.status === "conflict" ? "conflict" : origin.mode === "before" && origin.entryId === null ? "source-start" : !origin.entryId ? "origin-unrecorded" : outside ? "outside-canvas" : !data[origin.sessionId] ? "loading" : "missing" });
    for (const turn of turns) {
      const to = keyFor(session.id, turn.id);
      if (turn.parentId && !(firstOwn === turn && source)) {
        const from = keyFor(session.id, turn.parentId);
        add({ key: `history:${from}:${to}`, kind: "history", from, to, fromSession: session.id, toSession: session.id });
      }
      // An inherited turn retains the original visual's reference edges.
      if (byKey.get(to)?.sessionId !== session.id) continue;
      turn.sources.forEach((source, index) => add({ key: `reference:${to}:${index}`, kind: "reference", from: keyFor(source.sessionId, source.turnId), to, source, fromSession: source.sessionId, toSession: session.id }));
    }
  }
  const links: [string, string][] = [...layout.links];
  for (const [sessionId, saved] of Object.entries(legacy)) for (const [a, b] of saved.links) links.push([turnKey(sessionId, a), turnKey(sessionId, b)]);
  for (const pair of links) {
    const [a, b] = pair, from = aliases.get(a) ?? a, to = aliases.get(b) ?? b;
    add({ key: `association:${[from, to].sort().join(":")}`, kind: "association", from, to, pair, fromSession: byKey.get(from)?.sessionId ?? "", toSession: byKey.get(to)?.sessionId ?? "" });
  }
  return { cards, edges, aliases, anchors, newStarts };
}
