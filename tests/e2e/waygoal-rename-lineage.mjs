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

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const evidence = evidenceDirectory("rename-lineage");
mkdirSync(evidence, { recursive: true });
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const serverLog = createWriteStream(join(artifacts, "waygoal-rename-lineage-server.log"));

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
    assert.equal(child.exitCode, null, "Server exited before readiness; see waygoal-rename-lineage-server.log");
    const response = await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(workspace)}&force=1`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) return child;
    assert.ok(Date.now() < deadline, "Server readiness timed out; see waygoal-rename-lineage-server.log");
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

// The fixed source boundary is a name entry, not a visible message.
records.push({type:'session_info',id:'name0000',parentId:records.at(-1).id,timestamp,name:'Original'});
writeFileSync(join(fixtureDirectory, `fixture_${fixtureId}.jsonl`),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
rmSync(join(fixtureDirectory, `fixture_${siblingId}.jsonl`));
try {
  server = await startServer();
  const patch = async value => { const response = await fetch(`${base}/api/waygoal`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({cwd:workspace,canvas:'main',...value})}); assert.ok(response.ok); };
  const fork = async operationId => {
    const response=await fetch(`${base}/api/agent/${fixtureId}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'fork_branch',entryId:'name0000',operationId,waygoal:{cwd:workspace,canvasId:'main'}})});
    const body=await response.json();assert.ok(response.ok,JSON.stringify(body));return body.data.newSessionId;
  };
  const left=await fork('rename-left'), right=await fork('rename-right');
  check('HTTP retry returns the same committed child',await fork('rename-left')===left);
  await patch({expandedSessions:[fixtureId,left,right],positions:{[fixtureId]:{x:0,y:0},[left]:{x:324,y:312},[right]:{x:648,y:312}},view:{x:50,y:90,scale:1}});
  browser=await chromium.launch().catch(()=>chromium.launch({channel:'chrome'}));
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  let page=await context.newPage();page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(canvasUrl);
  await waitFor(async()=>await page.locator('[data-turn]').count()===2,'shared cards');
  await page.locator(`[data-node="${fixtureId}"]`).click();
  await page.locator('.waygoal-panel textarea').first().fill('未发送的草稿');
  const world=()=>page.locator('[data-turn-key]').evaluateAll(elements=>elements.map(el=>({key:el.dataset.turnKey,x:el.style.left,y:el.style.top})).sort((a,b)=>a.key.localeCompare(b.key)));
  const before=await world();
  const facts=(value)=>value.nodes.map(n=>({id:n.id,origin:n.origin&&{sessionId:n.origin.sessionId,entryId:n.origin.entryId},position:n.position})).sort((a,b)=>a.id.localeCompare(b.id));
  const saved=facts(await snapshot());
  const original=sessionEntries(fixtureId).filter(e=>e.type==='message');
  for(let i=0;i<20;i++) {
    if(!await page.locator('.waygoal-chat-settings').evaluate(e=>e.open)) await page.locator('.waygoal-chat-settings > summary').click();
    await page.locator('[data-rename]').click();
    await page.locator('[data-rename-input]').fill(`新名字 ${i}`);
    await page.locator('[data-rename-save]').click();
    await waitFor(async()=>(await snapshot()).nodes.find(n=>n.id===fixtureId)?.title===`新名字 ${i}`,'renamed title');
  }
  await page.waitForResponse(r=>r.url().includes(`/session/${fixtureId}/turns`)&&(r.ok()||r.status()===304));
  check('20 real UI renames keep all card world positions',JSON.stringify(await world())===JSON.stringify(before));
  check('20 renames keep origins and saved positions',JSON.stringify(facts(await snapshot()))===JSON.stringify(saved));
  check('two empty branches remain attached to the original source',await page.locator('.waygoal-turn-lines path.fork').count()===2);
  check('renaming preserves content history and the draft',JSON.stringify(sessionEntries(fixtureId).filter(e=>e.type==='message'))===JSON.stringify(original)&&await page.locator('.waygoal-panel textarea').first().inputValue()==='未发送的草稿');
  await page.waitForResponse(r=>r.url().includes(`/session/${fixtureId}/turns`)&&r.status()===304);
  check('idle history polling reuses the existing cards',JSON.stringify(await world())===JSON.stringify(before));
  await page.reload();await waitFor(async()=>await page.locator('[data-turn]').count()===2,'reload');
  check('reload preserves world coordinates',JSON.stringify(await world())===JSON.stringify(before));
  await page.screenshot({path:join(evidence,'rename-stable.png')});
  await page.close();
  await stopServer(server);server=await startServer();
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(canvasUrl);await waitFor(async()=>await page.locator('[data-turn]').count()===2,'restart');
  check('server restart preserves lineage and coordinates',JSON.stringify(await world())===JSON.stringify(before)&&JSON.stringify(facts(await snapshot()))===JSON.stringify(saved));
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
