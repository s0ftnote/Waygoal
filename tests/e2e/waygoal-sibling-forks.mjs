import { evidenceDirectory } from "./waygoal-artifacts.mjs";
// Continuous-chat acceptance against an isolated, real Pi SDK host and a
// controlled model. Source identities and ancestry are checked in Pi files.
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const { writeOrigin } = await createJiti(import.meta.url).import("../../src/server/sessions/lineage.ts");
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

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const evidence = evidenceDirectory("sibling-forks");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-sibling-forks-server.log"));

const agentDir = mkdtempSync(join(tmpdir(), "waygoal-sibling-e2e-"));
const workspace = join(agentDir, "workspace");
mkdirSync(workspace);
const model = await startFakeModel({ reply: "回复" });
writeFileSync(join(agentDir, "models.json"), modelsJson(model.baseUrl));
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "e2e", defaultModel: "e2e-model" }));

const fixtureId = "44444444-4444-4444-8444-444444444444";
const fixtureDirectory = join(agentDir, "sessions", "--fixture--");
mkdirSync(fixtureDirectory, { recursive: true });
const timestamp = new Date().toISOString();
const records = [{ type: "session", version: 3, id: fixtureId, cwd: workspace, timestamp }];
let parentId = null;
const texts = ['设备同时离线，先确认影响范围', '先确认网关和受影响设备，再查看消息链路。', '网关在线，接下来验证消息链路', '网关正常。消息是否到达设备尚未确认，需要继续查看日志。'];
for (const [index, text] of texts.entries()) {
  const entryId = (index + 1).toString(16).padStart(8, '0');
  const role = index % 2 ? 'assistant' : 'user';
  records.push({ type: 'message', id: entryId, parentId, timestamp, message: { role, content: [{ type: 'text', text }], timestamp: Date.now(), ...(role === 'assistant' ? { api: 'openai-completions', provider: 'e2e', model: 'e2e-model', stopReason: 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } : {}) } });
  parentId = entryId;
}
writeFileSync(join(fixtureDirectory, `fixture_${fixtureId}.jsonl`), records.map(record => JSON.stringify(record)).join('\n') + '\n');
const siblingId = "55555555-5555-4555-8555-555555555555";
writeFileSync(join(fixtureDirectory, `fixture_${siblingId}.jsonl`), [{...records[0], id:siblingId},...records.slice(1)].map(r=>JSON.stringify(r)).join('\n')+'\n');
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
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-sibling-forks-server.log");
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-sibling-forks-server.log");
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

try {
  server = await startServer();
  const patch = async value => { const response = await fetch(`${base}/api/waygoal`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({cwd:workspace,canvas:'main',...value})}); assert.ok(response.ok); };
  // Known durable provenance remains valid when the parent is no longer available.
  // Unverifiable legacy pointers are covered separately by the migration suite.
  for (const id of [fixtureId,siblingId]) writeOrigin({version:1,childSessionId:id,parentSessionId:'absent-source',selectedEntryId:records.at(-1).id,mode:'after',inheritedThroughEntryId:records.at(-1).id,operationId:`fixture:${id}`,createdAt:timestamp},agentDir);
  await patch({expandedSessions:[fixtureId,siblingId],positions:{[fixtureId]:{x:0,y:0},[siblingId]:{x:350,y:260}},view:{x:50,y:90,scale:1}});
  browser = await chromium.launch().catch(() => chromium.launch({channel:'chrome'}));
  const page = await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(canvasUrl);
  await waitFor(async()=>await page.locator('[data-turn]').count()===2,'one shared prefix');
  check('siblings retain one shared history without importing the absent source',await page.locator('[data-node]').count()===2);
  check('fresh sibling links to the exact last shared turn',await page.locator('.waygoal-turn-lines path.fork').count()===1);
  await page.locator(`[data-node="${siblingId}"]`).click();
  const composer=page.locator('.waygoal-panel textarea').first(); await composer.waitFor();await composer.fill('原分支的草稿');
  const original=sessionEntries(siblingId).filter(e=>e.type==='message');
  // The development indicator occupies this corner; use the keyboard path.
  await page.getByRole('button',{name:'当前轮次',exact:true}).focus();
  await page.keyboard.press('Enter');
  await page.locator('.waygoal-turn-card.active .waygoal-turn-content').click();
  await page.getByRole('group',{name:'所选卡片操作'}).getByRole('button',{name:'从这里分叉',exact:true}).click();
  const forkId=await waitFor(async()=> (await snapshot()).nodes.find(n=>![fixtureId,siblingId].includes(n.id))?.id,'new fork from the shared turn');
  await page.locator(`.waygoal-panel[data-session-id="${forkId}"][aria-busy="false"] textarea`).waitFor();
  const copied=sessionEntries(forkId).filter(e=>e.type==='message');
  check('card fork includes the chosen answer with no later history',JSON.stringify(copied.map(e=>e.id))===JSON.stringify(records.slice(1).map(e=>e.id)));
  check('the actual source session remains intact',JSON.stringify(original)===JSON.stringify(sessionEntries(siblingId).filter(e=>e.type==='message')));
  check('the new branch records the chosen member and message', (await snapshot()).nodes.find(n=>n.id===forkId).origin.sessionId===siblingId && (await snapshot()).nodes.find(n=>n.id===forkId).origin.entryId===records.at(-1).id);
  await waitFor(async()=>await page.locator('.waygoal-turn-lines path.fork').count()===2,'empty fork endpoint');
  await page.screenshot({path:join(evidence,'shared-history-and-fork.png')});
  // User-message and assistant-message fork buttons have the same inclusive
  // boundary. Editing is a separate action and must not prefill this fork.
  const sourceMessage=page.locator(`.waygoal-panel [data-entry-id="${records[3].id}"]`).first();
  await sourceMessage.getByText(texts[2],{exact:true}).hover();
  await sourceMessage.getByRole('button',{name:'从这里分叉',exact:true}).click();
  const userForkId=await waitFor(async()=> (await snapshot()).nodes.find(n=>![fixtureId,siblingId,forkId].includes(n.id))?.id,'user-message fork');
  await page.locator(`.waygoal-panel[data-session-id="${userForkId}"][aria-busy="false"] textarea`).waitFor();
  check('user-message fork includes that message and excludes its later answer',JSON.stringify(sessionEntries(userForkId).filter(e=>e.type==='message').map(e=>e.id))===JSON.stringify(records.slice(1,4).map(e=>e.id)));
  check('forking does not resend or prefill the source question',model.requests.length===0&&await composer.inputValue()==='');
  check('no runtime errors',errors.length===0,errors.join('\n'));
  writeFileSync(join(evidence,'checks.json'),JSON.stringify(checks,null,2));
} catch (error) {
  for (const context of browser?.contexts() ?? []) for (const page of context.pages()) await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close().catch(() => {});
  await stopServer(server);
  await Promise.race([model.close(), delay(5000)]);
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
}
