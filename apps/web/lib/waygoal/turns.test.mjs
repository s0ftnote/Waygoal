import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { projectTurns } = await jiti.import("./turns.ts");
const { materialPrompt, materialSources } = await jiti.import("./materials.ts");
const message = (id, parentId, role, text) => ({ type: "message", id, parentId, message: { role, content: [{ type: "text", text }] } });

test("continuous turns retain original identity as history grows and siblings are added", () => {
  const entries = [message("u1", null, "user", "origin"), message("a1", "u1", "assistant", "answer"), message("u2", "a1", "user", "A"), message("a2", "u2", "assistant", "reply A")];
  const before = projectTurns("session", entries, "a2");
  entries.push(message("u3", "a1", "user", "B"), message("a3", "u3", "assistant", "reply B"));
  const after = projectTurns("session", entries, "a3");
  assert.deepEqual(after.turns.map(t => t.id), ["u1", "u2", "u3"]);
  assert.deepEqual(after.turns.slice(0, 2).map(t => t.entryIds), before.turns.map(t => t.entryIds));
  assert.deepEqual(after.turns.map(t => t.active), [true, false, true]);
  assert.equal(after.turns[2].parentId, "u1");
  assert.equal(after.turns[1].answer, "reply A");
});

test("a sibling inside an answer never combines its text with the other path", () => {
  const entries = [message("u", null, "user", "question"), message("a", "u", "assistant", "first")];
  const before = projectTurns("s", entries, "a");
  entries.push(message("b", "u", "assistant", "second"));
  const result = projectTurns("s", entries, "b");
  assert.deepEqual(result.turns[0].entryIds, before.turns[0].entryIds);
  assert.deepEqual(result.turns.map(t => [t.answer, t.active]), [["first", false], ["second", true]]);
});

test("tool processes and compaction retain their own real source entries", () => {
  const entries = [message("u", null, "user", "question"), { type: "message", id: "process", parentId: "u", message: { role: "assistant", content: [{ type: "thinking", thinking: "hidden" }, { type: "toolCall", id: "call", name: "read", arguments: {} }] } }, message("tool", "process", "toolResult", "tool output"), message("answer", "tool", "assistant", "final"), { type: "compaction", id: "compact", parentId: "answer", summary: "short summary", firstKeptEntryId: "answer" }];
  const result = projectTurns("s", entries, "compact");
  assert.equal(result.turns[0].answer, "final");
  assert.deepEqual(result.turns[0].entryIds, ["u", "process", "tool", "answer"]);
  assert.equal(result.turns[1].kind, "compaction");
  assert.equal(result.turns[1].id, "compact");
});

test("sending preserves the reviewed snapshot and original scoped source identities", () => {
  const material = { sessionId: "fork", turnId: "same-id", scope: "answer", capturedAt: "2026-09-15T00:00:00Z", targetLeafId: "leaf", parts: [{ entryId: "answer", role: "assistant", text: "original\nsecond line" }] };
  const prompt = materialPrompt("continue", [material]);
  assert.ok(prompt.includes("> original\n> second line"));
  const parsed = materialSources(prompt);
  assert.equal(parsed.question, "continue");
  assert.equal(parsed.sources[0].sessionId, "fork");
  assert.equal(parsed.sources[0].turnId, "same-id");
  assert.equal(materialPrompt("ordinary", []), "ordinary");
  assert.equal(materialSources("not a reference").question, "not a reference");
});
