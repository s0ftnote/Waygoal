// Browser verification for naming a discussion and finding it again (ticket #5).
// Starts its own pi-web on a free loopback port with an isolated Pi data
// directory and a fake OpenAI-compatible model, writes real tracker files into
// the workspace, and drives the canvas: renaming a session through Pi's own
// rename, asking Pi for a title, finding a session by title after a host
// restart, the thumbnail, and locating — checking each time that the session's
// messages and the path it would continue on are left alone.
//
// The model is fake and local; no real model and no Pi login take part.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { modelsJson, startFakeModel } from "./fake-model.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const evidence = resolve(root, "../../docs/research/prototype-evidence/find");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-find-server.log"));

const agentDir = mkdtempSync(join(tmpdir(), "waygoal-find-e2e-"));
const workspace = join(agentDir, "workspace");
mkdirSync(workspace);
const model = await startFakeModel({ reply: "回复", titleReply: "挑一部适合朋友的片子" });
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
const canvasUrl = `${base}/waygoal?cwd=${encodeURIComponent(workspace)}`;

async function startServer() {
  const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WAYGOAL: "1", PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
  });
  child.stdout.pipe(serverLog, { end: false }); child.stderr.pipe(serverLog, { end: false });
  const deadline = Date.now() + 120_000;
  for (;;) {
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-find-server.log");
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-find-server.log");
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

const snapshot = async () => (await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`, { cache: "no-store" })).json();
const nodeOf = async (id) => (await snapshot()).nodes.find((n) => n.id === id) ?? null;
function sessionEntries(id) {
  const file = readdirSync(join(agentDir, "sessions"), { recursive: true }).find((f) => String(f).endsWith(`_${id}.jsonl`));
  assert.ok(file, `session file for ${id}`);
  return readFileSync(join(agentDir, "sessions", String(file)), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}
/** Only what was said, so an appended name cannot pass for a changed message. */
const messagesOf = (id) => sessionEntries(id)
  .filter((e) => e.type === "message")
  .map((e) => `${e.message?.role}:${JSON.stringify(e.message?.content ?? "")}`);

/** Real tracker files, in the layout the local Markdown tracker documents. */
function writeMap(effort, body) {
  mkdirSync(join(workspace, ".scratch", effort, "issues"), { recursive: true });
  writeFileSync(join(workspace, ".scratch", effort, "map.md"), body);
}
const writeTicket = (effort, file, title) =>
  writeFileSync(join(workspace, ".scratch", effort, "issues", file),
    `# ${title}\n\nType: grilling\nStatus: open\n\n## Question\n\n${title}的正文。\n`);

try {
  writeMap("party", "# 给朋友办一场小型放映会\n\n## Destination\n\n定下一个方案。\n");
  writeTicket("party", "01-room.md", "场地定在哪");
  writeTicket("party", "02-film.md", "放哪部片");

  server = await startServer();
  browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  const errors = [];
  const openPage = async () => {
    const p = await context.newPage();
    p.setDefaultTimeout(30_000);
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("crash", () => errors.push("page crashed"));
    p.on("console", (e) => { if (e.type() === "error") errors.push(e.text()); });
    p.on("response", (r) => { if (r.url().startsWith(base) && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
    return p;
  };
  page = await openPage();
  const panel = () => page.locator(".waygoal-panel");
  const composer = () => panel().locator("textarea").first();
  const send = async (text) => {
    const before = model.requests.length;
    await composer().fill(text);
    await panel().getByRole("button", { name: /^(Send|发送)$/ }).click();
    await waitFor(() => model.requests.length > before, `model request for ${text}`);
    await panel().getByText(`回复: ${text}`, { exact: true }).waitFor({ timeout: 60_000 });
    await delay(600);
  };
  const closePanel = async () => {
    const close = page.getByRole("button", { name: "关闭面板" });
    if (await close.count() > 0 && await close.isVisible()) await close.click();
  };
  const startChat = async (text) => {
    await closePanel();
    await page.getByRole("button", { name: "新开聊天" }).click();
    await composer().waitFor();
    const before = new Set((await snapshot()).nodes.map((n) => n.id));
    await send(text);
    return waitFor(async () => (await snapshot()).nodes.find((n) => !before.has(n.id))?.id, `the session started with ${text}`);
  };
  const worldTransform = () => page.locator(".waygoal-world").evaluate((el) => el.style.transform);
  /** Whether a card sits wholly inside the canvas, panel and all. */
  const fullyVisible = async (selector) => waitFor(async () => {
    const canvas = await page.locator(".waygoal-viewport").boundingBox();
    const card = await page.locator(selector).boundingBox();
    if (!canvas || !card) return false;
    return card.x >= canvas.x && card.y >= canvas.y
      && card.x + card.width <= canvas.x + canvas.width
      && card.y + card.height <= canvas.y + canvas.height;
  }, `${selector} to be wholly in view`, 10_000).then(() => true, () => false);
  const openFind = async () => {
    await page.locator("[data-find]").click();
    await page.locator("[data-find-input]").waitFor();
  };

  // 1. A session nobody has named falls back to its first message, and the
  //    fallback is shown as a fallback rather than as a name.
  await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  const filmId = await startChat("放映会放哪部片好");
  check("an unnamed session falls back to its first message without that becoming its name",
    (await nodeOf(filmId)).titleSource === "fallback", JSON.stringify(await nodeOf(filmId)));

  // 2. Renaming goes through Pi's own rename, and the box starts empty: a
  //    fallback is not offered back as though the user had written it.
  const before = { position: (await nodeOf(filmId)).position, messages: messagesOf(filmId), count: (await nodeOf(filmId)).messageCount };
  await page.locator("[data-rename]").click();
  check("the rename box does not start out holding the fallback title",
    (await page.locator("[data-rename-input]").inputValue()) === "");
  await page.locator("[data-rename-input]").fill("放映会选片");
  const requestsBeforeRename = model.requests.length;
  await page.locator("[data-rename-save]").click();
  await waitFor(async () => (await nodeOf(filmId)).title === "放映会选片", "the renamed title");
  await page.locator(`[data-node="${filmId}"]`).getByText("放映会选片").waitFor();
  const after = await nodeOf(filmId);
  check("renaming keeps the session's identity, place, messages and relations, and calls no model",
    after.titleSource === "name" && after.position.x === before.position.x && after.position.y === before.position.y
    && after.messageCount === before.count && JSON.stringify(messagesOf(filmId)) === JSON.stringify(before.messages)
    && model.requests.length === requestsBeforeRename,
    JSON.stringify({ after, was: before, requests: model.requests.length - requestsBeforeRename }));

  // 3. Ordinary chat does not take the name back.
  await send("再想想开场");
  await delay(800);
  check("plain chat does not overwrite the name the user gave", (await nodeOf(filmId)).title === "放映会选片");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(`[data-node="${filmId}"]`).getByText("放映会选片").waitFor();
  check("and neither does a refresh", (await nodeOf(filmId)).title === "放映会选片");
  await page.screenshot({ animations: "disabled", path: join(evidence, "01-renamed.png") });

  // 4. Generating a title is explicit content work: nothing asks for one until
  //    the user does, and then exactly one request goes out.
  const roomId = await startChat("场地就定在客厅吧");
  check("nothing asks a model for a title on its own", model.titleRequests() === 0, String(model.titleRequests()));
  const messagesBeforeNaming = messagesOf(roomId);
  await page.locator("[data-autoname]").click();
  await waitFor(async () => (await nodeOf(roomId)).title === "挑一部适合朋友的片子", "the generated title");
  check("asking Pi for a name uses the host's own title generation, once, and adds no message to the session",
    model.titleRequests() === 1 && (await nodeOf(roomId)).titleSource === "name"
    && JSON.stringify(messagesOf(roomId)) === JSON.stringify(messagesBeforeNaming),
    JSON.stringify({ titleRequests: model.titleRequests() }));
  // Rename it to something of its own, so the two sessions read apart.
  await page.locator("[data-rename]").click();
  await page.locator("[data-rename-input]").fill("放映会场地");
  await page.locator("[data-rename-save]").click();
  await waitFor(async () => (await nodeOf(roomId)).title === "放映会场地", "the second renamed title");

  // 5. A host restart, then finding it by title. The tab is closed before
  //    the host stops, so what it logs while the host is away is not
  //    mistaken for a page error.
  await closePanel();
  await page.close().catch(() => {});
  await stopServer(server);
  server = await startServer();
  page = await openPage();
  await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  await page.locator(`[data-node="${filmId}"]`).getByText("放映会选片").waitFor();
  check("the names survive a host restart", (await nodeOf(filmId)).title === "放映会选片" && (await nodeOf(roomId)).title === "放映会场地");

  await openFind();
  check("finding opens over the canvas instead of replacing it with a session list",
    await page.locator(".waygoal-viewport").isVisible());
  await page.locator("[data-find-input]").fill("选片");
  await page.locator(`[data-find-hit="${filmId}"]`).waitFor();
  check("only the session whose title has those characters is offered",
    (await page.locator(".waygoal-find li").count()) === 1,
    String(await page.locator(".waygoal-find li").count()));
  await page.screenshot({ animations: "disabled", path: join(evidence, "02-finding.png") });

  const viewBeforeHit = await worldTransform();
  const requestsBeforeHit = model.requests.length;
  const leafBeforeHit = (await nodeOf(filmId)).activeLeafId;
  const messagesBeforeHit = messagesOf(filmId);
  await page.locator(`[data-find-hit="${filmId}"]`).click();
  await panel().getByText("回复: 放映会放哪部片好", { exact: true }).waitFor();
  await delay(600);
  check("going to a hit moves the view and opens it, without sending anything or changing where it would continue",
    (await worldTransform()) !== viewBeforeHit && model.requests.length === requestsBeforeHit
    && (await nodeOf(filmId)).activeLeafId === leafBeforeHit
    && JSON.stringify(messagesOf(filmId)) === JSON.stringify(messagesBeforeHit));
  check("and the card it went to is wholly in view, not left under the panel",
    await fullyVisible(`[data-node="${filmId}"]`));

  // 6. A ticket is findable by the title its source file gives it, and finding
  //    does not rename it.
  await openFind();
  await page.locator("[data-find-input]").fill("放哪部片");
  const ticketPath = ".scratch/party/issues/02-film.md";
  await page.locator(`[data-find-hit="${ticketPath}"]`).waitFor();
  await page.locator(`[data-find-hit="${ticketPath}"]`).click();
  await panel().locator(".waygoal-ticket-panel").waitFor();
  check("a ticket it went to is wholly in view too",
    await fullyVisible(`[data-node="${ticketPath}"]`));
  check("a ticket is found under the title its source file gives it, and has no rename controls",
    (await page.locator("[data-rename]").count()) === 0
    && (await snapshot()).tickets.maps[0].tickets.some((t) => t.title === "放哪部片"),
    String(await page.locator("[data-rename]").count()));

  // 7. Nothing matching says so, and changes nothing.
  await openFind();
  await page.locator("[data-find-input]").fill("完全没有的字");
  await page.locator(".waygoal-find").getByText("没有标题里带这几个字的。查找只按标题，不改动任何会话。").waitFor();
  check("a title nobody has says so, rather than offering a near miss",
    (await page.locator(".waygoal-find li").count()) === 0);

  // 8. An empty box is 最近访问: the discussions, and no tickets.
  await page.locator("[data-find-input]").fill("");
  await page.locator(".waygoal-find").getByText("最近聊过的").waitFor();
  const recent = await page.locator(".waygoal-find li .waygoal-find-title").allInnerTexts();
  check("an empty box lists the discussions and no tickets",
    recent.length === 2 && recent.includes("放映会选片") && recent.includes("放映会场地"), JSON.stringify(recent));
  await page.keyboard.press("Escape");

  // Talking in one of them is what puts it at the top of 最近访问.
  // Going there through 查找, because after the last step its card is off screen.
  await openFind();
  await page.locator("[data-find-input]").fill("选片");
  await page.locator(`[data-find-hit="${filmId}"]`).click();
  await panel().getByText("回复: 放映会放哪部片好", { exact: true }).waitFor();
  await send("再确认一次片单");
  await closePanel();
  await openFind();
  const afterTalk = await page.locator(".waygoal-find li .waygoal-find-title").allInnerTexts();
  check("the discussion just talked in comes first", afterTalk[0] === "放映会选片", JSON.stringify(afterTalk));
  await page.keyboard.press("Escape");

  // 9. The thumbnail stands for what is on the canvas, and clicking it only
  //    moves the view.
  await closePanel();
  await page.getByRole("button", { name: "回到全景" }).click();
  await delay(600);
  const cardCount = (await snapshot()).nodes.length + (await snapshot()).tickets.maps.reduce((n, m) => n + 1 + m.tickets.length, 0);
  check("the thumbnail draws every card on the canvas and where the user is looking",
    (await page.locator(".waygoal-thumb-card").count()) === cardCount
    && await page.locator("[data-thumb-view]").isVisible(),
    JSON.stringify({ drawn: await page.locator(".waygoal-thumb-card").count(), cardCount }));
  await page.screenshot({ animations: "disabled", path: join(evidence, "03-thumbnail.png") });

  // Reached from the keyboard there is no point to read, so it means 全景.
  await page.locator("[data-thumb]").focus();
  await page.keyboard.press("Enter");
  await delay(600);
  const panorama = await worldTransform();
  await page.getByRole("button", { name: "回到全景" }).click();
  await delay(600);
  check("pressing the thumbnail from the keyboard goes to the whole canvas rather than a corner",
    panorama === (await worldTransform()), JSON.stringify({ panorama, fitAll: await worldTransform() }));

  const viewBeforeThumb = await worldTransform();
  const requestsBeforeThumb = model.requests.length;
  const leafBeforeThumb = (await nodeOf(roomId)).activeLeafId;
  const thumbBox = await page.locator("[data-thumb]").boundingBox();
  await page.mouse.click(thumbBox.x + 12, thumbBox.y + 12);
  await delay(600);
  check("clicking the thumbnail moves the view only: no panel opens, nothing is sent, no session changes where it continues",
    (await worldTransform()) !== viewBeforeThumb && (await page.locator(".waygoal-panel").count()) === 0
    && model.requests.length === requestsBeforeThumb && (await nodeOf(roomId)).activeLeafId === leafBeforeThumb);

  // 10. And one way back to where the canvas was left.
  const lastSeen = (await snapshot()).lastViewed;
  await page.locator("[data-continue]").click();
  await panel().getByText("回复: 再确认一次片单", { exact: true }).waitFor();
  check("回到上次看的地方 comes back to the card the canvas was left on",
    lastSeen === filmId && (await page.locator(`[data-node="${filmId}"].selected`).count()) === 1,
    JSON.stringify({ lastSeen, filmId }));

  check("no page or console errors", errors.length === 0, errors.join("\n"));
  await context.close();

  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks }, null, 2));
  console.log(`\nAll ${checks.length} checks passed. Evidence: ${evidence}`);
} catch (error) {
  process.exitCode = 1;
  await page?.screenshot({ path: join(artifacts, "waygoal-find-failure.png"), fullPage: false }).catch(() => {});
  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks, failure: String(error?.stack ?? error) }, null, 2));
  writeFileSync(join(artifacts, "waygoal-find-model-requests.json"), JSON.stringify(model.requests, null, 2));
  console.error(error);
} finally {
  await browser?.close().catch(() => {});
  await stopServer(server);
  await Promise.race([model.close(), delay(5000)]);
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
}
