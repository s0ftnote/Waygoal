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
