// 결선 작업장 Electron 메인 프로세스
const { app, BrowserWindow, Menu, dialog, ipcMain, session } = require('electron');
const { writeFile } = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { version } = require('./package.json');
const { XgSimSessionService } = require('./src/main/xgsim-session-service');
const { inspectXgSimProjectFile } = require('./src/main/xgsim-project-file');

let mainWindow;
const SAVE_REVIEW_PDF_CHANNEL = 'review-report:save-pdf';
const XGSIM_CHANNELS = Object.freeze({
  selectProject: 'xgsim:select-project',
  probe: 'xgsim:probe',
  connect: 'xgsim:connect',
  readSnapshot: 'xgsim:read-snapshot',
  writeInputImage: 'xgsim:write-input-image',
  getStatus: 'xgsim:get-status',
  disconnect: 'xgsim:disconnect',
});
let xgSimService;
let xgSimShutdownStarted = false;
const networkAudit = { externalRequests: [], failedRequests: [] };
globalThis.__WIRING_NETWORK_AUDIT__ = networkAudit;

function installMainProcessNetworkAudit() {
  if (process.env.WIRING_E2E_NETWORK_AUDIT !== '1') return;
  const blocked = (url) => {
    networkAudit.externalRequests.push(`main:${url}`);
    throw new Error(`Offline policy blocked main-process network request: ${url}`);
  };
  const requestUrl = (protocol, input) => {
    if (typeof input === 'string' || input instanceof URL) return String(input);
    const host = input?.hostname || input?.host || 'unknown-host';
    const port = input?.port ? `:${input.port}` : '';
    return `${input?.protocol || protocol}//${host}${port}${input?.path || '/'}`;
  };
  for (const [name, protocol] of [['http', 'http:'], ['https', 'https:']]) {
    const client = require(name);
    for (const method of ['request', 'get']) {
      const original = client[method];
      client[method] = function auditedRequest(...args) {
        blocked(requestUrl(protocol, args[0]));
        return original.apply(this, args);
      };
    }
  }
  if (typeof globalThis.fetch === 'function') {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (...args) => {
      blocked(String(args[0]));
      return originalFetch(...args);
    };
  }
}

function installOfflineSessionPolicy() {
  const networkFilter = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] };
  session.defaultSession.webRequest.onBeforeRequest(networkFilter, (details, callback) => {
    networkAudit.externalRequests.push(`session:${details.url}`);
    callback({ cancel: true });
  });
  session.defaultSession.webRequest.onErrorOccurred((details) => {
    // A renderer reload or view teardown can cancel an in-flight local GLB.
    // That is expected navigation cleanup, not an offline/runtime load failure.
    if (details.error === 'net::ERR_ABORTED' && details.url.startsWith('file:')) return;
    networkAudit.failedRequests.push(`session:${details.url} · ${details.error}`);
  });
}

installMainProcessNetworkAudit();

function createWindow() {
  const rendererEntry = path.join(__dirname, 'build', 'renderer', 'index.html');
  const rendererUrl = pathToFileURL(rendererEntry).href;
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    title: `결선 작업장 v${version}`,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  const preventExternalNavigation = (event, targetUrl) => {
    if (targetUrl !== rendererUrl) event.preventDefault();
  };
  mainWindow.webContents.on('will-navigate', preventExternalNavigation);
  mainWindow.webContents.on('will-redirect', preventExternalNavigation);
  void mainWindow.loadFile(rendererEntry);

  // 앱 메뉴
  const template = [
    {
      label: '파일',
      submenu: [
        { label: '새로고침', accelerator: 'F5', click: () => mainWindow.reload() },
        { label: '하드 새로고침', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: '종료', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ]
    },
    {
      label: '보기',
      submenu: [
        { role: 'zoomIn', label: '확대' },
        { role: 'zoomOut', label: '축소' },
        { role: 'resetZoom', label: '기본 크기' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체화면' },
        ...(!app.isPackaged || process.env.WIRING_ENABLE_DEVTOOLS === '1'
          ? [{ role: 'toggleDevTools', label: '개발자 도구' }]
          : []),
      ]
    },
    {
      label: '도움말',
      submenu: [
        {
          label: '정보',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: `결선 작업장 v${version}`,
              message: '박승권의 결선 작업장',
              detail: `PLC 제어반 결선 연습·사전 검토 도구\n\n• 전원과 귀로가 모두 완성된 폐회로 판정\n• 연습과 검토에 동일한 v3 회로 엔진 사용\n• 검토 통과는 입력된 범위의 사전 결선 검토이며 통전 승인이 아님\n\nv${version}`,
              buttons: ['확인']
            });
          }
        },
        {
          label: '단축키 안내',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '단축키',
              message: '단축키 모음',
              detail: 'V — 선택 모드\nW — 결선 모드\nSpace — 화면 이동\nF — 화면 맞춤\n+/- — 줌\n0 — 100%\nL/R — 좌/우 패널 토글\nS — 시뮬레이션 ON/OFF\n/ — 부품 검색\nDel — 선택 항목 삭제\nEsc — 취소\nCtrl+Z — 실행 취소',
              buttons: ['확인']
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function installReviewReportPdfHandler() {
  ipcMain.handle(SAVE_REVIEW_PDF_CHANNEL, async (event, request) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted PDF export sender.');
    const html = typeof request?.html === 'string' ? request.html : '';
    if (!html.startsWith('<!doctype html>') || html.length > 5_000_000) throw new Error('Invalid review report HTML.');
    const requestedName = typeof request?.filename === 'string' ? request.filename : 'prewire-review.pdf';
    const filename = requestedName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\.+$/g, '').slice(0, 120) || 'prewire-review.pdf';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '사전 결선 검토 PDF 저장',
      defaultPath: path.join(app.getPath('documents'), filename.endsWith('.pdf') ? filename : `${filename}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };

    const reportWindow = new BrowserWindow({
      show: false,
      parent: mainWindow,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false },
    });
    reportWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      await reportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await reportWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
      await writeFile(result.filePath, pdf);
      return { saved: true, filePath: result.filePath };
    } finally {
      if (!reportWindow.isDestroyed()) reportWindow.destroy();
    }
  });
}

function installXgSimRuntimeHandlers() {
  const hostPath = app.isPackaged
    ? path.join(process.resourcesPath, 'native', 'xgsim-host', 'xgsim-host-x86.exe')
    : path.join(__dirname, 'native', 'xgsim-host', 'bin', 'Release', 'xgsim-host-x86.exe');
  xgSimService = new XgSimSessionService({ hostPath });
  const trusted = (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted XG-SIM IPC sender.');
  };
  ipcMain.handle(XGSIM_CHANNELS.selectProject, async (event) => {
    trusted(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'XG-SIM 기능시험 프로젝트 선택',
      properties: ['openFile'],
      filters: [{ name: 'XG5000 project', extensions: ['xgwx'] }],
    });
    if (result.canceled || result.filePaths.length !== 1) return { selected: false };
    return { selected: true, reference: await inspectXgSimProjectFile(result.filePaths[0]) };
  });
  ipcMain.handle(XGSIM_CHANNELS.probe, async (event, payload) => { trusted(event); return xgSimService.probe(payload); });
  ipcMain.handle(XGSIM_CHANNELS.connect, async (event, payload) => { trusted(event); return xgSimService.connect(payload); });
  ipcMain.handle(XGSIM_CHANNELS.readSnapshot, async (event) => { trusted(event); return xgSimService.readSnapshot(); });
  ipcMain.handle(XGSIM_CHANNELS.writeInputImage, async (event, payload) => { trusted(event); return xgSimService.writeInputImage(payload); });
  ipcMain.handle(XGSIM_CHANNELS.getStatus, async (event) => { trusted(event); return xgSimService.getStatus(); });
  ipcMain.handle(XGSIM_CHANNELS.disconnect, async (event) => { trusted(event); return xgSimService.disconnect(); });
}

app.whenReady().then(() => {
  installOfflineSessionPolicy();
  installReviewReportPdfHandler();
  installXgSimRuntimeHandlers();
  createWindow();
});

app.on('before-quit', (event) => {
  if (!xgSimService || xgSimShutdownStarted) return;
  event.preventDefault();
  xgSimShutdownStarted = true;
  void xgSimService.close().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
