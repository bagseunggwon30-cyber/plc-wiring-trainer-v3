const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const exp2Start = html.lastIndexOf("Object.assign(LIB['EXP2-700'],{");
const exp2End = html.indexOf("Object.assign(LIB['MDR-100']", exp2Start);
const exp2Definition = html.slice(exp2Start, exp2End);

test('eXP2 wires leave from routing anchors below the enclosure instead of crossing its image', () => {
  assert.ok(exp2Start >= 0 && exp2End > exp2Start);
  assert.doesNotMatch(exp2Definition, /side:'P'/);
  assert.match(exp2Definition, /id:'DC24V'[\s\S]*?side:'B'[\s\S]*?anchor:\{x:64,y:386\}/);
  assert.match(exp2Definition, /id:'COM1-1'[\s\S]*?side:'B'[\s\S]*?anchor:\{x:240,y:302\}/);
  assert.match(exp2Definition, /id:'COM1-6'[\s\S]*?side:'B'[\s\S]*?anchor:\{x:260,y:302\}/);
});

test('automatic routing separates deterministic wire lanes', () => {
  assert.match(html, /function\s+wireRouteLaneOffset\s*\(/);
  assert.match(html, /const\s+routeLaneUse\s*=\s*new Map\(\)/);
  assert.match(html, /const devicePair=\[wire\.from\.dev,wire\.to\.dev\]\.sort\(\)\.join\('\|'\)/);
  assert.match(html, /routeOrtho\([^;]*laneOffset/);
  assert.match(html, /routeOrthoChannel\([^;]*laneOffset/);
  const aStarIndex = html.indexOf('const mid=routeOrthoChannel');
  const outerDetourPickIndex = html.indexOf('pickSafeRoute(outerDetours');
  assert.ok(aStarIndex >= 0 && outerDetourPickIndex > aStarIndex);
  assert.match(html, /function\s+routeSegmentConflictCost\s*\(/);
  assert.match(html, /function\s+rememberWireRoute\s*\(/);
  assert.match(html, /const\s+routeContext=\{obstacles:getObstacles\(\[\]\),occupiedSegments:createRouteOccupancyIndex\(\)\}/);
  assert.match(html, /function\s+routeOccupancyCandidates\s*\(/);
  assert.match(html, /routeConflictCost\(clean,occupiedSegments\)/);
  assert.match(html, /gScore\[cur\]\+step\+routeSegmentConflictCost/);
  assert.match(html, /return lane\*4/);
  assert.match(html, /function\s+separateRouteOverlaps\s*\(/);
  assert.match(html, /chosen=separateRouteOverlaps\(chosen,obs,endpointIds,occupiedSegments\)/);
  assert.match(html, /function\s+staggerWireTerminalPoint\s*\(/);
  assert.match(html, /pa=staggerWireTerminalPoint\(pa,fromCount\)/);
});

test('XBC U manual overlay exposes all 126 visual centres for browser RMS calibration', () => {
  assert.match(html, /window\.measureRenderedTerminalCenterRms=function/);
  assert.match(html, /requiredTerminalCount=126/);
  assert.match(html, /dataset\.manualTerminal/);
  assert.match(html, /rmsErrorPx<=3&&maxErrorPx<=5/);
  assert.match(html, /addIoConnector\(454,XBC_U_TOP_IO_Y,inputTopIds\)/);
  assert.match(html, /addPositionConnector\(620,639,'D','C'\)/);
});

test('same-device jumpers use one continuous exterior U route', () => {
  assert.match(html, /function\s+sameDeviceJumperRoute\s*\(/);
  assert.match(html, /const\s+otherObstacles=getObstacles\(\[devId\]\)/);
  assert.match(html, /routes\.filter\(route=>!pathHitsObstacles\(route,otherObstacles,\[\]\)\)/);
  assert.match(html, /devA\s*&&\s*devA===devB/);
  assert.match(html, /const\s+sameDeviceRoute=sameDeviceJumperRoute\(/);
  assert.match(html, /if\(sameDeviceRoute\)return ptsToSvg\(sameDeviceRoute\)/);
});

test('orthogonal simplification preserves an exterior exit when the route reverses direction', () => {
  const start = html.indexOf('function simplifyOrthoPoints');
  const end = html.indexOf('/** 대각 구간을 직각으로 펼 때', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(`${html.slice(start, end)};this.simplifyOrthoPoints=simplifyOrthoPoints`, context);

  const points = context.simplifyOrthoPoints([
    {x: 500, y: 1002},
    {x: 500, y: 1040},
    {x: 500, y: 658},
  ]);

  assert.equal(points.length, 3);
  assert.equal(points[1].y, 1040);
});

test('automatic routing never accepts a path that crosses a non-endpoint device image', () => {
  const start = html.indexOf('function routeOrtho(');
  const end = html.indexOf('function routeCurve(', start);
  const routeSource = html.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(routeSource, /const devA=excludeIds\?\.\[0\] \|\| findDeviceAtPoint\(p1\)/);
  assert.doesNotMatch(routeSource, /middlePathHitsObstacles\(clean, obs\)/);
  assert.doesNotMatch(routeSource, /pickLeastBadRoute\(candidates/);
  assert.match(routeSource, /const safeStub=/);
  assert.doesNotMatch(routeSource, /return `M \$\{p1\.x\} \$\{p1\.y\} L \$\{ax\} \$\{ay\} M/);
  assert.match(routeSource, /ROUTE_BLOCKED_BY_OBSTACLES/);
});

test('renderer exposes a dedicated non-committing wiring-flow overlay', () => {
  assert.match(html, /id="g-wiring-flow"/);
  assert.match(html, /function\s+renderWiringFlow\s*\(/);
  assert.match(html, /wiring-flow-path/);
  assert.match(html, /flow-source-terminal/);
  assert.match(html, /flow-return-terminal/);
  assert.match(html, /showWiringFlowV3\(steps\)/);
});

test('wire cleanup is undoable, removes stale manual waypoints, and preserves locked routes', () => {
  assert.match(html, /function\s+organizeWireRoutes\s*\(/);
  assert.match(html, /if\(isWireRouteLocked\(w\)\)\{protectedCount\+\+;continue;\}/);
  assert.match(html, /w\.waypoints=\[\]/);
  assert.match(html, /S\.routerOrtho=true/);
  assert.match(html, /\$\('#b-router'\)\.onclick=organizeWireRoutes/);
  assert.match(html, /id="b-router"[^>]*>🧹 선 정리<\/button>/);
});
