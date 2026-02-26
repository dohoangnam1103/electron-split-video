const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

// Set ffmpeg path from bundled binary
const ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
ffmpeg.setFfmpegPath(ffmpegPath);

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 650,
    minWidth: 600,
    minHeight: 500,
    backgroundColor: '#0f0f1a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC Handlers ────────────────────────────────────────────

ipcMain.handle('select-video', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn file video',
    filters: [
      { name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('open-file', async (_event, filePath) => {
  shell.showItemInFolder(filePath);
});

// Get video duration using ffprobe
function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

ipcMain.handle('process-video', async (event, inputPath, keepSec, skipSec) => {
  try {
    const KEEP = keepSec || 3;
    const SKIP = skipSec || 3;
    const duration = await getVideoDuration(inputPath);
    if (!duration || duration <= 0) {
      throw new Error('Không thể đọc thời lượng video.');
    }

    const segments = [];
    let t = 0;
    while (t < duration) {
      const start = t;
      const end = Math.min(t + KEEP, duration);
      if (end > start) {
        segments.push({ start, end });
      }
      t += KEEP + SKIP;
    }

    if (segments.length === 0) {
      throw new Error('Video quá ngắn, không có đoạn nào để giữ.');
    }

    // Build output path
    const ext = path.extname(inputPath);
    const basename = path.basename(inputPath, ext);
    const dir = path.dirname(inputPath);
    const outputPath = path.join(dir, `${basename}_split${ext}`);

    // Build FFmpeg filter_complex for single-pass processing
    // For each segment: trim video + audio, then concat all
    const filterParts = [];
    const concatInputs = [];

    segments.forEach((seg, i) => {
      const vLabel = `v${i}`;
      const aLabel = `a${i}`;
      filterParts.push(
        `[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[${vLabel}]`
      );
      filterParts.push(
        `[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[${aLabel}]`
      );
      concatInputs.push(`[${vLabel}][${aLabel}]`);
    });

    const concatFilter = `${concatInputs.join('')}concat=n=${segments.length}:v=1:a=1[outv][outa]`;
    filterParts.push(concatFilter);

    const filterComplex = filterParts.join(';');

    // Send progress info
    event.sender.send('progress', {
      percent: 0,
      status: `Đang xử lý: ${segments.length} đoạn (${duration.toFixed(1)}s → ~${(segments.length * KEEP).toFixed(1)}s)`,
    });

    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .complexFilter(filterComplex)
        .outputOptions(['-map', '[outv]', '-map', '[outa]'])
        .output(outputPath)
        .on('progress', (progress) => {
          // progress.percent may not always be available
          const pct = progress.percent ? Math.min(Math.round(progress.percent), 100) : -1;
          event.sender.send('progress', {
            percent: pct,
            status: `Đang xử lý...${pct >= 0 ? ` ${pct}%` : ''}`,
          });
        })
        .on('end', () => {
          event.sender.send('progress', { percent: 100, status: 'Hoàn thành!' });
          resolve({ success: true, outputPath });
        })
        .on('error', (err) => {
          // If audio stream doesn't exist, retry without audio
          if (err.message.includes('Stream map') || err.message.includes('does not contain')) {
            processVideoOnly(event, inputPath, segments, outputPath)
              .then(resolve)
              .catch(reject);
          } else {
            reject(err);
          }
        });

      command.run();
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Fallback: process video without audio (for videos with no audio stream)
function processVideoOnly(event, inputPath, segments, outputPath) {
  const filterParts = [];
  const concatInputs = [];

  segments.forEach((seg, i) => {
    const vLabel = `v${i}`;
    filterParts.push(
      `[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[${vLabel}]`
    );
    concatInputs.push(`[${vLabel}]`);
  });

  const concatFilter = `${concatInputs.join('')}concat=n=${segments.length}:v=1:a=0[outv]`;
  filterParts.push(concatFilter);

  const filterComplex = filterParts.join(';');

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .complexFilter(filterComplex)
      .outputOptions(['-map', '[outv]'])
      .output(outputPath)
      .on('progress', (progress) => {
        const pct = progress.percent ? Math.min(Math.round(progress.percent), 100) : -1;
        event.sender.send('progress', {
          percent: pct,
          status: `Đang xử lý (không audio)...${pct >= 0 ? ` ${pct}%` : ''}`,
        });
      })
      .on('end', () => {
        event.sender.send('progress', { percent: 100, status: 'Hoàn thành!' });
        resolve({ success: true, outputPath });
      })
      .on('error', (err) => reject(err))
      .run();
  });
}
