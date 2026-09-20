import assert from "node:assert/strict";
import test from "node:test";
import { materialSourceLabel, materialTextCharacters } from "./material-tray-presentation.ts";

const material = {
  sessionId: "session-a", turnId: "turn-b", scope: "answer",
  capturedAt: "2026-09-17T09:00:00.000Z", targetLeafId: null,
  parts: [{ entryId: "entry-c", role: "assistant", text: "你好😀\n A" }],
};

test("counts selected text only, including whitespace and Unicode code points, not tokens", () => {
  assert.equal(materialTextCharacters([]), 0);
  assert.equal(materialTextCharacters([material]), 6);
  assert.equal(materialTextCharacters([material, { ...material, parts: [
    { entryId: "d", role: "user", text: "abc" },
    { entryId: "e", role: "assistant", text: "" },
  ] }]), 9);
});

test("resolves the composite identity, never a turn from another session", () => {
  const labels = {
    "session-a:turn-b": { title: "探索方案", turnLabel: "第 2 轮 · 怎样验证？" },
    "other:turn-b": { title: "别的会话", turnLabel: "第 9 轮" },
  };
  assert.deepEqual(materialSourceLabel(material, labels), labels["session-a:turn-b"]);
});

test("missing or blank labels disclose unknown titles and preserve source IDs", () => {
  for (const labels of [undefined, {}, { "session-a:turn-b": { title: "  ", turnLabel: " " } }]) {
    const label = materialSourceLabel(material, labels);
    assert.match(label.title, /会话名称未知.*来源 ID：session-a/);
    assert.match(label.turnLabel, /轮次 \/ 问题未知.*来源 ID：turn-b/);
  }
  const label = materialSourceLabel(material, { "session-a:turn-b": { title: "已知会话" } });
  assert.equal(label.title, "已知会话");
  assert.match(label.turnLabel, /未知/);
  assert.deepEqual(materialSourceLabel({ ...material, sessionId: "", turnId: "" }), {
    title: "来源会话未知（缺少 ID）", turnLabel: "来源轮次未知（缺少 ID）",
  });
});

test("presentation does not mutate the saved snapshot", () => {
  const before = structuredClone(material);
  materialSourceLabel(material);
  materialTextCharacters([material]);
  assert.deepEqual(material, before);
});
