const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('XBC-DN32H uses the detailed open-cover PPT drawing instead of a simplified skin', () => {
  const asset = path.join(root, 'assets', 'devices', 'manual', 'xbc-dn32h-ppt-open-front-clean.png');
  assert.equal(fs.existsSync(asset), true, 'PPT-backed DN32H open-cover drawing must exist');
  const png = fs.readFileSync(asset);
  assert.ok(png.length > 750_000, 'the detailed PPT drawing must not be replaced by a small placeholder');
  assert.equal(png.readUInt32BE(16), 1202, 'PPT source width');
  assert.equal(png.readUInt32BE(20), 743, 'PPT source height');

  assert.match(html, /LIB\['XBC-DN32H'\]\s*=\s*\{/);
  assert.match(html, /w:840,h:520[^\n]+image:IMG\+'manual\/xbc-dn32h-ppt-open-front-clean\.png'/);
  assert.match(html, /imageBox:\{x:0,y:0,w:840,h:520\}/);
  const definition = html.slice(
    html.indexOf("LIB['XBC-DN32H']={"),
    html.indexOf("Object.assign(LIB['XBF-AH04A']")
  );
  assert.doesNotMatch(definition, /imageLabelCorrections|image-label-correction-mask/);
  assert.match(html, /workshopProfileId:'ls-electric:xbc-dn32h'/);
  assert.match(html, /outputMode:'sinking-transistor'/);
  assert.match(html, /\{id:'P',x:238\.3,y:490\.7[^}]+label:'P \(DC12\/24V\)'[^}]+pol:'DC\+'/);
  assert.match(html, /\{id:'COM0'[^}]+pol:'DC-'/);
  assert.match(html, /\{id:'P20'[^}]+pol:'DO'/);
  assert.match(html, /\{id:'RX',x:189\.3,y:72\.8/);
  assert.match(html, /\{id:'485\+',x:203\.3,y:109\.9/);
  assert.match(html, /\{id:'L',x:175\.4,y:460\.4/);
  assert.match(html, /\{id:'PE',x:196\.4,y:490\.7/);
  assert.doesNotMatch(html, /LIB\['XBC-DN32H'\][\s\S]{0,8000}commonType:'dry-contact'/);
});

test('XBC-DN32H participates in exact profile migration and terminal geometry review', () => {
  assert.match(html, /'XBC-DN32H':'ls-electric:xbc-dn32h'/);
  assert.match(html, /TERMINAL_DATA_DEVICE_TYPES=\[[^\]]*'XBC-DN32H'/);
  assert.match(html, /REVIEW_PROFILE_TERMINAL_TYPES=new Set\(\[[^\]]*'XBC-DN32H'/);
  assert.match(html, /EXACT_MANUAL_DEVICE_TYPES=new Set\(\[[^\]]*'XBC-DN32H'/);
});

test('manual XBC screw markers preserve the screw face and DR32H upper row alignment', () => {
  const dnStart = html.indexOf("LIB['XBC-DN32H']={");
  const drStart = html.indexOf("const XBC_DR32H_TOP_TERMINAL_Y=");
  const dnDefinition = html.slice(
    dnStart,
    html.indexOf("Object.assign(LIB['XBF-AH04A']", dnStart)
  );
  const drDefinition = html.slice(
    drStart,
    html.indexOf("Object.assign(LIB['IG5A']", drStart)
  );

  assert.match(dnDefinition, /terminalMarkerStyle:'screw-center-ring'/);
  assert.match(dnDefinition, /terminalMarkerRadius:5\.2/);
  assert.match(drDefinition, /const XBC_DR32H_TOP_TERMINAL_Y=72\.8/);
  assert.match(drDefinition, /terminalMarkerStyle:'screw-center-ring'/);
  assert.match(drDefinition, /terminalMarkerRadius:5\.2/);

  const upperRowIds = ['RX', 'TX', 'SG', 'P01', 'P03', 'P05', 'P07', 'P09', 'P0B', 'P0D', 'P0F', '24G'];
  for (const terminalId of upperRowIds) {
    assert.match(
      drDefinition,
      new RegExp(`\\{id:'${terminalId.replace('+', '\\\\+')}'[^}]+y:XBC_DR32H_TOP_TERMINAL_Y`),
      `${terminalId} must stay on the common upper screw centerline`
    );
  }

  assert.match(html, /manual-terminal-marker/);
  assert.match(html, /manual-terminal-hit/);
  assert.match(html, /terminal-marker-center/);
  assert.match(html, /\.terminal\.manual-terminal-marker\{fill:rgba\(255,255,255,\.04\)/);
});

test('DR32H and three-wire proximity sensors use clean versioned equipment artwork', () => {
  const drAsset = path.join(root, 'assets', 'devices', 'manual', 'xbc-dr32h-ppt-open-front-transparent.png');
  const npnAsset = path.join(root, 'assets', 'devices', 'flat', 'prox-npn-v2.svg');
  const pnpAsset = path.join(root, 'assets', 'devices', 'flat', 'prox-pnp-v2.svg');

  assert.equal(fs.existsSync(drAsset), true, 'PPT-extracted DR32H asset must exist');
  const drPng = fs.readFileSync(drAsset);
  assert.ok(drPng.length > 600_000, 'transparent PPT derivative must not be replaced by a small placeholder');
  assert.equal(drPng.readUInt32BE(16), 1202);
  assert.equal(drPng.readUInt32BE(20), 743);
  assert.equal(drPng.readUInt8(25), 6, 'PPT derivative must be a genuine RGBA PNG');

  assert.equal(fs.existsSync(npnAsset), true, 'NPN SVG must exist');
  assert.equal(fs.existsSync(pnpAsset), true, 'PNP SVG must exist');
  const npnSvg = fs.readFileSync(npnAsset, 'utf8');
  const pnpSvg = fs.readFileSync(pnpAsset, 'utf8');
  for (const [kind, svg] of [['NPN', npnSvg], ['PNP', pnpSvg]]) {
    assert.match(svg, /viewBox="0 0 260 120"/);
    assert.match(svg, new RegExp(`>${kind}<`));
    assert.match(svg, />BN</);
    assert.match(svg, />BK</);
    assert.match(svg, />BU</);
    assert.doesNotMatch(svg, /<rect[^>]+width="260"[^>]+fill="#fff/i, `${kind} background must remain transparent`);
  }

  const drStart = html.indexOf("Object.assign(LIB['XBC-DR32H']", html.indexOf("const XBC_DR32H_TOP_TERMINAL_Y="));
  const drEnd = html.indexOf("Object.assign(LIB['IG5A']", drStart);
  const drDefinition = html.slice(drStart, drEnd);
  assert.match(drDefinition, /image:IMG\+'manual\/xbc-dr32h-ppt-open-front-transparent\.png'/);
  assert.doesNotMatch(drDefinition, /disabledTerminalSpots|imageLabelCorrections/);
  assert.doesNotMatch(html, /Object\.assign\(LIB\['XBC-DR32H'\],[\s\S]{0,160}trimmed\/xbc-dr32h-24g-v2\.png/);
  assert.match(html, /image:FLAT\+'prox-npn-v2\.svg'/);
  assert.match(html, /image:FLAT\+'prox-pnp-v2\.svg'/);
});

test('XBC-DN32H and MDR-100 demo contains exactly those two devices', () => {
  assert.match(html, /id="tpl-xbc-dn32h-mdr"/);
  assert.match(html, /function loadXbcDn32hMdrDemo\(/);
  assert.match(html, /demo=xbc-dn32h-mdr/);

  const body = html.slice(
    html.indexOf('function loadXbcDn32hMdrDemo('),
    html.indexOf('function seedDemoDevices(')
  );
  assert.match(body, /placeOnRail\('MDR-100'/);
  assert.match(body, /placeOnRail\('XBC-DN32H'/);
  assert.doesNotMatch(body, /BOUNDARY-AC|TB-24V-10|TB-0V-10|PB-1C|LAMP-G/);
  assert.match(body, /wire\(mdr,'V\+1',plc,'P'/);
  assert.match(body, /wire\(mdr,'V-1',plc,'COM0'/);
  assert.equal((body.match(/^\s*wire\(/gm) || []).length, 2, 'the minimal functional demo must have exactly two conductors');
  assert.doesNotMatch(body, /COMI|COM1|COM2|COM3/);
  assert.doesNotMatch(body, /plc,'24V'/);
  assert.doesNotMatch(body, /plc,'24G'/);
  assert.match(body, /return \{mdr,plc\};/);
});
