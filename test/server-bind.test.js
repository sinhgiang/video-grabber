const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { once } = require('events');

test('server nghe đúng HOST được đặt', async () => {
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';
  const server = require('../server');
  if (!server.listening) await once(server, 'listening');
  try {
    assert.strictEqual(server.address().address, '127.0.0.1');
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/version`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).version, require('../package.json').version);
  } finally {
    server.close();
  }
});

test('electron/main.js chạy server qua startServer, mở 127.0.0.1 và bật sandbox', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(src, /serverPort = await startServer\(/);
  assert.match(src, /loadURL\(`http:\/\/127\.0\.0\.1:\$\{serverPort\}`\)/);
  assert.match(src, /contextIsolation:\s*true/);
  assert.match(src, /nodeIntegration:\s*false/);
  assert.match(src, /sandbox:\s*true/);
  assert.doesNotMatch(src, /webSecurity:\s*false/);
});
