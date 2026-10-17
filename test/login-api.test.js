const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { once } = require('events');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-test-api-'));
process.env.VG_DATA_DIR = dataDir;
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
delete process.env.VG_STARTUP_UPDATE; // không tự cập nhật yt-dlp / không gọi mạng trong test

const sessions = require('../lib/sessions');
const SECRET = 'SECRET_XS_VALUE_424242';

let server;
let port;
test.before(async () => {
  server = require('../server');
  if (!server.listening) await once(server, 'listening');
  port = server.address().port;
});
test.after(() => {
  server.close();
  sessions.register(null);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// fetch của Node không cho tự đặt Host/Origin → dùng http.request
function call(method, url, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, path: url, method, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, text, json: () => JSON.parse(text) }));
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('bản web (không có cửa sổ đăng nhập): providers báo không khả dụng, login/start trả lỗi rõ ràng', async () => {
  sessions.register(null);
  const p = await call('GET', '/api/login/providers');
  assert.strictEqual(p.status, 200);
  assert.ok(p.json().providers.every((x) => x.available === false && x.loggedIn === false));
  const s = await call('POST', '/api/login/start', { body: { provider: 'facebook' } });
  assert.strictEqual(s.status, 422);
  assert.match(s.json().error, /bản ứng dụng desktop/);
});

test('API đăng nhập không bao giờ trả cookie hay phiên, chỉ trả đã/chưa đăng nhập', async () => {
  sessions.register({
    status: async () => true,
    login: async () => true,
    logout: async () => {},
    exportCookies: async () => `# Netscape HTTP Cookie File\n.facebook.com\tTRUE\t/\tTRUE\t1\txs\t${SECRET}\n`,
  });
  const p = await call('GET', '/api/login/providers');
  const fb = p.json().providers.find((x) => x.key === 'facebook');
  assert.deepStrictEqual(fb, { key: 'facebook', label: 'Facebook', available: true, loggedIn: true });
  const s = await call('POST', '/api/login/start', { body: { provider: 'facebook' } });
  assert.deepStrictEqual(s.json(), { loggedIn: true });
  for (const r of [p, s, await call('GET', '/api/settings'), await call('POST', '/api/login/logout', { body: { provider: 'facebook' } })]) {
    assert.ok(!r.text.includes(SECRET));
  }
});

test('nền tảng lạ bị từ chối (400)', async () => {
  assert.strictEqual((await call('POST', '/api/login/start', { body: { provider: 'evil' } })).status, 400);
  assert.strictEqual((await call('POST', '/api/login/logout', { body: {} })).status, 400);
});

test('chặn trang web lạ gọi API đăng nhập/cài đặt: Origin lạ và Host lạ (DNS rebinding) đều bị 403', async () => {
  const origin = { Origin: 'https://evil.example' };
  for (const [m, u, b] of [
    ['GET', '/api/login/providers'],
    ['POST', '/api/login/start', { provider: 'facebook' }],
    ['POST', '/api/login/logout', { provider: 'facebook' }],
    ['GET', '/api/settings'],
    ['POST', '/api/settings', { autoUpdateYtdlp: false }],
  ]) {
    assert.strictEqual((await call(m, u, { body: b, headers: origin })).status, 403, `${m} ${u} với Origin lạ`);
    assert.strictEqual((await call(m, u, { body: b, headers: { Host: 'evil.example' } })).status, 403, `${m} ${u} với Host lạ`);
    assert.strictEqual((await call(m, u, { body: b, headers: { Host: 'evil.example:80' } })).status, 403);
  }
  // cùng nguồn gốc thì được
  const ok = await call('GET', '/api/settings', { headers: { Origin: `http://127.0.0.1:${port}` } });
  assert.strictEqual(ok.status, 200);
});

test('cài đặt tự cập nhật yt-dlp: đọc, tắt, bật lại, nhớ trong thư mục dữ liệu', async () => {
  assert.strictEqual((await call('GET', '/api/settings')).json().autoUpdateYtdlp, true);
  const off = await call('POST', '/api/settings', { body: { autoUpdateYtdlp: false } });
  assert.strictEqual(off.json().autoUpdateYtdlp, false);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8')).autoUpdateYtdlp, false);
  assert.strictEqual((await call('GET', '/api/settings')).json().autoUpdateYtdlp, false);
});

test('lỗi Facebook từ /api/info trả kèm code và provider để giao diện hiện nút đăng nhập', async () => {
  const ytdlp = require('../lib/ytdlp');
  const real = ytdlp._wrap.execPromise;
  ytdlp._wrap.execPromise = async () => {
    throw new Error('Error code: 1\n\nStderr:\nERROR: [facebook] 1: Cannot parse data; please report this issue');
  };
  try {
    sessions.register({ status: async () => false, login: async () => false, logout: async () => {}, exportCookies: async () => null });
    process.env.VG_RETRY_DELAY_MS = '0';
    const r = await call('POST', '/api/info', { body: { url: 'https://www.facebook.com/reel/1784783755975931' } });
    assert.strictEqual(r.status, 422);
    const j = r.json();
    assert.strictEqual(j.code, 'LOGIN_REQUIRED');
    assert.strictEqual(j.provider, 'facebook');
    assert.match(j.error, /Đăng nhập Facebook một lần/);
  } finally {
    ytdlp._wrap.execPromise = real;
  }
});

const fakeSessionImpl = () => ({ status: async () => false, login: async () => false, logout: async () => {}, exportCookies: async () => null });

test('app desktop: /api/info và /api/download/* tự dùng phiên đăng nhập nên Origin lạ và Host lạ (DNS rebinding) đều bị 403', async () => {
  sessions.register(fakeSessionImpl());
  const body = { url: 'https://www.facebook.com/reel/1784783755975931', type: 'mp4' };
  for (const [m, u, b] of [
    ['POST', '/api/info', body],
    ['POST', '/api/download/start', body],
    ['GET', '/api/download/progress/abc'],
    ['GET', '/api/download/file/abc'],
  ]) {
    assert.strictEqual((await call(m, u, { body: b, headers: { Origin: 'https://evil.example' } })).status, 403, `${m} ${u} với Origin lạ`);
    assert.strictEqual((await call(m, u, { body: b, headers: { Host: 'evil.example:3000' } })).status, 403, `${m} ${u} với Host lạ`);
  }
  // cùng nguồn gốc vẫn vào được tới route (job không tồn tại → 404, không phải 403)
  const ok = await call('GET', '/api/download/progress/abc', { headers: { Origin: `http://127.0.0.1:${port}` } });
  assert.strictEqual(ok.status, 404);
});

test('bản web (không có phiên trong app): mở từ máy khác trong mạng LAN (Host khác) vẫn dùng được như trước', async () => {
  sessions.register(null);
  const r = await call('POST', '/api/info', { body: {}, headers: { Host: '192.168.1.20:3000' } });
  assert.strictEqual(r.status, 400); // tới được route, bị từ chối vì thiếu URL, không phải 403
  assert.strictEqual((await call('GET', '/api/download/progress/abc', { headers: { Host: '192.168.1.20:3000' } })).status, 404);
});

// Đọc SSE tiến trình của một job tới khi server đóng luồng; gọi onFirst sau sự kiện đầu tiên
function readProgress(jobId, onFirst) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.request({ host: '127.0.0.1', port, path: `/api/download/progress/${jobId}`, method: 'GET' }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i).replace(/^data: /, '');
          buf = buf.slice(i + 2);
          events.push(JSON.parse(line));
          if (events.length === 1) onFirst();
        }
      });
      res.on('end', () => resolve(events));
    });
    req.on('error', reject);
    req.end();
  });
}

test('SSE tiến trình tải mang stage, code và provider: giao diện hiện "đang thử cách n/m" và nút đăng nhập khi LOGIN_REQUIRED', async () => {
  const { EventEmitter } = require('events');
  const ytdlp = require('../lib/ytdlp');
  const realExec = ytdlp._wrap.exec;
  process.env.VG_RETRY_DELAY_MS = '0';
  ytdlp._resetStepMemory();
  sessions.register(fakeSessionImpl()); // app desktop, chưa đăng nhập
  let release;
  const gate = new Promise((r) => (release = r));
  ytdlp._wrap.exec = () => {
    const em = new EventEmitter();
    em.ytDlpProcess = { stdout: new EventEmitter(), stderr: new EventEmitter() };
    gate.then(() => {
      em.ytDlpProcess.stderr.emit('data', Buffer.from('ERROR: [facebook] 1: Cannot parse data; please report this issue'));
      em.emit('error', new Error('Error code: 1'));
      em.emit('close');
    });
    return em;
  };
  try {
    const start = await call('POST', '/api/download/start', { body: { url: 'https://www.facebook.com/reel/1784783755975931', type: 'mp4', quality: 'best' } });
    assert.strictEqual(start.status, 200);
    const events = await readProgress(start.json().jobId, release);
    const last = events[events.length - 1];
    assert.strictEqual(last.status, 'error');
    assert.strictEqual(last.code, 'LOGIN_REQUIRED');
    assert.strictEqual(last.provider, 'facebook');
    assert.match(last.error, /Đăng nhập Facebook một lần/);
    assert.ok(events.some((e) => /cách \d+\/\d+/.test(e.stage || '')), 'phải có sự kiện mang dòng "cách n/m"');
  } finally {
    ytdlp._wrap.exec = realExec;
    ytdlp._resetStepMemory();
    sessions.register(null);
  }
});
