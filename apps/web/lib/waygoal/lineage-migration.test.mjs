import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti';
const jiti=createJiti(import.meta.url);
const {migrateLegacyOrigins}=await jiti.import('./lineage-migration.ts');
const {readOrigin}=await jiti.import('./lineage.ts');
test('legacy migration verifies history, backs up once, is idempotent and never rewrites positions',()=>{
  const dir=mkdtempSync(join(tmpdir(),'waygoal-migrate-'));
  try {
    const sessionsDir=join(dir,'sessions');mkdirSync(sessionsDir);
    const sourceFile=join(sessionsDir,'source.jsonl');
    const timestamp=new Date().toISOString();
    writeFileSync(sourceFile,[{type:'session',version:3,id:'source',cwd:dir,timestamp},
      {type:'message',id:'q',parentId:null,timestamp,message:{role:'user',content:'question'}},
      {type:'message',id:'a',parentId:'q',timestamp,message:{role:'assistant',content:[{type:'text',text:'answer'}]}},
      {type:'session_info',id:'name',parentId:'a',timestamp,name:'name'}].map(e=>JSON.stringify(e)).join('\n')+'\n');
    const manager=SessionManager.open(sourceFile,sessionsDir);
    const childFile=manager.createBranchedSession('name');const childId=manager.getSessionId();
    const canvasDir=join(dir,'waygoal/workspaces/test');mkdirSync(canvasDir,{recursive:true});
    const canvasFile=join(canvasDir,'canvas.json');
    const canvas=JSON.stringify({origins:{[childId]:{sessionId:'source',entryId:'name',recordedAt:timestamp}},nodes:{[childId]:{x:712,y:829}}});
    writeFileSync(canvasFile,canvas);
    const sessions=[{id:'source',path:sourceFile},{id:childId,path:childFile}];
    assert.equal(migrateLegacyOrigins(sessions,false,dir)[0].status,'verified');
    assert.equal(readOrigin(childId,dir),null);
    assert.equal(migrateLegacyOrigins(sessions,true,dir)[0].status,'verified');
    assert.equal(readOrigin(childId,dir).inheritedThroughEntryId,'name');
    assert.equal(readFileSync(canvasFile,'utf8'),canvas);
    assert.deepEqual(migrateLegacyOrigins(sessions,true,dir),[]);
    rmSync(canvasFile);
    assert.equal(readOrigin(childId,dir).parentSessionId,'source','moving/removing a canvas does not erase lineage');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('cyclic legacy origins are reported without partially committing a lineage',()=>{
  const dir=mkdtempSync(join(tmpdir(),'waygoal-conflict-'));
  try {
    const canvas=join(dir,'waygoal/workspaces/test');mkdirSync(canvas,{recursive:true});
    writeFileSync(join(canvas,'canvas.json'),JSON.stringify({origins:{a:{sessionId:'b',entryId:'q'},b:{sessionId:'a',entryId:'q'}}}));
    assert.deepEqual(migrateLegacyOrigins([],true,dir).map(item=>item.status),['conflict','conflict']);
    assert.equal(readOrigin('a',dir),null);assert.equal(readOrigin('b',dir),null);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
