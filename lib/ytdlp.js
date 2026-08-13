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

/**
 * Dịch lỗi thô từ yt-dlp thành thông báo tiếng Việt dễ hiểu + gợi ý cách khắc phục,
 * thay vì luôn hiện một câu chung chung không rõ nguyên nhân thật.
 */
function classifyYtdlpError(rawMessage) {
  const m = String(rawMessage || '');
  if (/solve_challenge|Unexpected response from webpage request/i.test(m)) {
    return 'Nền tảng này (thường là TikTok) đang chặn/yêu cầu xác minh với các yêu cầu tự động. Hãy thử lại sau vài phút, hoặc mở "Tuỳ chọn nâng cao" và chọn trình duyệt bạn đã đăng nhập sẵn tài khoản đó.';
  }
  if (/Requested format is not available/i.test(m)) {
    return 'Không tìm thấy chất lượng phù hợp cho video này. Hãy thử chọn mức chất lượng khác (vd 720p) hoặc chọn "Tốt nhất có sẵn".';
  }
  if (/Private video|This video is private/i.test(m)) {
    return 'Video này ở chế độ riêng tư. Hãy mở "Tuỳ chọn nâng cao" và chọn trình duyệt bạn đã đăng nhập tài khoản có quyền xem video này.';
  }
  if (/Login required|not available.*country|geo.restrict/i.test(m)) {
    return 'Video yêu cầu đăng nhập hoặc bị giới hạn khu vực. Thử dùng tuỳ chọn cookie trình duyệt trong "Tuỳ chọn nâng cao".';
  }
  if (/Unable to download webpage|HTTP Error 4\d\d|HTTP Error 5\d\d/i.test(m)) {
    return 'Không kết nối được tới nền tảng nguồn (có thể do mạng chậm hoặc nền tảng tạm thời chặn). Thử lại sau ít phút.';
  }
  return null; // không nhận diện được — dùng thông báo mặc định của nơi gọi
}

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

const INFO_TIMEOUT_MS = 45_000;

async function getInfo(url, { cookiesFromBrowser } = {}) {
  const args = [
    url,
    ...JS_RUNTIME_ARGS,
    ...cookieArgs(cookiesFromBrowser),
    '--no-playlist', // tránh bị treo khi link kèm playlist/mix (vd. YouTube "list=RD...")
    '-f', 'best',
    '--dump-json',
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INFO_TIMEOUT_MS);

  let stdout;
  try {
    stdout = await ytDlpWrap.execPromise(args, {}, controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error('Phân tích quá lâu (video có thể là playlist/mix hoặc nền tảng đang chậm). Thử lại hoặc dùng link video đơn (bỏ phần "&list=...").');
    }
    const friendly = classifyYtdlpError(err && err.message);
    throw new Error(friendly || (err && err.message) || 'Không lấy được thông tin video.');
  } finally {
    clearTimeout(timer);
  }

  const raw = JSON.parse(stdout);
  const info = Array.isArray(raw) ? raw[0] : raw;

  const heights = new Set();
  (info.formats || []).forEach((f) => {
    if (f.vcodec && f.vcodec !== 'none' && f.height) {
      // Với video dọc (Reels/Shorts/TikTok...) chiều cao thực tế (vd 1920) lớn hơn chiều rộng
      // (vd 1080) — "chất lượng" mà người dùng hiểu (1080p) tương ứng cạnh NGẮN hơn, không phải
      // f.height. Dùng cạnh ngắn hơn để nhãn chất lượng đúng với cả video ngang lẫn video dọc.
      const effective = f.width ? Math.min(f.height, f.width) : f.height;
      heights.add(effective);
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
  // Thử lọc theo chiều cao (video ngang) trước, rồi theo chiều rộng (video dọc: Reels/Shorts/
  // TikTok — nơi height thực tế > width nên lọc "height<=h" sẽ loại hết mọi định dạng và báo lỗi
  // "Requested format is not available"), và luôn có phương án "best" cuối cùng để không bao giờ
  // tải thất bại chỉ vì không khớp đúng chất lượng mong muốn.
  return [
    `bestvideo[height<=${h}]+bestaudio`,
    `bestvideo[width<=${h}]+bestaudio`,
    `best[height<=${h}]`,
    `best[width<=${h}]`,
    'best',
  ].join('/');
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
    // Tải nhiều mảnh (fragment) song song + chia nhỏ file để tải đa luồng → nhanh hơn nhiều lần
    '--concurrent-fragments', '16',
    '--http-chunk-size', '10M',
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
    let stderrTail = '';

    emitter.on('progress', (p) => {
      if (onProgress) onProgress(Math.round(p.percent || 0), p.eta_seconds != null ? `${p.eta_seconds}s` : '');
    });
    emitter.ytDlpProcess?.stdout?.on('data', (chunk) => {
      lastLine = chunk.toString();
    });
    emitter.ytDlpProcess?.stderr?.on('data', (chunk) => {
      stderrTail += chunk.toString();
    });
    emitter.on('error', (err) => reject(err));
    emitter.on('close', () => {
      try {
        const files = fs.readdirSync(tmpDir).filter((f) => !f.endsWith('.part'));
        if (!files.length) {
          const raw = stderrTail || lastLine;
          const friendly = classifyYtdlpError(raw);
          return reject(new Error(friendly || 'Không tìm thấy file sau khi tải: ' + raw));
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
