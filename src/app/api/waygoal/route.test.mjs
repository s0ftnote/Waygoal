import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": fileURLToPath(new URL("../../../", import.meta.url)) },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PATCH } = await jiti.import("./route.ts");
const ws = await jiti.import("../../../server/workspace/workspaces.ts");
const { readCanvasRecord } = await jiti.import("../../../server/canvas/store.ts");
const { invalidateSessionListCache, invalidateSessionPathCache } = await jiti.import("../../../server/sessions/session-reader.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");

function sandbox(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "waygoal-route-test-")));
  const cwd = join(root, "work"); mkdirSync(cwd);
  const agentDir = join(root, "agent"); mkdirSync(agentDir);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousRegistry = globalThis.__piSessions;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  globalThis.__piSessions = new Map();
  invalidateSessionListCache();
  const sessionIds = [];
  t.after(() => {
    for (const id of sessionIds) invalidateSessionPathCache(id);
    invalidateSessionListCache();
    globalThis.__piSessions = previousRegistry;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
  });
  const a = ws.scopeFor(cwd, null).canvasId;
  const b = ws.addCanvas(cwd, "B").id;
  ws.scopeFor(cwd, b);
  const scope = canvasId => ({ cwd, canvasId, agentDir });
  const patch = body => PATCH(new Request("http://localhost/api/waygoal", {
    method: "PATCH", body: JSON.stringify({ cwd, ...body }),
  }));
  const open = canvas => GET(new Request(`http://localhost/api/waygoal?${new URLSearchParams({ cwd, ...(canvas ? { canvas } : {}), force: "1" })}`));
  return { cwd, a, b, scope, patch, open, sessionIds };
}

test("PATCH writes the requested canvas without opening it", async t => {
  const s = sandbox(t);
  const before = ws.readWorkspaceRecord(s.cwd);
  const view = { x: 12, y: 34, scale: 1.5 };
  const response = await s.patch({ canvas: s.a, view });
  assert.equal(response.status, 200);
  assert.deepEqual(readCanvasRecord(s.scope(s.a)).view, view);
  assert.equal(readCanvasRecord(s.scope(s.b)).view, undefined);
  assert.deepEqual(ws.readWorkspaceRecord(s.cwd), before, "writing A must not change current B or rewrite the workspace");
});

test("a late fork registration belongs to A while current stays B", async t => {
  const s = sandbox(t);
  const manager = SessionManager.create(s.cwd);
  manager.appendMessage({ role: "user", content: "Fork fixture", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Ready" }], timestamp: Date.now() });
  const id = manager.getSessionId();
  s.sessionIds.push(id);
  const response = await s.patch({ canvas: s.a, registerSession: id, origin: { sessionId: id, originSessionId: "parent", originEntryId: "branch" } });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  const record = ws.readWorkspaceRecord(s.cwd);
  assert.equal(record.sessionCanvas[id], s.a, "late registration still belongs to its source canvas");
  const origin = readCanvasRecord(s.scope(s.a)).origins[id];
  assert.equal(origin.sessionId, "parent");
  assert.equal(origin.entryId, "branch");
  assert.equal(readCanvasRecord(s.scope(s.b)).origins[id], undefined);
  assert.equal(record.current, s.b, "registration is not navigation");
  const remembered = await s.open();
  assert.equal(remembered.status, 200);
  assert.equal((await remembered.json()).workspace.canvasId, s.b);
});

test("PATCH rejects an unknown canvas before writing or registering", async t => {
  const s = sandbox(t);
  const before = ws.readWorkspaceRecord(s.cwd);
  const response = await s.patch({ canvas: "unknown", registerSession: "fork", view: { x: 1, y: 2, scale: 1 } });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /这个工作目录里没有这张画布/);
  assert.deepEqual(ws.readWorkspaceRecord(s.cwd), before);
  assert.equal(readCanvasRecord(s.scope("unknown")).view, undefined);
});

test("GET still explicitly opens and remembers a canvas; PATCH without canvas uses it", async t => {
  const s = sandbox(t);
  const response = await s.open(s.a);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).workspace.canvasId, s.a);
  assert.equal(ws.readWorkspaceRecord(s.cwd).current, s.a);
  assert.equal(ws.rememberedWorkspace().cwd, s.cwd);
  assert.equal((await (await s.open()).json()).workspace.canvasId, s.a);
  const view = { x: 5, y: 6, scale: 2 };
  assert.equal((await s.patch({ view })).status, 200);
  assert.deepEqual(readCanvasRecord(s.scope(s.a)).view, view);
  assert.equal(ws.readWorkspaceRecord(s.cwd).current, s.a);
});
