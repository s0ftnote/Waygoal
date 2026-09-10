export interface WaygoalPoint { x: number; y: number }
export interface WaygoalView { x: number; y: number; scale: number }

/** Local canvas record for one workspace. Pi keeps the sessions; this only
 *  keeps identity, layout and the last viewed position. */
export interface WaygoalCanvasRecord {
  version: 1;
  cwd: string;
  nodes: Record<string, WaygoalPoint>;
  /** Where a forked session came from, keyed by the forked session id. Pi's
   *  header keeps only the source file, so the source message is ours to
   *  record at the moment the fork happens. */
  origins: Record<string, WaygoalOriginRecord>;
  /** The last content each local ticket file was successfully read as, so a
   *  file that stops being readable can be shown as it last was. */
  tickets: WaygoalSavedTickets;
  /** Which ticket each discussion is held under, keyed by session id. One
   *  ticket can have several discussions; a discussion belongs to one ticket. */
  ticketSessions: Record<string, string>;
  /** Tickets whose discussions the user collapsed. Absent means shown. */
  ticketExpanded: Record<string, boolean>;
  /** Per ticket, the discussion last talked in and the path it was left on. */
  ticketLast: Record<string, WaygoalTicketPlace>;
  /** Maps whose "everything is closed, go check the destination" note the
   *  user has put away, keyed by map path. It stays away across reads and
   *  across a restart, and the user can ask for it back. */
  mapCheckDismissed: Record<string, boolean>;
  /** Whether each ticket was last seen waiting on a premise. It is kept so a
   *  ticket that has just stopped waiting can be pointed at once, and so a
   *  restarted host does not point at the same change again. */
  ticketWaiting: Record<string, boolean>;
  /** The user's own arrangement of this canvas: which cards they said belong
   *  together, and which relations they drew by hand. Neither is inferred. */
  groups: WaygoalGroup[];
  links: WaygoalManualLink[];
  view?: WaygoalView;
  lastViewed?: string | null;
  /** Read-only viewing position inside `lastViewed`. */
  lastViewedEntry?: string | null;
  updatedAt: string;
}

export interface WaygoalOriginRecord {
  sessionId: string;
  entryId: string;
  recordedAt: string;
}

/** Where a node was forked from. `entryId` is null when only Pi's header knows
 *  the source session — the position is reported as unrecorded, never guessed. */
export interface WaygoalNodeOrigin {
  sessionId: string;
  entryId: string | null;
  inWorkspace: boolean;
  title: string | null;
}

/** What the real Pi tree says about one session. Read separately from the
 *  session list because it needs the session file itself. */
export interface WaygoalTreeInfo {
  activeLeafId: string | null;
  branchPointCount: number;
}

export type WaygoalTitleSource = "name" | "fallback" | "empty";

export interface WaygoalNode {
  id: string;
  title: string;
  titleSource: WaygoalTitleSource;
  messageCount: number;
  created: string;
  modified: string;
  running: boolean;
  transient: boolean;
  position: WaygoalPoint;
  origin: WaygoalNodeOrigin | null;
  /** Real branch points inside this session; 0 when the tree is unread. */
  branchPointCount: number;
  /** Where this session would continue right now. */
  activeLeafId: string | null;
}

/** A named group of cards the user drew on one canvas. It says these belong
 *  together and nothing else: no session is created, no context is shared, and
 *  every member keeps its own history. */
export interface WaygoalGroup {
  id: string;
  name: string;
  members: string[];
  /** Collapsed shows the group as one named card and leaves its members off
   *  the canvas; expanded puts them back where they were. */
  collapsed: boolean;
}

/** A group as drawn: where its own card sits when it is collapsed. */
export interface WaygoalGroupView extends WaygoalGroup {
  position: WaygoalPoint;
}

/** A relation between two cards that the user drew by hand, with an optional
 *  note. Nothing inferred it: it is neither a real fork read from Pi's history
 *  nor a dependency read from a ticket's `Blocked by:`, and drawing or removing
 *  one changes neither of those. */
export interface WaygoalManualLink {
  id: string;
  from: string;
  to: string;
  /** Empty when the user did not write one. */
  note: string;
}

export interface WaygoalSnapshot {
  cwd: string;
  workspaceId: string;
  nodes: WaygoalNode[];
  view: WaygoalView | null;
  lastViewed: string | null;
  lastViewedEntry: string | null;
  /** Set when the record points at a session that is no longer in this workspace. */
  lastViewedMissing: boolean;
  groups: WaygoalGroupView[];
  links: WaygoalManualLink[];
}

export interface WaygoalTicketPlace {
  sessionId: string;
  /** The entry it was left on, when that discussion has more than one path. */
  entryId: string | null;
}

export interface WaygoalCanvasPatch {
  positions?: Record<string, WaygoalPoint>;
  view?: WaygoalView;
  lastViewed?: string | null;
  lastViewedEntry?: string | null;
  origin?: { sessionId: string; originSessionId: string; originEntryId: string };
  /** Hold this discussion under that ticket, or take it back out with null. */
  ticketSession?: { sessionId: string; ticket: string | null };
  ticketExpanded?: { ticket: string; expanded: boolean };
  ticketLast?: { ticket: string; sessionId: string; entryId: string | null };
  /** Put this session on the canvas the patch is addressed to. A session
   *  started from a canvas belongs to that canvas and no other. */
  registerSession?: string;
  /** Group these cards under this name. The id is made here, and a card
   *  joining a group leaves the one it was in. */
  addGroup?: { name: string; members: string[] };
  /** Show this group as one card, or spread its members out again. */
  groupCollapsed?: { group: string; collapsed: boolean };
  /** Put that map's check note away, or ask for it back. */
  mapCheck?: { map: string; dismissed: boolean };
  /** Take the grouping away. The members themselves are untouched. */
  removeGroup?: string;
  /** Draw a relation between two cards by hand. Between the same two cards
   *  there is only ever one, so drawing it again is how the note is changed. */
  addLink?: { from: string; to: string; note?: string };
  removeLink?: string;
}

/** Node card size in canvas units; waygoal.css mirrors these for `.waygoal-node`. */
export const NODE_WIDTH = 250;
export const NODE_HEIGHT = 140;

/** A ticket card carries the discussions held under it on chips right beneath
 *  it, so it takes up more of the canvas than a session card. The chips are one
 *  stack — show/hide, then each discussion, then the one that starts another —
 *  and every place that lays one out or measures the stack counts it here. */
export const CHIP_HEIGHT = 30;
/** Where a ticket card ends and its chip stack begins. */
export const TICKET_CHIP_TOP = 152;
/** Top of the chip in slot `index` of that stack, relative to the card. */
export const ticketChipTop = (index: number): number => TICKET_CHIP_TOP + index * CHIP_HEIGHT;
/** How tall a ticket showing this many discussions actually is. */
export const ticketCardHeight = (discussions: number): number => ticketChipTop(discussions + 2);
/** Room a ticket reserves when the canvas first places it. Past that the chips
 *  run on, the same as any card the user drags under another. */
export const TICKET_CARD_HEIGHT = ticketCardHeight(4);

/** One ticket read from a local Markdown tracker file. The file is the record;
 *  Waygoal keeps no second copy of the text. */
export interface WaygoalTicketNode {
  /** Workspace-relative path of the source file — its identity in this
   *  workspace, so the same number under two maps stays two tickets. */
  id: string;
  path: string;
  mapPath: string;
  number: string;
  title: string;
  type: string;
  status: string;
  question: string;
  answer: string;
  /** The source file, unchanged: the full view shows this, not a retelling. */
  body: string;
  /** Numbers as the `Blocked by:` line spells them, before they are matched.
   *  Settling them needs the whole map as the canvas is showing it, so the
   *  relations themselves live on the view, not here. */
  rawBlockers: string[];
}

export interface WaygoalTicketBlocker {
  number: string;
  /** The ticket this names; null when the map has no single ticket with it. */
  path: string | null;
  status: string | null;
  /** Why this premise still holds, or null when the source says it is resolved.
   *  Only `resolved` releases what waited on it: `waiting` is still being
   *  worked on, `cancelled` was dropped without an answer, and the last three
   *  mean the relation itself could not be read. None of them is a premise
   *  that was met. */
  holding: "waiting" | "cancelled" | "missing" | "ambiguous" | "unreadable" | null;
}

/** A relation Waygoal cannot settle by reading: the source has to say what it
 *  means now, and until it does the ticket keeps waiting. */
export const needsCheck = (blocker: WaygoalTicketBlocker): boolean =>
  blocker.holding !== null && blocker.holding !== "waiting";

/** Whether Waygoal can actually take the user to the place a source names.
 *  Only these two become a way in; the rest are said and left as said. */
export const canOpen = (reference: WaygoalReference): boolean =>
  reference.kind === "ticket" || reference.kind === "file";

/** Where a ticket stands, settled over everything the canvas is showing.
 *  `waiting` is held by a premise, `unblocked` has every premise it named met,
 *  and the other two are the source's own conclusion about the ticket itself. */
export type WaygoalTicketState = "waiting" | "unblocked" | "resolved" | "cancelled";

export interface WaygoalTicketMap {
  path: string;
  title: string;
  body: string;
  tickets: WaygoalTicketNode[];
  /** Ticket files that are there but could not be read, named rather than dropped. */
  unreadable: WaygoalUnreadable[];
  warnings: string[];
}

/** A path Waygoal found but could not turn into content, with the real reason. */
export interface WaygoalUnreadable {
  path: string;
  reason: string;
}

export interface WaygoalTicketScan {
  /** The working directory this was read from; the references are settled
   *  against it, so it travels with the scan. */
  cwd: string;
  maps: WaygoalTicketMap[];
  /** Directories under `.scratch/` that are not the supported layout. */
  unsupported: WaygoalUnreadable[];
  /** Maps in the supported layout whose own file could not be read this time. */
  unreadable: WaygoalUnreadable[];
  readAt: string;
}

/** What the canvas keeps between reads: the last content each source file was
 *  successfully read as. It is a cache of the file, never a second record of
 *  the work — a live file always wins over it. */
export interface WaygoalSavedTickets {
  maps: Record<string, { title: string; body: string; readAt: string }>;
  tickets: Record<string, WaygoalTicketNode & { readAt: string }>;
}

/** Why what is on display is not what the file says right now. */
export interface WaygoalStale {
  reason: string;
  /** When the shown content was last read successfully. */
  lastReadAt: string;
  /** When Waygoal last tried and could not. */
  checkedAt: string;
}

export interface WaygoalTicketView extends WaygoalTicketNode {
  stale: WaygoalStale | null;
  /** Each `Blocked by:` reference, settled against this map's own tickets. */
  blockers: WaygoalTicketBlocker[];
  blocked: boolean;
  state: WaygoalTicketState;
  /** Where this ticket says to go, settled against this working directory. */
  references: WaygoalReference[];
}

/** One `##` section of a source file, as that file wrote it. */
export interface WaygoalMapSection {
  heading: string;
  body: string;
}

/** A place a source file explicitly points at, as it wrote it. */
export interface WaygoalSourceLink {
  label: string;
  target: string;
  /** A URL. It is shown as written and never fetched. */
  external: boolean;
}

/** One of those places, settled against this working directory. `ticket` and
 *  `file` can be opened; `missing` is a place the source names that cannot be
 *  reached — said so rather than swapped for something that looks like it. */
export interface WaygoalReference extends WaygoalSourceLink {
  kind: "ticket" | "file" | "missing" | "external";
  /** Workspace-relative, for `ticket` and `file`; null otherwise. */
  path: string | null;
}

export interface WaygoalTicketMapView extends Omit<WaygoalTicketMap, "tickets"> {
  tickets: WaygoalTicketView[];
  stale: WaygoalStale | null;
  /** What the file says before its first `##`, kept out of the sections
   *  rather than filed under a heading the source never wrote. */
  lead: string;
  /** The map's own `##` sections, as the file wrote them. */
  sections: WaygoalMapSection[];
  /** Where this file says to go, settled against this working directory. */
  references: WaygoalReference[];
}

/** One discussion held under a ticket: a real Pi session, named as the canvas
 *  names it. A discussion the record still points at but that no longer exists
 *  is kept and marked, never swapped for another one. */
export interface WaygoalTicketDiscussion {
  sessionId: string;
  title: string;
  running: boolean;
  missing: boolean;
  /** The discussion this one was forked from, when it was. */
  originSessionId: string | null;
}

export interface WaygoalTicketCard extends WaygoalTicketView {
  position: WaygoalPoint;
  /** Set on the one snapshot that first sees this ticket stop waiting, so the
   *  canvas can light it once. Every later snapshot, and a restarted host,
   *  leaves it false: the state itself is what keeps saying it can be worked on. */
  justUnblocked: boolean;
  discussions: WaygoalTicketDiscussion[];
  /** Whether this ticket's discussions are shown under it on the canvas. */
  expanded: boolean;
  lastDiscussion: WaygoalTicketPlace | null;
}
export interface WaygoalTicketMapCard extends Omit<WaygoalTicketMapView, "tickets"> {
  tickets: WaygoalTicketCard[];
  position: WaygoalPoint;
  /** Set when this map's whole ticket set was read complete and is now closed.
   *  Null the rest of the time, including when the read was not complete. */
  check: WaygoalMapCheck | null;
}

/** The moment a map's tickets are all closed: a prompt to check the map
 *  against its own Destination, not a claim that the map is finished.
 *  Cancelled tickets count towards the timing and towards nothing else, so
 *  how many there are is said rather than folded in. */
export interface WaygoalMapCheck {
  cancelled: number;
  dismissed: boolean;
}

/** What `GET /api/waygoal` answers: the sessions of one workspace and the
 *  local tickets read from its own files, in one read so the canvas lays both
 *  out together. */
/** A working directory that was opened before, and whether it is still there. */
export interface WaygoalRecentWorkspace {
  cwd: string;
  missing: boolean;
}

/** The working directory this canvas is in, and the canvases it has. */
export interface WaygoalWorkspaceView {
  cwd: string;
  canvasId: string;
  canvases: WaygoalCanvasInfo[];
  /** Working directories opened before, most recent first. */
  recent: WaygoalRecentWorkspace[];
}

export interface WaygoalSnapshotResponse extends WaygoalSnapshot {
  tickets: WaygoalTicketSnapshot;
  workspace: WaygoalWorkspaceView;
}

export interface WaygoalTicketSnapshot {
  maps: WaygoalTicketMapCard[];
  unsupported: WaygoalUnreadable[];
  unreadable: WaygoalUnreadable[];
  readAt: string;
}

/** One board inside a working directory. The id is what everything else
 *  points at; the name is only what it is called. */
export interface WaygoalCanvasInfo {
  id: string;
  name: string;
  createdAt: string;
}

/** What a working directory has: its canvases, the one it was left on, and
 *  which canvas each session belongs to. */
export interface WaygoalWorkspaceRecord {
  version: 1;
  cwd: string;
  canvases: WaygoalCanvasInfo[];
  current: string;
  /** Session id → canvas id. A session is on exactly one canvas. */
  sessionCanvas: Record<string, string>;
  updatedAt: string;
}

/** One working directory and one canvas in it: what a read or a write is
 *  about. */
export interface WaygoalScope {
  cwd: string;
  canvasId: string;
  agentDir: string;
}

/** The canvas every working directory starts with. Its id is fixed, so the
 *  record written before there was more than one canvas is still that
 *  canvas's record and there is nothing to migrate. */
export const DEFAULT_CANVAS_ID = "main";
