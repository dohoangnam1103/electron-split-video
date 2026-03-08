'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ffmpegLib = require('fluent-ffmpeg');

// ─── Resolve ffmpeg & ffprobe binary paths ──────────────────
function getFfmpegPath() {
  if (app.isPackaged) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    return path.join(process.resourcesPath, 'bin', 'ffmpeg' + ext);
  }
  return require('ffmpeg-static');
}
function getFfprobePath() {
  if (app.isPackaged) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    return path.join(process.resourcesPath, 'bin', 'ffprobe' + ext);
  }
  return require('ffprobe-static').path;
}

ffmpegLib.setFfmpegPath(getFfmpegPath());
ffmpegLib.setFfprobePath(getFfprobePath());

// ─── Settings + History helpers ──────────────────────────────
const userDataDir = app.getPath('userData');
const settingsFile = path.join(userDataDir, 'settings.json');
const historyFile = path.join(userDataDir, 'history.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsFile)) {
      return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    }
  } catch (_) { }
  return { keepSec: 3, skipSec: 3, trimStartSec: 0, speedFactor: 1, outputDir: '' };
}

function saveSettings(data) {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) { }
}

function loadHistory() {
  try {
    if (fs.existsSync(historyFile)) {
      return JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    }
  } catch (_) { }
  return [];
}

function appendHistory(entry) {
  try {
    const arr = loadHistory();
    arr.unshift({ ...entry, date: new Date().toISOString() });
    const limited = arr.slice(0, 100); // keep only last 100
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(historyFile, JSON.stringify(limited, null, 2), 'utf8');
  } catch (_) { }
}

// ─── State ──────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let isQuitting = false;

// Active ffmpeg commands - for cancellation
let activeCommands = [];
let cancelRequested = false;

// ─── Tray Icon (create a simple icon via nativeImage) ────────
function createTrayIcon() {
  // Create a simple 16×16 icon programmatically (purple scissors-like)
  // Using a tiny PNG buffer encoded as base64
  // This is a 16x16 purple square with scissors symbol - simplified
  const iconPath = path.join(__dirname, 'resources', 'tray-icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  // Fallback: empty 16x16 image
  return nativeImage.createEmpty();
}

// ─── Window ──────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1020,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#0a0a1a',
    titleBarStyle: 'hiddenInset',
    frame: process.platform !== 'win32',
    titleBarOverlay: process.platform === 'win32' ? {
      color: '#0a0a1a',
      symbolColor: '#e8e8f0',
      height: 36,
    } : false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');

  // Minimize to tray instead of close
  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function setupTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Video Splitter');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Mở Video Splitter',
      click: () => { mainWindow.show(); mainWindow.focus(); },
    },
    { type: 'separator' },
    {
      label: 'Thoát',
      click: () => { isQuitting = true; app.quit(); },
    },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  createWindow();
  setupTray();
});

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else mainWindow.show();
});

// ─── IPC: window controls ─────────────────────────────────────
ipcMain.on('win-minimize', () => mainWindow?.minimize());
ipcMain.on('win-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('win-close', () => {
  // treat as hide-to-tray if tray exists
  if (tray) mainWindow?.hide();
  else { isQuitting = true; app.quit(); }
});

// ─── IPC: dialogs ────────────────────────────────────────────
ipcMain.handle('select-video', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn file video',
    filters: [
      { name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths;
});

ipcMain.handle('select-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn thư mục lưu file output',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('open-file', async (_event, filePath) => {
  shell.showItemInFolder(filePath);
});

// ─── IPC: video info ─────────────────────────────────────────
ipcMain.handle('get-video-info', async (_event, filePath) => {
  return new Promise((resolve) => {
    ffmpegLib.ffprobe(filePath, (err, meta) => {
      if (err) return resolve(null);
      const fmt = meta.format || {};
      const vStream = (meta.streams || []).find(s => s.codec_type === 'video') || {};
      const aStream = (meta.streams || []).find(s => s.codec_type === 'audio');

      let fps = null;
      if (vStream.r_frame_rate) {
        const parts = vStream.r_frame_rate.split('/');
        fps = parts.length === 2 ? (parseFloat(parts[0]) / parseFloat(parts[1])) : null;
      }

      resolve({
        duration: fmt.duration || 0,
        size: fmt.size || 0,
        hasAudio: !!aStream,
        width: vStream.width || 0,
        height: vStream.height || 0,
        fps: fps ? Math.round(fps * 10) / 10 : null,
        codec: vStream.codec_name || '',
      });
    });
  });
});

// ─── IPC: settings ───────────────────────────────────────────
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (_event, data) => { saveSettings(data); return true; });

// ─── IPC: history ────────────────────────────────────────────
ipcMain.handle('get-history', () => loadHistory());
ipcMain.handle('clear-history', () => {
  try { fs.writeFileSync(historyFile, '[]', 'utf8'); } catch (_) { }
  return true;
});

// ─── IPC: cancel ─────────────────────────────────────────────
ipcMain.handle('cancel-processing', () => {
  cancelRequested = true;
  for (const cmd of activeCommands) {
    try { cmd.kill('SIGKILL'); } catch (_) { }
  }
  activeCommands = [];
  return true;
});

// ─── Helpers ─────────────────────────────────────────────────
function cleanupFiles(files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch (_) { }
  }
}

function getVideoInfo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpegLib.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err);
      const vStream = (meta.streams || []).find(s => s.codec_type === 'video') || {};
      const aStream = (meta.streams || []).find(s => s.codec_type === 'audio');
      // Prefer video stream bitrate, fall back to overall format bitrate
      const videoBitrate = parseInt(vStream.bit_rate || meta.format.bit_rate || 0, 10);
      resolve({
        duration: parseFloat(meta.format.duration || 0),
        hasAudio: !!aStream,
        videoBitrate,
      });
    });
  });
}

/**
 * Cut a single segment using input-side seeking (fast, low RAM).
 * Returns a promise that resolves when done, rejects on error.
 * The returned ffmpeg command is also registered in activeCommands for cancellation.
 */
function cutSegment(inputPath, destPath, start, end, hasAudio) {
  return new Promise((resolve, reject) => {
    const dur = end - start;
    const opts = ['-c copy', '-avoid_negative_ts make_zero'];
    if (!hasAudio) opts.push('-an');

    const cmd = ffmpegLib(inputPath)
      .inputOptions([`-ss ${start}`, `-t ${dur}`])
      .outputOptions(opts)
      .output(destPath)
      .on('end', () => {
        activeCommands = activeCommands.filter(c => c !== cmd);
        resolve();
      })
      .on('error', (err) => {
        activeCommands = activeCommands.filter(c => c !== cmd);
        reject(err);
      });

    activeCommands.push(cmd);
    cmd.run();
  });
}

function concatSegments(concatListPath, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpegLib(concatListPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .output(outputPath)
      .on('end', () => {
        activeCommands = activeCommands.filter(c => c !== cmd);
        resolve();
      })
      .on('error', (err) => {
        activeCommands = activeCommands.filter(c => c !== cmd);
        reject(err);
      });

    activeCommands.push(cmd);
    cmd.run();
  });
}

// ─── IPC: process-video ──────────────────────────────────────
//
// Uses ffmpeg select/aselect filters for frame-accurate keep/skip.
// Single-pass, no temp segment files needed.
//
ipcMain.handle('process-video', async (event, inputPath, keepSec, skipSec, trimStartSec, speedFactor, outputDir, outputName) => {
  cancelRequested = false;

  try {
    const KEEP = Math.max(0.1, keepSec || 3);
    const SKIP = Math.max(0, skipSec || 3);
    const TRIM = Math.max(0, trimStartSec || 0);
    const SPEED = Math.max(0.1, speedFactor || 1);

    // Probe: get duration, audio, and bitrate in one call
    const { duration, hasAudio, videoBitrate } = await getVideoInfo(inputPath);

    if (!duration || duration <= 0) throw new Error('Không thể đọc thời lượng video.');
    if (duration <= TRIM && TRIM > 0) throw new Error('Thời gian cắt bỏ ở đầu lớn hơn hoặc bằng thời lượng video.');

    const effectiveDuration = duration - TRIM;
    const expectedDur = Math.round(((KEEP / (KEEP + SKIP)) * effectiveDuration) / SPEED);

    // Determine output path
    const ext = path.extname(inputPath);
    const base = outputName
      ? (outputName.endsWith(ext) ? outputName : outputName + ext)
      : path.basename(inputPath, ext) + '_split' + ext;
    const dir = (outputDir && fs.existsSync(outputDir)) ? outputDir : path.dirname(inputPath);
    const output = path.join(dir, base);

    const sendProgress = (percent, status, eta) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('progress', { percent, status, eta: eta || null });
      }
    };

    sendProgress(0, `Bắt đầu: giữ ${KEEP}s / bỏ ${SKIP}s → output ~${expectedDur}s…`);

    const cycle = KEEP + SKIP;
    // select filter: keep frames where time-within-cycle < KEEP
    // aselect: same for audio
    const vf = `select=lt(mod(t\\,${cycle})\\,${KEEP}),setpts=(N/FRAME_RATE/TB)/${SPEED}`;
    const af = `aselect=lt(mod(t\\,${cycle})\\,${KEEP}),asetpts=N/SR/TB,atempo=${SPEED}`;

    await new Promise((resolve, reject) => {
      // Match input bitrate so output file is proportionally smaller
      const bitrateOpts = videoBitrate > 0
        ? [`-b:v ${videoBitrate}`]
        : ['-crf 23'];  // fallback if bitrate unknown

      let outOpts = [
        `-vf ${vf}`,
        '-vsync vfr',
        ...bitrateOpts,
      ];
      if (hasAudio) {
        outOpts.push(`-af ${af}`);
      } else {
        outOpts.push('-an');
      }

      const cmd = ffmpegLib(inputPath);
      if (TRIM > 0) {
        cmd.inputOptions([`-ss ${TRIM}`]);
      }

      cmd.outputOptions(outOpts)
        .output(output)
        .on('progress', (progress) => {
          if (cancelRequested) {
            try { cmd.kill('SIGKILL'); } catch (_) { }
            return;
          }
          if (progress.timemark) {
            const parts = progress.timemark.split(':');
            const currentSec = (+parts[0]) * 3600 + (+parts[1]) * 60 + parseFloat(parts[2]);
            const pct = Math.min(99, Math.round((currentSec / Math.max(expectedDur, 1)) * 100));
            sendProgress(pct, `Đang xử lý… ${progress.timemark}`);
          }
        })
        .on('end', () => {
          activeCommands = activeCommands.filter(c => c !== cmd);
          resolve();
        })
        .on('error', (err) => {
          activeCommands = activeCommands.filter(c => c !== cmd);
          reject(err);
        });

      activeCommands.push(cmd);
      cmd.run();
    });

    if (cancelRequested) throw new Error('__CANCELLED__');

    sendProgress(100, 'Hoàn thành!');

    // History
    const outputStat = fs.existsSync(output) ? fs.statSync(output) : null;
    appendHistory({
      inputPath,
      outputPath: output,
      keepSec: KEEP,
      skipSec: SKIP,
      trimStartSec: TRIM,
      speedFactor: SPEED,
      outputSize: outputStat ? outputStat.size : 0,
    });

    // Native notification
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Video Splitter',
          body: `Hoàn thành! ${path.basename(output)}`,
        }).show();
      }
    } catch (_) { }

    return { success: true, outputPath: output };

  } catch (err) {
    if (err.message === '__CANCELLED__') {
      return { success: false, cancelled: true, error: 'Đã huỷ xử lý.' };
    }
    return { success: false, error: err.message };
  }
});


