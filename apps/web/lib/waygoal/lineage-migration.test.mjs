import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync } from 'node:fs';
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
    const sourceAlias=join(sessionsDir,'source-alias.jsonl');symlinkSync(sourceFile,sourceAlias);
    const sessions=[{id:'source',path:sourceAlias},{id:childId,path:childFile}];
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


test('failed legacy verification cannot publish a precise fork or merge copied cards',async()=>{
  const {applyCanvasPatch,buildSnapshot}=await jiti.import('./store.ts');
  const {projectTurns}=await jiti.import('./turns.ts');
  const {projectTurnBoard}=await jiti.import('./turn-board.ts');
  const dir=mkdtempSync(join(tmpdir(),'waygoal-invalid-origin-'));
  try {
    const timestamp=new Date().toISOString();
    const scope={cwd:dir,canvasId:'main',agentDir:dir};
    const entries=[{type:'message',id:'q',parentId:null,timestamp,message:{role:'user',content:'question'}},
      {type:'message',id:'a',parentId:'q',timestamp,message:{role:'assistant',content:[{type:'text',text:'answer'}]}}];
    const sessions=['parent','child'].map(id=>{
      const path=join(dir,`${id}.jsonl`);
      writeFileSync(path,[{type:'session',version:3,id,cwd:dir,timestamp,...(id==='child'?{parentSession:join(dir,'other-parent.jsonl')}:{})},...entries].map(e=>JSON.stringify(e)).join('\n')+'\n');
      return {id,path,cwd:dir,created:timestamp,modified:timestamp,messageCount:2,firstMessage:id};
    });
    applyCanvasPatch(scope,{origin:{sessionId:'child',originSessionId:'parent',originEntryId:'a'}});
    const migration=migrateLegacyOrigins(sessions,true,dir);
    assert.equal(migration[0].status,'conflict');
    const snapshot=buildSnapshot(scope,sessions,[],new Map(),migration);
    const origin=snapshot.nodes.find(n=>n.id==='child').origin;
    assert.equal(origin.entryId,null);assert.equal(origin.status,'conflict');
    const data=Object.fromEntries(sessions.map(s=>[s.id,projectTurns(s.id,entries,'a')]));
    for(const history of Object.values(data)) for(const turn of history.turns) turn.fingerprint='identical-copy';
    const board=projectTurnBoard(snapshot.nodes,data,{positions:{},links:[]});
    assert.equal(board.cards.length,2,'matching copied text cannot overrule a conflicting parent');
    assert.equal(board.edges.find(e=>e.key==='fork:child').status,'conflict');
    rmSync(sessions[0].path);
    const missing=migrateLegacyOrigins(sessions,true,dir);
    const unresolved=buildSnapshot(scope,sessions,[],new Map(),missing).nodes.find(n=>n.id==='child').origin;
    assert.equal(unresolved.entryId,null);assert.equal(unresolved.status,'origin-unrecorded');
    assert.equal(readOrigin('child',dir),null);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
