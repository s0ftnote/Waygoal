// Browser verification for dependency changes on the Waygoal canvas (ticket
// #9). Starts its own pi-web on a free loopback port with an isolated Pi data
// directory, edits real tracker files in the workspace, and checks what the
// canvas makes of the changes: two premises, one resolved and then both, the
// light that says a ticket has stopped waiting, being blocked again, a premise
// that was dropped or can no longer be read, a dependency added in the source,
// a host restart, and reduced motion.
//
// No model and no Pi session take part: watching dependencies change must
// never produce a chat message.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const evidence = resolve(root, "../../docs/research/prototype-evidence/dependencies");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-dependencies-server.log"));

const agentDir = mkdtempSync(join(tmpdir(), "waygoal-deps-e2e-"));
const workspace = join(agentDir, "workspace");
mkdirSync(workspace);

const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); assert.ok(ok, `${name} ${detail}`); console.log(`PASS: ${name}`); };
async function waitFor(predicate, what, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    assert.ok(Date.now() < deadline, `Timed out waiting for ${what}`);
    await delay(200);
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
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-dependencies-server.log");
    // Readiness reads the canvas, which is also a reader of dependency changes.
    // It only ever runs when nothing is pending, so it takes no light away.
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-dependencies-server.log");
    await delay(250);
  }
}
async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit"); child.kill("SIGTERM");
  await Promise.race([exited, delay(15_000).then(() => child.kill("SIGKILL"))]);
}

const sessionFiles = () => existsSync(join(agentDir, "sessions"))
  ? readdirSync(join(agentDir, "sessions"), { recursive: true }).filter((f) => String(f).endsWith(".jsonl")) : [];

/** Real tracker files, in the layout the local Markdown tracker documents. */
const mapDir = (effort) => join(workspace, ".scratch", effort);
function writeMap(effort, body) {
  mkdirSync(join(mapDir(effort), "issues"), { recursive: true });
  writeFileSync(join(mapDir(effort), "map.md"), body);
}
const writeTicket = (effort, file, body) => writeFileSync(join(mapDir(effort), "issues", file), body);
const ticket = (title, { status = "open", blockedBy = "" } = {}) =>
  `# ${title}\n\nType: grilling\nStatus: ${status}\n${blockedBy ? `Blocked by: ${blockedBy}\n` : ""}\n## Question\n\n${title}的正文。\n`;
/** The only thing these tests ever change is the source file. */
const setStatus = (file, title, status, blockedBy) => writeTicket("party", file, ticket(title, { status, blockedBy }));

const ROOM = ["01-room.md", "场地定在哪"];
const FILM = ["02-film.md", "放哪部片"];
const OPENING = ["03-opening.md", "开场怎么说"];
const SNACKS = ["04-snacks.md", "吃的准备什么"];
const DRINKS = ["05-drinks.md", "喝的买什么"];

try {
  writeMap("party", "# 给朋友办一场小型放映会\n\n## Destination\n\n定下一个方案。\n");
  writeTicket("party", ROOM[0], ticket(ROOM[1]));
  writeTicket("party", FILM[0], ticket(FILM[1]));
  writeTicket("party", OPENING[0], ticket(OPENING[1], { blockedBy: "01, 02" }));
  writeTicket("party", SNACKS[0], ticket(SNACKS[1]));

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
  // The canvas polls; nothing here asks the API itself, because the one
  // snapshot that reports a ticket has stopped waiting is the one the browser
  // reads. A second reader would take that report for itself.
  const card = (title) => page.locator(".waygoal-ticket-card", { hasText: title }).first();
  const state = async (title) => card(title).getAttribute("data-state");
  const panel = () => page.locator(".waygoal-panel");
  const stateOf = (title, want) => waitFor(async () => (await state(title)) === want, `${title} to read ${want}`);

  await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  await card(OPENING[1]).waitFor();

  // 1. Two premises, neither met: the downstream ticket waits on both.
  await stateOf(OPENING[1], "waiting");
  check("a ticket with two unmet premises waits", (await card(OPENING[1]).textContent()).includes("被依赖挡着"));
  await card(OPENING[1]).click();
  await panel().getByText(".scratch/party/issues/03-opening.md").waitFor();
  const blockerText = async () => (await panel().locator(".waygoal-ticket-blockers").textContent()) ?? "";
  check("both premises are named as the source spells them",
    (await blockerText()).includes("01 · open") && (await blockerText()).includes("02 · open"), await blockerText());
  await page.screenshot({ animations: "disabled", path: join(evidence, "01-waiting-on-two.png") });

  // The user puts the card somewhere: no change below may move it back.
  const box = await card(OPENING[1]).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + 150, { steps: 12 });
  await page.mouse.up();
  await delay(400);
  const placed = await card(OPENING[1]).boundingBox();

  // 2. One premise met is not both.
  setStatus(ROOM[0], ROOM[1], "resolved");
  await waitFor(async () => (await blockerText()).includes("01 · resolved"), "the first premise to read resolved");
  check("resolving one premise of two does not let the ticket through", (await state(OPENING[1])) === "waiting");

  // 3. Both met: it stops waiting, is lit once, and keeps saying so.
  setStatus(FILM[0], FILM[1], "resolved");
  await waitFor(async () => (await card(OPENING[1]).getAttribute("data-unblocked")) === "true", "the ticket to be lit");
  check("a ticket that stops waiting is lit once",
    (await card(OPENING[1]).getAttribute("class")).includes("unblocked"), await card(OPENING[1]).getAttribute("class"));
  // The one screenshot taken with animations running: the light is the point.
  await page.screenshot({ path: join(evidence, "02-just-unblocked.png") });
  await waitFor(async () => (await card(OPENING[1]).getAttribute("data-unblocked")) === null, "the light to pass");
  check("the light passes and the words stay",
    (await state(OPENING[1])) === "unblocked" && (await card(OPENING[1]).textContent()).includes("前提都满足了")
    && (await panel().locator(".waygoal-ticket-unblocked").textContent()).includes("可以往下走"));
  check("it is not the same as being finished: the source's own status is untouched",
    (await panel().locator(".waygoal-ticket-meta").textContent()).includes("open"));
  check("and it starts nothing", sessionFiles().length === 0, JSON.stringify(sessionFiles()));
  check("the map that was open stays open", await panel().getByText(".scratch/party/issues/03-opening.md").count() === 1);
  const after = await card(OPENING[1]).boundingBox();
  check("the layout the user made is not rearranged",
    Math.abs(after.x - placed.x) < 1 && Math.abs(after.y - placed.y) < 1, JSON.stringify([placed, after]));

  // 4. A premise reopened in the source blocks it again, and letting it through
  //    a second time is a change of its own.
  setStatus(ROOM[0], ROOM[1], "open");
  await stateOf(OPENING[1], "waiting");
  check("a premise reopened in the source puts the ticket back to waiting",
    (await blockerText()).includes("01 · open") && (await card(OPENING[1]).textContent()).includes("被依赖挡着"), await blockerText());
  setStatus(ROOM[0], ROOM[1], "resolved");
  await waitFor(async () => (await card(OPENING[1]).getAttribute("data-unblocked")) === "true", "the second unblocking to be lit");
  check("being let through again is a change of its own, and is lit again",
    (await card(OPENING[1]).getAttribute("class")).includes("unblocked"));
  await waitFor(async () => (await card(OPENING[1]).getAttribute("data-unblocked")) === null, "the second light to pass");

  // 5. A premise dropped in the source is not a premise that was met.
  setStatus(ROOM[0], ROOM[1], "cancelled");
  await stateOf(OPENING[1], "waiting");
  check("a dropped premise does not release what waited on it",
    (await card(OPENING[1]).textContent()).includes("依赖要核对"));
  check("and the canvas says the relation has to be settled in the source",
    (await blockerText()).includes("取消不等于解决"), await blockerText());
  await page.screenshot({ animations: "disabled", path: join(evidence, "03-needs-check.png") });

  // Settled where it has to be: the source drops the relation itself.
  writeTicket("party", OPENING[0], ticket(OPENING[1], { blockedBy: "02" }));
  await stateOf(OPENING[1], "unblocked");
  check("a relation the source removes is the way through",
    !(await blockerText()).includes("01 ·") && (await blockerText()).includes("02 · resolved"), await blockerText());

  // 6. A dependency added in the source blocks it again.
  writeTicket("party", OPENING[0], ticket(OPENING[1], { blockedBy: "01, 02" }));
  await stateOf(OPENING[1], "waiting");
  check("a dependency added in the source is picked up and waits again",
    (await blockerText()).includes("01 ·") && (await blockerText()).includes("02 ·"), await blockerText());


  // 7. A premise that cannot be read now holds too, and says why.
  setStatus(ROOM[0], ROOM[1], "resolved");
  await stateOf(OPENING[1], "unblocked");
  rmSync(join(mapDir("party"), "issues", FILM[0]));
  await waitFor(async () => (await blockerText()).includes("现在读不到它"), "the unreadable premise");
  check("a premise that cannot be read holds, and is not read as one that was never there",
    (await state(OPENING[1])) === "waiting", await blockerText());

  // 8. A dependency naming nothing is reported, never counted as met.
  writeTicket("party", OPENING[0], ticket(OPENING[1], { blockedBy: "09" }));
  await waitFor(async () => (await blockerText()).includes("这张地图里找不到"), "the missing dependency");
  check("a dependency that names nothing keeps the ticket waiting", (await state(OPENING[1])) === "waiting");

  // 8b. What the source concluded and what its relations say stay two facts:
  //     a ticket resolved while it still names an unmet premise says both.
  writeTicket("party", FILM[0], ticket(FILM[1]));
  writeTicket("party", OPENING[0], ticket(OPENING[1], { status: "resolved", blockedBy: "02" }));
  await stateOf(OPENING[1], "resolved");
  check("the source's own conclusion and the relations it still names are both shown",
    (await card(OPENING[1]).textContent()).includes("resolved") && (await card(OPENING[1]).textContent()).includes("被依赖挡着"),
    await card(OPENING[1]).textContent());

  // 9. Back to a settled state, then a restart: the same change is not replayed.
  writeTicket("party", OPENING[0], ticket(OPENING[1], { blockedBy: "01, 02" }));
  await stateOf(OPENING[1], "waiting");
  writeTicket("party", FILM[0], ticket(FILM[1], { status: "resolved" }));
  await waitFor(async () => (await card(OPENING[1]).getAttribute("data-unblocked")) === "true", "the ticket to be lit before the restart");
  await waitFor(async () => (await card(OPENING[1]).getAttribute("data-unblocked")) === null, "the light to pass before the restart");

  await page.close().catch(() => {});
  await stopServer(server); server = await startServer();
  page = await openPage();
  await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  await stateOf(OPENING[1], "unblocked");
  let replayed = false;
  for (let i = 0; i < 25; i++) {
    if ((await card(OPENING[1]).getAttribute("data-unblocked")) === "true") replayed = true;
    await delay(250);
  }
  check("a restarted host does not point at the same change again",
    !replayed && (await card(OPENING[1]).textContent()).includes("前提都满足了"));

  // 10. With reduced motion the state is simply there, and can be acted on at once.
  await page.emulateMedia({ reducedMotion: "reduce" });
  writeTicket("party", DRINKS[0], ticket(DRINKS[1], { blockedBy: "04" }));
  await card(DRINKS[1]).waitFor();
  await stateOf(DRINKS[1], "waiting");
  setStatus(SNACKS[0], SNACKS[1], "resolved");
  await stateOf(DRINKS[1], "unblocked");
  check("with reduced motion the state is shown straight away",
    (await card(DRINKS[1]).textContent()).includes("前提都满足了"));
  await card(DRINKS[1]).click();
  await panel().getByText(".scratch/party/issues/05-drinks.md").waitFor();
  check("and the card can be opened without waiting for anything to finish",
    (await panel().locator(".waygoal-ticket-unblocked").textContent()).includes("可以往下走"));
  await page.screenshot({ animations: "disabled", path: join(evidence, "04-reduced-motion.png") });

  // 11. Last, because a ticket file that goes away stays on the canvas as the
  //     last thing read (ticket #7): a second file numbered 02 leaves that
  //     number ambiguous for good, and nothing after this could use it.
  writeTicket("party", "06-toast.md", ticket("敬酒说什么", { blockedBy: "02" }));
  await card("敬酒说什么").waitFor();
  await stateOf("敬酒说什么", "unblocked");
  await card("敬酒说什么").click();
  writeTicket("party", "02-second.md", ticket("同号的另一张票"));
  await waitFor(async () => (await blockerText()).includes("同号有多份"), "the ambiguous dependency");
  check("two tickets sharing a number leave the dependency undetermined, and the ticket waiting",
    (await state("敬酒说什么")) === "waiting" && (await card("敬酒说什么").textContent()).includes("依赖要核对"));

  check("watching dependencies change produced no chat message", sessionFiles().length === 0, JSON.stringify(sessionFiles()));
  check("no page or console errors", errors.length === 0, errors.join("\n"));
  await context.close();
} finally {
  await browser?.close().catch(() => {});
  await stopServer(server);
  serverLog.end();
  writeFileSync(join(evidence, "checks.json"), JSON.stringify(checks, null, 2));
  rmSync(agentDir, { recursive: true, force: true });
}
console.log(`\nAll ${checks.length} checks passed. Evidence: ${evidence}`);
