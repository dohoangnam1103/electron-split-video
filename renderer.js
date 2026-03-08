'use strict';
/* ═══════════════════════════════════════════════════════════
   Video Splitter v2.0 — Renderer (main process UI logic)
   ═══════════════════════════════════════════════════════════ */

// ─── State ──────────────────────────────────────────────────
const state = {
  queue: [],   // { id, name, path, info, status }
  outputDir: '',
  isProcessing: false,
  currentFileIdx: -1,
};

let idCounter = 0;
const uid = () => ++idCounter;

// ─── DOM Refs ────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dropZone = $('dropZone');
const dropText = $('dropText');
const btnProcess = $('btnProcess');
const btnCancel = $('btnCancel');
const btnClearQueue = $('btnClearQueue');
const btnSelectOutputDir = $('btnSelectOutputDir');
const outputDirDisplay = $('outputDirDisplay');
const outputNameInput = $('outputName');
const keepInput = $('keepDuration');
const skipInput = $('skipDuration');
const trimStartInput = $('trimStart');
const speedFactorInput = $('speedFactor');
const queueSection = $('queueSection');
const queueList = $('queueList');
const queueCount = $('queueCount');
const timelineSection = $('timelineSection');
const timelineCanvas = $('timelineCanvas');
const progressSection = $('progressSection');
const progressBar = $('progressBar');
const progressStatus = $('progressStatus');
const progressLabel = $('progressLabel');
const progressEta = $('progressEta');
const resultSection = $('resultSection');

// Settings panel
const settingKeep = $('settingKeep');
const settingSkip = $('settingSkip');
const settingTrimStart = $('settingTrimStart');
const settingSpeedFactor = $('settingSpeedFactor');
const settingOutputDir = $('settingOutputDirDisplay');
const btnSettingOutputDir = $('btnSettingOutputDir');
const btnSaveSettings = $('btnSaveSettings');
const btnClearHistory = $('btnClearHistory');
const historyList = $('historyList');

// Titlebar buttons
const btnMinimize = $('btnMinimize');
const btnMaximize = $('btnMaximize');
const btnClose = $('btnClose');

// ─── Tab Navigation ─────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab' + capitalize(btn.dataset.tab)).classList.add('active');

    if (btn.dataset.tab === 'history') loadHistoryTab();
  });
});

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ─── Titlebar (Windows frameless) ───────────────────────────
// These use Electron's built-in titleBarOverlay so we just need
// the custom CSS drag region. Keep buttons for aesthetics only.
btnMinimize?.addEventListener('click', () => window.api.minimize?.());
btnMaximize?.addEventListener('click', () => window.api.maximize?.());
btnClose?.addEventListener('click', () => window.api.close?.());

// ─── Init: load settings ────────────────────────────────────
(async () => {
  const s = await window.api.getSettings();
  if (s) {
    keepInput.value = s.keepSec || 3;
    skipInput.value = s.skipSec || 3;
    trimStartInput.value = s.trimStartSec || 0;
    speedFactorInput.value = s.speedFactor || 1;
    settingKeep.value = s.keepSec || 3;
    settingSkip.value = s.skipSec || 3;
    settingTrimStart.value = s.trimStartSec || 0;
    settingSpeedFactor.value = s.speedFactor || 1;
    if (s.outputDir) {
      state.outputDir = s.outputDir;
      outputDirDisplay.textContent = s.outputDir;
      settingOutputDir.textContent = s.outputDir;
    }
  }
})();

// ─── Output Dir ─────────────────────────────────────────────
async function pickOutputDir() {
  const dir = await window.api.selectOutputDir();
  if (dir) {
    state.outputDir = dir;
    outputDirDisplay.textContent = dir;
    settingOutputDir.textContent = dir;
  }
}
btnSelectOutputDir.addEventListener('click', pickOutputDir);
btnSettingOutputDir.addEventListener('click', pickOutputDir);

// ─── Settings tab ───────────────────────────────────────────
btnSaveSettings.addEventListener('click', async () => {
  const data = {
    keepSec: parseFloat(settingKeep.value) || 3,
    skipSec: parseFloat(settingSkip.value) || 3,
    trimStartSec: parseFloat(settingTrimStart.value) || 0,
    speedFactor: parseFloat(settingSpeedFactor.value) || 1,
    outputDir: state.outputDir,
  };
  await window.api.saveSettings(data);
  // Sync main tab inputs
  keepInput.value = data.keepSec;
  skipInput.value = data.skipSec;
  trimStartInput.value = data.trimStartSec;
  speedFactorInput.value = data.speedFactor;

  btnSaveSettings.textContent = '✅ Đã lưu!';
  setTimeout(() => { btnSaveSettings.textContent = 'Lưu cài đặt'; }, 1800);
});

// ─── Drop Zone ──────────────────────────────────────────────
dropZone.addEventListener('click', async () => {
  if (state.isProcessing) return;
  const paths = await window.api.selectVideo();
  if (paths) addFilesToQueue(paths);
});

dropZone.addEventListener('dragover', e => {
  e.preventDefault(); e.stopPropagation();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', e => {
  e.preventDefault(); e.stopPropagation();
  dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', e => {
  e.preventDefault(); e.stopPropagation();
  dropZone.classList.remove('drag-over');
  if (state.isProcessing) return;
  const paths = Array.from(e.dataTransfer.files)
    .filter(f => f.path)
    .map(f => f.path);
  if (paths.length > 0) addFilesToQueue(paths);
});

// ─── param changes → redraw timeline ─────────────────────────
keepInput.addEventListener('input', drawTimeline);
skipInput.addEventListener('input', drawTimeline);

// ─── Queue ───────────────────────────────────────────────────
async function addFilesToQueue(paths) {
  for (const p of paths) {
    const name = p.split(/[/\\]/).pop();
    const id = uid();
    const item = { id, name, path: p, info: null, status: 'pending' };
    state.queue.push(item);
    renderQueueItem(item);

    // Fetch video info async
    window.api.getVideoInfo(p).then(info => {
      item.info = info;
      updateQueueItemMeta(id, info);
      drawTimeline(); // redraw with first selected file's info
    });
  }

  queueSection.classList.add('visible');
  dropZone.classList.add('has-file');
  dropText.textContent = `${paths.length} file đã chọn`;
  queueCount.textContent = state.queue.length;
  btnProcess.disabled = false;

  drawTimeline();
  timelineSection.classList.add('visible');
}

function renderQueueItem(item) {
  const el = document.createElement('div');
  el.className = 'queue-item';
  el.id = `qi-${item.id}`;
  el.innerHTML = `
    <span class="queue-item-icon">🎬</span>
    <div class="queue-item-info">
      <div class="queue-item-name">${escHtml(item.name)}</div>
      <div class="queue-item-meta" id="qm-${item.id}">Đang lấy thông tin…</div>
    </div>
    <span class="queue-item-status status-pending" id="qs-${item.id}">Chờ</span>
    <button class="queue-item-remove" data-id="${item.id}" title="Xoá khỏi danh sách">✕</button>
  `;
  el.querySelector('.queue-item-remove').addEventListener('click', () => removeQueueItem(item.id));
  queueList.appendChild(el);
}

function updateQueueItemMeta(id, info) {
  const el = $(`qm-${id}`);
  if (!el) return;
  if (info) {
    const dur = formatDuration(info.duration);
    const res = info.width ? `${info.width}×${info.height}` : '';
    const fps = info.fps ? `${info.fps} fps` : '';
    el.textContent = [dur, res, fps].filter(Boolean).join(' · ');
  } else {
    el.textContent = 'Không đọc được thông tin';
  }
}

function setQueueItemStatus(id, status) {
  const labels = { pending: 'Chờ', active: 'Đang xử lý', done: 'Hoàn thành', error: 'Lỗi', cancelled: 'Huỷ' };
  const el = $(`qs-${id}`);
  if (!el) return;
  el.className = `queue-item-status status-${status}`;
  el.textContent = labels[status] || status;
}

function removeQueueItem(id) {
  if (state.isProcessing) return;
  state.queue = state.queue.filter(i => i.id !== id);
  $(`qi-${id}`)?.remove();
  queueCount.textContent = state.queue.length;
  if (state.queue.length === 0) {
    queueSection.classList.remove('visible');
    timelineSection.classList.remove('visible');
    dropZone.classList.remove('has-file');
    dropText.textContent = 'Click hoặc kéo thả video vào đây';
    btnProcess.disabled = true;
  }
}

btnClearQueue.addEventListener('click', () => {
  if (state.isProcessing) return;
  state.queue = [];
  queueList.innerHTML = '';
  queueCount.textContent = 0;
  queueSection.classList.remove('visible');
  timelineSection.classList.remove('visible');
  dropZone.classList.remove('has-file');
  dropText.textContent = 'Click hoặc kéo thả video vào đây';
  btnProcess.disabled = true;
  resultSection.classList.remove('visible');
  resultSection.innerHTML = '';
});

// ─── Timeline Canvas ─────────────────────────────────────────
function drawTimeline() {
  const canvas = timelineCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.parentElement.clientWidth || 600;
  const h = 36;
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);

  const keep = parseFloat(keepInput.value) || 3;
  const skip = parseFloat(skipInput.value) || 3;

  // Use first queued file's duration if available
  const firstItem = state.queue[0];
  const dur = firstItem?.info?.duration || 60; // default 60s for preview

  const period = keep + skip;
  if (period <= 0) return;

  const numPeriods = Math.ceil(dur / period);

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < numPeriods; i++) {
    const start = i * period;
    const keepEnd = Math.min(start + keep, dur);
    const skipEnd = Math.min(start + period, dur);

    const x1 = (start / dur) * w;
    const x2 = (keepEnd / dur) * w;
    const x3 = (skipEnd / dur) * w;

    // Keep segment – accent purple
    const grad = ctx.createLinearGradient(x1, 0, x2, 0);
    grad.addColorStop(0, 'rgba(108,92,231,0.9)');
    grad.addColorStop(1, 'rgba(162,155,254,0.7)');
    ctx.fillStyle = grad;
    ctx.fillRect(x1, 4, Math.max(0, x2 - x1 - 1), h - 8);

    // Skip segment – dim
    ctx.fillStyle = 'rgba(40,40,70,0.8)';
    ctx.fillRect(x2, 4, Math.max(0, x3 - x2 - 1), h - 8);
  }

  // Duration label
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(formatDuration(dur), w - 4, h - 6);
}

// ─── Process ─────────────────────────────────────────────────
btnProcess.addEventListener('click', startProcessing);

async function startProcessing() {
  if (state.isProcessing || state.queue.length === 0) return;

  state.isProcessing = true;
  btnProcess.disabled = true;
  btnCancel.style.display = 'flex';
  resultSection.classList.remove('visible');
  resultSection.innerHTML = '';
  progressSection.classList.add('visible');

  const keepSec = parseFloat(keepInput.value) || 3;
  const skipSec = parseFloat(skipInput.value) || 3;
  const trimStartSec = parseFloat(trimStartInput.value) || 0;
  const speedFactor = parseFloat(speedFactorInput.value) || 1;
  const outputName = outputNameInput.value.trim();
  const outputDir = state.outputDir;

  const results = [];
  const total = state.queue.length;

  window.api.onProgress(data => {
    if (data.percent >= 0) progressBar.style.width = `${data.percent}%`;
    progressStatus.innerHTML = data.percent >= 100
      ? `✅ ${data.status}`
      : `<span class="spinner"></span> ${data.status}`;
    if (data.eta != null) {
      progressEta.textContent = `Còn khoảng ${formatDuration(data.eta)}`;
    } else {
      progressEta.textContent = '';
    }
  });

  for (let i = 0; i < total; i++) {
    const item = state.queue[i];
    state.currentFileIdx = i;

    progressLabel.textContent = `Đang xử lý file ${i + 1} / ${total}`;
    progressBar.style.width = '0%';
    progressStatus.innerHTML = '<span class="spinner"></span> Bắt đầu…';
    progressEta.textContent = '';

    setQueueItemStatus(item.id, 'active');

    // Build output name per file: custom name only valid when 1 file; otherwise auto
    const singleName = total === 1 ? outputName : '';
    const result = await window.api.processVideo(item.path, keepSec, skipSec, trimStartSec, speedFactor, outputDir, singleName);

    results.push({ item, result });

    if (result.cancelled) {
      setQueueItemStatus(item.id, 'cancelled');
      // Mark remaining
      for (let j = i + 1; j < total; j++) setQueueItemStatus(state.queue[j].id, 'cancelled');
      break;
    } else if (result.success) {
      setQueueItemStatus(item.id, 'done');
    } else {
      setQueueItemStatus(item.id, 'error');
    }
  }

  window.api.removeProgressListener();

  state.isProcessing = false;
  btnProcess.disabled = false;
  btnCancel.style.display = 'none';

  showResults(results);
}

function showResults(results) {
  const successes = results.filter(r => r.result.success);
  const errors = results.filter(r => !r.result.success && !r.result.cancelled);
  const cancelled = results.find(r => r.result.cancelled);

  if (successes.length === 0 && !cancelled) {
    // All errored
    const msg = errors[0]?.result.error || 'Xử lý thất bại';
    resultSection.innerHTML = `
      <div class="result-error">
        <span class="result-icon-big">❌</span>
        <div><div class="err-title">Xử lý thất bại</div>
        <div class="err-detail">${escHtml(msg)}</div></div>
      </div>`;
    resultSection.classList.add('visible');
    return;
  }

  let html = '';

  if (successes.length > 0) {
    if (successes.length === 1) {
      const out = successes[0].result.outputPath;
      const inf = successes[0].item.info;
      const keepSec = parseFloat(keepInput.value) || 3;
      const skipSec = parseFloat(skipInput.value) || 3;
      const trimStartSec = parseFloat(trimStartInput.value) || 0;
      const speedFactor = parseFloat(speedFactorInput.value) || 1;
      const effectiveDur = Math.max(0, (inf?.duration || 0) - trimStartSec);
      const segs = effectiveDur > 0 ? Math.floor(effectiveDur / (keepSec + skipSec)) + 1 : '?';
      html += `
        <div class="result-success">
          <div class="result-grid">
            <span class="result-icon-big">🎉</span>
            <div class="result-body">
              <div class="result-title">Hoàn thành!</div>
              <div class="result-summary">${segs} đoạn được giữ lại · Lưu: ${escHtml(out.split(/[/\\]/).pop())}</div>
              <div class="result-path">${escHtml(out)}</div>
              <button class="btn-open" data-path="${escAttr(out)}">📂 Mở thư mục</button>
            </div>
          </div>
        </div>`;
    } else {
      html += `
        <div class="result-success">
          <div class="result-grid">
            <span class="result-icon-big">🎉</span>
            <div class="result-body">
              <div class="result-title">Hoàn thành ${successes.length} file!</div>
              <div class="result-summary">${errors.length > 0 ? `${errors.length} file bị lỗi.` : 'Tất cả đều thành công.'}</div>
              ${successes.map(r => `
                <div class="result-path">${escHtml(r.result.outputPath)}</div>
                <button class="btn-open" data-path="${escAttr(r.result.outputPath)}" style="margin-bottom:4px">📂 ${escHtml(r.item.name)}</button>
              `).join('')}
            </div>
          </div>
        </div>`;
    }
  }

  if (cancelled) {
    html += `
      <div class="result-error" style="margin-top:8px">
        <span class="result-icon-big">⚠️</span>
        <div><div class="err-title">Đã huỷ xử lý</div></div>
      </div>`;
  }

  resultSection.innerHTML = html;
  resultSection.classList.add('visible');

  resultSection.querySelectorAll('.btn-open').forEach(btn => {
    btn.addEventListener('click', () => window.api.openFile(btn.dataset.path));
  });
}

// ─── Cancel ──────────────────────────────────────────────────
btnCancel.addEventListener('click', async () => {
  await window.api.cancelProcessing();
  btnCancel.disabled = true;
  btnCancel.style.opacity = '0.5';
  setTimeout(() => {
    btnCancel.disabled = false;
    btnCancel.style.opacity = '';
  }, 1000);
});

// ─── History Tab ─────────────────────────────────────────────
async function loadHistoryTab() {
  const items = await window.api.getHistory();
  historyList.innerHTML = '';

  if (!items || items.length === 0) {
    historyList.innerHTML = '<div class="empty-state">Chưa có file nào được xử lý</div>';
    return;
  }

  items.forEach(item => {
    const date = item.date ? new Date(item.date).toLocaleString('vi-VN') : '';
    const inName = item.inputPath ? item.inputPath.split(/[/\\]/).pop() : '?';
    const outName = item.outputPath ? item.outputPath.split(/[/\\]/).pop() : '?';
    const size = item.outputSize ? formatSize(item.outputSize) : '';
    const meta = [
      `Lấy ${item.keepSec}s / Bỏ ${item.skipSec}s` + (item.trimStartSec ? ` / Cắt ${item.trimStartSec}s` : '') + (item.speedFactor && item.speedFactor !== 1 ? ` / ${item.speedFactor}x` : ''),
      item.segments ? `${item.segments} đoạn` : '',
      size,
    ].filter(Boolean).join(' · ');

    const el = document.createElement('div');
    el.className = 'history-item';
    el.innerHTML = `
      <div>
        <div class="history-name" title="${escAttr(inName)}">📥 ${escHtml(inName)}</div>
        <div class="history-name" title="${escAttr(outName)}" style="color:var(--accent-alt);margin-top:2px">📤 ${escHtml(outName)}</div>
        <div class="history-meta">${escHtml(meta)}</div>
      </div>
      <div class="history-date">${escHtml(date)}</div>
    `;
    historyList.appendChild(el);
  });
}

btnClearHistory.addEventListener('click', async () => {
  await window.api.clearHistory();
  historyList.innerHTML = '<div class="empty-state">Đã xoá lịch sử</div>';
});

// ─── Utilities ───────────────────────────────────────────────
function formatDuration(sec) {
  if (!sec || isNaN(sec)) return '0s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, '0')}m${s.toString().padStart(2, '0')}s`;
  if (m > 0) return `${m}m${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) { return escHtml(s); }

// ─── Resize → redraw timeline ─────────────────────────────────
window.addEventListener('resize', drawTimeline);
