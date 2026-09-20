// Run in an isolated checkout. No production mocks: real Pi forks, controlled model.
// WAYGOAL_REVIEW_CASE=locate|focus|fork-leave|fork-retry|fork-open; unset runs serially.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { modelsJson, startFakeModel } from "./fake-model.mjs";
import { evidenceDirectory } from "./waygoal-artifacts.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cases = ["locate", "focus", "fork-leave", "fork-retry", "fork-open"];
const chosen = process.env.WAYGOAL_REVIEW_CASE;
assert.ok(!chosen || cases.includes(chosen), `Unknown WAYGOAL_REVIEW_CASE: ${chosen}`);
async function waitFor(predicate, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  for (;;) { const value = await predicate(); if (value) return value; assert.ok(Date.now() < deadline, `Timed out: ${label}`); await delay(100); }
}
async function run(name) {
  assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use an isolated checkout without an active Next server");
  const evidence = evidenceDirectory(`review-${name}`); mkdirSync(evidence, { recursive: true });
  const log = createWriteStream(join(evidence, "server.log"));
  const agentDir = mkdtempSync(join(tmpdir(), `waygoal-review-${name}-`)), workspace = join(agentDir, "workspace");
  mkdirSync(workspace);
  const checks = [], commands = [], errors = [], injections = [], releases = [], pending = new Set();
  let model, server, browser, page, failure, base, canvas;
  const check = (label, ok, detail) => { checks.push({ label, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}: ${name}: ${label}`); };
  const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); releases.push(release); return { promise, release }; };
  const interrupt = () => { process.exitCode = 1; releases.forEach(release => release()); server?.kill("SIGTERM"); void browser?.close().catch(() => {}); };
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  async function api(path, body, method = "POST") {
    const response = await fetch(`${base}${path}`, { ...(body ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) });
    assert.ok(response.ok, `${path}: ${response.status}`); return response.json();
  }
  const snapshot = (id = canvas) => api(`/api/waygoal?${new URLSearchParams({ cwd: workspace, ...(id ? { canvas: id } : {}), force: "1" })}`);
  const turns = id => api(`/api/waygoal/session/${id}/turns`);
  const answered = (id, question) => waitFor(async () => (await turns(id)).turns.find(turn => turn.question === question && turn.answer), question);
  async function seed(question) {
    const { sessionId: id } = await api("/api/agent/new", { cwd: workspace, type: "prompt", message: question, provider: "e2e", modelId: "e2e-model" });
    const turn = await answered(id, question);
    await waitFor(async () => !(await snapshot()).nodes.some(node => node.running), "seed snapshot running=false");
    return { id, turn };
  }
  // Wait beyond response delivery for React effects, subsequent landing requests,
  // and camera animations; exclude long-lived agent event streams from pending.
  async function settle() {
    await delay(400);
    let quietSince = Date.now();
    await waitFor(() => { if (pending.size) quietSince = Date.now(); return Date.now() - quietSince > 400; }, "UI requests settled");
    await delay(300);
  }
  try {
    model = await startFakeModel({ reply: "review回复" });
    writeFileSync(join(agentDir, "models.json"), modelsJson(model.baseUrl));
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "e2e", defaultModel: "e2e-model" }));
    const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
    base = `http://127.0.0.1:${probe.address().port}`; await new Promise(resolve => probe.close(resolve));
    server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", new URL(base).port], {
      cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WAYGOAL: "1", PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
    });
    server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
    // Cold compilation is the only long startup allowance; actions/API calls use 10s.
    await waitFor(async () => {
      assert.equal(server.exitCode, null, "server exited; see server.log");
      return fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}`, { signal: AbortSignal.timeout(5000) }).then(r => r.ok).catch(() => false);
    }, "server ready", 120_000);
    canvas = (await snapshot()).workspace.canvasId;
    const sources = name === "locate" || name === "focus" ? [await seed("外部来源甲"), await seed("外部来源乙")] : [];
    const target = await seed("当前回答用于选文探索");
    let second, other;
    if (name === "fork-leave") {
      second = (await api("/api/waygoal", { cwd: workspace, name: "Review 第二画布" })).canvas;
      other = await seed("第二画布独立会话");
      await api("/api/waygoal", { cwd: workspace, canvas: second.id, registerSession: other.id, lastViewed: other.id }, "PATCH");
    }
    await api("/api/waygoal", { cwd: workspace, canvas, lastViewed: target.id, expandedSessions: [target.id] }, "PATCH");
    browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "en-US" });
    page.setDefaultTimeout(10_000); page.setDefaultNavigationTimeout(10_000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/waygoal") || (url.pathname.startsWith("/api/agent/") && request.method() === "POST")) pending.add(request);
      if (request.method() === "POST" && url.pathname.startsWith("/api/agent/")) commands.push({ url: request.url(), ...request.postDataJSON() });
    });
    page.on("requestfinished", request => pending.delete(request)); page.on("requestfailed", request => pending.delete(request));
    const panel = page.locator(".waygoal-panel"), composer = panel.locator("textarea").first();
    const dialog = page.getByRole("dialog", { name: "分叉探索", exact: true }), input = dialog.locator("textarea");
    const rows = page.getByLabel("下一轮引用材料", { exact: true }).locator("[data-material-key]");
    const action = label => page.getByRole("button", { name: label, exact: true });
    const send = () => dialog.getByRole("button", { name: "Send", exact: true }).click();
    const world = page.locator(".waygoal-world"), camera = () => world.evaluate(el => getComputedStyle(el).transform);
    const draft = "主草稿应完整保留", question = "review独立探索问题";
    async function browse(id) {
      const more = page.locator(".waygoal-turn-more");
      if (!await more.evaluate(el => el.open)) await more.locator("summary").click();
      await page.getByRole("combobox", { name: "查看会话轮次" }).selectOption(id);
      if (await more.evaluate(el => el.open)) await more.locator("summary").click();
    }
    async function selectSources() {
      for (const source of sources) await browse(source.id);
      await action("全景").click();
      for (const source of sources) await page.locator(`[data-turn="${source.turn.id}"] .waygoal-turn-content`).click({ modifiers: ["ControlOrMeta"] });
      await page.getByRole("combobox", { name: "综合材料范围", exact: true }).selectOption("answer");
      await waitFor(() => action("加入材料，继续综合").isEnabled(), "material selection enabled");
    }
    async function openDialog() {
      const answer = panel.locator(`[data-entry-id="${target.turn.endId}"]`).first();
      await answer.scrollIntoViewIfNeeded();
      await answer.evaluate(el => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let text; while ((text = walker.nextNode())) if (text.textContent.includes("review回复")) break;
        if (!text) throw new Error("Saved assistant text missing");
        const range = document.createRange(); range.selectNodeContents(text);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        text.parentElement.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      });
      await page.getByRole("toolbar").getByRole("button", { name: "分叉探索", exact: true }).click();
      await input.fill(question);
    }
    async function switchCanvas(id) {
      const menu = page.locator(".waygoal-workspace-menu");
      if (!await menu.evaluate(el => el.open)) await menu.locator("summary").click();
      await menu.locator(`[data-canvas="${id}"]`).click();
      await waitFor(() => new URL(page.url()).searchParams.get("canvas") === id, "canvas URL switched");
      await composer.waitFor();
    }
    await page.goto(`${base}/waygoal?${new URLSearchParams({ cwd: workspace, canvas })}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await waitFor(async () => await panel.getAttribute("data-session-id") === target.id, "target opened");
    await composer.fill(draft); await settle();
    const initialIds = new Set((await snapshot()).workspace.sessions.map(session => session.id));
    const forks = async () => (await snapshot()).workspace.sessions.filter(session => !initialIds.has(session.id));
    if (name === "locate") {
      await selectSources(); await action("加入材料，继续综合").click();
      await waitFor(async () => await rows.count() === 2, "external materials in current session");
      const held = gate(); let armed = false, used = false, captured = false, completed = false, passes = 0;
      // Keep the route installed for EVERY request. Polling of this exact URL
      // must continue; only the first GET after the tray click consumes the gate.
      await page.route(`**/api/waygoal/session/${sources[0].id}/turns`, async route => {
        passes++;
        if (!armed || used || route.request().method() !== "GET") return route.continue();
        used = true;
        const response = await route.fetch({ timeout: 10_000 }); assert.ok(response.ok()); captured = true;
        injections.push({ kind: "locate-after-fetch", status: response.status() });
        await held.promise;
        await route.fulfill({ response }).catch(() => {}); completed = true;
      });
      await rows.first().getByRole("button", { name: "查看来源", exact: true }).click({ trial: true });
      armed = true; await rows.first().getByRole("button", { name: "查看来源", exact: true }).click();
      await waitFor(() => captured, "source response held");
      const viewport = page.locator(".waygoal-viewport");
      const before = await camera(); await viewport.focus(); await viewport.press("Shift+ArrowRight"); await delay(350);
      const moved = await camera(); assert.notEqual(moved, before, "keyboard actually moved camera");
      assert.equal(await page.locator(".waygoal-canvas-preview").count(), 0, "no source preview before release");
      held.release(); await waitFor(() => completed, "held source delivered or aborted"); await settle();
      check("late source cannot reopen preview", await page.locator(".waygoal-canvas-preview").count() === 0);
      check("late source cannot pull camera back", await camera() === moved, { before, moved, after: await camera(), passes });
      check("locate preserves current session and draft", await panel.getAttribute("data-session-id") === target.id && await composer.inputValue() === draft);
    } else if (name === "focus") {
      await selectSources(); const held = gate(); let captured = 0, completed = 0;
      await page.route("**/materials?**", async route => {
        const response = await route.fetch({ timeout: 10_000 }); assert.ok(response.ok()); captured++;
        injections.push({ kind: "materials-after-fetch", url: route.request().url(), status: response.status() });
        await held.promise; await route.fulfill({ response }).catch(() => {}); completed++;
      });
      await action("加入材料，继续综合").click(); await waitFor(() => captured === 2, "both material responses held");
      await openDialog(); await input.focus(); await page.keyboard.type("-before");
      const original = await input.inputValue(); assert.equal(original, `${question}-before`);
      held.release(); await waitFor(() => completed === 2, "both material responses released");
      await waitFor(async () => await rows.count() === 2, "material arrival rendered"); await settle();
      // Probe FIRST, without clicking/focusing/filling a textarea after release.
      await page.keyboard.type("-probe");
      check("dialog retains focus", await input.evaluate(el => el === document.activeElement));
      check("typing continues original dialog text", await input.inputValue() === `${original}-probe`, { actual: await input.inputValue() });
      check("material arrival never writes the main draft", await composer.inputValue() === draft, { actual: await composer.inputValue() });
    } else {
      await openDialog(); const held = gate(); let forkId, captured = false, completed = false, rejectLanding = false, rejected = 0;
      let landingHeld = false, landingCompleted = false, landingUsed = false;
      await page.route("**/api/agent/*", async route => {
        if (route.request().method() !== "POST" || route.request().postDataJSON()?.type !== "fork_branch") return route.continue();
        const response = await route.fetch({ timeout: 10_000 }); assert.ok(response.ok());
        forkId = (await response.json()).data.newSessionId; assert.ok(forkId);
        injections.push({ kind: "real-fork-after-fetch", forkId, status: response.status() });
        captured = true; if (name === "fork-leave") await held.promise; else if (name === "fork-retry") rejectLanding = true;
        await route.fulfill({ response }).catch(() => {}); completed = true;
      });
      // PATCH currently returns false instead of throwing; fail the force read
      // so landOnFork really rejects, rather than testing a prompt rejection.
      const canvasRoute = /\/api\/waygoal(?:\?.*)?$/;
      await page.route(canvasRoute, async route => {
        const request = route.request();
        if (name === "fork-open" && !landingUsed && forkId && request.method() === "PATCH") {
          const body = request.postDataJSON();
          if (body?.lastViewed === forkId && !body.registerSession) {
            // Registration and the force GET must reach the browser first:
            // the published snapshot makes this known fork manually openable.
            landingUsed = true;
            const response = await route.fetch({ timeout: 10_000 }); assert.ok(response.ok());
            injections.push({ kind: "landing-last-viewed-after-fetch", forkId, status: response.status() });
            landingHeld = true;
            await held.promise;
            await route.fulfill({ response }).catch(() => {}); landingCompleted = true;
            return;
          }
        }
        if (!rejectLanding || route.request().method() !== "GET" || new URL(route.request().url()).searchParams.get("force") !== "1") return route.continue();
        rejected++; injections.push({ kind: "landing-force-snapshot-503" });
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "review landing snapshot failed" }) });
      });
      await send(); await waitFor(() => captured, "real fork created before response");
      assert.equal((await forks()).length, 1, "first request created exactly one real session");
      if (name === "fork-leave") {
        await switchCanvas(second.id);
        await waitFor(async () => await panel.getAttribute("data-session-id") === other.id, "second canvas conversation opened");
        check("departed fork does not disable the new composer", await composer.evaluate(el => !el.closest("[inert]")));
        await composer.fill("第二画布草稿");
        await delay(200);
        assert.equal(await composer.inputValue(), "第二画布草稿", "second-canvas draft is stable before the fork response");
        held.release(); await waitFor(() => completed, "fork response delivered"); await settle();
        const title = await page.locator(".waygoal-workspace-menu > summary").innerText();
        check("late fork leaves URL on new canvas", new URL(page.url()).searchParams.get("canvas") === second.id, { url: page.url() });
        check("late fork leaves canvas title", title.includes(second.name), { title });
        check("late fork leaves right conversation and draft", await panel.getAttribute("data-session-id") === other.id && await composer.inputValue() === "第二画布草稿", { expectedSession: other.id, actualSession: await panel.getAttribute("data-session-id"), draft: await composer.inputValue() });
        check("departure never auto-sends exploration", !commands.some(c => c.type === "prompt" && c.url.endsWith(`/${forkId}`)) && !(await turns(forkId)).turns.some(t => t.question === question));
        check("old canvas retains real fork", (await snapshot()).nodes.some(node => node.id === forkId));
        await switchCanvas(canvas);
        // Real keyboard activation avoids relying on the departed camera's pan.
        await page.locator(`[data-node="${forkId}"]`).focus(); await page.keyboard.press("Enter");
        await waitFor(async () => await panel.getAttribute("data-session-id") === forkId, "return to retained fork");
        check("unsent exploration draft is recoverable", await composer.inputValue() === question, { actual: await composer.inputValue() });
        await page.locator(`[data-node="${target.id}"]`).focus(); await page.keyboard.press("Enter");
        await waitFor(async () => await panel.getAttribute("data-session-id") === target.id, "return to original discussion");
        check("original discussion draft survives departure", await composer.inputValue() === draft);
      } else if (name === "fork-open") {
        await waitFor(() => completed && landingHeld, "fork response delivered and landing PATCH held");
        // Expanded sessions may expose turns rather than a session card.
        // Collapse via its keyboard control before activating the fork node.
        const collapse = page.locator(`[data-collapse-session="${forkId}"]`);
        if (await collapse.count()) { await collapse.focus(); await page.keyboard.press("Enter"); }
        const node = page.locator(`[data-node="${forkId}"]`);
        await node.waitFor(); await node.focus(); await page.keyboard.press("Enter");
        await waitFor(async () => await panel.getAttribute("data-session-id") === forkId, "manually opened known fork during landing");
        assert.equal(landingCompleted, false, "landing is still held during manual open");
        check("manual fork open does not disable composer", await composer.evaluate(el => !el.closest("[inert]")));
        const newDraft = "另写的草稿";
        await composer.fill(newDraft); await delay(200);
        assert.equal(await composer.inputValue(), newDraft, "manual fork draft is stable before landing release");
        held.release(); await waitFor(() => landingCompleted, "landing PATCH delivered"); await settle();
        const actual = await composer.inputValue(), created = await forks();
        check("late landing keeps manually opened fork", await panel.getAttribute("data-session-id") === forkId);
        check("late landing preserves exploration question and new draft", actual.includes(question) && actual.includes(newDraft), { actual, question, newDraft });
        check("manual open never auto-sends exploration", !commands.some(c => c.type === "prompt") && !(await turns(forkId)).turns.some(t => t.question === question));
        check("manual open performs only one fork_branch", commands.filter(c => c.type === "fork_branch").length === 1);
        check("manual open leaves only the known fork", created.length === 1 && created[0].id === forkId, { created, forkId });
      } else {
        await dialog.getByRole("alert").waitFor();
        assert.ok(rejected > 0, "landing fault was exercised");
        check("first landing failure keeps exploration text", await input.inputValue() === question);
        check("no prompt before successful landing", !commands.some(c => c.type === "prompt"));
        rejectLanding = false; await page.unroute(canvasRoute);
        await waitFor(() => dialog.getByRole("button", { name: "Send", exact: true }).isEnabled(), "retry enabled");
        await send();
        await waitFor(() => commands.some(c => c.type === "prompt" && c.message === question), "retry really sends question"); await settle();
        const created = await forks();
        check("retry performs only one fork_branch", commands.filter(c => c.type === "fork_branch").length === 1);
        check("retry leaves only one new Pi session", created.length === 1, { created });
        const sent = commands.find(c => c.type === "prompt" && c.message === question);
        await answered(sent.url.split("/").at(-1), question);
        check("retry sends on the original retained fork", sent.url.endsWith(`/${injections.find(i => i.kind === "real-fork-after-fetch").forkId}`));
      }
    }
    check("no browser errors", errors.length === 0, errors);
    assert.ok(checks.every(item => item.ok), `Review regression: ${checks.filter(item => !item.ok).map(item => item.label).join("; ")}`);
  } catch (error) {
    failure = error.stack || String(error);
    await page?.screenshot({ path: join(evidence, "failure.png"), timeout: 10_000 }).catch(() => {});
    throw error;
  } finally {
    releases.forEach(release => release());
    writeFileSync(join(evidence, "checks.json"), JSON.stringify({ case: name, checks, injections, commands, errors, failure }, null, 2));
    await page?.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
    await browser?.close().catch(() => {});
    if (server && server.exitCode === null) {
      const exited = once(server, "exit"); server.kill("SIGTERM");
      const timer = setTimeout(() => server.kill("SIGKILL"), 5000); await exited; clearTimeout(timer);
    }
    if (model) await Promise.race([model.close(), delay(5000)]);
    log.end(); rmSync(agentDir, { recursive: true, force: true });
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  }
}
for (const name of chosen ? [chosen] : cases) {
  try { await run(name); } catch (error) { console.error(`[review-${name}]`, error); process.exitCode = 1; }
}
