// Bảo mật phiên đăng nhập (dữ liệu riêng của người dùng): kiểm bằng cách đọc mã nguồn thật.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const files = ['server.js', 'lib/escalation.js', 'lib/sessions.js', 'lib/settings.js', 'lib/ytdlp.js', 'lib/ytdlp-update.js', 'electron/login.js', 'electron/main.js'];

test('cửa sổ đăng nhập: sandbox + contextIsolation, tắt nodeIntegration, không preload, không tắt webSecurity, từ chối mọi quyền', () => {
  const src = read('electron/login.js');
  assert.match(src, /sandbox:\s*true/);
  assert.match(src, /contextIsolation:\s*true/);
  assert.match(src, /nodeIntegration:\s*false/);
  assert.match(src, /partition:\s*partitionOf\(key\)/);
  assert.doesNotMatch(src, /webSecurity:\s*false/);
  assert.doesNotMatch(src, /preload\s*:/);
  assert.match(src, /setPermissionRequestHandler\(\(_wc, _perm, cb\) => cb\(false\)\)/);
  assert.match(src, /will-navigate/);
  assert.match(src, /setWindowOpenHandler/);
});

test('partition đăng nhập tách riêng từng nền tảng và tách khỏi cửa sổ chính', () => {
  const { partitionOf } = require('../electron/login');
  assert.strictEqual(partitionOf('facebook'), 'persist:vg-login-facebook');
  assert.notStrictEqual(partitionOf('facebook'), partitionOf('instagram'));
  assert.doesNotMatch(read('electron/main.js'), /partition/); // cửa sổ chính dùng phiên mặc định
});

test('không có lệnh console.* nào in cookie / phiên / tệp cookie', () => {
  for (const f of files) {
    const src = read(f);
    const calls = src.match(/console\.(log|error|warn|info|debug)\([^;]*\);?/g) || [];
    for (const c of calls) {
      assert.doesNotMatch(c, /cookie|session|exportCookies|toNetscape|cookies\.get/i, `${f}: ${c}`);
    }
  }
});

test('cookie không đi qua preload/IPC: preload chỉ có hàm cập nhật, không có đăng nhập/cookie', () => {
  const src = read('electron/preload.js');
  assert.doesNotMatch(src, /cookie|login|session/i);
  assert.doesNotMatch(read('electron/main.js'), /ipcMain\.handle\('[^']*(cookie|login|session)/i);
});

test('API chỉ trả đã/chưa đăng nhập: không route nào của server trả hay ghi cookie ra', () => {
  const src = read('server.js');
  assert.doesNotMatch(src, /exportCookies|toNetscape|withCookieFile|cookies\.get/);
  // các route đụng tới phiên/cài đặt đều đi qua localOnly (chặn Origin/Host lạ)
  const routes = src.match(/app\.(get|post)\('\/api\/(login|settings)[^']*',[^)]*\)/g) || [];
  assert.ok(routes.length >= 5, 'phải có đủ các route đăng nhập/cài đặt');
  for (const r of routes) assert.match(r, /localOnly/, r);
});

test('tệp cookie tạm chỉ được ghi trong withCookieFile (quyền 0600) và luôn bị xoá trong finally', () => {
  const src = read('lib/sessions.js');
  assert.match(src, /mode:\s*0o600/);
  assert.match(src, /finally\s*\{\s*fs\.rmSync\(dir,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/);
  // ngoài sessions.js không nơi nào tự ghi tệp cookie
  for (const f of files.filter((x) => x !== 'lib/sessions.js')) {
    assert.doesNotMatch(read(f), /writeFileSync\([^)]*cookie/i, f);
  }
});

test('cài đặt (settings.json) không chứa khoá hay phiên: chỉ công tắc đã biết', () => {
  const { DEFAULTS } = require('../lib/settings');
  assert.deepStrictEqual(Object.keys(DEFAULTS), ['autoUpdateYtdlp']);
});

test('yt-dlp chỉ nhận đường dẫn tệp cookie, không nhận giá trị cookie trên dòng lệnh', () => {
  const src = read('lib/ytdlp.js');
  assert.match(src, /args\.push\('--cookies', cookieFile\)/);
  assert.doesNotMatch(src, /--add-header|Cookie:/i);
});
