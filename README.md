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

File cài đặt sẽ nằm trong thư mục `dist/` (bản NSIS installer và bản portable, chạy trên Windows). Lần chạy `npm run dist` đầu tiên có thể mất vài phút để tải công cụ đóng gói Electron.

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

## 📁 Cấu trúc dự án

```
├── server.js              # Express server + các API endpoint
├── electron/
│   └── main.js              # Điểm khởi chạy ứng dụng desktop Electron
├── lib/
│   ├── ytdlp.js            # Wrapper gọi yt-dlp, phân tích chất lượng, cookie
│   ├── jobs.js             # Quản lý job tải (progress theo jobId)
│   └── queue.js            # Hàng đợi giới hạn số lượt tải đồng thời (batch)
├── scripts/
│   └── setup-ytdlp.js       # Tự tải binary yt-dlp khi npm install
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
