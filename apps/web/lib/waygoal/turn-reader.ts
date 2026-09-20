import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { accessSession } from "../session-access";
import { getRpcSession } from "../rpc-manager";
import { resolveSessionPath } from "../session-reader";
import { forkBoundaries } from "./lineage";
import type { SessionEntry } from "../types";
import { projectTurns, type WaygoalTurns } from "./turns";

interface CachedTurns { version: string; data: WaygoalTurns; body: string; etag: string; weight: number }
// Retain projections, never SDK managers or raw messages. Both count and byte
// budgets matter: one huge history must not defeat the count limit.
const cache = new Map<string, CachedTurns>();
const MAX_WEIGHT = 16 * 1024 * 1024;
let cacheWeight = 0;
function forget(id: string) {
  const entry = cache.get(id);
  if (entry) { cacheWeight -= entry.weight; cache.delete(id); }
}
const preview = (text: string, limit: number) => text.length > limit ? `${text.slice(0, limit)}…` : text;

/** Fixed-size card previews; full history remains in Pi and material capture. */
export async function readTurnPayload(sessionId: string): Promise<CachedTurns | null> {
  const file = await resolveSessionPath(sessionId);
  const live = getRpcSession(sessionId);
  const manager = live?.isAlive() ? live.inner.sessionManager : null;
  let disk = "memory";
  try {
    if (file) { const stat = statSync(file, { bigint: true }); disk = `${file}:${stat.ino}:${stat.mtimeNs}:${stat.size}`; }
    else if (!manager) { forget(sessionId); return null; }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!manager) { forget(sessionId); return null; }
  }
  const boundaries = forkBoundaries(sessionId);
  const version = JSON.stringify([disk, manager?.getLeafId(), manager?.getEntries().length, [...boundaries].sort()]);
  const hit = cache.get(sessionId);
  if (hit?.version === version) { cache.delete(sessionId); cache.set(sessionId, hit); return hit; }
  const data = await accessSession(sessionId, manager => {
    const entries = manager.getEntries() as SessionEntry[];
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const result = projectTurns(sessionId, entries, manager.getLeafId(), boundaries);
    for (const turn of result.turns) {
      turn.fingerprint = createHash("sha256").update(JSON.stringify(turn.entryIds.map(id => byId.get(id)))).digest("hex");
      turn.question = preview(turn.question, 320);
      turn.answer = preview(turn.answer, 600);
    }
    return result;
  });
  forget(sessionId);
  if (!data) return null;
  const body = JSON.stringify(data);
  const entry = { version, data, body, etag: `"${createHash("sha256").update(body).digest("hex")}"`, weight: body.length * 6 };
  if (entry.weight <= MAX_WEIGHT) {
    while (cache.size >= 24 || cacheWeight + entry.weight > MAX_WEIGHT) forget(cache.keys().next().value!);
    cache.set(sessionId, entry); cacheWeight += entry.weight;
  }
  return entry;
}

/** Read only. Does not create an AgentSession or run tools. */
export async function readTurns(sessionId: string) {
  return (await readTurnPayload(sessionId))?.data ?? null;
}

/** Explicit full-text read for generating a takeaway, never for polling. */
export async function readFullTurn(sessionId: string, turnId: string) {
  return accessSession(sessionId, manager => {
    const entries = manager.getEntries() as SessionEntry[];
    const turn = projectTurns(sessionId, entries, manager.getLeafId(), forkBoundaries(sessionId)).turns.find(turn => turn.id === turnId);
    if (!turn) return null;
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    turn.fingerprint = createHash("sha256").update(JSON.stringify(turn.entryIds.map(id => byId.get(id)))).digest("hex");
    return turn;
  });
}
