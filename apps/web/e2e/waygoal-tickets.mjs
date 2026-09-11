// Browser verification for local Markdown tickets on the Waygoal canvas
// (ticket #7). Starts its own pi-web on a free loopback port with an isolated
// Pi data directory, writes real tracker files into the workspace, and checks
// what the canvas shows against those files: creation, edits, repeated
// refreshes, a host restart, duplicate numbers, unknown dependencies, a source
// file that disappears, and a layout that is not supported.
//
// No model and no Pi session take part: reading local files must not start one.
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
const evidence = resolve(root, "../../docs/research/prototype-evidence/tickets");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-tickets-server.log"));

const agentDir = mkdtempSync(join(tmpdir(), "waygoal-tickets-e2e-"));
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
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-tickets-server.log");
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-tickets-server.log");
    await delay(250);
  }
}
async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit"); child.kill("SIGTERM");
  await Promise.race([exited, delay(15_000).then(() => child.kill("SIGKILL"))]);
}

const snapshot = async () => (await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`)).json();
const sessionFiles = () => existsSync(join(agentDir, "sessions"))
  ? readdirSync(join(agentDir, "sessions"), { recursive: true }).filter((f) => String(f).endsWith(".jsonl")) : [];

/** Real tracker files, in the layout the local Markdown tracker documents. */
const mapDir = (effort) => join(workspace, ".scratch", effort);
function writeMap(effort, body) {
  mkdirSync(join(mapDir(effort), "issues"), { recursive: true });
  writeFileSync(join(mapDir(effort), "map.md"), body);
}
const writeTicket = (effort, file, body) => writeFileSync(join(mapDir(effort), "issues", file), body);
const ticket = (title, { status = "open", blockedBy = "", question = `${title}的正文。` } = {}) =>
  `# ${title}\n\nType: grilling\nStatus: ${status}\n${blockedBy ? `Blocked by: ${blockedBy}\n` : ""}\n## Question\n\n${question}\n`;

try {
  // 1. Files that already exist when the canvas first opens.
  writeMap("screening", "# 给朋友办一场小型放映会\n\n## Destination\n\n定下一个方案。\n\n## Not yet specified\n\n开场怎么说还没定。\n");
  writeTicket("screening", "01-feeling.md", ticket("希望朋友带走什么感受", { status: "resolved" }));
  writeTicket("screening", "02-film.md", ticket("这部短片适合怎样的开场", { blockedBy: "01" }));

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
  const card = (title) => page.locator(".waygoal-ticket-card", { hasText: title }).first();
  const panel = () => page.locator(".waygoal-panel");
  /** Opening a card brings it into view, which can carry another one off the
   *  screen. Start from the whole canvas before reaching for the next card. */
  const fitCanvas = async () => {
    const close = page.getByRole("button", { name: "关闭面板" });
    if (await close.count() > 0 && await close.isVisible()) await close.click();
    await page.getByRole("button", { name: "回到全景", exact: true }).click();
    await delay(400);
  };

  await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  await card("给朋友办一场小型放映会").waitFor();
  await card("希望朋友带走什么感受").waitFor();
  check("the map and its tickets come from the workspace's own files", await page.locator(".waygoal-ticket-card").count() === 3);
  check("reading local files starts no Pi session", sessionFiles().length === 0, JSON.stringify(sessionFiles()));

  // 2. The full view is the source file, with where it came from and when.
  await card("这部短片适合怎样的开场").click();
  await panel().getByText(".scratch/screening/issues/02-film.md").waitFor();
  const shown = await panel().locator(".waygoal-ticket-body").textContent();
  check("the full view shows the file itself, structure and all",
    shown.includes("## Question") && shown.includes("Blocked by: 01") && shown.includes("这部短片适合怎样的开场的正文。"), shown);
  check("a known dependency reads as the ticket it names",
    (await panel().locator(".waygoal-ticket-blockers .waygoal-tag").first().textContent()).includes("resolved"));
  await page.screenshot({ animations: "disabled", path: join(evidence, "01-local-tickets.png") });

  // 3. An edit made outside Waygoal shows up on the next read.
  writeTicket("screening", "02-film.md", ticket("这部短片适合怎样的开场", { blockedBy: "01", question: "改过的正文。" }));
  await waitFor(async () => (await panel().locator(".waygoal-ticket-body").textContent()).includes("改过的正文。"), "the edited file");
  check("an edit outside Waygoal is picked up without anyone republishing it", true);
  check("repeated reads add no card", await page.locator(".waygoal-ticket-card").count() === 3);

  // A retitled ticket is the same ticket: the file it came from is its identity.
  const beforeRetitle = await snapshot();
  writeTicket("screening", "02-film.md", ticket("这部短片的开场该怎么定", { blockedBy: "01", question: "改过的正文。" }));
  await card("这部短片的开场该怎么定").waitFor();
  const afterRetitle = await snapshot();
  check("a retitled ticket is the same card, not a new one",
    await page.locator(".waygoal-ticket-card").count() === 3
    && afterRetitle.tickets.maps[0].tickets.map((t) => t.id).join() === beforeRetitle.tickets.maps[0].tickets.map((t) => t.id).join(),
    JSON.stringify(afterRetitle.tickets.maps[0].tickets.map((t) => [t.id, t.title])));

  // 4. Dependencies that cannot be resolved say so instead of counting as met.
  writeTicket("screening", "03-opening.md", ticket("开场怎么说", { blockedBy: "09, 02" }));
  await card("开场怎么说").waitFor();
  await fitCanvas();
  await card("开场怎么说").click();
  await panel().getByText("这张地图里找不到").waitFor();
  check("a dependency that names nothing is reported, not treated as satisfied", true);

  // A second file numbered 02: the dependency above can no longer say which
  // ticket it means, and must not pick one.
  writeTicket("screening", "02-second.md", ticket("同号的另一张票"));
  await panel().getByText("同号有多份，无法确定").waitFor();
  check("two tickets sharing a number leave the dependency undetermined", true);
  rmSync(join(mapDir("screening"), "issues", "02-second.md"));

  // 5. A directory that is not the supported layout is named as such.
  mkdirSync(join(workspace, ".scratch", "notes"), { recursive: true });
  writeFileSync(join(workspace, ".scratch", "notes", "README.md"), "# 随手记\n");
  const scan = await waitFor(async () => {
    const s = await snapshot();
    return s.tickets.unsupported.length === 1 ? s : null;
  }, "the unsupported directory");
  check("a directory without map.md is explained, not silently ignored",
    scan.tickets.unsupported[0].path === ".scratch/notes" && /map\.md/.test(scan.tickets.unsupported[0].reason), JSON.stringify(scan.tickets.unsupported));
  const skipped = page.locator(".waygoal-skipped");
  await skipped.waitFor();
  check("and it says so on the canvas, not only in the snapshot",
    (await skipped.textContent()).includes(".scratch/notes"), await skipped.textContent());

  // 6. A card the user moved stays where it was put, across a host restart.
  await fitCanvas();
  const box = await card("希望朋友带走什么感受").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 180, box.y + 132, { steps: 12 });
  await page.mouse.up();
  const moved = await waitFor(async () => {
    const s = await snapshot();
    const t = s.tickets.maps[0].tickets.find((x) => x.title === "希望朋友带走什么感受");
    return t && (t.position.x !== 0 || t.position.y !== 0) ? t.position : null;
  }, "the moved card to be saved");

  await page.close().catch(() => {});
  await stopServer(server); server = await startServer();
  page = await openPage();
  await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  await card("希望朋友带走什么感受").waitFor();
  const after = (await snapshot()).tickets.maps[0].tickets.find((t) => t.title === "希望朋友带走什么感受");
  check("layout and what was read survive a host restart", JSON.stringify(after.position) === JSON.stringify(moved), JSON.stringify([moved, after.position]));

  // 7. A source file that disappears keeps its last read content, marked.
  rmSync(join(mapDir("screening"), "issues", "01-feeling.md"));
  await waitFor(async () => (await snapshot()).tickets.maps[0].tickets.some((t) => t.title === "希望朋友带走什么感受" && t.stale), "the ticket to be marked stale");
  await card("希望朋友带走什么感受").click();
  await panel().getByText(/再读时还是读不到/).waitFor();
  const stale = await panel().locator(".waygoal-ticket-body").textContent();
  check("a file that cannot be read shows what was last read, and says it is not current",
    stale.includes("希望朋友带走什么感受的正文。"), stale);
  check("it is not quietly dropped from the canvas", await card("希望朋友带走什么感受").count() === 1);
  await page.screenshot({ animations: "disabled", path: join(evidence, "02-stale-source.png") });

  check("still no Pi session was started", sessionFiles().length === 0, JSON.stringify(sessionFiles()));
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
