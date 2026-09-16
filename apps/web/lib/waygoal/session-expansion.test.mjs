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
  assert.equal(justChild.cards.length, 1);
  assert.equal(justChild.cards[0].turn.id, "branch");
  assert.equal(graph.edges.find(edge => edge.kind === "fork").from, turnKey("root", "q"));
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

test("removing a shared source reveals inherited history below its own session header", () => {
  const sessions = [root, child];
  const layout = { positions: {}, links: [] };
  const beforeGraph = projectTurnBoard(sessions, data, layout);
  const before = expandedTurns(beforeGraph, sessions, [child.id]);
  const saved = { ...layout, positions: Object.fromEntries(beforeGraph.cards.map(card => [card.key, card.position])), sessionOrigins: before.bases };
  // The source is no longer on this canvas. The child's inherited turn now
  // becomes visible under its own identity, before its previously visible tail.
  const after = expandedTurns(projectTurnBoard([child], data, saved), [child], [child.id], saved.sessionOrigins);
  assert.equal(after.cards.length, 2);
  assert.ok(after.cards.every(card => card.position.x >= child.position.x && card.position.y >= child.position.y + 80), "restored history must not appear above or left of its session header");
});

test("either sibling can display the shared prefix when its common source is absent", () => {
  const a = { ...root, id: 'a', origin: {sessionId:'outside', entryId:'q-a'} };
  const b = { ...child, id: 'b', origin: {sessionId:'outside', entryId:'q-a'} };
  const sessions = [a,b], data = {a:{turns:[turn('q')]},b:{turns:[turn('q')]}};
  const graph = projectTurnBoard(sessions, data, {positions:{},links:[]});
  const onlyB = expandedTurns(graph,sessions,['b']);
  assert.equal(onlyB.cards.length,1);
  assert.equal(onlyB.owners.get(onlyB.cards[0].key),'b');
  assert.equal(onlyB.cards[0].position.y,b.position.y+80);
});
