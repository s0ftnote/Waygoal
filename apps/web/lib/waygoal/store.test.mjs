import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../", import.meta.url)) } });
const store = await jiti.import("./store.ts");
const { createWaygoalExtension, MISSING_SKILL_NOTICE, parseSkillCommand } = await jiti.import("./extension.ts");
const workspaces = await jiti.import("./workspaces.ts");
const paths = await jiti.import("./dirs.ts");

function session(id, cwd, extra = {}) {
  return { id, path: `/sessions/${id}.jsonl`, cwd, created: "2026-09-01T00:00:00.000Z", modified: "2026-09-02T00:00:00.000Z", messageCount: 2, firstMessage: `first ${id}`, ...extra };
}
function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "waygoal-test-")));
  const agentDir = join(root, "agent"); mkdirSync(agentDir);
  const a = join(root, "work-a"); mkdirSync(a);
  const b = join(root, "work-b"); mkdirSync(b);
  // Reads and writes are about one directory and one canvas in it; every
  // working directory starts with the same first canvas.
  const scope = cwd => ({ cwd, canvasId: "main", agentDir });
  return { root, agentDir, a, b, sa: scope(a), sb: scope(b), done: () => rmSync(root, { recursive: true, force: true }) };
}

test("workspace identity and records are isolated per working directory", () => {
  const s = sandbox();
  try {
    assert.notEqual(paths.workspaceId(s.a), paths.workspaceId(s.b));
    assert.match(paths.workspaceId(s.a), /^work-a-[0-9a-f]{12}$/);
    store.applyCanvasPatch(s.sa, { view: { x: 1, y: 2, scale: 1.5 } });
    assert.equal(store.readCanvasRecord(s.sb).view, undefined);
    assert.deepEqual(store.readCanvasRecord(s.sa).view, { x: 1, y: 2, scale: 1.5 });
    assert.ok(existsSync(join(s.agentDir, "waygoal/workspaces", paths.workspaceId(s.a), "canvas.json")), "record lives in the Pi data dir, not next to plugin code");
  } finally { s.done(); }
});

test("canvases of one working directory keep separate layouts and separate sessions", () => {
  const s = sandbox();
  try {
    const second = workspaces.addCanvas(s.a, "选片", s.agentDir).id;
    const other = { cwd: s.a, canvasId: second, agentDir: s.agentDir };
    store.applyCanvasPatch(s.sa, { view: { x: 1, y: 2, scale: 1.5 } });
    // Which canvas a session is on is the workspace's record, not the canvas's.
    workspaces.registerSession(other, "two");
    store.applyCanvasPatch(other, { view: { x: 9, y: 9, scale: 0.5 } });
    assert.deepEqual(store.readCanvasRecord(s.sa).view, { x: 1, y: 2, scale: 1.5 });
    assert.deepEqual(store.readCanvasRecord(other).view, { x: 9, y: 9, scale: 0.5 }, "one canvas's view is not the other's");
    assert.ok(existsSync(join(s.agentDir, "waygoal/workspaces", paths.workspaceId(s.a), `canvas-${second}.json`)));

    const sessions = [session("one", s.a), session("two", s.a)];
    assert.deepEqual(store.buildSnapshot(s.sa, sessions, []).nodes.map(n => n.id), ["one"]);
    assert.deepEqual(store.buildSnapshot(other, sessions, []).nodes.map(n => n.id), ["two"], "a chat started from a canvas stays on that canvas");
  } finally { s.done(); }
});

test("resolveWorkspaceCwd: explicit directory, rejects missing dirs", () => {
  const s = sandbox();
  try {
    assert.equal(store.resolveWorkspaceCwd(s.b), s.b);
    assert.throws(() => store.resolveWorkspaceCwd(join(s.root, "nope")), /不存在/);
  } finally { s.done(); }
});

test("workspace startup uses the launch directory, while explicit and remembered choices take priority", () => {
  const s = sandbox();
  const initialCwd = process.env.INIT_CWD;
  try {
    process.env.INIT_CWD = s.a;
    assert.equal(store.resolveWorkspaceCwd(null, s.agentDir), s.a);
    delete process.env.INIT_CWD;
    assert.equal(store.resolveWorkspaceCwd(null, s.agentDir), realpathSync(process.cwd()));
    process.env.INIT_CWD = s.a;
    workspaces.rememberWorkspace(s.b, s.agentDir);
    assert.equal(store.resolveWorkspaceCwd(null, s.agentDir), s.b);
    assert.equal(store.resolveWorkspaceCwd(s.a, s.agentDir), s.a);
    rmSync(s.b, { recursive: true });
    assert.throws(() => store.resolveWorkspaceCwd(null, s.agentDir), /上次打开的工作目录现在不在了/);
  } finally {
    if (initialCwd === undefined) delete process.env.INIT_CWD;
    else process.env.INIT_CWD = initialCwd;
    s.done();
  }
});

test("snapshot registers real sessions once, by workspace, without subagents", () => {
  const s = sandbox();
  try {
    const sessions = [
      session("named", s.a, { name: "已存标题" }),
      session("named", s.a, { path: "", transient: true, name: "已存标题" }),
      session("plain", s.a, { firstMessage: "x".repeat(100) }),
      session("empty", s.a, { messageCount: 0, firstMessage: "(no messages)" }),
      session("sub", s.a, { relation: { kind: "subagent", parentId: "named" } }),
      session("other", s.b),
    ];
    const snap = store.buildSnapshot(s.sa, sessions, ["plain"]);
    assert.deepEqual(snap.nodes.map(n => n.id).sort(), ["empty", "named", "plain"]);
    const byId = Object.fromEntries(snap.nodes.map(n => [n.id, n]));
    assert.equal(byId.named.title, "已存标题"); assert.equal(byId.named.titleSource, "name");
    assert.equal(byId.named.transient, false, "disk-backed copy wins over the transient duplicate");
    assert.equal(byId.plain.titleSource, "fallback"); assert.ok(byId.plain.title.length <= 73);
    assert.equal(byId.plain.running, true); assert.equal(byId.named.running, false);
    assert.equal(byId.empty.titleSource, "empty");
    const positions = snap.nodes.map(n => `${n.position.x},${n.position.y}`);
    assert.equal(new Set(positions).size, 3, "new nodes get distinct positions");
    const again = store.buildSnapshot(s.sa, sessions, []);
    assert.deepEqual(again.nodes.map(n => n.position), snap.nodes.map(n => n.position), "positions persist across discoveries");
    assert.equal(store.buildSnapshot(s.sb, sessions, []).nodes.map(n => n.id).join(), "other");
  } finally { s.done(); }
});

test("patches restore positions, view and last viewed; missing last viewed is reported", () => {
  const s = sandbox();
  try {
    const sessions = [session("one", s.a), session("two", s.a)];
    store.buildSnapshot(s.sa, sessions, []);
    store.applyCanvasPatch(s.sa, { positions: { one: { x: 900, y: 40 } }, view: { x: -10, y: 5, scale: 0.8 }, lastViewed: "two" });
    let snap = store.buildSnapshot(s.sa, sessions, []);
    assert.deepEqual(snap.nodes.find(n => n.id === "one").position, { x: 900, y: 40 });
    assert.deepEqual(snap.view, { x: -10, y: 5, scale: 0.8 });
    assert.equal(snap.lastViewed, "two"); assert.equal(snap.lastViewedMissing, false);
    snap = store.buildSnapshot(s.sa, [sessions[0]], []);
    assert.equal(snap.lastViewedMissing, true);
    store.applyCanvasPatch(s.sa, { lastViewed: null });
    assert.equal(store.buildSnapshot(s.sa, sessions, []).lastViewed, null);
  } finally { s.done(); }
});

test("a corrupt record is tolerated instead of breaking the canvas", () => {
  const s = sandbox();
  try {
    mkdirSync(paths.workspaceDir(s.a, s.agentDir), { recursive: true });
    writeFileSync(join(paths.workspaceDir(s.a, s.agentDir), "canvas.json"), "{ not json");
    const snap = store.buildSnapshot(s.sa, [session("one", s.a)], []);
    assert.equal(snap.nodes.length, 1);
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(paths.workspaceDir(s.a, s.agentDir), "canvas.json"), "utf8")));
  } finally { s.done(); }
});

test("nextFreePosition avoids occupied slots, counting how tall each card is", () => {
  const card = position => ({ ...position, height: store.NODE_HEIGHT });
  const first = store.nextFreePosition([], store.NODE_HEIGHT);
  const second = store.nextFreePosition([card(first)], store.NODE_HEIGHT);
  assert.notDeepEqual(first, second);
  assert.ok(Math.abs(first.x - second.x) >= store.NODE_WIDTH || Math.abs(first.y - second.y) >= store.NODE_HEIGHT);
  // The same slot is refused for a card too tall to fit beside a short one.
  const beside = store.nextFreePosition([{ ...first, height: TICKET_CARD_HEIGHT }], store.NODE_HEIGHT);
  assert.ok(beside.y >= TICKET_CARD_HEIGHT || beside.x !== first.x, JSON.stringify(beside));
});

test("new forks are placed beside their actual source even with out-of-order dates, and saved positions win", () => {
  const s = sandbox();
  try {
    const source = session("source", s.a, { created: "2026-09-03" });
    const child = session("child", s.a, { created: "2026-09-01", relation: { kind: "fork", originSessionId: "source" } });
    const snap = store.buildSnapshot(s.sa, [child, source], []);
    const positions = Object.fromEntries(snap.nodes.map(n => [n.id, n.position]));
    assert.deepEqual(positions.child, { x: positions.source.x + store.NODE_WIDTH + 70, y: positions.source.y });
    store.applyCanvasPatch(s.sa, { positions: { child: { x: -2200, y: 400 } } });
    assert.deepEqual(store.buildSnapshot(s.sa, [source, child], []).nodes.find(n => n.id === "child").position, { x: -2200, y: 400 });
  } finally { s.done(); }
});

test("arranging is position-only, undo survives a read, and other cards and canvases stay put", () => {
  const s = sandbox();
  try {
    const sessions = [session("a", s.a), session("b", s.a), session("other", s.a)];
    store.buildSnapshot(s.sa, sessions, []);
    const original = store.applyCanvasPatch(s.sa, { view: { x: 1, y: 2, scale: 0.8 }, addGroup: { name: "group", members: ["a", "b"] }, addLink: { from: "a", to: "b", note: "manual" } });
    const before = { a: original.nodes.a, b: original.nodes.b };
    const after = { a: { x: 1000, y: -200 }, b: { x: 1320, y: -200 } };
    const arranged = store.applyCanvasPatch(s.sa, { layout: { before, after } });
    assert.deepEqual(arranged.nodes.other, original.nodes.other);
    assert.deepEqual(arranged.groups, original.groups);
    assert.deepEqual(arranged.links, original.links);
    assert.deepEqual(arranged.view, original.view);
    assert.equal(store.buildSnapshot(s.sa, sessions, []).canUndoLayout, true);
    assert.equal(store.buildSnapshot(s.sb, [], []).canUndoLayout, false);
    const newer = [...sessions, session("new", s.a)];
    store.buildSnapshot(s.sa, newer, []);
    const added = store.readCanvasRecord(s.sa).nodes.new;
    const undone = store.applyCanvasPatch(s.sa, { undoLayout: true });
    assert.deepEqual(undone.nodes.a, original.nodes.a);
    assert.deepEqual(undone.nodes.b, original.nodes.b);
    assert.deepEqual(undone.nodes.new, added);
    assert.equal(store.buildSnapshot(s.sa, newer, []).canUndoLayout, false);
  } finally { s.done(); }
});

test("stale layout requests and undo after a manual move cannot overwrite newer positions", () => {
  const s = sandbox();
  try {
    const original = store.applyCanvasPatch(s.sa, { positions: { a: { x: 0, y: 0 }, b: { x: 600, y: 600 } } });
    const layout = { before: original.nodes, after: { a: { x: 100, y: 0 }, b: { x: 420, y: 0 } } };
    store.applyCanvasPatch(s.sa, { layout });
    assert.throws(() => store.applyCanvasPatch(s.sa, { layout }), /位置已变化/);
    store.applyCanvasPatch(s.sa, { positions: { a: { x: 999, y: 999 } } });
    assert.throws(() => store.applyCanvasPatch(s.sa, { undoLayout: true }), /没有可撤销/);
    assert.deepEqual(store.readCanvasRecord(s.sa).nodes.a, { x: 999, y: 999 });
  } finally { s.done(); }
});

test("extension: unknown /skill: gets feedback and is not sent; known skills pass through", async () => {
  const s = sandbox();
  try {
    const handlers = {};
    const pi = { on: (name, fn) => { handlers[name] = fn; }, appendEntry() {} };
    createWaygoalExtension(s.a, async () => ["e2e-skill"])({ ...pi, registerTool: () => {} });
    const notices = [];
    const ctx = { ui: { notify: (m, level) => notices.push([m, level]) } };
    assert.deepEqual(await handlers.input({ text: "/skill:missing hi", source: "rpc" }, ctx), { action: "handled" });
    assert.deepEqual(notices, [[MISSING_SKILL_NOTICE("missing"), "warning"]]);
    assert.deepEqual(await handlers.input({ text: "/skill:e2e-skill hi", source: "rpc" }, ctx), { action: "continue" });
    assert.deepEqual(await handlers.input({ text: "plain text", source: "rpc" }, ctx), { action: "continue" });
    assert.equal(handlers.before_agent_start, undefined, "no Wayfinder prompt outside the ticket prototype");
    assert.equal(parseSkillCommand("/skill:abc x").name, "abc");
    assert.equal(parseSkillCommand("  /skill:abc x"), null, "matches Pi: leading whitespace is not a skill command");
    assert.equal(parseSkillCommand("/skills"), null);
    assert.deepEqual(await handlers.input({ text: "/skill:", source: "rpc" }, ctx), { action: "handled" }, "empty name is reported, not sent");
  } finally { s.done(); }
});

test("a recorded fork origin keeps the source session and the source message", () => {
  const s = sandbox();
  try {
    const sessions = [session("origin", s.a, { name: "共同来源" }), session("forked", s.a)];
    store.buildSnapshot(s.sa, sessions, []);
    store.applyCanvasPatch(s.sa, { origin: { sessionId: "forked", originSessionId: "origin", originEntryId: "u7" } });
    const node = store.buildSnapshot(s.sa, sessions, []).nodes.find(n => n.id === "forked");
    assert.deepEqual(node.origin, { sessionId: "origin", entryId: "u7", inWorkspace: true, title: "共同来源" });
    assert.equal(store.buildSnapshot(s.sa, sessions, []).nodes.find(n => n.id === "origin").origin, null);
  } finally { s.done(); }
});

test("a fork made outside Waygoal reports the source session with no message position", () => {
  const s = sandbox();
  try {
    // Pi's header only records parentSession, never the entry it was forked at.
    const sessions = [session("origin", s.a), session("forked", s.a, { parentSessionId: "origin", relation: { kind: "fork", originSessionId: "origin" } })];
    const node = store.buildSnapshot(s.sa, sessions, []).nodes.find(n => n.id === "forked");
    assert.deepEqual(node.origin, { sessionId: "origin", entryId: null, inWorkspace: true, title: "first origin" });
  } finally { s.done(); }
});

test("an origin outside this workspace is reported as such, not matched by title", () => {
  const s = sandbox();
  try {
    const sessions = [session("forked", s.a), session("origin", s.b, { name: "first forked" })];
    store.applyCanvasPatch(s.sa, { origin: { sessionId: "forked", originSessionId: "origin", originEntryId: "u1" } });
    const node = store.buildSnapshot(s.sa, sessions, []).nodes.find(n => n.id === "forked");
    assert.deepEqual(node.origin, { sessionId: "origin", entryId: "u1", inWorkspace: false, title: null });
  } finally { s.done(); }
});

test("incomplete or self-referential origins are refused instead of stored", () => {
  const s = sandbox();
  try {
    for (const origin of [
      { sessionId: "forked", originSessionId: "forked", originEntryId: "u1" },
      { sessionId: "forked", originSessionId: "origin", originEntryId: "" },
      { sessionId: "", originSessionId: "origin", originEntryId: "u1" },
    ]) store.applyCanvasPatch(s.sa, { origin });
    assert.deepEqual(store.readCanvasRecord(s.sa).origins, {});
  } finally { s.done(); }
});

test("the last viewed position keeps its entry, and drops it with its session", () => {
  const s = sandbox();
  try {
    const sessions = [session("one", s.a), session("two", s.a)];
    store.applyCanvasPatch(s.sa, { lastViewed: "two", lastViewedEntry: "a3" });
    let snap = store.buildSnapshot(s.sa, sessions, []);
    assert.equal(snap.lastViewed, "two"); assert.equal(snap.lastViewedEntry, "a3");
    snap = store.buildSnapshot(s.sa, [sessions[0]], []);
    assert.equal(snap.lastViewedMissing, true);
    assert.equal(snap.lastViewedEntry, null, "a missing session must not carry a position into another one");
    store.applyCanvasPatch(s.sa, { lastViewedEntry: null });
    assert.equal(store.buildSnapshot(s.sa, sessions, []).lastViewedEntry, null);
  } finally { s.done(); }
});

test("branch counts and the active leaf come from the real tree, not from the record", () => {
  const s = sandbox();
  try {
    const sessions = [session("one", s.a), session("two", s.a)];
    const trees = new Map([["one", { activeLeafId: "a9", branchPointCount: 2 }]]);
    const byId = Object.fromEntries(store.buildSnapshot(s.sa, sessions, [], trees).nodes.map(n => [n.id, n]));
    assert.equal(byId.one.branchPointCount, 2); assert.equal(byId.one.activeLeafId, "a9");
    assert.equal(byId.two.branchPointCount, 0); assert.equal(byId.two.activeLeafId, null);
  } finally { s.done(); }
});

/** Real files in the layout the local Markdown tracker documents. */
function localMap(cwd, dir, tickets, map = "# 放映会\n\n## Destination\n\n定下方案。\n") {
  mkdirSync(join(cwd, ".scratch", dir, "issues"), { recursive: true });
  writeFileSync(join(cwd, ".scratch", dir, "map.md"), map);
  for (const [name, body] of Object.entries(tickets)) writeFileSync(join(cwd, ".scratch", dir, "issues", name), body);
}
const { TICKET_CARD_HEIGHT } = await jiti.import("./types.ts");
const ticketBody = (title, extra = "") => `# ${title}\n\nType: grilling\nStatus: open\n${extra}\n## Question\n\n${title}的正文。\n`;

test("local tickets become canvas cards whose layout is kept per workspace", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-feeling.md": ticketBody("感受"), "02-film.md": ticketBody("影片") });
    const first = store.buildTicketSnapshot(s.sa, []);
    assert.deepEqual(first.maps.map(m => m.path), [".scratch/screening/map.md"]);
    const cards = first.maps[0].tickets;
    assert.deepEqual(cards.map(t => t.title), ["感受", "影片"]);
    assert.ok(cards.every(t => Number.isFinite(t.position.x) && Number.isFinite(t.position.y)), "every card has a place");
    assert.notDeepEqual(cards[0].position, cards[1].position, "cards do not stack on one spot");

    store.applyCanvasPatch(s.sa, { positions: { ".scratch/screening/issues/01-feeling.md": { x: 640, y: 320 } } });
    const again = store.buildTicketSnapshot(s.sa, []);
    assert.deepEqual(again.maps[0].tickets[0].position, { x: 640, y: 320 }, "a moved card stays where it was put");
    assert.equal(again.maps[0].tickets.length, 2, "rescanning adds no card");
    // Another workspace must not see this one's tickets.
    assert.deepEqual(store.buildTicketSnapshot(s.sb, []).maps, []);

    // The canvas polls; a read that found nothing new must leave the record alone.
    const record = join(paths.workspaceDir(s.a, s.agentDir), "canvas.json");
    const before = readFileSync(record, "utf8");
    store.buildTicketSnapshot(s.sa, []);
    assert.equal(readFileSync(record, "utf8"), before, "an unchanged read rewrites nothing");
  } finally { s.done(); }
});

test("what was read survives a restart, and a file that vanishes is shown stale, not dropped", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-feeling.md": ticketBody("感受") });
    const first = store.buildTicketSnapshot(s.sa, []);
    assert.equal(first.maps[0].tickets[0].stale, null);

    // A new process reads the same workspace: the record is on disk, not in memory.
    rmSync(join(s.a, ".scratch/screening/issues/01-feeling.md"));
    const after = store.buildTicketSnapshot(s.sa, []);
    const card = after.maps[0].tickets[0];
    assert.equal(card.id, ".scratch/screening/issues/01-feeling.md");
    assert.match(card.question, /感受的正文/, "the last content read is what it shows");
    assert.ok(card.stale, "and it says so");
    assert.equal(card.stale.lastReadAt, first.readAt);
  } finally { s.done(); }
});

test("a session card is never placed on top of a ticket's discussions", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-feeling.md": ticketBody("感受"), "02-film.md": ticketBody("影片") });
    store.buildTicketSnapshot(s.sa, []);
    const cards = store.buildTicketSnapshot(s.sa, []).maps[0].tickets;
    const sessions = store.buildSnapshot(s.sa, [session("one", s.a), session("two", s.a), session("three", s.a)], []).nodes;
    // A ticket keeps its discussions on chips right under the card, so the room
    // it takes is taller than a session card's.
    const clash = sessions.find(node => cards.some(card =>
      Math.abs(card.position.x - node.position.x) < store.NODE_WIDTH
      && node.position.y < card.position.y + TICKET_CARD_HEIGHT
      && card.position.y < node.position.y + store.NODE_HEIGHT));
    assert.equal(clash, undefined, `session ${clash?.id} landed on a ticket's discussions`);
  } finally { s.done(); }
});

test("reading local tickets never touches Pi sessions or the session snapshot", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-feeling.md": ticketBody("感受") });
    store.buildTicketSnapshot(s.sa, []);
    const snap = store.buildSnapshot(s.sa, [session("one", s.a)], []);
    assert.deepEqual(snap.nodes.map(n => n.id), ["one"], "tickets are not sessions and do not appear as nodes");
    const record = store.readCanvasRecord(s.sa);
    assert.ok(record.tickets.tickets[".scratch/screening/issues/01-feeling.md"], "the read is cached in the canvas record");
    assert.equal(record.origins.one, undefined);
  } finally { s.done(); }
});

test("a ticket carries the discussions held under it, and keeps them across a restart", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-feeling.md": ticketBody("感受") });
    const path = ".scratch/screening/issues/01-feeling.md";
    const sessions = [session("talk-1", s.a), session("talk-2", s.a), session("loose", s.a)];

    store.applyCanvasPatch(s.sa, { ticketSession: { sessionId: "talk-1", ticket: path } });
    store.applyCanvasPatch(s.sa, { ticketSession: { sessionId: "talk-2", ticket: path } });
    const nodes = store.buildSnapshot(s.sa, sessions, []).nodes;
    const ticket = store.buildTicketSnapshot(s.sa, nodes).maps[0].tickets[0];
    assert.deepEqual(ticket.discussions.map(d => d.sessionId), ["talk-1", "talk-2"], "one ticket, several discussions");
    assert.equal(ticket.discussions.every(d => !d.missing), true);

    // A session that belongs to no ticket stays a plain node on the canvas.
    assert.equal(store.readCanvasRecord(s.sa).ticketSessions.loose, undefined);
  } finally { s.done(); }
});

test("a discussion forked from a ticket's discussion stays under the same ticket", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-feeling.md": ticketBody("感受") });
    const path = ".scratch/screening/issues/01-feeling.md";
    store.applyCanvasPatch(s.sa, { ticketSession: { sessionId: "talk-1", ticket: path } });
    // The fork records where it came from; the ticket comes with it.
    store.applyCanvasPatch(s.sa, { origin: { sessionId: "fork-1", originSessionId: "talk-1", originEntryId: "e1" } });

    const record = store.readCanvasRecord(s.sa);
    assert.equal(record.ticketSessions["fork-1"], path, "a branch of the discussion is still that ticket's discussion");
    const nodes = store.buildSnapshot(s.sa, [session("talk-1", s.a), session("fork-1", s.a)], []).nodes;
    const ticket = store.buildTicketSnapshot(s.sa, nodes).maps[0].tickets[0];
    assert.deepEqual(ticket.discussions.map(d => [d.sessionId, d.originSessionId]), [["talk-1", null], ["fork-1", "talk-1"]]);
    assert.equal(ticket.blocked, false, "a discussion adds no dependency to the ticket");

    // Pi cannot always say which message a fork came from. The canvas then says
    // outright which ticket the new discussion is held under, so a fork it can
    // only trace back to the session does not fall out of the ticket.
    store.applyCanvasPatch(s.sa, { ticketSession: { sessionId: "fork-2", ticket: path } });
    const after = store.readCanvasRecord(s.sa);
    assert.equal(after.ticketSessions["fork-2"], path);
    assert.equal(after.origins["fork-2"], undefined, "and it claims no message position it does not have");
  } finally { s.done(); }
});

test("a discussion whose session is gone is shown as broken, not silently replaced", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-feeling.md": ticketBody("感受") });
    const path = ".scratch/screening/issues/01-feeling.md";
    store.applyCanvasPatch(s.sa, { ticketSession: { sessionId: "talk-1", ticket: path } });

    // The session file is gone; another session of this workspace is not it.
    const nodes = store.buildSnapshot(s.sa, [session("talk-2", s.a)], []).nodes;
    const ticket = store.buildTicketSnapshot(s.sa, nodes).maps[0].tickets[0];
    assert.deepEqual(ticket.discussions.map(d => [d.sessionId, d.missing]), [["talk-1", true]]);
    assert.equal(store.readCanvasRecord(s.sa).ticketSessions["talk-1"], path, "the record still says what was linked");
  } finally { s.done(); }
});

test("a ticket remembers the discussion last talked in, and whether its discussions are shown", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-feeling.md": ticketBody("感受") });
    const path = ".scratch/screening/issues/01-feeling.md";
    const sessions = [session("talk-1", s.a), session("talk-2", s.a)];
    for (const id of ["talk-1", "talk-2"]) store.applyCanvasPatch(s.sa, { ticketSession: { sessionId: id, ticket: path } });

    const read = () => store.buildTicketSnapshot(s.sa, store.buildSnapshot(s.sa, sessions, []).nodes).maps[0].tickets[0];
    assert.equal(read().expanded, true, "a ticket shows its discussions until it is collapsed");

    store.applyCanvasPatch(s.sa, { ticketExpanded: { ticket: path, expanded: false } });
    store.applyCanvasPatch(s.sa, { ticketLast: { ticket: path, sessionId: "talk-2", entryId: "e9" } });
    const collapsed = read();
    assert.equal(collapsed.expanded, false, "collapsing is kept");
    assert.deepEqual(collapsed.lastDiscussion, { sessionId: "talk-2", entryId: "e9" }, "and so is where the talking was left off");

    // A ticket that was collapsed can still be continued from inside itself.
    assert.equal(collapsed.discussions.length, 2);
  } finally { s.done(); }
});

test("associations to sessions of another workspace, or to no ticket, are refused", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-feeling.md": ticketBody("感受") });
    store.applyCanvasPatch(s.sa, { ticketSession: { sessionId: "", ticket: ".scratch/screening/issues/01-feeling.md" } });
    store.applyCanvasPatch(s.sa, { ticketSession: { sessionId: "talk-1", ticket: "../outside/map.md" } });
    store.applyCanvasPatch(s.sa, { ticketSession: { sessionId: "talk-1", ticket: ".scratch/../../outside/map.md" } });
    store.applyCanvasPatch(s.sa, { ticketSession: { sessionId: "talk-1", ticket: join(s.a, ".scratch/screening/issues/01-feeling.md") } });
    assert.deepEqual(store.readCanvasRecord(s.sa).ticketSessions, {}, "a ticket is named by its path inside the workspace, never by an absolute one");

    store.applyCanvasPatch(s.sa, { ticketSession: { sessionId: "talk-1", ticket: ".scratch/screening/issues/01-feeling.md" } });
    store.applyCanvasPatch(s.sa, { ticketSession: { sessionId: "talk-1", ticket: null } });
    assert.deepEqual(store.readCanvasRecord(s.sa).ticketSessions, {}, "a discussion can be taken back out of a ticket");
  } finally { s.done(); }
});

const resolvedBody = (title, extra = "") => ticketBody(title, extra).replace("Status: open", "Status: resolved");
const card = (snapshot, title) => snapshot.maps.flatMap(m => m.tickets).find(t => t.title === title);

test("a ticket that stops waiting is lit once, and the same change is never replayed", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-room.md": ticketBody("场地"), "02-opening.md": ticketBody("开场", "Blocked by: 01\n") });
    const waiting = card(store.buildTicketSnapshot(s.sa, []), "开场");
    assert.equal(waiting.state, "waiting");
    assert.equal(waiting.justUnblocked, false, "waiting is not news");

    writeFileSync(join(s.a, ".scratch/screening/issues/01-room.md"), resolvedBody("场地"));
    const lit = card(store.buildTicketSnapshot(s.sa, []), "开场");
    assert.equal(lit.state, "unblocked");
    assert.equal(lit.justUnblocked, true, "the change itself is worth pointing at once");

    // Every later read, including one by a host that just started, sees the
    // record on disk: the state still says it can be worked on, the change
    // does not happen again.
    for (const again of [store.buildTicketSnapshot(s.sa, []), store.buildTicketSnapshot(s.sa, [])]) {
      assert.equal(card(again, "开场").state, "unblocked");
      assert.equal(card(again, "开场").justUnblocked, false, "the same change is not replayed");
    }
  } finally { s.done(); }
});

test("a ticket that was never waiting is not lit, and one blocked again can be lit again", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-room.md": resolvedBody("场地"), "02-opening.md": ticketBody("开场", "Blocked by: 01\n") });
    const first = card(store.buildTicketSnapshot(s.sa, []), "开场");
    assert.equal(first.state, "unblocked");
    assert.equal(first.justUnblocked, false, "seeing it for the first time is not a change");

    // The premise is reopened in the source: waiting again, without the canvas
    // touching either ticket's own status.
    writeFileSync(join(s.a, ".scratch/screening/issues/01-room.md"), ticketBody("场地"));
    const blocked = card(store.buildTicketSnapshot(s.sa, []), "开场");
    assert.equal(blocked.state, "waiting");
    assert.equal(blocked.status, "open", "unlocking and re-blocking never write the ticket's own status");

    writeFileSync(join(s.a, ".scratch/screening/issues/01-room.md"), resolvedBody("场地"));
    assert.equal(card(store.buildTicketSnapshot(s.sa, []), "开场").justUnblocked, true, "letting it through again is a change of its own");
  } finally { s.done(); }
});

test("a premise that could not be read once does not light the ticket when the read recovers", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-room.md": resolvedBody("场地"), "02-opening.md": ticketBody("开场", "Blocked by: 01\n") });
    assert.equal(card(store.buildTicketSnapshot(s.sa, []), "开场").state, "unblocked");

    // One bad scan: the premise holds, because a read that failed says nothing
    // about whether it was met.
    rmSync(join(s.a, ".scratch/screening/issues/01-room.md"));
    assert.equal(card(store.buildTicketSnapshot(s.sa, []), "开场").state, "waiting");

    writeFileSync(join(s.a, ".scratch/screening/issues/01-room.md"), resolvedBody("场地"));
    const back = card(store.buildTicketSnapshot(s.sa, []), "开场");
    assert.equal(back.state, "unblocked");
    assert.equal(back.justUnblocked, false, "reading it again is not the premise being met");
  } finally { s.done(); }
});

// 手动分组与手动关联：用户自己整理的，不是从 Pi 历史或票据正文里读出来的。
const grouped = (scope, name) => store.buildSnapshot(scope, [], []).groups.find(g => g.name === name);

test("几段会话圈成命名分组，组名和成员写进画布记录，重启还在", () => {
  const s = sandbox();
  try {
    const sessions = [session("one", s.a), session("two", s.a), session("three", s.a)];
    store.buildSnapshot(s.sa, sessions, []);
    store.applyCanvasPatch(s.sa, { addGroup: { name: "开场那一摊", members: ["one", "three"] } });

    // 一次新的读取就是重启后看到的：记录在盘上，没别的东西记着它。
    const after = store.buildSnapshot(s.sa, sessions, []);
    assert.equal(after.groups.length, 1);
    assert.equal(after.groups[0].name, "开场那一摊");
    assert.deepEqual(after.groups[0].members, ["one", "three"]);
    assert.equal(after.groups[0].collapsed, false, "刚建好的分组是摊开的，成员照旧在画布上");
    assert.ok(after.groups[0].position, "收起时它自己也要有个位置");
    assert.deepEqual(after.nodes.map(n => n.id), ["one", "two", "three"], "分组不新建会话，也不吃掉成员");
  } finally { s.done(); }
});

test("建分组不建立会话、不动分叉来源，也不动票据关联", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-feeling.md": ticketBody("感受") });
    const ticket = ".scratch/screening/issues/01-feeling.md";
    const sessions = [session("one", s.a), session("two", s.a)];
    store.applyCanvasPatch(s.sa, { origin: { sessionId: "two", originSessionId: "one", originEntryId: "e1" } });
    store.applyCanvasPatch(s.sa, { ticketSession: { sessionId: "one", ticket } });
    const before = store.readCanvasRecord(s.sa);

    store.applyCanvasPatch(s.sa, { addGroup: { name: "开场那一摊", members: ["one", "two"] } });
    const after = store.readCanvasRecord(s.sa);
    assert.deepEqual(after.origins, before.origins, "分组不是分叉，来源记录一个字都不变");
    assert.deepEqual(after.ticketSessions, before.ticketSessions, "分组不是票据关联");
    assert.deepEqual(store.buildSnapshot(s.sa, sessions, []).nodes.map(n => n.id), ["one", "two"], "分组没有多出一段会话");
  } finally { s.done(); }
});

test("一张卡片只属于一个分组，放进新分组就从旧的里出来", () => {
  const s = sandbox();
  try {
    store.applyCanvasPatch(s.sa, { addGroup: { name: "开场", members: ["one", "two"] } });
    store.applyCanvasPatch(s.sa, { addGroup: { name: "吃的", members: ["two", "three"] } });
    const groups = store.readCanvasRecord(s.sa).groups;
    assert.deepEqual(groups.map(g => g.name), ["开场", "吃的"]);
    assert.deepEqual(groups[0].members, ["one"], "同一张卡片不会同时挂在两个组名下");
    assert.deepEqual(groups[1].members, ["two", "three"]);
  } finally { s.done(); }
});

test("分组可以收起，也可以解散；解散只去掉分组，成员照旧在", () => {
  const s = sandbox();
  try {
    const sessions = [session("one", s.a), session("two", s.a)];
    store.applyCanvasPatch(s.sa, { addGroup: { name: "开场", members: ["one", "two"] } });
    const id = store.readCanvasRecord(s.sa).groups[0].id;

    store.applyCanvasPatch(s.sa, { groupCollapsed: { group: id, collapsed: true } });
    assert.equal(grouped(s.sa, "开场").collapsed, true, "收起记在记录里，重启还是收起的");

    store.applyCanvasPatch(s.sa, { removeGroup: id });
    assert.deepEqual(store.buildSnapshot(s.sa, sessions, []).groups, []);
    assert.deepEqual(store.buildSnapshot(s.sa, sessions, []).nodes.map(n => n.id), ["one", "two"], "解散的是分组，不是里面的会话");
  } finally { s.done(); }
});

test("手动关联可以带说明，也可以删掉", () => {
  const s = sandbox();
  try {
    store.applyCanvasPatch(s.sa, { addLink: { from: "one", to: "two", note: "这两段说的是同一件事" } });
    store.applyCanvasPatch(s.sa, { addLink: { from: "two", to: "three" } });
    const links = store.buildSnapshot(s.sa, [], []).links;
    assert.deepEqual(links.map(l => [l.from, l.to, l.note]), [["one", "two", "这两段说的是同一件事"], ["two", "three", ""]], "说明是可选的");

    store.applyCanvasPatch(s.sa, { removeLink: links[0].id });
    assert.deepEqual(store.buildSnapshot(s.sa, [], []).links.map(l => l.id), [links[1].id]);
  } finally { s.done(); }
});

test("同两张卡片之间只有一条手动关联，再连一次是改说明", () => {
  const s = sandbox();
  try {
    store.applyCanvasPatch(s.sa, { addLink: { from: "one", to: "two", note: "先说这个" } });
    store.applyCanvasPatch(s.sa, { addLink: { from: "two", to: "one", note: "其实是同一件事" } });
    const links = store.readCanvasRecord(s.sa).links;
    assert.equal(links.length, 1, "同两张卡片之间不会叠出两条一模一样的线");
    assert.equal(links[0].note, "其实是同一件事");
  } finally { s.done(); }
});

test("手动关联、真实分叉、票据依赖在记录里是分开的三样", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-room.md": ticketBody("场地"), "02-opening.md": ticketBody("开场", "Blocked by: 01\n") });
    const sessions = [session("one", s.a), session("two", s.a)];
    store.applyCanvasPatch(s.sa, { origin: { sessionId: "two", originSessionId: "one", originEntryId: "e1" } });
    store.applyCanvasPatch(s.sa, { addLink: { from: "one", to: "two", note: "顺手连一下" } });

    const snapshot = store.buildSnapshot(s.sa, sessions, []);
    const fork = snapshot.nodes.find(n => n.id === "two");
    assert.equal(fork.origin.sessionId, "one", "真实分叉还是从会话历史来的");
    assert.deepEqual(snapshot.links.map(l => [l.from, l.to]), [["one", "two"]]);
    assert.equal(store.readCanvasRecord(s.sa).origins.two.entryId, "e1", "手动连一条不会把自己写成分叉来源");

    // 票据依赖来自票据正文的 Blocked by:，手动关联碰不到它。
    const opening = card(store.buildTicketSnapshot(s.sa, snapshot.nodes), "开场");
    assert.deepEqual(opening.blockers.map(b => b.number), ["01"]);
    store.applyCanvasPatch(s.sa, { addLink: { from: ".scratch/screening/issues/02-opening.md", to: "one", note: "回头看这段" } });
    assert.equal(card(store.buildTicketSnapshot(s.sa, snapshot.nodes), "开场").blockers.length, 1, "手动关联不会变成一条依赖");
  } finally { s.done(); }
});

test("改了会话标题，分组成员和手动关联都不受影响", () => {
  const s = sandbox();
  try {
    const before = [session("one", s.a), session("two", s.a)];
    store.buildSnapshot(s.sa, before, []);
    store.applyCanvasPatch(s.sa, { addGroup: { name: "开场", members: ["one", "two"] } });
    store.applyCanvasPatch(s.sa, { addLink: { from: "one", to: "two", note: "同一件事" } });

    // 关系认的是会话身份，不是它现在叫什么。
    const renamed = [session("one", s.a, { name: "开场怎么说" }), session("two", s.a, { name: "吃的准备什么" })];
    const after = store.buildSnapshot(s.sa, renamed, []);
    assert.deepEqual(after.nodes.map(n => n.title), ["开场怎么说", "吃的准备什么"]);
    assert.deepEqual(after.groups[0].members, ["one", "two"]);
    assert.deepEqual(after.links.map(l => [l.from, l.to, l.note]), [["one", "two", "同一件事"]]);
  } finally { s.done(); }
});

test("空成员的分组和指向自己的关联被拒", () => {
  const s = sandbox();
  try {
    store.applyCanvasPatch(s.sa, { addGroup: { name: "空的", members: [] } });
    store.applyCanvasPatch(s.sa, { addLink: { from: "one", to: "one" } });
    store.applyCanvasPatch(s.sa, { addLink: { from: "", to: "two" } });
    const record = store.readCanvasRecord(s.sa);
    assert.deepEqual(record.groups, []);
    assert.deepEqual(record.links, []);
  } finally { s.done(); }
});

test("收起的分组占的位置记在盘上，不会有别的卡片被摆到它头上", () => {
  const s = sandbox();
  try {
    // 成员还没有位置时，分组自己那张卡片得由快照分配一个——而且要写下来，
    // 否则下一次给票据分配位置时这块地方还算空的。
    store.applyCanvasPatch(s.sa, { addGroup: { name: "开场", members: ["one"] } });
    const id = store.readCanvasRecord(s.sa).groups[0].id;
    const placed = store.buildSnapshot(s.sa, [], []).groups[0].position;
    assert.deepEqual(store.readCanvasRecord(s.sa).nodes[id], placed, "分配到的位置要留在记录里");

    localMap(s.a, "screening", { "01-feeling.md": ticketBody("感受") });
    const ticket = card(store.buildTicketSnapshot(s.sa, []), "感受");
    assert.notDeepEqual(ticket.position, placed, "票据不会被摆在分组卡片头上");
  } finally { s.done(); }
});

test("解散分组把它占的地方还回去", () => {
  const s = sandbox();
  try {
    store.applyCanvasPatch(s.sa, { addGroup: { name: "开场", members: ["one"] } });
    const id = store.readCanvasRecord(s.sa).groups[0].id;
    store.buildSnapshot(s.sa, [], []);
    store.applyCanvasPatch(s.sa, { removeGroup: id });
    assert.equal(store.readCanvasRecord(s.sa).nodes[id], undefined, "解散之后它不该还占着一块画布");
  } finally { s.done(); }
});

// 一张地图的决策票全部关闭，是「该检查一下了」的时机，不是「地图完成了」的结论。
const mapOf = (scope, title = "放映会") => store.buildTicketSnapshot(scope, []).maps.find(m => m.title === title);
const cancelledBody = (title) => ticketBody(title).replace("Status: open", "Status: cancelled");

test("完整读到、票不为空、且全部关闭，才出现检查提示", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-room.md": resolvedBody("场地"), "02-opening.md": ticketBody("开场") });
    assert.equal(mapOf(s.sa).check, null, "还有票没关闭，就不是检查的时机");

    writeFileSync(join(s.a, ".scratch/screening/issues/02-opening.md"), resolvedBody("开场"));
    const check = mapOf(s.sa).check;
    assert.ok(check, "全部关闭了，提示一次「去核对目的地」");
    assert.equal(check.cancelled, 0);
    assert.equal(check.dismissed, false);
  } finally { s.done(); }
});

test("空地图不触发，读得不完整也不触发", () => {
  const s = sandbox();
  try {
    // 一张票都没有的地图：没有「全部关闭」这回事。
    localMap(s.a, "empty", {}, "# 空地图\n\n## Destination\n\n还没想好。\n");
    assert.equal(mapOf(s.sa, "空地图").check, null);

    // 同号多份：这张地图的票集合说不清，就不是完整读到。
    localMap(s.a, "screening", { "01-room.md": resolvedBody("场地"), "01-dup.md": resolvedBody("场地二") });
    assert.equal(mapOf(s.sa).check, null, "来源不完整时不宣告任何时机");
  } finally { s.done(); }
});

test("有取消的票也到检查时机，但取消的数目照实说出来", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-room.md": resolvedBody("场地"), "02-opening.md": cancelledBody("开场") });
    const check = mapOf(s.sa).check;
    assert.ok(check);
    assert.equal(check.cancelled, 1, "取消不算成功结论，界面得说得出有几张是取消的");
  } finally { s.done(); }
});

test("关掉检查提示记在记录里，重复读取和重启都不再弹，也能重新打开", () => {
  const s = sandbox();
  try {
    localMap(s.a, "screening", { "01-room.md": resolvedBody("场地") });
    const map = ".scratch/screening/map.md";
    assert.equal(mapOf(s.sa).check.dismissed, false);

    store.applyCanvasPatch(s.sa, { mapCheck: { map, dismissed: true } });
    // 又读了两次，包括刚起来的宿主读的那次：记录说关掉了，就一直是关掉的。
    for (const again of [mapOf(s.sa), mapOf(s.sa)]) assert.equal(again.check.dismissed, true);

    store.applyCanvasPatch(s.sa, { mapCheck: { map, dismissed: false } });
    assert.equal(mapOf(s.sa).check.dismissed, false, "可以主动重开");
  } finally { s.done(); }
});

test("有一条读不清的依赖，这张地图的票集合就不算读明白，什么都不宣布", () => {
  const s = sandbox();
  try {
    // 关闭了，但它自己写着的前提在这张地图里根本找不到：这条关系要在来源里核对。
    localMap(s.a, "screening", { "01-room.md": resolvedBody("场地", "Blocked by: 09\n") });
    assert.equal(mapOf(s.sa).check, null);

    localMap(s.a, "screening", { "01-room.md": resolvedBody("场地") });
    assert.ok(mapOf(s.sa).check, "关系读得清了，才轮到检查时机");
  } finally { s.done(); }
});
