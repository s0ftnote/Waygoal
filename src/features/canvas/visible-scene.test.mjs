import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const { visibleWorldBox, unionBoxes, intersectsView } = await createJiti(import.meta.url).import('./visible-scene.ts');

test('offscreen history is culled without changing world coordinates or numbering', () => {
  const view=visibleWorldBox({x:-1000,y:-8000,scale:1},{width:800,height:600});
  const cards=Array.from({length:1600},(_,index)=>({index,x:1000,y:index*200,width:278,height:150}));
  const rendered=cards.filter(card=>intersectsView(view,card));
  assert.ok(rendered.length<10);
  assert.deepEqual(rendered.map(card=>card.index),[38,39,40,41,42,43,44]);
});

test('overscan is measured in screen pixels across zoom levels and negative coordinates', () => {
  for(const scale of [.1,.5,1,1.8]) {
    const camera={x:100,y:-200,scale};
    const box=visibleWorldBox(camera,{width:800,height:600});
    assert.equal(box.x*scale+camera.x,-320);
    assert.equal(box.y*scale+camera.y,-320);
    assert.ok(Math.abs((box.x+box.width)*scale+camera.x-1120)<1e-8);
    assert.equal(intersectsView(box,{x:box.x+box.width,y:box.y,width:278,height:150}),true,'keep touching edges');
  }
});

test('camera transitions include the whole corridor and crossing connections', () => {
  const start=visibleWorldBox({x:0,y:0,scale:1},{width:800,height:600});
  const target=visibleWorldBox({x:-4000,y:-10000,scale:1},{width:800,height:600});
  const transit=unionBoxes(start,target);
  assert.ok(intersectsView(transit,{x:2000,y:5000,width:278,height:150}));
  assert.ok(!intersectsView(target,{x:2000,y:5000,width:278,height:150}),'release after arrival');
  assert.ok(intersectsView(start,{x:-1000,y:200,width:3000,height:1}),'line crosses view while endpoints are outside');
});
