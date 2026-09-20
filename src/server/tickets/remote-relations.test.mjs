import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url);
const {deliverRemoteTicket,remoteMapViews,readRemoteDeliveries}=await jiti.import('./remote-store.ts');
const {refreshRemoteRelations}=await jiti.import('./remote-relations.ts');
const issue=n=>({html_url:`https://github.com/a/b/issues/${n}`});
function setup(t) {
 const root=mkdtempSync(join(tmpdir(),'wg-relations-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const ref={cwd:join(root,'work'),agentDir:join(root,'agent')};mkdirSync(ref.cwd);
 const ids=[1,2,3].map(number=>{const path=join(ref.cwd,`${number}.json`);writeFileSync(path,JSON.stringify({number,title:`#${number}`,state:'OPEN',updatedAt:'2026-09-20',labels:[{name:`wayfinder:${number===1?'map':'grilling'}`}],body:'## Question\n\n实际问题'}));return deliverRemoteTicket(ref,{source:'github',origin:'a/b',number:String(number),ref:path}).ticket;});
 return {ref,ids};
}
test('native subissues and dependencies reach the canvas without inventing repository-wide parentage',async t=>{
 const {ref,ids}=setup(t);const calls=[];
 const read=async(path,list)=>{calls.push(path);if(path.endsWith('/parent'))return path.includes('/1/')?null:issue(1);return path.includes('sub_issues')?[[issue(2)],[issue(3)]]:[[]];};
 assert.equal((await refreshRemoteRelations(ref,ids[0],read)).refreshed,true);
 let tickets=remoteMapViews(ref)[0].tickets;
 assert.equal(tickets[1].parentTicketId,ids[0]);assert.equal(tickets[2].parentTicketId,ids[0]);
 await refreshRemoteRelations(ref,ids[2],async path=>path.endsWith('/parent')?issue(1):path.includes('blocked_by')?[[issue(2)]]:[[]]);
 tickets=remoteMapViews(ref)[0].tickets;
 assert.equal(tickets[2].blockers[0].path,ids[1]);assert.equal(tickets[2].state,'waiting');
 const count=calls.length;remoteMapViews(ref);assert.equal(calls.length,count,'projection performs no network reads');
});
test('errors retain verified relations and newer deliveries reject late results',async t=>{
 const {ref,ids}=setup(t);
 await refreshRemoteRelations(ref,ids[1],async path=>path.endsWith('/parent')?issue(1):[[]]);
 const result=await refreshRemoteRelations(ref,ids[1],async()=>{throw new Error('offline');});
 assert.equal(result.refreshed,false);assert.equal(remoteMapViews(ref)[0].tickets[1].parentTicketId,ids[0]);
 assert.match(readRemoteDeliveries(ref)[ids[1]].relationsNote,/offline/);
 let release;const pending=new Promise(r=>release=r);
 const refresh=refreshRemoteRelations(ref,ids[1],async path=>{await pending;return path.endsWith('/parent')?null:[[]];});
 deliverRemoteTicket(ref,{source:'github',origin:'a/b',number:'2',ref:join(ref.cwd,'2.json')},()=>new Date('2099-01-01'));
 release();assert.equal((await refresh).refreshed,false);assert.equal(remoteMapViews(ref)[0].tickets[1].parentTicketId,ids[0]);
});
test('bare number from another repository cannot attach to a same-number local issue',async t=>{
 const {ref,ids}=setup(t);
 await refreshRemoteRelations(ref,ids[2],async path=>path.endsWith('/parent')?{html_url:'https://github.com/elsewhere/project/issues/1'}:path.includes('blocked_by')?[[{html_url:'https://github.com/elsewhere/project/issues/2'}]]:[[]]);
 const ticket=remoteMapViews(ref)[0].tickets[2];
 assert.equal(ticket.parentTicketId,'remote/github/elsewhere/project/1');
 assert.equal(ticket.blockers[0].path,null);assert.equal(ticket.blockers[0].holding,'missing');
});
