const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Core=require('../src/ui/multiview-core.js');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

function def(terminals,label='DEV'){
  return {label,terminals:terminals.map(([id,pol='SW'])=>({id,label:id,pol}))};
}

test('shared multiview scripts remain wired into the v2.7 app and schema stores diagram layouts',()=>{
  assert.match(html,/결선 작업장 v2\.7/);
  assert.match(html,/const PROJECT_SCHEMA_VERSION=9/);
  assert.match(html,/diagramLayouts:S\.diagramLayouts/);
  assert.match(html,/src\/ui\/multiview-core\.js/);
  assert.match(html,/src\/ui\/multiview-ui\.js/);
  assert.match(html,/PLCTrainerMultiView\?\.renderActive/);
});

test('PB 1a1b becomes separate NO and NC sequence symbols tied to real terminals',()=>{
  const d=def([['11'],['12'],['21'],['22']],'PB');
  const els=Core.sequenceElementsForDevice('d1',{type:'PB-1C'},d);
  assert.equal(els.length,2);
  assert.deepEqual(els.find(e=>e.kind==='contact-no').terminals,['11','12']);
  assert.deepEqual(els.find(e=>e.kind==='contact-nc').terminals,['21','22']);
});

test('MC sequence representation exposes coil, auxiliary contacts, and all main poles',()=>{
  const d=def(['A1','A2','13','14','21','22','1L1','2T1','3L2','4T2','5L3','6T3'].map(x=>[x]),'MC');
  const els=Core.sequenceElementsForDevice('k1',{type:'MC',role:'정회전 MC'},d);
  assert.equal(els.filter(e=>e.kind==='coil').length,1);
  assert.deepEqual(els.find(e=>e.id==='aux-no').terminals,['13','14']);
  assert.deepEqual(els.find(e=>e.id==='aux-nc').terminals,['21','22']);
  assert.equal(els.filter(e=>e.id.startsWith('main-')).length,3);
});

test('schematic nodes preserve canonical terminal ids used by shared S.wires',()=>{
  const d={label:'PLC',cat:'plc',terminals:[{id:'P00',label:'P00',pol:'DI'},{id:'P20',label:'P20',pol:'DO'}]};
  const node=Core.schematicNodeForDevice('plc1',{type:'XBC-DR32H'},d);
  assert.deepEqual(node.terminals.map(t=>t.id),['P00','P20']);
});

test('I/O table derives connections without copying wire state',()=>{
  const devices={plc:{type:'PLC'},pb:{type:'PB'}};
  const library={PLC:{label:'PLC',terminals:[{id:'P00',label:'P00',pol:'DI'}]},PB:{label:'PB',terminals:[{id:'12',label:'12',pol:'SW'}]}};
  const wires=[{id:'w1',from:{dev:'pb',term:'12'},to:{dev:'plc',term:'P00'}}];
  const rows=Core.buildIoRows(devices,library,wires,(_id,term)=>term==='P00'?'P0000':'');
  assert.equal(rows.length,1);
  assert.equal(rows[0].address,'P0000');
  assert.deepEqual(rows[0].links,['pb.12']);
});

test('diagram layout migration rejects nonnumeric positions and keeps valid coordinates',()=>{
  const v=Core.normalizeDiagramLayouts({schematic:{a:{x:10,y:20},bad:{x:'x',y:4}},sequence:{'a::coil':{x:'30',y:'40'}}});
  assert.deepEqual(v.schematic,{a:{x:10,y:20}});
  assert.deepEqual(v.sequence,{'a::coil':{x:30,y:40}});
});

test('orthogonal paper wire route uses Manhattan segments',()=>{
  assert.equal(Core.routeOrthogonal({x:0,y:10},{x:100,y:50}),'M 0 10 L 50 10 L 50 50 L 100 50');
});

test('MY2N and timer use one three-terminal changeover symbol per pole so common terminals are not duplicated',()=>{
  const relay=def(['13','14','9','1','5','12','4','8'].map(x=>[x]),'MY2N');
  const r=Core.sequenceElementsForDevice('r1',{type:'MY2N'},relay);
  assert.deepEqual(r.find(e=>e.id==='c1').terminals,['9','1','5']);
  assert.deepEqual(r.find(e=>e.id==='c2').terminals,['12','4','8']);
  assert.equal(r.filter(e=>e.kind==='contact-changeover').length,2);
});

test('large generic PLC blocks keep every real terminal connectable by splitting them into chunks',()=>{
  const terminals=Array.from({length:53},(_,i)=>({id:`P${String(i).padStart(2,'0')}`,label:`P${i}`,pol:'DI'}));
  const els=Core.sequenceElementsForDevice('plc1',{type:'PLC'}, {label:'PLC',cat:'plc',terminals});
  const mapped=els.flatMap(e=>e.terminals);
  assert.equal(mapped.length,53);
  assert.equal(new Set(mapped).size,53);
  assert.ok(els.length>=3);
});
