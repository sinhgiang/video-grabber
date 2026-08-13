const path = require('path');
const fs = require('fs');
const os = require('os');
const YTDlpWrap = require('yt-dlp-wrap').default;
const ffmpegPath = require('ffmpeg-static');

const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const binPath = path.join(__dirname, '..', 'bin', binName);

function resolveBinPath() {
  if (fs.existsSync(binPath)) return binPath;
  // Fallback: hy vọng yt-dlp có sẵn trong PATH hệ thống
  return 'yt-dlp';
}

const ytDlpWrap = new YTDlpWrap(resolveBinPath());

const PLATFORM_PATTERNS = [
  { key: 'youtube', label: 'YouTube', color: '#FF0000', test: /youtu\.?be/i },
  { key: 'tiktok', label: 'TikTok', color: '#111111', test: /tiktok\.com/i },
  { key: 'facebook', label: 'Facebook', color: '#1877F2', test: /facebook\.com|fb\.watch/i },
  { key: 'instagram', label: 'Instagram', color: '#E1306C', test: /instagram\.com/i },
  { key: 'twitter', label: 'X / Twitter', color: '#000000', test: /twitter\.com|x\.com/i },
  { key: 'threads', label: 'Threads', color: '#000000', test: /threads\.net/i },
  { key: 'vimeo', label: 'Vimeo', color: '#1AB7EA', test: /vimeo\.com/i },
  { key: 'twitch', label: 'Twitch', color: '#9146FF', test: /twitch\.tv/i },
  { key: 'soundcloud', label: 'SoundCloud', color: '#FF5500', test: /soundcloud\.com/i },
  { key: 'reddit', label: 'Reddit', color: '#FF4500', test: /reddit\.com/i },
  { key: 'pinterest', label: 'Pinterest', color: '#E60023', test: /pinterest\.[a-z.]+/i },
  { key: 'dailymotion', label: 'Dailymotion', color: '#00D2FF', test: /dailymotion\.com/i },
  { key: 'bilibili', label: 'Bilibili', color: '#00A1D6', test: /bilibili\.com/i },
  { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2', test: /linkedin\.com/i },
  { key: 'snapchat', label: 'Snapchat', color: '#FFFC00', test: /snapchat\.com/i },
  { key: 'douyin', label: 'Douyin', color: '#111111', test: /douyin\.com/i },
  { key: 'kuaishou', label: 'Kuaishou', color: '#FF4906', test: /kuaishou\.com/i },
  { key: 'weibo', label: 'Weibo', color: '#E6162D', test: /weibo\.com/i },
];

function detectPlatform(url) {
  for (const p of PLATFORM_PATTERNS) {
    if (p.test.test(url)) return { key: p.key, label: p.label, color: p.color };
  }
  return { key: 'other', label: 'Khác (1000+ nền tảng)', color: '#7C3AED' };
}

const STANDARD_HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240];

function qualityLabel(height) {
  if (height >= 2160) return `${height}p (4K)`;
  if (height >= 1440) return `${height}p (2K)`;
  return `${height}p`;
}

// Dùng Node.js làm JS runtime cho yt-dlp (cần cho việc giải mã signature của YouTube)
// vì máy có thể không cài sẵn Deno. Node đã có sẵn (server đang chạy bằng Node).
const JS_RUNTIME_ARGS = ['--js-runtimes', 'node'];

const SUPPORTED_COOKIE_BROWSERS = ['chrome', 'edge', 'firefox', 'brave', 'opera'];

function cookieArgs(cookiesFromBrowser) {
  if (!cookiesFromBrowser || !SUPPORTED_COOKIE_BROWSERS.includes(cookiesFromBrowser)) return [];
  return ['--cookies-from-browser', cookiesFromBrowser];
}

async function getInfo(url, { cookiesFromBrowser } = {}) {
  const raw = await ytDlpWrap.getVideoInfo([url, ...JS_RUNTIME_ARGS, ...cookieArgs(cookiesFromBrowser), '-f', 'best']);
  const info = Array.isArray(raw) ? raw[0] : raw;

  const heights = new Set();
  (info.formats || []).forEach((f) => {
    if (f.vcodec && f.vcodec !== 'none' && f.height) {
      heights.add(f.height);
    }
  });

  const availableHeights = STANDARD_HEIGHTS.filter((h) =>
    [...heights].some((have) => have >= h - 20 && have <= h + 20) || heights.has(h)
  );
  // Nếu không khớp chuẩn, dùng chiều cao thực tế lớn nhất/độc nhất tìm được
  const qualities = (availableHeights.length ? availableHeights : [...heights].sort((a, b) => b - a).slice(0, 6))
    .sort((a, b) => b - a)
    .map((h) => ({ value: String(h), label: qualityLabel(h) }));

  return {
    id: info.id,
    title: info.title || 'Video không tên',
    thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails.at(-1)?.url) || null,
    duration: info.duration || 0,
    uploader: info.uploader || info.channel || '',
    extractor: info.extractor_key || info.extractor || '',
    platform: detectPlatform(url),
    qualities: qualities.length ? qualities : [{ value: 'best', label: 'Tốt nhất có sẵn' }],
    hasAudio: true,
    webpageUrl: info.webpage_url || url,
  };
}

function buildFormatSelector(type, quality) {
  if (type === 'mp3') return null; // dùng -x thay vì -f
  if (!quality || quality === 'best') return 'bestvideo*+bestaudio/best';
  const h = parseInt(quality, 10);
  return `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`;
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 150);
}

/**
 * Bắt đầu tải video/audio về một thư mục tạm, gọi onProgress(percent, etaText) khi có tiến trình.
 * Trả về { filePath } khi hoàn tất.
 */
function startDownload({ url, type, quality, cookiesFromBrowser }, onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'videograbber-'));
  const outTemplate = path.join(tmpDir, '%(title).150B.%(ext)s');

  const args = [
    url,
    '-o', outTemplate,
    '--ffmpeg-location', ffmpegPath,
    '--no-playlist',
    '--newline',
    ...JS_RUNTIME_ARGS,
    ...cookieArgs(cookiesFromBrowser),
  ];

  if (type === 'mp3') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    const selector = buildFormatSelector('mp4', quality);
    args.push('-f', selector, '--merge-output-format', 'mp4');
  }

  return new Promise((resolve, reject) => {
    const emitter = ytDlpWrap.exec(args);
    let lastLine = '';

    emitter.on('progress', (p) => {
      if (onProgress) onProgress(Math.round(p.percent || 0), p.eta_seconds != null ? `${p.eta_seconds}s` : '');
    });
    emitter.ytDlpProcess?.stdout?.on('data', (chunk) => {
      lastLine = chunk.toString();
    });
    emitter.on('error', (err) => reject(err));
    emitter.on('close', () => {
      try {
        const files = fs.readdirSync(tmpDir).filter((f) => !f.endsWith('.part'));
        if (!files.length) {
          return reject(new Error('Không tìm thấy file sau khi tải: ' + lastLine));
        }
        // Chọn file lớn nhất (tránh file .json/.description phụ nếu có)
        const chosen = files
          .map((f) => ({ f, size: fs.statSync(path.join(tmpDir, f)).size }))
          .sort((a, b) => b.size - a.size)[0].f;
        resolve({ filePath: path.join(tmpDir, chosen), tmpDir });
      } catch (err) {
        reject(err);
      }
    });
  });
}

function cleanupTmp(tmpDir) {
  fs.rm(tmpDir, { recursive: true, force: true }, () => {});
}

module.exports = { getInfo, startDownload, cleanupTmp, sanitizeFilename, detectPlatform, SUPPORTED_COOKIE_BROWSERS };
