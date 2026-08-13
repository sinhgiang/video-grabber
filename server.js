const express = require('express');
const fs = require('fs');
const path = require('path');
const { getInfo, startDownload, cleanupTmp, sanitizeFilename } = require('./lib/ytdlp');
const { createJob, getJob, updateJob, removeJob } = require('./lib/jobs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/info', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Thiếu URL video.' });
  }
  try {
    const info = await getInfo(url.trim());
    res.json(info);
  } catch (err) {
    console.error(err);
    res.status(422).json({ error: 'Không lấy được thông tin video. Kiểm tra lại đường dẫn hoặc thử lại sau.' });
  }
});

app.post('/api/download/start', (req, res) => {
  const { url, type, quality } = req.body || {};
  if (!url || !['mp4', 'mp3'].includes(type)) {
    return res.status(400).json({ error: 'Thiếu tham số url/type hợp lệ.' });
  }

  const jobId = createJob();
  res.json({ jobId });

  startDownload({ url, type, quality }, (percent, eta) => {
    updateJob(jobId, { status: 'downloading', progress: percent, eta });
  })
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
      console.error('[download]', err);
      updateJob(jobId, { status: 'error', error: 'Tải thất bại. Video có thể bị giới hạn hoặc đường dẫn không hợp lệ.' });
    });
});

app.get('/api/download/progress/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).end();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (j) => {
    res.write(`data: ${JSON.stringify({ status: j.status, progress: j.progress, eta: j.eta, error: j.error })}\n\n`);
    if (j.status === 'ready' || j.status === 'error') {
      job.listeners.delete(send);
      res.end();
    }
  };

  job.listeners.add(send);
  send(job); // gửi trạng thái hiện tại ngay lập tức

  req.on('close', () => job.listeners.delete(send));
});

app.get('/api/download/file/:jobId', (req, res) => {
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

app.listen(PORT, () => {
  console.log(`\n  🎬 Video Grabber đang chạy tại http://localhost:${PORT}\n`);
});
