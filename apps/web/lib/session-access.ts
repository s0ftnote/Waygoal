import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession, accessSessionManager } from "./rpc-manager";
import { invalidateSessionListCache, resolveSessionPath } from "./session-reader";

/** Wait for an in-progress SDK startup, then use its manager. Disk-only access
 * executes synchronously: no second writer can be created across an await. */
export async function accessSession<T>(id: string, readOrWrite: (manager: SessionManager, live: ReturnType<typeof getRpcSession>) => T): Promise<T | null> {
  const file = await resolveSessionPath(id);
  return accessSessionManager(id, file, readOrWrite);
}
export function nameVersion(manager: SessionManager): string | null {
  return manager.getEntries().findLast(entry => entry.type === "session_info")?.id ?? null;
}
export async function renameSession(id: string, name: string, expectedVersion?: string | null): Promise<boolean> {
  const result = await accessSession(id, (manager, live) => {
    if (expectedVersion !== undefined && nameVersion(manager) !== expectedVersion) throw new Error("名称已更新，未覆盖你刚修改的名字。");
    // Naming is a synchronous metadata append, safe between streamed entries.
    if (live) live.inner.setSessionName(name.trim()); else manager.appendSessionInfo(name.trim());
    invalidateSessionListCache();
    return true;
  });
  return result ?? false;
}
