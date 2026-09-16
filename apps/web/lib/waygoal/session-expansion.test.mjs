import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { projectTurnBoard, turnKey } = await jiti.import("./turn-board.ts");
const { expandedTurns, placeExpandedSessions } = await jiti.import("./session-expansion.ts");
const turn = (id, parentId = null) => ({ id, parentId, endId: `${id}-a`, entryIds: [id, `${id}-a`], question: id, answer: "answer", kind: "turn", active: true, sources: [], fingerprint: id });
const root = { id: "root", title: "root", origin: null, position: { x: 0, y: 0 } };
const child = { id: "child", title: "child", origin: { sessionId: "root", entryId: "q-a" }, position: { x: 330, y: 0 } };
const data = { root: { turns: [turn("q"), turn("next", "q")] }, child: { turns: [turn("q"), turn("branch", "q")] } };

test("sessions start folded, and independent expansions retain the verified shared identities", () => {
  const graph = projectTurnBoard([root, child], data, { positions: {}, links: [] });
  assert.equal(expandedTurns(graph, [root, child], []).cards.length, 0);
  const both = expandedTurns(graph, [root, child], [root.id, child.id]);
  assert.equal(both.cards.length, 3);
  assert.equal(both.cards.filter(card => card.turn.id === "q").length, 1);
  const justChild = expandedTurns(graph, [root, child], [child.id]);
  assert.equal(justChild.cards.length, 2);
  assert.equal(justChild.cards.find(card => card.turn.id === "q").key, turnKey("root", "q"));
  assert.deepEqual(graph.cards[0].members.map(member => member.sessionId), ["root", "child"]);
});

test("expansion clears neighbours without overwriting their saved collapsed positions", () => {
  const sessions = [root, { ...child, position: { x: 0, y: 220 } }];
  const before = JSON.stringify(sessions);
  const open = placeExpandedSessions(sessions, { root: { width: 600, height: 700 } });
  assert.equal(open[0].position.x, 0);
  assert.ok(open[1].position.x >= 640);
  assert.equal(JSON.stringify(sessions), before);
  assert.deepEqual(placeExpandedSessions(sessions, {}), sessions);
});

test("dragging the first turn keeps its displacement after saving and reopening", () => {
  const layout = { positions: {}, links: [] };
  const before = expandedTurns(projectTurnBoard([root], data, layout), [root], [root.id]);
  const key = turnKey(root.id, "q");
  const movedLayout = { ...layout, positions: { [key]: { x: 35, y: 20 } }, sessionOrigins: before.bases };
  const after = expandedTurns(projectTurnBoard([root], data, movedLayout), [root], [root.id], movedLayout.sessionOrigins);
  assert.equal(after.cards.find(card => card.key === key).position.x - before.cards.find(card => card.key === key).position.x, 35);
  assert.equal(after.cards.find(card => card.key === key).position.y - before.cards.find(card => card.key === key).position.y, 20);
});
