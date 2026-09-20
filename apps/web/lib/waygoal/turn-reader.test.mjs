import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
import { SessionManager } from '@earendil-works/pi-coding-agent';
const jiti = createJiti(import.meta.url, { alias: { '@': new URL('../../', import.meta.url).pathname } });
const { readTurns, readFullTurn } = await jiti.import('./turn-reader.ts');
const { cacheSessionPath } = await jiti.import('../session-reader.ts');
const { captureMaterial } = await jiti.import('./material-reader.ts');
const { GET } = await jiti.import('../../app/api/waygoal/session/[id]/turns/route.ts');
const answer = text => ({role:'assistant',content:[{type:'text',text}],timestamp:Date.now()});
test('unchanged long history reuses its projection; append and rename invalidate it', async () => {
  const root=mkdtempSync(join(tmpdir(),'waygoal-turn-cache-'));
  try {
    const manager=SessionManager.create(root,root);
    manager.appendMessage({role:'user',content:'question',timestamp:Date.now()});
    manager.appendMessage(answer('answer'));
    const id=manager.getSessionId(); cacheSessionPath(id,manager.getSessionFile());
    const first=await readTurns(id);
    assert.equal(await readTurns(id),first,'unchanged reads must not rebuild the entire history');
    const response=await GET(new Request('http://localhost/turns'),{params:Promise.resolve({id})});
    const etag=response.headers.get('etag');assert.ok(etag);
    const same=await GET(new Request('http://localhost/turns',{headers:{'If-None-Match':etag}}),{params:Promise.resolve({id})});
    assert.equal(same.status,304);assert.equal(await same.text(),'');
    manager.appendMessage({role:'user',content:'next',timestamp:Date.now()});
    const next=await readTurns(id); assert.notEqual(next,first);assert.equal(next.turns.length,2);
    manager.appendSessionInfo('new title'); assert.notEqual(await readTurns(id),next);
    rmSync(manager.getSessionFile()); assert.equal(await readTurns(id),null,'deleted history cannot be resurrected from cache');
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('card previews are bounded while material capture keeps the full answer',async()=>{
  const root=mkdtempSync(join(tmpdir(),'waygoal-turn-preview-'));
  try {
    const source=SessionManager.create(root,join(root,'source'));
    const question=source.appendMessage({role:'user',content:'question',timestamp:Date.now()});
    const text='完整正文'.repeat(20000);source.appendMessage(answer(text));
    const target=SessionManager.create(root,join(root,'target'));target.appendMessage(answer('ready'));
    for(const manager of [source,target]) cacheSessionPath(manager.getSessionId(),manager.getSessionFile());
    const cards=await readTurns(source.getSessionId());assert.ok(cards.turns[0].answer.length<=601);
    const full=await readFullTurn(source.getSessionId(),question);assert.equal(full.answer,text);assert.equal(full.fingerprint,cards.turns[0].fingerprint);
    const material=await captureMaterial(source.getSessionId(),question,target.getSessionId(),'answer');
    assert.equal(material.parts[0].text,text);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('visiting many sessions evicts old projections',async()=>{
  const root=mkdtempSync(join(tmpdir(),'waygoal-turn-budget-'));
  try {
    let firstId, first;
    for(let i=0;i<26;i++) {
      const manager=SessionManager.create(root,root);manager.appendMessage(answer('answer '+i));
      const id=manager.getSessionId();cacheSessionPath(id,manager.getSessionFile());
      const projected=await readTurns(id);if(i===0){firstId=id;first=projected;}
    }
    assert.notEqual(await readTurns(firstId),first,'cache cannot grow for every session ever opened');
  }finally{rmSync(root,{recursive:true,force:true});}
});
