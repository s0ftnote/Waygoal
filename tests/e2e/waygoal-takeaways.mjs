import { observeFeedback, feedbackEvents, clearFeedback } from "./waygoal-feedback.mjs";
import { evidenceDirectory } from "./waygoal-artifacts.mjs";
// Continuous-chat acceptance against an isolated, real Pi SDK host and a
// controlled model. Source identities and ancestry are checked in Pi files.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { modelsJson, startFakeModel } from "./fake-model.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const evidence = evidenceDirectory("semantic");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-takeaways-server.log"));

const agentDir = mkdtempSync(join(tmpdir(), "waygoal-takeaway-e2e-"));
const workspace = join(agentDir, "workspace");
mkdirSync(workspace);
const model = await startFakeModel({ reply: "回复" });
writeFileSync(join(agentDir, "models.json"), modelsJson(model.baseUrl));
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "e2e", defaultModel: "e2e-model" }));

const fixtureId = "44444444-4444-4444-8444-444444444444";
const fixtureDirectory = join(agentDir, "sessions", "--fixture--");
mkdirSync(fixtureDirectory, { recursive: true });
const timestamp = new Date().toISOString();
const records = [{ type: "session", version: 3, id: fixtureId, cwd: workspace, timestamp }];
let parentId = null;
const texts = ['设备同时离线，先确认影响范围', '先确认网关和受影响设备，再查看消息链路。', '网关在线，接下来验证消息链路', '网关正常。消息是否到达设备尚未确认，需要继续查看日志。'];
for (const [index, text] of texts.entries()) {
  const entryId = (index + 1).toString(16).padStart(8, '0');
  const role = index % 2 ? 'assistant' : 'user';
  records.push({ type: 'message', id: entryId, parentId, timestamp, message: { role, content: [{ type: 'text', text }], timestamp: Date.now(), ...(role === 'assistant' ? { api: 'openai-completions', provider: 'e2e', model: 'e2e-model', stopReason: 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } : {}) } });
  parentId = entryId;
}
writeFileSync(join(fixtureDirectory, `fixture_${fixtureId}.jsonl`), records.map(record => JSON.stringify(record)).join('\n') + '\n');
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
const canvasUrl = `${base}/waygoal?cwd=${encodeURIComponent(workspace)}`;

async function startServer() {
  const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WAYGOAL: "1", PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
  });
  child.stdout.pipe(serverLog, { end: false }); child.stderr.pipe(serverLog, { end: false });
  const deadline = Date.now() + 120_000;
  for (;;) {
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-takeaways-server.log");
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-takeaways-server.log");
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

const snapshot = async () => (await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`)).json();

/** Pi's own file, parsed. The source of truth for every state assertion. */
function sessionEntries(id) {
  const file = readdirSync(join(agentDir, "sessions"), { recursive: true }).find((f) => String(f).endsWith(`_${id}.jsonl`));
  assert.ok(file, `session file for ${id}`);
  return readFileSync(join(agentDir, "sessions", String(file)), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

try {
  server = await startServer();
  browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-US" });
  const page = await context.newPage(); page.setDefaultTimeout(20_000);
  await observeFeedback(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const composer = page.locator('.waygoal-panel textarea').first();
  await page.goto(canvasUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator(`[data-node="${fixtureId}"]`).click();
  await composer.waitFor();
  await waitFor(async () => await page.locator('[data-turn]').count() === 2, 'two turn cards');
  const id = (await snapshot()).nodes[0].id;
  const originalEntries = sessionEntries(id);
  await composer.fill('下一步还要验证重连后的状态');
  const inputHandle = await composer.elementHandle();
  const currentCard = page.locator('.waygoal-turn-card.active');
  const editor = page.getByRole('region', { name: '编辑这轮所得' });
  const openEditor = async () => {
    await page.getByRole('button', { name: '当前轮次', exact: true }).click();
    await currentCard.locator('.waygoal-turn-content').click();
    await page.getByRole('group', { name: '所选卡片操作' }).getByRole('button', { name: '所得', exact: true }).click();
    await editor.waitFor();
  };
  await openEditor();
  const before = model.requests.length;
  await editor.getByRole('button', { name: '请 Pi 提炼' }).click();
  await currentCard.locator('small').filter({ hasText: '待确认' }).waitFor();
  check('explicit generation creates a draft, with one isolated model request', model.requests.length === before + 1 && await currentCard.getAttribute('data-takeaway') === 'draft');
  const request = model.requests.at(-1).body;
  check('takeaway request contains only the selected turn and no tools', request.messages.filter(message => message.role === 'user').length === 1 && !JSON.stringify(request).includes('设备同时离线') && !(request.tools?.length));
  await editor.getByRole('textbox', { name: '画布上的一句话' }).fill('网关在线；消息链路仍待验证');
  await page.route( /\/api\/waygoal(?:\?.*)?$/, async route => {
    if (route.request().method() === 'PATCH') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '保存暂不可用' }) });
    else await route.continue();
  });
  await clearFeedback(page);
  await editor.getByRole('button', { name: '确认并保存' }).click();
  await editor.getByRole('alert').waitFor();
  check('failed saves never show confirmation feedback', !(await feedbackEvents(page)).some(event => event.className.includes('waygoal-takeaway-status')));
  check('save failure retains editable text', await editor.getByRole('textbox').inputValue() === '网关在线；消息链路仍待验证');
  await page.unroute( /\/api\/waygoal(?:\?.*)?$/);
  await editor.getByRole('button', { name: '确认并保存' }).click();
  await editor.waitFor({ state: 'detached' });
  await waitFor(async () => await currentCard.getAttribute('data-takeaway') === 'confirmed', 'confirmed takeaway');
  check('confirmation feedback follows a successful save', (await feedbackEvents(page)).some(event => event.className.includes('waygoal-takeaway-status') && event.duration === 160));
  const key = await currentCard.getAttribute('data-turn-key');
  check('confirmation is persisted separately in the canvas', (await snapshot()).turnBoard.takeaways[key].status === 'confirmed');
  await page.screenshot({ path: join(evidence, '01-detail.png') });
  const world = page.locator('.waygoal-turn-world');
  const zoomTo = async tier => {
    for (let i = 0; i < 20 && await world.getAttribute('data-zoom-tier') !== tier; i++) { await page.locator('.waygoal-viewport').press('-'); await delay(50); }
    await waitFor(async () => await world.getAttribute('data-zoom-tier') === tier, tier);
  };
  await zoomTo('map');
  check('middle distance promotes the takeaway headline', await currentCard.locator('strong').textContent() === '网关在线；消息链路仍待验证');
  await page.screenshot({ path: join(evidence, '02-map.png') });
  await zoomTo('overview');
  check('far distance shows confirmed landmarks', await currentCard.locator('.waygoal-turn-glyph').isVisible() && !(await currentCard.locator('strong').isVisible()));
  await page.screenshot({ path: join(evidence, '03-overview.png') });
  await currentCard.locator('.waygoal-turn-content').click();
  await waitFor(async () => await world.getAttribute('data-zoom-tier') === 'detail', 'click returns to readable scale');
  check('zoom, locate and takeaway editing preserve the composer and draft', await composer.inputValue() === '下一步还要验证重连后的状态' && await inputHandle.evaluate(element => element === document.querySelector('.waygoal-panel textarea')));
  check('takeaway operations preserve all Pi entries and active ancestry', JSON.stringify(sessionEntries(id)) === JSON.stringify(originalEntries), JSON.stringify({ before: originalEntries, after: sessionEntries(id) }));
  await openEditor();
  await page.screenshot({ path: join(evidence, '04-editor-desktop.png') });
  await editor.getByRole('button', { name: '关闭所得编辑' }).click();
  await page.reload();
  await page.locator('[data-takeaway="confirmed"]').waitFor();
  check('restoring confirmed history does not replay confirmation', !(await feedbackEvents(page)).some(event => event.className.includes('waygoal-takeaway-status')));
  check('takeaway survives reload', await page.locator('[data-takeaway="confirmed"]').textContent().then(text => text.includes('消息链路仍待验证')));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.waygoal-panel-head').getByRole('button', { name: '← 回到画布', exact: true }).waitFor();
  await openEditor();
  const rect = await editor.boundingBox();
  check('mobile editor fits within the viewport', rect.x >= 0 && rect.x + rect.width <= 390 && rect.y >= 0 && rect.y + rect.height <= 844);
  const saveButton = await editor.getByRole('button', { name: '确认并保存' }).boundingBox();
  check('mobile primary action is visible without scrolling', saveButton.y >= rect.y && saveButton.y + saveButton.height <= rect.y + rect.height);
  await editor.getByRole('button', { name: '确认并保存' }).click();
  await editor.waitFor({ state: 'detached' });
  await openEditor();
  await page.screenshot({ path: join(evidence, '05-editor-mobile.png') });
  check('no browser runtime errors', errors.length === 0, errors.join('\n'));
  writeFileSync(join(evidence, 'checks.json'), JSON.stringify(checks, null, 2));
} catch (error) {
  for (const context of browser?.contexts() ?? []) for (const page of context.pages()) await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close().catch(() => {});
  await stopServer(server);
  await Promise.race([model.close(), delay(5000)]);
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
}
