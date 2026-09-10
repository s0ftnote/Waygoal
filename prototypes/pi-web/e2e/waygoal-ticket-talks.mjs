// Browser verification for discussions held under a local ticket (ticket #8).
// Starts its own pi-web on a free loopback port with an isolated Pi data
// directory and a fake OpenAI-compatible model, writes real tracker files into
// the workspace, and drives the canvas: starting a discussion from an empty
// ticket, sending, branching it, collapsing the ticket, continuing from inside
// it, a host restart, and a discussion whose session is gone.
//
// The model is fake and local; no real model and no Pi login take part.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { modelsJson, startFakeModel } from "./fake-model.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const evidence = resolve(root, "../../docs/research/prototype-evidence/ticket-talks");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-ticket-talks-server.log"));

const agentDir = mkdtempSync(join(tmpdir(), "waygoal-talks-e2e-"));
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

let server, browser, page;
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
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-ticket-talks-server.log");
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-ticket-talks-server.log");
    await delay(250);
  }
}
async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit"); child.kill("SIGTERM");
  await Promise.race([exited, delay(15_000).then(() => child.kill("SIGKILL"))]);
}

const snapshot = async () => (await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`, { cache: "no-store" })).json();
const ticketOf = async (title) => (await snapshot()).tickets.maps[0].tickets.find((t) => t.title === title);
const sessionFiles = () => existsSync(join(agentDir, "sessions"))
  ? readdirSync(join(agentDir, "sessions"), { recursive: true }).filter((f) => String(f).endsWith(".jsonl")) : [];
function sessionEntries(id) {
  const file = readdirSync(join(agentDir, "sessions"), { recursive: true }).find((f) => String(f).endsWith(`_${id}.jsonl`));
  assert.ok(file, `session file for ${id}`);
  return readFileSync(join(agentDir, "sessions", String(file)), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

/** Real tracker files, in the layout the local Markdown tracker documents. */
const mapDir = (effort) => join(workspace, ".scratch", effort);
function writeMap(effort, body) {
  mkdirSync(join(mapDir(effort), "issues"), { recursive: true });
  writeFileSync(join(mapDir(effort), "map.md"), body);
}
const writeTicket = (effort, file, body) => writeFileSync(join(mapDir(effort), "issues", file), body);
const ticketFile = (title, { status = "open", blockedBy = "" } = {}) =>
  `# ${title}\n\nType: grilling\nStatus: ${status}\n${blockedBy ? `Blocked by: ${blockedBy}\n` : ""}\n## Question\n\n${title}的正文。\n`;

try {
  // A planning map: one open ticket, one blocked by it, one already resolved.
  writeMap("party", "# 给朋友办一场小型放映会\n\n## Destination\n\n定下一个方案。\n");
  writeTicket("party", "01-feeling.md", ticketFile("希望朋友带走什么感受"));
  writeTicket("party", "02-opening.md", ticketFile("开场怎么说", { blockedBy: "01" }));
  writeTicket("party", "03-snacks.md", ticketFile("吃的准备什么", { status: "resolved" }));

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
  const card = (title) => page.locator(".waygoal-ticket-card", { hasText: title }).first();
  const send = async (text) => {
    const before = model.requests.length;
    await composer().fill(text);
    await panel().getByRole("button", { name: /^(Send|发送)$/ }).click();
    await waitFor(() => model.requests.length > before, `model request for ${text}`);
    await panel().getByText(`回复: ${text}`, { exact: true }).waitFor({ timeout: 60_000 });
    await delay(600);
  };
  /** Canvas chips sit under the panel when it is open, so close it first. */
  const closePanel = async () => {
    const close = page.getByRole("button", { name: "关闭面板" });
    if (await close.count() > 0 && await close.isVisible()) await close.click();
  };
  /** Opening a discussion centres it, which can carry its ticket off screen. */
  const fitCanvas = async () => {
    await closePanel();
    await page.getByRole("button", { name: "回到全景" }).click();
    await delay(400);
  };
  const clickOnHover = async (messageText, buttonName) => {
    const message = panel().getByText(messageText, { exact: true }).first();
    await message.waitFor();
    // The message list keeps scrolling for a moment after a reply renders, and
    // controls an earlier hover revealed have to go before this one's show —
    // otherwise the click lands on some other message's fork button.
    await delay(800);
    await page.mouse.move(4, 4);
    await panel().getByRole("button", { name: buttonName }).first().waitFor({ state: "hidden" }).catch(() => {});
    await message.hover();
    const button = panel().getByRole("button", { name: buttonName }).first();
    await button.waitFor();
    const box = await waitFor(async () => {
      const b = await button.boundingBox();
      return b && b.width > 0 ? b : null;
    }, `${buttonName} to be laid out`, 10_000);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.up();
  };

  // 1. An empty ticket says so, and starting from it opens a composer only.
  await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  await card("开场怎么说").waitFor();
  await page.locator('[data-talk-start=".scratch/party/issues/02-opening.md"]').getByText("还没有讨论，开始聊").waitFor();
  check("a ticket with no discussion says so instead of looking finished", true);

  await page.locator('[data-talk-start=".scratch/party/issues/02-opening.md"]').click();
  await composer().waitFor();
  await composer().fill("先想开场白");
  await delay(500);
  check("starting a discussion from a ticket sends nothing and creates no session",
    sessionFiles().length === 0 && model.requests.length === 0, JSON.stringify(sessionFiles()));

  // 2. Clicking start again comes back to the same unsent draft.
  await fitCanvas();
  await page.locator('[data-talk-start=".scratch/party/issues/02-opening.md"]').click();
  await composer().waitFor();
  check("clicking start again returns to the same draft, not a second discussion",
    (await composer().inputValue()).includes("先想开场白") && sessionFiles().length === 0, await composer().inputValue());

  // 3. Sending is what creates the discussion, and it is held under the ticket.
  await send("先想开场白");
  const first = await waitFor(async () => {
    const t = await ticketOf("开场怎么说");
    return t.discussions.length === 1 ? t : null;
  }, "the discussion to be held under the ticket");
  const firstId = first.discussions[0].sessionId;
  check("the discussion is held under the ticket it was started from", first.discussions[0].missing === false);
  check("a blocked ticket can still be discussed, and talking changes no status",
    first.blocked === true && first.status === "open", JSON.stringify([first.blocked, first.status]));
  await page.locator(`[data-talk="${firstId}"]`).waitFor();
  check("the ticket shows the discussion under it on the canvas", true);
  check("and draws the relation to it", await page.locator(".waygoal-links .waygoal-link.ticket").count() === 1);
  await page.screenshot({ animations: "disabled", path: join(evidence, "01-first-discussion.png") });

  // 4. A branch of that discussion is still this ticket's discussion. Pi offers
  //    no fork from the very first message, so the branch comes off the second.
  await send("再想想开头那句");
  await clickOnHover("再想想开头那句", "从这里分叉");
  const forked = await waitFor(async () => {
    const t = await ticketOf("开场怎么说");
    return t.discussions.length === 2 ? t : null;
  }, "the fork to be held under the same ticket");
  const forkedId = forked.discussions.find((d) => d.sessionId !== firstId).sessionId;
  check("a discussion forked out of this ticket stays under it",
    forked.discussions.find((d) => d.sessionId === forkedId).originSessionId === firstId, JSON.stringify(forked.discussions));
  check("the ticket gains no dependency from being discussed",
    forked.blockers.length === 1 && forked.blockers[0].number === "01", JSON.stringify(forked.blockers));
  check("the fork is its own Pi session file", sessionEntries(forkedId).length > 0);

  // 4b. Two branches off the same discussion, both still this ticket's.
  await fitCanvas();
  await page.locator(`[data-talk="${firstId}"]`).click();
  await clickOnHover("再想想开头那句", "从这里分叉");
  const twice = await waitFor(async () => {
    const t = await ticketOf("开场怎么说");
    return t.discussions.length === 3 ? t : null;
  }, "a second branch under the same ticket");
  const secondForkId = twice.discussions.find((d) => ![firstId, forkedId].includes(d.sessionId)).sessionId;
  check("a second branch off the same discussion is also this ticket's",
    twice.discussions.filter((d) => d.originSessionId === firstId).length === 2,
    JSON.stringify(twice.discussions.map((d) => [d.sessionId, d.originSessionId])));
  check("the two branches are two separate Pi session files",
    secondForkId !== forkedId && sessionEntries(secondForkId).length > 0);

  // 4c. Reading the source message from a branch: read-only, sends nothing, and
  //     does not move which discussion the ticket says was last talked in.
  const lastBefore = twice.lastDiscussion?.sessionId;
  const sentBeforeReview = model.requests.length;
  await panel().getByRole("button", { name: "回到来源这条消息" }).click();
  await panel().getByText("来源那边的历史，这里只看不发").waitFor();
  await delay(1500);
  const reviewed = await ticketOf("开场怎么说");
  check("reading a branch's source history sends nothing and stays read-only",
    model.requests.length === sentBeforeReview);
  check("and reading does not move which discussion the ticket was last talked in",
    reviewed.lastDiscussion?.sessionId === lastBefore, JSON.stringify([lastBefore, reviewed.lastDiscussion]));
  await page.screenshot({ animations: "disabled", path: join(evidence, "02-reading-the-source.png") });

  // 5. A second discussion under the same ticket, started deliberately.
  await fitCanvas();
  await page.locator('[data-talk-start=".scratch/party/issues/02-opening.md"]').click();
  await composer().waitFor();
  await send("另一条思路：先放片再说");
  const three = await waitFor(async () => {
    const t = await ticketOf("开场怎么说");
    return t.discussions.length === 4 ? t : null;
  }, "a second discussion under the ticket");
  const secondId = three.discussions.find((d) => ![firstId, forkedId, secondForkId].includes(d.sessionId)).sessionId;
  check("one ticket carries several discussions", new Set(three.discussions.map((d) => d.sessionId)).size === 4);
  check("the ticket remembers which discussion was last talked in", three.lastDiscussion?.sessionId === secondId, JSON.stringify(three.lastDiscussion));

  // 5b. Collapsing a ticket and closing the panel while a discussion is still
  //     running must not stop it: the answer still arrives in that session.
  model.slowMs = 5000;
  await composer().fill("这条要慢慢想");
  await panel().getByRole("button", { name: /^(Send|发送)$/ }).click();
  await waitFor(async () => (await snapshot()).nodes.find((n) => n.id === secondId)?.running, "the discussion to be running");
  await fitCanvas();
  await page.locator('[data-talk-toggle=".scratch/party/issues/02-opening.md"]').click();
  await waitFor(async () => (await ticketOf("开场怎么说")).expanded === false, "the ticket to be collapsed");
  const answered = await waitFor(
    () => sessionEntries(secondId).some((e) => JSON.stringify(e.message?.content ?? "").includes("回复: 这条要慢慢想")),
    "the held-open answer to arrive anyway", 60_000);
  model.slowMs = 0;
  check("collapsing the ticket and closing the panel does not stop a running discussion", answered);
  await waitFor(async () => !(await snapshot()).nodes.find((n) => n.id === secondId)?.running, "the discussion to finish");

  // 6. Collapsing hides the chips; the ticket itself still opens them.
  await fitCanvas();
  await page.locator('[data-talk-toggle=".scratch/party/issues/02-opening.md"]').click();
  await page.locator(`[data-talk="${firstId}"]`).waitFor();
  await page.locator('[data-talk-toggle=".scratch/party/issues/02-opening.md"]').click();
  await waitFor(async () => (await ticketOf("开场怎么说")).expanded === false, "the ticket to be collapsed");
  await page.locator(`[data-talk="${firstId}"]`).waitFor({ state: "detached" });
  check("collapsing a ticket takes its discussions off the canvas",
    await page.locator("[data-talk]").count() === 0
    && await page.locator('[data-talk-start=".scratch/party/issues/02-opening.md"]').count() === 0
    && await page.locator(".waygoal-links .waygoal-link.ticket").count() === 0);

  await fitCanvas();
  await card("开场怎么说").click();
  await panel().getByText("这张票下的讨论").waitFor();
  const sentBefore = model.requests.length;
  await panel().locator(`li[data-talk="${firstId}"]`).getByRole("button", { name: "打开" }).click();
  await composer().waitFor();
  check("a collapsed ticket can still be continued from inside itself, without sending anything",
    model.requests.length === sentBefore);
  await send("接着说开场");
  check("continuing from inside the ticket lands in that same discussion",
    sessionEntries(firstId).some((e) => JSON.stringify(e.message?.content ?? "").includes("接着说开场")));
  await page.screenshot({ animations: "disabled", path: join(evidence, "03-collapsed-ticket.png") });

  // 6b. A resolved ticket is not closed to discussion either.
  await fitCanvas();
  await page.locator('[data-talk-start=".scratch/party/issues/03-snacks.md"]').click();
  await composer().waitFor();
  await send("甜的咸的各准备一点");
  const resolved = await waitFor(async () => {
    const t = await ticketOf("吃的准备什么");
    return t.discussions.length === 1 ? t : null;
  }, "a discussion under the resolved ticket");
  check("a resolved ticket can still be discussed, and talking leaves it resolved", resolved.status === "resolved", resolved.status);

  // 7. The short how-to can be closed and opened again.
  await fitCanvas();
  await card("开场怎么说").click();
  await panel().getByText(/在这张票下开始的讨论会一直挂在它下面/).waitFor();
  await panel().getByRole("button", { name: "关闭提示" }).click();
  await panel().getByRole("button", { name: "怎么用" }).click();
  await panel().getByText(/在这张票下开始的讨论会一直挂在它下面/).waitFor();
  check("the short how-to can be closed and opened again", true);

  // 8. A host restart keeps what is held where, and what was collapsed.
  const sentBeforeRestart = model.requests.length;
  await page.close().catch(() => {});
  await stopServer(server); server = await startServer();
  page = await openPage();
  await page.goto(canvasUrl, { waitUntil: "domcontentloaded" });
  await card("开场怎么说").waitFor();
  const restarted = await ticketOf("开场怎么说");
  await delay(1200);
  check("a host restart keeps the discussions, the collapsed state and where the talking was left off",
    restarted.discussions.length === 4 && restarted.expanded === false && restarted.lastDiscussion?.sessionId === firstId
    && model.requests.length === sentBeforeRestart, JSON.stringify([restarted.discussions.length, restarted.expanded, restarted.lastDiscussion]));

  // 9. A discussion whose session is gone says so; nothing is swapped in.
  const file = readdirSync(join(agentDir, "sessions"), { recursive: true }).find((f) => String(f).endsWith(`_${secondId}.jsonl`));
  rmSync(join(agentDir, "sessions", String(file)));
  const broken = await waitFor(async () => {
    const t = await ticketOf("开场怎么说");
    return t.discussions.some((d) => d.missing) ? t : null;
  }, "the missing discussion to be reported");
  check("a discussion whose session is gone is reported, not replaced by another",
    broken.discussions.length === 4 && broken.discussions.find((d) => d.sessionId === secondId).missing === true,
    JSON.stringify(broken.discussions.map((d) => [d.sessionId, d.missing])));
  await fitCanvas();
  await card("开场怎么说").click();
  await panel().getByText("这段讨论已经不在了，画布没有替你换一段").waitFor();
  check("and it says so where the discussions are listed", true);
  await page.screenshot({ animations: "disabled", path: join(evidence, "04-missing-discussion.png") });

  check("no page or console errors", errors.length === 0, errors.join("\n"));
  await context.close();

  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks }, null, 2));
  console.log(`\nAll ${checks.length} checks passed. Evidence: ${evidence}`);
} catch (error) {
  process.exitCode = 1;
  await page?.screenshot({ path: join(artifacts, "waygoal-ticket-talks-failure.png"), fullPage: false }).catch(() => {});
  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks, failure: String(error?.stack ?? error) }, null, 2));
  writeFileSync(join(artifacts, "waygoal-ticket-talks-model-requests.json"), JSON.stringify(model.requests, null, 2));
  console.error(error);
} finally {
  await browser?.close().catch(() => {});
  await stopServer(server);
  await Promise.race([model.close(), delay(5000)]);
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
}
