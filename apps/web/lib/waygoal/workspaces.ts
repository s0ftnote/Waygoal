import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "../atomic-file";
import { readRecord, waygoalRoot, workspaceDir } from "./dirs";
import { DEFAULT_CANVAS_ID, type WaygoalCanvasInfo, type WaygoalRecentWorkspace, type WaygoalScope, type WaygoalWorkspaceRecord } from "./types";

const DEFAULT_CANVAS_NAME = "主画布";

const now = () => new Date().toISOString();

/** A canvas is identified by an id it keeps for life; the name is only what
 *  it is called, and two canvases may well be called the same thing. */
const newCanvasId = () => `c-${randomBytes(6).toString("hex")}`;

const defaultCanvas = (): WaygoalCanvasInfo => ({ id: DEFAULT_CANVAS_ID, name: DEFAULT_CANVAS_NAME, createdAt: new Date(0).toISOString() });

function workspacePath(cwd: string, agentDir: string): string {
  return join(workspaceDir(cwd, agentDir), "workspace.json");
}

const isCanvas = (value: unknown): value is WaygoalCanvasInfo => {
  const canvas = value as Partial<WaygoalCanvasInfo> | undefined;
  return Boolean(canvas && typeof canvas.id === "string" && /^[\w-]{1,64}$/.test(canvas.id) && typeof canvas.name === "string");
};

/** The canvas a request names, or an error naming it. Being shown another
 *  canvas without being told is worse than being told. */
function requireCanvas(record: WaygoalWorkspaceRecord, canvasId: string): WaygoalCanvasInfo {
  const canvas = record.canvases.find(known => known.id === canvasId);
  if (!canvas) throw new Error(`这个工作目录里没有这张画布：${canvasId}`);
  return canvas;
}

function emptyWorkspace(cwd: string): WaygoalWorkspaceRecord {
  return { version: 1, cwd, canvases: [defaultCanvas()], current: DEFAULT_CANVAS_ID, sessionCanvas: {}, updatedAt: new Date(0).toISOString() };
}

/** What canvases this working directory has, and which one it was left on.
 *  A directory nobody has opened yet already has its one canvas: reading is
 *  not what creates it, and reading twice does not create a second. */
export function readWorkspaceRecord(cwd: string, agentDir = getAgentDir()): WaygoalWorkspaceRecord {
  const path = workspacePath(cwd, agentDir);
  return readRecord<WaygoalWorkspaceRecord, WaygoalWorkspaceRecord>(path, parsed => {
    const canvases: WaygoalCanvasInfo[] = [];
    for (const canvas of parsed.canvases ?? []) {
      if (isCanvas(canvas) && !canvases.some(known => known.id === canvas.id)) {
        canvases.push({ id: canvas.id, name: canvas.name, createdAt: typeof canvas.createdAt === "string" ? canvas.createdAt : new Date(0).toISOString() });
      }
    }
    if (canvases.length === 0) canvases.push(defaultCanvas());
    const has = (id: unknown) => typeof id === "string" && canvases.some(canvas => canvas.id === id);
    const sessionCanvas: Record<string, string> = {};
    for (const [sessionId, canvasId] of Object.entries(parsed.sessionCanvas ?? {})) if (sessionId && has(canvasId)) sessionCanvas[sessionId] = canvasId;
    return {
      version: 1,
      cwd,
      canvases,
      current: has(parsed.current) ? (parsed.current as string) : canvases[0].id,
      sessionCanvas,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  }, () => emptyWorkspace(cwd));
}

function writeWorkspaceRecord(record: WaygoalWorkspaceRecord, agentDir: string): void {
  mkdirSync(workspaceDir(record.cwd, agentDir), { recursive: true });
  writePrivateFileAtomicSync(workspacePath(record.cwd, agentDir), JSON.stringify({ ...record, updatedAt: now() }, null, 2));
}

/** Where a request is to be read and written: one working directory and one
 *  canvas in it. Reading a canvas is also what says this directory is now
 *  stopped on it. */
export function scopeFor(cwd: string, canvasId: string | null | undefined, agentDir = getAgentDir()): WaygoalScope {
  const record = readWorkspaceRecord(cwd, agentDir);
  const wanted = canvasId?.trim() || null;
  const current = wanted ? requireCanvas(record, wanted).id : record.current;
  if (record.current !== current || !existsSync(workspacePath(cwd, agentDir))) writeWorkspaceRecord({ ...record, current }, agentDir);
  return { cwd, canvasId: current, agentDir };
}

/** Another board in the same working directory. Making one does not by itself
 *  change which canvas this directory is stopped on, and nothing is moved onto
 *  it: a new canvas has no chats of its own. (The button that makes one does
 *  then take the user there, which is a separate step it asks for.) */
export function addCanvas(cwd: string, name: string, agentDir = getAgentDir()): WaygoalCanvasInfo {
  const record = readWorkspaceRecord(cwd, agentDir);
  const canvas: WaygoalCanvasInfo = { id: newCanvasId(), name: name.trim() || "新画布", createdAt: now() };
  writeWorkspaceRecord({ ...record, canvases: [...record.canvases, canvas] }, agentDir);
  return canvas;
}

/** Put a session on the canvas this scope names, taking it off whichever one
 *  it was on. */
export function registerSession(scope: WaygoalScope, sessionId: string): void {
  const record = readWorkspaceRecord(scope.cwd, scope.agentDir);
  requireCanvas(record, scope.canvasId);
  if (record.sessionCanvas[sessionId] === scope.canvasId) return;
  writeWorkspaceRecord({ ...record, sessionCanvas: { ...record.sessionCanvas, [sessionId]: scope.canvasId } }, scope.agentDir);
}

/** Which of these sessions belong on the canvas this scope names — and, when
 *  that is the first canvas, taking in the ones nobody has placed. Only the
 *  first canvas takes them in: everything that was here before there was a
 *  second canvas stays where it was, and a new canvas has no chats instead of
 *  collecting the whole directory. A session started from another canvas says
 *  so itself (`registerSession`). Writing is part of the answer, which is why
 *  the name says claim. */
export function claimSessionsOn(scope: WaygoalScope, sessionIds: string[]): string[] {
  const record = readWorkspaceRecord(scope.cwd, scope.agentDir);
  const home = record.canvases[0].id;
  const placed = { ...record.sessionCanvas };
  if (scope.canvasId === home) {
    let added = false;
    for (const sessionId of sessionIds) if (!placed[sessionId]) { placed[sessionId] = home; added = true; }
    if (added) writeWorkspaceRecord({ ...record, sessionCanvas: placed }, scope.agentDir);
  }
  return sessionIds.filter(sessionId => placed[sessionId] === scope.canvasId);
}

function recentPath(agentDir: string): string {
  return join(waygoalRoot(agentDir), "recent.json");
}

const stillThere = (cwd: string): boolean => {
  try { return statSync(realpathSync(cwd)).isDirectory(); } catch { return false; }
};

/** The working directories opened here, most recent first, each saying
 *  whether it is still there. One that has gone stays on the list and says so
 *  rather than quietly disappearing from it. */
export function recentWorkspaces(agentDir = getAgentDir()): WaygoalRecentWorkspace[] {
  return readRecent(agentDir).map(cwd => ({ cwd, missing: !stillThere(cwd) }));
}

/** The list as written, gone directories and all. */
function readRecent(agentDir: string): string[] {
  return readRecord<{ workspaces: unknown }, string[]>(recentPath(agentDir), parsed => {
    const list = Array.isArray(parsed.workspaces) ? parsed.workspaces : [];
    return list.filter((cwd): cwd is string => typeof cwd === "string");
  }, () => []);
}

/** The working directory this browser was last on, and whether it is still
 *  there. A directory that has gone is named, not replaced by another one. */
export function rememberedWorkspace(agentDir = getAgentDir()): WaygoalRecentWorkspace | null {
  const [last] = readRecent(agentDir);
  return last ? { cwd: last, missing: !stillThere(last) } : null;
}

const RECENT_LIMIT = 12;

export function rememberWorkspace(cwd: string, agentDir = getAgentDir()): void {
  const path = recentPath(agentDir);
  const list = readRecent(agentDir);
  // The canvas reads itself every couple of seconds; only actually moving to
  // another directory is worth writing down.
  if (list[0] === cwd) return;
  const next = [cwd, ...list.filter(entry => entry !== cwd)].slice(0, RECENT_LIMIT);
  mkdirSync(waygoalRoot(agentDir), { recursive: true });
  writePrivateFileAtomicSync(path, JSON.stringify({ version: 1, workspaces: next }, null, 2));
}
