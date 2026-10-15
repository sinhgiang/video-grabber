// Chuỗi phương án tự leo thang khi một nền tảng không cho đọc video ở lần thử thường (Facebook
// đòi đăng nhập, TikTok/Instagram chặn truy cập ẩn danh, YouTube nghi bot…).
//
// Thứ tự (mỗi cách chỉ chạy khi cách trước thất bại):
//   1. bình thường
//   2. giả dạng trình duyệt: Chrome, Safari, Chrome trên Android (--impersonate)
//   3. cookie đăng nhập của các trình duyệt có sẵn trên máy
//   4. phiên đăng nhập đã lưu trong cửa sổ đăng nhập của ứng dụng
//   5. hết cách → báo lỗi với lý do thật và việc người dùng cần làm (buildFinalError)
//
// Module này chỉ chứa logic thuần (không gọi yt-dlp) để test được từng bước.
const BROWSERS = ['firefox', 'edge', 'brave', 'chrome', 'opera'];
const BROWSER_LABELS = { firefox: 'Firefox', edge: 'Edge', brave: 'Brave', chrome: 'Chrome', opera: 'Opera' };

const IMPERSONATE_STEPS = [
  { id: 'impersonate-chrome', impersonate: 'chrome', label: 'giả dạng trình duyệt Chrome' },
  { id: 'impersonate-safari', impersonate: 'safari', label: 'giả dạng trình duyệt Safari' },
  { id: 'impersonate-android', impersonate: 'chrome:android', label: 'giả dạng Chrome trên Android' },
];

/**
 * Dựng danh sách bước theo thứ tự thử.
 * @param {object} o
 * @param {string} o.platformKey khoá nền tảng (detectPlatform)
 * @param {string} [o.userBrowser] trình duyệt người dùng tự chọn ở "Tuỳ chọn nâng cao": nếu có thì
 *   tôn trọng lựa chọn đó (dùng ở mọi bước), không tự thử trình duyệt khác của họ.
 * @param {boolean} [o.hasAppSession] đã có phiên đăng nhập lưu trong ứng dụng
 * @param {string} [o.preferredStepId] bước từng thành công gần đây cho nền tảng này: thử trước.
 */
function buildSteps({ platformKey, userBrowser, hasAppSession = false, preferredStepId } = {}) {
  const steps = [{ id: 'normal', kind: 'normal', label: 'cách thường', browser: userBrowser || null }];
  if (platformKey !== 'youtube') {
    for (const s of IMPERSONATE_STEPS) {
      steps.push({ id: s.id, kind: 'impersonate', label: s.label, impersonate: s.impersonate, browser: userBrowser || null });
    }
  }
  if (!userBrowser) {
    for (const b of BROWSERS) {
      steps.push({ id: `browser-${b}`, kind: 'browser', label: `cookie trình duyệt ${BROWSER_LABELS[b]}`, browser: b });
    }
  }
  if (hasAppSession) {
    steps.push({ id: 'app-session', kind: 'app-session', label: 'phiên đăng nhập đã lưu trong ứng dụng' });
  }
  if (preferredStepId && preferredStepId !== 'normal') {
    const i = steps.findIndex((s) => s.id === preferredStepId);
    if (i > 0) steps.unshift(...steps.splice(i, 1));
  }
  return steps;
}

// Lỗi không thể khắc phục bằng cách đổi phương án: dừng ngay, không leo thang.
const FATAL_ERROR = /Unsupported URL|ENOSPC|No space left|EACCES|EPERM/i;

function rawOf(err) {
  return String((err && (err.raw || err.message)) || err || '');
}

function isFatal(err) {
  return !!(err && err.fatal) || FATAL_ERROR.test(rawOf(err));
}

/**
 * Chạy lần lượt các bước cho tới khi một bước thành công.
 * @returns {Promise<{value:any, step:object, attempts:Array}>}
 * @throws lỗi gốc của bước nếu lỗi đó "fatal"; nếu không, ném lỗi cuối từ buildFinalError
 *   (nhưng việc dựng lỗi cuối cần ngữ cảnh nên chỉ gom `attempts` và gọi onExhausted).
 */
async function runLadder(steps, runStep, { onStep, onExhausted } = {}) {
  const attempts = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (onStep) onStep(step, i, steps.length);
    try {
      // eslint-disable-next-line no-await-in-loop
      const out = await runStep(step);
      // runStep trả { skipped: true } khi bước không thể chạy (vd chưa có phiên đăng nhập)
      if (out && out.skipped) {
        attempts.push({ step, raw: out.reason || '', skipped: true });
        continue;
      }
      return { value: out, step, attempts };
    } catch (err) {
      if (isFatal(err)) throw err;
      attempts.push({ step, raw: rawOf(err) });
    }
  }
  if (onExhausted) throw onExhausted(attempts);
  throw new Error('Đã thử mọi cách nhưng không lấy được video.');
}

// ---- Phân loại lý do thật khi hết cách ----
const REMOVED = /(video|content|post|reel).{0,40}(has been removed|was removed|no longer available|has been deleted|was deleted|isn.t available|is unavailable)|Video unavailable|This (content|video) isn.t available|This video has been removed|nội dung này hiện không hiển thị/i;
const FRIENDS_ONLY = /only (available )?(to|for) (his |her |their )?friends|friends only|shared with friends|privacy settings|available to (a )?(specific|certain) audience/i;
const NEEDS_LOGIN = /Cannot parse data|Unable to extract|Login required|log in|Sign in|login|empty media response|No video formats|Private video|This video is private|requiring authentication|rate.limit|HTTP Error 40[13]|checkpoint/i;
const BLOCKED = /HTTP Error 403|Sign in to confirm you.re not a bot|HTTP Error 429|unable to download video data/i;

const BROWSER_PROBLEMS = [
  { re: /Could not copy.*cookie database|database is locked|being used by another process/i, text: 'đang mở/khoá tệp cookie' },
  { re: /DPAPI|Failed to decrypt|app.?bound|decrypt/i, text: 'mã hoá cookie kiểu mới, không đọc được từ bên ngoài' },
  { re: /could not find .* cookies database/i, text: 'không có trên máy' },
];

function browserProblem(raw) {
  for (const p of BROWSER_PROBLEMS) if (p.re.test(raw)) return p.text;
  return 'không lấy được cookie';
}

function lastErrorLine(raw) {
  const matches = String(raw || '').match(/ERROR:\s*(.+)/g);
  if (matches && matches.length) {
    // bỏ đoạn kêu gọi báo lỗi dài dòng của yt-dlp ("; please report this issue on ...")
    return matches[matches.length - 1].replace(/^ERROR:\s*/, '').replace(/;\s*please report this issue.*$/i, '').trim().slice(0, 240);
  }
  return String(raw || '').trim().split('\n').pop().slice(0, 240);
}

/** Tóm tắt các cách đã thử, vd "cách thường; giả dạng Chrome; Firefox (không có trên máy)". */
function summarizeAttempts(attempts) {
  return attempts
    .map((a) => {
      if (a.skipped) return null;
      if (a.step.kind === 'browser') return `${a.step.label.replace('cookie trình duyệt ', '')} (${browserProblem(a.raw)})`;
      return a.step.label;
    })
    .filter(Boolean)
    .join('; ');
}

/**
 * Dựng lỗi cuối khi hết mọi cách: nêu NGUYÊN NHÂN THẬT và việc người dùng cần làm.
 * @param {Array} attempts kết quả runLadder
 * @param {object} ctx { platformKey, platformLabel, provider (khoá nền tảng cần đăng nhập hoặc null),
 *   loginAvailable (đang chạy trong app desktop), triedAppSession (đã thử phiên đã lưu),
 *   friendly (câu giải thích có sẵn cho lỗi cuối, dùng khi không rõ lý do khác) }
 * @returns {Error} có thêm .code, .provider, .attempts
 */
function buildFinalError(attempts, ctx = {}) {
  const real = attempts.filter((a) => !a.skipped);
  // lỗi của các bước trích xuất (không tính lỗi lấy cookie trình duyệt) quyết định lý do
  const extractRaws = real.filter((a) => a.step.kind !== 'browser').map((a) => a.raw);
  const all = extractRaws.join('\n');
  const last = lastErrorLine(extractRaws[extractRaws.length - 1] || real[real.length - 1]?.raw || '');
  const tried = summarizeAttempts(real);
  const name = ctx.platformLabel || 'Nền tảng này';
  const detail = `(Đã thử: ${tried || 'cách thường'}. Chi tiết: ${last || 'không rõ'})`;

  let code;
  let message;
  if (ctx.platformKey === 'youtube' && BLOCKED.test(all)) {
    code = 'BLOCKED';
    message = 'YouTube vẫn chặn máy/mạng này (yêu cầu xác minh "không phải bot" hoặc lỗi 403) dù ứng dụng đã tự đổi client và tự thử lấy cookie từ các trình duyệt có sẵn. Có thể máy này chưa đăng nhập YouTube trên trình duyệt nào, hoặc trình duyệt đang mở (hãy đóng hẳn trình duyệt rồi thử lại). Nếu vẫn không được: mở "Tuỳ chọn nâng cao", đăng nhập YouTube trên trình duyệt bạn muốn dùng, đóng hẳn trình duyệt đó, rồi chọn đúng trình duyệt ở "Lấy cookie đăng nhập từ trình duyệt" và tải lại.';
  } else if (ctx.provider && !ctx.triedAppSession && (NEEDS_LOGIN.test(all) || REMOVED.test(all) || FRIENDS_ONLY.test(all))) {
    // Chưa đăng nhập được thì chưa biết video bị gỡ hay chỉ bị che với người lạ: Facebook trả cùng
    // một kiểu lỗi ("Cannot parse data", "nội dung không khả dụng") cho cả ba trường hợp.
    code = 'LOGIN_REQUIRED';
    message = ctx.loginAvailable
      ? `${name} yêu cầu đăng nhập mới cho xem video này (kể cả video công khai, ${name} cũng chặn người chưa đăng nhập). Bấm "Đăng nhập ${name} một lần" (nút bên dưới hoặc ở "Tuỳ chọn nâng cao") để đăng nhập ngay trong ứng dụng — phiên chỉ lưu trên máy bạn — rồi thử lại. Lưu ý: nếu video đã bị gỡ, hoặc tài khoản bạn đăng nhập không có quyền xem (video riêng tư/chỉ bạn bè của người khác) thì vẫn không tải được.`
      : `${name} yêu cầu đăng nhập mới cho xem video này. Đăng nhập ngay trong ứng dụng chỉ có ở bản ứng dụng desktop (Video Grabber Setup). Ở bản web, hãy mở "Tuỳ chọn nâng cao", đăng nhập ${name} trên Firefox, đóng hẳn Firefox rồi chọn Firefox ở mục "Lấy cookie đăng nhập từ trình duyệt" (Chrome/Edge mới mã hoá cookie nên thường không đọc được). Nếu video đã bị gỡ hoặc tài khoản không có quyền xem thì không tải được.`;
  } else if (FRIENDS_ONLY.test(all) && !/Cannot parse data/.test(all)) {
    code = 'FRIENDS_ONLY';
    message = `${name}: video này chỉ chia sẻ cho một nhóm người xem nhất định (bạn bè/đối tượng được chọn). Ứng dụng chỉ tải được khi tài khoản đã đăng nhập thuộc nhóm đó — nếu không có quyền xem thì không thể tải.`;
  } else if (REMOVED.test(all)) {
    code = 'REMOVED';
    message = `${name}: video này đã bị gỡ, bị xoá hoặc không còn hiển thị với tài khoản của bạn nên không thể tải. Kiểm tra lại bằng cách mở link trong trình duyệt đã đăng nhập; nếu ở đó cũng không xem được thì không có cách nào tải.`;
  } else if (ctx.triedAppSession) {
    code = 'NO_ACCESS';
    message = `Đã đăng nhập ${name} trong ứng dụng nhưng vẫn không lấy được video. Nguyên nhân thường gặp: (1) tài khoản đó không có quyền xem (video riêng tư/chỉ bạn bè xem của người khác), (2) video đã bị gỡ, (3) phiên đăng nhập đã hết hạn hoặc ${name} đang yêu cầu xác minh — hãy mở "Tuỳ chọn nâng cao", bấm "Đăng xuất" rồi đăng nhập lại bằng đúng tài khoản xem được video. Nếu vẫn lỗi, thử cập nhật yt-dlp (xem mục Tuỳ chọn nâng cao) vì ${name} có thể vừa đổi cách phát video.`;
  } else if (BLOCKED.test(all)) {
    code = 'BLOCKED';
    message = `${name} đang chặn các yêu cầu tự động từ máy/mạng này (lỗi 403/429 hoặc yêu cầu xác minh) dù ứng dụng đã thử giả dạng trình duyệt và dùng cookie có sẵn. Thử lại sau ít phút, đổi mạng, hoặc mở "Tuỳ chọn nâng cao" để dùng tài khoản đã đăng nhập.`;
  } else {
    code = 'UNKNOWN';
    message = ctx.friendly || `Ứng dụng đã thử mọi cách (thường, giả dạng trình duyệt, cookie trình duyệt${ctx.loginAvailable ? ', phiên đăng nhập trong ứng dụng' : ''}) nhưng vẫn không đọc được video này. Có thể link sai, video đã bị gỡ, hoặc ${name} vừa đổi cách phát video — thử cập nhật yt-dlp ở "Tuỳ chọn nâng cao" rồi thử lại.`;
  }

  // Với trình duyệt: nói rõ nếu có cookie bị khoá hoặc mã hoá, vì đó là việc người dùng làm được
  const browserAttempts = real.filter((a) => a.step.kind === 'browser');
  const locked = browserAttempts.filter((a) => /đang mở|mã hoá/.test(browserProblem(a.raw)));
  let browserNote = '';
  if (locked.length && code !== 'REMOVED' && code !== 'FRIENDS_ONLY') {
    browserNote = ` Ghi chú: cookie ${locked.map((a) => BROWSER_LABELS[a.step.browser]).join(', ')} không đọc được (trình duyệt đang mở hoặc Windows mã hoá cookie kiểu mới) — đóng hẳn trình duyệt rồi thử lại, hoặc dùng đăng nhập trong ứng dụng.`;
  }

  const err = new Error(`${message}${browserNote} ${detail}`);
  err.code = code;
  err.provider = ctx.provider || null;
  err.attempts = real.map((a) => ({ id: a.step.id, raw: lastErrorLine(a.raw) }));
  return err;
}

module.exports = {
  BROWSERS,
  buildSteps,
  runLadder,
  buildFinalError,
  summarizeAttempts,
  isFatal,
  lastErrorLine,
  REMOVED,
  FRIENDS_ONLY,
};
