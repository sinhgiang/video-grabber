// Hàng đợi giới hạn số lượt tải chạy đồng thời, tránh làm quá tải máy/mạng
// khi người dùng tải nhiều video cùng lúc (chế độ hàng loạt).
const MAX_CONCURRENT = 2;

let running = 0;
const pending = [];

function pump() {
  if (running >= MAX_CONCURRENT || !pending.length) return;
  const { taskFn, resolve, reject, onDequeue } = pending.shift();
  running++;
  if (onDequeue) onDequeue();
  Promise.resolve()
    .then(taskFn)
    .then(resolve, reject)
    .finally(() => {
      running--;
      pump();
    });
}

/**
 * Xếp một tác vụ (hàm trả về Promise) vào hàng đợi.
 * onDequeue được gọi ngay khi tác vụ bắt đầu chạy thực sự (rời hàng đợi).
 */
function schedule(taskFn, onDequeue) {
  return new Promise((resolve, reject) => {
    pending.push({ taskFn, resolve, reject, onDequeue });
    pump();
  });
}

function queueLength() {
  return pending.length;
}

module.exports = { schedule, queueLength, MAX_CONCURRENT };
