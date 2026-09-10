import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { parseTicket, safePath } from "./beacon-store";
import type { WaygoalSavedTickets, WaygoalTicketMap, WaygoalTicketMapView, WaygoalTicketNode, WaygoalTicketScan, WaygoalUnreadable } from "./waygoal-types";

/** The one layout this reads, as the local Markdown tracker documents it:
 *  `.scratch/<effort>/map.md` with one file per ticket under `issues/`. */
const MAP_FILE = "map.md";
const ISSUES_DIR = "issues";
const TICKET_FILE = /^\d+.*\.md$/;
export const UNSUPPORTED_REASON = "这里没有 map.md，Waygoal 只读 .scratch/<地图>/map.md 这一种本地布局。";

function readMap(cwd: string, dir: string): WaygoalTicketMap {
  const mapPath = join(dir, MAP_FILE);
  const body = readFileSync(safePath(cwd, mapPath), "utf8");
  const issues = join(dir, ISSUES_DIR);
  const files = existsSync(issues) ? readdirSync(safePath(cwd, issues)).filter(f => TICKET_FILE.test(f)).sort() : [];
  const unreadable: WaygoalUnreadable[] = [];
  const tickets: WaygoalTicketNode[] = files.flatMap(file => {
    const path = relative(cwd, join(issues, file));
    let parsed, body;
    try {
      body = readFileSync(safePath(cwd, join(issues, file)), "utf8");
      parsed = parseTicket(path, body);
    } catch (error) {
      // One unreadable file must not hide the tickets next to it, and it must
      // not disappear either: the map says which file could not be read.
      unreadable.push({ path, reason: error instanceof Error ? error.message : String(error) });
      return [];
    }
    return [{
      id: path,
      path,
      mapPath: relative(cwd, mapPath),
      number: parsed.number,
      title: parsed.title,
      type: parsed.type,
      status: parsed.status,
      question: parsed.question,
      answer: parsed.answer,
      body,
      rawBlockers: parsed.blockers,
      blockers: [],
      blocked: false,
    }];
  });
  resolveBlockers(tickets);
  return {
    path: relative(cwd, mapPath),
    title: body.match(/^# (.+)$/m)?.[1] ?? relative(cwd, dir),
    body,
    tickets,
    unreadable,
    warnings: duplicateWarnings(tickets),
  };
}

/** Numbers are written `01` but referred to as `1`; compare them as numbers and
 *  keep the file's own spelling for display. */
const sameNumber = (a: string, b: string) => Number(a) === Number(b);

/** A blocker names a ticket in the same map. Anything that does not resolve to
 *  exactly one ticket there is reported as unknown and keeps the ticket
 *  blocked — an unread relation is not an absent one. */
function resolveBlockers(tickets: WaygoalTicketNode[]): void {
  for (const ticket of tickets) {
    ticket.blockers = ticket.rawBlockers.map(number => {
      const matches = tickets.filter(t => sameNumber(t.number, number));
      if (matches.length === 0) return { number, path: null, status: null, unknown: "missing" as const };
      if (matches.length > 1) return { number, path: null, status: null, unknown: "ambiguous" as const };
      // Once it is known which ticket this names, show that ticket's own
      // number, so the reference and the card it points at read the same.
      return { number: matches[0].number, path: matches[0].path, status: matches[0].status, unknown: null };
    });
    ticket.blocked = ticket.blockers.some(b => b.unknown !== null || b.status !== "resolved");
  }
}

function duplicateWarnings(tickets: WaygoalTicketNode[]): string[] {
  const seen = new Map<number, string[]>();
  for (const ticket of tickets) {
    const key = Number(ticket.number);
    seen.set(key, [...(seen.get(key) ?? []), ticket.path]);
  }
  return [...seen.entries()].filter(([, paths]) => paths.length > 1)
    .map(([number, paths]) => `编号 ${number} 有 ${paths.length} 份票据（${paths.join("、")}），依赖它的票据无法确定指向哪一份。`);
}

/** Every local map in one workspace, read straight from the source files.
 *  Nothing here writes, and nothing starts a Pi session. */
export function readLocalTickets(cwd: string, now: () => Date = () => new Date()): WaygoalTicketScan {
  const scratch = join(cwd, ".scratch");
  const maps: WaygoalTicketMap[] = [];
  const unsupported: WaygoalUnreadable[] = [];
  const unreadable: WaygoalUnreadable[] = [];
  if (existsSync(scratch)) {
    for (const entry of readdirSync(safePath(cwd, scratch), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(scratch, entry.name);
      if (!existsSync(join(dir, MAP_FILE))) { unsupported.push({ path: relative(cwd, dir), reason: UNSUPPORTED_REASON }); continue; }
      try {
        maps.push(readMap(cwd, dir));
      } catch (error) {
        // One map that cannot be read is one map: the others, the sessions on
        // the same canvas, and this map's own last known content all stay.
        unreadable.push({ path: relative(cwd, join(dir, MAP_FILE)), reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  maps.sort((a, b) => a.path.localeCompare(b.path));
  unsupported.sort((a, b) => a.path.localeCompare(b.path));
  unreadable.sort((a, b) => a.path.localeCompare(b.path));
  return { maps, unsupported, unreadable, readAt: now().toISOString() };
}

const STALE_REASON = "现在读不到这个文件了，下面是上一次成功读到的内容。";

/** `readAt` dates the content, not the scan: as long as a file reads the same,
 *  it keeps the time that content was first read. Otherwise every poll would
 *  produce a new record and rewrite it. */
function keepReadAt<T extends { readAt: string }>(fresh: T, previous: T | undefined): T {
  if (!previous) return fresh;
  const sameContent = JSON.stringify({ ...fresh, readAt: "" }) === JSON.stringify({ ...previous, readAt: "" });
  return sameContent ? { ...fresh, readAt: previous.readAt } : fresh;
}

function savedFrom(maps: WaygoalTicketMap[], readAt: string, previous: WaygoalSavedTickets): WaygoalSavedTickets {
  const saved: WaygoalSavedTickets = { maps: {}, tickets: {} };
  for (const map of maps) {
    saved.maps[map.path] = keepReadAt({ title: map.title, body: map.body, readAt }, previous.maps[map.path]);
    for (const ticket of map.tickets) saved.tickets[ticket.id] = keepReadAt({ ...ticket, readAt }, previous.tickets[ticket.id]);
  }
  return saved;
}

/** The canvas view of one workspace's local tickets: what was just read, plus
 *  anything that was read before and cannot be read now — kept with the time it
 *  was last read, so nothing that vanished silently disappears or gets bound to
 *  a similar-looking file somewhere else. */
export function mergeTicketScan(
  scan: WaygoalTicketScan,
  saved: WaygoalSavedTickets | Record<string, never>,
  now: () => Date = () => new Date(),
): { maps: WaygoalTicketMapView[]; saved: WaygoalSavedTickets } {
  const previous: WaygoalSavedTickets = { maps: saved?.maps ?? {}, tickets: saved?.tickets ?? {} };
  const checkedAt = now().toISOString();
  const live = new Map(scan.maps.map(map => [map.path, map]));

  const views: WaygoalTicketMapView[] = scan.maps.map(map => ({
    ...map,
    stale: null,
    tickets: map.tickets.map(ticket => ({ ...ticket, stale: null })),
  }));

  // Everything read before that this scan did not produce: keep it, marked.
  for (const [path, savedMap] of Object.entries(previous.maps)) {
    if (live.has(path)) continue;
    const tickets = Object.values(previous.tickets)
      .filter(ticket => ticket.mapPath === path)
      .map(({ readAt, ...ticket }) => ({ ...ticket, stale: { reason: STALE_REASON, lastReadAt: readAt, checkedAt } }));
    views.push({
      path, title: savedMap.title, body: savedMap.body,
      tickets, unreadable: [], warnings: [],
      stale: { reason: STALE_REASON, lastReadAt: savedMap.readAt, checkedAt },
    });
  }
  for (const view of views) {
    if (view.stale) continue;
    const seen = new Set(view.tickets.map(t => t.id));
    for (const ticket of Object.values(previous.tickets)) {
      if (ticket.mapPath !== view.path || seen.has(ticket.id)) continue;
      const { readAt, ...rest } = ticket;
      view.tickets.push({ ...rest, stale: { reason: STALE_REASON, lastReadAt: readAt, checkedAt } });
    }
    view.tickets.sort((a, b) => a.id.localeCompare(b.id));
  }
  views.sort((a, b) => a.path.localeCompare(b.path));

  // Keep what was just read; leave everything else at its last good content.
  const fresh = savedFrom(scan.maps, scan.readAt, previous);
  return { maps: views, saved: { maps: { ...previous.maps, ...fresh.maps }, tickets: { ...previous.tickets, ...fresh.tickets } } };
}
