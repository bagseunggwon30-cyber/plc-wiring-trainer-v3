const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('only interim-safe legacy missions are published', () => {
  const { PUBLIC_MISSION_IDS, isPublishedMission } = require('../safety-policy.js');
  assert.deepEqual([...PUBLIC_MISSION_IDS], ['g2', 'g3', 'g4', 'g5', 'g6', 'g10', 'g13']);
  assert.equal(isPublishedMission('g2'), true);
  assert.equal(isPublishedMission('g1'), false);
  assert.match(html, /if\s*\(\s*!isPublishedMission\(g\.id\)\s*\)\s*continue/);
});

test('danger and function issues block mission completion', () => {
  const { hasBlockingIssues } = require('../safety-policy.js');
  assert.equal(hasBlockingIssues([]), false);
  assert.equal(hasBlockingIssues([{ category: 'quality' }]), false);
  assert.equal(hasBlockingIssues([{ category: 'danger' }]), true);
  assert.equal(hasBlockingIssues([{ category: 'function' }]), true);
  assert.match(html, /allDone\s*&&\s*!hasBlockingIssues\(\)/);
});

test('legacy state snapshots restore unsafe transactional mutations', () => {
  const { captureLegacyState, restoreLegacyState } = require('../safety-policy.js');
  const state = {
    devices: { d1: { type: 'MCCB' } },
    wires: [{ id: 'w1' }],
    nextId: 2,
    history: [{ marker: 'before' }],
    future: [{ marker: 'redo' }],
  };
  const snapshot = captureLegacyState(state);
  state.devices.d2 = { type: 'MDR-100' };
  state.wires.push({ id: 'w2' });
  state.nextId = 9;
  state.history.push({ marker: 'unsafe' });
  state.future.length = 0;

  restoreLegacyState(state, snapshot);

  assert.deepEqual(state, {
    devices: { d1: { type: 'MCCB' } },
    wires: [{ id: 'w1' }],
    nextId: 2,
    history: [{ marker: 'before' }],
    future: [{ marker: 'redo' }],
  });
  assert.match(html, /if\s*\(\s*!isPublishedMission\(goalId\)\s*\)/);
  assert.match(html, /restoreLegacyState\(S,\s*transactionSnapshot\)/);
});

test('unsafe MCCB phase to neutral mission wiring remains detectable', () => {
  const mccbT2 = { domain: 'ac', potential: 'L2' };
  const mdrN = { domain: 'ac', potential: 'N' };
  assert.notEqual(mccbT2.potential, mdrN.potential);
  assert.match(html, /AC-L과 AC-N이 같은 net \(전원 단락!\)/);
});

