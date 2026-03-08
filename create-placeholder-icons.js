/**
 * Creates placeholder PNG icons using pure Node.js (no dependencies).
 * These are simple colored squares with "RR" text embedded as a PNG.
 * Replace with actual logo by running generate-icons.js after placing logo-source.png.
 */

const fs   = require('fs');
const path = require('path');

// Minimal PNG encoder (pure JS, no deps)
function createPNG(width, height, pixels) {
  function adler32(data) {
    let s1 = 1, s2 = 0;
    for (let i = 0; i < data.length; i++) {
      s1 = (s1 + data[i]) % 65521;
      s2 = (s2 + s1) % 65521;
    }
    return (s2 << 16) | s1;
  }

  function crc32(data) {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
    let crc = 0xFFFFFFFF;
    for (const b of data) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function u32be(n) {
    return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
  }

  function chunk(type, data) {
    const typeBytes = type.split('').map(c => c.charCodeAt(0));
    const crc = crc32([...typeBytes, ...data]);
    return [...u32be(data.length), ...typeBytes, ...data, ...u32be(crc)];
  }

  // IHDR
  const ihdr = chunk('IHDR', [
    ...u32be(width), ...u32be(height),
    8, 2, 0, 0, 0  // bit depth=8, colour type=2 (RGB), compression, filter, interlace
  ]);

  // Raw image data (filter byte 0 per row)
  const raw = [];
  for (let y = 0; y < height; y++) {
    raw.push(0); // filter type None
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw.push(pixels[i], pixels[i+1], pixels[i+2]);
    }
  }

  // Deflate (uncompressed, zlib level 0)
  const deflated = deflateStore(new Uint8Array(raw));

  const idat = chunk('IDAT', [...deflated]);
  const iend = chunk('IEND', []);

  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  return Buffer.from([...sig, ...ihdr, ...idat, ...iend]);
}

function deflateStore(data) {
  // zlib header (no compression)
  const BLOCK_SIZE = 65535;
  const out = [0x78, 0x01]; // zlib header CMF, FLG (no compression)
  let i = 0;
  while (i < data.length) {
    const end  = Math.min(i + BLOCK_SIZE, data.length);
    const block = data.slice(i, end);
    const last  = end >= data.length ? 1 : 0;
    const len   = block.length;
    const nlen  = (~len) & 0xFFFF;
    out.push(last, len & 0xFF, (len >> 8) & 0xFF, nlen & 0xFF, (nlen >> 8) & 0xFF);
    out.push(...block);
    i = end;
  }
  // adler32
  let s1 = 1, s2 = 0;
  for (const b of data) { s1 = (s1 + b) % 65521; s2 = (s2 + s1) % 65521; }
  const a32 = (s2 << 16) | s1;
  out.push((a32 >>> 24) & 0xFF, (a32 >>> 16) & 0xFF, (a32 >>> 8) & 0xFF, a32 & 0xFF);
  return out;
}

function makeIcon(size) {
  const pixels = new Uint8Array(size * size * 3);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;

      // Zimbabwe flag stripes (vertical bands inside circle)
      const normX = x / size;
      let r, g, b;

      if (normX < 0.25) {
        // Green
        r = 0; g = 100; b = 0;
      } else if (normX < 0.5) {
        // Gold
        r = 255; g = 210; b = 0;
      } else if (normX < 0.75) {
        // Red
        r = 204; g = 0; b = 0;
      } else {
        // Black
        r = 0; g = 0; b = 0;
      }

      // Circular mask (outside circle = dark bg)
      const cx = x - size / 2, cy = y - size / 2;
      const radius = size / 2 - 2;
      if (cx * cx + cy * cy > radius * radius) {
        r = 8; g = 11; b = 16; // dark bg
      }

      // Inner circle background (dark)
      const innerR = size * 0.3;
      if (cx * cx + cy * cy < innerR * innerR) {
        r = 10; g = 10; b = 15;
      }

      pixels[i]     = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
    }
  }

  // Draw a simple microphone shape in the center
  const cx = Math.floor(size / 2), cy = Math.floor(size / 2);
  const micW = Math.max(2, Math.floor(size * 0.07));
  const micH = Math.max(4, Math.floor(size * 0.18));

  // Mic body (white/silver)
  for (let dy = -micH; dy < micH; dy++) {
    for (let dx = -micW; dx < micW; dx++) {
      const px = cx + dx, py = cy - Math.floor(size * 0.06) + dy;
      if (px >= 0 && px < size && py >= 0 && py < size) {
        // Ellipse shape for mic head
        if (dy < 0 && (dx * dx) / (micW * micW) + (dy * dy) / ((micH * 0.5) * (micH * 0.5)) <= 1) {
          const i = (py * size + px) * 3;
          pixels[i] = 220; pixels[i+1] = 220; pixels[i+2] = 220;
        }
        // Mic handle (thin rectangle below)
        if (dy >= 0 && Math.abs(dx) <= Math.max(1, micW * 0.4)) {
          const i = (py * size + px) * 3;
          pixels[i] = 160; pixels[i+1] = 160; pixels[i+2] = 160;
        }
      }
    }
  }

  return createPNG(size, size, pixels);
}

// Generate all sizes
const SIZES  = [72, 96, 128, 144, 152, 192, 384, 512];
const OUTDIR = path.join(__dirname, 'icons');

console.log('\n🎨 Creating placeholder PWA icons...\n');
SIZES.forEach(size => {
  const buf = makeIcon(size);
  const out = path.join(OUTDIR, `icon-${size}.png`);
  fs.writeFileSync(out, buf);
  console.log(`  ✅  icon-${size}.png  (${buf.length} bytes)`);
});
console.log('\n✨ Placeholder icons created!');
console.log('💡 To use your actual logo, copy it to icons/logo-source.png and run: node generate-icons.js\n');
