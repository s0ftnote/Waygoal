import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
import { SessionManager } from '@earendil-works/pi-coding-agent';
const jiti=createJiti(import.meta.url);
const {createRecordedFork,recoverForkOperations}=await jiti.import('./fork-service.ts');
const {readOrigin,safeKey}=await jiti.import('./lineage.ts');
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'waygoal-lineage-'));
  const sessions=join(dir,'sessions');mkdirSync(sessions);
  const file=join(sessions,'source.jsonl');
  const records=[{type:'session',version:3,id:'source',timestamp:new Date().toISOString(),cwd:dir},
    ...['user','assistant','assistant','user'].map((role,i)=>({type:'message',id:`e${i}`,parentId:i?`e${i-1}`:null,timestamp:new Date().toISOString(),message:{role,content:[{type:'text',text:`message${i}`}],timestamp:Date.now()}}))];
  writeFileSync(file,records.map(r=>JSON.stringify(r)).join('\n')+'\n');
  return {dir,file,manager:SessionManager.open(file,sessions),close:()=>rmSync(dir,{recursive:true,force:true})};
}
test('real SDK forks preserve before/after boundaries and the original session',()=>{
  const f=fixture();try {
    const original=readFileSync(f.file,'utf8');
    for(const selectedEntryId of ['e0','e1','e2']) for(const mode of ['before','after']) {
      const result=createRecordedFork(f.manager,{selectedEntryId,mode},f.dir);
      const child=SessionManager.open(result.file);
      const end=Number(selectedEntryId.slice(1))+(mode==='after'?1:0);
      assert.deepEqual(child.getEntries().filter(e=>e.type==='message').map(e=>e.id),['e0','e1','e2','e3'].slice(0,end));
      assert.equal(readOrigin(result.newSessionId,f.dir).inheritedThroughEntryId,end?`e${end-1}`:null);
      assert.equal(child.getHeader().parentSession,f.file);
    }
    assert.equal(readFileSync(f.file,'utf8'),original);
  } finally {f.close();}
});
test('retries reuse exactly one child, preserve later messages and reject request conflicts',()=>{
  const f=fixture();try {
    const request={selectedEntryId:'e1',mode:'after',operationId:'retry-operation'};
    const first=createRecordedFork(f.manager,request,f.dir);
    const child=SessionManager.open(first.file);child.appendSessionInfo('renamed child');
    const saved=readFileSync(first.file,'utf8');
    const again=createRecordedFork(f.manager,request,f.dir);
    assert.equal(again.newSessionId,first.newSessionId);
    assert.equal(readFileSync(first.file,'utf8'),saved);
    assert.throws(()=>createRecordedFork(f.manager,{...request,selectedEntryId:'e2'},f.dir),/不能更改/);
    assert.notEqual(createRecordedFork(f.manager,{...request,operationId:'intentional-second'},f.dir).newSessionId,first.newSessionId);
  }finally{f.close();}
});
test('recovery replays every durable stage without recreating the SDK child',()=>{
  const f=fixture();try {
    const request={selectedEntryId:'e1',mode:'after',operationId:'recover-operation'};
    const result=createRecordedFork(f.manager,request,f.dir);
    const path=join(f.dir,'waygoal/fork-operations',safeKey(request.operationId),'operation.json');
    const published=JSON.parse(readFileSync(path,'utf8'));
    assert.equal(published.source,undefined,'completed journals must not retain and repeatedly parse the full source history');
    for(const phase of ['prepared','session-created','lineage-written']) {
      rmSync(result.file,{force:true});
      if(phase==='prepared'||phase==='session-created') rmSync(join(f.dir,'waygoal/lineage',safeKey(result.newSessionId)+'.json'),{force:true});
      writeFileSync(path,JSON.stringify({...published,phase}));
      recoverForkOperations(f.dir);
      assert.equal(JSON.parse(readFileSync(path,'utf8')).origin.childSessionId,result.newSessionId);
      assert.equal(readdirSync(join(f.dir,'sessions')).length,2);
    }
  }finally{f.close();}
});

test('canvas forks accept two paths to the same real workspace',()=>{
 const f=fixture();try{
  const alias=join(f.dir,'alias');symlinkSync(f.dir,alias,'dir');
  const fork=createRecordedFork(f.manager,{selectedEntryId:'e1',mode:'after',canvas:{cwd:alias,canvasId:'main'}},f.dir);
  assert.equal(fork.origin.parentSessionId,'source');
 }finally{f.close();}
});
