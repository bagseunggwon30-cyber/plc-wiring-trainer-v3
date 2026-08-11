const test=require('node:test');
const assert=require('node:assert/strict');
const Runtime=require('../src/runtime/palletizer-runtime.js');

function runUntil(state,predicate,seconds=180){
  const dt=.02,steps=Math.ceil(seconds/dt);
  for(let i=0;i<steps&&!predicate();i++)Runtime.tick(state,dt);
}

test('three servo axes home on their configured sensors',()=>{
  const state=Runtime.createState({axes:{X:{position:310},Y:{position:190},Z:{position:35}}});
  Runtime.setServo(state,null,true);
  assert.equal(Runtime.homeAll(state),true);
  runUntil(state,()=>Runtime.allHomed(state),20);
  assert.equal(Runtime.allHomed(state),true);
  assert.equal(state.axes.X.position,0);
  assert.equal(state.axes.Y.position,0);
  assert.equal(state.axes.Z.position,280);
  assert.equal(Runtime.readDevice(state,'M220'),true);
  assert.equal(Runtime.readDevice(state,'M222'),true);
});

test('absolute commands respect the configured travel limits',()=>{
  const state=Runtime.createState();
  Runtime.setServo(state,'X',true);
  assert.equal(Runtime.commandAxis(state,'X',250,{speed:160}),true);
  runUntil(state,()=>state.axes.X.inPosition,10);
  assert.ok(Math.abs(state.axes.X.position-250)<.01);
  assert.equal(Runtime.commandAxis(state,'X',999),false);
  assert.equal(state.axes.X.alarm.code,'SOFT_LIMIT');
  assert.equal(Runtime.readDevice(state,'M202'),true);
});

test('XG5000-style D setpoint and M move bit drive only the in-memory simulator',()=>{
  const state=Runtime.createState();
  Runtime.writeDevice(state,'M130',1);
  Runtime.writeDevice(state,'D100',125.5);
  Runtime.writeDevice(state,'D110',100);
  assert.deepEqual(Runtime.writeDevice(state,'M140',1),{ok:true,address:'M140',value:true});
  runUntil(state,()=>Runtime.readDevice(state,'M230'),10);
  assert.ok(Math.abs(Runtime.readDevice(state,'D200')-125.5)<.01);
  assert.equal(Runtime.writeDevice(state,'D200',5).ok,false);
  assert.equal(Runtime.writeDevice(state,'P0000',1).ok,false);
});

test('automatic cycle homes, grips, and places a complete pallet deterministically',()=>{
  const state=Runtime.createState({cell:{pallet:{rows:2,cols:2,layers:1}}});
  assert.equal(Runtime.startAuto(state),true);
  runUntil(state,()=>state.auto.state==='COMPLETE'||state.auto.state==='FAULT',120);
  assert.equal(state.auto.state,'COMPLETE');
  assert.equal(state.pallet.placed.length,4);
  assert.deepEqual(state.pallet.placed.map(p=>[p.row,p.col,p.layer]),[[0,0,0],[0,1,0],[1,0,0],[1,1,0]]);
  assert.equal(Runtime.readDevice(state,'M201'),true);
  assert.equal(Runtime.readDevice(state,'D210'),4);
  assert.equal(state.gripper.holding,false);
});

test('saved palletizer state restores positions and placements but never resumes motion',()=>{
  const state=Runtime.createState({cell:{pallet:{rows:1,cols:1,layers:1}}});
  Runtime.startAuto(state);
  runUntil(state,()=>state.auto.state==='COMPLETE',60);
  const saved=Runtime.exportState(state);
  const restored=Runtime.createState({saved});
  assert.equal(restored.pallet.placed.length,1);
  assert.equal(restored.auto.running,false);
  assert.equal(restored.auto.state,'IDLE');
  assert.deepEqual(Runtime.exportState(restored).cell.pallet,saved.cell.pallet);
});
