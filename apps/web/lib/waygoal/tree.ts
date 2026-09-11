import { statSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { projectTreeForResponse } from "../project-tree";
import { getRpcSession } from "../rpc-manager";
import { resolveSessionPath } from "../session-reader";
import type { SessionTreeNode } from "../types";
import { collectBranchPoints, type WaygoalBranchPoint } from "./branches";
import type { WaygoalTreeInfo } from "./types";

export interface WaygoalSessionTree {
  sessionId: string;
  /** Where this session continues right now — Pi's active leaf. */
  activeLeafId: string | null;
  tree: SessionTreeNode[];
  branchPoints: WaygoalBranchPoint[];
}

// Reading a tree parses the whole session file, and the canvas polls. Cache by
// file identity so an unchanged session is one statSync. globalThis survives
// Next.js hot reload, the same reason rpc-manager uses it.
declare global {
  var __waygoalTreeCache: Map<string, { key: string; value: WaygoalSessionTree }> | undefined;
}
function cache(): NonNullable<typeof globalThis.__waygoalTreeCache> {
  return globalThis.__waygoalTreeCache ??= new Map();
}

function project(sessionId: string, sm: { getTree(): unknown; getLeafId(): string | null }): WaygoalSessionTree {
  const tree = projectTreeForResponse(sm.getTree() as SessionTreeNode[]);
  const activeLeafId = sm.getLeafId();
  return { sessionId, activeLeafId, tree, branchPoints: collectBranchPoints(tree, activeLeafId) };
}

/** The real Pi tree for one session. Read-only: it opens the session file (or
 *  reuses a live AgentSession's manager) and never navigates, sends or writes. */
export async function readSessionTree(sessionId: string): Promise<WaygoalSessionTree | null> {
  const rpc = getRpcSession(sessionId);
  if (rpc?.isAlive()) return project(sessionId, rpc.inner.sessionManager);

  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;
  let key: string;
  try {
    const stat = statSync(filePath);
    key = `${filePath}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
  const hit = cache().get(sessionId);
  if (hit?.key === key) return hit.value;
  try {
    const value = project(sessionId, SessionManager.open(filePath));
    cache().set(sessionId, { key, value });
    return value;
  } catch {
    // A half-written or malformed session must not take the canvas down; it
    // simply shows no branches until it reads cleanly.
    return null;
  }
}

/** Branch counts and active leaves for the canvas snapshot. Sessions that fail
 *  to read are left out rather than reported as branchless. */
export async function readTreeInfos(sessionIds: string[]): Promise<Map<string, WaygoalTreeInfo>> {
  const infos = new Map<string, WaygoalTreeInfo>();
  const trees = await Promise.all(sessionIds.map(id => readSessionTree(id).catch(() => null)));
  for (const tree of trees) {
    if (tree) infos.set(tree.sessionId, { activeLeafId: tree.activeLeafId, branchPointCount: tree.branchPoints.length });
  }
  return infos;
}
