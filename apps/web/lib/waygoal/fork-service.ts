import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { lockSync } from "proper-lockfile";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "../atomic-file";
import { applyCanvasPatch, readCanvasRecord } from "./store";
import { registerSession, resolveScope } from "./workspaces";
import { samePath } from "../paths";
import { waygoalRoot } from "./dirs";
import { readJson, safeKey, writeOrigin, type ForkOrigin } from "./lineage";

export interface ForkCanvas { cwd: string; canvasId: string; position?: { x: number; y: number } }
interface ForkRequest { canvas?: ForkCanvas; selectedEntryId: string; mode: "before" | "after"; operationId?: string }
interface Operation {
  version: 1;
  request: ForkRequest & { operationId: string; sourceSessionId: string };
  sourceFile: string;
  sessionDir: string;
  source?: string;
  inheritedThroughEntryId: string | null;
  phase: "prepared" | "session-created" | "lineage-written" | "published";
  registered?: boolean;
  origin?: ForkOrigin;
  destination?: string;
}
export interface ForkResult { newSessionId: string; file: string; origin: ForkOrigin }

/** One synchronous critical section: no source manager is navigated or replaced.
 * Staging is outside Pi's scan tree; a crash can never publish an unrecorded fork.
 * Replaying the journal uses the frozen SDK input, not the parent's current leaf. */
export function createRecordedFork(manager: SessionManager, input: ForkRequest, agentDir?: string): ForkResult {
  const operationId = input.operationId ?? randomUUID();
  if (typeof operationId !== "string" || operationId.length < 8 || operationId.length > 200) throw new Error("Invalid fork operation ID");
  if (input.canvas && (!samePath(realpathSync(input.canvas.cwd), realpathSync(manager.getCwd())) || typeof input.canvas.canvasId !== "string")) throw new Error("分叉目标不在源工作区。");
  if (input.canvas) resolveScope(input.canvas.cwd, input.canvas.canvasId, agentDir);
  const request = { ...input, operationId, sourceSessionId: manager.getSessionId() };
  const directory = join(waygoalRoot(agentDir), "fork-operations", safeKey(operationId));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const unlock = lockSync(directory, { realpath: false, stale: 10_000 });
  try {
    const journal = join(directory, "operation.json");
    let operation = readJson<Operation>(journal);
    const save = () => writePrivateFileAtomicSync(journal, JSON.stringify(operation));
    if (operation && JSON.stringify(operation.request) !== JSON.stringify(request)) throw new Error("同一分叉操作不能更改来源或边界。");
    if (!operation) {
      const entry = manager.getEntry(input.selectedEntryId);
      if (!entry) throw new Error("Invalid entry ID for forking");
      const sourceFile = manager.getSessionFile();
      if (!sourceFile || !manager.isPersisted()) throw new Error("请先保存会话再分叉。");
      operation = { version: 1, request, sourceFile, sessionDir: manager.getSessionDir(),
        source: [manager.getHeader(), ...manager.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n",
        inheritedThroughEntryId: input.mode === "before" ? entry.parentId : entry.id, phase: "prepared" };
      save();
    }
    if (operation.phase === "prepared") {
      const source = join(directory, "source.jsonl");
      if (!existsSync(source)) {
        if (!operation.source) throw new Error("分叉来源快照缺失，请保留恢复记录。");
        writePrivateFileAtomicSync(source, operation.source);
      }
      // The staged file is now the recovery snapshot; journal polling must
      // never deserialize a second full copy of every completed conversation.
      delete operation.source;
      // Also recovers the crash window between SDK file creation and journal update.
      const staged = readdirSync(directory).filter(name => name.endsWith(".jsonl") && name !== "source.jsonl");
      if (staged.length > 1) throw new Error("分叉暂存文件冲突，请保留记录后修复。");
      let child: SessionManager;
      if (staged.length) child = SessionManager.open(join(directory, staged[0]), directory);
      else if (operation.inheritedThroughEntryId) {
        child = SessionManager.open(source, directory);
        child.createBranchedSession(operation.inheritedThroughEntryId);
      } else {
        child = SessionManager.create(manager.getCwd(), directory);
        child.newSession({ parentSession: operation.sourceFile });
      }
      const header = { ...child.getHeader()!, parentSession: operation.sourceFile };
      const file = child.getSessionFile()!;
      writePrivateFileAtomicSync(file, [header, ...child.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n");
      operation.origin = { version: 1, childSessionId: child.getSessionId(), parentSessionId: request.sourceSessionId,
        selectedEntryId: request.selectedEntryId, mode: request.mode, inheritedThroughEntryId: operation.inheritedThroughEntryId,
        operationId, createdAt: header.timestamp };
      operation.destination = join(operation.sessionDir, basename(file));
      operation.phase = "session-created"; save();
    }
    if (operation.phase === "session-created") {
      writeOrigin(operation.origin!, agentDir);
      operation.phase = "lineage-written"; save();
    }
    if (operation.phase === "lineage-written") {
      const staged = join(directory, basename(operation.destination!));
      // A retry after publication must never overwrite messages sent to the child.
      if (!existsSync(operation.destination!)) writePrivateFileAtomicSync(operation.destination!, readFileSync(staged, "utf8"));
      operation.phase = "published"; save();
    }
    if (SessionManager.open(operation.destination!).getSessionId() !== operation.origin!.childSessionId) throw new Error("分叉发布文件身份不一致。");
    if (operation.request.canvas && !operation.registered) {
      const canvas = operation.request.canvas;
      const scope = resolveScope(canvas.cwd, canvas.canvasId, agentDir);
      const id = operation.origin!.childSessionId;
      registerSession(scope, id);
      const saved = readCanvasRecord(scope);
      const ticket = saved.ticketSessions[operation.origin!.parentSessionId];
      applyCanvasPatch(scope, { ...(canvas.position && !saved.nodes[id] ? { positions: { [id]: canvas.position } } : {}), ...(ticket ? { ticketSession: { sessionId: id, ticket } } : {}) });
      operation.registered = true; save();
    }
    return { newSessionId: operation.origin!.childSessionId, file: operation.destination!, origin: operation.origin! };
  } finally { unlock(); }
}

/** Recover committed intent even when the browser disappeared after creating it. */
export function recoverForkOperations(agentDir?: string): void {
  const root = join(waygoalRoot(agentDir), "fork-operations");
  if (!existsSync(root)) return;
  for (const directory of readdirSync(root)) {
    const operation = readJson<Operation>(join(root, directory, "operation.json"));
    if (!operation) continue;
    if (operation.phase === "published" && (!operation.request.canvas || operation.registered)) {
      if (operation.source) {
        delete operation.source;
        writePrivateFileAtomicSync(join(root, directory, "operation.json"), JSON.stringify(operation));
      }
      continue;
    }
    const source = join(root, directory, "source.jsonl");
    if (!existsSync(source)) {
      if (!operation.source) throw new Error("分叉来源快照缺失，请保留恢复记录。");
      writePrivateFileAtomicSync(source, operation.source);
    }
    const manager = SessionManager.open(source, join(root, directory));
    try {
      const request: ForkRequest = { selectedEntryId: operation.request.selectedEntryId, mode: operation.request.mode, operationId: operation.request.operationId, ...(operation.request.canvas ? { canvas: operation.request.canvas } : {}) };
      createRecordedFork(manager, request, agentDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOCKED") continue;
      throw error;
    }
  }
}
