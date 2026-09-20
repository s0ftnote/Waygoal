import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { GET } = await createJiti(import.meta.url).import("./route.ts");
test("Waygoal reports its own release identity without consulting pi-web npm updates", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Update status must remain local"); };
  try {
    const response = await GET();
    const status = await response.json();
    assert.equal(response.status, 200);
    assert.equal(status.updateAvailable, false);
    assert.equal(status.latestVersion, status.currentVersion);
    assert.equal(status.releaseUrl, "https://github.com/s0ftnote/Waygoal/releases");
  } finally { globalThis.fetch = originalFetch; }
});
