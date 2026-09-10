import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { projectIdentityKey } from "./project-identity";
import { normalizeWorkspaceInput, workspaceDir, workspaceId } from "./waygoal-paths";
import { claimSessionsOn, registerSession, rememberedWorkspace } from "./waygoal-workspaces";
import type { SessionInfo } from "./types";
import { mergeTicketScan, readLocalTickets } from "./waygoal-tickets";
import { DEFAULT_CANVAS_ID, NODE_HEIGHT, NODE_WIDTH, TICKET_CARD_HEIGHT, type WaygoalScope, type WaygoalCanvasPatch, type WaygoalCanvasRecord, type WaygoalGroup, type WaygoalGroupView, type WaygoalManualLink, type WaygoalNode, type WaygoalNodeOrigin, type WaygoalOriginRecord, type WaygoalPoint, type WaygoalSavedTickets, type WaygoalSnapshot, type WaygoalTicketDiscussion, type WaygoalTicketSnapshot, type WaygoalTicketView, type WaygoalTitleSource, type WaygoalTreeInfo } from "./waygoal-types";
export { NODE_HEIGHT, NODE_WIDTH };

/** One file per canvas. The first canvas keeps the name the record had when
 *  a working directory could only have one, so nothing needs migrating. */
function recordPath(scope: WaygoalScope): string {
  const file = scope.canvasId === DEFAULT_CANVAS_ID ? "canvas.json" : `canvas-${scope.canvasId}.json`;
  return join(workspaceDir(scope.cwd, scope.agentDir), file);
}

/** Resolve the working directory to show: the one asked for, else the one
 *  this browser was last on, else the playground sample shipped with the
 *  repository. A remembered directory that is no longer there is said so by
 *  name — swapping in another one would show the wrong work without saying. */
export function resolveWorkspaceCwd(input?: string | null, agentDir = getAgentDir()): string {
  const explicit = input?.trim() ? normalizeWorkspaceInput(input) : null;
  const remembered = explicit ? null : rememberedWorkspace(agentDir);
  if (remembered?.missing) throw new Error(`上次打开的工作目录现在不在了：${remembered.cwd}。请另选一个目录。`);
  const candidate = explicit ?? remembered?.cwd ?? resolve(process.cwd(), "../../playground");
  try {
    const real = realpathSync(candidate);
    if (statSync(real).isDirectory()) return real;
  } catch { /* fall through */ }
  throw new Error(explicit ? `这个目录不存在：${input}` : "请选择一个工作目录");
}

function emptyRecord(cwd: string): WaygoalCanvasRecord {
  return { version: 1, cwd, nodes: {}, origins: {}, tickets: emptySavedTickets(), ticketSessions: {}, ticketExpanded: {}, ticketLast: {}, ticketWaiting: {}, groups: [], links: [], updatedAt: new Date(0).toISOString() };
}

const emptySavedTickets = (): WaygoalSavedTickets => ({ maps: {}, tickets: {} });

/** The cached reads are only ever a copy of files that were there; anything
 *  that does not look like one is dropped rather than shown as content. */
function validSavedTickets(value: unknown): WaygoalSavedTickets {
  const parsed = value as Partial<WaygoalSavedTickets> | undefined;
  const saved = emptySavedTickets();
  for (const [path, map] of Object.entries(parsed?.maps ?? {})) {
    if (map && typeof map.title === "string" && typeof map.readAt === "string") {
      saved.maps[path] = { title: map.title, body: String(map.body ?? ""), readAt: map.readAt };
    }
  }
  for (const [path, ticket] of Object.entries(parsed?.tickets ?? {})) {
    if (ticket && ticket.id === path && typeof ticket.mapPath === "string" && typeof ticket.readAt === "string") saved.tickets[path] = ticket;
  }
  return saved;
}

/** A ticket is named by its path inside this workspace, which is how the
 *  reader identifies it. Anything reaching outside is not this workspace's. */
function isTicketPath(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && !value.startsWith("/") && !value.split("/").includes("..");
}

function isOrigin(value: unknown): value is WaygoalOriginRecord {
  const origin = value as WaygoalOriginRecord;
  return Boolean(origin) && typeof origin.sessionId === "string" && Boolean(origin.sessionId)
    && typeof origin.entryId === "string" && Boolean(origin.entryId);
}

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && Boolean(value);

function validGroups(value: unknown): WaygoalGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(group => {
    const members: string[] = Array.isArray(group?.members) ? [...new Set((group.members as unknown[]).filter(isNonEmptyString))] : [];
    if (typeof group?.id !== "string" || !group.id || typeof group?.name !== "string" || members.length === 0) return [];
    return [{ id: group.id, name: group.name, members, collapsed: group.collapsed === true }];
  });
}

function validLinks(value: unknown): WaygoalManualLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(link => {
    if (typeof link?.id !== "string" || !link.id || !isNonEmptyString(link?.from) || !isNonEmptyString(link?.to) || link.from === link.to) return [];
    return [{ id: link.id, from: link.from, to: link.to, note: typeof link.note === "string" ? link.note : "" }];
  });
}

function isPoint(value: unknown): value is WaygoalPoint {
  return Boolean(value) && typeof (value as WaygoalPoint).x === "number" && typeof (value as WaygoalPoint).y === "number"
    && Number.isFinite((value as WaygoalPoint).x) && Number.isFinite((value as WaygoalPoint).y);
}

export function readCanvasRecord(scope: WaygoalScope): WaygoalCanvasRecord {
  const { cwd } = scope;
  const path = recordPath(scope);
  if (!existsSync(path)) return emptyRecord(cwd);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<WaygoalCanvasRecord>;
    const nodes: Record<string, WaygoalPoint> = {};
    for (const [id, point] of Object.entries(parsed.nodes ?? {})) if (isPoint(point)) nodes[id] = { x: point.x, y: point.y };
    const view = parsed.view && isPoint(parsed.view) && typeof parsed.view.scale === "number" && parsed.view.scale > 0 ? parsed.view : undefined;
    const origins: Record<string, WaygoalOriginRecord> = {};
    for (const [id, origin] of Object.entries(parsed.origins ?? {})) {
      if (isOrigin(origin) && id && origin.sessionId !== id) {
        origins[id] = { sessionId: origin.sessionId, entryId: origin.entryId, recordedAt: typeof origin.recordedAt === "string" ? origin.recordedAt : "" };
      }
    }
    return {
      version: 1,
      cwd,
      nodes,
      origins,
      tickets: validSavedTickets(parsed.tickets),
      ticketSessions: Object.fromEntries(Object.entries(parsed.ticketSessions ?? {}).filter(([id, ticket]) => id && isTicketPath(ticket))),
      ticketExpanded: Object.fromEntries(Object.entries(parsed.ticketExpanded ?? {}).filter(([t, open]) => isTicketPath(t) && typeof open === "boolean")),
      ticketWaiting: Object.fromEntries(Object.entries(parsed.ticketWaiting ?? {}).filter(([t, waiting]) => isTicketPath(t) && typeof waiting === "boolean")),
      ticketLast: Object.fromEntries(Object.entries(parsed.ticketLast ?? {}).filter(([t, place]) => isTicketPath(t) && place && typeof place.sessionId === "string" && Boolean(place.sessionId))
        .map(([t, place]) => [t, { sessionId: place.sessionId, entryId: typeof place.entryId === "string" && place.entryId ? place.entryId : null }])),
      groups: validGroups(parsed.groups),
      links: validLinks(parsed.links),
      ...(view ? { view } : {}),
      lastViewed: typeof parsed.lastViewed === "string" ? parsed.lastViewed : null,
      lastViewedEntry: typeof parsed.lastViewedEntry === "string" ? parsed.lastViewedEntry : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : emptyRecord(cwd).updatedAt,
    };
  } catch {
    // A damaged record must not block the canvas; Pi still owns the sessions.
    return emptyRecord(cwd);
  }
}

export function writeCanvasRecord(record: WaygoalCanvasRecord, scope: WaygoalScope): void {
  mkdirSync(workspaceDir(scope.cwd, scope.agentDir), { recursive: true });
  writePrivateFileAtomicSync(recordPath(scope), JSON.stringify(record, null, 2));
}

export function applyCanvasPatch(scope: WaygoalScope, patch: WaygoalCanvasPatch): WaygoalCanvasRecord {
  const record = readCanvasRecord(scope);
  let changed = false;
  // Which canvas a session is on is the workspace's business, not this
  // canvas's record: a session must not end up on two of them.
  // It is written to the workspace record, so it leaves this canvas's own
  // record unchanged and does not mark it as changed.
  if (typeof patch.registerSession === "string" && patch.registerSession) registerSession(scope, patch.registerSession);
  for (const [id, point] of Object.entries(patch.positions ?? {})) {
    if (!isPoint(point) || typeof id !== "string" || !id) continue;
    record.nodes[id] = { x: Math.round(point.x), y: Math.round(point.y) };
    changed = true;
  }
  if (patch.view && isPoint(patch.view) && typeof patch.view.scale === "number" && Number.isFinite(patch.view.scale) && patch.view.scale > 0) {
    record.view = { x: Math.round(patch.view.x), y: Math.round(patch.view.y), scale: Math.round(patch.view.scale * 1000) / 1000 };
    changed = true;
  }
  if (patch.lastViewed !== undefined) {
    record.lastViewed = typeof patch.lastViewed === "string" && patch.lastViewed ? patch.lastViewed : null;
    changed = true;
  }
  if (patch.lastViewedEntry !== undefined) {
    record.lastViewedEntry = typeof patch.lastViewedEntry === "string" && patch.lastViewedEntry ? patch.lastViewedEntry : null;
    changed = true;
  }
  const origin = patch.origin;
  // A fork records where it came from at the moment it happens. An incomplete
  // or self-referential origin is dropped: a wrong source is worse than none,
  // because the fallback below already reports "source unrecorded" honestly.
  if (origin && origin.sessionId && origin.originSessionId && origin.originEntryId && origin.sessionId !== origin.originSessionId) {
    record.origins[origin.sessionId] = { sessionId: origin.originSessionId, entryId: origin.originEntryId, recordedAt: new Date().toISOString() };
    // Branching a discussion does not take it out of its ticket: the new path
    // is another way of working on the same question.
    const inherited = record.ticketSessions[origin.originSessionId];
    if (inherited && !record.ticketSessions[origin.sessionId]) record.ticketSessions[origin.sessionId] = inherited;
    changed = true;
  }
  const held = patch.ticketSession;
  if (held && typeof held.sessionId === "string" && held.sessionId) {
    if (held.ticket === null) { delete record.ticketSessions[held.sessionId]; changed = true; }
    else if (isTicketPath(held.ticket)) { record.ticketSessions[held.sessionId] = held.ticket; changed = true; }
  }
  const group = patch.addGroup;
  if (group && Array.isArray(group.members)) {
    const members = [...new Set(group.members.filter(isNonEmptyString))];
    if (members.length > 0) {
      // A card belongs to one arrangement at a time: joining a group is how it
      // leaves the one it was in, and a group left with nobody in it is gone.
      for (const other of record.groups) {
        other.members = other.members.filter(id => !members.includes(id));
        if (other.members.length === 0) delete record.nodes[other.id];
      }
      record.groups = record.groups.filter(other => other.members.length > 0);
      const id = `g-${randomBytes(6).toString("hex")}`;
      record.groups.push({ id, name: group.name?.trim() || "未命名分组", members, collapsed: false });
      // Collapsed, the group stands where its members were standing.
      const placed = members.map(member => record.nodes[member]).filter(Boolean);
      if (placed.length > 0) record.nodes[id] = { x: Math.min(...placed.map(p => p.x)), y: Math.min(...placed.map(p => p.y)) };
      changed = true;
    }
  }
  const collapse = patch.groupCollapsed;
  if (collapse && isNonEmptyString(collapse.group) && typeof collapse.collapsed === "boolean") {
    record.groups = record.groups.map(g => (g.id === collapse.group ? { ...g, collapsed: collapse.collapsed } : g));
    changed = true;
  }
  if (isNonEmptyString(patch.removeGroup)) {
    // Only the grouping goes: the sessions and tickets in it are Pi's and the
    // workspace's, and taking a frame away must not touch them.
    record.groups = record.groups.filter(group => group.id !== patch.removeGroup);
    delete record.nodes[patch.removeGroup];
    changed = true;
  }
  const link = patch.addLink;
  if (link && isNonEmptyString(link.from) && isNonEmptyString(link.to) && link.from !== link.to) {
    const note = typeof link.note === "string" ? link.note.trim() : "";
    const between = (l: WaygoalManualLink) => (l.from === link.from && l.to === link.to) || (l.from === link.to && l.to === link.from);
    const existing = record.links.find(between);
    if (existing) record.links = record.links.map(l => (l.id === existing.id ? { ...l, from: link.from, to: link.to, note } : l));
    else record.links.push({ id: `l-${randomBytes(6).toString("hex")}`, from: link.from, to: link.to, note });
    changed = true;
  }
  if (isNonEmptyString(patch.removeLink)) {
    record.links = record.links.filter(l => l.id !== patch.removeLink);
    changed = true;
  }
  if (patch.ticketExpanded && isTicketPath(patch.ticketExpanded.ticket) && typeof patch.ticketExpanded.expanded === "boolean") {
    record.ticketExpanded[patch.ticketExpanded.ticket] = patch.ticketExpanded.expanded;
    changed = true;
  }
  const last = patch.ticketLast;
  if (last && isTicketPath(last.ticket) && typeof last.sessionId === "string" && last.sessionId) {
    record.ticketLast[last.ticket] = { sessionId: last.sessionId, entryId: typeof last.entryId === "string" && last.entryId ? last.entryId : null };
    changed = true;
  }
  if (changed) {
    record.updatedAt = new Date().toISOString();
    writeCanvasRecord(record, scope);
  }
  return record;
}

const GRID_X = NODE_WIDTH + 70;
const GRID_Y = NODE_HEIGHT + 60;
const GRID_COLUMNS = 3;

/** How tall a card already on the canvas is. Ticket cards are the tall ones:
 *  the record's own ticket list says which ids are tickets. */
function cardHeight(record: WaygoalCanvasRecord, id: string): number {
  return record.tickets.tickets[id] ? TICKET_CARD_HEIGHT : NODE_HEIGHT;
}

/** Give one card a place on the canvas, keeping the one it already has.
 *  Returns null when nothing had to be assigned, so callers know whether the
 *  record needs writing. */
function placeOnCanvas(record: WaygoalCanvasRecord, id: string, height = NODE_HEIGHT): WaygoalPoint | null {
  if (record.nodes[id]) return null;
  const taken = Object.entries(record.nodes).map(([takenId, point]) => ({ ...point, height: cardHeight(record, takenId) }));
  record.nodes[id] = nextFreePosition(taken, height);
  return record.nodes[id];
}

/** First free grid cell that does not overlap a saved card, counting how tall
 *  each of them is: a ticket's discussions hang below it, and a session card
 *  dropped on top of them would hide the ticket's own discussions. */
export function nextFreePosition(taken: Iterable<WaygoalPoint & { height: number }>, height: number): WaygoalPoint {
  const points = [...taken];
  for (let index = 0; ; index++) {
    const candidate = { x: (index % GRID_COLUMNS) * GRID_X, y: Math.floor(index / GRID_COLUMNS) * GRID_Y };
    const overlaps = points.some(p => Math.abs(p.x - candidate.x) < NODE_WIDTH + 20
      && candidate.y < p.y + p.height + 20
      && p.y < candidate.y + height + 20);
    if (!overlaps) return candidate;
  }
}

export function sessionTitle(session: Pick<SessionInfo, "name" | "firstMessage" | "messageCount">): { title: string; titleSource: WaygoalTitleSource } {
  const name = session.name?.trim();
  if (name) return { title: name, titleSource: "name" };
  const first = session.firstMessage?.replace(/\s+/g, " ").trim();
  if (first && first !== "(no messages)" && session.messageCount > 0) {
    return { title: first.length > 72 ? `${first.slice(0, 72)}…` : first, titleSource: "fallback" };
  }
  return { title: "还没有内容的会话", titleSource: "empty" };
}

/** Same workspace identity: pi-web's project identity key, else the same real path.
 *  Distinct from `samePath()` in lib/paths.ts, which compares path strings only. */
function sameWorkspace(a: string, b: string): boolean {
  if (projectIdentityKey(a) === projectIdentityKey(b)) return true;
  try { return realpathSync(a) === realpathSync(b); } catch { return false; }
}

/** Sessions whose cwd is this workspace, one node per real session id. */
export function workspaceSessions(cwd: string, sessions: SessionInfo[]): SessionInfo[] {
  const byId = new Map<string, SessionInfo>();
  for (const session of sessions) {
    if (!session.cwd || !sameWorkspace(session.cwd, cwd)) continue;
    if (session.relation?.kind === "subagent") continue;
    const existing = byId.get(session.id);
    // Prefer the disk-backed entry; a runtime snapshot never adds a second node.
    if (!existing || (existing.transient && !session.transient)) byId.set(session.id, session);
  }
  return [...byId.values()];
}

/** The sessions of this working directory that belong to this canvas. */
export function canvasSessions(scope: WaygoalScope, sessions: SessionInfo[]): SessionInfo[] {
  const owned = workspaceSessions(scope.cwd, sessions);
  const here = new Set(claimSessionsOn(scope, owned.map(session => session.id)));
  return owned.filter(session => here.has(session.id));
}

/** The source a fork came from: our own record first, else Pi's header, which
 *  knows the source session but never the message. Missing stays missing —
 *  a similar title is not evidence of the same history. */

function nodeOrigin(session: SessionInfo, record: WaygoalCanvasRecord, titles: Map<string, string>): WaygoalNodeOrigin | null {
  const recorded = record.origins[session.id];
  const headerOrigin = session.relation?.kind === "fork" ? session.relation.originSessionId ?? session.parentSessionId : undefined;
  const sessionId = recorded?.sessionId ?? headerOrigin;
  if (!sessionId || sessionId === session.id) return null;
  return {
    sessionId,
    entryId: recorded?.entryId ?? null,
    inWorkspace: titles.has(sessionId),
    title: titles.get(sessionId) ?? null,
  };
}

export function buildSnapshot(
  scope: WaygoalScope,
  sessions: SessionInfo[],
  runningIds: Iterable<string>,
  trees: ReadonlyMap<string, WaygoalTreeInfo> = new Map(),
): WaygoalSnapshot {
  const { cwd } = scope;
  const running = new Set(runningIds);
  const record = readCanvasRecord(scope);
  const owned = canvasSessions(scope, sessions).sort((a, b) => a.created.localeCompare(b.created));
  const titles = new Map(owned.map(session => [session.id, sessionTitle(session).title]));
  let changed = false;
  const nodes: WaygoalNode[] = owned.map(session => {
    if (placeOnCanvas(record, session.id)) changed = true;
    return {
      id: session.id,
      ...sessionTitle(session),
      messageCount: session.messageCount,
      created: session.created,
      modified: session.modified,
      running: running.has(session.id),
      transient: Boolean(session.transient),
      position: record.nodes[session.id],
      origin: nodeOrigin(session, record, titles),
      branchPointCount: trees.get(session.id)?.branchPointCount ?? 0,
      activeLeafId: trees.get(session.id)?.activeLeafId ?? null,
    };
  });
  // Collapsed, a group is a card like any other and needs a place of its own.
  // Placed before the write below, so the place it is given is the one kept.
  const groups: WaygoalGroupView[] = record.groups.map(group => {
    if (placeOnCanvas(record, group.id)) changed = true;
    return { ...group, position: record.nodes[group.id] };
  });
  if (changed) {
    record.updatedAt = new Date().toISOString();
    writeCanvasRecord(record, scope);
  }
  const lastViewed = record.lastViewed ?? null;
  const lastViewedMissing = Boolean(lastViewed) && !nodes.some(n => n.id === lastViewed);
  return {
    cwd,
    workspaceId: workspaceId(cwd),
    nodes,
    view: record.view ?? null,
    lastViewed,
    // The position belongs to that session only; it must never be carried over.
    lastViewedEntry: lastViewedMissing ? null : record.lastViewedEntry ?? null,
    lastViewedMissing,
    groups,
    links: record.links,
  };
}

/** One workspace's local tickets, ready to draw: what the source files say
 *  right now, plus where each card sits and anything that could not be read
 *  this time. Reading is all it does — no Pi session is opened or touched. */
export function buildTicketSnapshot(scope: WaygoalScope, nodes: WaygoalNode[] = []): WaygoalTicketSnapshot {
  const scan = readLocalTickets(scope.cwd);
  const record = readCanvasRecord(scope);
  const merged = mergeTicketScan(scan, record.tickets);
  let changed = JSON.stringify(record.tickets) !== JSON.stringify(merged.saved);
  const place = (id: string, height: number): WaygoalPoint => {
    if (placeOnCanvas(record, id, height)) changed = true;
    return record.nodes[id];
  };
  const byId = new Map(nodes.map(node => [node.id, node]));
  /** Write down what this ticket is waiting on now, and answer whether it has
   *  just stopped waiting. Only the snapshot that first sees that says so: the
   *  record remembers, so no later read and no restarted host says it again.
   *  Unblocking is only that — it finishes nothing, opens nothing, and leaves
   *  the ticket's own status to the source. */
  const recordWaiting = (ticket: WaygoalTicketView): boolean => {
    const waiting = ticket.state === "waiting";
    const wasWaiting = record.ticketWaiting[ticket.id];
    // A premise that merely could not be read this time holds the ticket, but
    // it says nothing about the work: remembering that as waiting would make
    // the next successful read look like the premise had just been met.
    const readable = !ticket.blockers.some(blocker => blocker.holding === "unreadable");
    if (readable && wasWaiting !== waiting) { record.ticketWaiting[ticket.id] = waiting; changed = true; }
    return wasWaiting === true && ticket.state === "unblocked";
  };
  /** The discussions held under one ticket, in the order they were held. A
   *  session the record points at but the workspace no longer has is kept and
   *  marked: the user linked it, so its absence is news, not noise. */
  const discussionsOf = (ticket: string): WaygoalTicketDiscussion[] =>
    Object.entries(record.ticketSessions).filter(([, path]) => path === ticket).map(([sessionId]) => {
      const node = byId.get(sessionId);
      return {
        sessionId,
        title: node?.title ?? "读不到这段讨论",
        running: node?.running ?? false,
        missing: !node,
        originSessionId: record.origins[sessionId]?.sessionId ?? null,
      };
    });
  const maps = merged.maps.map(map => ({
    ...map,
    position: place(map.path, NODE_HEIGHT),
    tickets: map.tickets.map(ticket => ({
      ...ticket,
      position: place(ticket.id, TICKET_CARD_HEIGHT),
      justUnblocked: recordWaiting(ticket),
      discussions: discussionsOf(ticket.id),
      expanded: record.ticketExpanded[ticket.id] ?? true,
      lastDiscussion: record.ticketLast[ticket.id] ?? null,
    })),
  }));
  if (changed) {
    // The layout, the cached reads and what each ticket was last seen waiting
    // on are one record; a snapshot that learned any of them writes it once.
    record.tickets = merged.saved;
    record.updatedAt = new Date().toISOString();
    writeCanvasRecord(record, scope);
  }
  return { maps, unsupported: scan.unsupported, unreadable: scan.unreadable, readAt: scan.readAt };
}
