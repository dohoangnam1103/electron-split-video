#!/usr/bin/env node
'use strict';

/**
 * Download ffmpeg binaries for all target platforms.
 * This ensures cross-platform Electron builds work correctly.
 *
 * Usage: node scripts/download-ffmpeg.js
 */

const fs = require('fs');
const path = require('path');
const { createGunzip } = require('zlib');
const { pipeline } = require('stream');
const https = require('https');

// Match the version used by ffmpeg-static package
const RELEASE_TAG = 'b6.1.1';
const BASE_URL = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE_TAG}`;

// Platforms & architectures to download
const TARGETS = [
  { platform: 'win32', arch: 'x64', filename: 'ffmpeg.exe' },
  // Add more targets here if needed, e.g.:
  // { platform: 'darwin', arch: 'arm64', filename: 'ffmpeg' },
  // { platform: 'linux', arch: 'x64', filename: 'ffmpeg' },
];

function followRedirects(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

    const get = url.startsWith('https') ? https.get : require('http').get;
    get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        followRedirects(res.headers.location, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      } else if (res.statusCode === 200) {
        resolve(res);
      } else {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
    }).on('error', reject);
  });
}

async function downloadTarget(target) {
  const { platform, arch, filename } = target;
  const url = `${BASE_URL}/ffmpeg-${platform}-${arch}.gz`;
  const destDir = path.join(__dirname, '..', 'resources', platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux');
  const destPath = path.join(destDir, filename);

  // Skip if already downloaded
  if (fs.existsSync(destPath)) {
    const stats = fs.statSync(destPath);
    if (stats.size > 1000000) { // > 1MB means it's likely valid
      console.log(`✅ ${platform}-${arch}: Already exists (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
      return;
    }
  }

  console.log(`⬇️  Downloading ffmpeg for ${platform}-${arch}...`);
  console.log(`   URL: ${url}`);

  fs.mkdirSync(destDir, { recursive: true });

  const response = await followRedirects(url);
  const totalBytes = parseInt(response.headers['content-length'] || '0', 10);

  return new Promise((resolve, reject) => {
    let downloaded = 0;
    response.on('data', (chunk) => {
      downloaded += chunk.length;
      if (totalBytes > 0) {
        const pct = ((downloaded / totalBytes) * 100).toFixed(1);
        process.stdout.write(`\r   Progress: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
      }
    });

    pipeline(
      response,
      createGunzip(),
      fs.createWriteStream(destPath),
      (err) => {
        if (err) {
          console.error(`\n❌ Failed to download for ${platform}-${arch}:`, err.message);
          reject(err);
        } else {
          fs.chmodSync(destPath, 0o755);
          const size = fs.statSync(destPath).size;
          console.log(`\n✅ ${platform}-${arch}: Downloaded (${(size / 1024 / 1024).toFixed(1)} MB) → ${destPath}`);
          resolve();
        }
      }
    );
  });
}

async function main() {
  console.log(`\n📦 Downloading ffmpeg binaries (release: ${RELEASE_TAG})\n`);

  for (const target of TARGETS) {
    try {
      await downloadTarget(target);
    } catch (err) {
      console.error(`\n❌ Error downloading ${target.platform}-${target.arch}:`, err.message);
      process.exit(1);
    }
  }

  console.log('\n✅ All downloads complete!\n');
}

main();
