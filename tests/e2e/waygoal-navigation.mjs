import { verifyMicrointeractions } from "./waygoal-microinteractions.mjs";
import { evidenceDirectory, openOverview } from "./waygoal-artifacts.mjs";
// Isolated regression for zoom-dependent Map headers: one overview action
// must settle at the same position as subsequent overview actions. Seed real
// Pi sessions so no model request or conversation timing affects geometry.
import assert from "node:assert/strict";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { modelsJson, startFakeModel } from "./fake-model.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const evidence = evidenceDirectory("navigation");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-navigation-server.log"));

const agentDir = mkdtempSync(join(tmpdir(), "waygoal-navigation-e2e-"));
const workspace = join(agentDir, "workspace");
mkdirSync(workspace);
const fixtures = [3, 1].map((count, index) => {
  const session = SessionManager.create(workspace, join(agentDir, "sessions", "fixture"));
  for (let i = 0; i < count; i++) {
    session.appendMessage({role:"user", content:`问题 ${index}-${i}`, timestamp:Date.now()});
    session.appendMessage({role:"assistant", content:[{type:"text",text:"回复"}], timestamp:Date.now()});
  }
  return session.getSessionId();
});
const model = await startFakeModel({ reply: "回复" });
writeFileSync(join(agentDir, "models.json"), modelsJson(model.baseUrl));
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "e2e", defaultModel: "e2e-model" }));

const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); assert.ok(ok, `${name} ${detail}`); console.log(`PASS: ${name}`); };

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
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-navigation-server.log");
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-navigation-server.log");
    await delay(250);
  }
}
async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit"); child.kill("SIGTERM");
  await Promise.race([exited, delay(15_000).then(() => child.kill("SIGKILL"))]);
  // A host killed before its own cleanup can leave the next suite locked out.
  rmSync(join(root, ".next/dev/lock"), { force: true });
}

const snapshot = async () => (await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`, { cache: "no-store" })).json();
const nodeOf = async (id) => (await snapshot()).nodes.find((n) => n.id === id) ?? null;
function sessionEntries(id) {
  const file = readdirSync(join(agentDir, "sessions"), { recursive: true }).find((f) => String(f).endsWith(`_${id}.jsonl`));
  assert.ok(file, `session file for ${id}`);
  return readFileSync(join(agentDir, "sessions", String(file)), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}
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
    // These checks exercise workspace/session organization. Return through the
    // real overview control when the turn view covers those controls.
    await p.addLocatorHandler(p.locator('.waygoal-canvas-area:not([data-managing]) .waygoal-turn-more > summary'), async button => {
      await button.click(); await p.getByRole('button', { name: '整理会话与票据', exact: true }).click();
    });
    p.setDefaultTimeout(30_000);
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("crash", () => errors.push("page crashed"));
    p.on("console", (e) => { if (e.type() === "error") errors.push(e.text()); });
    p.on("response", (r) => { if (r.url().startsWith(base) && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
    return p;
  };
  await fetch(`${base}/api/waygoal`, {method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({cwd:workspace,positions:{[fixtures[0]]:{x:0,y:200},[fixtures[1]]:{x:640,y:0},".scratch/party/issues/01-room.md":{x:320,y:0},".scratch/party/issues/02-film.md":{x:320,y:200}}})});
  page = await openPage();
  const closePanel = async () => {
    const close = page.getByRole("button", { name: "关闭面板" });
    if (await close.count() > 0 && await close.isVisible()) await close.click();
  };
  const worldTransform = () => page.locator(".waygoal-world").evaluate((el) => el.style.transform);
  await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  await openOverview(page);
  const roomId = fixtures[1];
  for (const id of fixtures) {
    await closePanel();
    await page.getByRole("button", { name: "回到全景", exact:true }).click();
    await page.locator(`[data-node="${id}"]`).click();
    await page.locator("[data-turn]").first().waitFor();
  }
  await verifyMicrointeractions(page, check);
  // The thumbnail represents the current scene; navigation only moves the view.
  await closePanel();
  await page.getByRole("button", { name: "回到全景" }).click();
  await delay(600);
  const clusterToggle = page.locator('[data-cluster-toggle]').first();
  const arrowBefore = await clusterToggle.locator('path').getAttribute('d');
  await clusterToggle.locator('svg').evaluate(el => { el.dataset.originalArrow = 'true'; });
  await clusterToggle.click();
  await page.waitForFunction(() => document.querySelector('[data-cluster-toggle]')?.getAttribute('aria-expanded') === 'false');
  await delay(150);
  check('Map disclosure keeps one arrow and rotates it to show the folded state',
    await clusterToggle.locator('path').getAttribute('d') === arrowBefore
    && await clusterToggle.locator('svg').getAttribute('data-original-arrow') === 'true'
    && await clusterToggle.locator('svg').evaluate(el => getComputedStyle(el).transform === 'none' && getComputedStyle(el).transitionDuration === '0.12s'));
  await clusterToggle.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-cluster-toggle]')?.getAttribute('aria-expanded') === 'true');
  check('keyboard Map disclosure rotates immediately without a transition', await clusterToggle.locator('svg').evaluate(el =>
    getComputedStyle(el).transitionDuration === '0s' && Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).b - 1) < .001));
  await page.getByRole('button', { name: '回到全景', exact: true }).click();
  await delay(300);
  const cardCount = (await snapshot()).nodes.length + (await snapshot()).tickets.maps.reduce((n, m) => n + 1 + m.tickets.length, 0)
    + await page.locator("[data-turn]").count();
  check("the thumbnail starts folded to leave room for canvas controls", !(await page.locator("[data-thumb]").isVisible()));
  await page.locator(".waygoal-thumb-heading").click();
  check("the thumbnail draws every card on the canvas and where the user is looking",
    (await page.locator(".waygoal-thumb-card").count()) === cardCount
    && await page.locator("[data-thumb-view]").isVisible(),
    JSON.stringify({ drawn: await page.locator(".waygoal-thumb-card").count(), cardCount }));
  await page.screenshot({ animations: "disabled", path: join(evidence, "03-thumbnail.png") });

  // Dragging must move the real canvas before pointerup, not just on click.
  const minimap = await page.locator("[data-thumb]").boundingBox();
  await page.mouse.move(minimap.x + minimap.width / 2, minimap.y + minimap.height / 2);
  await page.mouse.down();
  const dragStart = await worldTransform();
  await page.mouse.move(minimap.x + minimap.width / 2 + 24, minimap.y + minimap.height / 2 + 16, { steps: 5 });
  await delay(80);
  const duringDrag = await worldTransform();
  check("minimap pans the canvas while the pointer is held", JSON.stringify(duringDrag) !== JSON.stringify(dragStart));
  await page.mouse.move(minimap.x + minimap.width + 24, minimap.y + minimap.height + 16, { steps: 5 });
  await delay(80);
  const outsideDrag = await worldTransform();
  check("minimap retains pointer capture outside its bounds", outsideDrag !== duringDrag);
  await page.mouse.up();
  await delay(80);
  const releasedDrag = await worldTransform();
  check("releasing minimap does not jump the canvas", releasedDrag === outsideDrag, JSON.stringify({ outsideDrag, releasedDrag }));

  await page.locator(".waygoal-viewport").focus();
  for (let i=0; i<7; i++) await page.keyboard.press("+");
  await delay(600);
  // Reached from the keyboard there is no point to read, so it means 全景.
  await page.locator("[data-thumb]").focus();
  await page.keyboard.press("Enter");
  await delay(600);
  const panorama = await worldTransform();
  await page.getByRole("button", { name: "回到全景" }).click();
  await delay(600);
  check("pressing the thumbnail from the keyboard goes to the whole canvas rather than a corner",
    panorama === (await worldTransform()), JSON.stringify({ panorama, fitAll: await worldTransform() }));

  await page.getByRole("button", { name: "回到全景" }).click();
  await delay(600);
  check("repeated overview does not keep changing the scene", panorama === await worldTransform());

  // Interrupt during fit rather than after its measurement has completed.
  // DOM keyboard events exercise the same capture/camera handlers as users.
  await page.locator(".waygoal-viewport").evaluate(el => {
    el.focus();
    el.dispatchEvent(new KeyboardEvent("keydown", {key:"0", bubbles:true}));
    el.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowRight", bubbles:true}));
  });
  const interrupted = await worldTransform();
  await delay(600);
  check("manual navigation cancels pending overview", interrupted === await worldTransform() && interrupted !== panorama);

  const viewBeforeThumb = await worldTransform();
  const requestsBeforeThumb = model.requests.length;
  const leafBeforeThumb = (await nodeOf(roomId)).activeLeafId;
  const thumbBox = await page.locator("[data-thumb]").boundingBox();
  await page.mouse.click(thumbBox.x + 12, thumbBox.y + 12);
  await delay(600);
  check("clicking the thumbnail moves the view only: no panel opens, nothing is sent, no session changes where it continues",
    (await worldTransform()) !== viewBeforeThumb && (await page.locator(".waygoal-panel").count()) === 0
    && model.requests.length === requestsBeforeThumb && (await nodeOf(roomId)).activeLeafId === leafBeforeThumb);

  check("navigation never sends a model request", model.requests.length === 0);
  check("seeded conversation history is unchanged", fixtures.every(id => sessionEntries(id).filter(entry => entry.type === "message").length === (id === fixtures[0] ? 6 : 2)));
  check("no page or console errors", errors.length === 0, errors.join("\n"));
  await context.close();

  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks }, null, 2));
  console.log(`\nAll ${checks.length} checks passed. Evidence: ${evidence}`);
} catch (error) {
  process.exitCode = 1;
  await page?.screenshot({ path: join(artifacts, "waygoal-navigation-failure.png"), fullPage: false }).catch(() => {});
  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks, failure: String(error?.stack ?? error) }, null, 2));
  writeFileSync(join(artifacts, "waygoal-navigation-model-requests.json"), JSON.stringify(model.requests, null, 2));
  console.error(error);
} finally {
  await browser?.close().catch(() => {});
  await stopServer(server);
  await Promise.race([model.close(), delay(5000)]);
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
}
