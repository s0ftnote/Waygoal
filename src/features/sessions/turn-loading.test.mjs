import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const {sessionsToLoad}=await createJiti(import.meta.url).import('./turn-loading.ts');
const session=(id,parent)=>({id,title:id,origin:parent?{sessionId:parent}:null});
test('a thousand collapsed independent sessions load no histories; opening one loads just it',()=>{
 const sessions=Array.from({length:1000},(_,i)=>session(String(i)));
 assert.deepEqual(sessionsToLoad(sessions,[]),[]);
 assert.deepEqual(sessionsToLoad(sessions,['42']),['42']);
});
test('an open branch keeps its source family even when the source is outside the canvas',()=>{
 const sessions=[session('left','outside'),session('right','outside'),session('nested','right'),session('unrelated')];
 assert.deepEqual(sessionsToLoad(sessions,['left']),['left','nested','right']);
 assert.deepEqual(sessionsToLoad(sessions,['unrelated']),['unrelated']);
});
test('cyclic legacy sources terminate and do not load unrelated sessions',()=>{
 assert.deepEqual(sessionsToLoad([session('a','b'),session('b','a'),session('c')],['a']),['a','b']);
});
