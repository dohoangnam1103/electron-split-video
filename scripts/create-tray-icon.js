/**
 * scripts/create-tray-icon.js
 * Creates a simple tray icon PNG using only built-in Node.js (no canvas needed).
 * Outputs: resources/tray-icon.png (a 32x32 raw RGBA → simple PNG)
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ── Tiny PNG encoder (no dependencies) ──────────────────────────────────────
// Based on the DEFLATE-uncompressed / filter-none trick for small icons.
const crc32 = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c;
    }
    return (buf) => {
        let c = 0xffffffff;
        for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
})();

function uint32be(n) {
    const b = Buffer.allocUnsafe(4);
    b.writeUInt32BE(n, 0);
    return b;
}

function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const len = uint32be(data.length);
    const crc = uint32be(crc32(Buffer.concat([typeBytes, data])));
    return Buffer.concat([len, typeBytes, data, crc]);
}

function makePng(width, height, pixels) {
    // pixels: Uint8Array of RGBA (width * height * 4 bytes)
    const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    const ihdr = Buffer.concat([
        uint32be(width), uint32be(height),
        Buffer.from([8, 2, 0, 0, 0]), // 8-bit RGB (no alpha for simplicity)
    ]);

    // Build raw scanlines (filter byte 0 + RGB data)
    // Use RGB only (drop alpha)
    const stride = width * 3;
    const raw = Buffer.allocUnsafe(height * (1 + stride));
    for (let y = 0; y < height; y++) {
        raw[y * (1 + stride)] = 0; // filter None
        for (let x = 0; x < width; x++) {
            const si = (y * width + x) * 4;
            const di = y * (1 + stride) + 1 + x * 3;
            raw[di] = pixels[si];     // R
            raw[di + 1] = pixels[si + 1]; // G
            raw[di + 2] = pixels[si + 2]; // B
        }
    }

    // DEFLATE uncompressed block
    const deflate = deflateStore(raw);

    return Buffer.concat([
        PNG_SIG,
        chunk('IHDR', ihdr),
        chunk('IDAT', deflate),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

function deflateStore(data) {
    // zlib wrapper around uncompressed DEFLATE store blocks
    const MAX_BLOCK = 65535;
    const blocks = [];
    let offset = 0;
    while (offset < data.length) {
        const end = Math.min(offset + MAX_BLOCK, data.length);
        const slice = data.slice(offset, end);
        const last = end >= data.length ? 1 : 0;
        const hdr = Buffer.from([last, slice.length & 0xff, (slice.length >> 8) & 0xff,
            (~slice.length) & 0xff, ((~slice.length) >> 8) & 0xff]);
        blocks.push(hdr, slice);
        offset = end;
    }

    // Adler-32 checksum
    let s1 = 1, s2 = 0;
    for (const b of data) { s1 = (s1 + b) % 65521; s2 = (s2 + s1) % 65521; }
    const adler = uint32be((s2 << 16) | s1);

    // zlib header: CMF=0x78, FLG=0x9C (deflate, default compression)
    return Buffer.concat([Buffer.from([0x78, 0x9c]), ...blocks, adler]);
}

// ── Draw the icon ────────────────────────────────────────────────────────────
const SIZE = 32;
const pix = new Uint8Array(SIZE * SIZE * 4);

function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    pix[i] = r; pix[i + 1] = g; pix[i + 2] = b; pix[i + 3] = a;
}

// Background: dark purple
for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++)
        setPixel(x, y, 10, 10, 26);

// Scissors body: two diagonal lines crossing
const [PR, PG, PB] = [162, 155, 254]; // accent purple

// Blade 1: top-left → center
for (let t = 0; t <= 12; t++) {
    const x = 4 + t; const y = 8 + t;
    for (let d = -1; d <= 1; d++) {
        setPixel(x + d, y, PR, PG, PB);
        setPixel(x, y + d, PR, PG, PB);
    }
}
// Blade 2: bottom-left → center
for (let t = 0; t <= 12; t++) {
    const x = 4 + t; const y = 22 - t;
    for (let d = -1; d <= 1; d++) {
        setPixel(x + d, y, PR, PG, PB);
        setPixel(x, y + d, PR, PG, PB);
    }
}
// Blade 3: center → top-right
for (let t = 0; t <= 12; t++) {
    const x = 16 + t; const y = 20 - t;
    for (let d = -1; d <= 1; d++) {
        setPixel(x + d, y, PR, PG, PB);
        setPixel(x, y + d, PR, PG, PB);
    }
}
// Handle circles
const circles = [[8, 8, 4], [8, 22, 4]];
for (const [cx, cy, r] of circles) {
    for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
            const dx = x - cx, dy = y - cy;
            if (dx * dx + dy * dy <= r * r)
                setPixel(x, y, PR, PG, PB);
        }
    }
    // Inner hole
    for (let y = cy - 2; y <= cy + 2; y++)
        for (let x = cx - 2; x <= cx + 2; x++) {
            const dx = x - cx, dy = y - cy;
            if (dx * dx + dy * dy <= 4)
                setPixel(x, y, 10, 10, 26);
        }
}

// Write PNG
const outPath = path.join(__dirname, '..', 'resources', 'tray-icon.png');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, makePng(SIZE, SIZE, pix));
console.log('✅ tray-icon.png created at', outPath);
