const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

const PORT = 3000;
let mainWindow;

// Chạy server Express ngay trong tiến trình chính của Electron —
// người dùng không cần mở terminal, chỉ cần double-click app.
function startServer() {
  process.env.PORT = String(PORT);
  require(path.join(__dirname, '..', 'server.js'));
}

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
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Mở link ngoài (vd. GitHub) bằng trình duyệt mặc định thay vì trong app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
