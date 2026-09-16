import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Historical research evidence is refreshed only when explicitly requested.
export function evidenceDirectory(suite) {
  const base = process.env.WAYGOAL_EVIDENCE_DIR
    ? resolve(process.env.WAYGOAL_EVIDENCE_DIR)
    : join(root, "test-results", "waygoal");
  return join(base, suite);
}

// Legacy overview suites explicitly choose it; ordinary empty canvases open a composer.
export async function openOverview(page) {
  await page.locator('[data-canvas]').first().waitFor({ state: 'attached' });
  if (await page.locator('[data-empty-entry="true"]').count()) {
    await page.locator('.waygoal-workspace-menu > summary').click();
    await page.locator('.waygoal-workspace-controls').getByRole('button', { name: '查看会话与票据', exact: true }).click();
  }
}
