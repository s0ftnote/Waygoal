import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("..", import.meta.url).pathname } });
const store = await jiti.import("./waygoal-store.ts");
const { createBeaconExtension, MISSING_SKILL_NOTICE, parseSkillCommand } = await jiti.import("./beacon-extension.ts");
const workspaces = await jiti.import("./waygoal-workspaces.ts");
const paths = await jiti.import("./waygoal-paths.ts");

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
    store.applyCanvasPatch(other, { view: { x: 9, y: 9, scale: 0.5 }, registerSession: "two" });
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

test("extension: unknown /skill: gets feedback and is not sent; known skills pass through", async () => {
  const s = sandbox();
  try {
    const handlers = {};
    const pi = { on: (name, fn) => { handlers[name] = fn; }, appendEntry() {} };
    createBeaconExtension(s.a, async () => ["e2e-skill"])(pi);
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
const { TICKET_CARD_HEIGHT } = await jiti.import("./waygoal-types.ts");
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
    assert.deepEqual(store.readCanvasRecord(s.sa).ticketSessions, {});

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
