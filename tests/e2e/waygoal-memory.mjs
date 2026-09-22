// Repeatable memory profile with synthetic Pi history, a production Next server,
// and forced-GC samples. No real account, model request, or user history is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { modelsJson, startFakeModel } from './fake-model.mjs';
import { openOverview, evidenceDirectory } from './waygoal-artifacts.mjs';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const output = evidenceDirectory('memory');
mkdirSync(output, {recursive:true});
const count = Number(process.env.WAYGOAL_MEMORY_SESSIONS ?? 8);
const turns = Number(process.env.WAYGOAL_MEMORY_TURNS ?? 200);
const agentDir = mkdtempSync(join(tmpdir(), 'waygoal-memory-'));
const cwd = join(agentDir,'workspace');
mkdirSync(cwd);
const folder = join(agentDir,'sessions','fixtures');
mkdirSync(folder,{recursive:true});
const ids = [];
const timestamp = new Date().toISOString();
for(let n=0;n<count;n++) {
  const id = `33333333-3333-4333-8333-${String(n+1).padStart(12,'0')}`;
  ids.push(id);
  let parentId=null, seq=0;
  const entries=[{type:'session',version:3,id,cwd,timestamp}];
  const append=message=>{
    const entryId=(++seq).toString(16).padStart(8,'0');
    entries.push({type:'message',id:entryId,parentId,timestamp,message:{...message,timestamp:Date.now()}});
    parentId=entryId;
  };
  for(let t=0;t<turns;t++) {
    append({role:'user',content:[{type:'text',text:`会话 ${n+1} 问题 ${t+1}：请分析这段结果。`}]});
    append({role:'assistant',content:[{type:'toolCall',id:`tool-${t}`,name:'read',arguments:{path:`/sample/${n}/${t}.txt`}}],api:'openai-completions',provider:'e2e',model:'e2e-model',stopReason:'toolUse'});
    append({role:'toolResult',toolCallId:`tool-${t}`,toolName:'read',content:[{type:'text',text:`工具结果 ${n}/${t}\n`+'sample input data; '.repeat(700)}],isError:false});
    append({role:'assistant',content:[{type:'text',text:`## 结论 ${t+1}\n\n`+'这是保留在历史里的分析说明，供之后回看和继续讨论。'.repeat(60)}],api:'openai-completions',provider:'e2e',model:'e2e-model',stopReason:'stop'});
  }
  entries.push({type:'session_info',id:'name0001',parentId,timestamp,name:`性能会话 ${n+1}`});
  writeFileSync(join(folder,`fixture_${id}.jsonl`),entries.map(e=>JSON.stringify(e)).join('\n')+'\n');
}
const model=await startFakeModel({reply:'unused'});
writeFileSync(join(agentDir,'models.json'),modelsJson(model.baseUrl));
writeFileSync(join(agentDir,'settings.json'),JSON.stringify({defaultProvider:'e2e',defaultModel:'e2e-model'}));
const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
const port=listener.address().port;await new Promise(r=>listener.close(r));
const base=`http://127.0.0.1:${port}`;
let logs='', inspectorUrl;
const server=spawn(process.execPath,['--inspect=0',join(root,'node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p',String(port)],{
  cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,WAYGOAL:'1',PI_CODING_AGENT_DIR:agentDir,PI_WEB_PASSWORD:'',NEXT_TELEMETRY_DISABLED:'1'},
});
const capture=chunk=>{logs+=chunk;const match=logs.match(/Debugger listening on (ws:\/\/[^\s]+)/);if(match)inspectorUrl=match[1];};
server.stdout.on('data',capture);server.stderr.on('data',capture);
let browser, socket;
const samples=[];
try {
  for(let attempt=0;;attempt++) {
    assert.equal(server.exitCode,null,'production server exited');
    const res=await fetch(`${base}/api/waygoal?cwd=${encodeURIComponent(cwd)}&force=1`).catch(()=>null);
    if(res?.ok)break;
    assert.ok(attempt<120,'server readiness timeout');await delay(250);
  }
  socket=new WebSocket(inspectorUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  const pending=new Map();let serial=0;
  socket.onmessage=event=>{const value=JSON.parse(event.data);if(value.id){const p=pending.get(value.id);pending.delete(value.id);if(value.error)p.reject(value.error);else p.resolve(value.result);}};
  const serverCdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  browser=await chromium.launch().catch(()=>chromium.launch({channel:'chrome'}));
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage();page.setDefaultTimeout(45_000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
  const sample=async name=>{
    await delay(800);await cdp.send('HeapProfiler.collectGarbage');await serverCdp('HeapProfiler.collectGarbage');
    const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    const usage=await serverCdp('Runtime.evaluate',{expression:'process.memoryUsage()',returnByValue:true});
    const value={name,browserHeapMB:Math.round(metrics.JSHeapUsedSize/10485.76)/100,domNodes:metrics.Nodes,listeners:metrics.JSEventListeners,server:usage.result.value,turnCards:await page.locator('[data-turn]').count(),messages:await page.locator('.chat-entry').count()};
    samples.push(value);console.log(JSON.stringify(value));
  };
  await page.goto(`${base}/waygoal?cwd=${encodeURIComponent(cwd)}`);await openOverview(page);
  await sample('overview');
  for(const [index,id] of ids.entries()) {
    await page.locator(`[data-node="${id}"]`).evaluate(el=>el.click());
    await page.locator('.waygoal-panel textarea').first().waitFor();
    await page.locator('.waygoal-panel .chat-entry').first().waitFor();
    await sample(`open-${index+1}`);
    await page.getByRole('button',{name:'关闭面板',exact:true}).click();
  }
  await sample('closed');
  const outside = await page.locator('[data-turn]').evaluateAll(els => {
    const view=document.querySelector('.waygoal-viewport').getBoundingClientRect();
    return els.filter(el=>{const b=el.getBoundingClientRect();return b.right<view.left-800 || b.left>view.right+800 || b.bottom<view.top-800 || b.top>view.bottom+800;}).length;
  });
  console.log(JSON.stringify({offscreenCards:outside}));
  // Camera navigation must remount history without shrinking the actual scene.
  await page.locator('.waygoal-thumb-heading').click();
  assert.equal(await page.locator('.waygoal-thumb-card').count(), count*(turns+1), 'thumbnail retains every turn and session');
  const mounted=()=>page.locator('[data-turn-key]').evaluateAll(els=>els.map(el=>el.dataset.turnKey));
  const beforePan=await mounted();
  await page.locator('.waygoal-viewport').focus();
  for(let step=0;step<12;step++) await page.keyboard.press('Shift+ArrowDown');
  await delay(800);
  const afterPan=await mounted();
  assert.ok(afterPan.some(key=>!beforePan.includes(key)), 'panning mounts previously distant turns');
  for(let step=0;step<12;step++) await page.keyboard.press('Shift+ArrowUp');
  await delay(800);
  assert.deepEqual(await mounted(),beforePan,'returning restores the same turn identities');
  await page.keyboard.press('0');
  await page.waitForFunction(total=>document.querySelectorAll('[data-turn]').length===total,count*turns);
  assert.equal(await page.locator('.waygoal-thumb-card').count(), count*(turns+1), 'overview preserves complete geometry');
  await sample('all-turns-overview');
  while(await page.getByRole('button',{name:/^收起会话：/}).count()) await page.getByRole('button',{name:/^收起会话：/}).first().evaluate(el=>el.click());
  await sample('folded');
  await page.reload();await openOverview(page);await sample('reload');
  assert.equal(model.requests.length,0,'profile must not send a model request');
  assert.deepEqual(errors,[]);
  writeFileSync(join(output,process.env.WAYGOAL_MEMORY_OUTPUT??'profile.json'),JSON.stringify({count,turns,offscreenCards:outside,samples},null,2));
  if(process.env.WAYGOAL_MEMORY_ASSERT==='1') assert.ok(outside<10, `offscreen DOM is bounded: ${outside} distant cards remain mounted`);
} finally {
  writeFileSync(join(output,'server.log'),logs);
  socket?.close();await browser?.close();
  if(server.exitCode===null){const exit=once(server,'exit');server.kill('SIGTERM');await exit;}
  await model.close();rmSync(agentDir,{recursive:true,force:true});
}
