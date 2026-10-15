// Tự cập nhật yt-dlp khi khởi động: Facebook/TikTok/… đổi trang liên tục nên trình trích xuất của
// yt-dlp hay hỏng; bản mới thường sửa được mà không cần phát hành lại ứng dụng.
//
// - Bản mới tải vào thư mục dữ liệu của người dùng (không ghi đè bản đóng gói trong thư mục cài đặt).
// - Chỉ tải từ github.com/yt-dlp/yt-dlp, và CHỈ dùng nếu SHA-256 khớp tệp SHA2-256SUMS của cùng
//   bản phát hành và bản tải về chạy được (--version trả đúng số bản).
// - Có thể tắt trong "Tuỳ chọn nâng cao" (cài đặt autoUpdateYtdlp).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const settings = require('./settings');

const REPO = 'yt-dlp/yt-dlp';
const MAX_BINARY_BYTES = 200 * 1024 * 1024;

function assetName(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos';
  if (platform === 'linux' && arch === 'x64') return 'yt-dlp_linux';
  return null;
}

function updatedDir() {
  return path.join(settings.dataDir(), 'bin');
}

function sidecarFile(asset) {
  return path.join(updatedDir(), asset + '.json');
}

/** So sánh số bản kiểu YYYY.MM.DD[.N]; trả số dương nếu a mới hơn b. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Đường dẫn bản yt-dlp đã tự cập nhật, nếu có và còn hợp lệ cho bản ứng dụng này (bản ứng dụng đổi
 * thì bỏ bản cũ vì ứng dụng mới có thể đóng gói yt-dlp mới hơn — việc cập nhật sẽ đánh giá lại).
 */
function findUpdatedBinary(appVersion = require('../package.json').version) {
  const asset = assetName();
  if (!asset) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(sidecarFile(asset), 'utf8'));
    const file = path.join(updatedDir(), asset);
    if (meta && meta.appVersion === appVersion && fs.existsSync(file)) return file;
  } catch {
    // chưa có
  }
  return null;
}

function getVersionOf(binary) {
  return new Promise((resolve, reject) => {
    execFile(binary, ['--version'], { timeout: 30_000, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout).trim());
    });
  });
}

async function fetchBuffer(fetchImpl, url, limit) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'video-grabber-updater' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} khi tải ${new URL(url).pathname}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit) throw new Error('Tệp tải về quá lớn');
  return buf;
}

let running = null;

/**
 * Kiểm tra và cập nhật yt-dlp. Không bao giờ ném lỗi: trả { status, ... }.
 * status: 'disabled' | 'unsupported' | 'up-to-date' | 'updated' | 'error'
 */
function checkAndUpdate(deps = {}) {
  if (running) return running;
  running = doUpdate(deps).finally(() => {
    running = null;
  });
  return running;
}

async function doUpdate({
  fetchImpl = globalThis.fetch,
  getVersion = getVersionOf,
  currentBinary,
  setBinaryPath,
  appVersion = require('../package.json').version,
} = {}) {
  try {
    if (!settings.read().autoUpdateYtdlp) return { status: 'disabled' };
    const asset = assetName();
    if (!asset) return { status: 'unsupported' };

    const current = await getVersion(currentBinary);
    const rel = await (
      await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { 'User-Agent': 'video-grabber-updater', Accept: 'application/vnd.github+json' },
      })
    ).json();
    const tag = rel && rel.tag_name;
    if (!tag || !/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(tag)) throw new Error('Không đọc được số bản yt-dlp mới nhất');
    if (compareVersions(tag, current) <= 0) return { status: 'up-to-date', version: current };

    const base = `https://github.com/${REPO}/releases/download/${tag}`;
    const [binary, sums] = await Promise.all([
      fetchBuffer(fetchImpl, `${base}/${asset}`, MAX_BINARY_BYTES),
      fetchBuffer(fetchImpl, `${base}/SHA2-256SUMS`, 1024 * 1024),
    ]);
    const line = sums
      .toString('utf8')
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .find((p) => p.length === 2 && p[1].replace(/^\*/, '') === asset);
    const actual = crypto.createHash('sha256').update(binary).digest('hex');
    if (!line || line[0].toLowerCase() !== actual) throw new Error('SHA-256 của bản yt-dlp tải về không khớp, bỏ qua bản này');

    fs.mkdirSync(updatedDir(), { recursive: true });
    const finalPath = path.join(updatedDir(), asset);
    const newPath = finalPath + '.new';
    fs.writeFileSync(newPath, binary, { mode: 0o755 });
    let got;
    try {
      got = await getVersion(newPath);
    } catch (e) {
      fs.rmSync(newPath, { force: true });
      throw new Error('Bản yt-dlp mới tải về không chạy được: ' + e.message);
    }
    if (got !== tag) {
      fs.rmSync(newPath, { force: true });
      throw new Error(`Bản tải về báo số bản ${got}, không khớp ${tag}`);
    }
    fs.renameSync(newPath, finalPath);
    fs.writeFileSync(sidecarFile(asset), JSON.stringify({ version: tag, appVersion }));
    if (setBinaryPath) setBinaryPath(finalPath);
    return { status: 'updated', from: current, version: tag };
  } catch (err) {
    return { status: 'error', message: (err && err.message) || String(err) };
  }
}

module.exports = { checkAndUpdate, findUpdatedBinary, compareVersions, assetName };
