/**
 * Generates PWA icons from public/icon.svg
 * Outputs: public/icons/icon-192.png, public/icons/icon-512.png
 *
 * Run: node scripts/generate-pwa-icons.mjs
 */
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const svgPath = join(root, 'public', 'icon.svg');
const outDir = join(root, 'public', 'icons');

mkdirSync(outDir, { recursive: true });

// Read the SVG and replace the media-query adaptive colors with
// a fixed dark background + white foreground (standard app icon style)
const svgRaw = readFileSync(svgPath, 'utf8');
const svgFixed = svgRaw
  .replace(/<style>[\s\S]*?<\/style>/, '')
  .replace(/class="background"/g, 'fill="#1a0a2e"')
  .replace(/class="foreground"/g, 'fill="#ffffff"');

const sizes = [192, 512];

for (const size of sizes) {
  const outPath = join(outDir, `icon-${size}.png`);
  await sharp(Buffer.from(svgFixed))
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`✓ Generated ${outPath}`);
}

console.log('PWA icons generated successfully.');
