// Cửa sổ đăng nhập NGAY TRONG ỨNG DỤNG (Facebook, Instagram) để tải video cần đăng nhập.
//
// BẢO MẬT — phiên đăng nhập là dữ liệu riêng của người dùng:
//  - Mỗi nền tảng có một "partition" riêng của Chromium (persist:vg-login-<nền tảng>), tách khỏi
//    cửa sổ chính; Electron tự mã hoá cookie khi lưu trên đĩa của chính máy này.
//  - Cookie không đi qua IPC/preload/API và không bao giờ được ghi vào nhật ký: chỉ exportCookies()
//    trả chuỗi cho lib/sessions.js ghi vào một tệp tạm (0600) ngay trước khi gọi yt-dlp rồi xoá.
//  - Cửa sổ chỉ duyệt tới tên miền của nền tảng (https), từ chối mọi quyền (camera, vị trí…),
//    bật sandbox + contextIsolation, tắt nodeIntegration, không có preload.
const sessionsLib = require('../lib/sessions');

const partitionOf = (key) => `persist:vg-login-${key}`;

/**
 * @param {{ BrowserWindow: any, session: any, getParent: () => any }} electron
 */
function createLoginManager({ BrowserWindow, session, getParent }) {
  let openLogin = null; // lời hứa của cửa sổ đang mở (chỉ một cửa sổ cùng lúc)

  function sessionOf(key) {
    const ses = session.fromPartition(partitionOf(key));
    // Facebook từ chối trình duyệt lạ: bỏ phần "Electron/x" và tên app khỏi User-Agent.
    ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|video-grabber)\/\S+/gi, ''));
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    return ses;
  }

  async function cookiesOf(key) {
    return sessionOf(key).cookies.get({});
  }

  async function status(key) {
    return sessionsLib.hasSessionCookies(key, await cookiesOf(key));
  }

  async function exportCookies(key) {
    const cookies = await cookiesOf(key);
    if (!sessionsLib.hasSessionCookies(key, cookies)) return null;
    return sessionsLib.toNetscape(key, cookies);
  }

  async function logout(key) {
    const ses = sessionOf(key);
    await ses.clearStorageData();
    await ses.clearCache();
  }

  function login(key) {
    if (openLogin) return openLogin;
    const provider = sessionsLib.PROVIDERS[key];
    const ses = sessionOf(key);
    const parent = getParent && getParent();

    openLogin = new Promise((resolve) => {
      const win = new BrowserWindow({
        width: 600,
        height: 780,
        title: `Đăng nhập ${provider.label}`,
        parent: parent && !parent.isDestroyed() ? parent : undefined,
        modal: !!(parent && !parent.isDestroyed()),
        autoHideMenuBar: true,
        webPreferences: {
          partition: partitionOf(key),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false,
        },
      });
      win.removeMenu();

      const wc = win.webContents;
      wc.setWindowOpenHandler(({ url }) => {
        if (sessionsLib.isAllowedNavigation(key, url)) wc.loadURL(url);
        return { action: 'deny' };
      });
      wc.on('will-navigate', (e, url) => {
        if (!sessionsLib.isAllowedNavigation(key, url)) e.preventDefault();
      });

      // Khi đã có cookie đăng nhập và trang không còn ở giữa luồng đăng nhập/xác minh → tự đóng.
      let closeTimer = null;
      const maybeFinish = async () => {
        if (win.isDestroyed() || closeTimer) return;
        if (isLoginFlowUrl(wc.getURL())) return;
        if (!(await status(key))) return;
        closeTimer = setTimeout(() => !win.isDestroyed() && win.close(), 1500);
      };
      wc.on('did-navigate', maybeFinish);
      wc.on('did-navigate-in-page', maybeFinish);
      wc.on('did-finish-load', maybeFinish);

      win.on('closed', async () => {
        clearTimeout(closeTimer);
        try {
          await ses.cookies.flushStore();
        } catch {
          // không sao: Chromium vẫn tự ghi định kỳ
        }
        openLogin = null;
        resolve(await status(key).catch(() => false));
      });

      win.loadURL(provider.loginUrl).catch(() => {
        // không mở được trang (mất mạng…) — để cửa sổ mở cho người dùng tự thử lại hoặc đóng
      });
    });
    return openLogin;
  }

  return { login, status, exportCookies, logout };
}

const isLoginFlowUrl = sessionsLib.isLoginFlowUrl;

module.exports = { createLoginManager, partitionOf };
