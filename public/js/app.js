const $ = (sel) => document.querySelector(sel);

const infoForm = $('#infoForm');
const urlInput = $('#urlInput');
const analyzeBtn = $('#analyzeBtn');
const errorMsg = $('#errorMsg');
const resultCard = $('#resultCard');
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

let currentInfo = null;
let selectedType = 'mp4';
let selectedQuality = null;

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
  analyzeBtn.querySelector('.btn__label').textContent = isLoading ? 'Đang phân tích…' : 'Phân tích';
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
  resultCard.hidden = true;
  progressWrap.hidden = true;

  const url = urlInput.value.trim();
  if (!url) return;

  setLoading(true);
  try {
    const res = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
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

    renderQualities(data.qualities);
    selectedType = 'mp4';
    typeSegmented.querySelectorAll('.segmented__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.type === 'mp4'));
    qualityGroup.style.display = '';

    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  if (!currentInfo) return;
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
      body: JSON.stringify({ url: currentInfo.webpageUrl, type: selectedType, quality: selectedQuality }),
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
