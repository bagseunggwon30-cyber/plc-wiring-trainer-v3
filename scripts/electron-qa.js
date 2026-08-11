// Automated Electron end-to-end and visual QA: npx electron scripts/electron-qa.js
const { app, BrowserWindow, Menu } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = process.env.PLC_QA_OUTPUT || path.join(ROOT, 'artifacts', 'qa', 'v2.7');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const warnings = [];
const errors = [];
const screenshots = [];

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'plc-wiring-trainer-v27-qa-')));

function check(name, pass, details = null) {
  checks.push({ name, pass: !!pass, details });
  return !!pass;
}

async function evaluate(win, expression) {
  return win.webContents.executeJavaScript(expression, true);
}

async function center(win, selector) {
  return evaluate(win, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:Math.round(r.width),h:Math.round(r.height)}})()`);
}

async function click(win, selector, settle = 160) {
  const point = await center(win, selector);
  if (!point) throw new Error(`Missing control: ${selector}`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await wait(settle);
  return point;
}

async function fill(win, selector, value) {
  await click(win, selector, 40);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
  win.webContents.sendInputEvent({ type: 'char', keyCode: String(value) });
  await wait(80);
}

async function poll(win, expression, timeout = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(win, expression)) return true;
    await wait(180);
  }
  return false;
}

async function capture(win, name) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, `${name}.png`);
  fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
  screenshots.push(file);
  return file;
}

async function inspectLab(win, lab) {
  return evaluate(win, `(()=>{
    const rect=selector=>{const r=document.querySelector(selector)?.getBoundingClientRect();return r&&{x:Math.round(r.x),y:Math.round(r.y),right:Math.round(r.right),bottom:Math.round(r.bottom),w:Math.round(r.width),h:Math.round(r.height)}};
    const viewport={w:innerWidth,h:innerHeight};
    const selectors=${JSON.stringify({ hub: '#al-hub', tabs: '#al-tabs', pane: '.al-pane.active', scene: '.al-pane.active .al-scene', side: '.al-pane.active .al-side', canvas: '.al-pane.active canvas' })};
    const regions=Object.fromEntries(Object.entries(selectors).map(([key,selector])=>[key,rect(selector)]));
    const required=['hub','tabs','pane','scene','side'];
    const fits=required.every(key=>{const r=regions[key];return r&&r.x>=-1&&r.y>=-1&&r.right<=viewport.w+1&&r.bottom<=viewport.h+1&&r.w>20&&r.h>20;});
    const bodyStyle=getComputedStyle(document.body);
    return {lab:${JSON.stringify(lab)},active:window.PLCTrainerAutomationLabs?.activeLab,viewport,regions,fits,hostVisible:document.querySelector('#mv-palletizer')?.classList.contains('show'),bodyMode:document.body.classList.contains('mv-palletizer-mode'),bodyOverflow:{x:bodyStyle.overflowX,y:bodyStyle.overflowY},document:{w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,canScrollX:document.documentElement.scrollWidth>document.documentElement.clientWidth,canScrollY:document.documentElement.scrollHeight>document.documentElement.clientHeight}};
  })()`);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 1024, minHeight: 700, show: false,
    backgroundColor: '#0b151d',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false }
  });
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const item = { level, message, line, sourceId };
    if (level >= 3) errors.push(item);
    else if (level === 2) warnings.push(item);
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => errors.push({ level: 3, message: `load ${code}: ${description}`, sourceId: url }));
  win.webContents.on('render-process-gone', (_event, details) => errors.push({ level: 3, message: `renderer gone: ${details.reason}` }));

  await win.loadFile(path.join(ROOT, 'index.html'));
  win.show();
  await wait(1800);

  const initial = await evaluate(win, `({title:document.title,schema:PROJECT_SCHEMA_VERSION,view:window.PLCTrainerMultiView?.view,automationApi:!!window.PLCTrainerAutomationLabs,modelApi:!!window.PLCTrainerImportedModels,viewButtons:document.querySelectorAll('.mv-view-btn').length,labTabs:document.querySelectorAll('.al-tab').length,window:[innerWidth,innerHeight]})`);
  check('v2.7 title and schema load', /v2\.7/.test(initial.title) && initial.schema === 9, initial);
  check('automation and imported-model APIs load', initial.automationApi && initial.modelApi, initial);
  check('five workspace views and four lab tabs exist', initial.viewButtons === 5 && initial.labTabs === 4, initial);
  await capture(win, '00-workshop-start');

  await click(win, '[data-view="palletizer"]');
  const hubReady = await poll(win, `document.querySelector('#mv-palletizer')?.classList.contains('show')&&window.PLCTrainerAutomationLabs?.activeLab==='servo2'`);
  check('automation workspace opens on 2-axis servo lab', hubReady);
  const modelsReady = await poll(win, `(()=>{const s=window.PLCTrainerImportedModels?.getStatus?.();return s&&(s.loaded.length>=9||s.failed.length>0)})()`, 15000);
  const modelStatus = await evaluate(win, `window.PLCTrainerImportedModels?.getStatus?.()`);
  check('nine required SoV-KDP GLB models load', modelsReady && modelStatus.loaded.length >= 9 && modelStatus.failed.length === 0, modelStatus);

  const servoLayout = await inspectLab(win, 'servo2');
  check('2-axis normal-window layout fits', servoLayout.fits && servoLayout.hostVisible && servoLayout.bodyMode, servoLayout);
  await click(win, '[data-servo-action="servo"]');
  await click(win, '[data-servo-action="home"]');
  const servoHomed = await poll(win, `['X','Y'].every(axis=>window.PLCTrainerAutomationLabs.state.labs.servo2.axes[axis].homed)`, 7000);
  check('2-axis servo-on and all-axis homing complete', servoHomed);
  await fill(win, '#al-linear-x', '300');
  await fill(win, '#al-linear-y', '200');
  await fill(win, '#al-linear-speed', '140');
  await click(win, '[data-servo-action="linear"]');
  await wait(650);
  const servoMoving = await evaluate(win, `(()=>{const s=window.PLCTrainerAutomationLabs.state.labs.servo2;return{linear:s.linear.active,X:s.axes.X.current,Y:s.axes.Y.current,status:document.querySelector('#al-servo-status')?.innerText}})()`);
  check('2-axis linear interpolation enters moving state', servoMoving.linear, servoMoving);
  await capture(win, '01-servo2-linear-motion');
  const servoDone = await poll(win, `(()=>{const s=window.PLCTrainerAutomationLabs.state.labs.servo2;return !s.linear.active&&!s.axes.X.busy&&!s.axes.Y.busy})()`, 18000);
  const servoFinal = await evaluate(win, `(()=>{const s=window.PLCTrainerAutomationLabs.state.labs.servo2;return{X:s.axes.X.current,Y:s.axes.Y.current,alarmX:s.axes.X.alarm,alarmY:s.axes.Y.alarm}})()`);
  check('2-axis interpolation reaches X300/Y200 without alarm', servoDone && Math.abs(servoFinal.X - 300) < 1 && Math.abs(servoFinal.Y - 200) < 1 && !servoFinal.alarmX && !servoFinal.alarmY, servoFinal);

  await click(win, '[data-lab="mps"]');
  const mpsLayout = await inspectLab(win, 'mps');
  check('MPS normal-window layout fits', mpsLayout.active === 'mps' && mpsLayout.fits, mpsLayout);
  await click(win, '[data-mps-action="steel"]');
  await click(win, '[data-mps-action="auto"]');
  await click(win, '[data-mps-output-index="14"]');
  await wait(950);
  const mpsMoving = await evaluate(win, `(()=>{const s=window.PLCTrainerAutomationLabs.state.labs.mps;return{running:s.auto.running,step:s.auto.state,items:s.workpieces.length,conveyor:s.outputBits[14],travel:s.workpieces[0]?.x,input14:s.inputBits[14]}})()`);
  check('MPS external PLC mode drives the physical conveyor', mpsMoving.running && mpsMoving.items === 1 && mpsMoving.conveyor && mpsMoving.travel>0.04, mpsMoving);
  await capture(win, '02-mps-auto-motion');
  await click(win, '[data-mps-output-index="12"]');
  const stopperExtended = await poll(win, `window.PLCTrainerAutomationLabs.state.labs.mps.inputBits[8]===true`, 1800);
  check('MPS O12 moves the original stopper plant and closes I8', stopperExtended);
  await click(win, '[data-mps-output-index="0"]');
  await wait(350);
  const supplyBeforeHold = await evaluate(win, `window.PLCTrainerAutomationLabs.state.labs.mps.actuators.supply.position`);
  await click(win, '[data-mps-output-index="1"]');
  await wait(350);
  const bistable = await evaluate(win, `(()=>{const s=window.PLCTrainerAutomationLabs.state.labs.mps;return{position:s.actuators.supply.position,nodeZ:window.PLCTrainerAutomationLabs.getSceneDiagnostics().mps?.supplyZ,fault:s.fault,both:s.outputBits[0]&&s.outputBits[1]}})()`);
  check('MPS bistable valve moves the original GLB node with both coils on', bistable.both && bistable.position>supplyBeforeHold && Math.abs(bistable.nodeZ-(-.0394-.0669*bistable.position))<.0002 && !bistable.fault, bistable);
  await click(win, '[data-mps-action="reset"]');
  const mpsReset = await evaluate(win, `(()=>{const s=window.PLCTrainerAutomationLabs.state.labs.mps;return !s.outputBits.some(Boolean)&&s.workpieces.length===0})()`);
  check('MPS plant reset returns outputs and workpieces to safe state', mpsReset);

  await click(win, '[data-lab="pneumatic"]');
  const pneumaticLayout = await inspectLab(win, 'pneumatic');
  check('pneumatic normal-window layout fits', pneumaticLayout.active === 'pneumatic' && pneumaticLayout.fits, pneumaticLayout);
  await click(win, '[data-editor-tools="pneumatic"] [data-editor-mode="AIR"]');
  const editorConnection = await evaluate(win, `(()=>{const e=window.PLCTrainerAutomationLabs.getEditor('pneumatic');if(!e.modules.has('service-unit')||!e.modules.has('air-distributor'))return{ready:false,modules:e.modules.size};const c=e.connect({moduleId:'service-unit',anchorId:'OUT'},{moduleId:'air-distributor',anchorId:'IN'});return{ready:true,mode:e.mode,modules:e.modules.size,connections:e.connections.size,kind:c.kind,visible:c.visual.visible}})()`);
  check('SoV AIR mode creates a live 3D tube between registered equipment ports', editorConnection.ready && editorConnection.mode === 'AIR' && editorConnection.connections === 1 && editorConnection.kind === 'air' && editorConnection.visible, editorConnection);
  await click(win, '[data-pneu-action="supply"]');
  const pressureReady = await poll(win, `window.PLCTrainerAutomationLabs.state.labs.pneumatic.service.outputBar>=4.9`, 2500);
  check('air supply and regulator reach 5 bar', pressureReady);

  // Exploratory fault path: simultaneous 5/2 coils must be flagged.
  await click(win, '[data-pneu-coil="A"]');
  await click(win, '[data-pneu-coil="B"]');
  const coilConflict = await poll(win, `window.PLCTrainerAutomationLabs.state.labs.pneumatic.faults.some(f=>f.code==='COIL_CONFLICT')`, 1500);
  check('simultaneous pneumatic coils raise valve conflict', coilConflict);
  await click(win, '[data-pneu-coil="A"]');
  await click(win, '[data-pneu-coil="B"]');
  await click(win, '[data-pneu-action="reset"]');
  const pneumaticReset = await evaluate(win, `window.PLCTrainerAutomationLabs.state.labs.pneumatic.faults.length===0`);
  check('pneumatic fault reset clears conflict', pneumaticReset);

  await click(win, '[data-pneu-action="auto"]');
  await wait(1300);
  const pneumaticMoving = await evaluate(win, `(()=>{const s=window.PLCTrainerAutomationLabs.state.labs.pneumatic;return{running:s.auto.running,step:s.auto.state,position:s.cylinder.position,pressure:s.service.outputBar}})()`);
  check('pneumatic automatic cycle enters extension motion', pneumaticMoving.running && pneumaticMoving.step === 'EXTEND' && pneumaticMoving.position > 0, pneumaticMoving);
  await capture(win, '03-pneumatic-extension');
  const pneumaticDone = await poll(win, `window.PLCTrainerAutomationLabs.state.labs.pneumatic.auto.state==='COMPLETE'`, 30000);
  const pneumaticFinal = await evaluate(win, `(()=>{const s=window.PLCTrainerAutomationLabs.state.labs.pneumatic;return{step:s.auto.state,cycleCount:s.auto.cycleCount,retracted:s.cylinder.retracted,faults:s.faults}})()`);
  check('pneumatic extend/dwell/retract cycle completes', pneumaticDone && pneumaticFinal.cycleCount >= 1 && pneumaticFinal.retracted && pneumaticFinal.faults.length === 0, pneumaticFinal);
  await click(win, '[data-pneu-action="supply"]');
  check('air supply toggles back off', await evaluate(win, `!window.PLCTrainerAutomationLabs.state.labs.pneumatic.source.on`));

  await click(win, '[data-lab="palletizer3d"]');
  const palletizerVisible = await evaluate(win, `(()=>{const root=document.querySelector('#p3-root')?.getBoundingClientRect(),canvas=document.querySelector('#p3-scene canvas')?.getBoundingClientRect();return{active:window.PLCTrainerAutomationLabs.activeLab,root:root&&{w:root.width,h:root.height},canvas:canvas&&{w:canvas.width,h:canvas.height},visible:!!canvas&&canvas.width>100&&canvas.height>100}})()`);
  check('existing 3-axis palletizer remains usable inside the hub', palletizerVisible.active === 'palletizer3d' && palletizerVisible.visible, palletizerVisible);
  await capture(win, '04-palletizer3d-hub');

  await click(win, '[data-lab="mps"]');
  win.setContentSize(1024, 700);
  await wait(650);
  const compactLayout = await inspectLab(win, 'mps');
  check('minimum-window MPS layout fits without shell clipping', compactLayout.fits && compactLayout.bodyMode && compactLayout.bodyOverflow.x === 'hidden' && compactLayout.bodyOverflow.y === 'hidden', compactLayout);
  await capture(win, '05-compact-mps');

  const persisted = await evaluate(win, `(()=>{const value=window.PLCTrainerAutomationLabs.exportState();return{schema:value.schemaVersion,activeLab:value.activeLab,hasServo:!!value.labs.servo2,hasMps:!!value.labs.mps,hasPneumatic:!!value.labs.pneumatic,editorLabs:Object.keys(value.editor||{}).length,pneumaticLinks:value.editor?.pneumatic?.connections?.length,savedInProject:!!S.automationLab}})()`);
  check('automation plant and 3D editor state are included in project state', persisted.schema === 1 && persisted.activeLab === 'mps' && persisted.hasServo && persisted.hasMps && persisted.hasPneumatic && persisted.editorLabs === 3 && persisted.pneumaticLinks === 1 && persisted.savedInProject, persisted);
  check('renderer has no console errors', errors.length === 0, errors);

  const result = {
    summary: { total: checks.length, passed: checks.filter(item => item.pass).length, failed: checks.filter(item => !item.pass).length },
    checks, modelStatus, warnings, errors, screenshots
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const failed = result.summary.failed > 0;
  win.destroy();
  app.exit(failed ? 1 : 0);
}).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
