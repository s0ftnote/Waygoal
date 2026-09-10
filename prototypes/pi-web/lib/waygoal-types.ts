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

export interface WaygoalCanvasPatch {
  positions?: Record<string, WaygoalPoint>;
  view?: WaygoalView;
  lastViewed?: string | null;
  lastViewedEntry?: string | null;
  origin?: { sessionId: string; originSessionId: string; originEntryId: string };
}

/** Node card size in canvas units; waygoal.css mirrors these for `.waygoal-node`. */
export const NODE_WIDTH = 250;
export const NODE_HEIGHT = 140;

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

export interface WaygoalTicketCard extends WaygoalTicketView { position: WaygoalPoint }
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
