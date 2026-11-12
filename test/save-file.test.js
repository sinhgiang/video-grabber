// T-1727: tải VOD Twitch có tiêu đề "." → yt-dlp tạo file "..mp4" → Express coi là file ẩn, trả 404 và
// yêu cầu không bao giờ được trả lời → giao diện kẹt ở "Đang lưu file…". Các test dưới đây chạy server THẬT với
// yt-dlp giả (tạo file thật trong thư mục tạm) và kiểm: tên file an toàn, file về đúng nội dung, mọi lỗi đều
// được trả lời bằng tiếng Việt trong vài giây (không treo), và trạng thái lưu file đọc được qua API.
process.env.VG_RETRY_DELAY_MS = '0';
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
delete process.env.VG_STARTUP_UPDATE; // không tự cập nhật yt-dlp / không gọi mạng trong test

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { EventEmitter, once } = require('events');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-test-save-'));
process.env.VG_DATA_DIR = dataDir;

const ytdlp = require('../lib/ytdlp');
const jobs = require('../lib/jobs');
const sessions = require('../lib/sessions');

const TWITCH_VOD = 'https://www.twitch.tv/videos/2925663543';
const VIDEO_BYTES = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(4000, 7)]);

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

const realExec = ytdlp._wrap.exec;
test.afterEach(() => {
  ytdlp._wrap.exec = realExec;
  ytdlp._resetStepMemory();
});

// yt-dlp giả: ghi file `fileName` (nội dung `bytes`) vào thư mục của tham số -o rồi báo xong. `lines` là các dòng stdout.
function fakeYtdlp({ fileName, bytes = VIDEO_BYTES, lines = [], onStart }) {
  const made = [];
  ytdlp._wrap.exec = (args) => {
    const emitter = new EventEmitter();
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    emitter.ytDlpProcess = { stdout, stderr };
    const dir = path.dirname(args[args.indexOf('-o') + 1]);
    made.push(path.join(dir, fileName));
    if (onStart) onStart(dir);
    setImmediate(() => {
      for (const l of lines) stdout.emit('data', Buffer.from(l + '\n'));
      emitter.emit('progress', { percent: 100, eta_seconds: 0 });
      fs.writeFileSync(path.join(dir, fileName), bytes);
      emitter.emit('close', 0);
    });
    return emitter;
  };
  return made;
}

function call(method, url, { body, onResponse } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, path: url, method, timeout: 5000, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => {
        if (onResponse) return onResponse(res, req, resolve);
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8'), json: () => JSON.parse(buf.toString('utf8')) });
        });
      }
    );
    // Yêu cầu bị treo (không có phản hồi) phải làm test đỏ, không phải treo cả bộ test
    req.on('timeout', () => { req.destroy(new Error(`TREO: ${method} ${url} không có phản hồi sau 5 giây`)); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function startJob(url = TWITCH_VOD) {
  const r = await call('POST', '/api/download/start', { body: { url, type: 'mp4', quality: '720' } });
  assert.strictEqual(r.status, 200);
  return r.json().jobId;
}

async function waitFor(fn, what, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('Quá thời gian chờ: ' + what);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const statusOf = async (jobId) => (await call('GET', `/api/download/status/${jobId}`)).json();
const waitReady = (jobId) => waitFor(async () => { const s = await statusOf(jobId); return s.status === 'ready' || s.status === 'error' ? s : null; }, 'job xong');

// ---------- tên file ----------

test('safeFileName: tên bắt đầu bằng dấu chấm, rỗng hay trùng tên thiết bị Windows đều thành tên dùng được', () => {
  const cases = [
    ['..mp4', 'video.mp4'], // tiêu đề video là "."
    ['.mp4', 'video.mp4'], // tiêu đề rỗng
    ['...hay.mp4', 'hay.mp4'],
    ['  tên có khoảng trắng.mp4', 'tên có khoảng trắng.mp4'],
    ['Hello...mp4', 'Hello.mp4'],
    ['CON.mp4', 'CON_.mp4'],
    ['Trận chung kết BLAST.mp4', 'Trận chung kết BLAST.mp4'],
    ['a<b>c.mp3', 'a_b_c.mp3'],
    ['', 'video'],
  ];
  for (const [input, expected] of cases) assert.strictEqual(ytdlp.safeFileName(input), expected, `safeFileName(${JSON.stringify(input)})`);
});

test('safeFileName không bao giờ trả về tên bắt đầu bằng dấu chấm hay chỉ là dấu chấm', () => {
  for (const input of ['.', '..', '...', '.mp4', '..mp4', '. .mp4', '.hidden.mp4', ' .x.mp4']) {
    const out = ytdlp.safeFileName(input);
    assert.ok(!out.startsWith('.') && !/^\s/.test(out) && out.length > 0, `${JSON.stringify(input)} → ${JSON.stringify(out)}`);
  }
});

// ---------- startDownload với tên file "..mp4" ----------

test('startDownload: file "..mp4" của yt-dlp được đổi thành tên an toàn, nội dung giữ nguyên', async () => {
  fakeYtdlp({ fileName: '..mp4' });
  const { filePath, tmpDir } = await ytdlp.startDownload({ url: TWITCH_VOD, type: 'mp4', quality: '720' }, () => {}, () => {});
  try {
    assert.strictEqual(path.basename(filePath), 'video.mp4');
    assert.ok(fs.readFileSync(filePath).equals(VIDEO_BYTES));
    assert.deepStrictEqual(fs.readdirSync(tmpDir), ['video.mp4']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('startDownload: dòng [Merger]/[ExtractAudio]/[VideoRemuxer] của yt-dlp thành câu tiếng Việt báo đúng việc đang làm', async () => {
  fakeYtdlp({ fileName: 'a.mp4', lines: ['[download] 100% of 1.2GiB', '[Merger] Merging formats into "x.mp4"'] });
  const stages = [];
  const { tmpDir } = await ytdlp.startDownload({ url: TWITCH_VOD, type: 'mp4', quality: '720' }, () => {}, (s) => stages.push(s));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  assert.ok(stages.some((s) => /Đang ghép hình và tiếng/.test(s)), `stages: ${JSON.stringify(stages)}`);

  assert.match(ytdlp.processingStage('[ExtractAudio] Destination: a.mp3'), /Đang chuyển sang MP3/);
  assert.match(ytdlp.processingStage('[VideoRemuxer] Remuxing video from ts to mp4'), /Đang hoàn thiện file video/);
  assert.match(ytdlp.processingStage('[FixupM3u8] Fixing MPEG-TS in MP4 container'), /Đang hoàn thiện file video/);
  // âm tính: dòng bình thường không được nhận nhầm
  for (const line of ['[download] 45.0% of 1.2GiB at 10MiB/s ETA 01:00', '[twitch:vod] 2925663543: Downloading', 'Merger of formats is not available', '']) {
    assert.strictEqual(ytdlp.processingStage(line), null, line);
  }
});

// ---------- API: tải VOD tiêu đề "." trọn vẹn ----------

test('VOD tiêu đề ".": start → ready → file về đúng nội dung (không treo), trạng thái lưu = done, file tạm bị xoá', async () => {
  const made = fakeYtdlp({ fileName: '..mp4' });
  const jobId = await startJob();
  const ready = await waitReady(jobId);
  assert.strictEqual(ready.status, 'ready');
  assert.strictEqual(ready.delivery, undefined, 'chưa ai lấy file thì chưa có trạng thái lưu');
  assert.ok(!JSON.stringify(ready).includes('videograbber-') && !('filePath' in ready) && !('tmpDir' in ready), 'status không lộ đường dẫn file tạm');

  const file = await call('GET', `/api/download/file/${jobId}`);
  assert.strictEqual(file.status, 200);
  assert.ok(file.buf.equals(VIDEO_BYTES), 'nội dung file phải khớp từng byte');
  assert.match(file.headers['content-disposition'], /filename="video\.mp4"/);
  assert.strictEqual(file.buf.subarray(4, 8).toString(), 'ftyp', 'MP4 có hộp ftyp');

  const done = await waitFor(async () => { const s = await statusOf(jobId); return s.delivery === 'done' ? s : null; }, 'delivery done');
  assert.strictEqual(done.total, VIDEO_BYTES.length);
  await waitFor(() => !fs.existsSync(path.dirname(made[0])), 'thư mục tạm bị xoá');
});

test('chốt riêng ở route file: file có tên bắt đầu bằng dấu chấm vẫn gửi được (không bị coi là file ẩn)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'videograbber-test-dot-'));
  fs.writeFileSync(path.join(dir, '..mp4'), VIDEO_BYTES);
  const id = jobs.createJob();
  jobs.updateJob(id, { status: 'ready', progress: 100, filePath: path.join(dir, '..mp4'), tmpDir: dir });
  const file = await call('GET', `/api/download/file/${id}`);
  assert.strictEqual(file.status, 200, file.text);
  assert.ok(file.buf.equals(VIDEO_BYTES));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- API: lỗi phải được trả lời, không treo ----------

test('file đã biến mất trước khi lưu: trả lời ngay 410 bằng tiếng Việt, trạng thái failed (không treo như bản cũ)', async () => {
  const made = fakeYtdlp({ fileName: 'abc.mp4' });
  const jobId = await startJob();
  await waitReady(jobId);
  fs.rmSync(path.dirname(made[0]), { recursive: true, force: true });

  const file = await call('GET', `/api/download/file/${jobId}`);
  assert.strictEqual(file.status, 410);
  assert.match(file.json().error, /Không tìm thấy file đã tải/);
  const s = await statusOf(jobId);
  assert.strictEqual(s.delivery, 'failed');
  assert.match(s.error, /Hãy bấm Tải xuống lại/);
});

test('job không tồn tại hoặc chưa xong: file và status trả 404 tiếng Việt, không treo', async () => {
  const f = await call('GET', '/api/download/file/khong-co-job-nay');
  assert.strictEqual(f.status, 404);
  assert.match(f.json().error, /chưa sẵn sàng/);
  const s = await call('GET', '/api/download/status/khong-co-job-nay');
  assert.strictEqual(s.status, 404);
  assert.match(s.json().error, /đã kết thúc hoặc hết hạn/);

  const id = jobs.createJob(); // status 'starting'
  assert.strictEqual((await call('GET', `/api/download/file/${id}`)).status, 404);
});

test('trình duyệt ngắt giữa chừng: trạng thái cancelled, file được giữ để lưu lại, lần sau lưu được trọn vẹn', async () => {
  const big = Buffer.alloc(48 * 1024 * 1024, 3);
  big.write('ftypmp42', 4);
  fakeYtdlp({ fileName: 'to.mp4', bytes: big });
  const jobId = await startJob();
  await waitReady(jobId);

  // Đọc một chút rồi ngắt (dừng đọc để server bị nghẽn, không gửi hết vào bộ đệm)
  await new Promise((resolve) => {
    call('GET', `/api/download/file/${jobId}`, {
      onResponse: (res, req) => {
        res.once('data', () => {
          res.pause();
          setTimeout(() => { req.destroy(); resolve(); }, 150);
        });
      },
    }).catch(() => {});
  });
  const cancelled = await waitFor(async () => { const s = await statusOf(jobId); return s.delivery === 'cancelled' ? s : null; }, 'delivery cancelled', 8000);
  assert.strictEqual(cancelled.status, 'ready');

  const again = await call('GET', `/api/download/file/${jobId}`);
  assert.strictEqual(again.status, 200);
  assert.ok(again.buf.equals(big));
  await waitFor(async () => (await statusOf(jobId)).delivery === 'done', 'delivery done sau khi lưu lại', 8000);
});

test('đang gửi file: status báo sending kèm số byte đã gửi / tổng', async () => {
  const big = Buffer.alloc(48 * 1024 * 1024, 5);
  fakeYtdlp({ fileName: 'sending.mp4', bytes: big });
  const jobId = await startJob();
  await waitReady(jobId);

  let sendingStatus;
  await new Promise((resolve) => {
    call('GET', `/api/download/file/${jobId}`, {
      onResponse: (res, req) => {
        res.once('data', () => {
          res.pause();
          setTimeout(async () => {
            sendingStatus = await statusOf(jobId);
            req.destroy();
            resolve();
          }, 200);
        });
      },
    }).catch(() => {});
  });
  assert.strictEqual(sendingStatus.delivery, 'sending');
  assert.strictEqual(sendingStatus.total, big.length);
  assert.ok(sendingStatus.sent > 0 && sendingStatus.sent <= big.length, `sent=${sendingStatus.sent}`);
  const j = jobs.getJob(jobId);
  if (j && j.tmpDir) fs.rmSync(j.tmpDir, { recursive: true, force: true });
});

test('tải lỗi (yt-dlp thất bại): SSE/status báo lỗi bằng tiếng Việt, không kẹt', async () => {
  ytdlp._wrap.exec = () => {
    const emitter = new EventEmitter();
    emitter.ytDlpProcess = { stdout: new EventEmitter(), stderr: new EventEmitter() };
    setImmediate(() => {
      emitter.ytDlpProcess.stderr.emit('data', Buffer.from('ERROR: [twitch:vod] 1: Private video'));
      emitter.emit('error', new Error('Error code: 1\n\nStderr:\nERROR: [twitch:vod] 1: Private video'));
    });
    return emitter;
  };
  const jobId = await startJob();
  const s = await waitFor(async () => { const x = await statusOf(jobId); return x.status === 'error' ? x : null; }, 'job báo lỗi');
  assert.match(s.error, /riêng tư|Private video/);
});

// ---------- giao diện: không còn dòng "Đang lưu file…" đứng mãi ----------

test('giao diện: deliver.js nạp trước app.js, app.js theo dõi kết quả lưu ở cả chế độ một video và hàng loạt', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
  const iDeliver = html.indexOf('/js/deliver.js');
  const iApp = html.indexOf('/js/app.js');
  assert.ok(iDeliver > 0 && iDeliver < iApp, 'deliver.js phải được nạp trước app.js');
  assert.ok(html.includes('id="saveLink"'), 'có nút "Lưu file" thủ công');
  assert.ok(!app.includes('Đang lưu file…'), 'không còn câu cứng "Đang lưu file…" không bao giờ đổi');
  const uses = app.match(/trackSave\(jobId/g) || [];
  assert.ok(uses.length >= 2, `trackSave phải được gọi ở cả chế độ một video và hàng loạt (thấy ${uses.length})`);
});
