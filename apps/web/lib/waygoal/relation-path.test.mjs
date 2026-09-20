import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const { relationPath } = await createJiti(import.meta.url).import("./relation-path.ts");
const box = (x, y) => ({ x, y, width: 250, height: 180 });

test("a prerequisite above its dependent docks bottom to top", () => {
  const path = relationPath(box(300, 0), box(300, 400));
  assert.equal(path.horizontal, false);
  assert.deepEqual(path.start, { x: 425, y: 188 });
  assert.deepEqual(path.end, { x: 425, y: 392 });
});
test("moving a dependent above or left preserves source to target direction", () => {
  const up = relationPath(box(300, 400), box(300, 0));
  assert.ok(up.start.y > up.end.y);
  assert.equal(up.end.y, 188);
  const left = relationPath(box(600, 0), box(0, 0));
  assert.equal(left.horizontal, true);
  assert.equal(left.start.x, 592);
  assert.equal(left.end.x, 258);
});
test("diagonal and unequal cards dock outside actual card bounds", () => {
  const target = { x: 700, y: 300, width: 300, height: 220 };
  const path = relationPath(box(0, 0), target);
  assert.deepEqual(path.end, { x: 692, y: 410 });
  assert.ok(path.d.endsWith(`${path.end.x} ${path.end.y}`));
});

test("overlapping columns use the open vertical gap instead of crossing a ticket", () => {
  const from = {x: 400, y: 120, width: 250, height: 178};
  const to = {x: 170, y: 350, width: 250, height: 152};
  const path = relationPath(from, to);
  assert.equal(path.horizontal, false);
  assert.equal(path.start.y, 306);
  assert.equal(path.end.y, 342);
  assert.ok(path.start.y < path.end.y);
});
