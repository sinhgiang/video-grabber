// Cài đặt người dùng của ứng dụng, lưu trong thư mục dữ liệu riêng của người dùng
// (Electron: thư mục userData; chạy bằng npm start: ~/.video-grabber hoặc VG_DATA_DIR).
// Chỉ chứa công tắc (không có khoá hay phiên đăng nhập).
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = { autoUpdateYtdlp: true };

function dataDir() {
  return process.env.VG_DATA_DIR || path.join(os.homedir(), '.video-grabber');
}

function settingsFile() {
  return path.join(dataDir(), 'settings.json');
}

/** Đọc cài đặt; thiếu file/hỏng thì dùng mặc định. Chỉ nhận đúng khoá và đúng kiểu đã biết. */
function read() {
  const out = { ...DEFAULTS };
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (parsed && typeof parsed.autoUpdateYtdlp === 'boolean') out.autoUpdateYtdlp = parsed.autoUpdateYtdlp;
  } catch {
    // chưa có hoặc hỏng — dùng mặc định
  }
  return out;
}

/** Cập nhật cài đặt (bỏ qua khoá lạ / sai kiểu), ghi bằng tệp tạm rồi đổi tên để không hỏng nửa chừng. */
function update(patch) {
  const next = read();
  if (patch && typeof patch.autoUpdateYtdlp === 'boolean') next.autoUpdateYtdlp = patch.autoUpdateYtdlp;
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = settingsFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, settingsFile());
  return next;
}

module.exports = { read, update, dataDir, DEFAULTS };
