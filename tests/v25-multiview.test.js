const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Core=require('../src/ui/multiview-core.js');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const ui=fs.readFileSync(path.join(root,'src/ui/multiview-ui.js'),'utf8');

test('shared multiview and independent sequence editor scripts remain wired into the app',()=>{
  assert.match(html,/data-app-version/);
  assert.match(html,/diagramLayouts:S\.diagramLayouts/);
  assert.match(html,/src\/ui\/multiview-core\.js/);
  assert.match(html,/src\/ui\/sequence-editor-core\.js/);
  assert.match(html,/src\/ui\/sequence-editor-ui\.js/);
  assert.match(html,/src\/ui\/multiview-ui\.js/);
  assert.match(html,/PLCTrainerMultiView\?\.renderActive/);
});

test('schematic nodes preserve canonical terminal ids used by shared panel wiring',()=>{
  const definition={label:'PLC',cat:'plc',terminals:[{id:'P00',label:'P00',pol:'DI'},{id:'P20',label:'P20',pol:'DO'}]};
  const node=Core.schematicNodeForDevice('plc1',{type:'XBC-DR32H'},definition);
  assert.deepEqual(node.terminals.map(terminal=>terminal.id),['P00','P20']);
});

test('I/O table derives connections without copying panel wire state',()=>{
  const devices={plc:{type:'PLC'},pb:{type:'PB'}};
  const library={PLC:{label:'PLC',terminals:[{id:'P00',label:'P00',pol:'DI'}]},PB:{label:'PB',terminals:[{id:'12',label:'12',pol:'SW'}]}};
  const wires=[{id:'w1',from:{dev:'pb',term:'12'},to:{dev:'plc',term:'P00'}}];
  const rows=Core.buildIoRows(devices,library,wires,(_id,term)=>term==='P00'?'P0000':'');
  assert.equal(rows.length,1);
  assert.equal(rows[0].address,'P0000');
  assert.deepEqual(rows[0].links,['pb.12']);
});

test('diagram layout migration rejects nonnumeric positions and keeps valid coordinates',()=>{
  const value=Core.normalizeDiagramLayouts({schematic:{a:{x:10,y:20},bad:{x:'x',y:4}},sequence:{legacy:{x:'30',y:'40'}}});
  assert.deepEqual(value.schematic,{a:{x:10,y:20}});
  assert.deepEqual(value.sequence,{legacy:{x:30,y:40}});
});

test('orthogonal paper wire route uses Manhattan segments',()=>{
  assert.equal(Core.routeOrthogonal({x:0,y:10},{x:100,y:50}),'M 0 10 L 50 10 L 50 50 L 100 50');
});

test('sequence view opens the independent blank-sheet CAD instead of the removed auto-generated integrated view',()=>{
  assert.match(ui,/id="mv-sequence-editor"/);
  assert.match(ui,/PLCTrainerSequenceEditor\?\.setVisible/);
  assert.doesNotMatch(ui,/id="mv-sequence-combined"/);
  assert.doesNotMatch(ui,/id="mv-sequence-library"/);
  assert.doesNotMatch(ui,/통합 전기 시퀀스/);
});
