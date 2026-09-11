import { evidenceDirectory } from "./waygoal-artifacts.mjs";
// Browser verification for switching working directory and keeping several
// canvases (ticket #4). Starts its own pi-web on a free loopback port with an
// isolated Pi data directory and a fake OpenAI-compatible model, and drives
// two temporary working directories that share a folder name, each with more
// than one canvas: making a canvas, switching between canvases, switching
// directory, and what a reload and a host restart come back to.
//
// The model is fake and local; no real model and no Pi login take part.
import assert from "node:assert/strict";
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

const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const evidence = evidenceDirectory("workspaces");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-workspaces-server.log"));

const agentDir = mkdtempSync(join(tmpdir(), "waygoal-workspaces-e2e-"));
// Two directories that show the same name: the path is the identity, so these
// must stay two workspaces and not collapse into one.
const workA = join(agentDir, "work/one/放映会");
const workB = join(agentDir, "work/two/放映会");
for (const dir of [workA, workB]) mkdirSync(dir, { recursive: true });
// Local tracker files belong to the working directory, so they are what tells
// apart "this canvas has no chats" from "this canvas has nothing".
mkdirSync(join(workA, ".scratch/party/issues"), { recursive: true });
writeFileSync(join(workA, ".scratch/party/map.md"), "# 给朋友办一场小型放映会\n\n## Destination\n\n定下一个方案。\n");
writeFileSync(join(workA, ".scratch/party/issues/01-room.md"), "# 场地定在哪\n\nType: grilling\nStatus: open\n\n## Question\n\n场地定在哪。\n");
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
const canvasUrl = (cwd) => `${base}/waygoal?cwd=${encodeURIComponent(cwd)}`;

async function startServer() {
  const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WAYGOAL: "1", PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
  });
  child.stdout.pipe(serverLog, { end: false }); child.stderr.pipe(serverLog, { end: false });
  const deadline = Date.now() + 120_000;
  for (;;) {
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-workspaces-server.log");
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workA)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-workspaces-server.log");
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

/** Reading one canvas of one working directory. Naming the canvas is part of
 *  the read: leaving it out asks for whichever one that directory was left
 *  on, which is not what a check about a particular canvas means. */
const snapshot = async (cwd, canvas = "main") =>
  (await fetch(`${base}/api/waygoal?${new URLSearchParams({ cwd, canvas, force: "1" })}`, { cache: "no-store" })).json();
const idsOn = async (cwd, canvas = "main") => (await snapshot(cwd, canvas)).nodes.map((n) => n.id).sort();
const sessionFile = (id) => {
  const file = readdirSync(join(agentDir, "sessions"), { recursive: true }).find((f) => String(f).endsWith(`_${id}.jsonl`));
  assert.ok(file, `session file for ${id}`);
  return readFileSync(join(agentDir, "sessions", String(file)), "utf8");
};

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
  page = await openPage();
  const panel = () => page.locator(".waygoal-panel");
  const composer = () => panel().locator("textarea").first();
  const shownCwd = () => page.locator(".waygoal-workspace code").innerText();
  const canvasNames = () => page.locator("[data-canvas]").allInnerTexts();
  const ticketCards = () => page.locator(".waygoal-ticket-card").count();
  const chatCards = () => page.locator("[data-node]:not(.waygoal-ticket-card)").count();
  const closePanel = async () => {
    const close = page.getByRole("button", { name: "关闭面板" });
    if (await close.count() > 0 && await close.isVisible()) await close.click();
  };
  const send = async (text) => {
    const before = model.requests.length;
    await composer().fill(text);
    await panel().getByRole("button", { name: /^(Send|发送)$/ }).click();
    await waitFor(() => model.requests.length > before, `model request for ${text}`);
    await panel().getByText(`回复: ${text}`, { exact: true }).waitFor({ timeout: 60_000 });
    await delay(600);
  };
  const startChat = async (cwd, canvas, text) => {
    await closePanel();
    await page.getByRole("button", { name: "新开聊天" }).click();
    await composer().waitFor();
    const before = new Set(await idsOn(cwd, canvas));
    await send(text);
    const id = await waitFor(async () => (await idsOn(cwd, canvas)).find((n) => !before.has(n)), `the session started with ${text}`);
    await closePanel();
    return id;
  };
  const goToCanvas = async (id) => {
    await closePanel();
    await page.locator(`[data-canvas="${id}"]`).click();
    await waitFor(async () => (await page.locator(`[data-canvas="${id}"][aria-current="true"]`).count()) === 1, `canvas ${id} to be the one open`);
    await delay(600);
  };

  // 1. A working directory arrives with one canvas, and nothing else.
  await page.goto(canvasUrl(workA), { waitUntil: "domcontentloaded" });
  await page.locator("[data-canvas]").first().waitFor();
  check("a working directory opens on its one canvas", (await canvasNames()).join() === "主画布", JSON.stringify(await canvasNames()));
  check("and the directory it says it is on is the one asked for", (await shownCwd()).includes("one/放映会"), await shownCwd());

  // 2. A chat started here belongs to this canvas.
  const filmId = await startChat(workA, "main", "放映会放哪部片好");
  check("a chat started from a canvas appears on it", (await idsOn(workA)).join() === filmId);

  // 3. Making a canvas is its own action: no ticket, no skill, no message.
  const requestsBefore = model.requests.length;
  const sessionsBefore = readdirSync(join(agentDir, "sessions"), { recursive: true }).length;
  await page.locator("[data-canvas-new]").click();
  await page.locator("[data-canvas-name]").fill("选片");
  await page.locator("[data-canvas-create]").click();
  const second = await waitFor(async () => (await snapshot(workA)).workspace.canvases.find((c) => c.name === "选片")?.id, "the new canvas");
  await waitFor(async () => (await page.locator(`[data-canvas="${second}"][aria-current="true"]`).count()) === 1, "the new canvas to be the one open");
  await delay(500);
  check("making a canvas sends no message and starts no session",
    model.requests.length === requestsBefore && readdirSync(join(agentDir, "sessions"), { recursive: true }).length === sessionsBefore,
    JSON.stringify({ requests: model.requests.length - requestsBefore }));
  check("a new canvas has no chats of its own, and the chat already here stays where it was",
    (await chatCards()) === 0 && (await idsOn(workA, second)).length === 0 && (await idsOn(workA)).join() === filmId,
    JSON.stringify({ chats: await chatCards(), onSecond: await idsOn(workA, second), onFirst: await idsOn(workA) }));
  // Tickets are files of the working directory, not of one canvas: every
  // canvas of this directory reads the same files, and lays them out itself.
  check("the working directory's own tickets are on the new canvas too, laid out by it",
    (await ticketCards()) === 2, String(await ticketCards()));
  await page.screenshot({ animations: "disabled", path: join(evidence, "01-second-canvas.png") });

  // 4. Two canvases are two boards: each keeps its own chats.
  const roomId = await startChat(workA, second, "场地就定在客厅吧");
  check("a chat started on the second canvas is on that one only",
    (await idsOn(workA, second)).join() === roomId && (await idsOn(workA)).join() === filmId,
    JSON.stringify({ second: await idsOn(workA, second), first: await idsOn(workA) }));
  await goToCanvas("main");
  check("going back shows the first canvas's chat and not the other's",
    (await page.locator(`[data-node="${filmId}"]`).count()) === 1 && (await page.locator(`[data-node="${roomId}"]`).count()) === 0);

  // 5. Each canvas keeps its own layout, in its own record.
  await goToCanvas(second);
  await page.getByRole("button", { name: "放大" }).click();
  await page.getByRole("button", { name: "放大" }).click();
  await delay(1500);
  const zoomed = (await snapshot(workA, second)).view;
  check("zooming one canvas leaves the other's view alone",
    zoomed && zoomed.scale > 1 && ((await snapshot(workA)).view?.scale ?? 1) === 1,
    JSON.stringify({ zoomed, first: (await snapshot(workA)).view }));
  const workspaceDir = join(agentDir, "waygoal/workspaces", (await snapshot(workA)).workspaceId);
  check("each canvas has its own record file",
    existsSync(join(workspaceDir, "canvas.json")) && existsSync(join(workspaceDir, `canvas-${second}.json`)),
    readdirSync(workspaceDir).join());

  // 6. A reload comes back to the canvas that was open.
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitFor(async () => (await page.locator(`[data-canvas="${second}"][aria-current="true"]`).count()) === 1, "the canvas to come back after a reload");
  check("a reload comes back to the canvas that was open, not to the first one",
    (await page.locator(`[data-node="${roomId}"]`).count()) === 1 && (await page.locator(`[data-node="${filmId}"]`).count()) === 0);

  // 7. Another working directory is its own workspace, even sharing a name.
  const beforeSwitch = model.requests.length;
  await page.locator("[data-workspace-switch]").click();
  await page.locator("[data-workspace-input]").fill(workB);
  await page.locator("[data-workspace-open]").click();
  await waitFor(async () => (await shownCwd()).includes("two/放映会"), "the other working directory");
  await delay(800);
  check("switching directory shows the other one, with its own single canvas and nothing on it",
    (await canvasNames()).join() === "主画布" && (await chatCards()) === 0 && (await ticketCards()) === 0 && (await idsOn(workB)).length === 0,
    JSON.stringify({ canvases: await canvasNames(), chats: await chatCards(), tickets: await ticketCards() }));
  check("switching directory sends no message",
    model.requests.length === beforeSwitch, String(model.requests.length - beforeSwitch));
  check("and it does not move the sessions of the directory left behind",
    !sessionFile(filmId).includes(workB) && sessionFile(filmId).includes(workA)
    && (await idsOn(workA)).join() === filmId,
    JSON.stringify(await idsOn(workA)));
  await page.screenshot({ animations: "disabled", path: join(evidence, "02-other-workspace.png") });

  // 8. A directory that is not there is said so, and nothing is swapped in.
  await page.locator("[data-workspace-switch]").click();
  await page.locator("[data-workspace-input]").fill(join(agentDir, "work/没有这个目录"));
  await page.locator("[data-workspace-open]").click();
  const alert = page.locator(".waygoal-alert");
  await alert.waitFor();
  check("a directory that is not there is named, and no other one is shown in its place",
    (await alert.innerText()).includes("没有这个目录") && (await shownCwd()).includes("two/放映会"),
    JSON.stringify({ alert: await alert.innerText(), shown: await shownCwd() }));

  // 9. A restart comes back to the directory and canvas last opened.
  await page.goto(canvasUrl(workA), { waitUntil: "domcontentloaded" });
  await goToCanvas(second);
  // The tab is closed before the host stops, so what it logs while the host
  // is away is not mistaken for a page error; and a fresh tab afterwards, so
  // that nothing but the record says which directory to open: the tab that
  // was already on one writes it back into its own URL.
  await page.close();
  await stopServer(server);
  server = await startServer();
  page = await openPage();
  await page.goto(`${base}/waygoal`, { waitUntil: "domcontentloaded" });
  await waitFor(async () => (await shownCwd()).includes("one/放映会"), "the remembered working directory");
  check("a restart comes back to the directory and the canvas last opened, without being told which",
    (await page.locator(`[data-canvas="${second}"][aria-current="true"]`).count()) === 1
    && (await page.locator(`[data-node="${roomId}"]`).count()) === 1,
    await page.locator(".waygoal-workspace").innerText());
  check("both chats are still there, each on its own canvas, after the restart",
    (await idsOn(workA)).join() === filmId && (await idsOn(workA, second)).join() === roomId);
  await page.screenshot({ animations: "disabled", path: join(evidence, "03-after-restart.png") });

  // Typing a directory that is not there is refused by the server, and the
  // browser logs that response itself: it is the one failed request this run
  // asks for, and nothing else may fail.
  const refused = errors.filter((e) => /Failed to load resource[\s\S]*400/.test(e));
  check("the only refused request was the directory that was deliberately not there", refused.length === 1, errors.join("\n"));
  check("no page or console errors", errors.length === refused.length, errors.join("\n"));
  await context.close();

  // 10. A remembered directory that has been moved away is reported, not
  //     quietly replaced by another one. The browser is closed first: this is
  //     about what the host answers when nobody says which directory.
  rmSync(join(agentDir, "work/one"), { recursive: true, force: true });
  const bare = await (await fetch(`${base}/api/waygoal`, { cache: "no-store" })).json();
  check("a remembered directory that is gone is named rather than swapped for another",
    typeof bare.error === "string" && bare.error.includes("one/放映会") && !bare.nodes, JSON.stringify(bare).slice(0, 300));

  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks }, null, 2));
  console.log(`\nAll ${checks.length} checks passed. Evidence: ${evidence}`);
} catch (error) {
  process.exitCode = 1;
  await page?.screenshot({ path: join(artifacts, "waygoal-workspaces-failure.png"), fullPage: false }).catch(() => {});
  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks, failure: String(error?.stack ?? error) }, null, 2));
  writeFileSync(join(artifacts, "waygoal-workspaces-model-requests.json"), JSON.stringify(model.requests, null, 2));
  console.error(error);
} finally {
  await browser?.close().catch(() => {});
  await stopServer(server);
  await Promise.race([model.close(), delay(5000)]);
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
}
