/**
 * OmniEng Native Application Icon Generator
 * 
 * Generates an uncompressed, mathematically exact 512x512 RGBA PNG icon
 * featuring the OmniEng engineering caliper and quantum core motif.
 * Zero external graphics dependencies (uses native zlib & PNG specification).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(width, height, pixelFn) {
  // Row filter byte (0 = None) + 4 bytes per pixel (RGBA)
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter None

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const [r, g, b, a] = pixelFn(x, y, width, height);
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  // Deflate raw image scanlines
  const compressed = zlib.deflateSync(rawData, { level: 9 });

  // PNG Signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // CRC32 Table
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c;
  }

  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = data.length;
    const header = Buffer.alloc(4);
    header.writeUInt32BE(len, 0);

    const typeBuf = Buffer.from(type, 'ascii');
    const bodyAndType = Buffer.concat([typeBuf, data]);
    const crcVal = crc32(bodyAndType);

    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crcVal, 0);

    return Buffer.concat([header, typeBuf, data, crcBuf]);
  }

  // IHDR Chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth: 8
  ihdr[9] = 6;  // color type: RGBA (6)
  ihdr[10] = 0; // compression method: deflate
  ihdr[11] = 0; // filter method: 0
  ihdr[12] = 0; // interlace method: 0 (no interlace)

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function generateOmniEngIcon(size = 512) {
  const half = size / 2;
  const radius = half * 0.88;

  const pngBuffer = createPng(size, size, (x, y, w, h) => {
    const dx = x - half;
    const dy = y - half;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Rounded app icon squircle bounding box
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const squircleDist = Math.pow(Math.pow(absX / radius, 4) + Math.pow(absY / radius, 4), 0.25);

    if (squircleDist > 1.0) {
      return [0, 0, 0, 0]; // Transparent outside icon
    }

    // Background gradient: Dark Slate Navy -> Deep Charcoal (#0B0F19 to #1A2234)
    const tY = y / h;
    let bgR = Math.floor(11 + tY * 18);
    let bgG = Math.floor(15 + tY * 20);
    let bgB = Math.floor(25 + tY * 30);

    // Subtle brushed concentric grid rings
    const ringDist = dist % (size * 0.08);
    if (ringDist < 1.5 && dist < radius * 0.9) {
      bgR += 14;
      bgG += 22;
      bgB += 35;
    }

    // Outer edge border glow (Metallic Cyan #00e5ff)
    if (squircleDist > 0.96) {
      const alphaGlow = (squircleDist - 0.96) / 0.04;
      const borderR = Math.floor(0 * alphaGlow + bgR * (1 - alphaGlow));
      const borderG = Math.floor(229 * alphaGlow + bgG * (1 - alphaGlow));
      const borderB = Math.floor(255 * alphaGlow + bgB * (1 - alphaGlow));
      return [borderR, borderG, borderB, 255];
    }

    // Engineering Caliper Motif & Hexagonal Core
    // Hexagonal nucleus at center
    const hexRadius = size * 0.16;
    const angle = Math.atan2(dy, dx);
    const hexDist = dist * Math.cos((Math.abs(angle) % (Math.PI / 3)) - (Math.PI / 6));

    if (hexDist < hexRadius) {
      // Radiant Core: Cyan to Electric Violet (#00F0FF to #7B2CBF)
      const gradCore = dist / hexRadius;
      const coreR = Math.floor(0 * (1 - gradCore) + 123 * gradCore);
      const coreG = Math.floor(240 * (1 - gradCore) + 44 * gradCore);
      const coreB = Math.floor(255 * (1 - gradCore) + 191 * gradCore);
      return [coreR, coreG, coreB, 255];
    }

    // Precision Caliper Jaw Shapes
    const caliperInner = size * 0.22;
    const caliperOuter = size * 0.32;
    if (dist >= caliperInner && dist <= caliperOuter) {
      if (dx < size * 0.15 && (dy < size * 0.25 || dx < -size * 0.15)) {
        return [180, 210, 230, 255];
      }
    }

    // Vernier scale ticks on upper right
    if (dist >= caliperOuter && dist <= caliperOuter + size * 0.05 && dx > 0 && dy < 0) {
      const tick = Math.floor((angle + Math.PI / 2) * 15) % 2;
      if (tick === 0) {
        return [0, 229, 255, 240];
      }
    }

    return [bgR, bgG, bgB, 255];
  });

  return pngBuffer;
}

// Generate build/icon.png
const { execSync } = require('child_process');
const buildDir = path.resolve(__dirname, '..', 'build');
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

const icon512 = generateOmniEngIcon(512);
const iconPath = path.join(buildDir, 'icon.png');
fs.writeFileSync(iconPath, icon512);
console.log(`[Icon Generator] Successfully wrote ${icon512.length} bytes to ${iconPath}`);

// Generate macOS .icns if iconutil and sips exist
try {
  const iconsetDir = path.join(buildDir, 'icon.iconset');
  if (fs.existsSync(iconsetDir)) {
    fs.rmSync(iconsetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(iconsetDir, { recursive: true });

  const sizes = [16, 32, 128, 256, 512];
  sizes.forEach(s => {
    const pngS = generateOmniEngIcon(s);
    fs.writeFileSync(path.join(iconsetDir, `icon_${s}x${s}.png`), pngS);
    if (s <= 256) {
      const png2x = generateOmniEngIcon(s * 2);
      fs.writeFileSync(path.join(iconsetDir, `icon_${s}x${s}@2x.png`), png2x);
    }
  });

  execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(buildDir, 'icon.icns')}"`, { stdio: 'pipe' });
  console.log(`[Icon Generator] Successfully created macOS bundle icon: ${path.join(buildDir, 'icon.icns')}`);
  fs.rmSync(iconsetDir, { recursive: true, force: true });
} catch (e) {
  console.warn('[Icon Generator] Note: macOS iconutil conversion skipped or not supported:', e.message);
}

// Generate Windows .ico container natively from PNG
try {
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // reserved
  icoHeader.writeUInt16LE(1, 2); // type 1 = icon
  icoHeader.writeUInt16LE(1, 4); // 1 image

  const icoDirEntry = Buffer.alloc(16);
  icoDirEntry.writeUInt8(0, 0); // width: 0 = 256px
  icoDirEntry.writeUInt8(0, 1); // height: 0 = 256px
  icoDirEntry.writeUInt8(0, 2); // color count
  icoDirEntry.writeUInt8(0, 3); // reserved
  icoDirEntry.writeUInt16LE(1, 4); // color planes
  icoDirEntry.writeUInt16LE(32, 6); // bits per pixel
  icoDirEntry.writeUInt32LE(icon512.length, 8); // image size
  icoDirEntry.writeUInt32LE(6 + 16, 12); // image offset

  const icoBuffer = Buffer.concat([icoHeader, icoDirEntry, icon512]);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);
  console.log(`[Icon Generator] Successfully created Windows icon: ${path.join(buildDir, 'icon.ico')}`);
} catch (e) {
  console.warn('[Icon Generator] Note: Windows .ico generation failed:', e.message);
}

module.exports = { generateOmniEngIcon };

