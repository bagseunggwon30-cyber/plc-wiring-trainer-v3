const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('index.html');
const multiview=read('src/ui/multiview-ui.js');
const ui=read('src/ui/palletizer-3d.js');
const camera=read('src/ui/camera-navigation.js');
const pkg=JSON.parse(read('package.json'));

test('v3 renderer keeps the palletizer stack in dependency order without a runtime npm dependency',()=>{
  const three=html.indexOf('assets/vendor/three.min.js');
  const runtime=html.indexOf('src/runtime/palletizer-runtime.js');
  const multiviewCore=html.indexOf('src/ui/multiview-core.js');
  const multiviewUi=html.indexOf('src/ui/multiview-ui.js');
  const palletUi=html.indexOf('src/ui/palletizer-3d.js');
  assert.ok(three>0&&three<runtime&&runtime<multiviewCore&&multiviewCore<multiviewUi&&multiviewUi<palletUi);
  assert.equal(fs.existsSync(path.join(root,'assets/vendor/three.min.js')),true);
  assert.equal(fs.existsSync(path.join(root,'assets/vendor/THREE-LICENSE.txt')),true);
  assert.equal(pkg.version,'3.0.4');
  assert.equal(pkg.dependencies.three,undefined);
  assert.equal(pkg.devDependencies.three,undefined);
});

test('multiview exposes a fifth 3D palletizer view without replacing shared wiring views',()=>{
  assert.match(multiview,/data-view="palletizer"/);
  assert.match(multiview,/id="mv-palletizer"/);
  assert.match(multiview,/PLCTrainerPalletizer3D\?\.setVisible/);
  assert.match(multiview,/PLCTrainerPalletizer3D\?\.renderActive/);
  assert.match(multiview,/mv-palletizer-mode/);
  for(const view of ['panel','schematic','sequence','io','palletizer'])assert.match(multiview,new RegExp(`'${view}'`));
});

test('v3 persistence keeps the 3D state and the bridge stays offline',()=>{
  assert.match(html,/palletizer3d:window\.PLCTrainerPalletizer3D\?\.exportState/);
  assert.match(ui,/실제 PLC에는 쓰지 않습니다/);
  assert.doesNotMatch(ui,/https?:\/\//);
});

test('palletizer requires one explicit PLC vendor profile and renders only that address map',()=>{
  assert.match(ui,/id="p3-profile"/);
  assert.match(ui,/option value="ls"/);
  assert.match(ui,/option value="mitsubishi"/);
  assert.match(ui,/Runtime\.setProfile/);
  assert.match(ui,/Runtime\.getProfile/);
  assert.match(ui,/Runtime\.writeDevice/);
  assert.doesNotMatch(ui,/Runtime\.startAuto/);
  assert.doesNotMatch(ui,/XG5000 주소 이미지/);
});

test('new browser scripts parse as classic JavaScript',()=>{
  assert.doesNotThrow(()=>new Function(read('src/runtime/palletizer-runtime.js')));
  assert.doesNotThrow(()=>new Function(multiview));
  assert.doesNotThrow(()=>new Function(camera));
  assert.doesNotThrow(()=>new Function(ui));
});
