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

const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const evidence = evidenceDirectory("turns");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-turns-server.log"));

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
const canvasUrl = `${base}/waygoal?cwd=${encodeURIComponent(workspace)}`;

async function startServer() {
  const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WAYGOAL: "1", PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
  });
  child.stdout.pipe(serverLog, { end: false }); child.stderr.pipe(serverLog, { end: false });
  const deadline = Date.now() + 120_000;
  for (;;) {
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-turns-server.log");
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-turns-server.log");
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-US" });
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const panel = page.locator(".waygoal-panel");
  const composer = panel.locator("textarea").first();
  const send = async (text) => {
    const before = model.requests.length;
    await composer.fill(text); await composer.press("Enter");
    await waitFor(() => model.requests.length > before, `request ${text}`);
    await waitFor(async () => !(await snapshot()).nodes.some(node => node.running), "run settled");
    await panel.getByText(`回复: ${text}`, { exact: true }).waitFor();
    await delay(300);
  };
  const openTools = async () => {
    if (!await page.locator('.waygoal-turn-more').evaluate(element => element.open)) await page.locator('.waygoal-turn-more > summary').click();
  };
  const tool = async name => { await openTools(); await page.getByRole('button', { name, exact: true }).click(); if (await page.locator('.waygoal-turn-more[open]').count()) await page.locator('.waygoal-turn-more > summary').click(); };
  const browseSession = async id => { await openTools(); await page.getByRole('combobox', { name: '查看会话轮次' }).selectOption(id); if (await page.locator('.waygoal-turn-more[open]').count()) await page.locator('.waygoal-turn-more > summary').click(); };
  const turns = async id => (await fetch(`${base}/api/waygoal/session/${id}/turns`)).json();
  await page.goto(canvasUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await composer.waitFor();
  check("empty canvas opens a composer without creating a Pi session", (await snapshot()).nodes.length === 0 && model.requests.length === 0 && await page.locator('[data-empty-entry="true"]').count() === 1);
  await page.evaluate(() => { window.entryInput = document.querySelector('.waygoal-panel textarea'); });
  await page.screenshot({ path: join(evidence, "00-empty-entry.png") });
  await page.route('**/api/agent/new', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '首次发送暂不可用' }) }));
  await composer.fill('发送失败保留草稿'); await composer.press('Enter');
  await page.getByText('HTTP 503', { exact: false }).first().waitFor();
  check("failed first send stays at the empty entry and retains the draft", (await snapshot()).nodes.length === 0 && await page.locator('[data-empty-entry="true"]').count() === 1 && (await composer.inputValue()) === '发送失败保留草稿');
  await page.unroute('**/api/agent/new');
  await send("共同问题");
  const id = await waitFor(async () => (await snapshot()).nodes[0]?.id, "session");
  await page.locator("[data-turn]").first().waitFor();
  await page.locator('[data-empty-entry="true"]').waitFor({ state: "detached" });
  check("first saved turn reveals the canvas without replacing the composer", await page.evaluate(() => window.entryInput === document.querySelector('.waygoal-panel textarea')) && await page.locator('[data-turn]').count() === 1);
  await page.screenshot({ path: join(evidence, "00-first-turn.png"), animations: "disabled" });
  const firstTurn = (await turns(id)).turns[0];
  await page.evaluate(() => {
    window.keptInput = document.querySelector(".waygoal-panel textarea");
    window.keptMessage = document.querySelector(".waygoal-panel [data-entry-id]");
    window.keptCard = document.querySelector("[data-turn]");
  });
  for (const text of ["继续第一轮", "继续第二轮", "继续第三轮"]) await send(text);
  await waitFor(async () => await page.locator("[data-turn]").count() === 4, "four original turn identities");
  check("three continuous sends preserve the input, original message and card DOM", await page.evaluate(() => window.keptInput === document.querySelector(".waygoal-panel textarea") && window.keptMessage === document.querySelector(".waygoal-panel [data-entry-id]") && window.keptCard === document.querySelector("[data-turn]")));
  check("input focus remains in the composer", await composer.evaluate(element => element === document.activeElement));
  await composer.fill("草稿保持原样");
  const before = model.requests.length, entriesBefore = sessionEntries(id).length;
  await page.getByRole("button", { name: "全景", exact: true }).click();
  await page.locator(`[data-turn="${firstTurn.id}"] .waygoal-turn-content`).click();
  check("locating a historical card preserves draft and input DOM", await composer.inputValue() === "草稿保持原样" && await page.evaluate(() => window.keptInput === document.querySelector(".waygoal-panel textarea")));
  check("locating sends nothing and adds no Pi entries", before === model.requests.length && entriesBefore === sessionEntries(id).length);
  const firstOriginal = panel.locator(`[data-entry-id="${firstTurn.id}"]`);
  await firstOriginal.getByRole("button", { name: "定位卡片" }).click();
  await page.locator(`[data-turn="${firstTurn.id}"] .waygoal-turn-content`).click();
  const actions = page.getByRole('group', { name: '所选卡片操作' });
  await actions.waitFor();
  const cardBox = await page.locator(`[data-turn="${firstTurn.id}"]`).boundingBox(), actionBox = await actions.boundingBox();
  check("card actions are anchored beside the selected card", Math.min(Math.abs(actionBox.y + actionBox.height - cardBox.y), Math.abs(actionBox.y - cardBox.y - cardBox.height)) < 35);
  await page.keyboard.press('Escape');
  check("Escape dismisses the card actions", !await actions.isVisible());
  check("chat entry navigation locates the matching real card", await page.locator(`[data-turn="${firstTurn.id}"]`).evaluate(element => element.classList.contains("selected")));
  await page.screenshot({ path: join(evidence, "01-continuous.png") });

  // A real sibling is prepared through the host command. Its UI is then
  // explored, selected and sent through the unchanged production composer.
  const lastA = (await turns(id)).activeLeafId;
  const response = await fetch(`${base}/api/agent/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "navigate_tree", targetId: firstTurn.endId }) });
  assert.ok(response.ok);
  const prompt = await fetch(`${base}/api/agent/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "prompt", message: "另一条路径的材料" }) });
  assert.ok(prompt.ok);
  await waitFor(async () => (await turns(id)).turns.some(turn => turn.question === "另一条路径的材料" && turn.answer), "sibling answer");
  // Reload to reconcile the explicit external path change.
  await page.reload({ waitUntil: "domcontentloaded" });
  await composer.waitFor();
  const branched = await turns(id), sibling = branched.turns.find(turn => turn.question === "另一条路径的材料");
  await waitFor(async () => await page.locator("[data-turn]").count() === 5, "sibling cards");
  await composer.fill("B 路径草稿");
  await page.evaluate(() => { window.keptInput = document.querySelector(".waygoal-panel textarea"); });
  const inactive = branched.turns.find(turn => turn.question === "继续第一轮");
  await page.getByRole("button", { name: "全景", exact: true }).click();
  await page.locator(`[data-turn="${inactive.id}"] .waygoal-turn-content`).click();
  await page.getByRole("region", { name: "会话画布区域" }).locator(".waygoal-canvas-preview").waitFor();
  check("sibling preview stays on the canvas and preserves the active composer", await composer.inputValue() === "B 路径草稿" && await page.evaluate(() => window.keptInput === document.querySelector(".waygoal-panel textarea")));
  check("preview does not change Pi's active leaf", (await turns(id)).activeLeafId === branched.activeLeafId);
  await page.locator('[data-turn="'+firstTurn.id+'"] .waygoal-turn-content').click();
  await waitFor(async () => !(await snapshot()).preview, "card location clears saved preview");
  check("locating an active card dismisses and clears the saved preview", await page.locator(".waygoal-canvas-preview").count() === 0);
  await tool("选择继续路径");
  await page.getByRole("navigation", { name: "Tree 路径选择" }).getByRole("button", { name: /继续第三轮/ }).click();
  await waitFor(async () => (await turns(id)).activeLeafId === lastA, "explicit Tree selects A");
  await composer.fill("A 路径草稿");
  await tool("选择继续路径");
  await page.getByRole("navigation", { name: "Tree 路径选择" }).getByRole("button", { name: /另一条路径的材料/ }).click();
  await waitFor(async () => await composer.inputValue() === "B 路径草稿", "restore B draft");
  await tool("选择继续路径");
  await page.getByRole("navigation", { name: "Tree 路径选择" }).getByRole("button", { name: /继续第三轮/ }).click();
  await waitFor(async () => await composer.inputValue() === "A 路径草稿", "restore A draft");
  check("Tree restores independent drafts for both paths", true);

  await tool("引用连线");
  await page.locator(`[data-turn="${sibling.id}"] .waygoal-turn-port`).click();
  // Next turn can lie outside the viewport; locate current, then zoom out.
  await page.getByRole("button", { name: "当前轮次", exact: true }).click();
  let releaseMaterial, capturedMaterial;
  const materialHeld = new Promise(resolve => { capturedMaterial = resolve; });
  const materialGate = new Promise(resolve => { releaseMaterial = resolve; });
  await page.route("**/materials?**", async route => {
    const response = await route.fetch(); capturedMaterial(); await materialGate;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.locator("[data-next-turn]").click();
  await materialHeld;
  await tool("选择继续路径");
  await page.getByRole("navigation", { name: "Tree 路径选择" }).getByRole("button", { name: /另一条路径的材料/ }).click();
  await waitFor(async () => await composer.inputValue() === "B 路径草稿", "switch while material response is held");
  releaseMaterial(); await page.unrouteAll({ behavior: "wait" });
  check("a delayed material response cannot enter another path's draft", await page.getByLabel("下一轮引用材料").count() === 0);
  await tool("选择继续路径");
  await page.getByRole("navigation", { name: "Tree 路径选择" }).getByRole("button", { name: /继续第三轮/ }).click();
  await waitFor(async () => await composer.inputValue() === "A 路径草稿", "return after canceled capture");
  await page.getByRole("button", { name: "当前轮次", exact: true }).click();
  await page.locator("[data-next-turn]").click();
  const tray = page.getByLabel("下一轮引用材料"); await tray.waitFor();
  await tray.locator("summary").click();
  const reviewed = await tray.locator("pre").allTextContents();
  check("reference selection keeps the ordinary draft", await composer.inputValue() === "A 路径草稿");
  // Enter a parked session directly on a different path, then return to the
  // path whose composer held the material. Text and references must both return.
  await page.getByRole("button", { name: "新开聊天", exact: true }).click();
  await send("独立对话用于往返");
  const otherSessionId = await waitFor(async () => (await snapshot()).nodes.find(node => node.id !== id)?.id, "second session");
  await browseSession(id);
  await page.locator(`[data-turn="${sibling.id}"]`).waitFor();
  await tool("选择继续路径");
  await page.getByRole("navigation", { name: "Tree 路径选择" }).getByRole("button", { name: /另一条路径的材料/ }).click();
  await waitFor(async () => await composer.inputValue() === "B 路径草稿", "cross-session entry into B path");
  check("entering another path does not carry the parked path's references", await tray.count() === 0);
  await tool("选择继续路径");
  await page.getByRole("navigation", { name: "Tree 路径选择" }).getByRole("button", { name: /继续第三轮/ }).click();
  await waitFor(async () => await composer.inputValue() === "A 路径草稿", "cross-session return to original path");
  await tray.waitFor();
  await tray.locator("summary").click();
  check("cross-session Tree navigation restores the original material snapshot", JSON.stringify(await tray.locator("pre").allTextContents()) === JSON.stringify(reviewed));
  const editMessage = panel.locator("[data-entry-id]").filter({ hasText: "继续第二轮" }).first();
  await editMessage.hover();
  await editMessage.getByRole("button", { name: "Edit from here", exact: true }).click();
  await waitFor(async () => await composer.inputValue() === "继续第二轮", "edit uses source text");
  check("editing a historical turn changes path without carrying another path's pending material", await tray.count() === 0);
  await tool("选择继续路径");
  await page.getByRole("navigation", { name: "Tree 路径选择" }).getByRole("button", { name: /继续第三轮/ }).click();
  await waitFor(async () => await composer.inputValue() === "A 路径草稿", "edit departure draft returns");
  await tray.waitFor();
  check("returning after an edit restores the original material snapshot", true);
  await composer.fill("带着引用继续"); await composer.press("Enter");
  await waitFor(() => model.requests.some(request => JSON.stringify(request.body.messages).includes("带着引用继续")), "reference reaches model");
  const actual = model.requests.at(-1).body.messages.at(-1);
  const actualText = typeof actual.content === "string" ? actual.content : actual.content.map(block => block.text ?? "").join("");
  check("the model receives exactly the reviewed source text and scoped identity", reviewed.every(text => actualText.includes(text)) && actualText.includes(sibling.id) && actualText.includes(id));
  await waitFor(async () => !(await snapshot()).nodes.some(node => node.running), "reference settled");
  const referenced = (await turns(id)).turns.find(turn => turn.question === "带着引用继续");
  check("the sent turn durably retains the reference source", referenced.sources[0].turnId === sibling.id);
  check("reference send continues the selected path", ancestorsOf(id, referenced.id).includes(lastA));
  await send("引用之后仍能接着聊");
  await page.screenshot({ path: join(evidence, "02-reference.png") });
  await page.reload({ waitUntil: "domcontentloaded" }); await composer.waitFor();
  check("reference provenance survives reload", (await turns(id)).turns.find(turn => turn.id === referenced.id).sources[0].turnId === sibling.id);

  // Fork inclusively after a real assistant message using the message action.
  await panel.locator(`[data-entry-id="${firstTurn.id}"]`).waitFor();
  const assistant = panel.locator(`[data-entry-id="${firstTurn.endId}"]`).first();
  await assistant.getByRole("button", { name: "从这里分叉", exact: true }).click();
  const forkId = await waitFor(async () => (await snapshot()).nodes.find(node => ![id, otherSessionId].includes(node.id))?.id, "independent fork");
  await composer.waitFor();
  await send("分叉里连续聊一"); await send("分叉里连续聊二");
  check("assistant fork includes its source answer and then continuous replies", ancestorsOf(forkId, (await turns(forkId)).activeLeafId).includes(firstTurn.endId));
  check("original session remains independent", !(JSON.stringify(sessionEntries(id))).includes("分叉里连续聊一"));
  const forkOwn = (await turns(forkId)).turns.find(turn => turn.question === "分叉里连续聊二");
  await waitFor(async () => await page.locator(`[data-turn="${forkOwn.id}"]`).count() === 1, "fork grows on the shared canvas");
  check("shared board retains original and fork with one verified inherited prefix", await page.locator(`[data-turn="${firstTurn.id}"]`).count() === 1 && await page.locator(`[data-turn="${sibling.id}"]`).count() === 1);
  await composer.fill("分叉草稿保留");
  const forkLeaf = (await turns(forkId)).activeLeafId;
  await page.evaluate(() => { window.keptInput = document.querySelector(".waygoal-panel textarea"); });
  const foldingUrl = page.url();
  await page.evaluate(() => { window.keptWorld = document.querySelector(".waygoal-world"); });
  const collapseOriginal = page.locator(`[data-collapse-session="${id}"]`);
  await collapseOriginal.focus(); await collapseOriginal.press("Enter");
  await waitFor(async () => await page.locator(`[data-node="${id}"]`).getAttribute("aria-expanded") === "false", "original collapses in place");
  check("folding keeps other sessions and the continuous composer in the same canvas", await page.locator(`[data-node="${forkId}"][data-expanded]`).count() === 1 && await composer.inputValue() === "分叉草稿保留" && await page.evaluate(() => window.keptInput === document.querySelector(".waygoal-panel textarea") && window.keptWorld === document.querySelector(".waygoal-world")) && page.url() === foldingUrl);
  check("folding sends nothing and preserves the active Pi path", (await turns(forkId)).activeLeafId === forkLeaf);
  await tool("选择继续路径");
  await page.getByRole("navigation", { name: "Tree 路径选择" }).getByRole("button", { name: /分叉里连续聊二/ }).waitFor();
  await page.keyboard.press("Escape");
  // Expand by inspecting the source selector without changing the active chat.
  await browseSession(id);
  await waitFor(async () => await page.locator(`[data-node="${id}"][data-expanded]`).count() === 1, "source expands alongside fork");
  check("multiple sessions expand together without replacing the current conversation", await page.locator('[data-node][data-expanded]').count() >= 2 && await composer.inputValue() === "分叉草稿保留" && await page.evaluate(() => window.keptWorld === document.querySelector(".waygoal-world")));
  // Keyboard activation works even when a wire lies outside the current camera.
  const forkWire = page.getByRole("button", { name: /^分叉来源：/ }).first();
  await forkWire.focus(); await forkWire.press("Enter");
  await page.getByLabel("关系来源").waitFor();
  check("inspecting a fork edge preserves the active history and draft", (await turns(forkId)).activeLeafId === forkLeaf && await composer.inputValue() === "分叉草稿保留" && await page.evaluate(() => window.keptInput === document.querySelector(".waygoal-panel textarea")));
  await page.getByRole("button", { name: "关闭关系预览" }).click();
  await tool("引用连线");
  await page.getByRole("button", { name: "全景", exact: true }).click();
  await page.locator(`[data-turn="${sibling.id}"] .waygoal-turn-port`).click();
  await page.locator("[data-next-turn]").click();
  await tray.waitFor(); await tray.locator("summary").click();
  const crossReviewed = await tray.locator("pre").allTextContents();
  await composer.fill("跨会话带回材料"); await composer.press("Enter");
  const crossTurn = await waitFor(async () => (await turns(forkId)).turns.find(turn => turn.question === "跨会话带回材料" && turn.answer), "cross-session material answered");
  check("cross-session reference retains the exact source identity and frozen submitted text", crossTurn.sources[0].sessionId === id && crossTurn.sources[0].turnId === sibling.id && crossReviewed.every(text => crossTurn.sources[0].snapshot.includes(text)));
  check("cross-session material leaves the target's Pi ancestry intact", ancestorsOf(forkId, crossTurn.id).includes(forkLeaf) && !ancestorsOf(forkId, crossTurn.id).includes(sibling.id));
  const referenceMessage = panel.locator(`[data-entry-id="${crossTurn.id}"]`);
  await referenceMessage.getByRole("button", { name: "引用来源", exact: true }).click();
  await page.getByLabel("关系来源").waitFor();
  check("the right-hand original opens its exact sent reference", await page.getByLabel("关系来源").locator("pre").textContent() === crossTurn.sources[0].snapshot);
  await page.getByRole("button", { name: "关闭关系预览" }).click();
  await tool("仅作关联");
  await page.getByRole("button", { name: "全景", exact: true }).click();
  await page.locator(`[data-turn="${sibling.id}"] .waygoal-turn-port`).click();
  await page.locator(`[data-turn="${forkOwn.id}"] .waygoal-turn-port`).click();
  await waitFor(async () => (await snapshot()).turnBoard?.links.length === 1, "cross-session association persisted");
  await page.getByRole("button", { name: "当前轮次", exact: true }).click();
  const draggedCard = page.locator(`[data-turn="${crossTurn.id}"]`);
  const savedBeforeDrag = (await snapshot()).turnBoard.positions[JSON.stringify([forkId, crossTurn.id])];
  const beforeDrag = await draggedCard.evaluate(element => ({ x: parseFloat(element.style.left), y: parseFloat(element.style.top) }));
  const box = await draggedCard.boundingBox();
  await page.mouse.move(box.x + 90, box.y + 60); await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 90, { steps: 6 }); await page.mouse.up();
  const movedPosition = { x: beforeDrag.x + 50, y: beforeDrag.y + 30 };
  await waitFor(async () => JSON.stringify((await snapshot()).turnBoard?.positions[JSON.stringify([forkId, crossTurn.id])]) === JSON.stringify({ x: savedBeforeDrag.x + 50, y: savedBeforeDrag.y + 30 }), "shared card drag persisted");
  await page.reload({ waitUntil: "domcontentloaded" }); await composer.waitFor();
  await page.getByRole("button", { name: /^手动关联：/ }).waitFor();
  check("manual associations and frozen references survive reload", (await snapshot()).turnBoard.links.length === 1 && (await turns(forkId)).turns.find(turn => turn.id === crossTurn.id).sources[0].snapshot === crossTurn.sources[0].snapshot);
  check("shared card layout survives reload with its scoped identity", await draggedCard.evaluate((element, point) => parseFloat(element.style.left) === point.x && parseFloat(element.style.top) === point.y, movedPosition));
  await page.getByRole("button", { name: "全景", exact: true }).click();
  await page.screenshot({ path: join(evidence, "05-shared-board.png") });
  await page.route(`**/api/waygoal/session/${id}/turns`, route => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "source temporarily unavailable" }) }));
  await page.reload({ waitUntil: "domcontentloaded" }); await composer.waitFor();
  await page.locator(".waygoal-turn-error").waitFor();
  await panel.locator(`[data-entry-id="${crossTurn.id}"]`).getByRole("button", { name: "引用来源", exact: true }).click();
  await page.getByLabel("关系来源").waitFor();
  check("a missing source still exposes the immutable sent snapshot", await page.getByLabel("关系来源").locator("pre").textContent() === crossTurn.sources[0].snapshot && await page.getByLabel("关系来源").getByRole("button", { name: "查看来源", exact: true }).isDisabled());
  await page.unrouteAll({ behavior: "wait" });
  await page.reload({ waitUntil: "domcontentloaded" }); await composer.waitFor();
  model.slowMs = 5000;
  await composer.fill("运行中定位"); await composer.press("Enter");
  const liveTurn = await waitFor(async () => (await turns(forkId)).turns.find(turn => turn.question === "运行中定位" && !turn.answer), "saved live user turn");
  await panel.locator(`[data-entry-id="${liveTurn.id}"]`).waitFor();
  await waitFor(async () => await page.locator(`[data-turn="${liveTurn.id}"]`).count() === 1, "live card");
  await page.locator(`[data-turn="${liveTurn.id}"] .waygoal-turn-content`).click();
  check("a new card can locate its saved original while the model is still running", (await snapshot()).nodes.find(node => node.id === forkId).running && await panel.locator(`[data-entry-id="${liveTurn.id}"]`).isVisible());
  await waitFor(async () => !(await snapshot()).nodes.some(node => node.running), "slow run ended"); model.slowMs = 0;
  await page.setViewportSize({ width: 707, height: 844 });
  await delay(500);
  check("the stacked chat fills intermediate-width viewports", await panel.evaluate(element => Math.abs(element.getBoundingClientRect().width - document.documentElement.clientWidth) <= 1));
  await page.setViewportSize({ width: 390, height: 844 });
  await delay(500);
  check("narrow screen retains canvas and composer without horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && await composer.isVisible() && await page.locator(".waygoal-viewport").isVisible());
  const touchTargets = await page.locator(".waygoal-turn-toolbar button:visible, .waygoal-turn-toolbar select:visible").evaluateAll(elements => elements.map(element => {
    const { width, height } = element.getBoundingClientRect(); return { width, height };
  }));
  check("narrow-screen turn toolbar targets are at least 44 pixels", touchTargets.every(target => target.width >= 44 && target.height >= 44));
  await page.screenshot({ path: join(evidence, "03-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // A 300-turn file makes the first card cross several real history pages.
  const fileInfo = await (await fetch(`${base}/api/sessions/${id}`)).json();
  const longId = "33333333-3333-4333-8333-333333333333";
  const timestamp = new Date().toISOString();
  const records = [{ type: "session", version: 3, id: longId, cwd: workspace, timestamp }];
  let parentId = null;
  for (let index = 0; index < 600; index++) {
    const entryId = (index + 1).toString(16).padStart(8, "0");
    const role = index % 2 ? "assistant" : "user";
    records.push({ type: "message", id: entryId, parentId, timestamp, message: { role, content: [{ type: "text", text: `长历史-${index}` }], ...(role === "assistant" ? { api: "openai-completions", provider: "e2e", model: "e2e-model", stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } : {}), timestamp: Date.now() } });
    parentId = entryId;
  }
  records.push({ type: "session_info", id: "abcdef01", parentId, timestamp, name: "长历史导航" });
  writeFileSync(join(dirname(fileInfo.filePath), `long_${longId}.jsonl`), records.map(record => JSON.stringify(record)).join("\n") + "\n");
  await tool("整理会话与票据");
  await waitFor(async () => (await snapshot()).nodes.some(node => node.id === longId), "long fixture discovery");
  await page.locator(`[data-node="${longId}"]`).click();
  await page.locator('[data-turn="00000001"]').waitFor();
  await page.getByRole("button", { name: "全景", exact: true }).click();
  await page.locator('[data-turn="00000001"] .waygoal-turn-content').click();
  await panel.locator('[data-entry-id="00000001"]').waitFor();
  check("card location resolves original identity across multiple history pages", await panel.getByText("长历史-0", { exact: true }).isVisible());
  await page.evaluate(() => { window.longOriginal = document.querySelector('.waygoal-panel [data-entry-id="00000001"]'); });
  await page.getByRole("button", { name: "全景", exact: true }).click();
  check("overview fits every card in a 300-turn history", await page.locator(".waygoal-viewport").evaluate(viewport => {
    const bounds = viewport.getBoundingClientRect();
    return [...viewport.querySelectorAll("[data-turn]")].every(card => {
      const box = card.getBoundingClientRect();
      return box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom;
    });
  }));
  await page.screenshot({ path: join(evidence, "04-long-overview.png") });
  const turnViewport = page.locator(".waygoal-viewport");
  const fittedScale = await page.locator(".waygoal-world").evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a);
  await turnViewport.hover(); await page.mouse.wheel(0, -100); await delay(200);
  const zoomedScale = await page.locator(".waygoal-world").evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a);
  check("zooming from overview changes scale smoothly without jumping to the old minimum", zoomedScale > fittedScale && zoomedScale < fittedScale * 1.2);
  await page.getByRole("button", { name: "当前轮次", exact: true }).click();
  check("returning to the current turn restores readable size after overview", await page.locator('[data-turn="00000257"]').evaluate(element => element.getBoundingClientRect().width >= 278));
  await send("长历史之后继续");
  check("a send retains the already-loaded historical DOM", await page.evaluate(() => window.longOriginal === document.querySelector('.waygoal-panel [data-entry-id="00000001"]')));
  await browseSession(id);
  await page.locator(`[data-turn="${firstTurn.id}"]`).waitFor();
  await page.getByRole("button", { name: "全景", exact: true }).click();
  await page.locator(`[data-turn="${firstTurn.id}"] .waygoal-turn-content`).click();
  const preview = page.locator(".waygoal-canvas-preview");
  await preview.locator(".waygoal-readonly-body").getByText("共同问题", { exact: true }).hover();
  await preview.getByRole("button", { name: "从这里分叉", exact: true }).first().click();
  await waitFor(async () => await composer.inputValue() === "共同问题", "preview fork restores original user message");
  const emptyFork = await waitFor(async () => (await snapshot()).nodes.find(node => ![id, otherSessionId, forkId, longId].includes(node.id)), "fork before first answer");
  check("a preview user-message fork retains source identity and original draft even before the first answer", emptyFork.origin.sessionId === id && emptyFork.origin.entryId === firstTurn.id);
  await send("修改后从头探索");
  check("the fork before the first answer is a valid independent Pi session", sessionEntries(emptyFork.id).some(entry => entry.type === "message" && entry.message.role === "assistant"));
  check("no browser errors", errors.length === 0, errors.join("\n"));
  writeFileSync(join(evidence, "checks.json"), JSON.stringify(checks, null, 2));
  await context.close();
} catch (error) {
  for (const context of browser?.contexts() ?? []) for (const page of context.pages()) {
    await page.screenshot({ path: join(evidence, "failure.png") }).catch(() => {});
    console.log(await page.locator('.waygoal-canvas-preview button').evaluateAll(buttons => buttons.map(b => {
      const r = b.getBoundingClientRect(); return { text: b.textContent, rect: r.toJSON(), hit: document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,600) };
    })).catch(() => []));
  }
  throw error;
} finally {
  await browser?.close().catch(() => {});
  await stopServer(server);
  await Promise.race([model.close(), delay(5000)]);
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
}
