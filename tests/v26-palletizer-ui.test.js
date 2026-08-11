const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('index.html');
const multiview=read('src/ui/multiview-ui.js');
const ui=read('src/ui/palletizer-3d.js');
const pkg=JSON.parse(read('package.json'));

test('v2.7 renderer keeps the v2.6 palletizer stack in dependency order',()=>{
  const three=html.indexOf('assets/vendor/three.min.js');
  const runtime=html.indexOf('src/runtime/palletizer-runtime.js');
  const multiviewCore=html.indexOf('src/ui/multiview-core.js');
  const multiviewUi=html.indexOf('src/ui/multiview-ui.js');
  const palletUi=html.indexOf('src/ui/palletizer-3d.js');
  assert.ok(three>0&&three<runtime&&runtime<multiviewCore&&multiviewCore<multiviewUi&&multiviewUi<palletUi);
  assert.equal(fs.existsSync(path.join(root,'assets/vendor/three.min.js')),true);
  assert.equal(fs.existsSync(path.join(root,'assets/vendor/THREE-LICENSE.txt')),true);
  assert.equal(pkg.version,'2.7.0');
  assert.equal(pkg.devDependencies.three,'^0.149.0');
});

test('multiview exposes a fifth 3D palletizer view without replacing shared wiring views',()=>{
  assert.match(multiview,/data-view="palletizer"/);
  assert.match(multiview,/id="mv-palletizer"/);
  assert.match(multiview,/PLCTrainerPalletizer3D\?\.setVisible/);
  assert.match(multiview,/PLCTrainerPalletizer3D\?\.renderActive/);
  assert.match(multiview,/mv-palletizer-mode/);
  for(const view of ['panel','schematic','sequence','io','palletizer'])assert.match(multiview,new RegExp(`'${view}'`));
});

test('project schema persists the 3D state and keeps the bridge offline',()=>{
  assert.match(html,/const PROJECT_SCHEMA_VERSION=9/);
  assert.match(html,/palletizer3d:window\.PLCTrainerPalletizer3D\?\.exportState/);
  assert.match(ui,/실제 PLC에는 쓰지 않습니다/);
  assert.doesNotMatch(ui,/https?:\/\//);
  assert.doesNotMatch(ui,/techflex/i);
});

test('new browser scripts parse as classic JavaScript',()=>{
  assert.doesNotThrow(()=>new Function(read('src/runtime/palletizer-runtime.js')));
  assert.doesNotThrow(()=>new Function(multiview));
  assert.doesNotThrow(()=>new Function(ui));
});
