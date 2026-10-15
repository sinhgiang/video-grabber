const path = require('path');
const fs = require('fs');
const os = require('os');
const YTDlpWrap = require('yt-dlp-wrap').default;
const ffmpegPath = require('ffmpeg-static');
const escalation = require('./escalation');
const sessions = require('./sessions');
const updater = require('./ytdlp-update');

const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const binPath = path.join(__dirname, '..', 'bin', binName);

function resolveBinPath() {
  // Bản yt-dlp mới hơn đã tự tải về thư mục dữ liệu người dùng (xem lib/ytdlp-update.js)
  const updated = updater.findUpdatedBinary();
  if (updated) return updated;
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
    return 'YouTube chặn luồng video (lỗi 403) trên máy/mạng này dù ứng dụng đã tự đổi client và tự thử cookie từ các trình duyệt có sẵn. Mở "Tuỳ chọn nâng cao" phía trên, đăng nhập YouTube trên trình duyệt bạn muốn dùng, đóng hẳn trình duyệt đó lại, rồi chọn đúng trình duyệt ở "Lấy cookie đăng nhập từ trình duyệt" và tải lại.';
  }
  if (/Cannot parse data|Unable to extract .*data/i.test(m)) {
    return 'yt-dlp không đọc được trang video của nền tảng này. Thường là do nền tảng yêu cầu đăng nhập (Facebook chặn cả video công khai với người chưa đăng nhập), video đã bị gỡ, hoặc yt-dlp chưa theo kịp thay đổi của trang — thử đăng nhập trong "Tuỳ chọn nâng cao" hoặc bật tự cập nhật yt-dlp.';
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
// Lỗi 403 giữa chừng tải là chính lỗi ban đầu khiến đổi ưu tiên sang client "web_embedded" (xem
// giải thích ở YOUTUBE_EXTRACTOR_ARGS) — nhưng với máy/mạng đã bị YouTube gắn cờ nghi ngờ, ngay cả
// "web_embedded" cũng có thể bị chặn 403 (đã ghi nhận thực tế). Trước đây gặp lại 403 chỉ báo lỗi
// ngay, bắt người dùng tự bấm tải lại — coi lỗi này giống hai lỗi trên: tự bỏ giới hạn client và
// thử lại ngay trong cùng một lượt tải, không cần người dùng tự thao tác.
const HTTP_403_ERROR = /unable to download video data.*403|HTTP Error 403/i;

function shouldDropClientRestriction(raw) {
  return FORMAT_UNAVAILABLE_ERROR.test(raw) || BOT_CHECK_ERROR.test(raw) || HTTP_403_ERROR.test(raw);
}

const SUPPORTED_COOKIE_BROWSERS = escalation.BROWSERS;

function cookieArgs(cookiesFromBrowser) {
  if (!cookiesFromBrowser || !SUPPORTED_COOKIE_BROWSERS.includes(cookiesFromBrowser)) return [];
  return ['--cookies-from-browser', cookiesFromBrowser];
}

// Đổi một bước của chuỗi leo thang (lib/escalation.js) thành tham số yt-dlp.
function stepArgs(step, cookieFile) {
  const args = [];
  if (step.kind === 'impersonate') args.push('--impersonate', step.impersonate);
  if (step.kind === 'app-session') args.push('--cookies', cookieFile);
  else args.push(...cookieArgs(step.browser));
  return args;
}

const INFO_TIMEOUT_MS = 45_000;
const STEP_INFO_TIMEOUT_MS = 25_000; // các cách dự phòng: lỗi nhanh để chuyển cách tiếp theo
const INFO_MAX_ATTEMPTS = 3;
const PARSE_ERROR = /Cannot parse data|Unable to extract .*data/i;

// Một số nền tảng thỉnh thoảng trả về trang không đúng dạng (rào chắn tạm thời) khiến yt-dlp báo
// lỗi dù video vẫn tải được — thử lại ngay đôi khi qua. Chỉ thử lại ở cách thường; các cách dự
// phòng chuyển thẳng sang cách kế tiếp nếu lỗi.
const TRANSIENT_INFO_ERROR = /Cannot parse data|Unable to extract .*data|ECONNRESET|ETIMEDOUT|socket hang up/i;
const RETRY_DELAY_MS = Number.isFinite(Number(process.env.VG_RETRY_DELAY_MS)) && process.env.VG_RETRY_DELAY_MS !== ''
  ? Number(process.env.VG_RETRY_DELAY_MS)
  : 700;

/** Lỗi mang theo stderr thô (.raw) để chuỗi leo thang phân loại được lý do thật. */
function rawError(raw, fallback) {
  const e = new Error(buildErrorMessage(raw, fallback || raw));
  e.raw = raw;
  return e;
}

// ---- Chuỗi leo thang: dùng chung cho Xem trước và Tải xuống ----
// Nhớ cách từng thành công theo nền tảng một lúc (Xem trước xong thì Tải xuống thử cách đó trước,
// không phải thử lại từ đầu các cách đã biết là thất bại).
const STEP_MEMORY_TTL_MS = 30 * 60 * 1000;
const stepMemory = new Map();

function recallStep(platformKey) {
  const m = stepMemory.get(platformKey);
  if (!m) return undefined;
  if (Date.now() - m.at > STEP_MEMORY_TTL_MS) {
    stepMemory.delete(platformKey);
    return undefined;
  }
  return m.id;
}

function rememberStep(platformKey, stepId) {
  if (stepId === 'normal') stepMemory.delete(platformKey);
  else stepMemory.set(platformKey, { id: stepId, at: Date.now() });
}

async function runEscalated({ url, cookiesFromBrowser, onStage }, attemptFn) {
  const platform = detectPlatform(url);
  const provider = sessions.providerForUrl(url);
  const session = provider ? await sessions.status(provider) : { available: false, loggedIn: false };
  const userBrowser = SUPPORTED_COOKIE_BROWSERS.includes(cookiesFromBrowser) ? cookiesFromBrowser : undefined;
  const steps = escalation.buildSteps({
    platformKey: platform.key,
    userBrowser,
    hasAppSession: session.loggedIn,
    preferredStepId: recallStep(platform.key),
  });

  const result = await escalation.runLadder(
    steps,
    async (step) => {
      if (step.kind !== 'app-session') return attemptFn(step, null);
      const out = await sessions.withCookieFile(provider, (file) => attemptFn(step, file));
      return out ? out.value : { skipped: true, reason: 'chưa có phiên đăng nhập' };
    },
    {
      onStep: (step, i, total) => {
        if (onStage && i > 0) onStage(`Cách trước chưa được — đang thử cách ${i + 1}/${total}: ${step.label}…`);
      },
      onExhausted: (attempts) => {
        const real = attempts.filter((a) => !a.skipped);
        if (real.length === 1) return rawError(real[0].raw, 'Không lấy được video.');
        const extractRaw = real.filter((a) => a.step.kind !== 'browser').map((a) => a.raw).join('\n');
        return escalation.buildFinalError(attempts, {
          platformKey: platform.key,
          platformLabel: platform.key === 'other' ? 'Nền tảng này' : platform.label,
          provider,
          loginAvailable: session.available,
          triedAppSession: real.some((a) => a.step.kind === 'app-session'),
          friendly: classifyYtdlpError(extractRaw),
        });
      },
    }
  );
  rememberStep(platform.key, result.step.id);
  return result.value;
}

/** Một lần gọi yt-dlp --dump-json, ném lỗi thô (message gốc từ yt-dlp) nếu thất bại. */
async function fetchInfoStdout(url, extraArgs, { forceNoClientRestriction = false, timeoutMs = INFO_TIMEOUT_MS } = {}) {
  const args = [
    url,
    ...JS_RUNTIME_ARGS,
    ...(forceNoClientRestriction ? [] : YOUTUBE_EXTRACTOR_ARGS),
    ...extraArgs,
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

// Lấy thông tin video bằng MỘT bước của chuỗi leo thang (kèm thử lại client/lỗi tạm thời bên trong).
async function infoForStep(url, step, cookieFile) {
  const extraArgs = stepArgs(step, cookieFile);
  const timeoutMs = step.kind === 'normal' ? INFO_TIMEOUT_MS : STEP_INFO_TIMEOUT_MS;
  let lastRaw = '';
  for (let attempt = 1; attempt <= INFO_MAX_ATTEMPTS; attempt++) {
    // Từ lần thử tiếp theo, nếu lần trước báo "Requested format is not available" (client
    // web_embedded chỉ trả về storyboard cho video đã tắt nhúng — xem giải thích ở
    // YOUTUBE_EXTRACTOR_ARGS) hoặc bị chặn bởi màn xác minh "không phải bot" (xem BOT_CHECK_ERROR),
    // bỏ hẳn giới hạn client để yt-dlp tự chọn client khác.
    const dropClientRestriction = shouldDropClientRestriction(lastRaw);
    try {
      return await fetchInfoStdout(url, extraArgs, { forceNoClientRestriction: dropClientRestriction, timeoutMs });
    } catch (err) {
      if (err.isTimeout) {
        const e = new Error('Phân tích quá lâu (video có thể là playlist/mix hoặc nền tảng đang chậm). Thử lại hoặc dùng link video đơn (bỏ phần "&list=...").');
        e.raw = 'TIMEOUT';
        e.fatal = step.kind === 'normal'; // cách thường quá lâu: báo ngay; cách dự phòng quá lâu: thử cách khác
        throw e;
      }
      const raw = (err && err.message) || '';
      lastRaw = raw;
      const isClientIssue = shouldDropClientRestriction(raw);
      // Lỗi client/bot-check: thử lại MỘT lần bỏ giới hạn client (lần đã bỏ rồi mà vẫn lỗi thì thôi).
      const clientRetry = isClientIssue && !dropClientRestriction;
      const retryable = clientRetry || (step.kind === 'normal' && TRANSIENT_INFO_ERROR.test(raw));
      const limit = PARSE_ERROR.test(raw) ? 2 : INFO_MAX_ATTEMPTS;
      if (attempt >= limit || !retryable) throw rawError(raw, 'Không lấy được thông tin video.');
      // Lỗi client/bot-check thử lại ngay với client khác; lỗi tạm thời thì chờ một chút.
      if (!clientRetry) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  throw new Error('Không lấy được thông tin video.'); // không tới được; để bộ phân tích tĩnh yên tâm
}

async function getInfo(url, { cookiesFromBrowser, onStage } = {}) {
  const stdout = await runEscalated({ url, cookiesFromBrowser, onStage }, (step, cookieFile) =>
    infoForStep(url, step, cookieFile)
  );

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
 * Bắt đầu tải video/audio về một thư mục tạm, gọi onProgress(percent, etaText) khi có tiến trình
 * và onStage(text) khi chuyển sang một cách dự phòng của chuỗi leo thang.
 * Trả về { filePath } khi hoàn tất.
 */
function startDownload({ url, type, quality, cookiesFromBrowser }, onProgress, onStage) {
  return runEscalated({ url, cookiesFromBrowser, onStage }, (step, cookieFile) =>
    runDownloadAttempt({ url, type, quality, extraArgs: stepArgs(step, cookieFile) }, onProgress, 'normal')
  );
}

// stage: 'normal' → dùng giới hạn client ưu tiên + chất lượng người dùng chọn.
// stage: 'hard'   → lần thử lại sau khi báo "Requested format is not available", bị chặn bởi màn
//                   xác minh "không phải bot" (BOT_CHECK_ERROR) hoặc 403 — thường do client
//                   "web_embedded" (ưu tiên dùng để tránh lỗi 403, xem YOUTUBE_EXTRACTOR_ARGS) bị
//                   YouTube chặn/giới hạn riêng, trong khi client khác (yt-dlp tự chọn khi không
//                   giới hạn, vd "android_vr") vẫn tải bình thường. Bỏ hẳn giới hạn client VÀ dùng
//                   "-f best" trần không lọc gì.
// extraArgs: tham số của bước leo thang đang chạy (impersonate / cookie trình duyệt / tệp cookie).
function runDownloadAttempt({ url, type, quality, extraArgs = [] }, onProgress, stage) {
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
    ...extraArgs,
  ];

  const canHardFallback = stage === 'normal';
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
      runDownloadAttempt({ url, type, quality, extraArgs }, onProgress, 'hard').then(resolve, reject);
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
      settled = true;
      cleanupTmp(tmpDir);
      // yt-dlp-wrap gói lỗi thành "Error code: N\n\nStderr:\n<...>" — dịch lại thành
      // thông báo tiếng Việt dễ hiểu, ưu tiên nội dung stderr thật thu được ở trên nếu có.
      reject(rawError(raw, (err && err.message) || 'Tải thất bại.'));
    });
    emitter.on('close', () => {
      if (settled) return;
      try {
        const files = fs.readdirSync(tmpDir).filter((f) => !f.endsWith('.part'));
        if (!files.length) {
          const raw = stderrTail || lastLine;
          if (canHardFallback && shouldDropClientRestriction(raw)) return retryHard();
          settled = true;
          cleanupTmp(tmpDir);
          return reject(rawError(raw, 'Không tìm thấy file sau khi tải: ' + raw));
        }
        settled = true;
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

/** Đổi bản yt-dlp đang dùng (sau khi tự cập nhật) mà không cần khởi động lại. */
function setBinaryPath(p) {
  ytDlpWrap.setBinaryPath(p);
}

function getBinaryPath() {
  return ytDlpWrap.getBinaryPath();
}

let versionCache = null;
async function getVersion() {
  if (!versionCache || versionCache.bin !== getBinaryPath()) {
    try {
      versionCache = { bin: getBinaryPath(), value: String(await ytDlpWrap.getVersion()).trim() };
    } catch {
      return null;
    }
  }
  return versionCache.value;
}

function _resetStepMemory() {
  stepMemory.clear();
}

module.exports = {
  getInfo,
  startDownload,
  cleanupTmp,
  sanitizeFilename,
  detectPlatform,
  SUPPORTED_COOKIE_BROWSERS,
  setBinaryPath,
  getBinaryPath,
  getVersion,
  stepArgs,
  _resetStepMemory,
  _wrap: ytDlpWrap, // chỉ cho test: thay execPromise/exec bằng yt-dlp giả
};
