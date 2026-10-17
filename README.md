# 🎬 VideoGrabber

Công cụ **tải video &amp; audio miễn phí** từ YouTube, Facebook, TikTok, Instagram, X/Twitter và hơn 1000 nền tảng khác — chạy hoàn toàn trên máy bạn, giao diện đẹp, không quảng cáo, không giới hạn số lượt tải.

![status](https://img.shields.io/badge/status-ready-brightgreen) ![node](https://img.shields.io/badge/node-%3E%3D18-339933) ![license](https://img.shields.io/badge/license-MIT-blue)

## ✨ Tính năng

- 📥 Dán link → xem trước thumbnail, tiêu đề, thời lượng, nền tảng
- 🎞️ Tải **video MP4** ở nhiều chất lượng: 480p, 720p, 1080p, 2K (1440p), 4K (2160p) — tuỳ nguồn gốc video
- 🎵 Tải **audio MP3** chất lượng cao (tách âm thanh tự động bằng FFmpeg)
- 📦 **Tải hàng loạt**: dán nhiều link cùng lúc, hệ thống tự xếp hàng và tải lần lượt (tối đa 2 video song song để máy không bị quá tải)
- 🔐 **Tuỳ chọn nâng cao**: lấy cookie đăng nhập từ Chrome/Edge/Firefox/Brave/Opera để tải video riêng tư/giới hạn tuổi mà bạn có quyền truy cập
- 🌍 Hỗ trợ YouTube, Facebook, TikTok, Instagram, X/Twitter, Threads, Vimeo, Twitch, SoundCloud, Reddit, Pinterest, Dailymotion, Bilibili, LinkedIn, Douyin… và hơn 1000 trang khác (nhờ engine yt-dlp)
- 📊 Thanh tiến trình tải theo thời gian thực
- 🎨 Giao diện hiện đại, dark mode, responsive (dùng tốt trên điện thoại)
- 🖥️ Có thể đóng gói thành **ứng dụng desktop (Electron)** — double-click để mở, không cần mở terminal
- 🆓 Miễn phí, mã nguồn mở, chạy local — dữ liệu không đi qua máy chủ bên thứ ba

## 🧱 Công nghệ sử dụng

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — engine trích xuất video (hỗ trợ 1000+ trang)
- [FFmpeg](https://ffmpeg.org/) — ghép video/audio, chuyển đổi sang MP3
- Node.js + Express — server nhẹ, không cần database
- HTML/CSS/JS thuần cho giao diện — không cần bước build

## 🚀 Cài đặt &amp; chạy

**Yêu cầu:** [Node.js](https://nodejs.org/) ≥ 18

```bash
git clone https://github.com/sinhgiang/video-grabber.git
cd video-grabber
npm install
npm start
```

Sau khi chạy, mở trình duyệt tại: **http://localhost:3000**

> Bước `npm install` sẽ tự động tải binary `yt-dlp` chính thức từ GitHub Releases vào thư mục `./bin` (không cần cài Python thủ công). Nếu mạng chặn, bạn có thể tải thủ công tại [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) và đặt file vào `./bin/yt-dlp.exe` (Windows) hoặc `./bin/yt-dlp` (macOS/Linux).

### 🖥️ Chạy như ứng dụng desktop (Electron) — khuyên dùng, không cần terminal

```bash
npm run electron
```

Lệnh trên mở app trong một cửa sổ riêng (không phải trình duyệt), server chạy ngầm bên trong. Để đóng gói thành file cài đặt `.exe` dùng lâu dài (double-click mở thẳng, không cần `npm run electron` mỗi lần):

```bash
npm run dist
```

File cài đặt sẽ nằm trong thư mục `dist/` (bản NSIS installer và bản portable, chạy trên Windows). Trước khi đóng gói, `npm run dist` kiểm tra đã có `ffmpeg` và `yt-dlp`; thiếu thì dừng và chỉ lệnh tải lại. App desktop chỉ mở server trên `127.0.0.1` (máy khác trong mạng không gọi được) và tự chọn cổng khác nếu cổng 3000 đang bận. Lần chạy `npm run dist` đầu tiên có thể mất vài phút để tải công cụ đóng gói Electron.

## 🖱️ Cách dùng

**Tải một video:**
1. Dán link video (YouTube, TikTok, Facebook…) vào ô nhập
2. Bấm **Phân tích** để xem thông tin video
3. Chọn định dạng **MP4** (video) hoặc **MP3** (audio)
4. Nếu chọn MP4, chọn chất lượng mong muốn (720p, 1080p, 4K…)
5. Bấm **Tải xuống** — theo dõi tiến trình, file sẽ tự động lưu về máy khi xong

**Tải nhiều video cùng lúc:**
1. Chuyển sang tab **📦 Hàng loạt**
2. Dán nhiều link, mỗi dòng một link
3. Chọn định dạng và chất lượng tối đa áp dụng chung
4. Bấm **Thêm vào hàng đợi & tải tất cả** — mỗi video hiện một dòng tiến trình riêng, tự tải về máy khi xong

**Tải video riêng tư / giới hạn tuổi (cần đăng nhập):**
1. Mở **⚙️ Tuỳ chọn nâng cao**
2. Chọn trình duyệt bạn đã đăng nhập tài khoản trên đó (Chrome/Edge/Firefox…)
3. Dán link như bình thường — công cụ sẽ mượn cookie đăng nhập của trình duyệt đó để truy cập nội dung bạn có quyền xem

**Facebook / Instagram (bản ứng dụng desktop):** Facebook không cho người chưa đăng nhập xem video, kể cả video công khai. Khi gặp link như vậy, ứng dụng tự thử lần lượt: (1) cách thường → (2) giả dạng trình duyệt Chrome / Safari / Chrome Android → (3) cookie của Firefox, Edge, Brave, Chrome, Opera có sẵn trên máy → (4) phiên đăng nhập đã lưu trong ứng dụng. Nếu hết cách, ứng dụng hiện nút **🔐 Đăng nhập Facebook một lần** (cũng có trong Tuỳ chọn nâng cao): đăng nhập trong cửa sổ của ứng dụng, sau đó Xem trước / Tải xuống tự chạy lại.

- Phiên đăng nhập là dữ liệu riêng của bạn: chỉ lưu trên máy này (Chromium mã hoá khi lưu), không gửi đi đâu, không ghi vào nhật ký; cookie chỉ được xuất ra một tệp tạm trong lúc yt-dlp chạy rồi xoá ngay. Bấm **Đăng xuất / xoá phiên** để xoá.
- Chrome/Edge bản mới mã hoá cookie nên thường không đọc được từ ngoài (hoặc bị khoá khi trình duyệt đang mở) — đó là lý do có bước đăng nhập trong ứng dụng.
- **Giới hạn:** video đã bị gỡ, hoặc tài khoản bạn đăng nhập không có quyền xem (riêng tư/chỉ bạn bè của người khác), thì không tải được; ứng dụng báo đúng lý do thay vì "thử lại sau".
- **Tự cập nhật yt-dlp:** khi mở ứng dụng, yt-dlp tự cập nhật bản mới nhất từ trang chính thức (kiểm tra mã SHA-256) để theo kịp thay đổi của Facebook/TikTok…; tắt được ở Tuỳ chọn nâng cao (tắt chỉ dừng các lần cập nhật sau; bản đã tải vẫn được dùng cho tới khi ứng dụng lên bản mới).

## 📁 Cấu trúc dự án

```
├── server.js              # Express server + các API endpoint
├── electron/
│   ├── main.js              # Điểm khởi chạy ứng dụng desktop Electron
│   ├── start-server.js      # Chạy server trên 127.0.0.1, tự đổi cổng nếu 3000 bận
│   ├── login.js             # Cửa sổ đăng nhập Facebook/Instagram trong ứng dụng (partition riêng, sandbox)
│   └── preload.js           # Cầu nối an toàn cho nút cập nhật
├── lib/
│   ├── ytdlp.js            # Wrapper gọi yt-dlp, phân tích chất lượng, cookie
│   ├── escalation.js       # Chuỗi tự leo thang (thường → giả dạng → cookie trình duyệt → phiên app) + lỗi cuối đúng nguyên nhân
│   ├── sessions.js         # Phiên đăng nhập Facebook/Instagram: tệp cookie tạm cho yt-dlp, kiểm tên miền
│   ├── settings.js         # Cài đặt người dùng (tự cập nhật yt-dlp)
│   ├── ytdlp-update.js     # Tự cập nhật yt-dlp khi mở app (kiểm SHA-256)
│   ├── jobs.js             # Quản lý job tải (progress theo jobId)
│   └── queue.js            # Hàng đợi giới hạn số lượt tải đồng thời (batch)
├── scripts/
│   ├── setup-ytdlp.js       # Tự tải binary yt-dlp khi npm install
│   └── check-bundle.js      # Chặn `npm run dist` khi thiếu ffmpeg hoặc yt-dlp
├── test/                   # Test chạy bằng `npm test` (node --test)
├── docs/feature-map.md     # Tính năng nằm ở đâu, cách chạy và kiểm tra
├── public/                 # Giao diện (HTML/CSS/JS thuần)
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
└── package.json
```

## ⚠️ Lưu ý bản quyền

Công cụ này chỉ nên dùng để tải nội dung mà bạn **có quyền sử dụng** — video/audio của chính bạn, nội dung public domain, hoặc nội dung được nền tảng gốc cho phép tải xuống. Hãy tôn trọng bản quyền và Điều khoản dịch vụ của YouTube/Facebook/TikTok/Instagram... Người dùng chịu trách nhiệm hoàn toàn về cách sử dụng công cụ.

## 📄 License

[MIT](LICENSE)
