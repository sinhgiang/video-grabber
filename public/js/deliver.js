// Theo dõi bước "lưu file về máy" sau khi tải xong (T-1727).
// Trước đây giao diện hiện "Hoàn tất! Đang lưu file…" rồi không bao giờ biết kết quả: nếu trình duyệt không nhận
// được file thì dòng đó đứng mãi. Nay giao diện hỏi /api/download/status/<jobId> và luôn dừng ở một thông báo
// rõ ràng (đã lưu, lỗi bằng tiếng Việt, hoặc nút "Lưu file" để tự lưu). Phần tính toán là hàm thuần để test trong Node.
(function (root) {
  const POLL_MS = 1000;
  const MANUAL_AFTER_MS = 15 * 1000; // trình duyệt chưa nhận file sau chừng này → hiện nút "Lưu file"
  const POLL_MAX_MS = 35 * 60 * 1000; // quá hạn giữ file trên server (30 phút) mà chưa xong → dừng hỏi và báo
  const MAX_FAILED_POLLS = 3;

  function fmtMB(bytes) {
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`; // VOD dài có thể vài GB
    return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  }

  /**
   * state: { kind: 'data', data } | { kind: 'gone' } | { kind: 'offline' } | { kind: 'timeout' }
   * Trả về { text, tone: 'wait'|'ok'|'warn'|'error', final, manual }.
   * final = không cần hỏi nữa; manual = hiện nút "Lưu file" để người dùng tự lưu.
   */
  function describeDelivery(state, waitedMs) {
    if (state.kind === 'gone') {
      return { text: 'ℹ️ Phiên tải đã kết thúc. Nếu chưa thấy file, hãy bấm Tải xuống lại.', tone: 'warn', final: true, manual: false };
    }
    if (state.kind === 'offline') {
      return { text: '❌ Mất kết nối tới ứng dụng khi đang lưu file. Hãy bấm Tải xuống lại.', tone: 'error', final: true, manual: false };
    }
    if (state.kind === 'timeout') {
      return { text: '⚠️ Đã quá lâu mà trình duyệt vẫn chưa nhận file. Hãy bấm Tải xuống lại.', tone: 'warn', final: true, manual: false };
    }
    const d = state.data || {};
    switch (d.delivery) {
      case 'done': {
        const size = d.total ? ` (${fmtMB(d.total)})` : '';
        return { text: `✅ Đã lưu xong file${size}. Xem trong thư mục Tải xuống hoặc nơi bạn đã chọn.`, tone: 'ok', final: true, manual: false };
      }
      case 'failed':
        return { text: '❌ ' + (d.error || 'Không lưu được file. Hãy bấm Tải xuống lại.'), tone: 'error', final: true, manual: false };
      case 'cancelled':
        return { text: '⚠️ Việc lưu file đã bị huỷ hoặc bị ngắt. Bấm "Lưu file" để lưu lại.', tone: 'warn', final: false, manual: true };
      case 'sending': {
        if (d.total > 0 && d.sent > 0) {
          const pct = Math.min(100, Math.floor((d.sent / d.total) * 100));
          return { text: `⏳ Đang lưu file về máy… ${pct}% (${fmtMB(d.sent)} / ${fmtMB(d.total)})`, tone: 'wait', final: false, manual: false };
        }
        if (waitedMs >= MANUAL_AFTER_MS) {
          return { text: '⏳ Đang chờ bạn chọn nơi lưu file (hộp thoại Lưu có thể đang mở)…', tone: 'wait', final: false, manual: true };
        }
        return { text: '⏳ Đang lưu file về máy…', tone: 'wait', final: false, manual: false };
      }
      default:
        // Server đã sẵn sàng nhưng trình duyệt chưa yêu cầu file
        if (waitedMs >= MANUAL_AFTER_MS) {
          return { text: '⚠️ Trình duyệt chưa nhận file. Bấm "Lưu file" để lưu thủ công.', tone: 'warn', final: false, manual: true };
        }
        return { text: '✅ Tải xong! Đang chờ trình duyệt nhận file…', tone: 'wait', final: false, manual: false };
    }
  }

  const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Hỏi trạng thái cho tới khi có kết quả cuối. fetchStatus() trả về { status, data } (HTTP), hoặc ném lỗi khi mất mạng.
   * onView(view) được gọi mỗi lần có thông tin mới. Trả về view cuối cùng; luôn kết thúc (có giới hạn thời gian).
   */
  async function trackDelivery({ fetchStatus, onView, sleep = defaultSleep, now = Date.now, pollMs = POLL_MS, maxMs = POLL_MAX_MS }) {
    const start = now();
    let failedPolls = 0;
    let view = describeDelivery({ kind: 'data', data: {} }, 0);
    onView(view);
    for (;;) {
      const waited = now() - start;
      if (waited > maxMs) {
        view = describeDelivery({ kind: 'timeout' }, waited);
        onView(view);
        return view;
      }
      let state = null;
      try {
        const r = await fetchStatus();
        if (r.status === 404) state = { kind: 'gone' };
        else if (r.status === 200 && r.data) state = { kind: 'data', data: r.data };
        else failedPolls++;
      } catch {
        failedPolls++;
      }
      if (state) {
        failedPolls = 0;
      } else if (failedPolls >= MAX_FAILED_POLLS) {
        state = { kind: 'offline' };
      }
      if (state) {
        view = describeDelivery(state, now() - start);
        onView(view);
        if (view.final) return view;
      }
      await sleep(pollMs);
    }
  }

  const api = { describeDelivery, trackDelivery, POLL_MS, MANUAL_AFTER_MS, POLL_MAX_MS, MAX_FAILED_POLLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VgDelivery = api;
})(typeof window !== 'undefined' ? window : globalThis);
