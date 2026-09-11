import { evidenceDirectory } from "./waygoal-artifacts.mjs";
// Browser verification for the Waygoal session canvas (ticket #2).
// Starts its own pi-web on a free loopback port with an isolated Pi data
// directory and a fake OpenAI-compatible model, then checks discovery,
// creation, explicit sending, message rendering, restart recovery,
// skill feedback, the confirmed theme, keyboard access and the narrow layout.
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
const evidence = evidenceDirectory("session-canvas");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-server.log"));

const agentDir = mkdtempSync(join(tmpdir(), "waygoal-e2e-"));
const workspace = join(agentDir, "workspace-a");
const otherWorkspace = join(agentDir, "workspace-b");
mkdirSync(workspace); mkdirSync(otherWorkspace);
const sessionDir = join(agentDir, "sessions", "e2e");
mkdirSync(sessionDir, { recursive: true });
const timestamp = "2026-08-23T00:00:00.000Z";
const NAMED = "e2e-named-session";
const PLAIN = "e2e-plain-session";
const OTHER = "e2e-other-workspace";
const NAMED_TITLE = "已存标题：画布验证";
const PLAIN_FIRST = "这是没有标题的会话的第一句话";

function message(id, parentId, role, content) {
  return { type: "message", id, parentId, timestamp, message: { role, content } };
}
function writeSession(id, cwd, entries) {
  writeFileSync(join(sessionDir, `2026-08-23T00-00-00-000Z_${id}.jsonl`),
    [{ type: "session", version: 3, id, timestamp, cwd }, ...entries].map((e) => JSON.stringify(e)).join("\n") + "\n");
}
writeSession(NAMED, workspace, [
  message("u1", null, "user", "第一句"),
  message("a1", "u1", "assistant", [{ type: "text", text: "回答" }]),
  { type: "session_info", id: "n1", parentId: "a1", timestamp, name: NAMED_TITLE },
]);
writeSession(PLAIN, workspace, [
  message("u1", null, "user", PLAIN_FIRST),
  message("a1", "u1", "assistant", [{ type: "text", text: "回答" }]),
]);
writeSession(OTHER, otherWorkspace, [message("u1", null, "user", "别的目录")]);

// Controllable model and an installed skill fixture.
const model = await startFakeModel({ reply: "E2E reply" });
writeFileSync(join(agentDir, "models.json"), modelsJson(model.baseUrl));
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "e2e", defaultModel: "e2e-model" }));
mkdirSync(join(agentDir, "skills", "e2e-skill"), { recursive: true });
writeFileSync(join(agentDir, "skills", "e2e-skill", "SKILL.md"), "---\nname: e2e-skill\ndescription: E2E skill fixture\n---\n\nE2E_SKILL_BODY_MARKER: reply briefly.\n");

async function waitFor(predicate, what, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) { assert.ok(Date.now() < deadline, `Timed out waiting for ${what}`); await delay(200); }
}
// Read both rectangles in one frame, once zoom/reveal has settled. Reading
// them in separate protocol calls can measure different points of a transition.
async function settledCardGap(page, firstId, secondId) {
  let gap;
  await waitFor(async () => {
    gap = await page.locator(".waygoal-world").evaluate((world, [first, second]) => {
      if (world.getAnimations().some(animation => animation.playState === "running" || animation.pending)) return null;
      const a = world.querySelector(`[data-node="${first}"]`).getBoundingClientRect();
      const b = world.querySelector(`[data-node="${second}"]`).getBoundingClientRect();
      return { x: a.x - b.x, y: a.y - b.y };
    }, [firstId, secondId]);
    return gap !== null;
  }, "canvas transition to settle");
  return gap;
}

const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); assert.ok(ok, `${name} ${detail}`); console.log(`PASS: ${name}`); };

let server, browser;
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
  while (true) {
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-server.log");
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-server.log");
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
// Pi stores new sessions under sessions/<encoded-cwd>/; search every directory.
const userMessageCount = (id) => {
  const file = readdirSync(join(agentDir, "sessions"), { recursive: true }).find((f) => String(f).endsWith(`_${id}.jsonl`));
  assert.ok(file, `session file for ${id}`);
  return readFileSync(join(agentDir, "sessions", String(file)), "utf8").split("\n").filter((l) => l.includes('"role":"user"')).length;
};

try {
  server = await startServer();
  // Prefer the bundled Chromium; fall back to installed Google Chrome so the run does not need a browser download.
  browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
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
  const canvasUrl = `${base}/waygoal?cwd=${encodeURIComponent(workspace)}`;
  const node = (title) => page.locator(".waygoal-node", { hasText: title });

  // 1. Discovery: real sessions of this workspace only, titles from name / first message.
  await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  await node(NAMED_TITLE).waitFor();
  await node(PLAIN_FIRST).waitFor();
  check("discovery shows both workspace sessions with real titles", await page.locator(".waygoal-node").count() === 2);
  check("other workspace session is not shown", await page.getByText("别的目录").count() === 0);
  check("no Wayfinder root entry or workflow tips", await page.getByText(/wayfinder|地图|票据/i).count() === 0);
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".waygoal-app")).backgroundColor);
  check("confirmed light theme background", bg === "rgb(246, 250, 246)", bg);
  await page.screenshot({ animations: "disabled", path: join(evidence, "01-discovery.png") });

  // 2. Repeated discovery keeps one node per session.
  await snapshot(); const twice = await snapshot();
  check("repeated discovery has no duplicate nodes", new Set(twice.nodes.map((n) => n.id)).size === twice.nodes.length && twice.nodes.length === 2);

  // 3. Open an existing session: history renders, nothing is sent.
  const requestsBefore = model.requests.length;
  await node(NAMED_TITLE).click();
  await page.locator(".waygoal-panel").getByText("回答").first().waitFor();
  await delay(1500);
  check("opening a node loads history without sending to the model", model.requests.length === requestsBefore);
  await page.screenshot({ animations: "disabled", path: join(evidence, "02-open-existing.png") });

  // 4. New independent session: explicit send, real reply, one new node.
  await page.getByRole("button", { name: "新开聊天" }).click();
  const input = page.locator(".waygoal-panel textarea").first();
  await input.waitFor();
  await input.fill("你好，画布");
  await page.locator(".waygoal-panel").getByRole("button", { name: /^(Send|发送)$/ }).click();
  await waitFor(() => model.requests.length > requestsBefore, "model request for the first message");
  await page.locator(".waygoal-panel").getByText("E2E reply: 你好，画布", { exact: true }).waitFor({ timeout: 60_000 });
  check("new session shows the real model reply", true);
  await page.locator(".waygoal-node", { hasText: "你好，画布" }).waitFor();
  await delay(3000);
  const afterCreate = await snapshot();
  check("new session appears once on the canvas", afterCreate.nodes.filter((n) => n.title.includes("你好，画布")).length === 1 && afterCreate.nodes.length === 3);
  const createdId = afterCreate.nodes.find((n) => n.title.includes("你好，画布")).id;
  check("model request went through the fake provider", model.requests.at(-1)?.body?.model === "e2e-model");
  await page.screenshot({ animations: "disabled", path: join(evidence, "03-new-session-reply.png") });

  // 5. Missing skill: clear feedback, nothing sent. Present skill: content reaches the model.
  const before = model.requests.length;
  await input.fill("/skill:e2e-missing-skill 你好");
  await page.locator(".waygoal-panel").getByRole("button", { name: /^(Send|发送)$/ }).click();
  await page.getByText(/没有找到 skill「e2e-missing-skill」/).first().waitFor();
  await delay(1500);
  check("missing skill gives explicit feedback and does not send", model.requests.length === before);
  await page.screenshot({ animations: "disabled", path: join(evidence, "04-missing-skill.png") });
  const beforeSkill = model.requests.length;
  await input.fill("/skill:e2e-skill 请回答");
  await page.locator(".waygoal-panel").getByRole("button", { name: /^(Send|发送)$/ }).click();
  await waitFor(() => model.requests.length > beforeSkill, "model request for the skill message");
  await page.locator(".waygoal-panel").getByText(/E2E reply: <skill name="e2e-skill"/).waitFor({ timeout: 60_000 });
  check("installed skill content is sent to the model", model.transcript().includes("E2E_SKILL_BODY_MARKER"));

  // 6. Drag a node and change the view; both are saved per workspace.
  await page.getByRole("button", { name: "回到全景" }).click();
  await delay(500);
  const target = node(NAMED_TITLE);
  const box = await target.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 120, { steps: 8 }); await page.mouse.move(box.x + 240, box.y + 220, { steps: 8 }); await page.mouse.up();
  await page.getByRole("button", { name: "放大" }).click();
  await delay(1200);
  const zoomBefore = await page.locator(".waygoal-zoom span").innerText();
  const gapBefore = await settledCardGap(page, NAMED, createdId);
  const saved = await snapshot();
  const savedPos = saved.nodes.find((n) => n.id === NAMED).position;
  const origPos = twice.nodes.find((n) => n.id === NAMED).position;
  check("dragging a node persists its position", Math.abs(savedPos.x - origPos.x) > 100 && Math.abs(savedPos.y - origPos.y) > 100, JSON.stringify({ origPos, savedPos }));
  check("view and last viewed are persisted", Math.round((saved.view?.scale ?? 0) * 100) === Number.parseInt(zoomBefore, 10) && saved.lastViewed === createdId, JSON.stringify({ view: saved.view, zoomBefore }));
  const otherRecord = (await (await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(otherWorkspace)}`)).json());
  check("other workspace keeps its own record", otherRecord.nodes.length === 1 && !otherRecord.view && !otherRecord.lastViewed);
  const recordFiles = readdirSync(join(agentDir, "waygoal", "workspaces"));
  check("canvas record lives in the Pi data dir, one dir per workspace", recordFiles.length === 2);

  // 7. Reload: view, positions and the last viewed session are restored; nothing auto-sent.
  const sent = model.requests.length; const userCount = userMessageCount(createdId);
  // Keep a slow transition in this regression: restoration must be measured
  // after animation, without disabling motion or loosening the position check.
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = ".waygoal-world { transition-duration: 1s !important; }";
    document.head.append(style);
  }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".waygoal-panel").getByText(/E2E reply: 你好，画布/).waitFor();
  const scaleText = await page.locator(".waygoal-zoom span").innerText();
  check("reload restores zoom and reopens the last viewed session", scaleText === zoomBefore, `${scaleText} vs ${zoomBefore}`);
  // Where the view lands after a reload is the canvas's business: an opened
  // card that is outside the viewport is brought back in (ticket #5). The
  // dragged card's place on the canvas is what has to come back, so it is
  // measured against another card, at the same zoom, rather than in pixels
  // of the screen.
  const gapAfter = await settledCardGap(page, NAMED, createdId);
  const restored = await snapshot();
  check("reload preserves saved canvas coordinates", JSON.stringify(restored.nodes.find(n => n.id === NAMED).position) === JSON.stringify(savedPos) && restored.view.scale === saved.view.scale);
  check("reload restores node position", Math.abs(gapAfter.x - gapBefore.x) < 2 && Math.abs(gapAfter.y - gapBefore.y) < 2, JSON.stringify({ gapBefore, gapAfter }));
  await delay(1500);
  check("restore does not send a message", model.requests.length === sent && userMessageCount(createdId) === userCount);
  await page.screenshot({ animations: "disabled", path: join(evidence, "05-after-reload.png") });

  // 8. Host restart: same record, still no auto-send. The tab is closed
  //    before the host stops, so what it logs while the host is away is not
  //    mistaken for a page error.
  await page.close().catch(() => {});
  await stopServer(server); server = await startServer();
  // A user reopening the canvas after a host restart: fresh tab, same URL.
  page = await openPage();
  await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".waygoal-panel").getByText(/E2E reply: 你好，画布/).waitFor();
  await node(NAMED_TITLE).waitFor();
  await delay(1500);
  check("host restart restores canvas and last viewed session without sending", model.requests.length === sent && userMessageCount(createdId) === userCount && (await snapshot()).nodes.length === 3);
  await page.screenshot({ animations: "disabled", path: join(evidence, "06-after-restart.png") });

  // 9. Keyboard: Esc closes the panel, Tab reaches a node, Enter opens it, arrows nudge.
  await page.locator(".waygoal-viewport").focus();
  await page.keyboard.press("Escape");
  await page.locator(".waygoal-panel").waitFor({ state: "detached" });
  const nodeButton = page.locator(".waygoal-node").first();
  await nodeButton.focus();
  const focusedId = await nodeButton.getAttribute("data-node");
  const nudgeFrom = (await snapshot()).nodes.find((n) => n.id === focusedId).position;
  await page.keyboard.press("ArrowRight"); await delay(800);
  const nudgeTo = (await snapshot()).nodes.find((n) => n.position.x === nudgeFrom.x + 10);
  check("arrow keys nudge a focused node", Boolean(nudgeTo));
  await page.keyboard.press("Enter");
  await page.locator(".waygoal-panel").waitFor();
  check("Enter on a focused node opens its panel", true);
  check("no page or console errors", errors.length === 0, errors.join("\n"));
  await context.close();

  // 10. Narrow screen: panel is full-screen with a way back to the canvas.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
  const mpage = await mobile.newPage(); mpage.setDefaultTimeout(30_000);
  await mpage.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  await mpage.locator(".waygoal-panel").waitFor();
  const back = mpage.getByRole("button", { name: "← 回到画布" });
  await back.waitFor();
  await mpage.screenshot({ animations: "disabled", path: join(evidence, "07-mobile-panel.png") });
  await back.click();
  await mpage.locator(".waygoal-panel").waitFor({ state: "detached" });
  await mpage.locator(".waygoal-node").first().waitFor();
  check("narrow screen has a back-to-canvas entry", true);
  await mpage.screenshot({ animations: "disabled", path: join(evidence, "08-mobile-canvas.png") });
  await mobile.close();

  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks }, null, 2));
  console.log(`\nAll ${checks.length} checks passed. Evidence: ${evidence}`);
} catch (error) {
  process.exitCode = 1;
  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks, failure: String(error?.stack ?? error) }, null, 2));
  writeFileSync(join(artifacts, "waygoal-model-requests.json"), JSON.stringify(model.requests, null, 2));
  console.error(error);
} finally {
  await browser?.close().catch(() => {});
  await stopServer(server);
  await model.close();
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
}
