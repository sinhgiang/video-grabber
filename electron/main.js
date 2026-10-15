const { app, BrowserWindow, shell, Menu, ipcMain, session } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const { startServer } = require('./start-server');
const { createLoginManager } = require('./login');
const sessions = require('../lib/sessions');

const PREFERRED_PORT = 3000;
let mainWindow;
let serverPort;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 720,
    minHeight: 600,
    backgroundColor: '#0b0b14',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Mở link ngoài (vd. GitHub) bằng trình duyệt mặc định thay vì trong app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Tự động kiểm tra / tải / cài bản cập nhật mới ngay trong app —
// người dùng chỉ cần bấm "Có" trên banner, không cần mở trình duyệt
// hay tự tay chạy file cài đặt.
function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:status', { channel, ...payload });
    }
  };

  autoUpdater.on('checking-for-update', () => send('checking'));
  autoUpdater.on('update-available', (info) => send('available', { version: info.version }));
  autoUpdater.on('update-not-available', () => send('not-available'));
  autoUpdater.on('download-progress', (p) => send('progress', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', () => send('downloaded'));
  autoUpdater.on('error', (err) => send('error', { message: (err && err.message) || String(err) }));

  ipcMain.handle('updater:check', async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      send('error', { message: err.message });
    }
  });

  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      send('error', { message: err.message });
    }
  });

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  // Tự kiểm tra ngay khi mở app, và định kỳ mỗi 2 giờ trong lúc đang chạy
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 2 * 60 * 60 * 1000);
}

app.whenReady().then(async () => {
  // Thư mục dữ liệu riêng của người dùng: cài đặt, bản yt-dlp tự cập nhật. Đặt TRƯỚC khi nạp server.
  process.env.VG_DATA_DIR = app.getPath('userData');
  // Tự cập nhật yt-dlp khi khởi động (tắt được ở "Tuỳ chọn nâng cao")
  process.env.VG_STARTUP_UPDATE = '1';
  // Cửa sổ đăng nhập trong ứng dụng (Facebook, Instagram) cho server dùng khi video cần đăng nhập
  sessions.register(createLoginManager({ BrowserWindow, session, getParent: () => mainWindow }));

  // Chạy server Express ngay trong tiến trình chính của Electron —
  // người dùng không cần mở terminal, chỉ cần double-click app.
  serverPort = await startServer(path.join(__dirname, '..', 'server.js'), PREFERRED_PORT);
  createWindow();

  // Cơ chế auto-update chỉ hoạt động với bản đã đóng gói/cài đặt (NSIS),
  // không chạy khi đang chạy trực tiếp từ mã nguồn lúc phát triển.
  if (app.isPackaged) {
    setupAutoUpdater();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
