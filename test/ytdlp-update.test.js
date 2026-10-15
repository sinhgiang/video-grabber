const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-test-data-'));
process.env.VG_DATA_DIR = dataDir;

const settings = require('../lib/settings');
const updater = require('../lib/ytdlp-update');

const ASSET = updater.assetName();
const BIN = Buffer.from('FAKE-YTDLP-BINARY');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
test.beforeEach(() => {
  fs.rmSync(path.join(dataDir, 'bin'), { recursive: true, force: true });
  fs.rmSync(path.join(dataDir, 'settings.json'), { force: true });
});

function fakeFetch({ tag = '2026.10.10', binary = BIN, sums, calls = [] } = {}) {
  return async (url) => {
    calls.push(url);
    const body = (b, status = 200) => ({ ok: status === 200, status, arrayBuffer: async () => b, json: async () => JSON.parse(Buffer.from(b).toString()) });
    if (url.includes('api.github.com')) return body(Buffer.from(JSON.stringify({ tag_name: tag })));
    if (url.endsWith('/SHA2-256SUMS')) return body(Buffer.from(sums ?? `${sha(binary)}  ${ASSET}\n`));
    if (url.endsWith('/' + ASSET)) return body(binary);
    return body(Buffer.alloc(0), 404);
  };
}

test('compareVersions so sánh số bản kiểu ngày', () => {
  assert.ok(updater.compareVersions('2026.10.10', '2026.08.19') > 0);
  assert.ok(updater.compareVersions('2026.08.19', '2026.08.19') === 0);
  assert.ok(updater.compareVersions('2026.08.19.1', '2026.08.19') > 0);
  assert.ok(updater.compareVersions('2026.08.19', '2026.10.01') < 0);
});

test('cài đặt mặc định bật tự cập nhật; chỉ nhận boolean; tắt được và nhớ lại', () => {
  assert.strictEqual(settings.read().autoUpdateYtdlp, true);
  assert.strictEqual(settings.update({ autoUpdateYtdlp: false }).autoUpdateYtdlp, false);
  assert.strictEqual(settings.read().autoUpdateYtdlp, false);
  settings.update({ autoUpdateYtdlp: 'có', lạ: 1 }); // sai kiểu / khoá lạ bị bỏ qua
  assert.strictEqual(settings.read().autoUpdateYtdlp, false);
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'))), ['autoUpdateYtdlp']);
  fs.writeFileSync(path.join(dataDir, 'settings.json'), '{hỏng');
  assert.strictEqual(settings.read().autoUpdateYtdlp, true);
});

test('tắt tự cập nhật: không gọi mạng', async () => {
  settings.update({ autoUpdateYtdlp: false });
  const calls = [];
  const r = await updater.checkAndUpdate({ fetchImpl: fakeFetch({ calls }), getVersion: async () => '2026.08.19', currentBinary: 'x' });
  assert.deepStrictEqual(r, { status: 'disabled' });
  assert.deepStrictEqual(calls, []);
});

test('đã là bản mới nhất: không tải gì', async () => {
  const calls = [];
  const r = await updater.checkAndUpdate({ fetchImpl: fakeFetch({ tag: '2026.08.19', calls }), getVersion: async () => '2026.08.19', currentBinary: 'x' });
  assert.strictEqual(r.status, 'up-to-date');
  assert.strictEqual(calls.length, 1);
});

test('có bản mới: tải, kiểm SHA-256 và số bản, đổi sang bản mới, nhớ cho đúng bản ứng dụng', async () => {
  let switched = null;
  const versions = { 'old.exe': '2026.08.19' };
  const getVersion = async (bin) => (bin.endsWith('.new') ? '2026.10.10' : versions[bin] || '2026.10.10');
  const r = await updater.checkAndUpdate({
    fetchImpl: fakeFetch(),
    getVersion,
    currentBinary: 'old.exe',
    setBinaryPath: (p) => (switched = p),
    appVersion: '9.9.9',
  });
  assert.deepStrictEqual(r, { status: 'updated', from: '2026.08.19', version: '2026.10.10' });
  assert.strictEqual(switched, path.join(dataDir, 'bin', ASSET));
  assert.deepStrictEqual(fs.readFileSync(switched), BIN);
  assert.ok(!fs.existsSync(switched + '.new'));
  assert.strictEqual(updater.findUpdatedBinary('9.9.9'), switched);
  // ứng dụng đổi bản → không dùng bản cũ trong thư mục dữ liệu
  assert.strictEqual(updater.findUpdatedBinary('10.0.0'), null);
});

test('SHA-256 không khớp: không dùng bản tải về, không đổi bản đang chạy', async () => {
  let switched = null;
  const r = await updater.checkAndUpdate({
    fetchImpl: fakeFetch({ sums: `${'0'.repeat(64)}  ${ASSET}\n` }),
    getVersion: async () => '2026.08.19',
    currentBinary: 'old.exe',
    setBinaryPath: (p) => (switched = p),
  });
  assert.strictEqual(r.status, 'error');
  assert.match(r.message, /SHA-256/);
  assert.strictEqual(switched, null);
  assert.ok(!fs.existsSync(path.join(dataDir, 'bin', ASSET)));
});

test('thiếu dòng của tệp trong SHA2-256SUMS cũng bị từ chối', async () => {
  const r = await updater.checkAndUpdate({
    fetchImpl: fakeFetch({ sums: `${sha(BIN)}  yt-dlp_khac\n` }),
    getVersion: async () => '2026.08.19',
    currentBinary: 'old.exe',
  });
  assert.strictEqual(r.status, 'error');
});

test('bản tải về không chạy được hoặc báo sai số bản: bỏ, giữ bản cũ', async () => {
  const bad = await updater.checkAndUpdate({
    fetchImpl: fakeFetch(),
    getVersion: async (bin) => {
      if (bin.endsWith('.new')) throw new Error('không chạy được');
      return '2026.08.19';
    },
    currentBinary: 'old.exe',
  });
  assert.strictEqual(bad.status, 'error');
  assert.ok(!fs.existsSync(path.join(dataDir, 'bin', ASSET + '.new')));

  const wrong = await updater.checkAndUpdate({
    fetchImpl: fakeFetch(),
    getVersion: async (bin) => (bin.endsWith('.new') ? '2026.01.01' : '2026.08.19'),
    currentBinary: 'old.exe',
  });
  assert.strictEqual(wrong.status, 'error');
  assert.match(wrong.message, /không khớp/);
});

test('mất mạng: trả lỗi, không ném (ứng dụng vẫn chạy bình thường)', async () => {
  const r = await updater.checkAndUpdate({
    fetchImpl: async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    },
    getVersion: async () => '2026.08.19',
    currentBinary: 'x',
  });
  assert.strictEqual(r.status, 'error');
});

test('chỉ tải từ github.com/yt-dlp/yt-dlp', async () => {
  const calls = [];
  await updater.checkAndUpdate({ fetchImpl: fakeFetch({ calls }), getVersion: async (b) => (b.endsWith('.new') ? '2026.10.10' : '2026.08.19'), currentBinary: 'x' });
  assert.ok(calls.length >= 3);
  for (const u of calls) assert.match(u, /^https:\/\/(api\.github\.com\/repos|github\.com)\/yt-dlp\/yt-dlp\//);
});
