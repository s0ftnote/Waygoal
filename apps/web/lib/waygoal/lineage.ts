import { forkFamily } from "./fork-family";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { writePrivateFileAtomicSync } from "../atomic-file";
import { waygoalRoot } from "./dirs";

export interface ForkOrigin {
  version: 1;
  childSessionId: string;
  parentSessionId: string;
  selectedEntryId: string;
  mode: "before" | "after";
  inheritedThroughEntryId: string | null;
  operationId: string;
  createdAt: string;
}
export const safeKey = (value: string) => createHash("sha256").update(value).digest("hex");
const directory = (agentDir?: string) => join(waygoalRoot(agentDir), "lineage");
const pathFor = (id: string, agentDir?: string) => join(directory(agentDir), `${safeKey(id)}.json`);
export function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export function readOrigin(id: string, agentDir?: string): ForkOrigin | null {
  const origin = readJson<ForkOrigin>(pathFor(id, agentDir));
  if (!origin) return null;
  if (origin.version !== 1 || origin.childSessionId !== id || !origin.parentSessionId || !origin.selectedEntryId || !["before", "after"].includes(origin.mode) || (origin.inheritedThroughEntryId !== null && typeof origin.inheritedThroughEntryId !== "string")) throw new Error(`分叉来源记录损坏：${id}`);
  return origin;
}
export function writeOrigin(origin: ForkOrigin, agentDir?: string): void {
  const previous = readOrigin(origin.childSessionId, agentDir);
  if (previous) {
    if (JSON.stringify(previous) !== JSON.stringify(origin)) throw new Error(`分叉来源冲突：${origin.childSessionId}`);
    return;
  }
  const seen = new Set([origin.childSessionId]);
  for (let id: string | undefined = origin.parentSessionId; id;) {
    if (seen.has(id)) throw new Error("分叉来源不能形成循环。");
    seen.add(id); id = readOrigin(id, agentDir)?.parentSessionId;
  }
  mkdirSync(directory(agentDir), { recursive: true });
  writePrivateFileAtomicSync(pathFor(origin.childSessionId, agentDir), JSON.stringify(origin));
}
export function listOrigins(agentDir?: string): ForkOrigin[] {
  let names: string[];
  try { names = readdirSync(directory(agentDir)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return names.filter(name => name.endsWith(".json")).map(name => {
    const value = readJson<ForkOrigin>(join(directory(agentDir), name));
    if (!value?.childSessionId || `${safeKey(value.childSessionId)}.json` !== name) throw new Error("分叉来源文件无效。");
    return readOrigin(value.childSessionId, agentDir)!;
  });
}

export function forkBoundaries(sessionId: string, agentDir?: string): Set<string> {
  const origins = listOrigins(agentDir);
  const family = forkFamily(origins.map(origin => [origin.childSessionId, origin.parentSessionId] as const), [sessionId]);
  return new Set(origins.flatMap(origin => family.has(origin.parentSessionId) && origin.inheritedThroughEntryId ? [origin.inheritedThroughEntryId] : []));
}
