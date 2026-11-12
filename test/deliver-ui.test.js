// T-1727: giao diện không được đứng mãi ở "Đang lưu file…". Kiểm phần tính toán của public/js/deliver.js
// (hàm thuần + vòng theo dõi với đồng hồ giả): mọi kết cục đều dừng ở một thông báo tiếng Việt rõ ràng.
const test = require('node:test');
const assert = require('node:assert');
const { describeDelivery, trackDelivery, MANUAL_AFTER_MS, POLL_MS, POLL_MAX_MS, MAX_FAILED_POLLS } = require('../public/js/deliver.js');

const data = (d) => ({ kind: 'data', data: d });
const MB = 1024 * 1024;

test('describeDelivery: từng trạng thái của server → câu tiếng Việt đúng việc đang làm', () => {
  assert.match(describeDelivery(data({}), 0).text, /Đang chờ trình duyệt nhận file/);
  assert.match(describeDelivery(data({ delivery: 'sending' }), 0).text, /Đang lưu file về máy/);

  const half = describeDelivery(data({ delivery: 'sending', sent: 50 * MB, total: 100 * MB }), 3000);
  assert.match(half.text, /50% \(50 MB \/ 100 MB\)/);
  assert.strictEqual(half.final, false);
  assert.match(describeDelivery(data({ delivery: 'sending', sent: 1024 * MB, total: 4096 * MB }), 3000).text, /25% \(1\.00 GB \/ 4\.00 GB\)/);
  assert.match(describeDelivery(data({ delivery: 'sending', sent: 3 * MB, total: 8 * MB }), 3000).text, /37% \(3\.0 MB \/ 8\.0 MB\)/);

  const done = describeDelivery(data({ delivery: 'done', total: 270 * MB }), 9000);
  assert.match(done.text, /Đã lưu xong file \(270 MB\)/);
  assert.deepStrictEqual([done.tone, done.final, done.manual], ['ok', true, false]);

  const failed = describeDelivery(data({ delivery: 'failed', error: 'Không tìm thấy file đã tải. Hãy bấm Tải xuống lại.' }), 1000);
  assert.strictEqual(failed.text, '❌ Không tìm thấy file đã tải. Hãy bấm Tải xuống lại.');
  assert.deepStrictEqual([failed.tone, failed.final], ['error', true]);
  assert.match(describeDelivery(data({ delivery: 'failed' }), 0).text, /Không lưu được file/, 'lỗi không kèm nội dung vẫn có câu tiếng Việt');

  const cancelled = describeDelivery(data({ delivery: 'cancelled' }), 1000);
  assert.deepStrictEqual([cancelled.tone, cancelled.final, cancelled.manual], ['warn', false, true]);
  assert.match(cancelled.text, /Lưu file/);
});

test('describeDelivery: trình duyệt không nhận file → sau 15 giây hiện nút "Lưu file" và nói rõ, không im lặng', () => {
  const early = describeDelivery(data({}), MANUAL_AFTER_MS - 1);
  assert.strictEqual(early.manual, false);
  const late = describeDelivery(data({}), MANUAL_AFTER_MS);
  assert.strictEqual(late.manual, true);
  assert.match(late.text, /Trình duyệt chưa nhận file/);
  // hộp thoại Lưu đang mở: đang gửi nhưng chưa byte nào
  const dialog = describeDelivery(data({ delivery: 'sending', sent: 0, total: 5 * MB }), MANUAL_AFTER_MS + 1);
  assert.match(dialog.text, /chọn nơi lưu file/);
});

test('describeDelivery: phiên hết hạn, mất kết nối, quá lâu → thông báo cuối bằng tiếng Việt', () => {
  assert.match(describeDelivery({ kind: 'gone' }, 0).text, /Phiên tải đã kết thúc/);
  assert.match(describeDelivery({ kind: 'offline' }, 0).text, /Mất kết nối/);
  assert.match(describeDelivery({ kind: 'timeout' }, 0).text, /quá lâu/);
  for (const k of ['gone', 'offline', 'timeout']) assert.strictEqual(describeDelivery({ kind: k }, 0).final, true, k);
});

// Đồng hồ giả: sleep() chỉ cộng thời gian, không chờ thật
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

function run(script, opts = {}) {
  const clock = fakeClock();
  const views = [];
  let i = 0;
  let calls = 0;
  const fetchStatus = async () => {
    calls++;
    const step = typeof script === 'function' ? script(clock.now(), i++) : script[Math.min(i++, script.length - 1)];
    if (step instanceof Error) throw step;
    return step;
  };
  const promise = trackDelivery({ fetchStatus, onView: (v) => views.push(v), now: clock.now, sleep: clock.sleep, ...opts });
  return { promise, views, clock, calls: () => calls };
}

const ok = (d) => ({ status: 200, data: d });

test('trackDelivery: chưa lấy → đang gửi → đang lưu 50% → đã lưu: dừng ở "đã lưu xong"', async () => {
  const r = run([ok({}), ok({ delivery: 'sending', sent: 0, total: 100 * MB }), ok({ delivery: 'sending', sent: 50 * MB, total: 100 * MB }), ok({ delivery: 'done', total: 100 * MB })]);
  const final = await r.promise;
  assert.strictEqual(final.tone, 'ok');
  assert.match(final.text, /Đã lưu xong file/);
  assert.ok(r.views.some((v) => /50%/.test(v.text)), 'có hiện tiến độ lưu');
  assert.strictEqual(r.calls(), 4);
});

test('trackDelivery: trình duyệt không bao giờ lấy file → hiện nút Lưu file sau 15 giây, rồi dừng với thông báo (không đứng mãi)', async () => {
  const r = run([ok({})]); // server luôn báo "chưa ai lấy file"
  const final = await r.promise;
  assert.ok(r.views.some((v) => v.manual && /Trình duyệt chưa nhận file/.test(v.text)), 'có lúc hiện nút Lưu file');
  assert.strictEqual(final.final, true);
  assert.match(final.text, /quá lâu/);
  assert.ok(r.clock.now() <= POLL_MAX_MS + 2 * POLL_MS, 'dừng ngay khi quá hạn');
  assert.ok(r.calls() >= MANUAL_AFTER_MS / POLL_MS, 'có hỏi lại liên tục trong lúc chờ');
});

test('trackDelivery: server báo lỗi → hiện đúng lỗi tiếng Việt của server và dừng ngay', async () => {
  const r = run([ok({}), ok({ delivery: 'failed', error: 'Không gửi được file về máy (EIO). Hãy bấm Tải xuống lại.' })]);
  const final = await r.promise;
  assert.strictEqual(final.text, '❌ Không gửi được file về máy (EIO). Hãy bấm Tải xuống lại.');
  assert.strictEqual(r.calls(), 2);
});

test('trackDelivery: 404 (phiên hết hạn/đã xong) → dừng với thông báo, không hỏi mãi', async () => {
  const r = run([ok({}), { status: 404, data: { error: 'x' } }]);
  const final = await r.promise;
  assert.match(final.text, /Phiên tải đã kết thúc/);
  assert.strictEqual(r.calls(), 2);
});

test('trackDelivery: mất kết nối liên tiếp → dừng báo lỗi; thỉnh thoảng lỗi lẻ thì vẫn tiếp tục', async () => {
  const net = new Error('fetch failed');
  const dead = run([net]);
  const final = await dead.promise;
  assert.match(final.text, /Mất kết nối/);
  assert.strictEqual(dead.calls(), MAX_FAILED_POLLS);

  // lỗi lẻ rồi hồi phục: bộ đếm lỗi liên tiếp được đặt lại
  const flaky = run([net, ok({ delivery: 'sending' }), net, net, ok({ delivery: 'done', total: MB })]);
  const f2 = await flaky.promise;
  assert.match(f2.text, /Đã lưu xong file/);

  // HTTP 500 cũng tính là lỗi, không được bỏ qua âm thầm
  const srv = run([{ status: 500, data: null }]);
  assert.match((await srv.promise).text, /Mất kết nối/);
});

test('trackDelivery: đã huỷ → hiện nút Lưu file nhưng vẫn theo dõi; bấm lưu lại xong thì báo đã lưu', async () => {
  const r = run([ok({ delivery: 'cancelled' }), ok({ delivery: 'cancelled' }), ok({ delivery: 'sending', sent: MB, total: 2 * MB }), ok({ delivery: 'done', total: 2 * MB })]);
  const final = await r.promise;
  assert.ok(r.views.some((v) => v.manual && v.tone === 'warn'));
  assert.match(final.text, /Đã lưu xong file/);
});
