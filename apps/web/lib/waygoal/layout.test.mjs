import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { arrangeCards, nextFreePosition } = await jiti.import("./layout.ts");
const { NODE_WIDTH: width, NODE_HEIGHT: height } = await jiti.import("./types.ts");
const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const card = (id, x, y, extra = {}) => ({ id, position: { x, y }, height, ...extra });

test("independent arrivals fill a compact area without moving earlier cards", () => {
  const taken = [];
  for (let i = 0; i < 36; i++) taken.push({ ...nextFreePosition(taken, height), width, height });
  assert.equal(Math.max(...taken.map(p => p.x)), 5 * (width + 70));
  assert.equal(Math.max(...taken.map(p => p.y)), 5 * (height + 60));
  for (let i = 0; i < taken.length; i++) for (const other of taken.slice(i + 1)) assert.equal(intersects(taken[i], other), false);
});

test("a new branch starts beside its source and avoids a tall occupied neighbor", () => {
  const source = { x: -1800, y: 2200 };
  const taken = [{ ...source, width, height }];
  const first = nextFreePosition(taken, height, source);
  assert.deepEqual(first, { x: source.x + width + 70, y: source.y });
  taken.push({ ...first, width, height: 550 });
  const before = structuredClone(taken);
  const next = nextFreePosition(taken, height, source);
  assert.ok(Math.abs(next.x - source.x) <= 2 * (width + 70));
  assert.equal(taken.some(box => intersects({ ...next, width, height }, box)), false);
  assert.deepEqual(taken, before);
});

test("local arrangement follows real branches and preserves unselected obstacles", () => {
  const selected = [card("source", 100, 100, { created: "1" }), card("child", 1200, 900, { originId: "source", created: "2" }), card("independent", 2300, 1400, { created: "3" })];
  const obstacles = [{ x: 420, y: 100, width, height: 800 }];
  const untouched = structuredClone({ selected, obstacles });
  const result = arrangeCards(selected, obstacles);
  assert.equal(result.child.x - result.source.x, width + 70);
  assert.equal(result.child.y, result.source.y);
  const boxes = selected.map(item => ({ ...result[item.id], width, height: item.height }));
  for (let i = 0; i < boxes.length; i++) for (const other of [...boxes.slice(i + 1), ...obstacles]) assert.equal(intersects(boxes[i], other), false);
  assert.deepEqual({ selected, obstacles }, untouched);
  assert.deepEqual(arrangeCards(selected, obstacles), result);
});

test("explicit groups stay together, mixed card heights do not overlap, and broken ancestry terminates", () => {
  const selected = [card("a", 0, 0, { groupId: "g", height: 500 }), card("loose", 400, 200), card("b", 800, 400, { groupId: "g" })];
  const result = arrangeCards(selected, []);
  assert.equal(result.a.x, result.b.x);
  assert.ok(result.b.y >= result.a.y + 500);
  const cyclic = arrangeCards([card("a", 0, 0, { originId: "b" }), card("b", 900, 500, { originId: "a" }), card("c", 1000, 700, { originId: "missing" })], []);
  assert.equal(Object.keys(cyclic).length, 3);
  assert.ok(Object.values(cyclic).every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});
