const { contextBridge, ipcRenderer } = require('electron');

// Cầu nối an toàn giữa renderer (trang web trong app) và tiến trình chính —
// cho phép trang web gọi các thao tác cập nhật (kiểm tra / tải / cài đặt)
// mà không cần bật nodeIntegration.
contextBridge.exposeInMainWorld('vgUpdater', {
  isElectron: true,
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  quitAndInstall: () => ipcRenderer.invoke('updater:install'),
  onStatus: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
});
