import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../", import.meta.url)) } });
const { collectBranchPoints, pathToEntry } = await jiti.import("./branches.ts");

// Projected tree shape, as GET /api/sessions/[id] returns it: single-child
// chains are contracted and their ids kept in `compressedEntryIds`.
function node(id, role, text, children = [], compressed = []) {
  return {
    entry: { id, type: "message", message: { role, content: text } },
    children,
    ...(compressed.length ? { compressedEntryIds: compressed } : {}),
    branchPreview: { role, text },
  };
}

test("a session with no branching has no branch points", () => {
  const tree = [node("u1", "user", "第一句", [node("a1", "assistant", "回答", [], ["u2"])])];
  assert.deepEqual(collectBranchPoints(tree, "a1"), []);
});

test("one branch point reports both paths, their leaves and which one is active", () => {
  const tree = [node("u1", "user", "共同来源", [
    node("a-left", "assistant", "观影方向", [node("left-leaf", "user", "继续观影", [], ["mid-left"])]),
    node("a-right", "assistant", "桌游方向", [node("right-leaf", "user", "继续桌游")]),
  ])];
  const points = collectBranchPoints(tree, "right-leaf");
  assert.equal(points.length, 1);
  const [point] = points;
  assert.equal(point.entryId, "u1");
  assert.equal(point.preview, "共同来源");
  assert.deepEqual(point.choices.map(c => c.entryId), ["a-left", "a-right"]);
  assert.deepEqual(point.choices.map(c => c.leafId), ["left-leaf", "right-leaf"]);
  assert.deepEqual(point.choices.map(c => c.preview), ["观影方向", "桌游方向"]);
  assert.deepEqual(point.choices.map(c => c.active), [false, true]);
});

test("the active leaf inside a contracted chain still marks its branch active", () => {
  const tree = [node("u1", "user", "来源", [
    node("a-left", "assistant", "左", [], ["hidden-left"]),
    node("a-right", "assistant", "右"),
  ])];
  const points = collectBranchPoints(tree, "hidden-left");
  assert.deepEqual(points[0].choices.map(c => c.active), [true, false]);
});

test("branching at the very first message is reported as a rootless branch point", () => {
  const tree = [node("r1", "user", "第一种开头"), node("r2", "user", "第二种开头")];
  const points = collectBranchPoints(tree, "r2");
  assert.equal(points.length, 1);
  assert.equal(points[0].entryId, null);
  assert.deepEqual(points[0].choices.map(c => c.active), [false, true]);
});

test("nested branch points are all reported, outermost first", () => {
  const tree = [node("u1", "user", "来源", [
    node("a-left", "assistant", "左", [
      node("l1", "user", "左一"),
      node("l2", "user", "左二"),
    ]),
    node("a-right", "assistant", "右"),
  ])];
  const points = collectBranchPoints(tree, "l2");
  assert.deepEqual(points.map(p => p.entryId), ["u1", "a-left"]);
  assert.deepEqual(points[0].choices.map(c => c.active), [true, false]);
  assert.deepEqual(points[1].choices.map(c => c.active), [false, true]);
});

test("an unknown active leaf marks no branch active instead of guessing one", () => {
  const tree = [node("u1", "user", "来源", [node("a", "assistant", "左"), node("b", "assistant", "右")])];
  const points = collectBranchPoints(tree, "not-in-this-session");
  assert.deepEqual(points[0].choices.map(c => c.active), [false, false]);
});

test("a linear chain thousands of entries deep does not overflow the stack", () => {
  let deepest = node("leaf", "user", "末尾");
  for (let i = 0; i < 20_000; i++) deepest = node(`n${i}`, "assistant", "中间", [deepest]);
  assert.doesNotThrow(() => collectBranchPoints([deepest], "leaf"));
});

test("pathToEntry returns the visible ancestors of an entry, ending with it", () => {
  const tree = [node("u1", "user", "来源", [
    node("a-left", "assistant", "左", [node("l1", "user", "左一")]),
    node("a-right", "assistant", "右"),
  ])];
  assert.deepEqual(pathToEntry(tree, "l1"), ["u1", "a-left", "l1"]);
  assert.deepEqual(pathToEntry(tree, "missing"), []);
});
