import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const suites = [
  "waygoal", "waygoal-branches", "waygoal-tickets", "waygoal-ticket-talks",
  "waygoal-dependencies", "waygoal-find", "waygoal-workspaces",
  "waygoal-groups", "waygoal-map", "waygoal-remote",
];

// Suites share one Next development build and must release it before the next.
for (const suite of suites) {
  console.log(`\nRunning ${suite}`);
  const result = spawnSync(process.execPath, [join(directory, `${suite}.mjs`)], {
    cwd: dirname(directory), stdio: "inherit", env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`\nAll ${suites.length} Waygoal browser suites passed.`);
