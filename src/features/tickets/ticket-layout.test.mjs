import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url);
const {ticketCards,ticketRelations,arrangeTickets,placeTicketMaps}=await jiti.import('./ticket-layout.ts');
const ticket=(id,x,y,parentTicketId=null)=>({id,position:{x,y},expanded:true,discussions:[],parentTicketId,blockers:[]});
const maps=[{path:'source',remote:true,position:{x:0,y:0},tickets:[ticket('map',320,220),ticket('a',640,220,'map'),{...ticket('b',960,0,'map'),blockers:[{path:'a'}]}]}];
test('only real tickets are board nodes; parent and dependency remain distinct',()=>{
 assert.deepEqual(ticketCards(maps).map(c=>c.id),['map','a','b']);
 assert.deepEqual(ticketRelations(maps),[{from:'map',to:'a',kind:'membership'},{from:'map',to:'b',kind:'membership'},{from:'a',to:'b',kind:'dependency'}]);
});
test('ticket cluster clears fully expanded chats and projection never drifts or changes stored coordinates',()=>{
 const before=JSON.stringify(maps),obstacles=[{x:0,y:0,width:950,height:3000}];
 const placed=placeTicketMaps(maps,obstacles);
 assert.ok(ticketCards(placed).every(c=>c.position.x>990));
 assert.equal(placed[0].tickets[1].position.x-placed[0].tickets[0].position.x,320);
 assert.equal(JSON.stringify(maps),before);
 assert.deepEqual(placeTicketMaps(maps,obstacles),placed);
 assert.deepEqual(placeTicketMaps(placed,obstacles),placed,'projection is idempotent after saving');
});
test('explicit repair groups children under map, avoids conversations, and preserves source coordinates',()=>{
 const before=JSON.stringify(maps),obstacles=[{x:0,y:0,width:950,height:3000}];
 const arranged=arrangeTickets(maps,obstacles);
 assert.ok(arranged.map.x>950);
 assert.equal(arranged.a.x,arranged.b.x);assert.ok(arranged.a.x>arranged.map.x);assert.ok(arranged.b.y>arranged.a.y);
 assert.equal(JSON.stringify(maps),before);
});

test('unrelated issues in the same GitHub repository are not treated as one family',()=>{
 const standalone=ticket('unrelated',-500,0);
 const source=[{...maps[0],tickets:[...maps[0].tickets,standalone]}];
 const placed=placeTicketMaps(source,[{x:0,y:0,width:950,height:3000}]);
 assert.deepEqual(placed[0].tickets.find(t=>t.id==='unrelated').position,standalone.position);
});

const {ticketClusters}=await jiti.import('./ticket-layout.ts');
test('cluster follows true map descendants, including nested maps but excluding unrelated issues',()=>{
 const clustered=[{...maps[0],tickets:[{...maps[0].tickets[0],type:'map'},...maps[0].tickets.slice(1),{...ticket('nested',0,0,'a'),type:'map'},ticket('leaf',0,0,'nested'),ticket('unrelated',0,0)]}];
 const before=JSON.stringify(clustered);
 assert.deepEqual(ticketClusters(clustered).map(c=>({id:c.id,members:c.members})),[{id:'map',members:['map','a','nested','leaf','b']}]);
 assert.equal(JSON.stringify(clustered),before);
});
test('local maps group tickets, missing parents and cycles do not invent map clusters',()=>{
 const local=[{path:'local',title:'Local map',position:{x:1,y:2},tickets:[ticket('one',0,0),ticket('two',0,0,'one')]}];
 assert.deepEqual(ticketClusters(local)[0].members,['local','one','two']);
 const cycle=[{...maps[0],tickets:[{...ticket('a',0,0,'b'),type:'map'},{...ticket('b',0,0,'a'),type:'map'}]}];
 assert.deepEqual(ticketClusters(cycle),[]);
});

test('a map includes its real discussions; those sessions do not push their own tickets away',()=>{
 const input=[{...maps[0],tickets:[{...maps[0].tickets[0],type:'map',discussions:[{sessionId:'chat'}]},...maps[0].tickets.slice(1)]}];
 const obstacles=[{sessionId:'chat',x:100,y:0,width:900,height:1500}];
 const placed=placeTicketMaps(input,obstacles);
 assert.deepEqual(placed[0].tickets.map(t=>t.position),input[0].tickets.map(t=>t.position));
 assert.deepEqual(ticketClusters(input)[0].sessionIds,['chat']);
 assert.deepEqual(placeTicketMaps(input,[{...obstacles[0],x:150}])[0].tickets.map(t=>t.position),input[0].tickets.map(t=>t.position),'dragging own conversation does not repel the map');
 const foreign=placeTicketMaps(input,[{...obstacles[0],sessionId:'unrelated'}]);
 assert.ok(Math.min(...foreign[0].tickets.slice(1).map(t=>t.position.x))-20>1000,'the visible Map frame clears unrelated discussions');
});
test('discussion ownership does not make a whole repository immune to collision',()=>{
 const input=[{...maps[0],tickets:[{...maps[0].tickets[0],type:'map',discussions:[{sessionId:'chat'}]},...maps[0].tickets.slice(1),ticket('unrelated',500,0)]}];
 const placed=placeTicketMaps(input,[{sessionId:'chat',x:100,y:0,width:900,height:1500}]);
 assert.equal(placed[0].tickets[0].position.x,320);
 assert.ok(placed[0].tickets.find(t=>t.id==='unrelated').position.x>1000);
});
test('loose tickets move around the owned family, not back into it after a session drag',()=>{
 const input=[{...maps[0],tickets:[{...maps[0].tickets[0],type:'map',discussions:[{sessionId:'chat'}]},...maps[0].tickets.slice(1),ticket('loose',100,0)]}];
 const layout=x=>placeTicketMaps(input,[{sessionId:'chat',x,y:0,width:280,height:1800}])[0].tickets;
 assert.deepEqual(layout(0).find(t=>t.id==='map').position,layout(50).find(t=>t.id==='map').position);
 assert.ok(layout(50).find(t=>t.id==='loose').position.x>1200);
});

test('wrapped Map headers cannot overlap another family of tickets',()=>{
 const input=[{...maps[0],tickets:[{...ticket('m1',0,0),type:'map'},ticket('one',320,0,'m1'),{...ticket('m2',0,272),type:'map'},ticket('two',320,272,'m2')]}];
 const result=placeTicketMaps(input,[],{m1:132,m2:220})[0].tickets;
 const one=result.find(t=>t.id==='one'),two=result.find(t=>t.id==='two');
 assert.ok(two.position.x-one.position.x>480,'second frame moves clear when its tall header would cover the first ticket');
 assert.deepEqual(placeTicketMaps([{...input[0],tickets:result}],[],{m1:132,m2:220})[0].tickets,result);
});
