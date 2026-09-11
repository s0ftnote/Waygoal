import type { SessionTreeNode } from "./types";

/** One continuation available at a branch point. */
export interface WaygoalBranchChoice {
  /** The path's first visible node — the last entry of a contracted chain, so
   *  it identifies the path for display, not a position to navigate to. */
  entryId: string;
  /** Deepest entry on this path — where continuing here lands the active leaf.
   *  Continuing must use this, never `entryId`: Pi moves the leaf to a user
   *  entry's parent and puts its text back in the editor. */
  leafId: string;
  preview: string;
  role?: "user" | "assistant";
  /** Entries below the branch point, contracted ones included. */
  steps: number;
  /** The session's active leaf lies on this path. */
  active: boolean;
}

/** What `GET /api/waygoal/session/[id]` answers: one session's real branch
 *  structure. Shared so the route and the canvas cannot drift apart. */
export interface WaygoalSessionTreeResponse {
  sessionId: string;
  activeLeafId: string | null;
  branchPoints: WaygoalBranchPoint[];
  /** Only present when the request asked about a specific entry. */
  entryFound?: boolean;
}

export interface WaygoalBranchPoint {
  /** The shared entry the paths diverge from; null when the session has several
   *  roots, i.e. a branch was taken at the very first message. */
  entryId: string | null;
  preview: string;
  choices: WaygoalBranchChoice[];
}

function previewOf(node: SessionTreeNode): { preview: string; role?: "user" | "assistant" } {
  if (node.branchPreview) {
    return { preview: node.branchPreview.text, ...(node.branchPreview.role ? { role: node.branchPreview.role } : {}) };
  }
  return { preview: node.entry.type };
}

/** Visible ancestors of `entryId`, ending with the node that holds it. A
 *  contracted entry resolves to the visible node that swallowed it. Empty when
 *  the entry is not in this tree — callers must not fall back to a guess. */
export function pathToEntry(nodes: SessionTreeNode[], entryId: string | null): string[] {
  if (!entryId) return [];
  // Iterative: a linear session is a chain as deep as its entry count, so
  // recursion would overflow the stack (same reason as BranchNavigator).
  const stack: { node: SessionTreeNode; path: string[] }[] = nodes.map(node => ({ node, path: [node.entry.id] }));
  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    if (node.entry.id === entryId || node.compressedEntryIds?.includes(entryId)) return path;
    for (const child of node.children) stack.push({ node: child, path: [...path, child.entry.id] });
  }
  return [];
}

/** Deepest entry reachable from `node`, following the first child each time. */
function firstLeaf(node: SessionTreeNode): { leafId: string; steps: number } {
  let current = node;
  let steps = current.compressedEntryIds?.length ?? 0;
  while (current.children.length > 0) {
    current = current.children[0];
    steps += 1 + (current.compressedEntryIds?.length ?? 0);
  }
  return { leafId: current.entry.id, steps };
}

/** Every real branch point in one Pi session tree, outermost first. Reading
 *  only: nothing here navigates, sends or writes. */
export function collectBranchPoints(nodes: SessionTreeNode[], activeLeafId: string | null): WaygoalBranchPoint[] {
  const activePath = new Set(pathToEntry(nodes, activeLeafId));
  const toChoice = (child: SessionTreeNode): WaygoalBranchChoice => ({
    entryId: child.entry.id,
    ...firstLeaf(child),
    ...previewOf(child),
    active: activePath.has(child.entry.id),
  });

  const points: WaygoalBranchPoint[] = [];
  if (nodes.length > 1) points.push({ entryId: null, preview: "会话开头", choices: nodes.map(toChoice) });

  const queue = [...nodes];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.children.length > 1) {
      points.push({ entryId: node.entry.id, ...previewOf(node), choices: node.children.map(toChoice) });
    }
    for (const child of node.children) queue.push(child);
  }
  return points;
}
