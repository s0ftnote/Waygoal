import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../", import.meta.url)) } });
const ws = await jiti.import("./workspaces.ts");

function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "waygoal-ws-test-")));
  const agentDir = join(root, "agent"); mkdirSync(agentDir);
  // Two different directories that show the same name: identity is the path.
  const a = join(root, "one", "放映会"); mkdirSync(a, { recursive: true });
  const b = join(root, "two", "放映会"); mkdirSync(b, { recursive: true });
  return { root, agentDir, a, b, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("a working directory starts with one canvas, and that is the one shown", () => {
  const s = sandbox();
  try {
    const scope = ws.scopeFor(s.a, null, s.agentDir);
    const record = ws.readWorkspaceRecord(s.a, s.agentDir);
    assert.equal(record.canvases.length, 1);
    assert.equal(scope.canvasId, record.canvases[0].id);
    assert.equal(record.current, scope.canvasId);
    assert.equal(ws.scopeFor(s.a, null, s.agentDir).canvasId, scope.canvasId, "reading again is the same canvas, not a second one");
  } finally { s.done(); }
});

test("two canvases of the same name are two separate boards", () => {
  const s = sandbox();
  try {
    const first = ws.scopeFor(s.a, null, s.agentDir).canvasId;
    const one = ws.addCanvas(s.a, "选片", s.agentDir);
    const two = ws.addCanvas(s.a, "选片", s.agentDir);
    assert.notEqual(one.id, two.id, "the name is not the identity");
    assert.equal(ws.readWorkspaceRecord(s.a, s.agentDir).canvases.length, 3);
    assert.equal(ws.readWorkspaceRecord(s.a, s.agentDir).current, first, "making a canvas does not by itself change which one this directory is stopped on");
  } finally { s.done(); }
});

test("a discussion is on exactly one canvas, and one nobody registered lands on the first", () => {
  const s = sandbox();
  try {
    const on = canvasId => ({ cwd: s.a, canvasId, agentDir: s.agentDir });
    const first = ws.scopeFor(s.a, null, s.agentDir).canvasId;
    const second = ws.addCanvas(s.a, "选片", s.agentDir).id;
    ws.registerSession(on(second), "talk-2");
    assert.deepEqual(ws.claimSessionsOn(on(second), ["talk-9"]), [], "a new canvas has no chats instead of collecting the whole directory");
    assert.deepEqual(ws.claimSessionsOn(on(first), ["talk-1", "talk-2", "talk-3"]), ["talk-1", "talk-3"]);
    assert.deepEqual(ws.claimSessionsOn(on(second), ["talk-1", "talk-2", "talk-3"]), ["talk-2"]);
    // Being seen once is what fixes it: a session does not move by being read
    // from another canvas later.
    ws.claimSessionsOn(on(second), ["talk-1"]);
    assert.deepEqual(ws.claimSessionsOn(on(first), ["talk-1"]), ["talk-1"]);
    ws.registerSession(on(second), "talk-1");
    assert.deepEqual(ws.claimSessionsOn(on(first), ["talk-1"]), [], "and it is never on two boards at once");
  } finally { s.done(); }
});

test("switching says where it went, and refuses a canvas this directory does not have", () => {
  const s = sandbox();
  try {
    ws.scopeFor(s.a, null, s.agentDir);
    const second = ws.addCanvas(s.a, "选片", s.agentDir).id;
    const other = ws.addCanvas(s.b, "别处", s.agentDir).id;
    assert.equal(ws.scopeFor(s.a, second, s.agentDir).canvasId, second);
    assert.equal(ws.readWorkspaceRecord(s.a, s.agentDir).current, second, "the canvas last open here is remembered");
    assert.throws(() => ws.scopeFor(s.a, other, s.agentDir), /这个工作目录里没有/, "a canvas from another directory is not quietly swapped for one here");
    assert.throws(() => ws.scopeFor(s.a, "nope", s.agentDir), /这个工作目录里没有/);
  } finally { s.done(); }
});

test("two directories that look alike keep separate canvases and layouts", () => {
  const s = sandbox();
  try {
    ws.scopeFor(s.a, null, s.agentDir);
    ws.scopeFor(s.b, null, s.agentDir);
    ws.addCanvas(s.a, "选片", s.agentDir);
    assert.equal(ws.readWorkspaceRecord(s.a, s.agentDir).canvases.length, 2);
    assert.equal(ws.readWorkspaceRecord(s.b, s.agentDir).canvases.length, 1, "the same folder name is not the same workspace");
  } finally { s.done(); }
});

test("the directory last opened comes back, and one that is gone is reported instead of dropped or swapped", () => {
  const s = sandbox();
  try {
    assert.equal(ws.rememberedWorkspace(s.agentDir), null);
    ws.rememberWorkspace(s.a, s.agentDir);
    ws.rememberWorkspace(s.b, s.agentDir);
    assert.deepEqual(ws.rememberedWorkspace(s.agentDir), { cwd: s.b, missing: false });
    assert.deepEqual(ws.recentWorkspaces(s.agentDir), [{ cwd: s.b, missing: false }, { cwd: s.a, missing: false }], "most recently opened first");
    rmSync(s.b, { recursive: true, force: true });
    assert.deepEqual(ws.rememberedWorkspace(s.agentDir), { cwd: s.b, missing: true }, "it says which directory is gone rather than answering with another one");
    assert.deepEqual(ws.recentWorkspaces(s.agentDir), [{ cwd: s.b, missing: true }, { cwd: s.a, missing: false }],
      "and it stays on the list saying it is gone, rather than disappearing without a word");
  } finally { s.done(); }
});
