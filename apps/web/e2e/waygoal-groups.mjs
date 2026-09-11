import { evidenceDirectory } from "./waygoal-artifacts.mjs";
// Browser verification for grouping nodes by hand and drawing relations between
// them (ticket #6). Starts its own pi-web on a free loopback port with an
// isolated Pi data directory and a fake OpenAI-compatible model, then actually
// arranges several real Pi sessions and a local ticket: picking cards, naming a
// group, collapsing and expanding it, drawing and removing a manual link with a
// note, renaming a session, and restarting the host.
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
const evidence = evidenceDirectory("groups");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-groups-server.log"));

const agentDir = mkdtempSync(join(tmpdir(), "waygoal-groups-e2e-"));
const work = join(agentDir, "work/放映会");
mkdirSync(join(work, ".scratch/party/issues"), { recursive: true });
writeFileSync(join(work, ".scratch/party/map.md"), "# 给朋友办一场小型放映会\n\n## Destination\n\n定下一个方案。\n");
const roomTicket = join(work, ".scratch/party/issues/01-room.md");
const openingTicket = join(work, ".scratch/party/issues/02-opening.md");
writeFileSync(roomTicket, "# 场地定在哪\n\nType: grilling\nStatus: open\n\n## Question\n\n场地定在哪。\n");
// A real dependency, so a manual link can be told apart from one.
writeFileSync(openingTicket, "# 开场怎么说\n\nType: grilling\nStatus: open\nBlocked by: 01\n\n## Question\n\n开场怎么说。\n");
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
    env: { ...process.env, WAYGOAL: "1", PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
  });
  child.stdout.pipe(serverLog, { end: false }); child.stderr.pipe(serverLog, { end: false });
  const deadline = Date.now() + 120_000;
  for (;;) {
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-groups-server.log");
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(work)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-groups-server.log");
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

const snapshot = async () => (await fetch(`${base}/api/waygoal?${new URLSearchParams({ cwd: work, force: "1" })}`, { cache: "no-store" })).json();
const idsOn = async () => (await snapshot()).nodes.map((n) => n.id).sort();
const nodeOf = async (id) => (await snapshot()).nodes.find((n) => n.id === id);
const sessionFile = (id) => {
  const file = readdirSync(join(agentDir, "sessions"), { recursive: true }).find((f) => String(f).endsWith(`_${id}.jsonl`));
  assert.ok(file, `session file for ${id}`);
  return readFileSync(join(agentDir, "sessions", String(file)), "utf8");
};
const ticketPath = ".scratch/party/issues/01-room.md";

try {
  server = await startServer();
  browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  const errors = [];
  // While the host is deliberately stopped, the page that is still open cannot
  // reach it. Those failures are the restart, not the page: they are not
  // collected, and everything outside that window still is.
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
  const startChat = async (text) => {
    await closePanel();
    await page.getByRole("button", { name: "新开聊天" }).click();
    await composer().waitFor();
    const before = new Set(await idsOn());
    await send(text);
    const id = await waitFor(async () => (await idsOn()).find((n) => !before.has(n)), `the session started with ${text}`);
    await closePanel();
    return id;
  };
  /** ⌘/Ctrl-click: pick this card instead of opening it. */
  const pick = async (id) => {
    await page.locator(`[data-node="${id}"]`).click({ modifiers: ["ControlOrMeta"] });
    await delay(150);
  };
  const chatCards = () => page.locator("[data-node]:not(.waygoal-ticket-card):not(.waygoal-group-card)").count();

  await page.goto(`${base}/waygoal?cwd=${encodeURIComponent(work)}`, { waitUntil: "domcontentloaded" });
  await page.locator(".waygoal-ticket-card").first().waitFor();

  // Three real Pi sessions to arrange, and a real fork among them.
  const filmId = await startChat("放映会放哪部片好");
  const snackId = await startChat("吃的准备什么");
  const roomId = await startChat("场地就定在客厅吧");
  check("three real sessions to arrange", (await idsOn()).length === 3, (await idsOn()).join());

  // Start with two deliberately scattered cards; the third and all tickets
  // are outside the selection and must keep their saved positions.
  await fetch(`${base}/api/waygoal`, { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: work, positions: { [filmId]: { x: 0, y: 700 }, [snackId]: { x: 960, y: 1400 } } }) });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(`[data-node="${filmId}"]`).waitFor();
  await closePanel();
  await page.getByRole("button", { name: "回到全景" }).click();
  await delay(700);

  // 1. Picking cards is not opening them, and changes nothing.
  const requestsBefore = model.requests.length;
  await pick(filmId);
  await pick(snackId);
  check("picking cards opens no panel and sends nothing",
    (await page.locator(".waygoal-panel").count()) === 0
    && (await page.locator("[data-picked]").innerText()).includes("已选 2 个")
    && model.requests.length === requestsBefore,
    await page.locator("[data-picked]").innerText());

  const layoutBefore = await snapshot();
  const allPositions = snap => Object.fromEntries(snap.nodes.map(node => [node.id, node.position]));
  const ticketPositions = snap => Object.fromEntries(snap.tickets.maps.flatMap(map => [[map.path, map.position], ...map.tickets.map(ticket => [ticket.id, ticket.position])]));
  const sessionBytes = Object.fromEntries((await idsOn()).map(id => [id, sessionFile(id)]));
  await page.locator("[data-layout-selected]").click();
  await waitFor(async () => (await snapshot()).canUndoLayout, "layout undo checkpoint");
  const laidOut = await snapshot();
  check("local arrangement compacts selected cards without moving the others",
    Math.abs((await nodeOf(filmId)).position.x - (await nodeOf(snackId)).position.x) <= 320
    && Math.abs((await nodeOf(filmId)).position.y - (await nodeOf(snackId)).position.y) <= 200
    && JSON.stringify(laidOut.nodes.find(node => node.id === roomId).position) === JSON.stringify(layoutBefore.nodes.find(node => node.id === roomId).position)
    && JSON.stringify(ticketPositions(laidOut)) === JSON.stringify(ticketPositions(layoutBefore)), JSON.stringify(allPositions(laidOut)));
  await page.screenshot({ animations: "disabled", path: join(evidence, "05-local-layout.png") });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("[data-layout-undo]").waitFor();
  await closePanel();
  check("arranged positions and undo survive refresh", JSON.stringify(allPositions(await snapshot())) === JSON.stringify(allPositions(laidOut)));
  await page.locator("[data-layout-undo]").click();
  await waitFor(async () => !(await snapshot()).canUndoLayout, "undo restores original positions");
  check("undo restores exactly the earlier positions", JSON.stringify(allPositions(await snapshot())) === JSON.stringify(allPositions(layoutBefore)));
  check("arrangement and undo do not edit sessions or send a message",
    model.requests.length === requestsBefore && Object.entries(sessionBytes).every(([id, content]) => sessionFile(id) === content));
  await page.locator("[data-layout-pick-all]").click();
  check("all visible sessions can be picked in one click", await page.locator("[data-picked]").getAttribute("data-picked") === "3");
  await page.locator("[data-picked-clear]").click();
  await pick(filmId);
  await pick(snackId);

  // 2. Naming a group: the record gains a group, Pi gains nothing.
  const sessionsBefore = readdirSync(join(agentDir, "sessions"), { recursive: true }).length;
  await page.locator("[data-group-name]").fill("先定好片子和吃的");
  await page.locator("[data-group-create]").click();
  const group = await waitFor(async () => (await snapshot()).groups.find((g) => g.name === "先定好片子和吃的"), "the new group");
  check("a named group is made from the picked cards",
    group.members.slice().sort().join() === [filmId, snackId].sort().join() && group.collapsed === false,
    JSON.stringify(group));
  check("making a group starts no session and sends no message",
    readdirSync(join(agentDir, "sessions"), { recursive: true }).length === sessionsBefore && model.requests.length === requestsBefore,
    JSON.stringify({ requests: model.requests.length - requestsBefore }));
  check("the group is named on the canvas, and its members are still their own cards",
    (await page.locator(`[data-group="${group.id}"]`).innerText()).includes("先定好片子和吃的")
    && (await chatCards()) === 3,
    JSON.stringify({ chats: await chatCards() }));
  // Grouping is an arrangement, not a shared context: each member is still its
  // own Pi session file, and none of them learned about the others.
  check("grouping shares no context: each member is still its own session, unchanged",
    !sessionFile(filmId).includes("先定好片子和吃的") && !sessionFile(snackId).includes("先定好片子和吃的")
    && !sessionFile(filmId).includes(snackId));
  await page.screenshot({ animations: "disabled", path: join(evidence, "01-group-frame.png") });

  // 3. Collapsed it is one named card; expanded the same nodes are back.
  const positionsBefore = Object.fromEntries((await snapshot()).nodes.map((n) => [n.id, JSON.stringify(n.position)]));
  await page.locator(`[data-group-collapse="${group.id}"]`).click();
  await waitFor(async () => (await snapshot()).groups[0]?.collapsed === true, "the group to be collapsed");
  await delay(400);
  check("collapsed, the group is one named card and its members are off the canvas",
    (await page.locator(`[data-group-card="${group.id}"]`).innerText()).includes("先定好片子和吃的")
    && (await chatCards()) === 1 && (await page.locator(`[data-node="${filmId}"]`).count()) === 0,
    JSON.stringify({ chats: await chatCards() }));
  check("collapsing takes nothing away: the sessions are all still there",
    (await idsOn()).length === 3, (await idsOn()).join());
  // A card that is not drawn must not become a place the canvas can send you
  // to. 查找 still finds the chat by its own title, and lands on the group.
  await page.locator("[data-find]").click();
  await page.locator("[data-find-input]").fill("放哪部片");
  await page.locator(`[data-find-hit="${filmId}"]`).waitFor();
  await page.locator(`[data-find-hit="${filmId}"]`).click();
  await delay(900);
  check("a chat inside a collapsed group is still found by its own title, and going to it lands on the group card",
    await page.locator(`[data-group-card="${group.id}"]`).isVisible());
  await page.screenshot({ animations: "disabled", path: join(evidence, "02-group-collapsed.png") });
  await page.locator(`[data-group-card="${group.id}"]`).click();
  await waitFor(async () => (await page.locator(`[data-node="${filmId}"]`).count()) === 1, "the members to come back");
  const positionsAfter = Object.fromEntries((await snapshot()).nodes.map((n) => [n.id, JSON.stringify(n.position)]));
  check("expanding puts the very same nodes back where they were",
    JSON.stringify(positionsBefore) === JSON.stringify(positionsAfter), JSON.stringify(positionsAfter));

  // 4. A manual link between a session and a ticket, with a note.
  const leafBefore = (await nodeOf(roomId)).activeLeafId;
  const ticketBefore = readFileSync(roomTicket, "utf8");
  // Making the group already cleared the picks; these two are a fresh pair.
  await pick(roomId);
  await pick(ticketPath);
  await page.locator("[data-link-note]").fill("客厅这个说法就是从这段聊出来的");
  await page.locator("[data-link-create]").click();
  const link = await waitFor(async () => (await snapshot()).links[0], "the manual link");
  check("a manual link is drawn between the two picked cards, with the note the user wrote",
    link.note === "客厅这个说法就是从这段聊出来的"
    && [link.from, link.to].sort().join() === [roomId, ticketPath].sort().join(),
    JSON.stringify(link));
  check("the note is shown on the canvas",
    (await page.locator(`[data-link="${link.id}"]`).innerText()).includes("客厅这个说法就是从这段聊出来的"));
  // The three kinds of relation look different because they are different: a
  // fork's line comes from Pi's history, a ticket's from `Blocked by:`, and
  // this one from the user having said so.
  check("a manual link is drawn as its own kind of line, not as a fork and not as a dependency",
    (await page.locator(`[data-link-line="${link.id}"].manual`).count()) === 1
    && (await page.locator(".waygoal-links g.waygoal-link.manual").count()) === 1,
    String(await page.locator(".waygoal-links g.waygoal-link.manual").count()));
  check("drawing it sent nothing, moved no leaf and did not touch the tracker file",
    model.requests.length === requestsBefore
    && (await nodeOf(roomId)).activeLeafId === leafBefore
    && readFileSync(roomTicket, "utf8") === ticketBefore,
    JSON.stringify({ leafBefore, now: (await nodeOf(roomId)).activeLeafId }));
  // The ticket's own dependency is read from its source file and is untouched.
  const opening = (await snapshot()).tickets.maps[0].tickets.find((t) => t.title === "开场怎么说");
  check("the ticket's real dependency is unchanged by the manual link",
    opening.blockers.map((b) => b.number).join() === "01" && opening.state === "waiting",
    JSON.stringify(opening.blockers));
  await page.screenshot({ animations: "disabled", path: join(evidence, "03-manual-link.png") });

  // 5. A link touching a card inside a collapsed group must stay readable and
  //    removable: the note on the line is the only place it can be taken away.
  await pick(filmId);
  await pick(roomId);
  await page.locator("[data-link-note]").fill("片子定了才好说场地");
  await page.locator("[data-link-create]").click();
  const inner = await waitFor(async () => (await snapshot()).links.find((l) => l.note === "片子定了才好说场地"), "the second manual link");
  await page.locator(`[data-group-collapse="${group.id}"]`).click();
  await waitFor(async () => (await snapshot()).groups[0]?.collapsed === true, "the group to be collapsed again");
  await delay(500);
  check("a manual link reaching into a collapsed group is drawn to the group card, note and all",
    (await page.locator(`[data-link="${inner.id}"]`).isVisible())
    && (await page.locator(`[data-link-remove="${inner.id}"]`).isVisible())
    && (await page.locator(`[data-link="${inner.id}"]`).innerText()).includes("片子定了才好说场地"));
  await page.locator(`[data-link-remove="${inner.id}"]`).click();
  await waitFor(async () => (await snapshot()).links.length === 1, "the second link to be removed from inside the collapsed group");
  check("and removing it from there takes only that link", (await snapshot()).links[0].id === link.id);
  await page.locator(`[data-group-card="${group.id}"]`).click();
  await waitFor(async () => (await page.locator(`[data-node="${filmId}"]`).count()) === 1, "the members to come back again");

  // 6. Renaming a session leaves the arrangement alone.
  await page.locator(`[data-node="${filmId}"]`).click();
  await page.locator("[data-rename]").click();
  await page.locator("[data-rename-input]").fill("放映会选片");
  await page.locator("[data-rename-save]").click();
  await waitFor(async () => (await nodeOf(filmId)).title === "放映会选片", "the renamed session");
  await closePanel();
  const renamed = await snapshot();
  check("renaming a session breaks neither its group nor its links",
    renamed.groups[0].members.includes(filmId) && renamed.links.length === 1 && renamed.links[0].note === link.note,
    JSON.stringify({ members: renamed.groups[0].members, links: renamed.links }));

  // 7. A host restart: the arrangement is a canvas record, so it comes back.
  restarting = true;
  await stopServer(server);
  server = await startServer();
  const fresh = await openPage();
  await page.close();
  page = fresh;
  await page.goto(`${base}/waygoal?cwd=${encodeURIComponent(work)}`, { waitUntil: "domcontentloaded" });
  await waitFor(async () => (await page.locator(`[data-group="${group.id}"]`).count()) === 1, "the group after the restart");
  restarting = false;
  const back = await snapshot();
  check("after a restart the group name, its members and its layout are all back",
    back.groups[0].name === "先定好片子和吃的"
    && back.groups[0].members.slice().sort().join() === [filmId, snackId].sort().join()
    && JSON.stringify(Object.fromEntries(back.nodes.map((n) => [n.id, JSON.stringify(n.position)]))) === JSON.stringify(positionsAfter),
    JSON.stringify(back.groups));
  check("and the manual link is back with its note",
    back.links.length === 1 && back.links[0].note === "客厅这个说法就是从这段聊出来的", JSON.stringify(back.links));
  check("the restart replayed no command", model.requests.length === requestsBefore, String(model.requests.length - requestsBefore));
  await page.screenshot({ animations: "disabled", path: join(evidence, "04-after-restart.png") });

  // 8. Taking either one away takes only itself away.
  await page.locator(`[data-link-remove="${link.id}"]`).click();
  await waitFor(async () => (await snapshot()).links.length === 0, "the link to be removed");
  await waitFor(async () => (await page.locator(".waygoal-links g.waygoal-link.manual").count()) === 0, "the line to go with it");
  check("removing a manual link removes the line and nothing else",
    (await idsOn()).length === 3 && (await nodeOf(roomId)).activeLeafId === leafBefore,
    JSON.stringify({ sessions: await idsOn(), leafBefore, now: (await nodeOf(roomId)).activeLeafId }));
  await page.locator(`[data-group-remove="${group.id}"]`).click();
  await waitFor(async () => (await snapshot()).groups.length === 0, "the group to be dissolved");
  check("dissolving a group leaves every session in it exactly as it was",
    (await idsOn()).length === 3 && (await chatCards()) === 3
    && (await nodeOf(filmId)).title === "放映会选片",
    JSON.stringify(await idsOn()));

  check("no page or console errors", errors.length === 0, errors.join("\n"));
  await context.close();

  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks }, null, 2));
  console.log(`\nAll ${checks.length} checks passed. Evidence: ${evidence}`);
} catch (error) {
  process.exitCode = 1;
  await page?.screenshot({ path: join(artifacts, "waygoal-groups-failure.png"), fullPage: false }).catch(() => {});
  writeFileSync(join(evidence, "checks.json"), JSON.stringify({ ranAt: new Date().toISOString(), checks, failure: String(error?.stack ?? error) }, null, 2));
  writeFileSync(join(artifacts, "waygoal-groups-model-requests.json"), JSON.stringify(model.requests, null, 2));
  console.error(error);
} finally {
  await browser?.close().catch(() => {});
  await stopServer(server);
  await Promise.race([model.close(), delay(5000)]);
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
}
