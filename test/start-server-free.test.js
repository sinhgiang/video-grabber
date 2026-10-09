const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const path = require('path');
const { once } = require('events');
const { startServer } = require('../electron/start-server');

test('cổng quen còn trống thì dùng đúng cổng đó trên 127.0.0.1', async () => {
  const probe = net.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const freePort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  let server;
  try {
    const port = await startServer(path.join(__dirname, '..', 'server.js'), freePort);
    server = require('../server');
    assert.strictEqual(port, freePort);
    assert.strictEqual(server.address().address, '127.0.0.1');
  } finally {
    if (server) server.close();
  }
});
