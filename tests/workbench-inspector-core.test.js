const test = require('node:test');
const assert = require('node:assert/strict');

const Inspector = require('../src/ui/workbench-inspector-core.js');

const wires = [
  { id: 'wire-supply', from: { dev: 'psu', term: '+' }, to: { dev: 'lamp', term: '+' } },
  { id: 'wire-return', from: { dev: 'psu', term: '-' }, to: { dev: 'lamp', term: '-' } },
];

test('validation references resolve to the actual problem wire', () => {
  assert.deepEqual(Inspector.resolveWireIds(['wire-return'], wires), ['wire-return']);
  assert.deepEqual(Inspector.resolveWireIds(['conductor:wire-return'], wires), ['wire-return']);
  assert.deepEqual(Inspector.resolveWireIds(['lamp:+'], wires), ['wire-supply']);
  assert.deepEqual(Inspector.resolveWireIds(['lamp:missing-return'], wires), ['wire-supply', 'wire-return']);
  assert.deepEqual(Inspector.resolveWireIds(['psu', 'lamp'], wires), ['wire-supply', 'wire-return']);
  assert.deepEqual(Inspector.resolveWireIds(['missing'], wires), []);
});

test('wire focus bounds include both terminals and manual waypoints', () => {
  assert.deepEqual(Inspector.boundsFromPoints([
    { x: 100, y: 80 },
    { x: 340, y: 120 },
    { x: 220, y: 260 },
  ]), { x1: 100, y1: 80, x2: 340, y2: 260, width: 240, height: 180 });
});

test('viewport calculation centers the selected fault without excessive zoom', () => {
  const view = Inspector.viewportForBounds(
    { x1: 100, y1: 80, x2: 340, y2: 260, width: 240, height: 180 },
    { width: 1200, height: 800 },
  );
  assert.equal(view.k, 2.2);
  assert.equal(view.centerX, 220);
  assert.equal(view.centerY, 170);
  assert.ok(Math.abs(view.panX - 116) < 1e-9);
  assert.ok(Math.abs(view.panY - 26) < 1e-9);
});
