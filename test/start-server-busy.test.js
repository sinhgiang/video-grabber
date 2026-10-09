const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const path = require('path');
const { once } = require('events');
const { startServer } = require('../electron/start-server');

test('cổng quen đang bị app khác chiếm thì lấy cổng trống khác, vẫn chỉ nghe 127.0.0.1', async () => {
  const other = net.createServer().listen(0, '127.0.0.1');
  await once(other, 'listening');
  const busyPort = other.address().port;
  let server;
  try {
    const port = await startServer(path.join(__dirname, '..', 'server.js'), busyPort);
    server = require('../server');
    assert.notStrictEqual(port, busyPort);
    assert.strictEqual(server.address().address, '127.0.0.1');
    const res = await fetch(`http://127.0.0.1:${port}/api/version`);
    assert.strictEqual(res.status, 200);
  } finally {
    if (server) server.close();
    other.close();
  }
});
