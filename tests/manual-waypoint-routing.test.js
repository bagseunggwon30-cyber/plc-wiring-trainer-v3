const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('manual wire waypoints override automatic device-image avoidance', () => {
  const routeStart = html.indexOf('function routeOrtho(');
  const waypointStart = html.indexOf('if(waypoints && waypoints.length)', routeStart);
  const waypointEnd = html.indexOf('if(devA && devA===devB)', waypointStart);
  const waypointBranch = html.slice(waypointStart, waypointEnd);

  assert.ok(routeStart >= 0 && waypointStart > routeStart && waypointEnd > waypointStart);
  assert.match(waypointBranch, /const clean=forceOrthoChain\(pts, obs, endpointIds\)/);
  assert.match(waypointBranch, /return ptsToSvg\(clean\)/);
  assert.doesNotMatch(waypointBranch, /pathHitsObstacles/);
  assert.doesNotMatch(waypointBranch, /자동 우회로 계속/);
});
