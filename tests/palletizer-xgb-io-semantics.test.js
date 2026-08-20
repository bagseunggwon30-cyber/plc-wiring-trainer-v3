const test = require('node:test');
const assert = require('node:assert/strict');
const Runtime = require('../src/runtime/palletizer-runtime.js');

// Source of truth: 01_io_map.csv physical-input meanings.  This test is
// intentionally semantic as well as positional: a contiguous P00000..P0000F
// range is not sufficient when individual contacts have different safety and
// operator functions.
const INPUTS_FROM_01_IO_MAP = {
  eStopLoopOk: 'P00000',
  guardLoopOk: 'P00001',
  startPb: 'P00002',
  stopPb: 'P00003',
  resetPb: 'P00004',
  autoEnableKey: 'P00005',
  workPresent: 'P00006',
  palletPresent: 'P00007',
  vacuumOk: 'P00008',
  releaseOk: 'P00009',
  airPressureOk: 'P0000A',
  xDrivePowerOk: 'P0000B',
  yDrivePowerOk: 'P0000C',
  zDrivePowerOk: 'P0000D',
  safetyRelayEdmOk: 'P0000E',
  extStopLoopOk: 'P0000F',
};

test('XGB production input keys preserve every 01_io_map.csv physical I/O meaning', () => {
  const profile = Runtime.getProfile('xgb-production');

  assert.deepEqual(profile.inputs, INPUTS_FROM_01_IO_MAP);
});
