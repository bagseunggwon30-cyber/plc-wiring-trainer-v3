const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'src/ui/palletizer-3d.js'),'utf8');
const glb=fs.readFileSync(path.join(root,'assets/models/automation/palletizer-3axis-v2.glb'));

function parseGlbJson(buffer){
  assert.equal(buffer.toString('ascii',0,4),'glTF');
  const length=buffer.readUInt32LE(12),type=buffer.toString('ascii',16,20);
  assert.equal(type,'JSON');
  return JSON.parse(buffer.toString('utf8',20,20+length));
}

test('Blender palletizer GLB exposes the exact nested runtime motion hierarchy',()=>{
  const json=parseGlbJson(glb),indexByName=new Map(json.nodes.map((node,index)=>[node.name,index])),parentByIndex=new Map();
  json.nodes.forEach((node,index)=>(node.children||[]).forEach(child=>parentByIndex.set(child,index)));
  const parentName=name=>json.nodes[parentByIndex.get(indexByName.get(name))]?.name||null;
  for(const name of ['PALLETIZER_ROOT','X_Carriage','Y_Carriage','Z_Slide','Gripper','Jaw_L','Jaw_R'])assert.equal(indexByName.has(name),true,`${name} missing`);
  assert.equal(parentName('X_Carriage'),'PALLETIZER_ROOT');
  assert.equal(parentName('Y_Carriage'),'X_Carriage');
  assert.equal(parentName('Z_Slide'),'Y_Carriage');
  assert.equal(parentName('Gripper'),'Z_Slide');
  assert.equal(parentName('Jaw_L'),'Gripper');
  assert.equal(parentName('Jaw_R'),'Gripper');
});

test('Blender palletizer GLB includes production-scale mechanical and safety detail',()=>{
  const json=parseGlbJson(glb),names=new Set(json.nodes.map(node=>node.name));
  for(const name of [
    'X_Axis_Nameplate',
    'Column_BaseBracket_-5.0',
    'Vacuum_Manifold',
    'Vacuum_Cup_1',
    'Vacuum_PressureSwitch',
    'Z_Telescopic_InnerRam',
    'Z_Bellows_01',
    'Front_Safety_Gate',
    'Gate_Interlock',
    'Cabinet_Equipment_Label'
  ])assert.equal(names.has(name),true,`${name} missing from high-detail palletizer asset`);
});

test('vacuum cups, held box, and auxiliary jaws share the calibrated pick contact plane',()=>{
  assert.match(ui,/closed:finite\(node\.userData\?\.closedX,node\.position\.x\*\.91\)/);
  assert.match(ui,/heldWorld\.y-=1\.516/);
  assert.match(ui,/const closed=P\.state\.gripper\.holding/);
});

test('palletizer waits for a late imported-model loader and provides retry diagnostics',()=>{
  assert.match(ui,/plc-trainer-imported-models-ready/);
  assert.match(ui,/installModelLoaderWait\(\)/);
  assert.match(ui,/MODEL_RETRY_DELAYS/);
  assert.match(ui,/retryModelLoad:retryBlenderMachine/);
  assert.match(ui,/modelLoad:\{status:P\.modelLoad\.status,source:P\.modelLoad\.source,attempts:P\.modelLoad\.attempts/);
  assert.match(ui,/P\.modelLoad\.status='waiting-loader'/);
});

test('axis positions are normalized from runtime limits and bound to named GLB nodes',()=>{
  assert.match(ui,/function axisSceneCoordinate\(name,axis\)/);
  assert.match(ui,/function resolveWorldAxisBinding\(node,name\)/);
  assert.match(ui,/AXIS_WORLD_COMPONENTS=Object\.freeze\(\{X:'x',Y:'z',Z:'y'\}\)/);
  assert.match(ui,/X:Object\.freeze\(\{component:'x',start:-4\.45,end:4\.45\}\)/);
  assert.match(ui,/Y:Object\.freeze\(\{component:'z',start:2\.5,end:-2\.65\}\)/);
  assert.match(ui,/Z:Object\.freeze\(\{component:'y',start:\.62,end:4\.42\}\)/);
  assert.match(ui,/X:resolveWorldAxisBinding\(xCarriage,'X'\)/);
  assert.match(ui,/setAxisWorldCoordinate\(binding,axisSceneCoordinate\(name,a\[name\]\)\)/);
  assert.match(ui,/worldCoordinate:binding\?finite\(worldPosition\[binding\.worldComponent\]\):null/);
});

test('status LEDs are reparented out of the hidden procedural model when GLB activates',()=>{
  assert.match(ui,/Object\.values\(P\.parts\.leds\|\|\{\}\)/);
  assert.match(ui,/P\.parts\.runtimeLayer\?\.attach/);
  assert.match(ui,/if\(statusLed&&P\.parts\.runtimeLayer\?\.attach\)P\.parts\.runtimeLayer\.attach\(statusLed\)/);
});

test('procedural fallback is an isolated visual layer while runtime workpieces survive GLB activation',()=>{
  assert.match(ui,/root\.name='Procedural-Palletizer-Fallback'/);
  assert.match(ui,/runtimeLayer\.name='Palletizer-Runtime-Workpieces'/);
  assert.match(ui,/P\.parts\.proceduralModel\.visible=false/);
  assert.doesNotMatch(ui,/P\.parts\.machine\.traverse\(object=>\{if\(object\.isMesh\)object\.visible=false;\}\)/);
});

test('world-space motion, persistent LEDs, and JOG safety are explicit UI contracts',()=>{
  assert.match(ui,/function setAxisWorldCoordinate\(binding,value\)/);
  assert.match(ui,/point\[binding\.worldComponent\]=value/);
  assert.match(ui,/setAxisWorldCoordinate\(binding,axisSceneCoordinate\(name,a\[name\]\)\)/);
  assert.match(ui,/Object\.values\(P\.parts\.leds\|\|\{\}\)/);
  assert.match(ui,/P\.parts\.runtimeLayer\?\.attach/);
  assert.match(ui,/window\.addEventListener\('blur',blur\)/);
  assert.match(ui,/document\.addEventListener\('visibilitychange',visibility\)/);
  assert.match(ui,/if\(!P\.visible\)stopActiveJogs\(\)/);
});

test('model loading, idle rendering, and placed meshes have bounded lifecycle costs',()=>{
  assert.match(ui,/MODEL_LOAD_TIMEOUT_MS=12000/);
  assert.match(ui,/function loadModelWithTimeout\(promise,generation\)/);
  assert.match(ui,/loadModelWithTimeout\(loader\.loadModel/);
  assert.match(ui,/if\(P\.renderDirty\)\{updateMachine\(\);updateUi\(\);persist\(\);/);
  assert.match(ui,/if\(moving\)schedule\(\)/);
  assert.match(ui,/P\.parts\.placedMeshes=P\.parts\.placedMeshes\|\|new Map\(\)/);
  assert.match(ui,/if\(P\.parts\.placedMeshes\.has\(item\.id\)\)continue/);
});
