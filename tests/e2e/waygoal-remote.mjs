import { evidenceDirectory, openOverview } from "./waygoal-artifacts.mjs";
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
// is covered by src/server/tickets/remote-store.test.mjs.
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
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { chromium } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { modelsJson, startFakeModel } from "./fake-model.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const evidence = evidenceDirectory("remote");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-remote-server.log"));

const jiti = createJiti(import.meta.url, { alias: { "@": join(root, "src") } });
const { deliverRemoteTicket, saveRemoteRelations, readRemoteDeliveries } = await jiti.import(join(root, "src/server/tickets/remote-store.ts"));

const agentDir = mkdtempSync(join(tmpdir(), "waygoal-remote-e2e-"));
const work = join(agentDir, "work/放映会");
const results = join(work, ".scratch/remote");
mkdirSync(results, { recursive: true });
const session = SessionManager.create(work, join(agentDir, "sessions", "fixture"));
for (let i=0; i<5; i++) {
  session.appendMessage({role:"user",content:`探索问题 ${i+1}`,timestamp:Date.now()});
  session.appendMessage({role:"assistant",content:[{type:"text",text:"保留讨论，继续验证下一步。"}],timestamp:Date.now()});
}
const SESSION = session.getSessionId();
// One local map next to the sources, so the canvas is showing both kinds and
// the same bare numbers appear locally and remotely at once.
const party = join(work, ".scratch/party");
mkdirSync(join(party, "issues"), { recursive: true });
writeFileSync(join(party, "map.md"), "# 给朋友办一场小型放映会\n\n## Destination\n\n定下一个能照着做的方案。\n");
writeFileSync(join(party, "issues/10-food.md"), "# 吃的怎么办\n\nType: grilling\nStatus: open\n\n## Question\n\n吃的怎么办。\n");

/** The real read-only GitHub result, exactly as `gh` produced it. */
const GITHUB = readFileSync(join(root, "tests/e2e/fixtures/github-issue-10.json"), "utf8");
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
    env: { ...process.env, WAYGOAL: "1", PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
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
  // A host killed before its own cleanup leaves the dev lock behind, and the
  // next start (this suite's restart or the next suite) would refuse to run.
  rmSync(join(root, ".next/dev/lock"), { force: true });
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
    // These checks exercise workspace/session organization. Return through the
    // real overview control when the turn view covers those controls.
    await p.addLocatorHandler(p.locator('.waygoal-canvas-area:not([data-managing]) .waygoal-turn-more > summary'), async button => {
      await button.click(); await p.getByRole('button', { name: '整理会话与票据', exact: true }).click();
    });
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
    const title = page.locator(`[data-cluster-open="${id}"]`);
    if (await title.count()) await title.click();
    else await page.locator(`[data-node="${id}"]`).click();
    await panel().waitFor();
  };
  const card = (id) => page.locator(`[data-node="${id}"]`);

  await page.goto(`${base}/waygoal?cwd=${encodeURIComponent(work)}`, { waitUntil: "domcontentloaded" });
  await openOverview(page);
  await card(".scratch/party/map.md").waitFor();
  const requests = model.requests.length;

  if (process.env.WAYGOAL_REMOTE_CASE !== "cluster") {
  // ---- A real GitHub result, delivered ------------------------------------
  const delivered = deliver("github", "s0ftnote/Waygoal", "10", githubFile);
  check("the delivery answers with the card it landed on and whether the canvas is in sync",
    delivered.ticket === GH && delivered.captured === true, JSON.stringify(delivered));
  await card(GH).waitFor();
  check("source provenance stays in details and no longer occupies a canvas node",
    (await card("remote/github/s0ftnote/Waygoal").count()) === 0);

  await openCard(GH);
  check("quick view keeps provenance and original text collapsed", await panel().locator('[data-ticket-source]:not([open])').count()===1 && await panel().locator('[data-ticket-original]:not([open])').count()===1);
  const body = await panel().locator("[data-ticket-original] pre.waygoal-ticket-body").textContent();
  check("the body is the source's own text, character for character — no model rewrote it",
    body.trim() === issue.body.trim(), body.slice(0, 80));
  const title = await panel().locator(".waygoal-panel-title strong").innerText();
  check("and the title is the source's own", title === issue.title, title);
  check("the card says where it came from and when it was taken",
    (await panel().locator("[data-remote-synced]").count()) === 1);
  check("the pending-check line says plainly that this is a snapshot, not live sync",
    (await panel().locator("[data-remote-pending]").textContent()).includes("不承诺实时同步"));
  check("attachments and links are addresses, listed and never fetched",
    (await panel().locator("[data-remote-pending]").textContent()).includes("附件只按地址列出，不下载"));
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
  check("the offline sample keeps provenance without creating a source card",
    (await card("remote/custom/放映会").count()) === 0);
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
  await panel().locator("[data-ticket-source] > summary").click();
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
    (await panel().locator("[data-remote-note]").textContent()).includes("没有采用"));

  // ---- A format Waygoal has no reader for ---------------------------------
  deliver("github", "s0ftnote/Waygoal", "99", unknownFile);
  await card("remote/github/s0ftnote/Waygoal/99").waitFor();
  await openCard("remote/github/s0ftnote/Waygoal/99");
  check("an unsupported format is named as unsupported and nothing is guessed out of it",
    (await panel().locator("[data-remote-note]").textContent()).includes("--json"));
  check("and it shows no body at all rather than a scraped one",
    (await panel().locator("[data-ticket-original] pre.waygoal-ticket-body").textContent()).trim() === "");

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
  await page.goto(`${base}/waygoal?cwd=${encodeURIComponent(work)}`, { waitUntil: "domcontentloaded" });
  await openOverview(page);
  await card(GH).waitFor();
  await openCard(GH);
  check("after the host restarts, the sources and their tickets are still on the canvas, with their own text",
    (await panel().locator("[data-ticket-original] pre.waygoal-ticket-body").textContent()).trim() === issue.body.trim());
  check("and the one whose result was never captured is still there, still 未同步",
    (await card("remote/github/s0ftnote/Waygoal/13").locator("[data-unsynced]").count()) === 1);

  check("nothing was sent to a model, and the kept GitHub result is byte-for-byte what this test wrote",
    model.requests.length === requests && untouched(),
    JSON.stringify({ requests, now: model.requests.length }));
  }
  await openCard(SESSION);
  await closePanel();
  await page.locator('.waygoal-turn-card').first().waitFor();
  // Reproduce the map ticket with two native GitHub subissues. No external API.
  const family = ["101", "102", "103"].map(number => `remote/github/s0ftnote/Waygoal/${number}`);
  for (const [index, id] of family.entries()) {
    const number = String(101 + index), file = join(results, `${number}.json`);
    writeFileSync(file, JSON.stringify({ ...issue, number: Number(number), title: ["Jev：找到值得验证的用途，评估对话直执行路由与完整整理的能力覆盖和协作代价", "选择实验场景", "确定继续或停止条件"][index], state: index === 1 ? "CLOSED" : "OPEN", stateReason: index === 1 ? "COMPLETED" : null, labels: [{name: `wayfinder:${index === 0 ? "map" : "grilling"}`}], body: `## ${index === 0 ? "Destination" : "Question"}\n\n决定首个离线实验是否值得开展。` }));
    deliver("github", "s0ftnote/Waygoal", number, file);
    const identity = n => ({source:"github",origin:"s0ftnote/Waygoal",number:String(n)});
    saveRemoteRelations(ref, id, readRemoteDeliveries(ref)[id].deliveredAt, {parent:index ? identity(101) : null, children:index ? [] : [identity(102),identity(103)], blockedBy:index===2 ? [identity(102)] : [], readAt:new Date().toISOString()}, null);
  }
  await card(family[2]).waitFor();
  await closePanel();
  await page.locator('[data-arrange-tickets]').click();
  await page.locator('[data-layout-undo]').waitFor();
  await page.getByRole('button',{name:'回到全景',exact:true}).click();
  await delay(350);
  check('Map title retains readable space in a narrow cluster',await page.locator(`[data-cluster-open="${family[0]}"] strong`).evaluate(el=>el.clientWidth>=180));
  check('long Map title wraps without truncation',await page.locator(`[data-cluster-open="${family[0]}"] strong`).evaluate(el=>getComputedStyle(el).whiteSpace==='normal' && el.scrollHeight<=el.clientHeight+1));
  check('completed card remains explicit at overview zoom',await card(family[1]).locator('.waygoal-node-state').innerText()==='已完成' && await card(family[1]).evaluate(el=>getComputedStyle(el).backgroundColor)!==await card(family[2]).evaluate(el=>getComputedStyle(el).backgroundColor));
  const membership = page.locator(`[data-ticket-relation="membership"][data-spatial-from="node:${family[0]}"]`);
  check('the frame represents the Map without a duplicate card or membership wires',
    await membership.count() === 0 && await page.locator(`.waygoal-ticket-card[data-node="${family[0]}"]`).count() === 0 && await page.locator(`[data-cluster-open="${family[0]}"]`).count() === 1);
  const dependency = page.locator(`[data-ticket-relation="dependency"][data-spatial-from="node:${family[1]}"][data-spatial-to="node:${family[2]}"]`);
  check('dependency arrow points from prerequisite to dependent',
    await dependency.count() === 1 && Boolean(await dependency.locator('path').getAttribute('marker-end')) && (await dependency.locator('title').textContent()).includes('箭头从前置票据指向后续票据'));
  const box = async id => card(id).evaluate(el=>({x:parseFloat(el.style.left),y:parseFloat(el.style.top)}));
  const mapPos=await box(family[0]), childPos=await box(family[1]), secondPos=await box(family[2]);
  check('Map header wraps its child tickets', childPos.x>mapPos.x && childPos.y>mapPos.y && childPos.x===secondPos.x && secondPos.y>childPos.y);
  check('real question replaces the empty placeholder', (await card(family[1]).textContent()).includes('决定首个离线实验'));
  const overlap = await page.evaluate(() => {
    const rect = el => ({x:parseFloat(el.style.left),y:parseFloat(el.style.top),w:el.offsetWidth,h:el.offsetHeight});
    const turns=[...document.querySelectorAll('.waygoal-turn-card')].map(rect);
    return [...document.querySelectorAll('.waygoal-ticket-card')].map(rect).some(a=>turns.some(b=>a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y));
  });
  check('tickets do not cover expanded conversation turns',!overlap);
  await page.screenshot({path:join(evidence,'ticket-family.png'),fullPage:false});
  const cluster = page.locator(`[data-ticket-cluster="${family[0]}"]`);
  const toggle = page.locator(`[data-cluster-toggle="${family[0]}"]`);
  check('real map and children have one enclosing frame', await cluster.count()===1);
  await toggle.click();
  await card(family[1]).waitFor({state:'detached'});
  check('collapsed Map summary fits its container',await cluster.evaluate(el=>el.scrollHeight<=el.clientHeight+1));
  await page.screenshot({path:join(evidence,'map-collapsed.png'),fullPage:false});
  check('collapse keeps map and hides all children and their connectors', await card(family[0]).count()===1 && await card(family[2]).count()===0 && await page.locator(`[data-ticket-relation][data-spatial-from="node:${family[0]}"]`).count()===0);
  await page.reload({waitUntil:'domcontentloaded'});
  await toggle.waitFor();
  check('cluster stays collapsed across reload', await toggle.getAttribute('aria-expanded')==='false' && await card(family[1]).count()===0);
  await toggle.click();
  await card(family[1]).waitFor();
  await page.locator('.waygoal-turn-card').first().waitFor();
  await waitFor(async()=>Math.abs((await box(family[1])).x-childPos.x)<2,'expand restores original ticket position');
  check('unfold restores child coordinates', JSON.stringify(await box(family[1]))===JSON.stringify(childPos) && JSON.stringify(await box(family[2]))===JSON.stringify(secondPos));
  await openCard(family[0]);
  check('goal is readable without opening the raw document', (await panel().locator('[data-overview-section="destination"]').innerText()).includes('决定首个离线实验'));
  await page.screenshot({path:join(evidence,'ticket-overview-desktop.png'),fullPage:false});
  await page.setViewportSize({width:390,height:844});
  await delay(200);
  await page.screenshot({path:join(evidence,'ticket-overview-mobile.png'),fullPage:false});
  check('mobile overview has no horizontal overflow',await panel().evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await page.setViewportSize({width:1440,height:900});
  check('map details navigate to its actual children',await panel().locator('.waygoal-ticket-children button').count()===2);
  await panel().locator('.waygoal-ticket-children button').first().click();
  check('opening a child preserves real issue identity',(await panel().locator('.waygoal-panel-title strong').innerText())==='选择实验场景');
  await closePanel();
  await page.locator('[data-layout-undo]').click();
  await page.locator('[data-layout-undo]').waitFor({state:'detached'});
  await page.locator('[data-arrange-tickets]').click();
  await page.locator('[data-layout-undo]').waitFor();
  await page.getByRole('button',{name:'回到全景',exact:true}).click();
  await delay(350);
  const beforeMove=await box(family[2]);
  const bounds=await card(family[2]).boundingBox();
  const scale=await page.locator('.waygoal-world').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).a);
  const savedMove=page.waitForResponse(r=>r.url().includes('/api/waygoal') && r.request().method()==='PATCH');
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+32,bounds.y+bounds.height/2,{steps:8});await page.mouse.up();
  await savedMove;
  await waitFor(async()=>Math.abs((await box(family[2])).x-beforeMove.x-32/scale)<2,'ticket drag saves the visible position');
  const moved=await box(family[2]);
  await page.reload({waitUntil:'domcontentloaded'});
  await card(family[2]).waitFor();
  await page.locator('.waygoal-turn-card').first().waitFor();
  await waitFor(async()=>Math.abs((await box(family[2])).x-moved.x)<2,'ticket does not jump after reload');
  check('dragging a projected ticket persists without shifting twice',Math.abs((await box(family[2])).x-moved.x)<2);

  // A ticket's real discussion belongs inside its cluster, including turns.
  await page.request.patch(`${base}/api/waygoal`, {data:{cwd:work,ticketSession:{sessionId:SESSION,ticket:family[0]}}});
  await page.reload({waitUntil:'domcontentloaded'});
  await card(SESSION).waitFor();
  await page.locator('.waygoal-turn-card').first().waitFor();
  const encloses = async () => page.evaluate(root => {
    const frame=document.querySelector(`[data-ticket-cluster="${root}"]`).getBoundingClientRect();
    return [...document.querySelectorAll('.waygoal-turn-card')].every(el=>{const b=el.getBoundingClientRect();return b.left>=frame.left-1 && b.right<=frame.right+1 && b.top>=frame.top-1 && b.bottom<=frame.bottom+1;});
  },family[0]);
  await waitFor(encloses,'cluster encloses linked conversation and expanded turns');
  check('ticket cluster includes the linked session and every expanded turn',await encloses());
  check('Map discussion has a named header entry without a redundant origin wire',await page.locator(`[data-map-discussion="${SESSION}"]`).count()===1 && await page.locator(`.waygoal-link.ticket[data-spatial-from="node:${family[0]}"]`).count()===0);
  const talkToggle=page.locator(`[data-map-discussion-expand="${SESSION}"]`);
  await talkToggle.click();
  await page.locator('.waygoal-turn-card').first().waitFor({state:'detached'});
  check('Map discussion can fold its turns independently',await talkToggle.getAttribute('aria-expanded')==='false');
  check('folded Map conversation keeps an explicit ownership region',await page.locator(`[data-map-session-region="${SESSION}"]`).count()===1);
  await talkToggle.click();
  await page.locator('.waygoal-turn-card').first().waitFor();
  await page.getByRole('button',{name:'回到全景',exact:true}).click();
  await delay(350);
  const groupIds = [...family, SESSION];
  const groupBefore = Object.fromEntries(await Promise.all(groupIds.map(async id=>[id,await box(id)])));
  const firstTurn = page.locator('.waygoal-turn-card').first();
  const turnBefore = await firstTurn.evaluate(el=>({x:parseFloat(el.style.left),y:parseFloat(el.style.top)}));
  const handle = page.locator(`[data-cluster-drag="${family[0]}"]`);
  const handleBox = await handle.boundingBox();
  const groupScale = await page.locator('.waygoal-world').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).a);
  await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x+handleBox.width/2+48,handleBox.y+handleBox.height/2+24,{steps:8});
  await waitFor(async()=>Math.abs((await box(family[0])).x-groupBefore[family[0]].x-48/groupScale)<1,'cluster follows pointer before release');
  check('dragging the frame moves all tickets and its conversation together before release',
    (await Promise.all(groupIds.map(async id=>{const point=await box(id);return Math.abs(point.x-groupBefore[id].x-48/groupScale)<1 && Math.abs(point.y-groupBefore[id].y-24/groupScale)<1;}))).every(Boolean));
  check('expanded conversation turns move with their container',await firstTurn.evaluate((el,args)=>Math.abs(parseFloat(el.style.left)-args.before.x-48/args.scale)<1 && Math.abs(parseFloat(el.style.top)-args.before.y-24/args.scale)<1,{before:turnBefore,scale:groupScale}));
  await page.mouse.up();
  await waitFor(async()=>!await handle.isDisabled(),'cluster move saved');
  const groupMoved = Object.fromEntries(await Promise.all(groupIds.map(async id=>[id,await box(id)])));
  await page.reload({waitUntil:'domcontentloaded'});
  await firstTurn.waitFor();
  await waitFor(async()=>Math.abs((await box(SESSION)).x-groupMoved[SESSION].x)<1,'cluster positions survive reload');
  check('group move persists every member without changing their relative arrangement',
    (await Promise.all(groupIds.map(async id=>{const point=await box(id);return Math.abs(point.x-groupMoved[id].x)<1 && Math.abs(point.y-groupMoved[id].y)<1;}))).every(Boolean));

  const beforeOwnMove=await box(family[1]), beforeSessionMove=await box(SESSION);
  await card(SESSION).focus();await card(SESSION).press('Shift+ArrowRight');
  await waitFor(async()=>Math.abs((await box(SESSION)).x-beforeSessionMove.x-50)<1,'owned conversation moves freely');
  check('moving its own session does not repel the child tickets',JSON.stringify(await box(family[1]))===JSON.stringify(beforeOwnMove));
  await openCard(SESSION);
  const draft = panel().locator('textarea').first();
  await draft.fill('保留这段没有发送的草稿');
  await toggle.focus();await toggle.press('Enter');
  await card(SESSION).waitFor({state:'detached'});
  await page.locator('.waygoal-turn-card').first().waitFor({state:'detached'});
  check('folding cluster hides owned session and turns but preserves right-side draft',await draft.inputValue()==='保留这段没有发送的草稿');
  const collapsedBefore = await box(family[0]);
  await handle.focus(); await handle.press('Shift+ArrowRight');
  await waitFor(async()=>!await handle.isDisabled() && Math.abs((await box(family[0])).x-collapsedBefore.x-50)<1,'move collapsed cluster');

  // The development-only Next badge overlays the lower-left toolbar.
  await page.getByRole('button',{name:'当前轮次',exact:true}).focus();
  await page.getByRole('button',{name:'当前轮次',exact:true}).press('Enter');
  await card(SESSION).waitFor();
  await page.locator('.waygoal-turn-card').first().waitFor();
  check('locating the active conversation unfolds its ticket cluster',await toggle.getAttribute('aria-expanded')==='true' && await draft.inputValue()==='保留这段没有发送的草稿');
  check('hidden tickets move with a collapsed cluster',Math.abs((await box(family[1])).x-groupMoved[family[1]].x-50)<1 && Math.abs((await box(family[2])).x-groupMoved[family[2]].x-50)<1);
  check('Map ownership region encloses the session and its visible turns',await page.evaluate(id=>{
    const region=document.querySelector(`[data-map-session-region="${id}"]`).getBoundingClientRect();
    return [...document.querySelectorAll('.waygoal-turn-card')].every(el=>{const b=el.getBoundingClientRect();return b.left>=region.left && b.right<=region.right && b.top>=region.top && b.bottom<=region.bottom;});
  },SESSION));
  await closePanel();
  const focusBox=await cluster.evaluate(el=>({x:parseFloat(el.style.left),y:parseFloat(el.style.top)}));
  await page.request.patch(`${base}/api/waygoal`,{data:{cwd:work,view:{x:90-focusBox.x*.6,y:180-focusBox.y*.6,scale:.6}}});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator(`[data-map-session-region="${SESSION}"]`).waitFor();
  await delay(350);
  check('Map text stays readable at sixty percent zoom',await cluster.evaluate(el=>{
    const scale=new DOMMatrix(getComputedStyle(document.querySelector('.waygoal-world')).transform).a;
    return Math.abs(scale-.6)<.01 && parseFloat(getComputedStyle(el.querySelector('.waygoal-ticket-cluster-head strong')).fontSize)*scale>=21.9 && parseFloat(getComputedStyle(el.querySelector('.waygoal-map-purpose')).fontSize)*scale>=15.9;
  }));
  await page.screenshot({path:join(evidence,'map-discussion-60.png'),fullPage:false});

  await closePanel();
  await openCard(family[0]);
  await page.screenshot({path:join(evidence,'ticket-overview-desktop.png'),fullPage:false});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:join(evidence,'ticket-overview-mobile.png'),fullPage:false});


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
