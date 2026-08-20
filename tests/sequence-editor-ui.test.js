const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const editor=fs.readFileSync(path.join(root,'src/ui/sequence-editor-ui.js'),'utf8');
const multiview=fs.readFileSync(path.join(root,'src/ui/multiview-ui.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

test('sequence view mounts the independent editor instead of integrated auto-layout modes',()=>{
  assert.match(multiview,/id="mv-sequence-editor"/);
  assert.match(multiview,/PLCTrainerSequenceEditor/);
  assert.match(multiview,/mv-sequence-editor-mode/);
  assert.doesNotMatch(multiview,/id="mv-sequence-combined"/);
  assert.doesNotMatch(multiview,/통합 전기 시퀀스/);
  assert.match(html,/src\/ui\/sequence-editor-core\.js/);
  assert.match(html,/src\/ui\/sequence-editor-ui\.js/);
});

test('editor offers blank-sheet authoring and explicit series/parallel commands',()=>{
  assert.match(editor,/seq-palette/);
  assert.match(editor,/seq-insert-series/);
  assert.match(editor,/seq-insert-parallel/);
  assert.match(editor,/seq-template-starter/);
  assert.match(editor,/seq-template-forward-reverse/);
  assert.match(editor,/seq-export/);
  assert.match(editor,/seq-import-file/);
  assert.doesNotMatch(editor,/S\.devices/);
  assert.doesNotMatch(editor,/buildSequenceCatalog/);
});
