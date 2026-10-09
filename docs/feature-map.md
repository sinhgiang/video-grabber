# Feature map

## Features

- Xem trước một video (tiêu đề, ảnh, thời lượng, chất lượng có sẵn): `server.js` (`POST /api/info`), `lib/ytdlp.js` (`getInfo`), `public/js/app.js`; người dùng dán link vào ô ở tab "Một video" rồi bấm "Xem trước".
- Tải MP4 / MP3 có thanh tiến trình: `server.js` (`/api/download/start`, `/api/download/progress/:jobId`, `/api/download/file/:jobId`), `lib/ytdlp.js` (`startDownload`, dùng `bin/yt-dlp.exe` và `ffmpeg-static`), `lib/jobs.js`; chọn định dạng, chất lượng rồi bấm "Tải xuống".
- Tải hàng loạt (tối đa 2 video cùng lúc): `lib/queue.js`, `public/js/app.js`; tab "Hàng loạt".
- Mượn cookie trình duyệt cho video riêng tư / bị chặn bot: `lib/ytdlp.js` (`SUPPORTED_COOKIE_BROWSERS`, tự đổi client và thử cookie khi gặp 403); mục "Tuỳ chọn nâng cao".
- App desktop Electron: `electron/main.js` (cửa sổ, sandbox), `electron/start-server.js` (server trên 127.0.0.1, cổng 3000 hoặc cổng trống nếu 3000 bận), `electron/preload.js`; mở bằng file cài `VideoGrabberSetup-<version>.exe`.
- Tự cập nhật app: `electron/main.js` (`electron-updater`, đọc `latest.yml` trên GitHub Releases của `sinhgiang/video-grabber`), nút "Kiểm tra cập nhật" ở chân trang trong `public/js/app.js`.
- Đóng gói: `package.json` (`build`), `scripts/check-bundle.js` chạy trước `npm run dist`.

## Run and check

- Open it (web): `npm install`, rồi `PORT=3999 node server.js` và mở http://localhost:3999 (cổng 3000 trên máy chủ đang bị server Helme chiếm).
- Open it (desktop, bản đóng gói): `npm run dist -- --win --publish never`, rồi chạy `dist/win-unpacked/Video Grabber.exe`; dòng đầu của log in cổng thật (`Video Grabber đang chạy tại http://localhost:<cổng>`).
- Test account: không cần tài khoản. Video thử công khai, ngắn: https://www.youtube.com/watch?v=jNQXAC9IVRw (19 giây).
- Main flow to go through: dán link → "Xem trước" → chọn MP4 hoặc MP3 → "Tải xuống" → file về máy (MP3 bắt đầu bằng `ID3`, MP4 có hộp `ftyp`).
- Tests: `npm test` (node --test, thư mục `test/`).
- Screenshot: mcp__helme-browser (navigate_page tới http://127.0.0.1:<cổng>/, take_screenshot); ảnh thumbnail YouTube không hiện vì trình duyệt của Helme chặn mạng ngoài.
- Release: build bằng `npm run dist -- --win --publish never`, rồi `gh release create v<version>` kèm `VideoGrabberSetup-<version>.exe`, `.blockmap`, `latest.yml`, bản portable và `SHA256SUMS.txt`.
