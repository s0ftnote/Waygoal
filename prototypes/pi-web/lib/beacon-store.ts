import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { homedir } from "node:os";
import { writePrivateFileAtomicSync } from "./atomic-file";
import type { BeaconBinding, BeaconSnapshot, BeaconTicket } from "./beacon-types";

export function beaconCwd(input?: string): string {
  const cwd = realpathSync(input ? resolve(input.replace(/^~(?=\/|$)/, homedir())) : resolve(process.cwd(), "../../playground"));
  if (!statSync(cwd).isDirectory()) throw new Error("请选择一个工作目录");
  return cwd;
}
export function safePath(cwd: string, path: string): string {
  const resolved = realpathSync(path);
  const rel = relative(realpathSync(cwd), resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("地图文件必须位于工作目录内");
  return resolved;
}
export function section(body: string, name: string): string {
  return body.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "mi"))?.[1]?.trim() ?? "";
}
function field(body: string, name: string): string {
  return body.match(new RegExp(`^(?:\\*\\*)?${name}:(?:\\*\\*)?\\s*([^\\n]*)`, "mi"))?.[1]?.trim() ?? "";
}
export function parseTicket(id: string, body: string): BeaconTicket {
  const number = id.split("/").at(-1)!.match(/^\d+/)?.[0] ?? id;
  return { id, number, title: body.match(/^# (.+)$/m)?.[1] ?? id,
    type: field(body, "Type") || "grilling", status: field(body, "Status").toLowerCase() || "open",
    question: section(body, "Question"), answer: section(body, "Answer"),
    blockers: (field(body, "Blocked by").match(/\d+/g) ?? []).map(n => String(Number(n))), blocked: false };
}
function bindingPath(cwd: string) {
  const folder = join(cwd, ".beacon-prototype");
  if (existsSync(folder)) safePath(cwd, folder);
  mkdirSync(folder, { recursive: true });
  const path = join(folder, "sessions.json");
  if (existsSync(path)) safePath(cwd, path);
  return path;
}
export function bindings(cwd: string): Record<string, BeaconBinding> {
  const path = bindingPath(cwd);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}
export function saveBinding(cwd: string, key: string, binding: BeaconBinding) {
  writePrivateFileAtomicSync(bindingPath(cwd), JSON.stringify({ ...bindings(cwd), [key]: binding }, null, 2));
}
export function beaconSnapshot(cwd: string): BeaconSnapshot {
  const saved = bindings(cwd);
  const scratch = join(cwd, ".scratch");
  if (!existsSync(scratch)) return { cwd, maps: [], origin: saved.origin };
  safePath(cwd, scratch);
  const maps = readdirSync(scratch, { withFileTypes: true }).filter(e => e.isDirectory()).flatMap(e => {
    const mapPath = join(scratch, e.name, "map.md");
    if (!existsSync(mapPath)) return [];
    const body = readFileSync(safePath(cwd, mapPath), "utf8");
    const issues = join(dirname(mapPath), "issues");
    if (existsSync(issues)) safePath(cwd, issues);
    const tickets = (existsSync(issues) ? readdirSync(issues).filter(f => /^\d+.*\.md$/.test(f)).sort() : []).map(f => {
      const id = relative(cwd, join(issues, f));
      return { ...parseTicket(id, readFileSync(safePath(cwd, join(issues, f)), "utf8")), binding: saved[id] };
    });
    for (const ticket of tickets) ticket.blocked = ticket.blockers.some(n => {
      const matches = tickets.filter(t => String(Number(t.number)) === n);
      return matches.length !== 1 || matches[0].status !== "resolved";
    });
    const warnings = [...new Set(tickets.map(t => String(Number(t.number))))].filter(n => tickets.filter(t => String(Number(t.number)) === n).length > 1).map(n => `票据编号 ${n} 重复，请让 Agent 修正后再继续依赖它的节点。`);
    return [{ id: relative(cwd, mapPath), title: body.match(/^# (.+)$/m)?.[1] ?? e.name,
      destination: section(body, "Destination"), fog: section(body, "Not yet specified"), tickets, warnings }];
  });
  return { cwd, maps, origin: saved.origin };
}
