// Browser verification for a remote ticket reaching the canvas: the Agent
// finishes a normal read of a source, hands Waygoal only the source identity
// and where its raw result is, and Waygoal reads that result itself and shows
// it as a ticket card beside the local ones (ticket #10).
//
// The GitHub result under e2e/fixtures is a real one, kept from a read-only
// `gh issue view --json` run against s0ftnote/Waygoal. Nothing here writes to
// any external ticket: no network call leaves this process, and the whole
// regression runs against that kept result and one offline sample.
//
// Delivery goes through the same `deliverRemoteTicket` the registered tool
// calls; that the tool itself is registered and passes its arguments through
// is covered by lib/waygoal-remote-store.test.mjs.
//
// Starts its own pi-web on a free loopback port with an isolated Pi data
// directory and a fake OpenAI-compatible model; no real model and no Pi login
// take part.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { chromium } from "playwright";
import { modelsJson, startFakeModel } from "./fake-model.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const evidence = resolve(root, "../../docs/research/prototype-evidence/remote");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-remote-server.log"));

const jiti = createJiti(import.meta.url, { alias: { "@": join(root, "/") } });
const { deliverRemoteTicket } = await jiti.import(join(root, "lib/waygoal-remote-store.ts"));

const agentDir = mkdtempSync(join(tmpdir(), "waygoal-remote-e2e-"));
const work = join(agentDir, "work/放映会");
const results = join(work, ".scratch/remote");
mkdirSync(results, { recursive: true });
// One local map next to the sources, so the canvas is showing both kinds and
// the same bare numbers appear locally and remotely at once.
const party = join(work, ".scratch/party");
mkdirSync(join(party, "issues"), { recursive: true });
writeFileSync(join(party, "map.md"), "# 给朋友办一场小型放映会\n\n## Destination\n\n定下一个能照着做的方案。\n");
writeFileSync(join(party, "issues/10-food.md"), "# 吃的怎么办\n\nType: grilling\nStatus: open\n\n## Question\n\n吃的怎么办。\n");

/** The real read-only GitHub result, exactly as `gh` produced it. */
const GITHUB = readFileSync(join(root, "e2e/fixtures/github-issue-10.json"), "utf8");
const issue = JSON.parse(GITHUB);
const githubFile = join(results, "github-10.json");
writeFileSync(githubFile, GITHUB);

// The same result with the comments field never asked for: a delivery that
// carried no comments must not read as "there are none".
const noComments = { ...issue };
delete noComments.comments;
const noCommentsFile = join(results, "github-10-no-comments.json");
writeFileSync(noCommentsFile, JSON.stringify(noComments));

// A result older than the one already confirmed, and out of order.
const olderFile = join(results, "github-10-older.json");
writeFileSync(olderFile, JSON.stringify({ ...issue, state: "OPEN", stateReason: "", title: "旧的标题", updatedAt: "2026-01-01T00:00:00Z" }));

// The offline custom sample: one file, the same fields, no platform behind it.
const SAMPLE = {
  tracker: "custom", id: "10", title: "样本里的第十号", state: "open",
  updatedAt: "2026-09-02T00:00:00Z", body: "这是离线样本的正文。\n\n附件：https://example.invalid/menu.pdf\n",
  blockedBy: ["3"],
  comments: [{ author: "阿元", body: "先照这个来。", createdAt: "2026-09-02T01:00:00Z" }],
};
const sampleFile = join(results, "sample-10.json");
const samplePremise = join(results, "sample-3.json");
writeFileSync(sampleFile, JSON.stringify(SAMPLE));
writeFileSync(samplePremise, JSON.stringify({ tracker: "custom", id: "3", title: "样本里的第三号", state: "open", body: "还没定。", updatedAt: "2026-09-01T00:00:00Z" }));

// Something the source produced that Waygoal has no reader for.
const unknownFile = join(results, "github-99.txt");
writeFileSync(unknownFile, "#99 这不是 --json 的输出\nOPEN\n");

// A reference that will be gone by the time it is delivered.
const expiredFile = join(results, "github-11.json");

const model = await startFakeModel({ reply: "回复" });
writeFileSync(join(agentDir, "models.json"), modelsJson(model.baseUrl));
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "e2e", defaultModel: "e2e-model" }));

const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); assert.ok(ok, `${name} ${detail}`); console.log(`PASS: ${name}`); };
async function waitFor(predicate, what, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    assert.ok(Date.now() < deadline, `Timed out waiting for ${what}`);
    await delay(250);
  }
}

let server, browser, page;
const interrupt = () => { process.exitCode = 1; server?.kill("SIGTERM"); void browser?.close().catch(() => {}); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);

async function freePort() {
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port; await new Promise((r) => probe.close(r)); return port;
}
const port = await freePort();
const base = `http://127.0.0.1:${port}`;

async function startServer() {
  const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BEACON_PROTOTYPE: "1", PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
  });
  child.stdout.pipe(serverLog, { end: false }); child.stderr.pipe(serverLog, { end: false });
  const deadline = Date.now() + 120_000;
  for (;;) {
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-remote-server.log");
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(work)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-remote-server.log");
    await delay(250);
  }
}
async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit"); child.kill("SIGTERM");
  await Promise.race([exited, delay(15_000).then(() => child.kill("SIGKILL"))]);
}

// Deliberately the unresolved path: on macOS the temp directory is a symlink,
// and a session started through it must land in the same workspace the canvas
// reads through the resolved path.
const ref = { cwd: work, agentDir };
const deliver = (source, origin, number, file) => deliverRemoteTicket(ref, { source, origin, number, ref: file });
const GH = "remote/github/s0ftnote/Waygoal/10";
const SAMPLE_TEN = "remote/custom/放映会/10";
/** Every result file this test wrote, kept so "nothing was written to a
 *  source" is checked against what the test put there, not against itself. */
const wrote = new Map([[githubFile, GITHUB]]);
const untouched = () => [...wrote].every(([file, text]) => readFileSync(file, "utf8") === text);

try {
  server = await startServer();
  browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  const errors = [];
  let restarting = false;
  const note = (text) => { if (!restarting) errors.push(text); };
  const openPage = async () => {
    const p = await context.newPage();
    p.setDefaultTimeout(30_000);
    p.on("pageerror", (e) => note(e.message));
    p.on("crash", () => note("page crashed"));
    p.on("console", (e) => { if (e.type() === "error") note(e.text()); });
    p.on("response", (r) => { if (r.url().startsWith(base) && r.status() >= 400) note(`${r.status()} ${r.url()}`); });
    return p;
  };
  page = await openPage();
  const panel = () => page.locator(".waygoal-panel");
  const closePanel = async () => {
    const close = page.getByRole("button", { name: "关闭面板" });
    if (await close.count() > 0 && await close.isVisible()) await close.click();
  };
  // With several sources on it the canvas runs wider than the window, so go
  // back to the overview first — the same button a user would reach for.
  const openCard = async (id) => {
    await closePanel();
    await page.getByRole("button", { name: "回到全景" }).click();
    await page.locator(`[data-node="${id}"]`).click();
    await panel().waitFor();
  };
  const card = (id) => page.locator(`[data-node="${id}"]`);

  await page.goto(`${base}/beacon?cwd=${encodeURIComponent(work)}`, { waitUntil: "domcontentloaded" });
  await card(".scratch/party/map.md").waitFor();
  const requests = model.requests.length;

  // ---- A real GitHub result, delivered ------------------------------------
  const delivered = deliver("github", "s0ftnote/Waygoal", "10", githubFile);
  check("the delivery answers with the card it landed on and whether the canvas is in sync",
    delivered.ticket === GH && delivered.captured === true, JSON.stringify(delivered));
  await card(GH).waitFor();
  check("the source itself becomes a card beside the local map, not a second kind of thing",
    (await card("remote/github/s0ftnote/Waygoal").count()) === 1);

  await openCard(GH);
  const body = await panel().locator("pre.waygoal-ticket-body").first().innerText();
  check("the body is the source's own text, character for character — no model rewrote it",
    body.trim() === issue.body.trim(), body.slice(0, 80));
  const title = await panel().locator(".waygoal-panel-title strong").innerText();
  check("and the title is the source's own", title === issue.title, title);
  check("the card says where it came from and when it was taken",
    (await panel().locator("[data-remote-synced]").count()) === 1);
  check("the pending-check line says plainly that this is a snapshot, not live sync",
    (await panel().locator("[data-remote-pending]").innerText()).includes("不承诺实时同步"));
  check("attachments and links are addresses, listed and never fetched",
    (await panel().locator("[data-remote-pending]").innerText()).includes("附件只按地址列出，不下载"));
  check("comments that were fetched and turned out to be none say exactly that",
    (await panel().locator('[data-remote-comments="empty"]').count()) === 1);
  check("this ticket can be talked about the same way a local one can",
    (await panel().getByRole("button", { name: "在这张票下开始聊" }).count()) === 1);

  // ---- Comments that were never asked for ---------------------------------
  deliver("github", "s0ftnote/Waygoal", "12", noCommentsFile);
  await card("remote/github/s0ftnote/Waygoal/12").waitFor();
  await openCard("remote/github/s0ftnote/Waygoal/12");
  check("a result that never carried comments says so, instead of reading as 'no comments'",
    (await panel().locator('[data-remote-comments="none"]').count()) === 1);

  // ---- The offline sample, and the same bare number under three roofs -----
  // Written the way the tool asks for it: relative to the working directory.
  deliver("custom", "放映会", "10", ".scratch/remote/sample-10.json");
  deliver("custom", "放映会", "3", samplePremise);
  await card(SAMPLE_TEN).waitFor();
  check("the offline sample comes in through the same entrance and stands as its own source",
    (await card("remote/custom/放映会").count()) === 1);
  check("the same bare number under GitHub, the sample and the local map is three tickets, not one",
    (await card(GH).count()) === 1 && (await card(SAMPLE_TEN).count()) === 1
    && (await card(".scratch/party/issues/10-food.md").count()) === 1);
  await openCard(SAMPLE_TEN);
  const premise = await panel().locator(".waygoal-ticket-blockers .waygoal-tag").first().innerText();
  check("its premise is settled inside its own source only, never against a GitHub or local ticket of the same number",
    premise.startsWith("3"), premise);

  // ---- A reference that had already expired -------------------------------
  writeFileSync(expiredFile, JSON.stringify({ ...issue, number: 11, title: "引用会过期的这张" }));
  unlinkSync(expiredFile);
  const expired = deliver("github", "s0ftnote/Waygoal", "11", expiredFile);
  check("a delivery whose raw result is gone is recorded as not captured, and the source operation still counts",
    expired.captured === false && Boolean(expired.note), JSON.stringify(expired));
  const unsynced = "remote/github/s0ftnote/Waygoal/11";
  await card(unsynced).waitFor();
  check("the card is there and says 未同步 rather than disappearing or showing invented text",
    (await card(unsynced).locator("[data-unsynced]").count()) === 1);
  await openCard(unsynced);
  check("and the panel shows nothing as if it were the source's own", (await panel().locator("[data-remote-unsynced]").count()) === 1);

  // ---- Retry, once the source's result is back ----------------------------
  writeFileSync(expiredFile, JSON.stringify({ ...issue, number: 11, title: "引用会过期的这张", updatedAt: "2026-09-10T07:00:00Z" }));
  await panel().locator("[data-remote-retry]").click();
  await waitFor(async () => (await panel().locator("[data-remote-synced]").count()) === 1, "the retry to take");
  check("re-obtaining the source and asking again brings it in, on the same card",
    (await page.locator('[data-node^="remote/github/s0ftnote/Waygoal/11"]').count()) === 1);

  // ---- The same delivery twice, and an older result ------------------------
  const cardsBefore = await page.locator('[data-node^="remote/"]').count();
  deliver("github", "s0ftnote/Waygoal", "10", githubFile);
  await delay(300);
  check("delivering the same ticket again does not add a second card",
    (await page.locator('[data-node^="remote/"]').count()) === cardsBefore);

  const older = deliver("github", "s0ftnote/Waygoal", "10", olderFile);
  check("an older result is not taken, and it says so instead of silently overwriting",
    older.captured === false && /没有采用/.test(older.note ?? ""), JSON.stringify(older));
  await openCard(GH);
  const stillTitle = await panel().locator(".waygoal-panel-title strong").innerText();
  check("the confirmed state stays on screen after the older result arrives",
    stillTitle === issue.title, stillTitle);
  check("and the reason it was not taken is shown, not swallowed",
    (await panel().locator("[data-remote-note]").innerText()).includes("没有采用"));

  // ---- A format Waygoal has no reader for ---------------------------------
  deliver("github", "s0ftnote/Waygoal", "99", unknownFile);
  await card("remote/github/s0ftnote/Waygoal/99").waitFor();
  await openCard("remote/github/s0ftnote/Waygoal/99");
  check("an unsupported format is named as unsupported and nothing is guessed out of it",
    (await panel().locator("[data-remote-note]").innerText()).includes("--json"));
  check("and it shows no body at all rather than a scraped one",
    (await panel().locator("pre.waygoal-ticket-body").innerText()).trim() === "");

  // One ticket that is left not captured, so the restart has one to carry.
  deliver("github", "s0ftnote/Waygoal", "13", join(results, "never-written.json"));
  await card("remote/github/s0ftnote/Waygoal/13").waitFor();

  // ---- A host restart -----------------------------------------------------
  restarting = true;
  await stopServer(server);
  server = await startServer();
  restarting = false;
  const fresh = await openPage();
  await page.close();
  page = fresh;
  await page.goto(`${base}/beacon?cwd=${encodeURIComponent(work)}`, { waitUntil: "domcontentloaded" });
  await card(GH).waitFor();
  await openCard(GH);
  check("after the host restarts, the sources and their tickets are still on the canvas, with their own text",
    (await panel().locator("pre.waygoal-ticket-body").first().innerText()).trim() === issue.body.trim());
  check("and the one whose result was never captured is still there, still 未同步",
    (await card("remote/github/s0ftnote/Waygoal/13").locator("[data-unsynced]").count()) === 1);

  check("nothing was sent to a model, and the kept GitHub result is byte-for-byte what this test wrote",
    model.requests.length === requests && untouched(),
    JSON.stringify({ requests, now: model.requests.length }));
  check("no page or console errors", errors.length === 0, errors.join("\n"));
  await context.close();

  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks }, null, 2));
  console.log(`\nAll ${checks.length} checks passed. Evidence: ${evidence}`);
} catch (error) {
  process.exitCode = 1;
  await page?.screenshot({ path: join(artifacts, "waygoal-remote-failure.png"), fullPage: false }).catch(() => {});
  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks, failure: String(error?.stack ?? error) }, null, 2));
  console.error(error);
} finally {
  await browser?.close().catch(() => {});
  await stopServer(server);
  await Promise.race([model.close(), delay(5000)]);
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
}
