import assert from "node:assert/strict";
import test from "node:test";
import { fileWorkspaceReducer } from "./file-workspace.ts";

const a = { path: "/work/a.md", cwd: "/work", sessionId: "origin" };
const b = { ...a, path: "/work/b.md" };
const act = (state, action, scope = "/work") => fileWorkspaceReducer(state, { scope, action });

test("reopening a file selects its existing tab and retains its source", () => {
  let state = act({}, { type: "open", file: a });
  state = act(state, { type: "open", file: b });
  state = act(state, { type: "open", file: { ...a, sessionId: "other-chat" } });
  assert.deepEqual(state['/work'].files, [a, b]);
  assert.equal(state['/work'].active, a.path);
});

test("hiding exits expanded reading without closing tabs or selecting another file", () => {
  let state = act({}, { type: "open", file: a });
  state = act(state, { type: "expand" });
  state = act(state, { type: "hide" });
  assert.deepEqual(state['/work'], { files: [a], active: a.path, visible: false, expanded: false });
  state = act(state, { type: "show" });
  assert.equal(state['/work'].active, a.path);
  assert.equal(state['/work'].visible, true);
});

test("closing active tabs selects a neighbor and the final close produces an empty reader", () => {
  let state = act(act({}, { type: "open", file: a }), { type: "open", file: b });
  state = act(state, { type: "close", path: b.path });
  assert.equal(state['/work'].active, a.path);
  state = act(state, { type: "close", path: a.path });
  assert.deepEqual(state['/work'].files, []);
  assert.equal(state['/work'].active, null);
  assert.equal(state['/work'].visible, true);
});

test("file actions are isolated by working directory", () => {
  const first = act({}, { type: "open", file: a });
  const second = act(first, { type: "open", file: b }, "/other");
  const hidden = act(second, { type: "hide" }, "/other");
  assert.equal(hidden['/work'], first['/work']);
  assert.equal(hidden['/other'].visible, false);
  assert.equal(first['/other'], undefined);
});
