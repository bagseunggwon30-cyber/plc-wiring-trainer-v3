const { contextBridge, ipcRenderer } = require('electron');

const SAVE_REVIEW_PDF_CHANNEL = 'review-report:save-pdf';
const XGSIM_CHANNELS = Object.freeze({
  selectProject: 'xgsim:select-project',
  probe: 'xgsim:probe', connect: 'xgsim:connect', readSnapshot: 'xgsim:read-snapshot',
  writeInputImage: 'xgsim:write-input-image', getStatus: 'xgsim:get-status', disconnect: 'xgsim:disconnect',
});

contextBridge.exposeInMainWorld('WorkshopDesktop', Object.freeze({
  saveReportPdf(html, filename) {
    return ipcRenderer.invoke(SAVE_REVIEW_PDF_CHANNEL, { html, filename });
  },
  xgSim: Object.freeze({
    selectProject() { return ipcRenderer.invoke(XGSIM_CHANNELS.selectProject); },
    probe(payload) { return ipcRenderer.invoke(XGSIM_CHANNELS.probe, payload); },
    connect(payload) { return ipcRenderer.invoke(XGSIM_CHANNELS.connect, payload); },
    readSnapshot() { return ipcRenderer.invoke(XGSIM_CHANNELS.readSnapshot); },
    writeInputImage(payload) { return ipcRenderer.invoke(XGSIM_CHANNELS.writeInputImage, payload); },
    getStatus() { return ipcRenderer.invoke(XGSIM_CHANNELS.getStatus); },
    disconnect() { return ipcRenderer.invoke(XGSIM_CHANNELS.disconnect); },
  }),
}));
