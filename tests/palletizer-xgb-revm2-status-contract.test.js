const test = require('node:test');
const assert = require('node:assert/strict');
const Runtime = require('../src/runtime/palletizer-runtime.js');

const AXIS_STATUS = {
  xHomed: 'M00320', yHomed: 'M00321', zHomed: 'M00322',
  xBusy: 'M00323', yBusy: 'M00324', zBusy: 'M00325',
  xDone: 'M00326', yDone: 'M00327', zDone: 'M00328',
  xError: 'M00329', yError: 'M00330', zError: 'M00331',
  xDriveReady: 'M00332', yDriveReady: 'M00333', zDriveReady: 'M00334',
  xServoOn: 'M00335', yServoOn: 'M00336', zServoOn: 'M00337',
  xPosLimit: 'M00338', yPosLimit: 'M00339', zPosLimit: 'M00340',
  xNegLimit: 'M00341', yNegLimit: 'M00342', zNegLimit: 'M00343',
  xHomeSensor: 'M00344', yHomeSensor: 'M00345', zHomeSensor: 'M00346',
  xDogSensor: 'M00347', yDogSensor: 'M00348', zDogSensor: 'M00349',
};

const HMI_STATUS = {
  xServoReadyStatus: 'M00400', yServoReadyStatus: 'M00401', zServoReadyStatus: 'M00402',
  vacuumBreakStatus: 'M00403', vacuumOnStatus: 'M00404', palletFullStatus: 'M00405',
  alarmStatus: 'M00406', buzzerStatus: 'M00407', autoRunningStatus: 'M00408',
  autoReadyStatus: 'M00409', xPowerPermitStatus: 'M00410', yPowerPermitStatus: 'M00411',
  zPowerPermitStatus: 'M00412', safetyOkStatus: 'M00413', allHomeStatus: 'M00414',
  carryingStatus: 'M00415',
};

test('Rev.M2 XBC production profile exposes every axis outcome bit at its reviewed M00320..M00349 address', () => {
  const status = Runtime.getProfile('xgb-production').status;

  assert.deepEqual(Object.fromEntries(Object.entries(AXIS_STATUS).map(([name, address]) => [name, status[name]])), AXIS_STATUS);
  assert.equal(status.xInPosition, AXIS_STATUS.xDone, 'legacy in-position alias must remain the X DONE outcome bit');
  assert.equal(status.yInPosition, AXIS_STATUS.yDone, 'legacy in-position alias must remain the Y DONE outcome bit');
  assert.equal(status.zInPosition, AXIS_STATUS.zDone, 'legacy in-position alias must remain the Z DONE outcome bit');
});

test('Rev.M2 PLC-to-HMI status map uses M00400..M00415: pallet-full completion and M-bit gripper feedback, never D feedback', () => {
  const status = Runtime.getProfile('xgb-production').status;

  assert.deepEqual(Object.fromEntries(Object.entries(HMI_STATUS).map(([name, address]) => [name, status[name]])), HMI_STATUS);
  assert.equal(status.autoComplete, HMI_STATUS.palletFullStatus, 'the legacy completion alias must mean pallet full in the production profile');
  assert.equal(status.gripperClosed, HMI_STATUS.vacuumOnStatus, 'gripper vacuum state must be observed from PLC M00404');
  assert.equal(status.holding, HMI_STATUS.carryingStatus, 'carrying state must be observed from PLC M00415');
  assert.deepEqual([status.vacuumBreakStatus, status.vacuumOnStatus, status.carryingStatus], ['M00403', 'M00404', 'M00415']);
  assert.equal(Object.values(HMI_STATUS).some((address) => address.startsWith('D')), false);
});

test('Rev.M2 PLC-to-HMI gripper outcome bits are mapped as read-only M devices, not writable local commands', () => {
  const state = Runtime.createState({ profile: 'xgb-production' });

  for (const address of ['M00403', 'M00404', 'M00415']) {
    assert.equal(Runtime.readDevice(state, address), false, `${address} must be a defined PLC outcome bit`);
    assert.match(Runtime.writeDevice(state, address, true).error, /읽기 전용 상태 주소/);
  }
});
