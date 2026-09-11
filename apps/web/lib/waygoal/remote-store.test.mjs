import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../../", import.meta.url)) } });
const store = await jiti.import("./remote-store.ts");
const { deliverRemoteTicket, readRemoteDeliveries, remoteMapViews, retryRemoteCapture } = store;

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "waygoal-remote-"));
  const ref = { cwd: join(root, "work"), agentDir: join(root, "agent") };
  mkdirSync(ref.cwd, { recursive: true });
  mkdirSync(ref.agentDir, { recursive: true });
  return { root, ref, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const github = (fields = {}) => JSON.stringify({
  number: 10, title: "远程原文也走同一票据入口", state: "OPEN", stateReason: "",
  url: "https://github.com/s0ftnote/Waygoal/issues/10", updatedAt: "2026-09-10T06:37:20Z",
  body: "## What to build\n\n远程原文也走同一入口。\n", comments: [], ...fields,
});

const ticketsOf = (views) => views.flatMap(view => view.tickets);

test("交付只说来源和引用，正文是程序自己去读的", (t) => {
  const { ref, cleanup } = workspace();
  t.after(cleanup);
  const raw = join(ref.cwd, "gh-10.json");
  writeFileSync(raw, github());
  const result = deliverRemoteTicket(ref, { source: "github", origin: "s0ftnote/Waygoal", number: "10", ref: raw });
  assert.equal(result.ticket, "remote/github/s0ftnote/Waygoal/10");
  assert.equal(result.captured, true);
  const delivery = readRemoteDeliveries(ref)[result.ticket];
  assert.equal(delivery.raw, github());
  const [ticket] = ticketsOf(remoteMapViews(ref));
  assert.equal(ticket.body, "## What to build\n\n远程原文也走同一入口。\n");
  assert.equal(ticket.title, "远程原文也走同一票据入口");
  assert.equal(ticket.remote.url, "https://github.com/s0ftnote/Waygoal/issues/10");
});

test("来源操作成功和画布同步成功分开记，取不到就是未同步", (t) => {
  const { ref, cleanup } = workspace();
  t.after(cleanup);
  const raw = join(ref.cwd, "gone.json");
  const result = deliverRemoteTicket(ref, { source: "github", origin: "s0ftnote/Waygoal", number: "10", ref: raw });
  assert.equal(result.captured, false);
  const delivery = readRemoteDeliveries(ref)[result.ticket];
  assert.ok(delivery.deliveredAt);
  assert.equal(delivery.capturedAt, null);
  assert.ok(delivery.note);
  const [ticket] = ticketsOf(remoteMapViews(ref));
  assert.equal(ticket.remote.capturedAt, null);
  assert.equal(ticket.body, "");
});

test("重新取得来源之后可以重试，卡片还是那一张", (t) => {
  const { ref, cleanup } = workspace();
  t.after(cleanup);
  const raw = join(ref.cwd, "gh-10.json");
  const { ticket } = deliverRemoteTicket(ref, { source: "github", origin: "s0ftnote/Waygoal", number: "10", ref: raw });
  writeFileSync(raw, github());
  const retried = retryRemoteCapture(ref, ticket);
  assert.equal(retried.captured, true);
  const views = remoteMapViews(ref);
  assert.equal(ticketsOf(views).length, 1);
  assert.equal(ticketsOf(views)[0].remote.note, null);
  assert.ok(ticketsOf(views)[0].remote.capturedAt);
});

test("同一张票再交付一次不会多出一张卡", (t) => {
  const { ref, cleanup } = workspace();
  t.after(cleanup);
  const raw = join(ref.cwd, "gh-10.json");
  writeFileSync(raw, github());
  const delivery = { source: "github", origin: "s0ftnote/Waygoal", number: "10", ref: raw };
  deliverRemoteTicket(ref, delivery);
  deliverRemoteTicket(ref, delivery);
  const views = remoteMapViews(ref);
  assert.equal(views.length, 1);
  assert.equal(ticketsOf(views).length, 1);
});

test("更旧的结果不静默顶掉已经确认的新状态", (t) => {
  const { ref, cleanup } = workspace();
  t.after(cleanup);
  const raw = join(ref.cwd, "gh-10.json");
  writeFileSync(raw, github({ state: "CLOSED", stateReason: "COMPLETED", updatedAt: "2026-09-10T06:37:20Z" }));
  const { ticket } = deliverRemoteTicket(ref, { source: "github", origin: "s0ftnote/Waygoal", number: "10", ref: raw });
  const stale = join(ref.cwd, "gh-10-old.json");
  writeFileSync(stale, github({ state: "OPEN", updatedAt: "2026-09-01T00:00:00Z" }));
  const again = deliverRemoteTicket(ref, { source: "github", origin: "s0ftnote/Waygoal", number: "10", ref: stale });
  assert.equal(again.ticket, ticket);
  assert.equal(again.captured, false);
  const [card] = ticketsOf(remoteMapViews(ref));
  assert.equal(card.status, "resolved");
  assert.match(card.remote.note, /没有采用/);
});

test("相同裸编号在两个来源下各自成组，前提只在自己来源里结算", (t) => {
  const { ref, cleanup } = workspace();
  t.after(cleanup);
  const one = join(ref.cwd, "one.json");
  const two = join(ref.cwd, "two.json");
  const three = join(ref.cwd, "three.json");
  writeFileSync(one, github({ number: 7, title: "GitHub 的七号", body: "" }));
  writeFileSync(two, JSON.stringify({ tracker: "custom", id: "7", title: "样本的七号", state: "open", body: "", updatedAt: "2026-09-01T00:00:00Z", blockedBy: ["3"] }));
  writeFileSync(three, JSON.stringify({ tracker: "custom", id: "3", title: "样本的三号", state: "open", body: "", updatedAt: "2026-09-01T00:00:00Z" }));
  deliverRemoteTicket(ref, { source: "github", origin: "s0ftnote/Waygoal", number: "7", ref: one });
  deliverRemoteTicket(ref, { source: "custom", origin: "放映会", number: "7", ref: two });
  deliverRemoteTicket(ref, { source: "custom", origin: "放映会", number: "3", ref: three });
  const views = remoteMapViews(ref);
  assert.equal(views.length, 2);
  assert.deepEqual(views.map(v => v.tickets.length).sort(), [1, 2]);
  const custom = views.find(v => v.path === "remote/custom/放映会");
  const seven = custom.tickets.find(t => t.number === "7");
  // The premise it names is the sample's own 3, never the GitHub ticket of any number.
  assert.equal(seven.blockers[0].path, "remote/custom/放映会/3");
  assert.equal(seven.state, "waiting");
});

test("取到了原文但格式不支持，就说不支持，不拿它当正文", (t) => {
  const { ref, cleanup } = workspace();
  t.after(cleanup);
  const raw = join(ref.cwd, "notes.txt");
  writeFileSync(raw, "#10 远程原文也走同一票据入口\nOPEN\n");
  const { ticket } = deliverRemoteTicket(ref, { source: "github", origin: "s0ftnote/Waygoal", number: "10", ref: raw });
  const [card] = ticketsOf(remoteMapViews(ref));
  assert.equal(card.id, ticket);
  assert.equal(card.body, "");
  assert.equal(card.remote.format, "unknown");
  assert.match(card.remote.note, /--json/);
  // The raw was captured all the same, so a later reader can still see it.
  assert.equal(readRemoteDeliveries(ref)[ticket].raw, "#10 远程原文也走同一票据入口\nOPEN\n");
});

test("交付写的是相对路径时，那是相对工作目录，不是相对宿主自己所在的目录", (t) => {
  const { ref, cleanup } = workspace();
  t.after(cleanup);
  mkdirSync(join(ref.cwd, ".scratch/remote"), { recursive: true });
  writeFileSync(join(ref.cwd, ".scratch/remote/10.json"), github());
  const result = deliverRemoteTicket(ref, { source: "github", origin: "s0ftnote/Waygoal", number: "10", ref: ".scratch/remote/10.json" });
  assert.equal(result.captured, true, result.note ?? "");
  assert.equal(ticketsOf(remoteMapViews(ref))[0].title, "远程原文也走同一票据入口");
});

test("通过软链接打开的工作目录和它的真实路径是同一个工作区", (t) => {
  const { root, ref, cleanup } = workspace();
  t.after(cleanup);
  const linked = join(root, "link-to-work");
  symlinkSync(ref.cwd, linked);
  const raw = join(ref.cwd, "gh-10.json");
  writeFileSync(raw, github());
  deliverRemoteTicket({ cwd: linked, agentDir: ref.agentDir }, { source: "github", origin: "s0ftnote/Waygoal", number: "10", ref: raw });
  // Read back through the real path — the canvas resolves it before it looks.
  assert.equal(ticketsOf(remoteMapViews(ref)).length, 1);
});

test("已确认的那一份没有带时间时，后来的结果也不静默顶替", (t) => {
  const { ref, cleanup } = workspace();
  t.after(cleanup);
  const timeless = join(ref.cwd, "sample-timeless.json");
  writeFileSync(timeless, JSON.stringify({ tracker: "custom", id: "7", title: "没有时间的那一份", state: "open", body: "先这样。" }));
  deliverRemoteTicket(ref, { source: "custom", origin: "放映会", number: "7", ref: timeless });
  const later = join(ref.cwd, "sample-later.json");
  writeFileSync(later, JSON.stringify({ tracker: "custom", id: "7", title: "后来的那一份", state: "closed", body: "改了。", updatedAt: "2026-09-09T00:00:00Z" }));
  const again = deliverRemoteTicket(ref, { source: "custom", origin: "放映会", number: "7", ref: later });
  assert.equal(again.captured, false);
  assert.match(again.note, /顺序不明/);
  const [card] = ticketsOf(remoteMapViews(ref));
  assert.equal(card.title, "没有时间的那一份");
});

test("来源身份里不能藏路径", (t) => {
  const { ref, cleanup } = workspace();
  t.after(cleanup);
  assert.throws(() => deliverRemoteTicket(ref, { source: "github", origin: "../..", number: "1", ref: "x" }), /来源/);
  assert.throws(() => deliverRemoteTicket(ref, { source: "github", origin: "a/b", number: "n/../1", ref: "x" }), /编号/);
});

const { createWaygoalExtension } = await jiti.import("./extension.ts");

/** Drive the registered tool exactly as Pi would: the Agent calls it with the
 *  source identity and where it left the raw result, and nothing else. */
function remoteTool(ref) {
  let tool;
  createWaygoalExtension(ref.cwd, async () => [], ref.agentDir)({
    on: () => {}, appendEntry: () => {},
    registerTool: (definition) => { if (definition.name === "waygoal_remote_ticket") tool = definition; },
  });
  return tool;
}

test("注册的工具就是交付入口：它只收来源和引用，两件事分开回话", async (t) => {
  const { ref, cleanup } = workspace();
  t.after(cleanup);
  const tool = remoteTool(ref);
  assert.ok(tool, "扩展应当注册 waygoal_remote_ticket");
  const raw = join(ref.cwd, "gh-10.json");
  writeFileSync(raw, github());
  assert.deepEqual(Object.keys(tool.parameters.properties).sort(), ["number", "origin", "result_path", "source"]);
  const done = await tool.execute("call-1", { source: "github", origin: "s0ftnote/Waygoal", number: "10", result_path: raw });
  assert.equal(done.details.ticket, "remote/github/s0ftnote/Waygoal/10");
  assert.equal(done.details.synced, true);
  assert.equal(ticketsOf(remoteMapViews(ref)).length, 1);

  const missing = await tool.execute("call-2", { source: "github", origin: "s0ftnote/Waygoal", number: "11", result_path: join(ref.cwd, "nope.json") });
  assert.equal(missing.details.synced, false);
  assert.match(missing.content[0].text, /未同步/);
});
