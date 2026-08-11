const { contextBridge } = require('electron');

// Renderer에는 필요한 읽기 전용 런타임 정보만 노출한다.
contextBridge.exposeInMainWorld('desktopApp', Object.freeze({
  platform: process.platform,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  isElectron: true,
}));
