import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("..", import.meta.url).pathname } });
const { readLocalTickets } = await jiti.import("./waygoal-tickets.ts");

/** A workspace holding real files in the layout the local Markdown tracker
 *  documents: `.scratch/<effort>/map.md` with `issues/NN-<slug>.md` under it. */
function workspace(maps) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "waygoal-tickets-")));
  for (const [dir, files] of Object.entries(maps)) {
    const mapDir = join(cwd, ".scratch", dir);
    mkdirSync(join(mapDir, "issues"), { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      const path = name === "map.md" ? join(mapDir, name) : join(mapDir, "issues", name);
      writeFileSync(path, body);
    }
  }
  return { cwd, done: () => rmSync(cwd, { recursive: true, force: true }) };
}

const MAP = `# 给朋友办一场小型放映会

## Destination

找到一个让朋友愿意留下来聊几句的方案。

## Not yet specified

开场怎么说还没定。
`;
const TICKET = (title, extra = "") => `# ${title}

Type: grilling
Status: open
${extra}
## Question

${title}的具体问题正文。
`;

test("a real map directory becomes one map whose tickets are identified by their source file", () => {
  const w = workspace({ screening: { "map.md": MAP, "01-feeling.md": TICKET("希望朋友带走什么感受"), "02-film.md": TICKET("这部短片适合怎样的开场") } });
  try {
    const scan = readLocalTickets(w.cwd);
    assert.equal(scan.maps.length, 1);
    const [map] = scan.maps;
    assert.equal(map.path, ".scratch/screening/map.md");
    assert.equal(map.title, "给朋友办一场小型放映会");
    assert.deepEqual(map.tickets.map(t => t.id), [".scratch/screening/issues/01-feeling.md", ".scratch/screening/issues/02-film.md"]);
    assert.deepEqual(map.tickets.map(t => [t.number, t.title, t.type, t.status]), [
      // The number reads as the file writes it: the source file is the record.
      ["01", "希望朋友带走什么感受", "grilling", "open"],
      ["02", "这部短片适合怎样的开场", "grilling", "open"],
    ]);
    assert.match(map.tickets[0].question, /希望朋友带走什么感受的具体问题正文。/);
  } finally { w.done(); }
});

test("blockers resolve inside their own map: known ones carry a status, unknown ones say so", () => {
  const w = workspace({
    screening: {
      "map.md": MAP,
      "01-feeling.md": TICKET("感受").replace("Status: open", "Status: resolved"),
      "02-film.md": TICKET("影片", "Blocked by: 01\n"),
      "03-opening.md": TICKET("开场", "Blocked by: 02, 09\n"),
    },
    // A second map with the same numbers: a blocker must never reach into it.
    dinner: { "map.md": "# 另一张地图\n", "01-menu.md": TICKET("菜单").replace("Status: open", "Status: resolved") },
  });
  try {
    const scan = readLocalTickets(w.cwd);
    const screening = scan.maps.find(m => m.path.includes("screening"));
    const [, film, opening] = screening.tickets;
    assert.deepEqual(film.blockers, [{ number: "01", path: ".scratch/screening/issues/01-feeling.md", status: "resolved", unknown: null }]);
    assert.equal(film.blocked, false, "its only blocker is resolved");
    // A resolved reference reads as the ticket it found; one that found nothing
    // can only report the number the line named.
    assert.deepEqual(opening.blockers.map(b => [b.number, b.status, b.unknown]), [["02", "open", null], ["9", null, "missing"]]);
    assert.equal(opening.blocked, true, "an open blocker and an unknown one both hold it");
    assert.equal(scan.maps.find(m => m.path.includes("dinner")).tickets[0].blockers.length, 0);
  } finally { w.done(); }
});

test("two tickets sharing a number in one map are reported, not silently picked between", () => {
  const w = workspace({ screening: {
    "map.md": MAP,
    "02-film.md": TICKET("影片").replace("Status: open", "Status: resolved"),
    "02-second.md": TICKET("同号"),
    "03-opening.md": TICKET("开场", "Blocked by: 02\n"),
  } });
  try {
    const [map] = readLocalTickets(w.cwd).maps;
    const opening = map.tickets.find(t => t.title === "开场");
    assert.deepEqual(opening.blockers.map(b => [b.number, b.path, b.unknown]), [["2", null, "ambiguous"]]);
    assert.equal(opening.blocked, true, "an ambiguous dependency is not treated as satisfied");
    assert.equal(map.warnings.length, 1);
    assert.match(map.warnings[0], /02/);
  } finally { w.done(); }
});

test("a directory that is not the supported layout is named, not silently skipped", () => {
  const w = workspace({ screening: { "map.md": MAP, "01-feeling.md": TICKET("感受") } });
  try {
    mkdirSync(join(w.cwd, ".scratch", "notes"), { recursive: true });
    writeFileSync(join(w.cwd, ".scratch", "notes", "README.md"), "# 随手记\n");
    const scan = readLocalTickets(w.cwd);
    assert.deepEqual(scan.maps.map(m => m.path), [".scratch/screening/map.md"]);
    assert.deepEqual(scan.unsupported, [{ path: ".scratch/notes", reason: "这里没有 map.md，Waygoal 只读 .scratch/<地图>/map.md 这一种本地布局。" }]);
  } finally { w.done(); }
});

test("a ticket file that cannot be read is reported on the map, and the rest still loads", () => {
  const w = workspace({ screening: { "map.md": MAP, "01-feeling.md": TICKET("感受") } });
  try {
    // A directory where a ticket file should be: the read fails for real.
    mkdirSync(join(w.cwd, ".scratch/screening/issues/02-broken.md"));
    const [map] = readLocalTickets(w.cwd).maps;
    assert.deepEqual(map.tickets.map(t => t.title), ["感受"], "the readable ticket is still there");
    assert.equal(map.unreadable.length, 1);
    assert.equal(map.unreadable[0].path, ".scratch/screening/issues/02-broken.md");
    assert.match(map.unreadable[0].reason, /EISDIR|illegal operation|读不出来/);
  } finally { w.done(); }
});

test("a workspace with no local tracker reads as empty, without inventing a map", () => {
  const w = workspace({});
  try {
    const scan = readLocalTickets(w.cwd);
    assert.deepEqual(scan.maps, []);
    assert.deepEqual(scan.unsupported, []);
    assert.match(scan.readAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally { w.done(); }
});

const { mergeTicketScan } = await jiti.import("./waygoal-tickets.ts");
const at = (iso) => () => new Date(iso);

test("a source file that stops being readable keeps its last good content, marked stale", () => {
  const w = workspace({ screening: { "map.md": MAP, "01-feeling.md": TICKET("感受"), "02-film.md": TICKET("影片") } });
  try {
    const first = mergeTicketScan(readLocalTickets(w.cwd, at("2026-09-10T01:00:00.000Z")), {}, at("2026-09-10T01:00:00.000Z"));
    assert.deepEqual(first.maps[0].tickets.map(t => [t.title, t.stale]), [["感受", null], ["影片", null]]);

    rmSync(join(w.cwd, ".scratch/screening/issues/02-film.md"));
    const second = mergeTicketScan(readLocalTickets(w.cwd, at("2026-09-10T02:00:00.000Z")), first.saved, at("2026-09-10T02:00:00.000Z"));
    const film = second.maps[0].tickets.find(t => t.title === "影片");
    assert.ok(film, "the ticket is still on the canvas");
    assert.equal(film.id, ".scratch/screening/issues/02-film.md", "it keeps the identity it had");
    assert.match(film.question, /影片的具体问题正文/, "what it shows is what was last read");
    assert.equal(film.stale.lastReadAt, "2026-09-10T01:00:00.000Z");
    assert.match(film.stale.reason, /读不到|找不到/);
    assert.equal(second.maps[0].tickets.find(t => t.title === "感受").stale, null);
  } finally { w.done(); }
});

test("rescanning adds no node, and a retitled ticket stays the same node", () => {
  const w = workspace({ screening: { "map.md": MAP, "01-feeling.md": TICKET("感受") } });
  try {
    const first = mergeTicketScan(readLocalTickets(w.cwd), {}, at("2026-09-10T01:00:00.000Z"));
    writeFileSync(join(w.cwd, ".scratch/screening/issues/01-feeling.md"), TICKET("换个标题"));
    const second = mergeTicketScan(readLocalTickets(w.cwd), first.saved, at("2026-09-10T02:00:00.000Z"));
    assert.equal(second.maps[0].tickets.length, 1);
    assert.equal(second.maps[0].tickets[0].id, first.maps[0].tickets[0].id);
    assert.equal(second.maps[0].tickets[0].title, "换个标题");
    assert.equal(second.maps[0].tickets[0].stale, null);
  } finally { w.done(); }
});

test("a map that is gone keeps its tickets stale instead of binding them to a same-titled ticket elsewhere", () => {
  const w = workspace({ screening: { "map.md": MAP, "01-feeling.md": TICKET("感受") } });
  try {
    const first = mergeTicketScan(readLocalTickets(w.cwd), {}, at("2026-09-10T01:00:00.000Z"));
    rmSync(join(w.cwd, ".scratch/screening"), { recursive: true });
    mkdirSync(join(w.cwd, ".scratch/dinner/issues"), { recursive: true });
    writeFileSync(join(w.cwd, ".scratch/dinner/map.md"), "# 另一张地图\n");
    writeFileSync(join(w.cwd, ".scratch/dinner/issues/01-feeling.md"), TICKET("感受"));

    const second = mergeTicketScan(readLocalTickets(w.cwd), first.saved, at("2026-09-10T02:00:00.000Z"));
    assert.deepEqual(second.maps.map(m => [m.path, m.stale === null]), [
      [".scratch/dinner/map.md", true],
      [".scratch/screening/map.md", false],
    ]);
    const gone = second.maps.find(m => m.path.includes("screening"));
    assert.deepEqual(gone.tickets.map(t => t.id), [".scratch/screening/issues/01-feeling.md"]);
    assert.ok(gone.tickets[0].stale, "the old ticket is stale, not silently the new one");
    assert.equal(second.maps.find(m => m.path.includes("dinner")).tickets[0].id, ".scratch/dinner/issues/01-feeling.md");
  } finally { w.done(); }
});

test("a ticket carries its source text, so the full view is the file and not a retelling", () => {
  const w = workspace({ screening: { "map.md": MAP, "01-feeling.md": TICKET("感受", "Blocked by: 09\n") } });
  try {
    const [map] = readLocalTickets(w.cwd).maps;
    assert.equal(map.tickets[0].body, TICKET("感受", "Blocked by: 09\n"), "byte for byte what the file says");
    assert.equal(map.body, MAP);
  } finally { w.done(); }
});

test("a map file that cannot be read is named, and does not take the rest of the canvas with it", () => {
  const w = workspace({ screening: { "map.md": MAP, "01-feeling.md": TICKET("感受") }, dinner: { "map.md": "# 另一张地图\n" } });
  try {
    const first = mergeTicketScan(readLocalTickets(w.cwd), {}, at("2026-09-10T01:00:00.000Z"));
    // A directory in the right shape whose map.md is a directory: readable path,
    // unreadable file — the same class of failure as a permission or a race.
    rmSync(join(w.cwd, ".scratch/screening/map.md"));
    mkdirSync(join(w.cwd, ".scratch/screening/map.md"));

    const scan = readLocalTickets(w.cwd);
    assert.deepEqual(scan.maps.map(m => m.path), [".scratch/dinner/map.md"], "the other map still loads");
    assert.deepEqual(scan.unreadable.map(u => u.path), [".scratch/screening/map.md"]);
    const merged = mergeTicketScan(scan, first.saved, at("2026-09-10T02:00:00.000Z"));
    const kept = merged.maps.find(m => m.path.includes("screening"));
    assert.ok(kept.stale, "what was read before is kept and marked, not dropped");
    assert.equal(kept.tickets[0].title, "感受");
  } finally { w.done(); }
});

test("reading the same files again produces the same record, so nothing is rewritten", () => {
  const w = workspace({ screening: { "map.md": MAP, "01-feeling.md": TICKET("感受") } });
  try {
    const first = mergeTicketScan(readLocalTickets(w.cwd, at("2026-09-10T01:00:00.000Z")), {}, at("2026-09-10T01:00:00.000Z"));
    const second = mergeTicketScan(readLocalTickets(w.cwd, at("2026-09-10T02:00:00.000Z")), first.saved, at("2026-09-10T02:00:00.000Z"));
    assert.deepEqual(second.saved, first.saved, "an unchanged file keeps the time its content was read");

    writeFileSync(join(w.cwd, ".scratch/screening/issues/01-feeling.md"), TICKET("换了个标题"));
    const third = mergeTicketScan(readLocalTickets(w.cwd, at("2026-09-10T03:00:00.000Z")), second.saved, at("2026-09-10T03:00:00.000Z"));
    assert.equal(third.saved.tickets[".scratch/screening/issues/01-feeling.md"].readAt, "2026-09-10T03:00:00.000Z");
  } finally { w.done(); }
});
