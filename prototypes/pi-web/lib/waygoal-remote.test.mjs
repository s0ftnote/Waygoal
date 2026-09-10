import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("..", import.meta.url).pathname } });
const remote = await jiti.import("./waygoal-remote.ts");
const { readRemoteResult, remoteSourcePath, remoteTicketPath, supersedes } = remote;

/** What `gh issue view <n> --json …` really answers, kept from a read-only run
 *  against a real repository. Nothing here was written by a model. */
const GITHUB = JSON.stringify({
  number: 10,
  title: "远程原文也走同一票据入口",
  state: "OPEN",
  stateReason: "",
  url: "https://github.com/s0ftnote/Waygoal/issues/10",
  createdAt: "2026-09-10T06:37:20Z",
  updatedAt: "2026-09-10T06:37:20Z",
  author: { login: "s0ftnote" },
  body: "## What to build\n\n远程原文也走同一入口。\n\n## Blocked by\n\n- https://github.com/s0ftnote/Waygoal/issues/7\n",
  comments: [],
});

test("GitHub 结果按它自己的字段读出，正文一个字不改", () => {
  const read = readRemoteResult("github", GITHUB);
  assert.equal(read.format, "github");
  assert.equal(read.number, "10");
  assert.equal(read.title, "远程原文也走同一票据入口");
  assert.equal(read.status, "open");
  assert.equal(read.url, "https://github.com/s0ftnote/Waygoal/issues/10");
  assert.equal(read.updatedAt, "2026-09-10T06:37:20Z");
  assert.equal(read.body, JSON.parse(GITHUB).body);
  assert.equal(read.reason, null);
});

test("取到的空评论和根本没取评论不是一回事", () => {
  assert.deepEqual(readRemoteResult("github", GITHUB).comments, []);
  const withoutComments = JSON.parse(GITHUB);
  delete withoutComments.comments;
  assert.equal(readRemoteResult("github", JSON.stringify(withoutComments)).comments, null);
});

test("关掉的票分成做完了和不做了", () => {
  const done = { ...JSON.parse(GITHUB), state: "CLOSED", stateReason: "COMPLETED" };
  const dropped = { ...JSON.parse(GITHUB), state: "CLOSED", stateReason: "NOT_PLANNED" };
  assert.equal(readRemoteResult("github", JSON.stringify(done)).status, "resolved");
  assert.equal(readRemoteResult("github", JSON.stringify(dropped)).status, "cancelled");
});

test("前提按来源自己写的编号读出", () => {
  assert.deepEqual(readRemoteResult("github", GITHUB).blockers, ["7"]);
});

test("离线自定义样本走同一个入口", () => {
  const raw = JSON.stringify({
    tracker: "custom", id: "7", title: "场地要先定下来", state: "closed",
    updatedAt: "2026-09-01T00:00:00Z", body: "客厅还是外面租一间。", blockedBy: ["3"],
    comments: [{ author: "阿元", body: "客厅够坐。", createdAt: "2026-09-01T00:00:00Z" }],
  });
  const read = readRemoteResult("custom", raw);
  assert.equal(read.format, "custom");
  assert.equal(read.number, "7");
  assert.equal(read.status, "resolved");
  assert.equal(read.body, "客厅还是外面租一间。");
  assert.deepEqual(read.blockers, ["3"]);
  assert.equal(read.comments.length, 1);
  assert.equal(read.comments[0].author, "阿元");
});

test("不认识的格式明说未支持，不去猜正文", () => {
  const read = readRemoteResult("github", "#10 远程原文也走同一票据入口\nOPEN\n");
  assert.equal(read.format, "unknown");
  assert.equal(read.body, "");
  assert.match(read.reason, /--json/);
  const other = readRemoteResult("jira", JSON.stringify({ key: "AB-1" }));
  assert.equal(other.format, "unknown");
  assert.match(other.reason, /jira/);
});

test("相同裸编号在两个来源下是两张票", () => {
  const github = remoteTicketPath({ source: "github", origin: "s0ftnote/Waygoal", number: "7" });
  const custom = remoteTicketPath({ source: "custom", origin: "放映会", number: "7" });
  assert.notEqual(github, custom);
  assert.equal(remoteSourcePath({ source: "github", origin: "s0ftnote/Waygoal" }), "remote/github/s0ftnote/Waygoal");
  assert.equal(github, "remote/github/s0ftnote/Waygoal/7");
  for (const id of [github, custom]) {
    assert.ok(!id.startsWith("/") && !id.split("/").includes(".."));
  }
});

test("排先后要两边都有时间，缺一边就是顺序不明", () => {
  assert.equal(supersedes("2026-09-10T00:00:00Z", "2026-09-09T00:00:00Z"), true);
  assert.equal(supersedes("2026-09-10T00:00:00Z", "2026-09-10T00:00:00Z"), true);
  assert.equal(supersedes("2026-09-08T00:00:00Z", "2026-09-09T00:00:00Z"), false);
  // Either side missing its own time means nobody can say which came first.
  assert.equal(supersedes(null, "2026-09-09T00:00:00Z"), false);
  assert.equal(supersedes("2026-09-10T00:00:00Z", null), false);
  assert.equal(supersedes(null, null), false);
});
