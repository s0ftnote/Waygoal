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
  const turns = async id => (await fetch(`${base}/api/waygoal/session/${id}/turns`)).json();
  await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "新开聊天" }).click();
  await send("共同问题");
  const id = await waitFor(async () => (await snapshot()).nodes[0]?.id, "session");
  await page.locator("[data-turn]").first().waitFor();
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
  await page.getByRole("button", { name: "关闭预览" }).click();
  await page.getByRole("button", { name: "Tree", exact: true }).click();
  await page.getByRole("navigation", { name: "Tree 路径选择" }).getByRole("button", { name: /继续第三轮/ }).click();
  await waitFor(async () => (await turns(id)).activeLeafId === lastA, "explicit Tree selects A");
  await composer.fill("A 路径草稿");
  await page.getByRole("button", { name: "Tree", exact: true }).click();
  await page.getByRole("navigation", { name: "Tree 路径选择" }).getByRole("button", { name: /另一条路径的材料/ }).click();
  await waitFor(async () => await composer.inputValue() === "B 路径草稿", "restore B draft");
  await page.getByRole("button", { name: "Tree", exact: true }).click();
  await page.getByRole("navigation", { name: "Tree 路径选择" }).getByRole("button", { name: /继续第三轮/ }).click();
  await waitFor(async () => await composer.inputValue() === "A 路径草稿", "restore A draft");
  check("Tree restores independent drafts for both paths", true);

  await page.getByRole("button", { name: "引用连线", exact: true }).click();
  await page.locator(`[data-turn="${sibling.id}"] .waygoal-turn-port`).click();
  // Next turn can lie outside the viewport; locate current, then zoom out.
  await page.getByRole("button", { name: "当前轮次", exact: true }).click();
  await page.locator("[data-next-turn]").click();
  const tray = page.getByLabel("下一轮引用材料"); await tray.waitFor();
  await tray.locator("summary").click();
  const reviewed = await tray.locator("pre").allTextContents();
  check("reference selection keeps the ordinary draft", await composer.inputValue() === "A 路径草稿");
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
  const forkId = await waitFor(async () => (await snapshot()).nodes.find(node => node.id !== id)?.id, "independent fork");
  await composer.waitFor();
  await send("分叉里连续聊一"); await send("分叉里连续聊二");
  check("assistant fork includes its source answer and then continuous replies", ancestorsOf(forkId, (await turns(forkId)).activeLeafId).includes(firstTurn.endId));
  check("original session remains independent", !(JSON.stringify(sessionEntries(id))).includes("分叉里连续聊一"));
  await page.setViewportSize({ width: 390, height: 844 });
  await delay(500);
  check("narrow screen retains canvas and composer without horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && await composer.isVisible() && await page.locator(".waygoal-turn-viewport").isVisible());
  await page.screenshot({ path: join(evidence, "03-mobile.png") });
  check("no browser errors", errors.length === 0, errors.join("\n"));
  writeFileSync(join(evidence, "checks.json"), JSON.stringify(checks, null, 2));
  await context.close();
} finally {
  await browser?.close().catch(() => {});
  await stopServer(server);
  await Promise.race([model.close(), delay(5000)]);
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
}
