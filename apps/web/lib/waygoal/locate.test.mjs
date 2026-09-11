import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../", import.meta.url)) } });
const { cardBounds, cardCenter, findByTitle, recentSessions, thumbnail, viewCenteredOn, worldPoint } = await jiti.import("./locate.ts");
const { NODE_HEIGHT, NODE_WIDTH } = await jiti.import("./types.ts");

const session = (id, title, modified, position = { x: 0, y: 0 }) =>
  ({ id, title, kind: "session", position, height: NODE_HEIGHT, modified });
const ticket = (id, title, position = { x: 0, y: 0 }, height = 300) =>
  ({ id, title, kind: "ticket", position, height, modified: null });

test("finding a discussion by title matches what was typed, in any case, and never invents one", () => {
  const cards = [
    session("a", "开场怎么说", "2026-09-08T10:00:00.000Z"),
    session("b", "Film night opening", "2026-09-09T10:00:00.000Z"),
    ticket("t", "开场这张票"),
  ];
  assert.deepEqual(findByTitle(cards, "开场").map(c => c.id), ["a", "t"], "titles that contain it, sessions first by when they changed");
  assert.deepEqual(findByTitle(cards, "OPENING").map(c => c.id), ["b"], "matching ignores case");
  assert.deepEqual(findByTitle(cards, "  ").map(c => c.id), [], "nothing typed matches nothing");
  assert.deepEqual(findByTitle(cards, "散场").map(c => c.id), [], "no match is no match, not a near one");
});

test("the most recently touched discussion comes first, and only sessions have a last time", () => {
  const cards = [
    session("old", "很久以前那段", "2026-09-01T10:00:00.000Z"),
    session("new", "刚聊过那段", "2026-09-09T10:00:00.000Z"),
    ticket("t", "一张票"),
  ];
  assert.deepEqual(recentSessions(cards).map(c => c.id), ["new", "old"]);
  assert.deepEqual(recentSessions(cards, 1).map(c => c.id), ["new"]);
  assert.deepEqual(findByTitle(cards, "那段").map(c => c.id), ["new", "old"]);
});

test("the canvas bounds count how tall each card really is", () => {
  const cards = [session("a", "会话", "2026-09-09T10:00:00.000Z", { x: 0, y: 0 }), ticket("t", "票据", { x: 400, y: 100 }, 300)];
  assert.deepEqual(cardBounds(cards), { x: 0, y: 0, width: 400 + NODE_WIDTH, height: 400 });
  assert.equal(cardBounds([]), null);
  assert.deepEqual(cardCenter(cards[1]), { x: 400 + NODE_WIDTH / 2, y: 250 });
});

test("locating a discussion moves the view and changes nothing else", () => {
  const view = { x: 0, y: 0, scale: 0.5 };
  const viewport = { width: 800, height: 600 };
  const next = viewCenteredOn({ x: 1000, y: 400 }, view, viewport);
  assert.equal(next.scale, 0.5, "the scale the user chose is kept");
  assert.deepEqual(next, { x: 400 - 500, y: 300 - 200, scale: 0.5 });
  // Centred means centred: the point lands in the middle of the viewport.
  assert.deepEqual([1000 * next.scale + next.x, 400 * next.scale + next.y], [400, 300]);
});

test("the thumbnail holds every card and says where the viewport is", () => {
  const cards = [session("a", "会话", "2026-09-09T10:00:00.000Z", { x: 0, y: 0 }), session("b", "另一段", "2026-09-09T10:00:00.000Z", { x: 900, y: 600 })];
  const view = { x: -40, y: -30, scale: 1 };
  const thumb = thumbnail(cards, view, { width: 800, height: 600 }, { width: 160, height: 120 });
  assert.ok(thumb.cards.every(c => c.x >= 0 && c.y >= 0 && c.x + c.width <= 160.001 && c.y + c.height <= 120.001), JSON.stringify(thumb.cards));
  assert.deepEqual(thumb.cards.map(c => c.id), ["a", "b"]);
  assert.ok(thumb.view.width > 0 && thumb.view.height > 0, "the viewport is drawn as a box, not a point");
  // A click on the thumbnail reads back as the place on the canvas it covers.
  assert.deepEqual(worldPoint(thumb, { x: 0, y: 0 }), { x: thumb.origin.x, y: thumb.origin.y });
  const middle = worldPoint(thumb, { x: thumb.cards[1].x + thumb.cards[1].width / 2, y: thumb.cards[1].y + thumb.cards[1].height / 2 });
  assert.ok(Math.abs(middle.x - (900 + NODE_WIDTH / 2)) < 1 && Math.abs(middle.y - (600 + NODE_HEIGHT / 2)) < 1, JSON.stringify(middle));
  assert.equal(thumbnail([], view, { width: 800, height: 600 }, { width: 160, height: 120 }), null);
});
