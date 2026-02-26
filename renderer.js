// ─── DOM Elements ───────────────────────────────────
const dropZone = document.getElementById('dropZone');
const dropText = document.getElementById('dropText');
const fileNameEl = document.getElementById('fileName');
const btnProcess = document.getElementById('btnProcess');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const progressStatus = document.getElementById('progressStatus');
const resultSection = document.getElementById('resultSection');
const keepDurationInput = document.getElementById('keepDuration');
const skipDurationInput = document.getElementById('skipDuration');

let selectedFilePath = null;
let isProcessing = false;

// ─── File Selection ─────────────────────────────────
dropZone.addEventListener('click', async () => {
  if (isProcessing) return;
  const filePath = await window.api.selectVideo();
  if (filePath) {
    setSelectedFile(filePath);
  }
});

// Drag & drop support
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('drag-over');

  if (isProcessing) return;

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    const file = files[0];
    // Electron gives us the path via the File object
    if (file.path) {
      setSelectedFile(file.path);
    }
  }
});

function setSelectedFile(filePath) {
  selectedFilePath = filePath;
  const name = filePath.split(/[/\\]/).pop();
  dropText.textContent = 'Đã chọn:';
  fileNameEl.textContent = name;
  dropZone.classList.add('has-file');
  btnProcess.disabled = false;

  // Reset previous results
  resultSection.classList.remove('visible');
  resultSection.innerHTML = '';
  progressSection.classList.remove('visible');
}

// ─── Process Video ──────────────────────────────────
btnProcess.addEventListener('click', async () => {
  if (!selectedFilePath || isProcessing) return;

  isProcessing = true;
  btnProcess.disabled = true;
  btnProcess.textContent = 'Đang xử lý...';
  resultSection.classList.remove('visible');
  resultSection.innerHTML = '';

  // Show progress
  progressSection.classList.add('visible');
  progressBar.style.width = '0%';
  progressStatus.innerHTML = '<span class="spinner"></span> Đang chuẩn bị...';

  // Listen for progress updates
  window.api.onProgress((data) => {
    if (data.percent >= 0) {
      progressBar.style.width = `${data.percent}%`;
    } else {
      // Indeterminate – animate to ~60%
      progressBar.style.width = '60%';
    }
    progressStatus.innerHTML = data.percent >= 100
      ? '✅ ' + data.status
      : `<span class="spinner"></span> ${data.status}`;
  });

  try {
    const keepSec = parseFloat(keepDurationInput.value) || 3;
    const skipSec = parseFloat(skipDurationInput.value) || 3;
    const result = await window.api.processVideo(selectedFilePath, keepSec, skipSec);

    if (result.success) {
      showSuccess(result.outputPath);
    } else {
      showError(result.error || 'Đã xảy ra lỗi không xác định.');
    }
  } catch (err) {
    showError(err.message || 'Đã xảy ra lỗi.');
  } finally {
    isProcessing = false;
    btnProcess.disabled = false;
    btnProcess.textContent = 'Cắt & Ghép Video';
    window.api.removeProgressListener();
  }
});

function showSuccess(outputPath) {
  progressBar.style.width = '100%';
  resultSection.innerHTML = `
    <div class="result-success">
      <span class="result-icon">🎉</span>
      <div class="result-text">Video đã được tạo thành công!</div>
      <div class="result-path">${outputPath}</div>
      <button class="btn-open" id="btnOpen">📂 Mở thư mục chứa file</button>
    </div>
  `;
  resultSection.classList.add('visible');

  document.getElementById('btnOpen').addEventListener('click', () => {
    window.api.openFile(outputPath);
  });
}

function showError(message) {
  resultSection.innerHTML = `
    <div class="result-error">
      <span class="result-icon">❌</span>
      <div class="result-text">Xử lý thất bại</div>
      <div class="error-detail">${message}</div>
    </div>
  `;
  resultSection.classList.add('visible');
}
