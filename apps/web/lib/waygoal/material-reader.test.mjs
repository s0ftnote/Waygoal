import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../../", import.meta.url).pathname } });
const { captureMaterial } = await jiti.import("./material-reader.ts");
const { cacheSessionPath } = await jiti.import("../session-reader.ts");
const answer = text => ({ role: "assistant", content: [{ type: "text", text }], api: "openai-completions", provider: "e2e", model: "model", timestamp: Date.now(), stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

test("turn and path material include visible extension text without hidden content or images", async () => {
  const root = mkdtempSync(join(tmpdir(), "waygoal-visible-material-unit-"));
  try {
    const source = SessionManager.create(root, join(root, "sessions"));
    const userId = source.appendMessage({ role: "user", content: "question", timestamp: Date.now() });
    const answerId = source.appendMessage(answer("answer"));
    const plainId = source.appendCustomMessageEntry("evidence", "visible evidence", true);
    const blocksId = source.appendCustomMessageEntry("evidence", [
      { type: "text", text: "visible text block" },
      { type: "image", data: "image-payload", mimeType: "image/png" },
    ], true);
    source.appendCustomMessageEntry("hidden", "hidden extension text", false);
    source.appendCustomEntry("internal", { text: "internal metadata" });
    const target = SessionManager.create(root, join(root, "targets"));
    target.appendMessage({ role: "user", content: "destination", timestamp: Date.now() });
    target.appendMessage(answer("ready"));
    for (const session of [source, target]) cacheSessionPath(session.getSessionId(), session.getSessionFile());
    for (const scope of ["turn", "path"]) {
      const material = await captureMaterial(source.getSessionId(), userId, target.getSessionId(), scope);
      assert.deepEqual(material.parts.map(part => [part.entryId, part.text]), [
        [userId, "question"], [answerId, "answer"], [plainId, "visible evidence"], [blocksId, "visible text block"],
      ]);
    }
    const onlyAnswer = await captureMaterial(source.getSessionId(), userId, target.getSessionId(), "answer");
    assert.deepEqual(onlyAnswer.parts.map(part => part.entryId), [answerId]);
    const onlyUser = await captureMaterial(source.getSessionId(), userId, target.getSessionId(), "user");
    assert.deepEqual(onlyUser.parts.map(part => part.entryId), [userId]);
    await assert.rejects(captureMaterial(source.getSessionId(), userId, source.getSessionId(), "path"), /已在当前有效上下文/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("capture follows SDK compaction, scopes copied IDs by session, and freezes text", async () => {
  const root = mkdtempSync(join(tmpdir(), "waygoal-material-unit-"));
  try {
    const source = SessionManager.create(root, join(root, "sessions"));
    const u1 = source.appendMessage({ role: "user", content: "original", timestamp: Date.now() });
    const a1 = source.appendMessage(answer("original answer"));
    const u2 = source.appendMessage({ role: "user", content: "kept", timestamp: Date.now() });
    source.appendMessage(answer("kept answer"));
    source.appendCompaction("summary", u2, 100);
    cacheSessionPath(source.getSessionId(), source.getSessionFile());
    const captured = await captureMaterial(source.getSessionId(), u1, source.getSessionId(), "answer");
    assert.deepEqual(captured.parts.map(part => part.entryId), [a1]);
    assert.equal(captured.parts[0].text, "original answer");
    await assert.rejects(captureMaterial(source.getSessionId(), u2, source.getSessionId(), "turn"), /已在当前有效上下文/);
    const forkSource = SessionManager.open(source.getSessionFile());
    const forkFile = forkSource.createBranchedSession(a1);
    const fork = SessionManager.open(forkFile);
    cacheSessionPath(fork.getSessionId(), forkFile);
    const crossFile = await captureMaterial(source.getSessionId(), u1, fork.getSessionId(), "answer");
    assert.equal(crossFile.parts[0].entryId, a1);
    assert.equal(crossFile.sessionId, source.getSessionId());
    assert.notEqual(crossFile.sessionId, fork.getSessionId());
    const excerpt = await captureMaterial(source.getSessionId(), u1, fork.getSessionId(), "excerpt", "original");
    assert.equal(excerpt.parts[0].text, "original");
    await assert.rejects(captureMaterial(source.getSessionId(), u1, fork.getSessionId(), "excerpt", "invented quote"));
    source.appendMessage(answer("a later answer"));
    assert.equal(captured.parts[0].text, "original answer");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
