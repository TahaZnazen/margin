// Draws the Margin mark (a page edge, a margin rule and a highlighted line, in the P03 "Calm paper"
// colors) into public/icons: icon.svg plus PNGs. No image library: a tiny rasterizer and PNG
// encoder (zlib). Run `node scripts/generate-icons.mjs` after changing the mark; the output is committed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const out = join(dirname(fileURLToPath(import.meta.url)), "../public/icons");
mkdirSync(out, { recursive: true });

const BG = [0x2c, 0x5f, 0x5a]; // --accent
const FG = [0xf7, 0xf5, 0xf0]; // --bg
const HL = [0xe9, 0xc4, 0x6a]; // highlight yellow

// Shapes in a 100x100 box: [x, y, w, h, radius, color]
const SHAPES = [
  [26, 24, 5, 52, 2.5, FG], // the margin rule
  [38, 28, 36, 7, 3.5, FG], // text line
  [38, 46, 36, 12, 3, HL], // highlighted line
  [38, 69, 24, 7, 3.5, FG], // short line
];

function svg() {
  const rects = SHAPES.map(
    ([x, y, w, h, r, c]) =>
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="rgb(${c.join(",")})"/>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Margin</title><rect width="100" height="100" rx="22" fill="rgb(${BG.join(",")})"/>${rects}</svg>\n`;
}

function inRoundRect(px, py, [x, y, w, h, r]) {
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (
    (px - cx) ** 2 + (py - cy) ** 2 <= r * r && px >= x && px <= x + w && py >= y && py <= y + h
  );
}

/** `scale` < 1 shrinks the mark inside the safe zone (maskable icons); `rounded` draws the tile corners. */
function raster(size, { scale = 1, rounded = true } = {}) {
  const SS = 3;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const ux = ((i + (si + 0.5) / SS) / size) * 100;
          const uy = ((j + (sj + 0.5) / SS) / size) * 100;
          let color = null;
          if (!rounded || inRoundRect(ux, uy, [0, 0, 100, 100, 22])) color = BG;
          const mx = (ux - 50) / scale + 50;
          const my = (uy - 50) / scale + 50;
          for (const s of SHAPES) if (color && inRoundRect(mx, my, s)) color = s[5];
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 1;
          }
        }
      }
      const o = (j * size + i) * 4;
      const n = a || 1;
      px[o] = r / n;
      px[o + 1] = g / n;
      px[o + 2] = b / n;
      px[o + 3] = (255 * a) / (SS * SS);
    }
  }
  return png(size, px);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head[8] = 8; // bit depth
  head[9] = 6; // RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0;
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(join(out, "icon.svg"), svg());
writeFileSync(join(out, "icon-192.png"), raster(192));
writeFileSync(join(out, "icon-512.png"), raster(512));
writeFileSync(join(out, "icon-maskable-512.png"), raster(512, { scale: 0.8, rounded: false }));
writeFileSync(join(out, "apple-touch-icon.png"), raster(180, { rounded: false }));
console.log(`icons written to ${out}`);
