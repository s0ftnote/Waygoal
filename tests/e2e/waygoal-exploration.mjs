// Run only in an isolated checkout: real Pi persistence, controlled model, real UI.
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
import { evidenceDirectory } from "./waygoal-artifacts.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use an isolated checkout without an active dev server");
const evidence = evidenceDirectory("exploration");
mkdirSync(evidence, { recursive: true });
const log = createWriteStream(join(evidence, "server.log"));
const agentDir = mkdtempSync(join(tmpdir(), "waygoal-exploration-")), workspace = join(agentDir, "workspace");
mkdirSync(workspace);
const model = await startFakeModel({ reply: "探索回复" });
writeFileSync(join(agentDir, "models.json"), modelsJson(model.baseUrl));
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "e2e", defaultModel: "e2e-model" }));
const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
const base = `http://127.0.0.1:${probe.address().port}`;
await new Promise(resolve => probe.close(resolve));
const checks = [], commands = [], errors = [];
let server, browser, releaseHeld = () => {}, releaseStream = () => {};
const check = (name, ok) => { checks.push({ name, ok: Boolean(ok) }); assert.ok(ok, name); console.log(`PASS: ${name}`); };
async function waitFor(predicate, name, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) { const result = await predicate(); if (result) return result; assert.ok(Date.now() < deadline, `Timed out: ${name}`); await delay(150); }
}
async function api(path, body) {
  const response = await fetch(`${base}${path}`, { ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000) });
  assert.ok(response.ok, `${path}: ${response.status}`); return response.json();
}
const snapshot = () => api(`/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`);
const turns = id => api(`/api/waygoal/session/${id}/turns`);
function entries(id) {
  const dir = join(agentDir, "sessions");
  const file = readdirSync(dir, { recursive: true }).find(file => String(file).endsWith(`_${id}.jsonl`));
  assert.ok(file, `Pi file: ${id}`);
  return readFileSync(join(dir, String(file)), "utf8").trim().split("\n").map(JSON.parse);
}
async function answered(id, question) {
  return waitFor(async () => (await turns(id)).turns.find(turn => turn.question === question && turn.answer), question);
}
async function seed(question) {
  const { sessionId } = await api("/api/agent/new", { cwd: workspace, type: "prompt", message: question, provider: "e2e", modelId: "e2e-model" });
  return { id: sessionId, turn: await answered(sessionId, question) };
}
const interrupt = () => { process.exitCode = 1; releaseHeld(); releaseStream(); server?.kill("SIGTERM"); void browser?.close().catch(() => {}); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
try {
  server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", new URL(base).port], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WAYGOAL: "1", PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
  });
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
  await waitFor(async () => {
    assert.equal(server.exitCode, null, "server exited; see server.log");
    return fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}`, { signal: AbortSignal.timeout(5000) }).then(r => r.ok).catch(() => false);
  }, "server ready", 120_000);
  // Independent sessions are essential: current-history citations are deduplicated.
  const sources = [await seed("来源甲：保留第一份完整原文"), await seed("来源乙：保留第二份不同原文")];
  const target = await seed("目标共同问题");
  await api(`/api/agent/${target.id}`, { type: "prompt", message: "目标路径甲" });
  const pathA = await answered(target.id, "目标路径甲");
  await api(`/api/agent/${target.id}`, { type: "navigate_tree", targetId: target.turn.endId });
  await api(`/api/agent/${target.id}`, { type: "prompt", message: "目标路径乙" });
  const pathB = await answered(target.id, "目标路径乙");
  await waitFor(async () => !(await snapshot()).nodes.some(node => node.running), "seed runs settled");
  const sourceFiles = sources.map(source => JSON.stringify(entries(source.id)));
  browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-US" });
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (request.method() === "POST" && /\/api\/agent\//.test(request.url())) commands.push({ url: request.url(), ...request.postDataJSON() });
  });
  const panel = page.locator(".waygoal-panel"), composer = panel.locator("textarea").first();
  const tray = page.getByLabel("下一轮引用材料", { exact: true });
  const rows = tray.locator("[data-material-key]"); // Never depend on generated material identity.
  const action = name => page.getByRole("button", { name, exact: true });
  const forkButton = page.getByRole("toolbar").getByRole("button", { name: "分叉探索", exact: true });
  const dialog = page.getByRole("dialog", { name: "分叉探索", exact: true });
  async function menu(callback) {
    const more = page.locator(".waygoal-turn-more");
    if (!await more.evaluate(el => el.open)) await more.locator("summary").click();
    await callback();
    if (await more.evaluate(el => el.open)) await more.locator("summary").click();
  }
  const tool = name => menu(() => action(name).click());
  const browse = id => menu(() => page.getByRole("combobox", { name: "查看会话轮次" }).selectOption(id));
  async function continuePath(turn) {
    await browse(target.id); await tool("选择继续路径");
    await page.getByRole("navigation", { name: "Tree 路径选择" }).getByRole("button", { name: new RegExp(turn.question) }).click();
    await waitFor(async () => await panel.getAttribute("data-session-id") === target.id && (await turns(target.id)).activeLeafId === turn.endId, "target path");
    await composer.waitFor();
  }
  async function selectSources(mode = "menu") {
    for (const source of sources) await browse(source.id);
    await action("全景").click();
    if (mode === "menu") await tool("多选轮次");
    // macOS reserves Control-click for the context menu; use the platform's
    // actual additive-selection gesture instead of testing an OS right-click.
    for (const source of sources) await page.locator(`[data-turn="${source.turn.id}"] .waygoal-turn-content`).click(mode === "menu" ? {} : { modifiers: ["ControlOrMeta"] });
    await action("加入材料，继续综合").waitFor();
    // Contract with TurnCanvas: accessible scope selector, not positional select.
    await page.getByRole("combobox", { name: "综合材料范围", exact: true }).selectOption("answer");
  }
  async function screenshotPair(name) {
    await page.screenshot({ path: join(evidence, `${name}-desktop.png`), animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    check(`${name}: mobile has no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(evidence, `${name}-mobile.png`), animations: "disabled" });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  async function selectText(startId, endId = startId) {
    const start = panel.locator(`[data-entry-id="${startId}"]`).first(); await start.scrollIntoViewIfNeeded();
    return panel.evaluate((root, ids) => {
      const textNode = id => {
        const message = root.querySelector(`[data-entry-id="${id}"]`);
        const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
        for (let node; (node = walker.nextNode());) if (node.textContent.includes("目标")) return node;
        throw new Error(`No original text in ${id}`);
      };
      const first = textNode(ids[0]), last = textNode(ids[1]), range = document.createRange();
      range.setStart(first, 0); range.setEnd(last, last.textContent.length);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      first.parentElement.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      return selection.toString();
    }, [startId, endId]);
  }
  await page.goto(`${base}/waygoal?cwd=${encodeURIComponent(workspace)}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await continuePath(pathB); await composer.fill("目标原草稿不覆盖");
  const requestsBefore = model.requests.length;
  await selectSources();
  await waitFor(() => action("加入材料，继续综合").isEnabled(), "selection ready");
  await screenshotPair("01-multiselect");
  await page.route("**/materials?**", route => route.request().url().includes(`/session/${sources[1].id}/`)
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "材料读取失败测试" }) }) : route.continue());
  await action("加入材料，继续综合").click();
  await page.getByRole("alert").filter({ hasText: "材料读取失败测试" }).waitFor();
  check("failed batch leaves draft and materials untouched", await rows.count() === 0 && await composer.inputValue() === "目标原草稿不覆盖");
  await page.unroute("**/materials?**");
  // Escape resets selection before each fresh attempt (including failed capture).
  await page.keyboard.press("Escape"); await selectSources("Control");
  let captured = false;
  const gate = new Promise(resolve => { releaseHeld = resolve; });
  await page.route("**/materials?**", async route => {
    const response = await route.fetch(); captured = true; await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await action("加入材料，继续综合").click(); await waitFor(() => captured, "held material response");
  await continuePath(pathA); await composer.fill("甲路径独立草稿");
  releaseHeld(); await page.unrouteAll({ behavior: "wait" });
  check("late batch cannot contaminate another path", await rows.count() === 0 && await composer.inputValue() === "甲路径独立草稿");
  await continuePath(pathB);
  check("late batch does not reappear on departure path", await rows.count() === 0 && await composer.inputValue() === "目标原草稿不覆盖");
  await page.keyboard.press("Escape"); await selectSources("Meta");
  await action("加入材料，继续综合").click(); await waitFor(async () => await rows.count() === 2, "two material arrivals");
  check("batch neither sends nor replaces the active draft", model.requests.length === requestsBefore && await composer.inputValue() === "目标原草稿不覆盖" && await panel.getAttribute("data-session-id") === target.id);
  await tray.getByText("本次额外带入", { exact: false }).waitFor();
  const characters = sources.reduce((total, source) => total + source.turn.answer.length, 0);
  check("tray exposes exact text character total", (await tray.innerText()).includes(`${characters.toLocaleString("zh-CN")} 个文本字符`));
  for (const row of await rows.all()) {
    if (!await row.locator("details").evaluate(el => el.open)) await row.locator("summary").click();
    check("tray exposes readable source, not just opaque IDs", /来源[甲乙]/.test(await row.locator(".waygoal-material-source").innerText()));
    await row.getByRole("button", { name: "查看来源", exact: true }).waitFor();
  }
  await tray.evaluate(el => { el.scrollTop = 0; el.querySelectorAll("details").forEach(details => { details.open = false; }); });
  await screenshotPair("02-tray");
  await page.evaluate(() => { window.keptComposer = document.querySelector(".waygoal-panel textarea"); });
  const targetBefore = JSON.stringify(entries(target.id)), beforeLocate = commands.length;
  await rows.first().getByRole("button", { name: "查看来源", exact: true }).click();
  await page.locator(".waygoal-canvas-preview").waitFor();
  check("view source is read-only and preserves composer DOM/path/draft", commands.length === beforeLocate && await panel.getAttribute("data-session-id") === target.id && await composer.inputValue() === "目标原草稿不覆盖" && JSON.stringify(entries(target.id)) === targetBefore && (await turns(target.id)).activeLeafId === pathB.endId && await page.evaluate(() => window.keptComposer === document.querySelector(".waygoal-panel textarea")));
  await panel.getByRole("button", { name: "关闭预览", exact: true }).click();
  await composer.waitFor();
  await tray.getByRole("button", { name: "移除材料 2", exact: true }).click();
  await waitFor(async () => await rows.count() === 1, "remove material 2");
  await tray.getByRole("button", { name: "移除材料 1", exact: true }).click();
  await waitFor(async () => await rows.count() === 0, "remove material 1");
  await page.keyboard.press("Escape"); await selectSources(); await action("加入材料，继续综合").click();
  await waitFor(async () => await rows.count() === 2, "restore two materials");
  const reviewed = await rows.locator("pre").allTextContents();
  check("review contains precisely both original answers", reviewed.length === 2 && sources.every(source => reviewed.includes(source.turn.answer)));

  // Selection is in saved message text, never a toolbar/button or a source preview.
  await selectText(target.turn.id); await delay(100);
  check("user-only selection cannot fork", !await forkButton.isVisible());
  await selectText(target.turn.endId, pathB.endId); await delay(100);
  check("cross-message selection cannot fork", !await forkButton.isVisible());
  const quote = await selectText(target.turn.endId); await forkButton.click();
  await dialog.waitFor();
  check("compact exploration input is prefilled with the quote", (await dialog.locator("textarea").inputValue()).includes(quote) && (await dialog.boundingBox()).width <= 440);
  await screenshotPair("03-exploration");
  const countBefore = (await snapshot()).nodes.length, commandsBefore = commands.length;
  await dialog.getByRole("button", { name: /^(Close|关闭)$/ }).click();
  check("cancel creates no session or command and preserves main draft/materials", (await snapshot()).nodes.length === countBefore && commands.length === commandsBefore && await composer.inputValue() === "目标原草稿不覆盖" && await rows.count() === 2);
  await selectText(target.turn.endId); await forkButton.click();
  await waitFor(async () => (await dialog.locator("textarea").inputValue()).includes(quote), "reopened quote prefilled");
  const exploration = `${await dialog.locator("textarea").inputValue()}\n探索问题：给出独立解释`;
  await dialog.locator("textarea").fill(exploration);
  let rejected = false;
  await page.route("**/api/agent/*", route => {
    if (route.request().method() !== "POST") return route.continue();
    const command = route.request().postDataJSON();
    if (command?.type === "prompt" && !rejected) { rejected = true; return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "探索首次发送失败", code: "prompt_rejected", accepted: false }) }); }
    return route.continue();
  });
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  await waitFor(() => rejected, "first fork prompt rejected");
  const fork = await waitFor(async () => (await snapshot()).nodes.find(node => ![target.id, ...sources.map(s => s.id)].includes(node.id)), "fork saved");
  await waitFor(async () => (await dialog.isVisible() ? await dialog.locator("textarea").inputValue() : await composer.inputValue()) === exploration, "rejected exploration draft restored");
  check("fork command targets exact saved assistant", commands.filter(c => c.type === "fork_branch").length === 1 && commands.find(c => c.type === "fork_branch").entryId === target.turn.endId && commands.find(c => c.type === "fork_branch").url.endsWith(`/api/agent/${target.id}`));
  await page.unroute("**/api/agent/*");
  let acceptanceHeld = false;
  const acceptedGate = new Promise(resolve => { releaseHeld = resolve; });
  await page.route(`**/api/agent/${fork.id}`, async route => {
    if (route.request().method() !== "POST" || route.request().postDataJSON()?.type !== "prompt") return route.continue();
    const response = await route.fetch(); acceptanceHeld = true; await acceptedGate;
    await route.fulfill({ response });
  });
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Send", exact: true }).click(); else await composer.press("Enter");
  await answered(fork.id, exploration);
  await waitFor(() => acceptanceHeld, "accepted fork response held");
  check("retry reuses one fork and its independent reply", commands.filter(c => c.type === "fork_branch").length === 1 && (await snapshot()).nodes.length === countBefore + 1 && entries(fork.id).some(e => e.id === target.turn.endId) && !(await turns(fork.id)).turns.some(t => t.id === pathB.id));
  check("exploration preserves original Pi branch", JSON.stringify(entries(target.id)) === targetBefore && (await turns(target.id)).activeLeafId === pathB.endId);
  await continuePath(pathB);
  await waitFor(async () => await composer.inputValue() === "目标原草稿不覆盖" && await rows.count() === 2, "parked composer restored");
  const acceptedResponse = page.waitForResponse(response => response.url().endsWith(`/api/agent/${fork.id}`) && response.request().method() === "POST" && response.request().postDataJSON()?.type === "prompt");
  releaseHeld(); await acceptedResponse; await delay(200);
  await page.unroute(`**/api/agent/${fork.id}`);
  check("late acceptance from the unmounted fork cannot clear the restored main tray", await rows.count() === 2 && await composer.inputValue() === "目标原草稿不覆盖");
  check("return restores main draft and both parked materials", await composer.inputValue() === "目标原草稿不覆盖" && await rows.count() === 2);
  await composer.fill("综合两份独立回答"); await composer.press("Enter");
  const synthesized = await answered(target.id, "综合两份独立回答");
  const request = model.requests.findLast(r => JSON.stringify(r.body.messages.at(-1)).includes("综合两份独立回答"));
  const content = request?.body.messages.at(-1).content;
  const sentText = typeof content === "string" ? content : (content ?? []).map(part => part.text ?? "").join("");
  check("Pi model receives both reviewed original answers and scoped identities", reviewed.every(text => sentText.includes(text)) && sources.every(source => sentText.includes(source.id) && sentText.includes(source.turn.id)));
  check("saved sources retain both scoped original snapshots", synthesized.sources.length === 2 && sources.every(source => synthesized.sources.some(saved => saved.sessionId === source.id && saved.turnId === source.turn.id && saved.scope === "answer" && saved.snapshot.includes(source.turn.answer))));
  await page.reload({ waitUntil: "domcontentloaded" }); await composer.waitFor();
  check("provenance survives reload; independent sources unchanged", (await turns(target.id)).turns.find(t => t.id === synthesized.id).sources.length === 2 && sources.every((source, index) => JSON.stringify(entries(source.id)) === sourceFiles[index]));
  // A visible streamed answer is not yet a saved source. Do not attribute its
  // selection to the preceding saved answer or allow a fork while running.
  releaseStream = model.pauseAfterText();
  await composer.fill("流式选文边界"); await composer.press("Enter");
  const unsaved = panel.getByText("探索回复: 流式选文边界", { exact: true });
  await unsaved.waitFor();
  await unsaved.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await page.locator('.waygoal-selection-popover[role="toolbar"]').waitFor();
  check("visible unsaved streamed text offers no fork action", !await forkButton.isVisible() && (await snapshot()).nodes.find(node => node.id === target.id).running && !(await turns(target.id)).turns.find(turn => turn.question === "流式选文边界")?.answer);
  await page.keyboard.press("Escape");
  await delay(200);
  check("Escape dismisses streamed selection without aborting the run", !commands.some(command => command.type === "abort") && (await snapshot()).nodes.find(node => node.id === target.id).running);
  await selectText(target.turn.endId); await page.locator('.waygoal-selection-popover[role="toolbar"]').waitFor();
  check("saved-answer selection also cannot fork while its session is running", !await forkButton.isVisible());
  await page.keyboard.press("Escape"); releaseStream();
  await answered(target.id, "流式选文边界");
  check("no browser errors", errors.length === 0);
} catch (error) {
  for (const context of browser?.contexts() ?? []) for (const page of context.pages()) await page.screenshot({ path: join(evidence, "failure.png") }).catch(() => {});
  throw error;
} finally {
  releaseHeld(); releaseStream();
  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ checks, errors }, null, 2));
  await browser?.close().catch(() => {});
  if (server && server.exitCode === null) {
    const exited = once(server, "exit"); server.kill("SIGTERM");
    const timer = setTimeout(() => server.kill("SIGKILL"), 15_000);
    await exited; clearTimeout(timer);
  }
  await Promise.race([model.close(), delay(5000)]); log.end();
  rmSync(agentDir, { recursive: true, force: true });
  process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
}
