// Phiên đăng nhập của người dùng trên các nền tảng cần đăng nhập mới xem được video (Facebook,
// Instagram). BẢO MẬT: phiên đăng nhập là DỮ LIỆU RIÊNG của người dùng — chỉ nằm trong "partition"
// của Chromium trên máy họ (do Electron mã hoá lúc lưu), không ghi vào nhật ký, không gửi đi
// đâu, và không bao giờ đi qua API/IPC: chỉ xuất ra một tệp cookie tạm (quyền 0600) ngay trước khi
// gọi yt-dlp rồi xoá ngay sau đó (xem withCookieFile).
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROVIDERS = {
  facebook: {
    key: 'facebook',
    label: 'Facebook',
    loginUrl: 'https://www.facebook.com/login',
    // tên miền của link video thuộc nền tảng này
    urlHosts: ['facebook.com', 'fb.com', 'fb.watch'],
    // cookie được xuất cho yt-dlp (chỉ các tên miền này)
    cookieDomains: ['facebook.com', 'fb.com'],
    // có đủ các cookie này thì coi như đã đăng nhập
    sessionCookies: ['c_user', 'xs'],
    // cửa sổ đăng nhập chỉ được duyệt tới các tên miền này
    navHosts: ['facebook.com', 'fb.com', 'fbcdn.net', 'facebook.net', 'fbsbx.com', 'messenger.com'],
  },
  instagram: {
    key: 'instagram',
    label: 'Instagram',
    loginUrl: 'https://www.instagram.com/accounts/login/',
    urlHosts: ['instagram.com'],
    cookieDomains: ['instagram.com'],
    sessionCookies: ['sessionid'],
    navHosts: ['instagram.com', 'cdninstagram.com', 'facebook.com', 'fbcdn.net', 'facebook.net', 'fbsbx.com'],
  },
};

function hostMatches(hostname, domains) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return domains.some((d) => h === d || h.endsWith('.' + d));
}

/** Link video thuộc nền tảng nào cần đăng nhập (khoá provider), hoặc null. */
function providerForUrl(url) {
  let hostname;
  try {
    hostname = new URL(String(url)).hostname;
  } catch {
    return null;
  }
  for (const p of Object.values(PROVIDERS)) {
    if (hostMatches(hostname, p.urlHosts)) return p.key;
  }
  return null;
}

/** Cửa sổ đăng nhập có được phép mở địa chỉ này không (https và đúng tên miền của nền tảng). */
function isAllowedNavigation(providerKey, url) {
  const p = PROVIDERS[providerKey];
  if (!p) return false;
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && hostMatches(u.hostname, p.navHosts);
  } catch {
    return false;
  }
}

/** Trang đang ở giữa luồng đăng nhập/xác minh — chưa nên tự đóng cửa sổ. */
function isLoginFlowUrl(url) {
  try {
    const { pathname } = new URL(String(url));
    return /\/(login|checkpoint|two_step_verification|recover|device-based|confirmemail|accounts\/(login|onetap|suspended))/i.test(pathname);
  } catch {
    return true;
  }
}

/** Danh sách cookie (dạng Electron) đã có đủ cookie đăng nhập của nền tảng chưa. */
function hasSessionCookies(providerKey, cookies) {
  const p = PROVIDERS[providerKey];
  if (!p || !Array.isArray(cookies)) return false;
  const names = new Set(
    cookies
      .filter((c) => c && c.value && hostMatches(String(c.domain || '').replace(/^\./, ''), p.cookieDomains))
      .map((c) => c.name)
  );
  return p.sessionCookies.every((n) => names.has(n));
}

const THIRTY_DAYS = 30 * 24 * 3600;

/**
 * Đổi danh sách cookie (dạng Electron) thành tệp cookie Netscape cho yt-dlp, chỉ giữ cookie của
 * tên miền nền tảng. Bỏ cookie có tab/xuống dòng trong tên hoặc giá trị để không chèn được dòng
 * giả vào tệp.
 */
function toNetscape(providerKey, cookies, nowSec = Math.floor(Date.now() / 1000)) {
  const p = PROVIDERS[providerKey];
  if (!p) return null;
  const lines = ['# Netscape HTTP Cookie File', '# Tệp tạm của Video Grabber — tự xoá sau khi tải xong.'];
  for (const c of cookies || []) {
    if (!c || !c.name || typeof c.value !== 'string') continue;
    const domain = String(c.domain || '');
    if (!hostMatches(domain.replace(/^\./, ''), p.cookieDomains)) continue;
    const bad = /[\t\r\n]/;
    if ([c.name, c.value, domain, c.path || '/'].some((s) => bad.test(String(s)))) continue;
    // Cookie phiên (không có hạn) trong tệp tạm này được đặt hạn 30 ngày để yt-dlp không bỏ qua.
    const expiry = c.expirationDate ? Math.floor(c.expirationDate) : nowSec + THIRTY_DAYS;
    lines.push(
      [
        (c.httpOnly ? '#HttpOnly_' : '') + domain,
        domain.startsWith('.') ? 'TRUE' : 'FALSE',
        c.path || '/',
        c.secure ? 'TRUE' : 'FALSE',
        String(expiry),
        c.name,
        c.value,
      ].join('\t')
    );
  }
  return lines.join('\n') + '\n';
}

// ---- Cầu nối tới phần Electron (cửa sổ đăng nhập). Ở chế độ web (npm start) không có. ----
let impl = null;

/** Electron đăng ký: { login(key), status(key), exportCookies(key), logout(key) }. */
function register(implementation) {
  impl = implementation;
}

function isAvailable() {
  return !!impl;
}

async function status(providerKey) {
  if (!impl || !PROVIDERS[providerKey]) return { available: false, loggedIn: false };
  return { available: true, loggedIn: !!(await impl.status(providerKey)) };
}

async function login(providerKey) {
  if (!impl || !PROVIDERS[providerKey]) throw new Error('Đăng nhập trong ứng dụng chỉ có ở bản ứng dụng desktop.');
  return { loggedIn: !!(await impl.login(providerKey)) };
}

async function logout(providerKey) {
  if (!impl || !PROVIDERS[providerKey]) return;
  await impl.logout(providerKey);
}

/**
 * Xuất cookie của phiên đã lưu ra một tệp tạm (chỉ chủ tài khoản máy đọc được), chạy fn(tệp),
 * rồi xoá tệp ngay dù fn thành công hay lỗi. Trả null (không gọi fn) nếu chưa có phiên.
 */
async function withCookieFile(providerKey, fn) {
  if (!impl || !PROVIDERS[providerKey]) return null;
  const text = await impl.exportCookies(providerKey);
  if (!text) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-ck-'));
  const file = path.join(dir, 'cookies.txt');
  fs.writeFileSync(file, text, { mode: 0o600 });
  try {
    return { value: await fn(file) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = {
  PROVIDERS,
  providerForUrl,
  isAllowedNavigation,
  isLoginFlowUrl,
  hasSessionCookies,
  toNetscape,
  register,
  isAvailable,
  status,
  login,
  logout,
  withCookieFile,
};
