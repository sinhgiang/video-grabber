// Chạy trước `npm run dist`: dừng đóng gói nếu thiếu ffmpeg hoặc yt-dlp,
// vì app vẫn đóng gói được nhưng tải MP3 và ghép video MP4 sẽ hỏng.
const fs = require('fs');
const path = require('path');

const ytdlp = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const ffmpeg = require('ffmpeg-static');

const missing = [];
if (!ffmpeg || !fs.existsSync(ffmpeg)) missing.push(`ffmpeg (${ffmpeg}): chạy "node node_modules/ffmpeg-static/install.js"`);
if (!fs.existsSync(ytdlp)) missing.push(`yt-dlp (${ytdlp}): chạy "node scripts/setup-ytdlp.js"`);

if (missing.length) {
  console.error('Thiếu file cần đóng gói:\n- ' + missing.join('\n- '));
  process.exit(1);
}
console.log('Đủ ffmpeg và yt-dlp để đóng gói.');
