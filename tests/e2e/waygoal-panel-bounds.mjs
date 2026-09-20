import { evidenceDirectory } from "./waygoal-artifacts.mjs";
// Regression: canvas pinches must not zoom the browser page; associating
// two turns must not navigate the chat or change its draft/Pi history.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { modelsJson, startFakeModel } from "./fake-model.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const evidence = evidenceDirectory("panel-bounds");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-panel-bounds-server.log"));

const agentDir = mkdtempSync(join(tmpdir(), "waygoal-interactions-e2e-"));
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
const canvasUrl = `${base}/?cwd=${encodeURIComponent(workspace)}`;

async function startServer() {
  const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WAYGOAL: "1", PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
  });
  server = child;
  child.stdout.pipe(serverLog, { end: false }); child.stderr.pipe(serverLog, { end: false });
  const deadline = Date.now() + 120_000;
  for (;;) {
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-panel-bounds-server.log");
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-panel-bounds-server.log");
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

const id = "44444444-4444-4444-8444-444444444444";
const timestamp = new Date().toISOString();
const records = [{ type: "session", version: 3, id, cwd: workspace, timestamp }];
let parentId = null;
for (let index = 0; index < 26; index++) {
  const entryId = (index + 1).toString(16).padStart(8, "0");
  const role = index % 2 ? "assistant" : "user";
  records.push({ type: "message", id: entryId, parentId, timestamp, message: { role, content: [{ type: "text", text: role === "user" ? `问题 ${index / 2 + 1}` : "这一轮的回复。\n\n".repeat(12) }], ...(role === "assistant" ? { api: "openai-completions", provider: "e2e", model: "e2e-model", stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } : {}), timestamp: Date.now() } });
  parentId = entryId;
}
mkdirSync(join(agentDir, "sessions", "fixture"), { recursive: true });
writeFileSync(join(agentDir, "sessions", "fixture", `fixture_${id}.jsonl`), records.map(record => JSON.stringify(record)).join("\n") + "\n");
const otherId = "55555555-5555-4555-8555-555555555555";
const otherRecords = records.slice(0, 7).map(record => record.type === 'session'
  ? { ...record, id: otherId }
  : { ...record, message: { ...record.message, content: [{ type: 'text', text: `另一段讨论 ${record.id}` }] } });
writeFileSync(join(agentDir, 'sessions', 'fixture', `fixture_${otherId}.jsonl`), otherRecords.map(record => JSON.stringify(record)).join('\n') + '\n');
try {
  server = await startServer();
  const legacy = await fetch(`${base}/?session=${id}`, { redirect: "manual" });
  check('legacy session bookmarks redirect to the full chat surface', legacy.status === 307 && legacy.headers.get('location') === `/chat?session=${id}`);
  const update = await (await fetch(`${base}/api/app-update`)).json();
  check('application updates use Waygoal identity', update.updateAvailable === false && update.releaseUrl === 'https://github.com/s0ftnote/Waygoal/releases');
  browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => localStorage.setItem('waygoal.chat-panel-size', JSON.stringify({ width: 1324, height: 1048 })));
  await page.goto(canvasUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.locator(`[data-node="${id}"]`).click();
  const data = await waitFor(async () => {
    const response = await fetch(`${base}/api/waygoal/session/${id}/turns`);
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
    const body = await response.json();
    return body.turns?.length ? body : null;
  }, 'turns ready');
  const target = data.turns[12].id;
  await page.locator(`[data-turn="${target}"]`).waitFor();
  const panel = page.locator('.waygoal-panel');
  await panel.locator('textarea').waitFor();
  await panel.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.getByRole('button', { name: '当前轮次', exact: true }).click();
  await page.locator(`[data-turn="${target}"] .waygoal-turn-content`).click();
  await panel.locator(`[data-entry-id="${target}"]`).waitFor();
  const cameraBefore = await page.locator('.waygoal-world').evaluate(element => element.style.transform);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.synthesizePinchGesture', { x: 150, y: 450, scaleFactor: 1.4, gestureSourceType: 'mouse' });
  await delay(700);
  const geometry = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight, scale: visualViewport.scale, offsetTop: visualViewport.offsetTop },
    window: { x: scrollX, y: scrollY },
    elements: ['.waygoal-app', '.waygoal-stage', '.waygoal-top', '.waygoal-panel', '.waygoal-panel-head', '.waygoal-panel textarea'].map(selector => {
      const element = document.querySelector(selector), r = element.getBoundingClientRect();
      return { selector, x: r.x, y: r.y, right: r.right, bottom: r.bottom, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop };
    })
  }));
  console.log(JSON.stringify(geometry));
  await page.screenshot({ path: join(evidence, 'node-open.png') });
  check('opening a turn keeps navigation, panel and composer within the viewport', geometry.viewport.scale === 1 && geometry.window.x === 0 && geometry.window.y === 0 && geometry.elements.every(r => r.x >= -1 && r.y >= -1 && r.right <= geometry.viewport.width + 1 && r.bottom <= geometry.viewport.height + 1));
  check('pinching still zooms the canvas', cameraBefore !== await page.locator('.waygoal-world').evaluate(element => element.style.transform));
  check('browser zoom remains available outside the canvas', await panel.evaluate(element => element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -10 }))));

  // A tab already magnified before the fix must also recover its controls.
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.4 });
  await delay(350);
  const recovered = await page.evaluate(() => {
    const v = visualViewport;
    return ['.waygoal-top', '.waygoal-panel', '.waygoal-panel-head', '.waygoal-panel textarea'].map(selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { selector, visible: r.left >= v.offsetLeft - 1 && r.top >= v.offsetTop - 1 && r.right <= v.offsetLeft + v.width + 1 && r.bottom <= v.offsetTop + v.height + 1 };
    });
  });
  check('an already magnified page keeps the panel header and composer in the visible viewport', recovered.every(r => r.visible), JSON.stringify(recovered));
  await page.screenshot({ path: join(evidence, 'retained-zoom-recovered.png') });
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await delay(350);

  await page.getByRole('button', { name: '全景', exact: true }).click();
  await page.locator(`[data-node="${otherId}"]`).click();
  await page.locator(`[data-session="${otherId}"][data-turn]`).first().waitFor();
  const composer = panel.locator('textarea').first();
  await composer.fill('保留这段草稿');
  const entriesBefore = readFileSync(join(agentDir, 'sessions', 'fixture', `fixture_${otherId}.jsonl`), 'utf8');
  const openLinkTool = async () => {
    await page.locator('.waygoal-turn-more > summary').click();
    await page.locator('.waygoal-turn-more-body').getByRole('button', { name: '标记相关', exact: true }).click();
  };
  const source = page.locator(`[data-session="${id}"][data-turn="00000001"] .waygoal-turn-content`);
  const targetCard = page.locator(`[data-session="${otherId}"][data-turn="00000001"] .waygoal-turn-content`);
  await page.getByRole('button', { name: '全景', exact: true }).click();
  await openLinkTool();
  await source.click();
  check('selecting a link source keeps the current chat and explains the next step', await panel.getAttribute('data-session-id') === otherId && await page.getByText('再点一张相关的卡片', { exact: true }).isVisible());
  await page.screenshot({ path: join(evidence, 'association-desktop.png') });
  await targetCard.click();
  await page.getByText('已标记相关', { exact: true }).waitFor();
  check('whole-card clicks save one cross-session association and preserve the draft', (await snapshot()).turnBoard.links.length === 1 && await composer.inputValue() === '保留这段草稿');
  await openLinkTool(); await source.click(); await targetCard.click();
  await page.getByText('已标记相关', { exact: true }).waitFor();
  check('repeating an association does not remove it', (await snapshot()).turnBoard.links.length === 1);
  await page.getByRole('button', { name: /手动关联：/ }).focus();
  await page.getByRole('button', { name: /手动关联：/ }).press('Enter');
  await page.getByRole('button', { name: '移除关联', exact: true }).click();
  await waitFor(async () => (await snapshot()).turnBoard.links.length === 0, 'association removed explicitly');
  await openLinkTool(); await source.click();
  await page.getByRole('button', { name: '取消关联', exact: true }).click();
  check('cancelling leaves no association', (await snapshot()).turnBoard.links.length === 0);
  await openLinkTool(); await source.click();
  await page.route('**/api/waygoal', async route => {
    if (route.request().method() === 'PATCH' && route.request().postDataJSON()?.turnBoard) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '测试保存失败' }) });
    await route.continue();
  });
  await targetCard.click();
  await page.getByText('关联没有保存，请重新点选目标卡片重试。', { exact: true }).waitFor();
  check('failed association remains selected for retry without a phantom edge', (await snapshot()).turnBoard.links.length === 0 && await page.locator('[data-link-source]').count() === 1);
  await page.unroute('**/api/waygoal');
  await targetCard.click(); await page.getByText('已标记相关', { exact: true }).waitFor();
  check('association retry succeeds without sending or changing Pi history', (await snapshot()).turnBoard.links.length === 1 && model.requests.length === 0 && readFileSync(join(agentDir, 'sessions', 'fixture', `fixture_${otherId}.jsonl`), 'utf8') === entriesBefore);
  await openLinkTool(); await source.click();
  await page.keyboard.press('Escape');
  check('Escape cancels association without closing the chat', await panel.isVisible() && !await page.getByRole('group', { name: '标记相关', exact: true }).count());
  await openLinkTool(); await source.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('group', { name: '标记相关', exact: true }).waitFor();
  const guide = await page.getByRole('group', { name: '标记相关', exact: true }).boundingBox();
  check('association instructions and cancel remain within a phone viewport', guide.x >= 0 && guide.x + guide.width <= 390 && guide.y >= 0 && guide.y + guide.height <= 844);
  await page.screenshot({ path: join(evidence, 'association-mobile.png') });
  await page.getByRole('button', { name: '取消关联', exact: true }).click();
  check('mobile cancellation preserves the chat draft', await composer.inputValue() === '保留这段草稿');

  writeFileSync(join(evidence, 'checks.json'), JSON.stringify(checks, null, 2));
} catch (error) {
  for (const context of browser?.contexts() ?? []) for (const page of context.pages()) {
    await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close().catch(() => {});
  await stopServer(server);
  await Promise.race([model.close(), delay(5000)]);
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
}
