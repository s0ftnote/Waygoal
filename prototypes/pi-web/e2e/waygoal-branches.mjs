// Browser verification for real branching on the Waygoal canvas (ticket #3).
// Starts its own pi-web on a free loopback port with an isolated Pi data
// directory and a fake OpenAI-compatible model, then drives one real round
// trip: explore two directions from the same message, read the other path
// without moving anything, continue from an explicit position, fork a new
// session, and come back after a reload and a host restart.
//
// Every state claim is checked against Pi's own session files, never against
// what the model answered.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { modelsJson, startFakeModel } from "./fake-model.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const evidence = resolve(root, "../../docs/research/prototype-evidence/branches");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-branches-server.log"));

const agentDir = mkdtempSync(join(tmpdir(), "waygoal-branch-e2e-"));
const workspace = join(agentDir, "workspace");
mkdirSync(workspace);
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

let server, browser;
const interrupt = () => { process.exitCode = 1; server?.kill("SIGTERM"); void browser?.close().catch(() => {}); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);

async function freePort() {
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port; await new Promise((r) => probe.close(r)); return port;
}
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const canvasUrl = `${base}/beacon?cwd=${encodeURIComponent(workspace)}`;

async function startServer() {
  const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BEACON_PROTOTYPE: "1", PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
  });
  child.stdout.pipe(serverLog, { end: false }); child.stderr.pipe(serverLog, { end: false });
  const deadline = Date.now() + 120_000;
  for (;;) {
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-branches-server.log");
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-branches-server.log");
    await delay(250);
  }
}
async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit"); child.kill("SIGTERM");
  await Promise.race([exited, delay(15_000).then(() => child.kill("SIGKILL"))]);
}

const snapshot = async () => (await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`)).json();
const branchView = async (id) => (await fetch(`${base}/api/waygoal/session/${encodeURIComponent(id)}`, { cache: "no-store" })).json();

/** Pi's own file, parsed. The source of truth for every state assertion. */
function sessionEntries(id) {
  const file = readdirSync(join(agentDir, "sessions"), { recursive: true }).find((f) => String(f).endsWith(`_${id}.jsonl`));
  assert.ok(file, `session file for ${id}`);
  return readFileSync(join(agentDir, "sessions", String(file)), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}
const userTexts = (id) => sessionEntries(id).filter((e) => e.type === "message" && e.message?.role === "user")
  .map((e) => typeof e.message.content === "string" ? e.message.content : (e.message.content ?? []).map((b) => b.text ?? "").join(""));
function entryById(id, entryId) { return sessionEntries(id).find((e) => e.id === entryId); }
/** Walk parentId links from `entryId` back to the root. */
function ancestorsOf(id, entryId) {
  const entries = sessionEntries(id);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const path = [];
  for (let cursor = byId.get(entryId); cursor; cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined) {
    path.unshift(cursor.id);
    if (!cursor.parentId) break;
  }
  return path;
}

try {
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
  let page = await openPage();
  const panel = () => page.locator(".waygoal-panel");
  const composer = () => panel().locator("textarea").first();
  // Per-message controls only appear while the message is hovered, and the row
  // they live in shifts layout as it appears. Hover, then click the real
  // coordinates so a re-hover cannot make the control vanish mid-click.
  const clickOnHover = async (messageText, buttonName) => {
    const message = panel().getByText(messageText, { exact: true }).first();
    await message.waitFor();
    // The message list keeps scrolling for a moment after a reply renders.
    await delay(800);
    await message.hover();
    const button = panel().getByRole("button", { name: buttonName }).first();
    await button.waitFor();
    const box = await waitFor(async () => {
      const b = await button.boundingBox();
      return b && b.width > 0 ? b : null;
    }, `${buttonName} to be laid out`, 10_000);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.up();
  };
  const send = async (text) => {
    const before = model.requests.length;
    await composer().fill(text);
    await panel().getByRole("button", { name: /^(Send|发送)$/ }).click();
    await waitFor(() => model.requests.length > before, `model request for ${text}`);
    await panel().getByText(`回复: ${text}`, { exact: true }).waitFor({ timeout: 60_000 });
    await delay(600);
  };

  // 1. A discussion with a shared origin message and a first direction.
  await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "新开聊天" }).click();
  await composer().waitFor();
  await send("周末聚会做什么");
  const sessionId = (await waitFor(async () => (await snapshot()).nodes[0]?.id, "the first canvas node"));
  await send("先说观影");
  check("a plain session starts with no branches", (await branchView(sessionId)).branchPoints.length === 0);

  // 2. Second direction from the same message: pi's in-session branch entry.
  await clickOnHover("先说观影", "Edit from here");
  await send("换成桌游");

  const branched = await waitFor(async () => {
    const view = await branchView(sessionId);
    return view.branchPoints.length === 1 ? view : null;
  }, "one real branch point");
  const [point] = branched.branchPoints;
  check("the two directions are one real branch point in Pi's tree, not two session files",
    point.choices.length === 2 && readdirSync(join(agentDir, "sessions"), { recursive: true }).filter((f) => String(f).endsWith(".jsonl")).length === 1);
  check("the shared origin message is the branch point", entryById(sessionId, point.entryId) !== undefined, point.entryId);
  const [pathA, pathB] = point.choices;
  check("both paths are kept and the newest one is where the session continues",
    pathA.active === false && pathB.active === true, JSON.stringify(point.choices.map((c) => [c.preview, c.active])));

  // The canvas itself shows the branch, not only the chat panel.
  await page.getByText("1 处会话内分叉").first().waitFor();
  await page.locator(".waygoal-chip").first().waitFor();
  check("the canvas marks the session as branched and lists its paths", await page.locator(".waygoal-chip").count() === 2);
  check("the canvas marks which path the session continues from", await page.locator(".waygoal-chip.active .waygoal-tag.continuing").count() === 1);
  await page.screenshot({ animations: "disabled", path: join(evidence, "01-two-paths.png") });

  // 3. Reading the other path changes the display only.
  const beforeRead = model.requests.length;
  const entriesBeforeRead = sessionEntries(sessionId).length;
  await page.locator(".waygoal-chip").first().click();
  await panel().getByText("只读回看，这里不会发送消息").waitFor();
  await panel().getByText("回复: 先说观影", { exact: true }).waitFor();
  await delay(1500);
  check("reading a sibling path sends nothing and adds no entry",
    model.requests.length === beforeRead && sessionEntries(sessionId).length === entriesBeforeRead);
  check("reading does not move where the session continues", (await branchView(sessionId)).branchPoints[0].choices[1].active === true);
  check("the panel separates what is being read from where it continues",
    await panel().locator(".waygoal-tag.reading").count() >= 1 && await panel().locator(".waygoal-tag.continuing").count() === 1);
  await page.screenshot({ animations: "disabled", path: join(evidence, "02-read-only.png") });

  // 4. A reload keeps the reading position, still without sending.
  await page.reload({ waitUntil: "domcontentloaded" });
  await panel().getByText("只读回看，这里不会发送消息").waitFor();
  await delay(1500);
  check("a reload comes back to the same reading position without sending",
    model.requests.length === beforeRead && sessionEntries(sessionId).length === entriesBeforeRead);

  // 5. Continuing is the explicit action that moves the active path.
  await panel().getByRole("button", { name: "从这里继续" }).first().click();
  await page.getByText(/继续位置已切到这条路径/).waitFor();
  await waitFor(async () => (await branchView(sessionId)).branchPoints[0].choices[0].active === true, "the first path becomes active");
  check("continuing moves the active path and still adds no message",
    sessionEntries(sessionId).length === entriesBeforeRead && model.requests.length === beforeRead);

  await send("再多说说观影");
  const lastUser = sessionEntries(sessionId).filter((e) => e.type === "message" && e.message?.role === "user").at(-1);
  const ancestors = ancestorsOf(sessionId, lastUser.id);
  check("the next message really lands on the chosen path", ancestors.includes(pathA.leafId), JSON.stringify({ ancestors, chosen: pathA.leafId }));
  check("it did not land on the other path", !ancestors.includes(pathB.entryId), JSON.stringify({ ancestors, other: pathB.entryId }));
  check("the abandoned path is still stored", entryById(sessionId, pathB.leafId) !== undefined);
  const lastRequest = JSON.stringify(model.requests.at(-1)?.body?.messages ?? []);
  check("the sibling path's content is not pulled into the continued context",
    lastRequest.includes("先说观影") && !lastRequest.includes("换成桌游"), lastRequest.slice(0, 400));
  await page.screenshot({ animations: "disabled", path: join(evidence, "03-after-continue.png") });

  // 5b. The same action from the read-only banner must land on the path's leaf.
  // Pi moves the leaf to a USER entry's parent and puts its text in the editor,
  // so continuing has to use the path's leaf, never the entry on display.
  const continueFromBanner = async (chipIndex) => {
    await page.locator(".waygoal-chip").nth(chipIndex).click();
    await panel().getByText("只读回看，这里不会发送消息").waitFor();
    await panel().locator(".waygoal-readonly-bar").getByRole("button", { name: "从这里继续" }).click();
    await page.getByText(/继续位置已切到这条路径/).waitFor();
  };
  const entriesBeforeBanner = sessionEntries(sessionId).length;
  await continueFromBanner(1);
  await waitFor(async () => (await branchView(sessionId)).activeLeafId === pathB.leafId, "the banner continues onto path B's leaf");
  check("continuing from the read-only banner lands on the path's leaf, not the message before it",
    (await branchView(sessionId)).activeLeafId === pathB.leafId && sessionEntries(sessionId).length === entriesBeforeBanner);
  await continueFromBanner(0);
  await waitFor(async () => (await branchView(sessionId)).branchPoints[0].choices[0].active === true, "path A is active again");

  // 6. A real fork: a separate session that remembers the message it came from.
  const originEntry = sessionEntries(sessionId).find((e) => e.type === "message" && e.message?.role === "user" && String(JSON.stringify(e.message.content)).includes("先说观影"));
  await page.locator(".waygoal-chip").first().click();
  await panel().getByText("只读回看，这里不会发送消息").waitFor();
  await clickOnHover("先说观影", "从这里分叉");
  const forkedId = await waitFor(async () => (await snapshot()).nodes.find((n) => n.id !== sessionId)?.id, "a second canvas node");
  const forkedNode = (await snapshot()).nodes.find((n) => n.id === forkedId);
  check("the fork is a separate Pi session file", sessionEntries(forkedId).length > 0 && forkedId !== sessionId);
  check("the fork records the session AND the message it came from",
    forkedNode.origin?.sessionId === sessionId && forkedNode.origin?.entryId === originEntry.id, JSON.stringify(forkedNode.origin));
  check("the original path is untouched by the fork", userTexts(sessionId).includes("先说观影") && userTexts(sessionId).includes("换成桌游"));
  await page.getByText(/分叉自「/).first().waitFor();
  check("the canvas draws the fork relation between the two nodes", await page.locator(".waygoal-links .waygoal-link").count() === 1);
  await page.locator(".waygoal-node").first().waitFor();
  await page.screenshot({ animations: "disabled", path: join(evidence, "04-forked.png") });

  // 7. From the fork, the origin message is reachable and reading it sends nothing.
  const beforeOrigin = model.requests.length;
  await panel().getByRole("button", { name: "回到来源这条消息" }).click();
  await panel().getByText("只读回看，这里不会发送消息").waitFor();
  await panel().getByText("先说观影", { exact: true }).first().waitFor();
  await delay(1200);
  check("going back to the origin message reads it without sending", model.requests.length === beforeOrigin);
  await page.screenshot({ animations: "disabled", path: join(evidence, "05-back-to-origin.png") });

  // 8. Host restart: origin and reading position survive; nothing is sent.
  const sentBeforeRestart = model.requests.length;
  const entriesBeforeRestart = sessionEntries(sessionId).length;
  // Close the tab before the host goes down: an open canvas keeps polling, and
  // its refused requests would be counted as page errors the product caused.
  await page.close().catch(() => {});
  await stopServer(server); server = await startServer();
  page = await openPage();
  await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  await panel().getByText("只读回看，这里不会发送消息").waitFor();
  await page.getByText(/分叉自「/).first().waitFor();
  await delay(1500);
  check("a host restart restores the fork origin and the reading position without sending",
    model.requests.length === sentBeforeRestart && sessionEntries(sessionId).length === entriesBeforeRestart);
  await page.screenshot({ animations: "disabled", path: join(evidence, "06-after-restart.png") });

  // 9. A reading position that no longer exists is reported, never re-bound.
  await fetch(`${base}/api/waygoal`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: workspace, lastViewed: sessionId, lastViewedEntry: "entry-that-never-existed" }),
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText(/上次查看的位置在这段会话里已经找不到了/).waitFor();
  check("a lost reading position is reported instead of bound to another history", true);
  await page.screenshot({ animations: "disabled", path: join(evidence, "07-missing-position.png") });

  check("no page or console errors", errors.length === 0, errors.join("\n"));
  await context.close();

  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks }, null, 2));
  console.log(`\nAll ${checks.length} checks passed. Evidence: ${evidence}`);
} catch (error) {
  process.exitCode = 1;
  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks, failure: String(error?.stack ?? error) }, null, 2));
  writeFileSync(join(artifacts, "waygoal-branches-model-requests.json"), JSON.stringify(model.requests, null, 2));
  console.error(error);
} finally {
  await browser?.close().catch(() => {});
  await stopServer(server);
  // A half-open SSE socket can keep the fake model's server from closing.
  await Promise.race([model.close(), delay(5000)]);
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
}
