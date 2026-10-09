const { once } = require('events');

// Chạy server Express trên 127.0.0.1 (máy khác trong mạng LAN không gọi được API tải,
// vì API có thể dùng cookie trình duyệt của người dùng). Thử cổng quen trước; nếu app khác
// đang chiếm cổng đó thì lấy một cổng trống bất kỳ, thay vì mở nhầm trang của app kia.
async function startServer(serverPath, preferredPort) {
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(preferredPort);
  const server = require(serverPath);
  if (!server.listening) {
    try {
      await once(server, 'listening');
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
    }
  }
  return server.address().port;
}

module.exports = { startServer };
