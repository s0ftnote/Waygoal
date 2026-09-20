import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const { retainChatAncestors } = await createJiti(import.meta.url).import("./retained-chat-history.ts");
const history = ids => ({ messages: ids.map(content => ({ role: "user", content })), entryIds: ids, oldestEntryId: ids[0] ?? null, hasMore: false });
test("refresh after a continuous send retains already-read ancestors and object identity", () => {
  const previous = history(["a", "b", "c"]), fresh = { ...history(["c", "d"]), hasMore: true };
  const merged = retainChatAncestors(previous, fresh);
  assert.deepEqual(merged.entryIds, ["a", "b", "c", "d"]);
  assert.equal(merged.messages[0], previous.messages[0]);
  assert.equal(merged.hasMore, false);
});
test("a different branch without a known overlap never inherits stale history", () => {
  const incoming = history(["new"]);
  assert.equal(retainChatAncestors(history(["old"]), incoming), incoming);
});
