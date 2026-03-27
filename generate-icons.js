/**
 * Radio Revolution — Icon Generator
 * ───────────────────────────────────
 * Generates all required PWA icon sizes from your logo PNG.
 *
 * Usage:
 *   1. Place your logo as:  icons/logo-source.png  (512x512 or larger)
 *   2. Run:  node generate-icons.js
 *
 * Requirements:  npm install sharp
 */

const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');

const SOURCE = path.join(__dirname, 'icons', 'logo-source.png');
const OUTDIR = path.join(__dirname, 'icons');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

async function generate() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`\n❌  Source file not found: ${SOURCE}`);
    console.log('\nPlease copy your Radio Revolution logo PNG to:');
    console.log('   icons/logo-source.png\n');
    console.log('Then run:  node generate-icons.js\n');
    process.exit(1);
  }

  console.log('\n🎨 Generating Radio Revolution PWA Icons...\n');

  for (const size of SIZES) {
    const out = path.join(OUTDIR, `icon-${size}.png`);
    await sharp(SOURCE)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
      .png()
      .toFile(out);
    console.log(`  ✅  icon-${size}.png`);
  }

  // Also generate a white-background maskable version (for Android adaptive icons)
  const maskableOut = path.join(OUTDIR, 'icon-maskable-512.png');
  await sharp(SOURCE)
    .resize(420, 420, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 46, bottom: 46, left: 46, right: 46, background: { r: 0, g: 0, b: 0, alpha: 255 } })
    .png()
    .toFile(maskableOut);
  console.log('  ✅  icon-maskable-512.png (safe-zone padded)');

  console.log('\n✨ Done! All icons generated in icons/\n');
}

generate().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
