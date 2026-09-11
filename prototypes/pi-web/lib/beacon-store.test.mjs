import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const { beaconSnapshot, parseTicket, safePath, section, saveBinding } = await createJiti(import.meta.url).import("./beacon-store.ts");
const { createBeaconExtension } = await createJiti(import.meta.url, { alias: { "@": new URL("..", import.meta.url).pathname } }).import("./beacon-extension.ts");
test("reads sections, scoped dependencies, answers and persistent session bindings", () => {
  const cwd = mkdtempSync(join(tmpdir(), "beacon-test-"));
  try {
    for (const effort of ["a", "b"]) {
      mkdirSync(join(cwd, ".scratch", effort, "issues"), { recursive: true });
      writeFileSync(join(cwd, ".scratch", effort, "map.md"), "# 地图\n\n## Destination\n\n一个方向\n\n## Notes\n\n规则\n");
    }
    const a = join(cwd, ".scratch/a/issues");
    writeFileSync(join(a, "01-first.md"), "# 先决问题\nType: grilling\nStatus: resolved\n\n## Answer\n\n真实回答\n");
    writeFileSync(join(a, "02-next.md"), "# 后续\nType: prototype\nStatus: open\nBlocked by: 01, 09\n\n## Question\n\n问题\n");
    writeFileSync(join(cwd, ".scratch/b/issues/01-first.md"), "# 同号不同图\nStatus: open\n");
    saveBinding(cwd, ".scratch/a/issues/01-first.md", { id: "real", path: "/session", started: true });
    let snapshot = beaconSnapshot(cwd);
    assert.equal(snapshot.maps[0].destination, "一个方向");
    assert.equal(snapshot.maps[0].tickets[0].answer, "真实回答");
    assert.equal(snapshot.maps[0].tickets[0].binding.id, "real");
    assert.equal(snapshot.maps[1].tickets[0].binding, undefined);
    assert.equal(snapshot.maps[0].tickets[1].blocked, true, "unknown dependency must remain blocked");
    writeFileSync(join(a, "09-last.md"), "# 最后\nStatus: resolved\n");
    snapshot = beaconSnapshot(cwd);
    assert.equal(snapshot.maps[0].tickets[1].blocked, false);
    writeFileSync(join(a, "09-duplicate.md"), "# 重复\nStatus: resolved\n");
    snapshot = beaconSnapshot(cwd);
    assert.equal(snapshot.maps[0].tickets[1].blocked, true, "ambiguous blocker must not unlock a ticket");
    assert.match(snapshot.maps[0].warnings[0], /重复/);
    assert.equal(section("## Answer\n\n结论\n", "Answer"), "结论");
    assert.equal(parseTicket("01-x.md", "# 标题\n**Type:** research\n").type, "research");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
test("does not follow tracker symlinks out of the chosen directory", () => {
  const cwd = mkdtempSync(join(tmpdir(), "beacon-test-"));
  const outside = mkdtempSync(join(tmpdir(), "beacon-outside-"));
  try {
    symlinkSync(outside, join(cwd, ".scratch"));
    assert.throws(() => beaconSnapshot(cwd), /工作目录/);
    writeFileSync(join(outside, "map.md"), "# 外面\n");
    assert.throws(() => safePath(cwd, join(cwd, ".scratch/map.md")), /工作目录/);
    assert.throws(() => safePath(cwd, join(cwd, "missing.md")), Error, "a file that is not there is not inside either");
  }
  finally { rmSync(cwd, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
test("extension emits once for actual ticket edits, never for session binding changes", () => {
  const cwd = mkdtempSync(join(tmpdir(), "beacon-events-"));
  try {
    mkdirSync(join(cwd, ".scratch/a/issues"), { recursive: true });
    writeFileSync(join(cwd, ".scratch/a/map.md"), "# Map\n");
    const path = join(cwd, ".scratch/a/issues/01-question.md");
    writeFileSync(path, "# Question\nStatus: open\n");
    beaconSnapshot(cwd);
    const handlers = {}, entries = [];
    createBeaconExtension(cwd)({ on: (name, handler) => { handlers[name] = handler; }, appendEntry: (type, data) => entries.push({ type, data }), registerTool: () => {} });
    saveBinding(cwd, ".scratch/a/issues/01-question.md", { id: "new", path: "/session", started: true });
    handlers.tool_result(); assert.equal(entries.length, 0);
    writeFileSync(path, "# Question\nStatus: resolved\n\n## Answer\nDone\n");
    handlers.tool_result(); handlers.agent_end();
    assert.equal(entries.length, 1); assert.equal(entries[0].type, "beacon:map-changed");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
