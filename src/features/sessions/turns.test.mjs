import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { projectTurns } = await jiti.import("./turns.ts");
const { materialPrompt, materialSources, addMaterial } = await jiti.import("../materials/materials.ts");
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


test("overlapping material ranges are deduplicated on the review surface", () => {
  const base = { sessionId: "s", turnId: "a", scope: "answer", capturedAt: "now", targetLeafId: "leaf", parts: [{ entryId: "answer", role: "assistant", text: "whole answer" }] };
  const path = { ...base, turnId: "b", scope: "path", parts: [...base.parts, { entryId: "other", role: "user", text: "next" }] };
  const selected = addMaterial([base], path);
  assert.deepEqual(selected.flatMap(item => item.parts.map(part => part.entryId)), ["answer", "other"]);
});

test("a fork through metadata cannot overwrite another path's answer", () => {
  const entries = [message("u", null, "user", "question"), message("a", "u", "assistant", "first"), { type: "model_change", id: "model", parentId: "u", provider: "e2e", modelId: "other" }, message("b", "model", "assistant", "second")];
  assert.deepEqual(projectTurns("s", entries, "b").turns.map(turn => [turn.id, turn.answer, turn.active]), [["u", "first", false], ["b", "second", true]]);
});

test("each sent reference can show its exact frozen block without rereading sources", () => {
  const base = { sessionId: "a", turnId: "u", scope: "answer", capturedAt: "then", targetLeafId: "target", parts: [{ entryId: "answer", role: "assistant", text: "A原文\n#### 回答\n> preserved formatting" }] };
  const other = { ...base, sessionId: "b", parts: [{ entryId: "answer", role: "assistant", text: "B的独立原文" }] };
  const prompt = materialPrompt("combine", [base, other]);
  const parsed = materialSources(prompt);
  assert.equal(parsed.sources.length, 2);
  assert.ok(parsed.sources[0].snapshot.includes("A原文"));
  assert.ok(!parsed.sources[0].snapshot.includes("B的独立原文"));
  assert.ok(parsed.sources[1].snapshot.includes("B的独立原文"));
  base.parts[0].text = "changed later";
  assert.ok(materialSources(prompt).sources[0].snapshot.includes("A原文"));
  assert.ok(parsed.sources.every(source => !source.sharedSnapshot));
  const legacy = 'question\n\n<!-- waygoal-materials:[{"sessionId":"a","turnId":"u","scope":"answer"}] -->\n\n### 引用材料\n\nlegacy captured body';
  assert.equal(materialSources(legacy).sources[0].snapshot, "legacy captured body");
  assert.equal(materialSources(legacy).sources[0].sharedSnapshot, true);
});

test("transcript system messages and context edits preserve ancestry without creating cards", () => {
  const entries = [
    message("sys", null, "system", "private prompt"),
    message("u", "sys", "user", "question"),
    message("a", "u", "assistant", "original answer"),
    { type: "usage", id: "warm", parentId: "a", kind: "cache_warm" },
    message("sys2", "warm", "system", "new tool schemas"),
    { type: "context_edit", id: "edit", parentId: "sys2", targetId: "a", replacement: null },
    message("next", "edit", "user", "next question"),
  ];
  const result = projectTurns("s", entries, "next");
  assert.deepEqual(result.turns.map(turn => turn.id), ["u", "next"]);
  assert.deepEqual(result.turns[0].entryIds, ["u", "a"]);
  assert.equal(result.turns[0].answer, "original answer");
  assert.equal(result.turns[1].parentId, "u");
  assert.equal(result.parentById.sys2, "warm");
  assert.equal(result.entryToTurn.edit, "u");
});
