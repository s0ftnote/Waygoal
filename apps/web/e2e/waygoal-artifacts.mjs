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
