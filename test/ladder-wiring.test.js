// Chạy getInfo/startDownload THẬT với yt-dlp giả (thay execPromise/exec) để kiểm chuỗi leo thang
// được nối đúng: đúng thứ tự tham số, đúng bước, tệp cookie tạm bị xoá, không lộ cookie ra log.
process.env.VG_RETRY_DELAY_MS = '0';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { EventEmitter } = require('events');
const ytdlp = require('../lib/ytdlp');
const sessions = require('../lib/sessions');

const SECRET = 'SECRET_XS_TOKEN_9f8e7d';
const FB_URL = 'https://www.facebook.com/reel/1784783755975931';
const COOKIE_TEXT = `# Netscape HTTP Cookie File\n.facebook.com\tTRUE\t/\tTRUE\t1900000000\tc_user\t100\n.facebook.com\tTRUE\t/\tTRUE\t1900000000\txs\t${SECRET}\n`;
const GOOD_INFO = JSON.stringify({
  id: '1784783755975931',
  title: 'Reel thử',
  duration: 19,
  formats: [{ vcodec: 'h264', height: 1280, width: 720 }],
  webpage_url: FB_URL,
});

function label(args) {
  const i = args.indexOf('--impersonate');
  if (i >= 0) return `imp:${args[i + 1]}`;
  const b = args.indexOf('--cookies-from-browser');
  if (b >= 0) return `browser:${args[b + 1]}`;
  if (args.includes('--cookies')) return 'cookies';
  return 'normal';
}

function fakeSession({ loggedIn }) {
  const exported = [];
  sessions.register({
    status: async () => loggedIn,
    exportCookies: async () => (loggedIn ? COOKIE_TEXT : null),
    login: async () => loggedIn,
    logout: async () => {},
  });
  return exported;
}

function capture() {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  return { lines, restore: () => Object.assign(console, orig) };
}

const realExecPromise = ytdlp._wrap.execPromise;
const realExec = ytdlp._wrap.exec;
test.afterEach(() => {
  ytdlp._wrap.execPromise = realExecPromise;
  ytdlp._wrap.exec = realExec;
  sessions.register(null);
  ytdlp._resetStepMemory();
});

function parseError() {
  return new Error(`Error code: 1\n\nStderr:\nERROR: [facebook] 1784783755975931: Cannot parse data; please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q= , filling out the appropriate issue template.`);
}

// yt-dlp giả cho Xem trước: chỉ trả về video khi args đúng điều kiện `ok(args, label)`
function fakeInfo(ok, calls, cookieChecks) {
  ytdlp._wrap.execPromise = async (args) => {
    const l = label(args);
    calls.push(l);
    if (l === 'cookies') {
      const file = args[args.indexOf('--cookies') + 1];
      const content = fs.readFileSync(file, 'utf8'); // tệp phải tồn tại lúc chạy
      if (cookieChecks) cookieChecks.push({ file, hasSecret: content.includes(SECRET) });
    }
    if (ok(args, l)) return GOOD_INFO;
    if (l.startsWith('browser:')) throw new Error('Error code: 1\n\nStderr:\nERROR: Could not copy Chrome cookie database. See  https://github.com/yt-dlp/yt-dlp/issues/7271  for more info');
    throw parseError();
  };
}

const FULL_ORDER = [
  'normal', 'normal', // cách thường: thử lại 1 lần với lỗi "Cannot parse data"
  'imp:chrome', 'imp:safari', 'imp:chrome:android',
  'browser:firefox', 'browser:edge', 'browser:brave', 'browser:chrome', 'browser:opera',
];

test('Xem trước Facebook: thất bại từng bước theo thứ tự rồi thành công bằng phiên đăng nhập trong app; tệp cookie tạm bị xoá', async () => {
  fakeSession({ loggedIn: true });
  const calls = [];
  const checks = [];
  fakeInfo((a, l) => l === 'cookies', calls, checks);
  const cap = capture();
  let info;
  try {
    info = await ytdlp.getInfo(FB_URL);
  } finally {
    cap.restore();
  }
  assert.deepStrictEqual(calls, [...FULL_ORDER, 'cookies']);
  assert.strictEqual(info.title, 'Reel thử');
  assert.strictEqual(info.platform.key, 'facebook');
  assert.strictEqual(checks.length, 1);
  assert.ok(checks[0].hasSecret, 'yt-dlp phải nhận được cookie thật');
  assert.ok(!fs.existsSync(checks[0].file), 'tệp cookie tạm phải bị xoá sau khi xong');
  assert.ok(!cap.lines.some((l) => l.includes(SECRET)), 'cookie không được lọt vào nhật ký');
});

test('Xem trước thành công ở bước giả dạng Safari thì dừng, không thử bước sau', async () => {
  fakeSession({ loggedIn: true });
  const calls = [];
  fakeInfo((a, l) => l === 'imp:safari', calls);
  await ytdlp.getInfo(FB_URL);
  assert.deepStrictEqual(calls, ['normal', 'normal', 'imp:chrome', 'imp:safari']);
});

test('Tải xuống nhớ cách đã thành công khi Xem trước: thử cách đó trước', async () => {
  fakeSession({ loggedIn: true });
  const calls = [];
  fakeInfo((a, l) => l === 'cookies', calls);
  await ytdlp.getInfo(FB_URL);
  calls.length = 0;
  await ytdlp.getInfo(FB_URL);
  assert.deepStrictEqual(calls, ['cookies']);
});

test('hết mọi cách khi chưa đăng nhập: lỗi LOGIN_REQUIRED có lý do thật và việc cần làm, không phải "tạm thời"', async () => {
  fakeSession({ loggedIn: false });
  const calls = [];
  fakeInfo(() => false, calls);
  const cap = capture();
  try {
    await assert.rejects(ytdlp.getInfo(FB_URL), (err) => {
      assert.strictEqual(err.code, 'LOGIN_REQUIRED');
      assert.strictEqual(err.provider, 'facebook');
      assert.match(err.message, /Đăng nhập Facebook một lần/);
      assert.match(err.message, /Cannot parse data/);
      assert.doesNotMatch(err.message, /tạm thời/);
      return true;
    });
  } finally {
    cap.restore();
  }
  assert.deepStrictEqual(calls, FULL_ORDER); // không có bước app-session vì chưa có phiên
});

test('hết mọi cách khi đã đăng nhập: lỗi NO_ACCESS (không phải bảo đăng nhập lại như chưa đăng nhập)', async () => {
  fakeSession({ loggedIn: true });
  const calls = [];
  fakeInfo(() => false, calls);
  await assert.rejects(ytdlp.getInfo(FB_URL), (err) => {
    assert.strictEqual(err.code, 'NO_ACCESS');
    return true;
  });
  assert.deepStrictEqual(calls, [...FULL_ORDER, 'cookies']);
});

test('người dùng tự chọn Firefox: mọi bước dùng cookie Firefox, không tự thử Edge/Chrome/Brave/Opera', async () => {
  fakeSession({ loggedIn: false });
  const argsSeen = [];
  ytdlp._wrap.execPromise = async (args) => {
    argsSeen.push(args);
    throw parseError();
  };
  await assert.rejects(ytdlp.getInfo(FB_URL, { cookiesFromBrowser: 'firefox' }));
  // thường (2 lần: thử lại lỗi parse) + 3 cách giả dạng; mọi lần đều kèm cookie Firefox
  assert.deepStrictEqual(argsSeen.map((a) => label(a)), ['browser:firefox', 'browser:firefox', 'imp:chrome', 'imp:safari', 'imp:chrome:android']);
  for (const a of argsSeen) {
    assert.strictEqual(a[a.indexOf('--cookies-from-browser') + 1], 'firefox');
    assert.strictEqual(a.filter((x) => x === '--cookies-from-browser').length, 1);
  }
});

test('lỗi không thể khắc phục (Unsupported URL) báo ngay, không leo thang', async () => {
  fakeSession({ loggedIn: true });
  const calls = [];
  ytdlp._wrap.execPromise = async (args) => {
    calls.push(label(args));
    throw new Error('Error code: 1\n\nStderr:\nERROR: Unsupported URL: https://example.com/');
  };
  await assert.rejects(ytdlp.getInfo('https://example.com/abc'), /Unsupported URL/);
  assert.deepStrictEqual(calls, ['normal']);
});

test('YouTube: không có bước giả dạng, vẫn tự thử cookie trình duyệt khi bị chặn bot', async () => {
  const calls = [];
  ytdlp._wrap.execPromise = async (args) => {
    const l = label(args);
    calls.push(l);
    if (l === 'browser:edge') return GOOD_INFO;
    throw new Error("Error code: 1\n\nStderr:\nERROR: [youtube] x: Sign in to confirm you're not a bot");
  };
  await ytdlp.getInfo('https://www.youtube.com/watch?v=jNQXAC9IVRw');
  // 'normal' 2 lần: lần 1 có giới hạn client, lần 2 bỏ giới hạn client (logic YouTube cũ giữ nguyên)
  assert.deepStrictEqual(calls, ['normal', 'normal', 'browser:firefox', 'browser:firefox', 'browser:edge']);
});

// ---- Tải xuống ----
function fakeExecFactory(ok, calls, cookieChecks) {
  return (args) => {
    const em = new EventEmitter();
    em.ytDlpProcess = { stdout: new EventEmitter(), stderr: new EventEmitter() };
    const l = label(args);
    calls.push({ l, args });
    setImmediate(() => {
      if (l === 'cookies') {
        const file = args[args.indexOf('--cookies') + 1];
        if (cookieChecks) cookieChecks.push({ file, exists: fs.existsSync(file) });
      }
      if (ok(args, l)) {
        const tpl = args[args.indexOf('-o') + 1];
        fs.writeFileSync(tpl.replace('%(title).150B', 'video').replace('%(ext)s', 'mp4'), 'FAKE-MP4');
        em.emit('close');
      } else {
        em.ytDlpProcess.stderr.emit('data', Buffer.from(l.startsWith('browser:')
          ? 'ERROR: Could not copy Chrome cookie database.'
          : 'ERROR: [facebook] 1: Cannot parse data; please report this issue'));
        em.emit('error', new Error('Error code: 1'));
        em.emit('close');
      }
    });
    return em;
  };
}

test('Tải xuống Facebook: leo thang theo thứ tự tới phiên đăng nhập, báo bước đang thử, trả về file MP4, xoá tệp cookie tạm', async () => {
  fakeSession({ loggedIn: true });
  const calls = [];
  const checks = [];
  ytdlp._wrap.exec = fakeExecFactory((a, l) => l === 'cookies', calls, checks);
  const stages = [];
  const cap = capture();
  let result;
  try {
    result = await ytdlp.startDownload({ url: FB_URL, type: 'mp4', quality: 'best' }, () => {}, (s) => stages.push(s));
  } finally {
    cap.restore();
  }
  assert.deepStrictEqual(calls.map((c) => c.l), [
    'normal', 'imp:chrome', 'imp:safari', 'imp:chrome:android',
    'browser:firefox', 'browser:edge', 'browser:brave', 'browser:chrome', 'browser:opera',
    'cookies',
  ]);
  assert.ok(fs.existsSync(result.filePath));
  assert.strictEqual(fs.readFileSync(result.filePath, 'utf8'), 'FAKE-MP4');
  assert.strictEqual(stages.length, 9);
  assert.match(stages[0], /cách 2\/10: giả dạng trình duyệt Chrome/);
  assert.match(stages[8], /cách 10\/10: phiên đăng nhập đã lưu trong ứng dụng/);
  assert.deepStrictEqual(checks.map((c) => c.exists), [true]);
  assert.ok(!fs.existsSync(checks[0].file), 'tệp cookie tạm phải bị xoá');
  assert.ok(!cap.lines.some((l) => l.includes(SECRET)));
  ytdlp.cleanupTmp(result.tmpDir);
});

test('Tải xuống: hết cách → lỗi cuối đúng nguyên nhân, không để lại thư mục tạm của lần thất bại', async () => {
  fakeSession({ loggedIn: false });
  const calls = [];
  const dirs = new Set();
  const inner = fakeExecFactory(() => false, calls);
  ytdlp._wrap.exec = (args) => {
    dirs.add(require('path').dirname(args[args.indexOf('-o') + 1]));
    return inner(args);
  };
  await assert.rejects(ytdlp.startDownload({ url: FB_URL, type: 'mp3' }, () => {}), (err) => {
    assert.strictEqual(err.code, 'LOGIN_REQUIRED');
    return true;
  });
  assert.strictEqual(calls.length, 9);
  await new Promise((r) => setTimeout(r, 100)); // cleanupTmp xoá bất đồng bộ
  for (const d of dirs) assert.ok(!fs.existsSync(d), `thư mục tạm còn sót: ${d}`);
});

test('YouTube 403 giữa chừng: vẫn tự thử lại không giới hạn client ngay trong cùng một bước (logic cũ giữ nguyên)', async () => {
  const calls = [];
  ytdlp._wrap.exec = (args) => {
    const em = new EventEmitter();
    em.ytDlpProcess = { stdout: new EventEmitter(), stderr: new EventEmitter() };
    calls.push(args);
    setImmediate(() => {
      if (args.includes('--extractor-args')) {
        em.ytDlpProcess.stderr.emit('data', Buffer.from('ERROR: unable to download video data: HTTP Error 403: Forbidden'));
        em.emit('error', new Error('Error code: 1'));
      } else {
        fs.writeFileSync(args[args.indexOf('-o') + 1].replace('%(title).150B', 'v').replace('%(ext)s', 'mp4'), 'X');
      }
      em.emit('close');
    });
    return em;
  };
  const r = await ytdlp.startDownload({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', type: 'mp4', quality: '720' }, () => {});
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[0].includes('--extractor-args') && !calls[1].includes('--extractor-args'));
  assert.strictEqual(calls[1][calls[1].indexOf('-f') + 1], 'best');
  ytdlp.cleanupTmp(r.tmpDir);
});
