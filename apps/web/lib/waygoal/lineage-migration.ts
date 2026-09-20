import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionInfo } from "../types";
import { writePrivateFileAtomicSync } from "../atomic-file";
import { waygoalRoot } from "./dirs";
import { readJson, readOrigin, safeKey, writeOrigin, type ForkOrigin } from "./lineage";

type Legacy = { sessionId: string; entryId: string; recordedAt: string };
export interface MigrationItem { childSessionId: string; status: "verified" | "missing" | "conflict"; origin?: ForkOrigin; files: string[] }
export function legacyOrigins(agentDir?: string) {
  const root = join(waygoalRoot(agentDir), "workspaces");
  const records = new Map<string, { origin: Legacy; files: string[]; conflict: boolean }>();
  if (!existsSync(root)) return records;
  for (const workspace of readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    for (const name of readdirSync(join(root, workspace.name)).filter(name => /^canvas(?:-.*)?\.json$/.test(name))) {
      const file = join(root, workspace.name, name);
      let canvas: { origins?: Record<string, Legacy> } | null;
      try { canvas = readJson(file); } catch (error) {
        // Legacy canvas corruption retains the existing view fallback. An
        // authoritative lineage read never uses this compatibility fallback.
        if (error instanceof SyntaxError) continue;
        throw error;
      }
      for (const [id, origin] of Object.entries(canvas?.origins ?? {})) {
        if (!origin?.sessionId || !origin.entryId) continue;
        const previous = records.get(id);
        records.set(id, { origin, files: [...(previous?.files ?? []), file], conflict: Boolean(previous && (previous.conflict || previous.origin.sessionId !== origin.sessionId || previous.origin.entryId !== origin.entryId)) });
      }
    }
  }
  for (const [id, candidate] of records) {
    const seen = new Set<string>();
    for (let current: string | undefined = id; current; current = records.get(current)?.origin.sessionId) {
      if (seen.has(current)) { candidate.conflict = true; break; }
      seen.add(current);
    }
  }
  return records;
}

/** Evidence-only migration. Never infer a boundary from a title or current leaf.
 * A dry run and a repeated migration leave every user's position untouched. */
export function migrateLegacyOrigins(sessions: Pick<SessionInfo, "id" | "path">[], apply = false, agentDir?: string): MigrationItem[] {
  const paths = new Map(sessions.map(session => [session.id, session.path]));
  const report: MigrationItem[] = [];
  const backup = join(waygoalRoot(agentDir), "lineage-backup-v1");
  for (const [id, candidate] of legacyOrigins(agentDir)) {
    if (readOrigin(id, agentDir)) continue;
    const item: MigrationItem = { childSessionId: id, status: candidate.conflict ? "conflict" : "missing", files: candidate.files };
    const sourcePath = paths.get(candidate.origin.sessionId), childPath = paths.get(id);
    if (!candidate.conflict && sourcePath && childPath && existsSync(sourcePath) && existsSync(childPath)) {
      const source = SessionManager.open(sourcePath), child = SessionManager.open(childPath);
      const selected = source.getEntry(candidate.origin.entryId);
      if (selected) {
        const mode = child.getEntry(selected.id) ? "after" : "before";
        const boundary = mode === "after" ? selected.id : selected.parentId;
        const inherited = boundary ? source.getBranch(boundary) : [];
        // Pi may re-chain metadata labels. Verify all retained entry content,
        // plus the retained parent path, without requiring recreated label IDs.
        const expected = inherited.filter(entry => entry.type !== "label");
        const copied = boundary && child.getEntry(boundary) ? child.getBranch(boundary).filter(entry => entry.type !== "label") : [];
        const signature = (entries: typeof expected) => JSON.stringify(entries.map(entry => ({ ...entry, parentId: null })));
        const header = child.getHeader();
        const declaredParent = header?.parentSession;
        const parentMatches = !declaredParent || declaredParent === sourcePath;
        if (parentMatches && (boundary === null || expected.length > 0) && signature(expected) === signature(copied)) {
          item.status = "verified";
          item.origin = { version: 1, childSessionId: id, parentSessionId: candidate.origin.sessionId,
            selectedEntryId: selected.id, mode, inheritedThroughEntryId: boundary,
            operationId: `migration:${safeKey(id)}`, createdAt: candidate.origin.recordedAt || header!.timestamp };
          if (apply) {
            mkdirSync(backup, { recursive: true, mode: 0o700 });
            for (const file of [...candidate.files, sourcePath, childPath]) {
              const destination = join(backup, safeKey(file));
              if (!existsSync(destination)) { copyFileSync(file, destination); chmodSync(destination, 0o600); }
            }
            writeOrigin(item.origin, agentDir);
          }
        } else item.status = "conflict";
      }
    }
    report.push(item);
  }
  if (apply && report.some(item => item.status === "verified")) {
    mkdirSync(backup, { recursive: true, mode: 0o700 });
    writePrivateFileAtomicSync(join(backup, "report.json"), JSON.stringify({ version: 1, items: report }));
  }
  return report;
}
