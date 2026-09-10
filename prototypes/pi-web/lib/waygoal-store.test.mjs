import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("..", import.meta.url).pathname } });
const store = await jiti.import("./waygoal-store.ts");
const { createBeaconExtension, MISSING_SKILL_NOTICE, parseSkillCommand } = await jiti.import("./beacon-extension.ts");

function session(id, cwd, extra = {}) {
  return { id, path: `/sessions/${id}.jsonl`, cwd, created: "2026-09-01T00:00:00.000Z", modified: "2026-09-02T00:00:00.000Z", messageCount: 2, firstMessage: `first ${id}`, ...extra };
}
function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "waygoal-test-")));
  const agentDir = join(root, "agent"); mkdirSync(agentDir);
  const a = join(root, "work-a"); mkdirSync(a);
  const b = join(root, "work-b"); mkdirSync(b);
  return { root, agentDir, a, b, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("workspace identity and records are isolated per working directory", () => {
  const s = sandbox();
  try {
    assert.notEqual(store.workspaceId(s.a), store.workspaceId(s.b));
    assert.match(store.workspaceId(s.a), /^work-a-[0-9a-f]{12}$/);
    store.applyCanvasPatch(s.a, { view: { x: 1, y: 2, scale: 1.5 } }, s.agentDir);
    assert.equal(store.readCanvasRecord(s.b, s.agentDir).view, undefined);
    assert.deepEqual(store.readCanvasRecord(s.a, s.agentDir).view, { x: 1, y: 2, scale: 1.5 });
    assert.ok(existsSync(join(s.agentDir, "waygoal/workspaces", store.workspaceId(s.a), "canvas.json")), "record lives in the Pi data dir, not next to plugin code");
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
    const snap = store.buildSnapshot(s.a, sessions, ["plain"], s.agentDir);
    assert.deepEqual(snap.nodes.map(n => n.id).sort(), ["empty", "named", "plain"]);
    const byId = Object.fromEntries(snap.nodes.map(n => [n.id, n]));
    assert.equal(byId.named.title, "已存标题"); assert.equal(byId.named.titleSource, "name");
    assert.equal(byId.named.transient, false, "disk-backed copy wins over the transient duplicate");
    assert.equal(byId.plain.titleSource, "fallback"); assert.ok(byId.plain.title.length <= 73);
    assert.equal(byId.plain.running, true); assert.equal(byId.named.running, false);
    assert.equal(byId.empty.titleSource, "empty");
    const positions = snap.nodes.map(n => `${n.position.x},${n.position.y}`);
    assert.equal(new Set(positions).size, 3, "new nodes get distinct positions");
    const again = store.buildSnapshot(s.a, sessions, [], s.agentDir);
    assert.deepEqual(again.nodes.map(n => n.position), snap.nodes.map(n => n.position), "positions persist across discoveries");
    assert.equal(store.buildSnapshot(s.b, sessions, [], s.agentDir).nodes.map(n => n.id).join(), "other");
  } finally { s.done(); }
});

test("patches restore positions, view and last viewed; missing last viewed is reported", () => {
  const s = sandbox();
  try {
    const sessions = [session("one", s.a), session("two", s.a)];
    store.buildSnapshot(s.a, sessions, [], s.agentDir);
    store.applyCanvasPatch(s.a, { positions: { one: { x: 900, y: 40 } }, view: { x: -10, y: 5, scale: 0.8 }, lastViewed: "two" }, s.agentDir);
    let snap = store.buildSnapshot(s.a, sessions, [], s.agentDir);
    assert.deepEqual(snap.nodes.find(n => n.id === "one").position, { x: 900, y: 40 });
    assert.deepEqual(snap.view, { x: -10, y: 5, scale: 0.8 });
    assert.equal(snap.lastViewed, "two"); assert.equal(snap.lastViewedMissing, false);
    snap = store.buildSnapshot(s.a, [sessions[0]], [], s.agentDir);
    assert.equal(snap.lastViewedMissing, true);
    store.applyCanvasPatch(s.a, { lastViewed: null }, s.agentDir);
    assert.equal(store.buildSnapshot(s.a, sessions, [], s.agentDir).lastViewed, null);
  } finally { s.done(); }
});

test("a corrupt record is tolerated instead of breaking the canvas", () => {
  const s = sandbox();
  try {
    mkdirSync(store.workspaceDir(s.a, s.agentDir), { recursive: true });
    writeFileSync(join(store.workspaceDir(s.a, s.agentDir), "canvas.json"), "{ not json");
    const snap = store.buildSnapshot(s.a, [session("one", s.a)], [], s.agentDir);
    assert.equal(snap.nodes.length, 1);
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(store.workspaceDir(s.a, s.agentDir), "canvas.json"), "utf8")));
  } finally { s.done(); }
});

test("nextFreePosition avoids occupied slots", () => {
  const first = store.nextFreePosition([]);
  const second = store.nextFreePosition([first]);
  assert.notDeepEqual(first, second);
  assert.ok(Math.abs(first.x - second.x) >= store.NODE_WIDTH || Math.abs(first.y - second.y) >= store.NODE_HEIGHT);
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
    store.buildSnapshot(s.a, sessions, [], s.agentDir);
    store.applyCanvasPatch(s.a, { origin: { sessionId: "forked", originSessionId: "origin", originEntryId: "u7" } }, s.agentDir);
    const node = store.buildSnapshot(s.a, sessions, [], s.agentDir).nodes.find(n => n.id === "forked");
    assert.deepEqual(node.origin, { sessionId: "origin", entryId: "u7", inWorkspace: true, title: "共同来源" });
    assert.equal(store.buildSnapshot(s.a, sessions, [], s.agentDir).nodes.find(n => n.id === "origin").origin, null);
  } finally { s.done(); }
});

test("a fork made outside Waygoal reports the source session with no message position", () => {
  const s = sandbox();
  try {
    // Pi's header only records parentSession, never the entry it was forked at.
    const sessions = [session("origin", s.a), session("forked", s.a, { parentSessionId: "origin", relation: { kind: "fork", originSessionId: "origin" } })];
    const node = store.buildSnapshot(s.a, sessions, [], s.agentDir).nodes.find(n => n.id === "forked");
    assert.deepEqual(node.origin, { sessionId: "origin", entryId: null, inWorkspace: true, title: "first origin" });
  } finally { s.done(); }
});

test("an origin outside this workspace is reported as such, not matched by title", () => {
  const s = sandbox();
  try {
    const sessions = [session("forked", s.a), session("origin", s.b, { name: "first forked" })];
    store.applyCanvasPatch(s.a, { origin: { sessionId: "forked", originSessionId: "origin", originEntryId: "u1" } }, s.agentDir);
    const node = store.buildSnapshot(s.a, sessions, [], s.agentDir).nodes.find(n => n.id === "forked");
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
    ]) store.applyCanvasPatch(s.a, { origin }, s.agentDir);
    assert.deepEqual(store.readCanvasRecord(s.a, s.agentDir).origins, {});
  } finally { s.done(); }
});

test("the last viewed position keeps its entry, and drops it with its session", () => {
  const s = sandbox();
  try {
    const sessions = [session("one", s.a), session("two", s.a)];
    store.applyCanvasPatch(s.a, { lastViewed: "two", lastViewedEntry: "a3" }, s.agentDir);
    let snap = store.buildSnapshot(s.a, sessions, [], s.agentDir);
    assert.equal(snap.lastViewed, "two"); assert.equal(snap.lastViewedEntry, "a3");
    snap = store.buildSnapshot(s.a, [sessions[0]], [], s.agentDir);
    assert.equal(snap.lastViewedMissing, true);
    assert.equal(snap.lastViewedEntry, null, "a missing session must not carry a position into another one");
    store.applyCanvasPatch(s.a, { lastViewedEntry: null }, s.agentDir);
    assert.equal(store.buildSnapshot(s.a, sessions, [], s.agentDir).lastViewedEntry, null);
  } finally { s.done(); }
});

test("branch counts and the active leaf come from the real tree, not from the record", () => {
  const s = sandbox();
  try {
    const sessions = [session("one", s.a), session("two", s.a)];
    const trees = new Map([["one", { activeLeafId: "a9", branchPointCount: 2 }]]);
    const byId = Object.fromEntries(store.buildSnapshot(s.a, sessions, [], s.agentDir, trees).nodes.map(n => [n.id, n]));
    assert.equal(byId.one.branchPointCount, 2); assert.equal(byId.one.activeLeafId, "a9");
    assert.equal(byId.two.branchPointCount, 0); assert.equal(byId.two.activeLeafId, null);
  } finally { s.done(); }
});
