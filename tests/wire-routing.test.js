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

test('wire cleanup is an undoable action that removes stale manual waypoints', () => {
  assert.match(html, /function\s+organizeWireRoutes\s*\(/);
  assert.match(html, /for\(const w of S\.wires\)\s*w\.waypoints=\[\]/);
  assert.match(html, /S\.routerOrtho=true/);
  assert.match(html, /\$\('#b-router'\)\.onclick=organizeWireRoutes/);
  assert.match(html, /id="b-router"[^>]*>🧹 선 정리<\/button>/);
});
