// Browser verification for walking a Wayfinder map: reading its destination,
// its decisions and what is still unspecified in the source's own words,
// opening the places the source points at, going from a ticket's conclusion
// into the real discussion held under it, and the note that appears when a
// map's whole ticket set has been read closed (ticket #11).
//
// Starts its own pi-web on a free loopback port with an isolated Pi data
// directory and a fake OpenAI-compatible model; no real model and no Pi login
// take part.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { modelsJson, startFakeModel } from "./fake-model.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const evidence = resolve(root, "../../docs/research/prototype-evidence/map");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-map-server.log"));

const agentDir = mkdtempSync(join(tmpdir(), "waygoal-map-e2e-"));
const work = join(agentDir, "work/放映会");
const party = join(work, ".scratch/party");
mkdirSync(join(party, "issues"), { recursive: true });
mkdirSync(join(work, "产物"), { recursive: true });

// A real party map: its own headings, its own words, and links it wrote itself
// — one to a ticket, one to an artifact, one to a place that is not there, and
// one off-site address.
const MAP = `# 给朋友办一场小型放映会

只办一场，在客厅，不租场地。

## Destination

定下一个能照着做的方案。

## Decisions so far

- 场地就在客厅，见 [场地定在哪](issues/01-room.md)
- 片单和流程写在 [方案草稿](../../产物/方案.md)

## Not yet specified

- 吃的怎么办，见 [吃什么](issues/09-food.md)
- 写法参考 [别人的记法](https://example.invalid/notes)
`;
const mapFile = join(party, "map.md");
const roomTicket = join(party, "issues/01-room.md");
const openingTicket = join(party, "issues/02-opening.md");
const plan = join(work, "产物/方案.md");
const PLAN = "# 方案草稿\n\n客厅，六个人，八点开始。\n";
// A ticket whose conclusion points back at the artifact it produced.
const ROOM = "# 场地定在哪\n\nType: grilling\nStatus: resolved\n\n## Question\n\n场地定在哪。\n\n## Answer\n\n就用客厅，理由写在 [方案草稿](../../../产物/方案.md)。\n";
const OPENING = "# 开场怎么说\n\nType: grilling\nStatus: open\n\n## Question\n\n开场怎么说。\n";
writeFileSync(mapFile, MAP);
writeFileSync(plan, PLAN);
writeFileSync(roomTicket, ROOM);
writeFileSync(openingTicket, OPENING);
// A map whose destination is a decision already locked, not a plan to write:
// the note must read exactly the same and must not push anyone towards a Spec.
mkdirSync(join(work, ".scratch/locked/issues"), { recursive: true });
const lockedMap = join(work, ".scratch/locked/map.md");
const lockedTicket = join(work, ".scratch/locked/issues/01-venue.md");
const LOCKED_MAP = "# 就在客厅办\n\n## Destination\n\n已锁定的决定：就在客厅办，不再讨论别的场地。\n";
const LOCKED_TICKET = "# 客厅够不够坐\n\nType: grilling\nStatus: resolved\n\n## Question\n\n客厅够不够坐。\n";
writeFileSync(lockedMap, LOCKED_MAP);
writeFileSync(lockedTicket, LOCKED_TICKET);
// A map with no tickets at all: there is no "all closed" about it, ever.
mkdirSync(join(work, ".scratch/empty/issues"), { recursive: true });
writeFileSync(join(work, ".scratch/empty/map.md"), "# 还没想好的一张地图\n\n## Destination\n\n还没想好。\n");

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

async function startServer() {
  const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BEACON_PROTOTYPE: "1", PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
  });
  child.stdout.pipe(serverLog, { end: false }); child.stderr.pipe(serverLog, { end: false });
  const deadline = Date.now() + 120_000;
  for (;;) {
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-map-server.log");
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(work)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-map-server.log");
    await delay(250);
  }
}
async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit"); child.kill("SIGTERM");
  await Promise.race([exited, delay(15_000).then(() => child.kill("SIGKILL"))]);
}

const snapshot = async () => (await fetch(`${base}/api/waygoal?${new URLSearchParams({ cwd: work, force: "1" })}`, { cache: "no-store" })).json();
const idsOn = async () => (await snapshot()).nodes.map((n) => n.id).sort();
const nodeOf = async (id) => (await snapshot()).nodes.find((n) => n.id === id);
const mapPath = ".scratch/party/map.md";
const roomPath = ".scratch/party/issues/01-room.md";
/** What the tracker files say and when they were last written: nothing the
 *  canvas does here may change either. */
const trackerState = () => [mapFile, roomTicket, openingTicket, plan]
  .map((file) => `${file}:${statSync(file).mtimeMs}:${readFileSync(file, "utf8").length}`).join("\n");
/** Every deliberate write this test makes, kept so the files can be checked
 *  against what the test put there rather than against themselves. */
const wrote = new Map([[mapFile, MAP], [plan, PLAN], [roomTicket, ROOM], [openingTicket, OPENING], [lockedMap, LOCKED_MAP], [lockedTicket, LOCKED_TICKET]]);
const put = (file, text) => { wrote.set(file, text); writeFileSync(file, text); };
const trackerUntouched = () => [...wrote].every(([file, text]) => readFileSync(file, "utf8") === text);

try {
  server = await startServer();
  browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  const errors = [];
  // While the host is deliberately stopped, the open page cannot reach it.
  // Those failures are the restart, not the page.
  let restarting = false;
  const note = (text) => { if (!restarting) errors.push(text); };
  const openPage = async () => {
    const p = await context.newPage();
    p.setDefaultTimeout(30_000);
    p.on("pageerror", (e) => note(e.message));
    p.on("crash", () => note("page crashed"));
    p.on("console", (e) => { if (e.type() === "error") note(e.text()); });
    p.on("response", (r) => { if (r.url().startsWith(base) && r.status() >= 400) note(`${r.status()} ${r.url()}`); });
    return p;
  };
  page = await openPage();
  const panel = () => page.locator(".waygoal-panel");
  const composer = () => panel().locator("textarea").first();
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
  const openCard = async (id) => { await closePanel(); await page.locator(`[data-node="${id}"]`).click(); await panel().waitFor(); };
  const checkNote = () => page.locator(`[data-map-check="${mapPath}"]`);

  await page.goto(`${base}/beacon?cwd=${encodeURIComponent(work)}`, { waitUntil: "domcontentloaded" });
  await page.locator(`[data-node="${mapPath}"]`).waitFor();

  // ---- The map itself, in its own format ----------------------------------
  await openCard(mapPath);
  const headings = await panel().locator("[data-section]").evaluateAll((els) => els.map((el) => el.getAttribute("data-section")));
  check("the map is shown by its own sections, in its own order",
    JSON.stringify(headings) === JSON.stringify(["Destination", "Decisions so far", "Not yet specified"]), JSON.stringify(headings));
  const destination = await panel().locator('[data-section="Destination"] pre').innerText();
  check("a section shows the file's own words, not a summary of them",
    destination.trim() === "定下一个能照着做的方案。", destination);
  const lead = await panel().locator(".waygoal-map-sections > pre").first().innerText();
  check("what the file says before its first heading is shown too, under no invented heading",
    lead.includes("只办一场，在客厅，不租场地。"), lead);

  // ---- The places the source itself points at -----------------------------
  const refKinds = Object.fromEntries(await panel().locator("[data-reference]").evaluateAll(
    (els) => els.map((el) => [el.getAttribute("data-reference"), el.getAttribute("data-reference-kind")])));
  check("each link is settled against the real files: a ticket, an artifact, one that is not there, one off-site",
    refKinds["issues/01-room.md"] === "ticket" && refKinds["../../产物/方案.md"] === "file"
    && refKinds["issues/09-food.md"] === "missing" && refKinds["https://example.invalid/notes"] === "external",
    JSON.stringify(refKinds));
  check("a place that cannot be reached is marked and offers no way in, rather than being swapped for a lookalike",
    (await panel().locator('[data-reference="issues/09-food.md"] [data-reference-open]').count()) === 0
    && (await panel().locator('[data-reference="issues/09-food.md"]').innerText()).includes("打不开"));
  check("an off-site address is listed as written and is not opened for you",
    (await panel().locator('[data-reference="https://example.invalid/notes"] [data-reference-open]').count()) === 0);

  let requests = model.requests.length;
  let tracker = trackerState();
  await panel().locator('[data-reference-open="issues/01-room.md"]').click();
  await panel().getByText("场地定在哪", { exact: false }).first().waitFor();
  check("following the map's own link lands on that ticket",
    (await page.locator(`[data-node="${roomPath}"]`).getAttribute("aria-pressed")) === "true");

  await panel().locator('[data-reference-open="../../../产物/方案.md"]').click();
  await panel().locator(".waygoal-file-view").waitFor();
  const shown = await waitFor(async () => {
    const text = await panel().locator(".waygoal-file-view").innerText();
    return text.includes("客厅，六个人，八点开始") ? text : null;
  }, "the artifact to be read into the panel", 20_000).catch(async () => panel().locator(".waygoal-file-view").innerText());
  check("a ticket's conclusion opens the artifact it points at, with the viewer the app already has",
    shown.includes("客厅，六个人，八点开始"), shown);
  await panel().locator("[data-file-back]").click();
  await panel().locator(".waygoal-ticket-refs").waitFor();
  check("and coming back lands on the ticket it was opened from, unchanged",
    (await panel().innerText()).includes("场地定在哪"));
  check("reading the map, its links and the artifact sent nothing and wrote nothing to the source",
    model.requests.length === requests && trackerState() === tracker,
    JSON.stringify({ requests, now: model.requests.length }));

  // ---- From a ticket's conclusion into the real discussion ----------------
  await page.locator(`[data-talk-start="${roomPath}"]`).click();
  await composer().waitFor();
  await send("客厅够坐六个人吗");
  const talkId = await waitFor(async () => (await idsOn())[0], "the discussion started under the ticket");
  const leafBefore = (await nodeOf(talkId)).activeLeafId;
  await openCard(roomPath);
  await panel().locator(`[data-talk="${talkId}"] button`).click();
  await panel().waitFor();
  check("from the ticket, the discussion actually held under it opens — the real session, not one that looks like it",
    (await page.locator(`[data-node="${talkId}"]`).getAttribute("aria-pressed")) === "true");
  await openCard(roomPath);
  check("and the source is still one click away from the discussion",
    (await panel().innerText()).includes(roomPath));
  check("going between them left the active leaf where it was",
    (await nodeOf(talkId)).activeLeafId === leafBefore);

  // ---- The check note -----------------------------------------------------
  await closePanel();
  check("while a ticket is still open, nothing says this map is done", (await checkNote().count()) === 0);

  await page.locator(".waygoal-viewport").first().focus();
  const focusBefore = await page.evaluate(() => document.activeElement?.className ?? "");
  requests = model.requests.length;
  put(openingTicket, "# 开场怎么说\n\nType: grilling\nStatus: resolved\n\n## Question\n\n开场怎么说。\n");
  tracker = trackerState();
  await checkNote().waitFor();
  const noteText = await checkNote().innerText();
  check("closing the last ticket brings up the check note, in the words the design settled on",
    noteText.includes("这张地图的决策票都已关闭。可以检查一下：还有未澄清的问题吗？通往目的地的路是否已经清楚？")
    && noteText.includes("如果目的地是形成方案，可以主动使用 /to-spec"), noteText);
  check("it asks; it does not announce that the map is finished",
    !/地图.{0,4}(完成|做完|结束)/.test(noteText), noteText);
  check("it does not take the focus away from what the user was doing",
    (await page.evaluate(() => document.activeElement?.className ?? "")) === focusBefore);
  check("nothing was sent and nothing was written to the source when it appeared",
    model.requests.length === requests && trackerState() === tracker);

  requests = model.requests.length; tracker = trackerState();
  await checkNote().locator(`[data-map-check-view="${mapPath}"]`).click();
  await panel().locator('[data-section="Not yet specified"]').waitFor();
  check("「查看地图」 只是打开这张地图来读：目的地和未明确方向都在，没有发消息，也没有动 tracker",
    (await panel().innerText()).includes("吃的怎么办")
    && model.requests.length === requests && trackerState() === tracker);
  await closePanel();

  // A cancelled ticket still counts for the timing and for nothing else.
  put(openingTicket, "# 开场怎么说\n\nType: grilling\nStatus: cancelled\n\n## Question\n\n开场怎么说。\n");
  await waitFor(async () => (await checkNote().innerText()).includes("取消"), "the note to say how many were cancelled");
  check("a cancelled ticket is counted out loud, and is not passed off as a result",
    (await checkNote().innerText()).includes("取消不算做成的结论"), await checkNote().innerText());

  // ---- Putting it away, and asking for it back ----------------------------
  await checkNote().locator(`[data-map-check-dismiss="${mapPath}"]`).click();
  await waitFor(async () => (await checkNote().count()) === 0, "the note to be put away");
  for (let again = 0; again < 3; again += 1) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(`[data-node="${mapPath}"]`).waitFor();
    await delay(1200);
    assert.equal(await checkNote().count(), 0, "the note came back on a repeated reload");
  }
  check("once put away it does not come back, however many times the page is refreshed", true);

  restarting = true;
  await stopServer(server);
  server = await startServer();
  const fresh = await openPage();
  await page.close();
  page = fresh;
  await page.goto(`${base}/beacon?cwd=${encodeURIComponent(work)}`, { waitUntil: "domcontentloaded" });
  await page.locator(`[data-node="${mapPath}"]`).waitFor();
  restarting = false;
  await delay(1500);
  check("nor after the host is restarted", (await checkNote().count()) === 0);

  await openCard(mapPath);
  await panel().locator('[data-reference-open="issues/01-room.md"]').click();
  await panel().locator(".waygoal-ticket-refs").waitFor();
  await panel().locator('[data-reference-open="../../../产物/方案.md"]').click();
  const afterRestart = await waitFor(async () => {
    const text = await panel().locator(".waygoal-file-view").innerText();
    return text.includes("客厅，六个人，八点开始") ? text : null;
  }, "the artifact to be readable again after the restart", 20_000);
  check("after the restart the ticket, the artifact and the discussion under the ticket are all still reachable",
    afterRestart.includes("客厅，六个人，八点开始")
    && (await page.locator(`[data-talk="${talkId}"]`).count()) === 1);
  await panel().locator("[data-file-back]").click();
  await closePanel();

  await openCard(mapPath);
  await panel().locator(`[data-map-check-reopen="${mapPath}"]`).click();
  await closePanel();
  await checkNote().waitFor();
  check("and it can be asked for again from the map itself", (await checkNote().count()) === 1);

  // ---- When the ticket set is not known -----------------------------------
  chmodSync(openingTicket, 0o000);
  await waitFor(async () => (await checkNote().count()) === 0, "the note to go quiet while a ticket cannot be read");
  check("a ticket that cannot be read this time leaves the set unknown, and an unknown set declares nothing", true);
  chmodSync(openingTicket, 0o644);
  await waitFor(async () => (await checkNote().count()) === 1, "the note to come back once every ticket reads again");
  check("and it comes back once the source reads clean again", true);

  const duplicate = join(party, "issues/01-also-room.md");
  put(duplicate, "# 场地也在这里\n\nType: grilling\nStatus: resolved\n\n## Question\n\n重复的号。\n");
  await waitFor(async () => (await checkNote().count()) === 0, "the note to go quiet while two tickets share a number");
  check("two tickets sharing a number mean the set is not known either, so nothing is declared", true);

  const lockedNote = page.locator('[data-map-check=".scratch/locked/map.md"]');
  await lockedNote.waitFor();
  const lockedText = await lockedNote.innerText();
  check("a map whose destination is a decision already made gets the very same note, word for word",
    lockedText.includes("这张地图的决策票都已关闭。可以检查一下：还有未澄清的问题吗？通往目的地的路是否已经清楚？"), lockedText);
  check("and /to-spec stays inside its if-clause: nothing tells this map to go write one",
    lockedText.includes("如果目的地是形成方案，可以主动使用 /to-spec")
    && !/(建议|应该|请)[^。]{0,10}\/to-spec/.test(lockedText), lockedText);

  check("a map with no tickets never has an 'all closed' about it",
    (await page.locator('[data-map-check=".scratch/empty/map.md"]').count()) === 0);
  check("nothing on this map was sent, and every tracker file still says exactly what this test wrote",
    model.requests.length === requests && trackerUntouched(),
    JSON.stringify({ requests, now: model.requests.length }));

  check("no page or console errors", errors.length === 0, errors.join("\n"));
  await context.close();

  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks }, null, 2));
  console.log(`\nAll ${checks.length} checks passed. Evidence: ${evidence}`);
} catch (error) {
  process.exitCode = 1;
  await page?.screenshot({ path: join(artifacts, "waygoal-map-failure.png"), fullPage: false }).catch(() => {});
  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks, failure: String(error?.stack ?? error) }, null, 2));
  writeFileSync(join(artifacts, "waygoal-map-model-requests.json"), JSON.stringify(model.requests, null, 2));
  console.error(error);
} finally {
  await browser?.close().catch(() => {});
  await stopServer(server);
  await Promise.race([model.close(), delay(5000)]);
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
}
