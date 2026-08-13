// Tải sẵn binary yt-dlp chính thức (từ GitHub Releases của yt-dlp/yt-dlp)
// vào thư mục ./bin để server dùng, tránh phải cài Python thủ công.
const path = require('path');
const fs = require('fs');
const YTDlpWrap = require('yt-dlp-wrap').default;

const binDir = path.join(__dirname, '..', 'bin');
const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const binPath = path.join(binDir, binName);

async function main() {
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

  if (fs.existsSync(binPath)) {
    console.log('[setup-ytdlp] Đã có sẵn yt-dlp tại', binPath);
    return;
  }

  console.log('[setup-ytdlp] Đang tải yt-dlp mới nhất từ GitHub releases...');
  try {
    await YTDlpWrap.downloadFromGithub(binPath);
    if (process.platform !== 'win32') {
      fs.chmodSync(binPath, 0o755);
    }
    console.log('[setup-ytdlp] Tải xong:', binPath);
  } catch (err) {
    console.error('[setup-ytdlp] Không tải được yt-dlp tự động:', err.message);
    console.error('[setup-ytdlp] Bạn có thể tải thủ công tại https://github.com/yt-dlp/yt-dlp/releases và đặt vào thư mục ./bin');
  }
}

main();
