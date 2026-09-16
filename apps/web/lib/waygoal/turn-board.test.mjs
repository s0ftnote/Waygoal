import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { projectTurnBoard, turnKey } = await jiti.import("./turn-board.ts");
const turn = (id, parentId = null, fingerprint = id) => ({ id, parentId, endId: id + "-a", entryIds: [id, id + "-a"], question: id, answer: "answer", kind: "turn", active: true, sources: [], fingerprint });
const session = (id, parent, entryId = "q-a") => ({ id, title: id, origin: parent ? { sessionId: parent, entryId, inWorkspace: true, title: parent } : null });
const tree = (sessionId, turns) => ({ sessionId, turns, activeLeafId: turns.at(-1)?.endId ?? null });
const empty = () => ({ positions: {}, links: [] });

test("only content-verified ancestors of a recorded fork share a visual card", () => {
  const sessions = [session("child", "root"), session("root"), session("unrelated")];
  const root = tree("root", [turn("q"), turn("later", "q")]);
  const child = tree("child", [turn("q"), turn("own", "q")]);
  const graph = projectTurnBoard(sessions, { root, child, unrelated: tree("unrelated", [turn("q")]) }, empty());
  assert.equal(graph.cards.length, 4);
  const shared = graph.cards.find(card => card.key === turnKey("root", "q"));
  assert.deepEqual(shared.members.map(member => member.sessionId), ["root", "child"]);
  assert.notEqual(graph.aliases.get(turnKey("unrelated", "q")), shared.key);
  assert.deepEqual(graph.edges.filter(edge => edge.kind === "fork").map(edge => [edge.from, edge.to]), [[shared.key, turnKey("child", "own")]]);
  child.turns[0].fingerprint = "different tool payload, same answer preview";
  assert.equal(projectTurnBoard(sessions, { root, child }, empty()).cards.length, 4);
  assert.equal(projectTurnBoard([session("root"), session("child", "root", null)], { root, child: tree("child", [turn("q")]) }, empty()).cards.length, 3);
});

test("multi-generation forks preserve memberships without treating a later sibling as inherited", () => {
  const sessions = [session("grandchild", "child", "own-a"), session("child", "root"), session("root")];
  const data = { root: tree("root", [turn("q"), turn("later", "q")]), child: tree("child", [turn("q"), turn("own", "q")]), grandchild: tree("grandchild", [turn("q"), turn("own", "q"), turn("third", "own")]) };
  const graph = projectTurnBoard(sessions, data, empty());
  assert.equal(graph.cards.length, 4);
  assert.equal(graph.cards.find(c => c.turn.id === "q").members.length, 3);
  assert.equal(graph.aliases.get(turnKey("grandchild", "own")), turnKey("child", "own"));
  const positions = Object.fromEntries(graph.cards.map(c => [c.key, c.position]));
  data.child.turns.push(turn("more", "own"));
  const after = projectTurnBoard(sessions, data, empty(), positions);
  for (const [key, point] of Object.entries(positions)) assert.deepEqual(after.cards.find(c => c.key === key).position, point);
});

test("cross-session references and manual links retain scoped endpoints and missing-source snapshots", () => {
  const source = { sessionId: "a", turnId: "q", scope: "answer", snapshot: "original captured answer", sharedSnapshot: false };
  const destination = { ...turn("q"), sources: [source] };
  const layout = { positions: { [turnKey("b", "q")]: { x: 22, y: 33 } }, links: [[turnKey("a", "q"), turnKey("b", "q")]] };
  const sessions = [session("a"), session("b")], data = { a: tree("a", [turn("q")]), b: tree("b", [destination]) };
  const graph = projectTurnBoard(sessions, data, layout);
  assert.equal(graph.cards.length, 2);
  assert.deepEqual(graph.cards.find(c => c.sessionId === "b").position, { x: 22, y: 33 });
  assert.deepEqual(graph.edges.map(e => e.kind), ["reference", "association"]);
  const missing = projectTurnBoard([session("b")], { b: data.b }, layout);
  assert.equal(missing.edges.find(e => e.kind === "reference").source.snapshot, "original captured answer");
});


test("new siblings avoid the saved positions of later-session cards", () => {
  const sessions = [session("root"), session("child", "root")];
  const data = { root: tree("root", [turn("q"), turn("main", "q")]), child: tree("child", [turn("q"), turn("branch", "q")]) };
  const before = projectTurnBoard(sessions, data, empty());
  const positions = Object.fromEntries(before.cards.map(card => [card.key, card.position]));
  data.root.turns.push(turn("sibling", "q"));
  const after = projectTurnBoard(sessions, data, empty(), positions);
  assert.equal(new Set(after.cards.map(card => JSON.stringify(card.position))).size, after.cards.length);
  for (const [key, point] of Object.entries(positions)) assert.deepEqual(after.cards.find(card => card.key === key).position, point);
});
