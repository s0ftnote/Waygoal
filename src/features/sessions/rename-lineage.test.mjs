import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { projectTurns } = await jiti.import('./turns.ts');
const { projectTurnBoard } = await jiti.import('../canvas/turn-board.ts');
const msg = (id, parentId, role, text = id) => ({ type: 'message', id, parentId, message: { role, content: [{type:'text',text}] } });
const info = (id, parentId) => ({type:'session_info',id,parentId,name:id});
const project = (id, entries) => {
  const result = projectTurns(id, entries, entries.at(-1)?.id ?? null);
  for (const turn of result.turns) turn.fingerprint = createHash('sha256').update(JSON.stringify(turn.entryIds.map(id => entries.find(e => e.id === id)))).digest('hex');
  return result;
};
const session = (id, parent, entryId) => ({ id, title:id, origin:parent ? {sessionId:parent,entryId,inWorkspace:true,title:parent} : null });
const layout = {positions:{},links:[]};

test('repeated rename preserves a fork attached to an older name entry', () => {
  const prefix = [msg('q',null,'user'),msg('a','q','assistant'),info('name0','a')];
  const sessions = [session('root'),session('child','root','name0')];
  const child = project('child', [...prefix,msg('child-q','name0','user')]);
  const before = projectTurnBoard(sessions,{root:project('root',prefix),child},layout);
  const entries = [...prefix];
  for(let i=1;i<=20;i++) entries.push(info(`name${i}`,entries.at(-1).id));
  const after = projectTurnBoard(sessions,{root:project('root',entries),child},layout);
  assert.deepEqual(after.cards.map(c=>[c.key,c.position]),before.cards.map(c=>[c.key,c.position]));
  assert.deepEqual(after.edges,before.edges);
});

test('known forks retain logical edges while the parent history is loading', () => {
  const entries = [msg('q',null,'user'),msg('a','q','assistant')];
  const sessions=[session('root'),session('left','root','a'),session('right','root','a')];
  const graph=projectTurnBoard(sessions,{left:project('left',entries),right:project('right',entries)},layout);
  assert.deepEqual(graph.edges.filter(e=>e.kind==='fork').map(e=>e.key).sort(),['fork:left','fork:right']);
});

test('a fixed boundary splits an answer without inheriting the later continuation',()=>{
  const prefix=[msg('q',null,'user'),msg('a1','q','assistant')];
  const projectSplit=(id,entries)=>{
    const result=projectTurns(id,entries,entries.at(-1).id,new Set(['a1']));
    for(const turn of result.turns) turn.fingerprint=createHash('sha256').update(JSON.stringify(turn.entryIds.map(id=>entries.find(e=>e.id===id)))).digest('hex');
    return result;
  };
  const sessions=[session('root'),session('child','root','a1')];
  const root=projectSplit('root',[...prefix,info('name','a1'),msg('a2','name','assistant')]);
  const child=projectSplit('child',[...prefix,msg('cq','a1','user')]);
  const graph=projectTurnBoard(sessions,{root,child},layout);
  assert.equal(graph.cards.length,3);
  assert.equal(graph.cards.find(c=>c.turn.id==='q').members.length,2);
  assert.deepEqual(graph.cards.find(c=>c.turn.id==='q').turn.entryIds,['q','a1']);
  assert.equal(graph.cards.find(c=>c.turn.id==='a2').members.length,1);
});

test('verified inherited cards keep source identity when their visible sibling changes',()=>{
  const entries=[msg('q',null,'user'),msg('a','q','assistant')];
  const left=session('left','outside','a'),right=session('right','outside','a');
  left.origin.verified=true;right.origin.verified=true;
  const data={left:project('left',entries),right:project('right',entries)};
  const before=projectTurnBoard([left,right],data,layout);
  const after=projectTurnBoard([right],data,layout,Object.fromEntries(before.cards.map(c=>[c.key,c.position])));
  assert.equal(before.cards[0].key,after.cards[0].key);
  assert.deepEqual(before.cards[0].position,after.cards[0].position);
});
