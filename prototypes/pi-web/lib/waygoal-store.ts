import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { projectIdentityKey } from "./project-identity";
import type { SessionInfo } from "./types";
import { NODE_HEIGHT, NODE_WIDTH, type WaygoalCanvasPatch, type WaygoalCanvasRecord, type WaygoalNode, type WaygoalNodeOrigin, type WaygoalOriginRecord, type WaygoalPoint, type WaygoalSnapshot, type WaygoalTitleSource, type WaygoalTreeInfo } from "./waygoal-types";
export { NODE_HEIGHT, NODE_WIDTH };

// Records live under Pi's agent directory, apart from the plugin code, and
// are split per workspace from the start (ADR 0001). Nothing here sends
// messages or touches Pi session files.
export function waygoalRoot(agentDir = getAgentDir()): string {
  return join(agentDir, "waygoal");
}

export function workspaceId(cwd: string): string {
  const key = projectIdentityKey(cwd);
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 12);
  const label = basename(key).replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace";
  return `${label}-${hash}`;
}

export function workspaceDir(cwd: string, agentDir = getAgentDir()): string {
  return join(waygoalRoot(agentDir), "workspaces", workspaceId(cwd));
}

function recordPath(cwd: string, agentDir: string): string {
  return join(workspaceDir(cwd, agentDir), "canvas.json");
}

export function normalizeWorkspaceInput(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

/** Resolve the workspace to show: an explicit `cwd`, else the playground
 *  sample directory shipped with the repository. Remembering and switching
 *  workspaces belongs to a later ticket. */
export function resolveWorkspaceCwd(input?: string | null): string {
  const explicit = input?.trim() ? normalizeWorkspaceInput(input) : null;
  const candidate = explicit ?? resolve(process.cwd(), "../../playground");
  try {
    const real = realpathSync(candidate);
    if (statSync(real).isDirectory()) return real;
  } catch { /* fall through */ }
  throw new Error(explicit ? `这个目录不存在：${input}` : "请选择一个工作目录");
}

function emptyRecord(cwd: string): WaygoalCanvasRecord {
  return { version: 1, cwd, nodes: {}, origins: {}, updatedAt: new Date(0).toISOString() };
}

function isOrigin(value: unknown): value is WaygoalOriginRecord {
  const origin = value as WaygoalOriginRecord;
  return Boolean(origin) && typeof origin.sessionId === "string" && Boolean(origin.sessionId)
    && typeof origin.entryId === "string" && Boolean(origin.entryId);
}

function isPoint(value: unknown): value is WaygoalPoint {
  return Boolean(value) && typeof (value as WaygoalPoint).x === "number" && typeof (value as WaygoalPoint).y === "number"
    && Number.isFinite((value as WaygoalPoint).x) && Number.isFinite((value as WaygoalPoint).y);
}

export function readCanvasRecord(cwd: string, agentDir = getAgentDir()): WaygoalCanvasRecord {
  const path = recordPath(cwd, agentDir);
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

export function writeCanvasRecord(record: WaygoalCanvasRecord, agentDir = getAgentDir()): void {
  mkdirSync(workspaceDir(record.cwd, agentDir), { recursive: true });
  writePrivateFileAtomicSync(recordPath(record.cwd, agentDir), JSON.stringify(record, null, 2));
}

export function applyCanvasPatch(cwd: string, patch: WaygoalCanvasPatch, agentDir = getAgentDir()): WaygoalCanvasRecord {
  const record = readCanvasRecord(cwd, agentDir);
  let changed = false;
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
    changed = true;
  }
  if (changed) {
    record.updatedAt = new Date().toISOString();
    writeCanvasRecord(record, agentDir);
  }
  return record;
}

const GRID_X = NODE_WIDTH + 70;
const GRID_Y = NODE_HEIGHT + 60;
const GRID_COLUMNS = 3;

/** First free grid cell that does not overlap a saved node. */
export function nextFreePosition(taken: Iterable<WaygoalPoint>): WaygoalPoint {
  const points = [...taken];
  for (let index = 0; ; index++) {
    const candidate = { x: (index % GRID_COLUMNS) * GRID_X, y: Math.floor(index / GRID_COLUMNS) * GRID_Y };
    const overlaps = points.some(p => Math.abs(p.x - candidate.x) < NODE_WIDTH + 20 && Math.abs(p.y - candidate.y) < NODE_HEIGHT + 20);
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
  cwd: string,
  sessions: SessionInfo[],
  runningIds: Iterable<string>,
  agentDir = getAgentDir(),
  trees: ReadonlyMap<string, WaygoalTreeInfo> = new Map(),
): WaygoalSnapshot {
  const running = new Set(runningIds);
  const record = readCanvasRecord(cwd, agentDir);
  const owned = workspaceSessions(cwd, sessions).sort((a, b) => a.created.localeCompare(b.created));
  const titles = new Map(owned.map(session => [session.id, sessionTitle(session).title]));
  let changed = false;
  const nodes: WaygoalNode[] = owned.map(session => {
    let position = record.nodes[session.id];
    if (!position) {
      position = nextFreePosition(Object.values(record.nodes));
      record.nodes[session.id] = position;
      changed = true;
    }
    return {
      id: session.id,
      ...sessionTitle(session),
      messageCount: session.messageCount,
      created: session.created,
      modified: session.modified,
      running: running.has(session.id),
      transient: Boolean(session.transient),
      position,
      origin: nodeOrigin(session, record, titles),
      branchPointCount: trees.get(session.id)?.branchPointCount ?? 0,
      activeLeafId: trees.get(session.id)?.activeLeafId ?? null,
    };
  });
  if (changed) {
    record.updatedAt = new Date().toISOString();
    writeCanvasRecord(record, agentDir);
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
  };
}
