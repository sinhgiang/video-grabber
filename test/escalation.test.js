const test = require('node:test');
const assert = require('node:assert');
const { buildSteps, runLadder, buildFinalError } = require('../lib/escalation');

const ids = (steps) => steps.map((s) => s.id);

test('thứ tự chuỗi: thường → giả dạng Chrome/Safari/Android → cookie trình duyệt → phiên trong app', () => {
  assert.deepStrictEqual(ids(buildSteps({ platformKey: 'facebook', hasAppSession: true })), [
    'normal',
    'impersonate-chrome',
    'impersonate-safari',
    'impersonate-android',
    'browser-firefox',
    'browser-edge',
    'browser-brave',
    'browser-chrome',
    'browser-opera',
    'app-session',
  ]);
});

test('chưa có phiên trong app thì không có bước app-session', () => {
  assert.ok(!ids(buildSteps({ platformKey: 'facebook' })).includes('app-session'));
});

test('YouTube không có bước giả dạng; người dùng tự chọn trình duyệt thì tôn trọng, không tự thử trình duyệt khác', () => {
  assert.ok(!ids(buildSteps({ platformKey: 'youtube' })).some((i) => i.startsWith('impersonate')));
  const steps = buildSteps({ platformKey: 'facebook', userBrowser: 'edge', hasAppSession: true });
  assert.deepStrictEqual(ids(steps), ['normal', 'impersonate-chrome', 'impersonate-safari', 'impersonate-android', 'app-session']);
  assert.ok(steps.filter((s) => s.kind !== 'app-session').every((s) => s.browser === 'edge'));
});

test('bước từng thành công được thử trước, các bước còn lại giữ nguyên thứ tự', () => {
  const steps = buildSteps({ platformKey: 'facebook', hasAppSession: true, preferredStepId: 'app-session' });
  assert.strictEqual(steps[0].id, 'app-session');
  assert.deepStrictEqual(ids(steps).slice(1, 3), ['normal', 'impersonate-chrome']);
  assert.strictEqual(steps.length, 10);
});

test('runLadder thử từng bước theo thứ tự, mỗi bước thất bại → bước sau, dừng ở bước đầu thành công', async () => {
  const steps = buildSteps({ platformKey: 'facebook', hasAppSession: true });
  const called = [];
  const stages = [];
  const r = await runLadder(
    steps,
    async (step) => {
      called.push(step.id);
      if (step.id !== 'browser-brave') throw Object.assign(new Error('x'), { raw: 'ERROR: Cannot parse data' });
      return 'OK';
    },
    { onStep: (s, i, n) => stages.push([s.id, i, n]) }
  );
  assert.strictEqual(r.value, 'OK');
  assert.strictEqual(r.step.id, 'browser-brave');
  assert.deepStrictEqual(called, ['normal', 'impersonate-chrome', 'impersonate-safari', 'impersonate-android', 'browser-firefox', 'browser-edge', 'browser-brave']);
  assert.strictEqual(stages.length, 7);
  assert.strictEqual(r.attempts.length, 6);
});

test('giả lập từng bước thất bại: mỗi bước có thể là bước thành công duy nhất', async () => {
  const steps = buildSteps({ platformKey: 'facebook', hasAppSession: true });
  for (const winner of ids(steps)) {
    const called = [];
    const r = await runLadder(steps, async (step) => {
      called.push(step.id);
      if (step.id === winner) return winner;
      throw new Error('ERROR: Cannot parse data');
    });
    assert.strictEqual(r.value, winner);
    assert.deepStrictEqual(called, ids(steps).slice(0, ids(steps).indexOf(winner) + 1));
  }
});

test('bước báo skipped (chưa có phiên) bị bỏ qua và không tính là đã thử', async () => {
  const steps = buildSteps({ platformKey: 'facebook', hasAppSession: true });
  await assert.rejects(
    runLadder(
      steps,
      async (step) => {
        if (step.kind === 'app-session') return { skipped: true, reason: 'chưa có phiên' };
        throw new Error('ERROR: Cannot parse data');
      },
      { onExhausted: (attempts) => new Error(`n=${attempts.filter((a) => !a.skipped).length}`) }
    ),
    /n=9/
  );
});

test('lỗi không thể khắc phục (Unsupported URL, hết ổ đĩa, fatal) dừng ngay, không leo thang', async () => {
  const steps = buildSteps({ platformKey: 'facebook' });
  for (const err of [
    new Error('ERROR: Unsupported URL: https://example.com/'),
    new Error('ENOSPC: no space left on device'),
    Object.assign(new Error('Phân tích quá lâu'), { fatal: true }),
  ]) {
    const called = [];
    await assert.rejects(
      runLadder(steps, async (s) => {
        called.push(s.id);
        throw err;
      }),
      (e) => e === err
    );
    assert.deepStrictEqual(called, ['normal']);
  }
});

// ---- Lỗi cuối: nêu đúng nguyên nhân + việc cần làm ----
const failAll = (raw, stepsOpts, extraByKind = {}) => {
  const steps = buildSteps(stepsOpts);
  return steps.map((step) => ({ step, raw: extraByKind[step.kind] || raw }));
};
const FB = { platformKey: 'facebook', platformLabel: 'Facebook', provider: 'facebook' };

test('Facebook chưa đăng nhập + app desktop: LOGIN_REQUIRED, chỉ nút "Đăng nhập Facebook một lần", nói rõ giới hạn', () => {
  const attempts = failAll('ERROR: [facebook] 1784783755975931: Cannot parse data; please report this issue', { platformKey: 'facebook' }, {
    browser: 'ERROR: Could not copy Chrome cookie database. See  https://github.com/yt-dlp/yt-dlp/issues/7271  for more info',
  });
  const err = buildFinalError(attempts, { ...FB, loginAvailable: true, triedAppSession: false });
  assert.strictEqual(err.code, 'LOGIN_REQUIRED');
  assert.strictEqual(err.provider, 'facebook');
  assert.match(err.message, /Đăng nhập Facebook một lần/);
  assert.match(err.message, /đã bị gỡ|không có quyền xem/); // giới hạn nói thẳng
  assert.match(err.message, /Đã thử: cách thường; giả dạng trình duyệt Chrome; giả dạng trình duyệt Safari/);
  assert.match(err.message, /Chrome \(đang mở\/khoá tệp cookie\)/);
  assert.match(err.message, /Cannot parse data/);
  assert.doesNotMatch(err.message, /tạm thời/);
});

test('Facebook chưa đăng nhập + bản web: LOGIN_REQUIRED nói rõ cần bản desktop hoặc Firefox', () => {
  const err = buildFinalError(failAll('ERROR: Cannot parse data', { platformKey: 'facebook' }), { ...FB, loginAvailable: false });
  assert.strictEqual(err.code, 'LOGIN_REQUIRED');
  assert.match(err.message, /bản ứng dụng desktop/);
  assert.match(err.message, /Firefox/);
});

test('đã đăng nhập trong app mà vẫn lỗi: NO_ACCESS (không có quyền / đã gỡ / phiên hết hạn), khuyên đăng nhập lại', () => {
  const err = buildFinalError(failAll('ERROR: Cannot parse data', { platformKey: 'facebook', hasAppSession: true }), {
    ...FB,
    loginAvailable: true,
    triedAppSession: true,
  });
  assert.strictEqual(err.code, 'NO_ACCESS');
  assert.match(err.message, /không có quyền xem/);
  assert.match(err.message, /đã bị gỡ/);
  assert.match(err.message, /Đăng xuất/);
});

test('đã đăng nhập mà Facebook báo nội dung không khả dụng: REMOVED', () => {
  const err = buildFinalError(failAll('ERROR: [facebook] 1: This content isn\'t available right now', { platformKey: 'facebook', hasAppSession: true }), {
    ...FB,
    loginAvailable: true,
    triedAppSession: true,
  });
  assert.strictEqual(err.code, 'REMOVED');
  assert.match(err.message, /đã bị gỡ|bị xoá|không còn hiển thị/);
});

test('đã đăng nhập mà video chỉ dành cho bạn bè: FRIENDS_ONLY', () => {
  const err = buildFinalError(failAll('ERROR: This video is only available to friends of the owner', { platformKey: 'facebook', hasAppSession: true }), {
    ...FB,
    loginAvailable: true,
    triedAppSession: true,
  });
  assert.strictEqual(err.code, 'FRIENDS_ONLY');
  assert.match(err.message, /bạn bè/);
});

test('nền tảng không cần đăng nhập mà video đã gỡ: REMOVED; bị chặn 403/429: BLOCKED; còn lại: UNKNOWN có hướng dẫn', () => {
  const o = { platformKey: 'vimeo', platformLabel: 'Vimeo', provider: null, loginAvailable: true };
  assert.strictEqual(buildFinalError(failAll('ERROR: Video unavailable', { platformKey: 'vimeo' }), o).code, 'REMOVED');
  assert.strictEqual(buildFinalError(failAll('ERROR: HTTP Error 429: Too Many Requests', { platformKey: 'vimeo' }), o).code, 'BLOCKED');
  const u = buildFinalError(failAll('ERROR: something odd', { platformKey: 'vimeo' }), o);
  assert.strictEqual(u.code, 'UNKNOWN');
  assert.match(u.message, /cập nhật yt-dlp/);
});

test('YouTube bị chặn bot sau khi hết cách: giữ thông báo riêng của YouTube', () => {
  const err = buildFinalError(failAll("ERROR: [youtube] x: Sign in to confirm you're not a bot", { platformKey: 'youtube' }), {
    platformKey: 'youtube',
    platformLabel: 'YouTube',
    provider: null,
  });
  assert.strictEqual(err.code, 'BLOCKED');
  assert.match(err.message, /YouTube vẫn chặn/);
});

test('lỗi Chrome mã hoá cookie (DPAPI / app-bound) được nêu riêng với việc cần làm', () => {
  const attempts = failAll('ERROR: Cannot parse data', { platformKey: 'facebook' }, {
    browser: 'ERROR: Failed to decrypt with DPAPI. See https://github.com/yt-dlp/yt-dlp/issues/10927 for more info',
  });
  const err = buildFinalError(attempts, { ...FB, loginAvailable: true });
  assert.match(err.message, /mã hoá cookie kiểu mới/);
  assert.match(err.message, /đóng hẳn trình duyệt|đăng nhập trong ứng dụng/);
});

test('lỗi cuối không chứa giá trị cookie dù stderr có chứa', () => {
  const secret = 'SECRETCOOKIEVALUE123';
  const err = buildFinalError(failAll(`ERROR: Cannot parse data\nCookie: xs=${secret}`, { platformKey: 'facebook' }), { ...FB, loginAvailable: true });
  // Ghi chú: yt-dlp không in cookie; kiểm để chắc phần "Chi tiết" chỉ lấy đúng dòng ERROR.
  assert.doesNotMatch(err.message, new RegExp(secret));
});
