// 결선 작업장 Electron 메인 프로세스
const { app, BrowserWindow, Menu, dialog, session } = require('electron');
const path = require('path');
const { version } = require('./package.json');

let mainWindow;
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
    networkAudit.failedRequests.push(`session:${details.url} · ${details.error}`);
  });
}

installMainProcessNetworkAudit();

function createWindow() {
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
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'build', 'renderer', 'index.html'));

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
        { role: 'toggleDevTools', label: '개발자 도구' },
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
              detail: `PLC/HMI/인버터 결선 연습 도구\n\n• XBC-DR32H, SV-iG5A, XBF-AH04A, EXP2-700, MD02 등 실장비 단자 매뉴얼 기반\n• 자동 라우팅, 시뮬레이션, 미션 학습 지원\n\nv${version}`,
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

app.whenReady().then(() => {
  installOfflineSessionPolicy();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
