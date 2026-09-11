import { realpathSync } from "node:fs";
import { isExistingPathWithinRoots } from "./path-security";

/** One local ticket file as written: its number from the file name, its
 *  title, type and status from the body, and the numbers it waits on. */
export interface BeaconTicket {
  id: string; number: string; title: string; type: string; status: string;
  question: string; answer: string; blockers: string[]; blocked: boolean;
}
/** The real path of a tracker file, or a throw when it is not inside this
 *  working directory. Containment is decided by pi-web's one path boundary
 *  (lib/path-security.ts), after both sides are resolved through symlinks. */
export function safePath(cwd: string, path: string): string {
  const resolved = realpathSync(path);
  if (!isExistingPathWithinRoots(resolved, new Set([cwd]))) throw new Error("地图文件必须位于工作目录内");
  return resolved;
}
export function section(body: string, name: string): string {
  return body.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "mi"))?.[1]?.trim() ?? "";
}
function field(body: string, name: string): string {
  return body.match(new RegExp(`^(?:\\*\\*)?${name}:(?:\\*\\*)?\\s*([^\\n]*)`, "mi"))?.[1]?.trim() ?? "";
}
/** The numbers a `Blocked by:` line names, as written — `01, 09` in a local
 *  ticket, `#3, #5` in a tracker body — before they are matched to tickets. */
export function blockedByLine(body: string): string[] {
  return (field(body, "Blocked by").match(/\d+/g) ?? []).map(n => String(Number(n)));
}
export function parseTicket(id: string, body: string): BeaconTicket {
  const number = id.split("/").at(-1)!.match(/^\d+/)?.[0] ?? id;
  return { id, number, title: body.match(/^# (.+)$/m)?.[1] ?? id,
    type: field(body, "Type") || "grilling", status: field(body, "Status").toLowerCase() || "open",
    question: section(body, "Question"), answer: section(body, "Answer"),
    blockers: blockedByLine(body), blocked: false };
}
