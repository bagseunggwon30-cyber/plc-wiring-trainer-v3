const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.resolve(__dirname,'../src/ui/multiview-ui.js'),'utf8');

test('palletizer mode fully collapses hidden workflow sidebars at narrow viewports',()=>{
  assert.match(source,/body\.mv-palletizer-mode #palette,body\.mv-palletizer-mode #right\{visibility:hidden!important;overflow:hidden!important;box-sizing:border-box!important;min-width:0!important;width:0!important;padding:0!important;border:0!important;margin:0!important\}/);
});
