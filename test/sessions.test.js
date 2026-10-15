const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sessions = require('../lib/sessions');

test('providerForUrl nhận đúng nền tảng cần đăng nhập, không nhận tên miền giả', () => {
  assert.strictEqual(sessions.providerForUrl('https://www.facebook.com/reel/1784783755975931'), 'facebook');
  assert.strictEqual(sessions.providerForUrl('https://fb.watch/abc/'), 'facebook');
  assert.strictEqual(sessions.providerForUrl('https://m.facebook.com/watch/?v=1'), 'facebook');
  assert.strictEqual(sessions.providerForUrl('https://www.instagram.com/reel/xyz/'), 'instagram');
  // tên miền chỉ chứa chữ "facebook.com" nhưng không phải facebook
  assert.strictEqual(sessions.providerForUrl('https://facebook.com.evil.example/x'), null);
  assert.strictEqual(sessions.providerForUrl('https://notfacebook.com/x'), null);
  assert.strictEqual(sessions.providerForUrl('https://www.youtube.com/watch?v=1'), null);
  assert.strictEqual(sessions.providerForUrl('không phải url'), null);
});

test('cửa sổ đăng nhập chỉ được duyệt https tới tên miền của nền tảng', () => {
  assert.ok(sessions.isAllowedNavigation('facebook', 'https://www.facebook.com/login'));
  assert.ok(sessions.isAllowedNavigation('facebook', 'https://static.xx.fbcdn.net/x.js'));
  assert.ok(!sessions.isAllowedNavigation('facebook', 'http://www.facebook.com/login'));
  assert.ok(!sessions.isAllowedNavigation('facebook', 'https://facebook.com.evil.example/'));
  assert.ok(!sessions.isAllowedNavigation('facebook', 'https://evil.example/?u=facebook.com'));
  assert.ok(!sessions.isAllowedNavigation('facebook', 'file:///C:/Windows/win.ini'));
  assert.ok(!sessions.isAllowedNavigation('nope', 'https://www.facebook.com/'));
});

test('isLoginFlowUrl: đang ở trang đăng nhập/xác minh thì chưa tự đóng cửa sổ', () => {
  for (const u of [
    'https://www.facebook.com/login/?next=x',
    'https://www.facebook.com/checkpoint/1501092823525282/',
    'https://www.facebook.com/two_step_verification/authentication/',
    'https://www.instagram.com/accounts/login/',
  ]) assert.ok(sessions.isLoginFlowUrl(u), u);
  for (const u of ['https://www.facebook.com/', 'https://www.facebook.com/reel/1784783755975931', 'https://www.instagram.com/']) {
    assert.ok(!sessions.isLoginFlowUrl(u), u);
  }
});

const ck = (name, value, extra = {}) => ({ name, value, domain: '.facebook.com', path: '/', secure: true, httpOnly: false, ...extra });

test('hasSessionCookies cần đủ c_user và xs của đúng tên miền', () => {
  assert.ok(sessions.hasSessionCookies('facebook', [ck('c_user', '1'), ck('xs', 'a')]));
  assert.ok(!sessions.hasSessionCookies('facebook', [ck('c_user', '1')]));
  assert.ok(!sessions.hasSessionCookies('facebook', [ck('c_user', '1'), ck('xs', '')]));
  assert.ok(!sessions.hasSessionCookies('facebook', [ck('c_user', '1', { domain: '.evil.example' }), ck('xs', 'a', { domain: '.evil.example' })]));
  assert.ok(!sessions.hasSessionCookies('facebook', []));
  assert.ok(sessions.hasSessionCookies('instagram', [ck('sessionid', 'z', { domain: '.instagram.com' })]));
});

test('toNetscape: đúng định dạng yt-dlp đọc được, chỉ giữ cookie của nền tảng, bỏ cookie có ký tự phá định dạng', () => {
  const now = 1_800_000_000;
  const text = sessions.toNetscape(
    'facebook',
    [
      ck('xs', 'TOKEN', { httpOnly: true, expirationDate: 1_900_000_000.5 }),
      ck('c_user', '100', { domain: 'www.facebook.com', secure: false }),
      ck('sess', 'cookie-phien', {}), // không có hạn → được đặt hạn 30 ngày trong tệp tạm
      ck('other', 'x', { domain: '.google.com' }),
      ck('bad', 'a\tb'),
      ck('bad2', 'a\nINJECT\tTRUE'),
    ],
    now
  );
  const lines = text.trim().split('\n');
  assert.strictEqual(lines[0], '# Netscape HTTP Cookie File');
  const body = lines.filter((l) => !l.startsWith('# '));
  const session = now + 30 * 24 * 3600;
  assert.deepStrictEqual(body, [
    '#HttpOnly_.facebook.com	TRUE	/	TRUE	1900000000	xs	TOKEN',
    `www.facebook.com	FALSE	/	FALSE	${session}	c_user	100`,
    `.facebook.com	TRUE	/	TRUE	${session}	sess	cookie-phien`,
  ]);
  assert.doesNotMatch(text, /google|INJECT/);
  for (const l of body) assert.strictEqual(l.split('\t').length, 7, l);
});

test('withCookieFile: tệp tạm 0600 chỉ tồn tại trong lúc chạy, bị xoá cả khi lỗi; chưa có phiên thì không chạy', async () => {
  let seen = null;
  sessions.register({ exportCookies: async () => '# Netscape HTTP Cookie File\n', status: async () => true });
  try {
    const out = await sessions.withCookieFile('facebook', async (file) => {
      seen = file;
      assert.ok(fs.existsSync(file));
      assert.ok(file.startsWith(os.tmpdir()));
      if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
      return 'done';
    });
    assert.deepStrictEqual(out, { value: 'done' });
    assert.ok(!fs.existsSync(seen), 'tệp cookie phải bị xoá sau khi chạy');
    assert.ok(!fs.existsSync(path.dirname(seen)));

    await assert.rejects(
      sessions.withCookieFile('facebook', async (file) => {
        seen = file;
        throw new Error('yt-dlp lỗi');
      }),
      /yt-dlp lỗi/
    );
    assert.ok(!fs.existsSync(seen), 'tệp cookie phải bị xoá cả khi lỗi');

    sessions.register({ exportCookies: async () => null, status: async () => false });
    let ran = false;
    assert.strictEqual(await sessions.withCookieFile('facebook', async () => (ran = true)), null);
    assert.ok(!ran);
  } finally {
    sessions.register(null);
  }
});

test('không đăng ký (bản web): status không khả dụng, login báo cần bản desktop', async () => {
  sessions.register(null);
  assert.deepStrictEqual(await sessions.status('facebook'), { available: false, loggedIn: false });
  await assert.rejects(sessions.login('facebook'), /bản ứng dụng desktop/);
  assert.strictEqual(await sessions.withCookieFile('facebook', async () => 1), null);
});
