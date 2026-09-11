import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const { blockedByLine, parseTicket, safePath, section } = await createJiti(import.meta.url).import("./beacon-store.ts");
test("reads a ticket file's sections, fields and dependencies as written", () => {
  assert.equal(section("## Answer\n\n结论\n", "Answer"), "结论");
  assert.equal(parseTicket("01-x.md", "# 标题\n**Type:** research\n").type, "research");
  const ticket = parseTicket(".scratch/a/issues/02-next.md", "# 后续\nType: prototype\nStatus: Open\nBlocked by: 01, 09\n\n## Question\n\n问题\n");
  assert.deepEqual([ticket.number, ticket.status, ticket.question, ticket.blockers], ["02", "open", "问题", ["1", "9"]]);
  assert.deepEqual(blockedByLine("Blocked by: #3, #5\n"), ["3", "5"]);
});
test("does not follow tracker symlinks out of the chosen directory", () => {
  const cwd = mkdtempSync(join(tmpdir(), "waygoal-test-"));
  const outside = mkdtempSync(join(tmpdir(), "waygoal-outside-"));
  try {
    symlinkSync(outside, join(cwd, ".scratch"));
    writeFileSync(join(outside, "map.md"), "# 外面\n");
    assert.throws(() => safePath(cwd, join(cwd, ".scratch/map.md")), /工作目录/);
    assert.throws(() => safePath(cwd, join(cwd, "missing.md")), Error, "a file that is not there is not inside either");
  }
  finally { rmSync(cwd, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
