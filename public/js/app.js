const $ = (sel) => document.querySelector(sel);

const infoForm = $('#infoForm');
const urlInput = $('#urlInput');
const analyzeBtn = $('#analyzeBtn');
const errorMsg = $('#errorMsg');
const analyzeProgress = $('#analyzeProgress');
const analyzeElapsed = $('#analyzeElapsed');
const previewMini = $('#previewMini');
const thumb = $('#thumb');
const platformBadge = $('#platformBadge');
const videoTitle = $('#videoTitle');
const uploaderEl = $('#uploader');
const durationEl = $('#duration');
const typeSegmented = $('#typeSegmented');
const qualityGroup = $('#qualityGroup');
const qualityChips = $('#qualityChips');
const downloadBtn = $('#downloadBtn');
const progressWrap = $('#progressWrap');
const progressFill = $('#progressFill');
const progressText = $('#progressText');
const progressStatus = $('#progressStatus');

const updateBanner = $('#updateBanner');
const updateBannerText = $('#updateBannerText');
const updateBannerYesBtn = $('#updateBannerYesBtn');
const updateBannerNoBtn = $('#updateBannerNoBtn');
const appVersionEl = $('#appVersion');
const checkUpdateBtn = $('#checkUpdateBtn');
const checkUpdateStatus = $('#checkUpdateStatus');

const modeTabs = $('#modeTabs');
const singleMode = $('#singleMode');
const batchMode = $('#batchMode');
const cookieBrowserSelect = $('#cookieBrowserSelect');
const batchUrls = $('#batchUrls');
const batchTypeSegmented = $('#batchTypeSegmented');
const batchQualityChips = $('#batchQualityChips');
const batchStartBtn = $('#batchStartBtn');
const batchErrorMsg = $('#batchErrorMsg');
const batchQueue = $('#batchQueue');

let currentInfo = null;
let selectedType = 'mp4';
let selectedQuality = '1080'; // khớp với chip mặc định đang is-active trong HTML

let analyzeTimer = null;
let analyzeStartedAt = 0;

function startAnalyzeProgress() {
  analyzeProgress.hidden = false;
  analyzeStartedAt = Date.now();
  analyzeElapsed.textContent = 'Đang phân tích… 0s';
  clearInterval(analyzeTimer);
  analyzeTimer = setInterval(() => {
    const s = Math.floor((Date.now() - analyzeStartedAt) / 1000);
    analyzeElapsed.textContent = `Đang phân tích… ${s}s (thường mất 5–20s, tối đa ~45s)`;
  }, 500);
}

function stopAnalyzeProgress() {
  clearInterval(analyzeTimer);
  analyzeProgress.hidden = true;
}

function cookiesFromBrowser() {
  return cookieBrowserSelect.value || undefined;
}

function fmtDuration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const h = Math.floor(m / 60);
  if (h) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function setLoading(isLoading) {
  analyzeBtn.disabled = isLoading;
  analyzeBtn.querySelector('.spinner').hidden = !isLoading;
  analyzeBtn.querySelector('.btn__label').textContent = isLoading ? 'Đang phân tích…' : '🔍 Xem trước';
  if (isLoading) startAnalyzeProgress();
  else stopAnalyzeProgress();
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.hidden = false;
}

function renderQualities(qualities) {
  qualityChips.innerHTML = '';
  qualities.forEach((q, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (idx === 0 ? ' is-active' : '');
    btn.textContent = q.label;
    btn.dataset.value = q.value;
    btn.addEventListener('click', () => {
      qualityChips.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
      btn.classList.add('is-active');
      selectedQuality = q.value;
    });
    qualityChips.appendChild(btn);
  });
  selectedQuality = qualities[0]?.value || 'best';
}

infoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorMsg.hidden = true;
  previewMini.hidden = true;
  progressWrap.hidden = true;

  const url = urlInput.value.trim();
  if (!url) return;

  setLoading(true);
  try {
    const res = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, cookiesFromBrowser: cookiesFromBrowser() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Có lỗi xảy ra.');

    currentInfo = data;
    thumb.src = data.thumbnail || '';
    platformBadge.textContent = data.platform.label;
    platformBadge.style.background = data.platform.color + '2e';
    platformBadge.style.color = data.platform.color === '#111111' ? '#ddd' : data.platform.color;
    videoTitle.textContent = data.title;
    uploaderEl.textContent = data.uploader ? `👤 ${data.uploader}` : '';
    durationEl.textContent = data.duration ? `⏱ ${fmtDuration(data.duration)}` : '';

    if (selectedType !== 'mp3') renderQualities(data.qualities);

    previewMini.hidden = false;
    previewMini.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
});

typeSegmented.addEventListener('click', (e) => {
  const btn = e.target.closest('.segmented__btn');
  if (!btn) return;
  selectedType = btn.dataset.type;
  typeSegmented.querySelectorAll('.segmented__btn').forEach((b) => b.classList.remove('is-active'));
  btn.classList.add('is-active');
  qualityGroup.style.display = selectedType === 'mp3' ? 'none' : '';
});

downloadBtn.addEventListener('click', async () => {
  const url = (currentInfo && currentInfo.webpageUrl) || urlInput.value.trim();
  if (!url) {
    showError('Hãy dán liên kết video vào ô ở trên trước.');
    return;
  }
  errorMsg.hidden = true;
  downloadBtn.disabled = true;
  progressWrap.hidden = false;
  progressFill.style.width = '0%';
  progressText.textContent = '0%';
  progressStatus.textContent = 'Đang chuẩn bị…';
  progressStatus.className = '';

  try {
    const startRes = await fetch('/api/download/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        type: selectedType,
        quality: selectedQuality,
        cookiesFromBrowser: cookiesFromBrowser(),
      }),
    });
    const { jobId, error } = await startRes.json();
    if (!startRes.ok) throw new Error(error || 'Không thể bắt đầu tải.');

    const evtSource = new EventSource(`/api/download/progress/${jobId}`);
    evtSource.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      progressFill.style.width = `${data.progress}%`;
      progressText.textContent = `${data.progress}%`;

      if (data.status === 'downloading') {
        progressStatus.textContent = data.eta ? `Đang tải… còn khoảng ${data.eta}` : 'Đang tải…';
      } else if (data.status === 'ready') {
        progressStatus.textContent = '✅ Hoàn tất! Đang lưu file…';
        progressStatus.className = 'is-ready';
        evtSource.close();
        // Kích hoạt tải file về máy
        const a = document.createElement('a');
        a.href = `/api/download/file/${jobId}`;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
        downloadBtn.disabled = false;
      } else if (data.status === 'error') {
        progressStatus.textContent = '❌ ' + (data.error || 'Có lỗi xảy ra khi tải.');
        progressStatus.className = 'is-error';
        evtSource.close();
        downloadBtn.disabled = false;
      }
    };
    evtSource.onerror = () => {
      evtSource.close();
    };
  } catch (err) {
    progressStatus.textContent = '❌ ' + err.message;
    progressStatus.className = 'is-error';
    downloadBtn.disabled = false;
  }
});

// ---------- Chuyển đổi chế độ Một video / Hàng loạt ----------
modeTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-tab');
  if (!btn) return;
  modeTabs.querySelectorAll('.mode-tab').forEach((b) => b.classList.remove('is-active'));
  btn.classList.add('is-active');
  const mode = btn.dataset.mode;
  singleMode.hidden = mode !== 'single';
  batchMode.hidden = mode !== 'batch';
});

// ---------- Chế độ tải hàng loạt ----------
let batchType = 'mp4';
let batchQuality = '2160';

batchTypeSegmented.addEventListener('click', (e) => {
  const btn = e.target.closest('.segmented__btn');
  if (!btn) return;
  batchType = btn.dataset.type;
  batchTypeSegmented.querySelectorAll('.segmented__btn').forEach((b) => b.classList.remove('is-active'));
  btn.classList.add('is-active');
  batchQualityChips.parentElement.style.display = batchType === 'mp3' ? 'none' : '';
});

batchQualityChips.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  batchQuality = btn.dataset.value;
  batchQualityChips.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
  btn.classList.add('is-active');
});

function statusLabel(status) {
  switch (status) {
    case 'analyzing': return 'Đang phân tích…';
    case 'queued': return 'Đang chờ trong hàng đợi…';
    case 'downloading': return 'Đang tải…';
    case 'ready': return '✅ Hoàn tất';
    case 'error': return '❌ Lỗi';
    default: return status;
  }
}

function createQueueRow(url) {
  const row = document.createElement('div');
  row.className = 'queue-item';
  row.innerHTML = `
    <div class="queue-item__top">
      <span class="queue-item__title" title="${url}">${url}</span>
      <span class="queue-item__status">${statusLabel('analyzing')} · 0s</span>
    </div>
    <div class="progress-bar is-indeterminate"><div class="progress-fill" style="width:0%"></div></div>
  `;
  batchQueue.prepend(row);

  const startedAt = Date.now();
  let curStatus = 'analyzing';
  let curExtra = null;
  const bar = row.querySelector('.progress-bar');
  const statusEl = row.querySelector('.queue-item__status');

  function render() {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const inFlight = curStatus === 'analyzing' || curStatus === 'queued' || curStatus === 'downloading';
    statusEl.textContent = (curExtra || statusLabel(curStatus)) + (inFlight ? ` · ${s}s` : '');
  }

  const ticker = setInterval(render, 1000);
  render();

  return {
    setTitle: (t) => { row.querySelector('.queue-item__title').textContent = t; row.querySelector('.queue-item__title').title = t; },
    setStatus: (status, extra) => {
      curStatus = status;
      curExtra = extra || null;
      statusEl.className = 'queue-item__status ' + (status === 'downloading' ? 'st-downloading' : status === 'ready' ? 'st-ready' : status === 'error' ? 'st-error' : '');
      bar.classList.toggle('is-indeterminate', status === 'analyzing' || status === 'queued');
      render();
      if (status === 'ready' || status === 'error') clearInterval(ticker);
    },
    setProgress: (pct) => { row.querySelector('.progress-fill').style.width = `${pct}%`; },
  };
}

async function processQueueItem(url) {
  const rowCtl = createQueueRow(url);
  try {
    const infoRes = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, cookiesFromBrowser: cookiesFromBrowser() }),
    });
    const info = await infoRes.json();
    if (!infoRes.ok) throw new Error(info.error || 'Không phân tích được video.');
    rowCtl.setTitle(`${info.platform.label} · ${info.title}`);
    rowCtl.setStatus('queued');

    const quality = batchType === 'mp3' ? undefined
      : (info.qualities.find((q) => Number(q.value) <= Number(batchQuality))?.value || info.qualities.at(-1)?.value);

    const startRes = await fetch('/api/download/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: info.webpageUrl, type: batchType, quality, cookiesFromBrowser: cookiesFromBrowser() }),
    });
    const { jobId, error } = await startRes.json();
    if (!startRes.ok) throw new Error(error || 'Không thể bắt đầu tải.');

    await new Promise((resolve, reject) => {
      const evtSource = new EventSource(`/api/download/progress/${jobId}`);
      evtSource.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        rowCtl.setProgress(data.progress);
        if (data.status === 'ready') {
          rowCtl.setStatus('ready');
          evtSource.close();
          const a = document.createElement('a');
          a.href = `/api/download/file/${jobId}`;
          a.download = '';
          document.body.appendChild(a);
          a.click();
          a.remove();
          resolve();
        } else if (data.status === 'error') {
          rowCtl.setStatus('error', '❌ ' + (data.error || 'Lỗi tải'));
          evtSource.close();
          reject(new Error(data.error));
        } else {
          rowCtl.setStatus(data.status);
        }
      };
      evtSource.onerror = () => { evtSource.close(); reject(new Error('Mất kết nối tới server.')); };
    });
  } catch (err) {
    rowCtl.setStatus('error', '❌ ' + err.message);
  }
}

// ---------- Phiên bản & kiểm tra cập nhật ----------
const UPDATE_REPO = 'sinhgiang/video-grabber';
const UPDATE_DISMISS_KEY = 'vg_update_dismissed_version';
let appVersion = '0.0.0';
let latestKnownVersion = '';
// Có preload.js (chạy trong app Electron đã đóng gói) hay không —
// quyết định dùng luồng tự tải & tự cài, hay chỉ mở trang tải về.
const isElectronApp = typeof window.vgUpdater !== 'undefined' && window.vgUpdater.isElectron;

function parseVersion(v) {
  return String(v || '0')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
}

function isNewerVersion(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function loadAppVersion() {
  try {
    const res = await fetch('/api/version');
    const data = await res.json();
    appVersion = data.version || appVersion;
    appVersionEl.textContent = `v${appVersion}`;
  } catch {
    appVersionEl.textContent = 'v?';
  }
}

function showUpdateBanner(latest) {
  latestKnownVersion = latest;
  updateBannerText.textContent = `🚀 Đã có phiên bản mới v${latest} — bạn đang dùng v${appVersion}. Cập nhật ngay?`;
  updateBannerYesBtn.hidden = false;
  updateBannerYesBtn.disabled = false;
  updateBannerYesBtn.textContent = '✅ Có, cập nhật ngay';
  updateBannerYesBtn.onclick = null;
  updateBannerNoBtn.hidden = false;
  // Chỉ ẩn banner nếu người dùng đã bấm "Để sau" đúng phiên bản này rồi
  if (localStorage.getItem(UPDATE_DISMISS_KEY) !== latest) {
    updateBanner.hidden = false;
  }
}

// ----- Luồng dùng trong app Electron đã đóng gói: tự tải & tự cài -----
// bannerYesMode: 'download' (mặc định, gọi qua IPC) hoặc 'open-page' (khi tự cập nhật lỗi, mở trang tải thủ công)
let bannerYesMode = 'download';

function setupElectronUpdater() {
  window.vgUpdater.onStatus((data) => {
    switch (data.channel) {
      case 'available':
        bannerYesMode = 'download';
        showUpdateBanner(data.version);
        break;
      case 'not-available':
        if (checkUpdateBtn.dataset.checking) {
          checkUpdateStatus.textContent = '✅ Bạn đang dùng phiên bản mới nhất.';
          checkUpdateStatus.className = 'check-update-status is-ok';
        }
        resetManualCheckBtn();
        break;
      case 'progress':
        updateBanner.hidden = false;
        updateBannerYesBtn.textContent = `⏳ Đang tải… ${data.percent}%`;
        break;
      case 'downloaded':
        updateBannerText.textContent = '✅ Đã tải xong bản cập nhật — đang khởi động lại để cài đặt…';
        updateBannerYesBtn.hidden = true;
        updateBannerNoBtn.hidden = true;
        setTimeout(() => window.vgUpdater.quitAndInstall(), 1200);
        break;
      case 'error':
        resetManualCheckBtn();
        if (!updateBanner.hidden || latestKnownVersion) {
          bannerYesMode = 'open-page';
          updateBannerText.textContent = `⚠️ Không tự cập nhật được (${data.message || 'lỗi không rõ'}). Vui lòng tải thủ công.`;
          updateBannerYesBtn.textContent = '⬇ Mở trang tải về';
          updateBannerYesBtn.hidden = false;
          updateBannerYesBtn.disabled = false;
          updateBanner.hidden = false;
        }
        if (checkUpdateBtn.dataset.checking) {
          checkUpdateStatus.textContent = '⚠️ Không kiểm tra được (kiểm tra kết nối mạng).';
          checkUpdateStatus.className = 'check-update-status is-err';
        }
        break;
    }
  });

  updateBannerYesBtn.addEventListener('click', () => {
    if (bannerYesMode === 'open-page') {
      window.open(`https://github.com/${UPDATE_REPO}/releases/latest`, '_blank');
      return;
    }
    updateBannerYesBtn.disabled = true;
    updateBannerYesBtn.textContent = '⏳ Đang tải…';
    updateBannerNoBtn.hidden = true;
    window.vgUpdater.downloadUpdate();
  });

  updateBannerNoBtn.addEventListener('click', () => {
    updateBanner.hidden = true;
    if (latestKnownVersion) localStorage.setItem(UPDATE_DISMISS_KEY, latestKnownVersion);
  });

  checkUpdateBtn.addEventListener('click', () => {
    checkUpdateBtn.dataset.checking = '1';
    checkUpdateBtn.disabled = true;
    checkUpdateBtn.textContent = '⏳ Đang kiểm tra…';
    checkUpdateStatus.textContent = '';
    checkUpdateStatus.className = 'check-update-status';
    window.vgUpdater.checkForUpdates();
  });
}

function resetManualCheckBtn() {
  delete checkUpdateBtn.dataset.checking;
  checkUpdateBtn.disabled = false;
  checkUpdateBtn.textContent = '🔄 Kiểm tra cập nhật';
  setTimeout(() => {
    checkUpdateStatus.textContent = '';
    checkUpdateStatus.className = 'check-update-status';
  }, 5000);
}

// ----- Luồng dùng khi chạy trên trình duyệt thường (npm start): chỉ báo & mở link -----
async function checkForUpdateWeb(isManual) {
  if (isManual) {
    checkUpdateBtn.disabled = true;
    checkUpdateBtn.textContent = '⏳ Đang kiểm tra…';
    checkUpdateStatus.textContent = '';
    checkUpdateStatus.className = 'check-update-status';
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`);
    if (!res.ok) throw new Error('request failed');
    const data = await res.json();
    const latest = (data.tag_name || '').replace(/^v/i, '');

    if (latest && isNewerVersion(latest, appVersion)) {
      showUpdateBanner(latest);
      updateBannerYesBtn.onclick = () => window.open(data.html_url || `https://github.com/${UPDATE_REPO}/releases/latest`, '_blank');
      if (isManual) {
        checkUpdateStatus.textContent = '🎉 Có bản cập nhật mới!';
        checkUpdateStatus.className = 'check-update-status is-ok';
      }
    } else if (isManual) {
      checkUpdateStatus.textContent = '✅ Bạn đang dùng phiên bản mới nhất.';
      checkUpdateStatus.className = 'check-update-status is-ok';
    }
  } catch {
    if (isManual) {
      checkUpdateStatus.textContent = '⚠️ Không kiểm tra được (kiểm tra kết nối mạng).';
      checkUpdateStatus.className = 'check-update-status is-err';
    }
  } finally {
    if (isManual) resetManualCheckBtn();
  }
}

function setupWebUpdater() {
  updateBannerNoBtn.addEventListener('click', () => {
    updateBanner.hidden = true;
    if (latestKnownVersion) localStorage.setItem(UPDATE_DISMISS_KEY, latestKnownVersion);
  });
  checkUpdateBtn.addEventListener('click', () => checkForUpdateWeb(true));
}

(async () => {
  await loadAppVersion();
  if (isElectronApp) {
    setupElectronUpdater();
  } else {
    setupWebUpdater();
    checkForUpdateWeb(false);
  }
})();

batchStartBtn.addEventListener('click', async () => {
  batchErrorMsg.hidden = true;
  const urls = batchUrls.value
    .split('\n')
    .map((u) => u.trim())
    .filter(Boolean);

  if (!urls.length) {
    batchErrorMsg.textContent = 'Hãy dán ít nhất một liên kết video.';
    batchErrorMsg.hidden = false;
    return;
  }

  batchStartBtn.disabled = true;
  batchStartBtn.textContent = `⏳ Đang xử lý ${urls.length} video…`;

  // Chạy song song, server tự giới hạn số lượt tải thực sự đồng thời.
  await Promise.allSettled(urls.map((u) => processQueueItem(u)));

  batchStartBtn.disabled = false;
  batchStartBtn.textContent = '📦 Thêm vào hàng đợi & tải tất cả';
  batchUrls.value = '';
});
