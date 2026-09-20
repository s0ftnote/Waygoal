import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createJiti} from 'jiti';
import {SessionManager} from '@earendil-works/pi-coding-agent';
const jiti=createJiti(import.meta.url,{alias:{'@':new URL('../../',import.meta.url).pathname}});
const {readTreeInfos,readSessionTree}=await jiti.import('./tree.ts');
const {cacheSessionPath}=await jiti.import('./session-reader.ts');
test('canvas overview retains summaries rather than every full session tree',async()=>{
 const root=mkdtempSync(join(tmpdir(),'waygoal-tree-budget-'));
 try{
  globalThis.__waygoalTreeCache?.clear();
  const sessions=[];
  for(let i=0;i<32;i++){
   const manager=SessionManager.create(root,root);
   manager.appendMessage({role:'assistant',content:[{type:'text',text:'answer '.repeat(1000)}],timestamp:Date.now()});
   cacheSessionPath(manager.getSessionId(),manager.getSessionFile());sessions.push(manager);
  }
  const ids=sessions.map(s=>s.getSessionId());
  const first=await readTreeInfos(ids);assert.equal(first.size,32);
  assert.equal(globalThis.__waygoalTreeCache?.size??0,0,'overview must not retain full histories');
  const again=await readTreeInfos(ids);assert.equal(again.get(ids[0]),first.get(ids[0]));
  const added=sessions[0].appendMessage({role:'user',content:'next',timestamp:Date.now()});
  assert.equal((await readTreeInfos(ids)).get(ids[0]).activeLeafId,added);
  for(const id of ids) await readSessionTree(id);
  assert.ok(globalThis.__waygoalTreeCache.size<=24,'full tree cache has a finite session budget');
 }finally{rmSync(root,{recursive:true,force:true});}
});
