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

export interface WaygoalSnapshot {
  cwd: string;
  workspaceId: string;
  nodes: WaygoalNode[];
  view: WaygoalView | null;
  lastViewed: string | null;
  lastViewedEntry: string | null;
  /** Set when the record points at a session that is no longer in this workspace. */
  lastViewedMissing: boolean;
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
  /** Numbers as the `Blocked by:` line spells them, before they are matched. */
  rawBlockers: string[];
  blockers: WaygoalTicketBlocker[];
  blocked: boolean;
}

export interface WaygoalTicketBlocker {
  number: string;
  /** The ticket this names; null when the map has no single ticket with it. */
  path: string | null;
  status: string | null;
  /** Why no relation could be established, instead of calling it unblocked. */
  unknown: "missing" | "ambiguous" | null;
}

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
}

export interface WaygoalTicketMapView extends Omit<WaygoalTicketMap, "tickets"> {
  tickets: WaygoalTicketView[];
  stale: WaygoalStale | null;
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
  discussions: WaygoalTicketDiscussion[];
  /** Whether this ticket's discussions are shown under it on the canvas. */
  expanded: boolean;
  lastDiscussion: WaygoalTicketPlace | null;
}
export interface WaygoalTicketMapCard extends Omit<WaygoalTicketMapView, "tickets"> {
  tickets: WaygoalTicketCard[];
  position: WaygoalPoint;
}

/** What `GET /api/waygoal` answers: the sessions of one workspace and the
 *  local tickets read from its own files, in one read so the canvas lays both
 *  out together. */
export interface WaygoalSnapshotResponse extends WaygoalSnapshot {
  tickets: WaygoalTicketSnapshot;
}

export interface WaygoalTicketSnapshot {
  maps: WaygoalTicketMapCard[];
  unsupported: WaygoalUnreadable[];
  unreadable: WaygoalUnreadable[];
  readAt: string;
}
