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
  var __waygoalTreeCache: Map<string, { key: string; value: WaygoalSessionTree; weight: number }> | undefined;
}
function cache(): NonNullable<typeof globalThis.__waygoalTreeCache> {
  return globalThis.__waygoalTreeCache ??= new Map();
}

function project(sessionId: string, sm: { getTree(): unknown; getLeafId(): string | null }): WaygoalSessionTree {
  const tree = projectTreeForResponse(sm.getTree() as SessionTreeNode[]);
  const activeLeafId = sm.getLeafId();
  return { sessionId, activeLeafId, tree, branchPoints: collectBranchPoints(tree, activeLeafId) };
}

async function sourceFor(sessionId: string) {
  const rpc = getRpcSession(sessionId);
  if (rpc?.isAlive()) {
    const manager = rpc.inner.sessionManager;
    return { key: `${manager.getSessionFile()}:${manager.getLeafId()}:${manager.getEntries().length}`, manager };
  }
  const file = await resolveSessionPath(sessionId);
  if (!file) return null;
  try {
    const stat = statSync(file, { bigint: true });
    return { key: `${file}:${stat.ino}:${stat.mtimeNs}:${stat.size}`, file };
  } catch { return null; }
}

const MAX_TREE_WEIGHT = 16 * 1024 * 1024;
function remember(sessionId: string, key: string, value: WaygoalSessionTree) {
  const entries = cache();
  entries.delete(sessionId);
  const weight = JSON.stringify(value).length * 4;
  if (weight > MAX_TREE_WEIGHT) return;
  let total = [...entries.values()].reduce((sum, entry) => sum + (entry.weight ?? MAX_TREE_WEIGHT), 0);
  while (entries.size && (entries.size >= 24 || total + weight > MAX_TREE_WEIGHT)) {
    const id = entries.keys().next().value!;
    total -= entries.get(id)!.weight ?? MAX_TREE_WEIGHT; entries.delete(id);
  }
  entries.set(sessionId, { key, value, weight });
}

/** Full trees are retained only for requested path views, within a budget. */
export async function readSessionTree(sessionId: string): Promise<WaygoalSessionTree | null> {
  const source = await sourceFor(sessionId);
  if (!source) { cache().delete(sessionId); return null; }
  const hit = cache().get(sessionId);
  if (hit?.key === source.key) { cache().delete(sessionId); cache().set(sessionId, hit); return hit.value; }
  try {
    const value = project(sessionId, source.manager ?? SessionManager.open(source.file!));
    remember(sessionId, source.key, value);
    return value;
  } catch {
    cache().delete(sessionId);
    return null;
  }
}

// A canvas overview needs two scalar fields, not retained trees and messages.
const summaries = new Map<string, { key: string; info: WaygoalTreeInfo }>();
export async function readTreeInfos(sessionIds: string[]): Promise<Map<string, WaygoalTreeInfo>> {
  const infos = new Map<string, WaygoalTreeInfo>();
  for (const id of sessionIds) {
    try {
      const source = await sourceFor(id);
      if (!source) { summaries.delete(id); continue; }
      let summary = summaries.get(id);
      if (summary?.key !== source.key) {
        const tree = project(id, source.manager ?? SessionManager.open(source.file!));
        summary = { key: source.key, info: { activeLeafId: tree.activeLeafId, branchPointCount: tree.branchPoints.length } };
      }
      summaries.delete(id); summaries.set(id, summary);
      while (summaries.size > 2048) summaries.delete(summaries.keys().next().value!);
      infos.set(id, summary.info);
    } catch { summaries.delete(id); }
  }
  return infos;
}
