import assert from "node:assert/strict";
import test from "node:test";
import { consumeMaterials } from "./materials.ts";

const material = { sessionId: "source", turnId: "turn", scope: "answer", capturedAt: "now", targetLeafId: "leaf", parts: [{ entryId: "a", role: "assistant", text: "original" }] };

test("an ordinary or fork prompt cannot consume another composer's restored tray", () => {
  const restored = [material];
  assert.equal(consumeMaterials(restored, []), restored);
  assert.equal(consumeMaterials(restored, [{ ...material, targetLeafId: "other" }]), restored);
});

test("late acceptance consumes only the actual submitted snapshots, including parked copies", () => {
  const recaptured = { ...material, capturedAt: "later" };
  const current = [material, recaptured];
  assert.deepEqual(consumeMaterials(current, [material]), [recaptured]);
  assert.deepEqual(consumeMaterials([material], [material]), []);
  assert.deepEqual(current, [material, recaptured]);
});
