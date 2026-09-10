export interface WaygoalPoint { x: number; y: number }
export interface WaygoalView { x: number; y: number; scale: number }

/** Local canvas record for one workspace. Pi keeps the sessions; this only
 *  keeps identity, layout and the last viewed position. */
export interface WaygoalCanvasRecord {
  version: 1;
  cwd: string;
  nodes: Record<string, WaygoalPoint>;
  view?: WaygoalView;
  lastViewed?: string | null;
  updatedAt: string;
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
}

export interface WaygoalSnapshot {
  cwd: string;
  workspaceId: string;
  nodes: WaygoalNode[];
  view: WaygoalView | null;
  lastViewed: string | null;
  /** Set when the record points at a session that is no longer in this workspace. */
  lastViewedMissing: boolean;
}

export interface WaygoalCanvasPatch {
  positions?: Record<string, WaygoalPoint>;
  view?: WaygoalView;
  lastViewed?: string | null;
}

/** Node card size in canvas units; waygoal.css mirrors these for `.waygoal-node`. */
export const NODE_WIDTH = 250;
export const NODE_HEIGHT = 140;
