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
  if (/Sign in to confirm you.re not a bot/i.test(m)) {
    return 'YouTube đang yêu cầu xác minh "không phải bot" cho máy/mạng này (thường do IP của mạng này bị YouTube gắn cờ nghi ngờ — hay gặp khi đổi máy/mạng khác). Mở "Tuỳ chọn nâng cao" phía trên, chọn trình duyệt bạn đang đăng nhập sẵn YouTube (Chrome/Edge/Firefox…) ở mục "Lấy cookie đăng nhập từ trình duyệt", rồi tải lại — cách này khắc phục được hầu hết trường hợp.';
  }
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
  if (/unable to download video data.*403|HTTP Error 403/i.test(m)) {
    return 'YouTube tạm thời chặn luồng video ở client đang dùng (lỗi 403). Ứng dụng đã tự đổi sang client dự phòng khác — hãy thử tải lại lần nữa.';
  }
  if (/Cannot parse data|Unable to extract .*data/i.test(m)) {
    return 'Nền tảng nguồn (thường gặp ở Facebook) tạm thời trả về trang không đọc được — ứng dụng đã tự thử lại nhiều lần nhưng vẫn chưa được. Đợi một chút rồi bấm "Xem trước" lại, hoặc kiểm tra video có còn công khai không.';
  }
  if (/Unable to download webpage|HTTP Error 4\d\d|HTTP Error 5\d\d/i.test(m)) {
    return 'Không kết nối được tới nền tảng nguồn (có thể do mạng chậm hoặc nền tảng tạm thời chặn). Thử lại sau ít phút.';
  }
  return null; // không nhận diện được — dùng thông báo mặc định của nơi gọi
}

/** Rút gọn stderr thô của yt-dlp về đúng dòng "ERROR: ..." để không hiện cả khối log dài cho người dùng. */
function extractErrorLine(rawMessage) {
  const m = String(rawMessage || '');
  const match = m.match(/ERROR:\s*(.+)/);
  return match ? match[1].trim() : null;
}

/**
 * Ghép thông báo thân thiện + dòng lỗi gốc rút gọn (nếu có) để người dùng vẫn thấy nguyên nhân
 * cụ thể (hữu ích khi báo lỗi lại cho tôi), thay vì chỉ một câu chung chung không rõ vì sao.
 */
function buildErrorMessage(rawMessage, fallback) {
  const raw = String(rawMessage || '');
  const friendly = classifyYtdlpError(raw);
  const specific = extractErrorLine(raw);
  if (friendly) return specific && !friendly.includes(specific) ? `${friendly} (Chi tiết: ${specific})` : friendly;
  return specific || fallback;
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

// Client mặc định "android_vr" mà yt-dlp tự chọn cho YouTube hiện trả về URL video bị chặn
// giữa chừng tải (HTTP 403 Forbidden), dù bước xem trước/lấy thông tin vẫn thành công bình
// thường — vì bước đó không thực sự tải dữ liệu video. Đã kiểm chứng thực tế: chuyển ưu tiên
// sang client "web_embedded" (và loại hẳn "android_vr" khỏi danh sách) tải trọn vẹn 1080p+ mà
// không còn lỗi 403. --extractor-args chỉ áp dụng cho YouTube, không ảnh hưởng nền tảng khác.
//
// NHƯNG: client "web_embedded" mô phỏng trình phát nhúng (iframe embed) — với video mà chủ
// kênh đã TẮT tính năng nhúng (rất phổ biến), YouTube chỉ trả về vài định dạng storyboard
// (ảnh thu nhỏ xem trước tua nhanh), không có định dạng video/audio thật nào — khiến cả
// getInfo lẫn tải xuống báo "Requested format is not available" dù video vẫn xem/tải bình
// thường qua yt-dlp không giới hạn client. Đã kiểm chứng thực tế trên video bị lỗi: lặp lại
// đúng lệnh mà bỏ --extractor-args này thì yt-dlp tự chọn client khác (vd "android vr") và
// tải được đủ chất lượng. Vì vậy KHÔNG dùng cứng client này — chỉ ưu tiên thử trước, và tự
// động thử lại KHÔNG giới hạn client khi gặp đúng lỗi "Requested format is not available".
const YOUTUBE_EXTRACTOR_ARGS = ['--extractor-args', 'youtube:player_client=web_embedded,default,-android_vr'];
const FORMAT_UNAVAILABLE_ERROR = /Requested format is not available/i;
// YouTube đôi khi chặn cụ thể client "web_embedded" bằng màn xác minh "không phải bot" (thường
// do IP/mạng của máy đó bị gắn cờ) mà không chặn các client khác (vd "android_vr"/"tv_embedded"
// mà yt-dlp tự chọn khi không giới hạn client) — đã kiểm chứng: bỏ giới hạn client giúp yt-dlp
// tự tìm client khác không bị chặn. Coi lỗi này giống FORMAT_UNAVAILABLE_ERROR: thử lại ngay,
// không giới hạn client, trước khi báo lỗi và yêu cầu người dùng tự lấy cookie trình duyệt.
const BOT_CHECK_ERROR = /Sign in to confirm you.re not a bot/i;

function shouldDropClientRestriction(raw) {
  return FORMAT_UNAVAILABLE_ERROR.test(raw) || BOT_CHECK_ERROR.test(raw);
}

const SUPPORTED_COOKIE_BROWSERS = ['chrome', 'edge', 'firefox', 'brave', 'opera'];

function cookieArgs(cookiesFromBrowser) {
  if (!cookiesFromBrowser || !SUPPORTED_COOKIE_BROWSERS.includes(cookiesFromBrowser)) return [];
  return ['--cookies-from-browser', cookiesFromBrowser];
}

// Khi gặp BOT_CHECK_ERROR mà người dùng CHƯA tự chọn trình duyệt ở "Tuỳ chọn nâng cao", rất
// nhiều máy thực ra đã có sẵn Chrome/Edge/Firefox... đăng nhập sẵn YouTube mà người dùng không
// biết phải bật tuỳ chọn đó lên — nên tự động thử lần lượt từng trình duyệt phổ biến trước khi
// bắt người dùng tự làm thao tác thủ công. Mỗi trình duyệt không có/không đăng nhập/đang mở
// (khoá file cookie, rất hay gặp trên Windows khi trình duyệt đang chạy) sẽ chỉ lỗi nhanh rồi
// tự chuyển sang trình duyệt tiếp theo, không làm hỏng toàn bộ tiến trình.
const AUTO_COOKIE_EXHAUSTED_MSG = 'YouTube vẫn yêu cầu xác minh "không phải bot" cho máy/mạng này dù ứng dụng đã tự thử lấy cookie từ Chrome, Edge, Firefox, Brave, Opera có sẵn trên máy. Có thể máy này chưa đăng nhập YouTube trên trình duyệt nào, hoặc trình duyệt đang mở (hãy đóng hẳn trình duyệt rồi thử lại). Nếu vẫn không được: mở "Tuỳ chọn nâng cao" phía trên, đăng nhập YouTube trên trình duyệt bạn muốn dùng, đóng hẳn trình duyệt đó lại, rồi chọn đúng trình duyệt ở "Lấy cookie đăng nhập từ trình duyệt" và tải lại.';

const INFO_TIMEOUT_MS = 45_000;

// Một số nền tảng (đặc biệt Facebook) thỉnh thoảng trả về trang không đúng dạng mong đợi
// (rào chắn tạm thời/thay đổi A-B test) khiến yt-dlp báo lỗi dù video vẫn xem/tải bình thường —
// thử lại ngay sau đó gần như luôn thành công (đã kiểm chứng thực tế 3/3 lần thử lại đều qua).
// Tự thử lại vài lần trước khi báo lỗi cho người dùng, để họ không phải tự bấm "Xem trước" lại.
const TRANSIENT_INFO_ERROR = /Cannot parse data|Unable to extract .*data|ECONNRESET|ETIMEDOUT|socket hang up/i;
const INFO_MAX_ATTEMPTS = 3;

/** Một lần gọi yt-dlp --dump-json, ném lỗi thô (message gốc từ yt-dlp) nếu thất bại. */
async function fetchInfoStdout(url, cookiesFromBrowser, { forceNoClientRestriction = false, timeoutMs = INFO_TIMEOUT_MS } = {}) {
  const args = [
    url,
    ...JS_RUNTIME_ARGS,
    ...(forceNoClientRestriction ? [] : YOUTUBE_EXTRACTOR_ARGS),
    ...cookieArgs(cookiesFromBrowser),
    '--no-playlist', // tránh bị treo khi link kèm playlist/mix (vd. YouTube "list=RD...")
    '-f', 'best',
    '--dump-json',
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await ytDlpWrap.execPromise(args, {}, controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      const timeoutErr = new Error('TIMEOUT');
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Thử lần lượt lấy cookie từ các trình duyệt phổ biến có sẵn trên máy — xem giải thích ở
// AUTO_COOKIE_EXHAUSTED_MSG. Trả về stdout nếu có trình duyệt nào thành công, null nếu hết cách.
async function tryAutoCookieBrowsersInfo(url) {
  for (const browser of SUPPORTED_COOKIE_BROWSERS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fetchInfoStdout(url, browser, { forceNoClientRestriction: true, timeoutMs: 20_000 });
    } catch (e) {
      // trình duyệt này không có/không đăng nhập/đang khoá file cookie — thử trình duyệt tiếp theo
    }
  }
  return null;
}

async function getInfo(url, { cookiesFromBrowser } = {}) {
  let stdout;
  let lastRaw = '';
  for (let attempt = 1; attempt <= INFO_MAX_ATTEMPTS; attempt++) {
    // Từ lần thử tiếp theo, nếu lần trước báo "Requested format is not available" (client
    // web_embedded chỉ trả về storyboard cho video đã tắt nhúng — xem giải thích ở
    // YOUTUBE_EXTRACTOR_ARGS phía trên) hoặc bị chặn bởi màn xác minh "không phải bot" (xem
    // BOT_CHECK_ERROR), bỏ hẳn giới hạn client để yt-dlp tự chọn client khác.
    const dropClientRestriction = shouldDropClientRestriction(lastRaw);
    try {
      stdout = await fetchInfoStdout(url, cookiesFromBrowser, { forceNoClientRestriction: dropClientRestriction });
      break;
    } catch (err) {
      if (err.isTimeout) {
        throw new Error('Phân tích quá lâu (video có thể là playlist/mix hoặc nền tảng đang chậm). Thử lại hoặc dùng link video đơn (bỏ phần "&list=...").');
      }
      const raw = (err && err.message) || '';
      lastRaw = raw;
      const isClientIssue = shouldDropClientRestriction(raw);
      const canRetry = attempt < INFO_MAX_ATTEMPTS && (TRANSIENT_INFO_ERROR.test(raw) || isClientIssue);
      if (!canRetry) {
        // Đã hết các lần thử với client dự phòng. Nếu đúng lỗi xác minh bot VÀ người dùng chưa tự
        // chọn cookie trình duyệt, tự động thử lần lượt các trình duyệt có sẵn trên máy trước khi
        // báo lỗi hẳn — xem giải thích ở tryAutoCookieBrowsersInfo/AUTO_COOKIE_EXHAUSTED_MSG.
        if (!cookiesFromBrowser && BOT_CHECK_ERROR.test(raw)) {
          const autoStdout = await tryAutoCookieBrowsersInfo(url);
          if (autoStdout) {
            stdout = autoStdout;
            break;
          }
          throw new Error(AUTO_COOKIE_EXHAUSTED_MSG);
        }
        throw new Error(buildErrorMessage(raw, raw || 'Không lấy được thông tin video.'));
      }
      // Lỗi "format not available" / bị chặn xác minh bot nên thử lại ngay với client khác,
      // không cần chờ (không phải lỗi mạng tạm thời nên chờ thêm cũng vô ích).
      if (!isClientIssue) {
        await new Promise((r) => setTimeout(r, 700 * attempt));
      }
    }
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
  // quality không phải số hợp lệ (vd giá trị lạ lọt từ client) — tránh dựng chuỗi
  // "[height<=NaN]" khiến yt-dlp coi cả biểu thức -f là lỗi cú pháp và tải thất bại hẳn.
  if (!Number.isFinite(h)) return 'bestvideo*+bestaudio/best';
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
  return runDownloadAttempt({ url, type, quality, cookiesFromBrowser }, onProgress, 'normal');
}

// Thử lần lượt tải bằng cookie của các trình duyệt phổ biến có sẵn trên máy — tầng cuối cùng,
// chỉ chạy khi tầng "hard" (bỏ giới hạn client + -f best) vẫn báo BOT_CHECK_ERROR và người dùng
// CHƯA tự chọn trình duyệt ở "Tuỳ chọn nâng cao". Xem giải thích đầy đủ ở AUTO_COOKIE_EXHAUSTED_MSG.
async function tryAutoCookieBrowsersDownload({ url, type, quality }, onProgress) {
  for (const browser of SUPPORTED_COOKIE_BROWSERS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await runDownloadAttempt({ url, type, quality, cookiesFromBrowser: browser }, onProgress, 'autocookie');
    } catch (e) {
      // trình duyệt này không có/không đăng nhập/đang khoá file cookie — thử trình duyệt tiếp theo
    }
  }
  throw new Error(AUTO_COOKIE_EXHAUSTED_MSG);
}

// stage: 'normal' → dùng giới hạn client ưu tiên + chất lượng người dùng chọn.
// stage: 'hard'   → lần thử lại sau khi báo "Requested format is not available" hoặc bị chặn bởi
//                   màn xác minh "không phải bot" (BOT_CHECK_ERROR) — cả hai đều thường do client
//                   "web_embedded" (ưu tiên dùng để tránh lỗi 403, xem YOUTUBE_EXTRACTOR_ARGS) bị
//                   YouTube chặn/giới hạn riêng, trong khi client khác (yt-dlp tự chọn khi không
//                   giới hạn, vd "android_vr") vẫn tải bình thường. Bỏ hẳn giới hạn client VÀ dùng
//                   "-f best" trần không lọc gì.
// stage: 'autocookie' → như 'hard' nhưng kèm cookie của một trình duyệt cụ thể, gọi từ
//                   tryAutoCookieBrowsersDownload khi 'hard' vẫn bị chặn xác minh bot.
function runDownloadAttempt({ url, type, quality, cookiesFromBrowser }, onProgress, stage) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'videograbber-'));
  const outTemplate = path.join(tmpDir, '%(title).150B.%(ext)s');
  const isHardFallback = stage !== 'normal';

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
    ...(isHardFallback ? [] : YOUTUBE_EXTRACTOR_ARGS),
    ...cookieArgs(cookiesFromBrowser),
  ];

  const canHardFallback = stage === 'normal';
  // Chỉ tự động thử cookie trình duyệt sau tầng "hard" và khi người dùng chưa tự chọn trình
  // duyệt nào (nếu họ đã chọn mà vẫn lỗi thì tôn trọng lựa chọn đó, không tự ý đổi sang trình
  // duyệt khác của họ).
  const canAutoCookie = stage === 'hard' && !cookiesFromBrowser;
  if (type === 'mp3') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    const selector = isHardFallback ? 'best' : buildFormatSelector('mp4', quality);
    args.push('-f', selector, '--merge-output-format', 'mp4');
  }

  return new Promise((resolve, reject) => {
    const emitter = ytDlpWrap.exec(args);
    let lastLine = '';
    let stderrTail = '';
    let settled = false;

    const retryHard = () => {
      settled = true;
      cleanupTmp(tmpDir);
      runDownloadAttempt({ url, type, quality, cookiesFromBrowser }, onProgress, 'hard').then(resolve, reject);
    };

    const retryAutoCookie = () => {
      settled = true;
      cleanupTmp(tmpDir);
      tryAutoCookieBrowsersDownload({ url, type, quality }, onProgress).then(resolve, reject);
    };

    emitter.on('progress', (p) => {
      if (onProgress) onProgress(Math.round(p.percent || 0), p.eta_seconds != null ? `${p.eta_seconds}s` : '');
    });
    emitter.ytDlpProcess?.stdout?.on('data', (chunk) => {
      lastLine = chunk.toString();
    });
    emitter.ytDlpProcess?.stderr?.on('data', (chunk) => {
      stderrTail += chunk.toString();
    });
    emitter.on('error', (err) => {
      if (settled) return;
      const raw = stderrTail || (err && err.message) || '';
      if (canHardFallback && shouldDropClientRestriction(raw)) return retryHard();
      if (canAutoCookie && BOT_CHECK_ERROR.test(raw)) return retryAutoCookie();
      // yt-dlp-wrap gói lỗi thành "Error code: N\n\nStderr:\n<...>" — dịch lại thành
      // thông báo tiếng Việt dễ hiểu, ưu tiên nội dung stderr thật thu được ở trên nếu có.
      reject(new Error(buildErrorMessage(raw, (err && err.message) || 'Tải thất bại.')));
    });
    emitter.on('close', () => {
      if (settled) return;
      try {
        const files = fs.readdirSync(tmpDir).filter((f) => !f.endsWith('.part'));
        if (!files.length) {
          const raw = stderrTail || lastLine;
          if (canHardFallback && shouldDropClientRestriction(raw)) return retryHard();
          if (canAutoCookie && BOT_CHECK_ERROR.test(raw)) return retryAutoCookie();
          return reject(new Error(buildErrorMessage(raw, 'Không tìm thấy file sau khi tải: ' + raw)));
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
