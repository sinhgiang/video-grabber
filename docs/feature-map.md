# Feature map

## Features

- Xem trước một video (tiêu đề, ảnh, thời lượng, chất lượng có sẵn): `server.js` (`POST /api/info`), `lib/ytdlp.js` (`getInfo`), `public/js/app.js`; người dùng dán link vào ô ở tab "Một video" rồi bấm "Xem trước".
- Tải MP4 / MP3 có thanh tiến trình: `server.js` (`/api/download/start`, `/api/download/progress/:jobId`, `/api/download/file/:jobId`), `lib/ytdlp.js` (`startDownload`, dùng `bin/yt-dlp.exe` và `ffmpeg-static`), `lib/jobs.js`; chọn định dạng, chất lượng rồi bấm "Tải xuống".
- Tải hàng loạt (tối đa 2 video cùng lúc): `lib/queue.js`, `public/js/app.js`; tab "Hàng loạt".
- Mượn cookie trình duyệt cho video riêng tư / bị chặn bot: `lib/ytdlp.js` (`SUPPORTED_COOKIE_BROWSERS`, tự đổi client và thử cookie khi gặp 403); mục "Tuỳ chọn nâng cao".
- Chuỗi tự leo thang khi nền tảng chặn (Facebook "Cannot parse data", bot-check, 403): `lib/escalation.js` (`buildSteps` thứ tự thường → `--impersonate` chrome/safari/chrome:android → cookie Firefox/Edge/Brave/Chrome/Opera → phiên đăng nhập trong app; `buildFinalError` ra lỗi cuối `LOGIN_REQUIRED` / `NO_ACCESS` / `REMOVED` / `FRIENDS_ONLY` / `BLOCKED` / `UNKNOWN`), nối vào `lib/ytdlp.js` (`runEscalated`, dùng chung cho Xem trước và Tải xuống, nhớ cách đã thành công 30 phút).
- Đăng nhập Facebook/Instagram một lần trong app: `electron/login.js` (cửa sổ đăng nhập, partition `persist:vg-login-<nền tảng>`), `lib/sessions.js` (tệp cookie Netscape tạm, xoá ngay), API `GET /api/login/providers`, `POST /api/login/start`, `POST /api/login/logout` trong `server.js` (chỉ nhận Origin/Host nội bộ), nút trong "Tuỳ chọn nâng cao" và nút nhắc khi lỗi `LOGIN_REQUIRED` ở `public/js/app.js`.
- Tự cập nhật yt-dlp khi mở app, tắt được: `lib/ytdlp-update.js` (tải từ github.com/yt-dlp/yt-dlp, kiểm SHA-256, lưu ở thư mục dữ liệu người dùng), `lib/settings.js`, `GET/POST /api/settings`; ô tick trong "Tuỳ chọn nâng cao".
- App desktop Electron: `electron/main.js` (cửa sổ, sandbox), `electron/start-server.js` (server trên 127.0.0.1, cổng 3000 hoặc cổng trống nếu 3000 bận), `electron/preload.js`; mở bằng file cài `VideoGrabberSetup-<version>.exe`.
- Tự cập nhật app: `electron/main.js` (`electron-updater`, đọc `latest.yml` trên GitHub Releases của `sinhgiang/video-grabber`), nút "Kiểm tra cập nhật" ở chân trang trong `public/js/app.js`.
- Đóng gói: `package.json` (`build`), `scripts/check-bundle.js` chạy trước `npm run dist`.

## Run and check

- Open it (web): `npm install`, rồi `PORT=3999 node server.js` và mở http://localhost:3999 (cổng 3000 trên máy chủ đang bị server Helme chiếm).
- Open it (desktop, bản đóng gói): `npm run dist -- --win --publish never`, rồi chạy `dist/win-unpacked/Video Grabber.exe`; dòng đầu của log in cổng thật (`Video Grabber đang chạy tại http://localhost:<cổng>`).
- Test account: không cần tài khoản. Video thử công khai, ngắn: https://www.youtube.com/watch?v=jNQXAC9IVRw (19 giây).
- Main flow to go through: dán link → "Xem trước" → chọn MP4 hoặc MP3 → "Tải xuống" → file về máy (MP3 bắt đầu bằng `ID3`, MP4 có hộp `ftyp`).
- Tests: `npm test` (node --test, thư mục `test/`).
- Lint: `npm run lint` (ESLint, cấu hình `eslint.config.js`). Kiểm build không cần đóng gói: `npm run build` (`scripts/check-build.js`; đóng gói thật vẫn là `npm run dist`). Pull request chạy cả hai rồi `npm test` (`.github/workflows/ci.yml`).
- Screenshot: mcp__helme-browser (navigate_page tới http://127.0.0.1:<cổng>/, take_screenshot); ảnh thumbnail YouTube không hiện vì trình duyệt của Helme chặn mạng ngoài.
- Release: build bằng `npm run dist -- --win --publish never`, rồi `gh release create v<version>` kèm `VideoGrabberSetup-<version>.exe`, `.blockmap`, `latest.yml`, bản portable và `SHA256SUMS.txt`.
