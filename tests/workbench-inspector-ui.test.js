const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const rightPanel = html.slice(html.indexOf('<aside id="right">'), html.indexOf('</aside>', html.indexOf('<aside id="right">')));

test('right panel is reduced to properties and actionable wiring validation', () => {
  assert.match(rightPanel, /id="selection-properties"/);
  assert.match(rightPanel, /id="document-properties"/);
  assert.match(rightPanel, /id="validation"/);
  for (const retiredId of ['work-order', 'field-quality', 'sim-monitor', 'netlist', 'stats', 'legend']) {
    assert.doesNotMatch(rightPanel, new RegExp(`id="${retiredId}"`));
  }
  assert.doesNotMatch(rightPanel, /현장 작업순서|미션 코치|현장 품질체크|넷 리스트|도움말|극성 범례/);
});

test('validation issue activation selects and moves to a referenced wire', () => {
  assert.match(html, /function focusWorkbenchRefs\(refs/);
  assert.match(html, /S\.selWire=wireIds\[0\]/);
  assert.match(html, /focusBoundsInViewport\(bounds\)/);
  assert.match(html, /d\.addEventListener\('click',\(\)=>focusWorkbenchRefs\(iss\.wires/);
});
