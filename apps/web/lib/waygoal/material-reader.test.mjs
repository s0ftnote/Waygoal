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
