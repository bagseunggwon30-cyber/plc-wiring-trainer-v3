// 결선 작업장 Electron 메인 프로세스
const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const pkg = require('./package.json');

let mainWindow;
const appTitle = `결선 작업장 v${pkg.version}`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    title: appTitle,
    backgroundColor: '#1a1a1a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  const entry = path.join(__dirname, 'index.html');
  mainWindow.loadFile(entry);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 교육용 로컬 앱은 임의 팝업과 외부 페이지 이동을 허용하지 않는다.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  const template = [
    {
      label: '파일',
      submenu: [
        { label: '새로고침', accelerator: 'F5', click: () => mainWindow?.reload() },
        { label: '하드 새로고침', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow?.webContents.reloadIgnoringCache() },
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
              title: appTitle,
              message: '박승권의 결선 작업장',
              detail: `PLC/HMI/인버터 결선 및 자동화 연습 도구\n\n• 역할 기반 다중 장비 미션\n• 전원·접점·통신·아날로그 검증\n• LS XGB 랙·슬롯 및 XG5000 P 주소 미리보기\n• Modbus RTU·실제 아날로그 값·iG5A 가감속\n• EOCR 트립·MC 자기유지·인버터 정역 시뮬레이션\n• 3축 팔레타이징·2축 서보·MPS·공압 3D 실습\n• LS L7S/XML 및 Mitsubishi QD75/MR-J4 교육 프로필\n\nv${pkg.version}`,
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

app.setAppUserModelId('com.bark.wiring-trainer');
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
