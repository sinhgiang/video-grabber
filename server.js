const express = require('express');
const path = require('path');
const ytdlp = require('./lib/ytdlp');
const { getInfo, startDownload, cleanupTmp, sanitizeFilename, SUPPORTED_COOKIE_BROWSERS } = ytdlp;
const sessions = require('./lib/sessions');
const settings = require('./lib/settings');
const { checkAndUpdate } = require('./lib/ytdlp-update');
const { createJob, getJob, updateJob, removeJob } = require('./lib/jobs');
const { schedule } = require('./lib/queue');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/cookie-browsers', (req, res) => {
  res.json({ browsers: SUPPORTED_COOKIE_BROWSERS });
});

// Các API đụng tới phiên đăng nhập và cài đặt chỉ nhận yêu cầu từ chính trang của ứng dụng:
// chặn trang web lạ trong trình duyệt gọi sang localhost (CSRF) và DNS rebinding (Host lạ).
function localOnly(req, res, next) {
  const host = String(req.headers.host || '').toLowerCase();
  const hostname = host.replace(/:\d+$/, '');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
    return res.status(403).json({ error: 'Yêu cầu bị từ chối.' });
  }
  const origin = req.headers.origin;
  if (origin && origin.toLowerCase() !== `http://${host}`) {
    return res.status(403).json({ error: 'Yêu cầu bị từ chối.' });
  }
  next();
}

// Các route xem trước/tải xuống tự dùng phiên đăng nhập trong ứng dụng nên cũng phải qua chốt đó:
// trong app desktop (có cửa sổ đăng nhập) chỉ nhận yêu cầu từ chính trang của app; bản web chạy từ điện thoại
// trong mạng LAN không có phiên trong app nên vẫn nhận yêu cầu như trước.
function localOnlyWhenSessions(req, res, next) {
  if (sessions.isAvailable()) return localOnly(req, res, next);
  next();
}

// Danh sách nền tảng có đăng nhập trong ứng dụng + đã đăng nhập chưa (KHÔNG bao giờ trả cookie).
app.get('/api/login/providers', localOnly, async (req, res) => {
  const out = [];
  for (const p of Object.values(sessions.PROVIDERS)) {
    const st = await sessions.status(p.key).catch(() => ({ available: false, loggedIn: false }));
    out.push({ key: p.key, label: p.label, available: st.available, loggedIn: st.loggedIn });
  }
  res.json({ providers: out });
});

app.post('/api/login/start', localOnly, async (req, res) => {
  const key = req.body && req.body.provider;
  if (!sessions.PROVIDERS[key]) return res.status(400).json({ error: 'Nền tảng không hỗ trợ.' });
  try {
    res.json(await sessions.login(key));
  } catch (err) {
    res.status(422).json({ error: (err && err.message) || 'Không mở được cửa sổ đăng nhập.' });
  }
});

app.post('/api/login/logout', localOnly, async (req, res) => {
  const key = req.body && req.body.provider;
  if (!sessions.PROVIDERS[key]) return res.status(400).json({ error: 'Nền tảng không hỗ trợ.' });
  await sessions.logout(key);
  res.json({ loggedIn: false });
});

app.get('/api/settings', localOnly, async (req, res) => {
  res.json({ ...settings.read(), ytdlpVersion: await ytdlp.getVersion() });
});

app.post('/api/settings', localOnly, async (req, res) => {
  const next = settings.update(req.body || {});
  // Vừa bật lại → cập nhật luôn, không đợi lần mở ứng dụng sau
  if (next.autoUpdateYtdlp && req.body && req.body.autoUpdateYtdlp === true) startYtdlpUpdate();
  res.json({ ...next, ytdlpVersion: await ytdlp.getVersion() });
});

// Chạy ngầm; không bao giờ làm hỏng ứng dụng nếu mạng lỗi.
function startYtdlpUpdate() {
  checkAndUpdate({ currentBinary: ytdlp.getBinaryPath(), setBinaryPath: ytdlp.setBinaryPath }).then((r) => {
    if (r.status === 'updated') console.log(`[yt-dlp] đã cập nhật ${r.from} → ${r.version}`);
    else if (r.status === 'error') console.log('[yt-dlp] không tự cập nhật được:', r.message);
  });
}

app.get('/api/version', (req, res) => {
  const pkg = require('./package.json');
  res.json({ version: pkg.version, repo: 'sinhgiang/video-grabber' });
});

app.post('/api/info', localOnlyWhenSessions, async (req, res) => {
  const { url, cookiesFromBrowser } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Thiếu URL video.' });
  }
  try {
    const info = await getInfo(url.trim(), { cookiesFromBrowser });
    res.json(info);
  } catch (err) {
    console.error('[info]', err && err.message);
    res.status(422).json({
      error: (err && err.message) || 'Không lấy được thông tin video. Kiểm tra lại đường dẫn hoặc thử lại sau.',
      code: (err && err.code) || undefined,
      provider: (err && err.provider) || undefined,
    });
  }
});

app.post('/api/download/start', localOnlyWhenSessions, (req, res) => {
  const { url, type, quality, cookiesFromBrowser } = req.body || {};
  if (!url || !['mp4', 'mp3'].includes(type)) {
    return res.status(400).json({ error: 'Thiếu tham số url/type hợp lệ.' });
  }

  const jobId = createJob();
  res.json({ jobId });
  updateJob(jobId, { status: 'queued' });

  schedule(
    () =>
      startDownload(
        { url, type, quality, cookiesFromBrowser },
        (percent, eta) => {
          updateJob(jobId, { status: 'downloading', progress: percent, eta, stage: '' });
        },
        (stage) => updateJob(jobId, { status: 'downloading', stage })
      ),
    () => updateJob(jobId, { status: 'downloading' }) // báo khi job rời hàng đợi và bắt đầu chạy thật
  )
    .then(({ filePath, tmpDir }) => {
      updateJob(jobId, {
        status: 'ready',
        progress: 100,
        filePath,
        tmpDir,
        title: path.basename(filePath),
      });
    })
    .catch((err) => {
      console.error('[download]', err && err.message);
      const msg = (err && err.message) || 'Tải thất bại. Video có thể bị giới hạn hoặc đường dẫn không hợp lệ.';
      updateJob(jobId, { status: 'error', error: msg, code: (err && err.code) || undefined, provider: (err && err.provider) || undefined });
    });
});

app.get('/api/download/progress/:jobId', localOnlyWhenSessions, (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).end();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (j) => {
    // stage/code/provider cho giao diện hiện "đang thử cách n/m" và nút đăng nhập khi lỗi LOGIN_REQUIRED
    const { status, progress, eta, error, stage, code, provider } = j;
    res.write(`data: ${JSON.stringify({ status, progress, eta, error, stage, code, provider })}\n\n`);
    if (j.status === 'ready' || j.status === 'error') {
      job.listeners.delete(send);
      res.end();
    }
  };

  job.listeners.add(send);
  send(job); // gửi trạng thái hiện tại ngay lập tức

  req.on('close', () => job.listeners.delete(send));
});

app.get('/api/download/file/:jobId', localOnlyWhenSessions, (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || job.status !== 'ready' || !job.filePath) {
    return res.status(404).json({ error: 'File chưa sẵn sàng.' });
  }

  const filename = sanitizeFilename(path.basename(job.filePath));
  res.download(job.filePath, filename, (err) => {
    if (err) console.error('[send file]', err);
    cleanupTmp(job.tmpDir);
    removeJob(req.params.jobId);
  });
});

// HOST trống = nghe mọi địa chỉ (để mở từ điện thoại cùng mạng khi chạy `npm start`).
// App Electron đặt HOST=127.0.0.1 để máy khác trong mạng không gọi được API tải.
const server = app.listen(PORT, process.env.HOST || undefined, () => {
  console.log(`\n  🎬 Video Grabber đang chạy tại http://localhost:${server.address().port}\n`);
});

// Tự cập nhật yt-dlp khi khởi động (tắt được ở Tuỳ chọn nâng cao). Chỉ khi chạy thật — không chạy
// khi server được require trong test.
if (process.env.VG_STARTUP_UPDATE === '1' || require.main === module) {
  server.once('listening', startYtdlpUpdate);
}

module.exports = server;
