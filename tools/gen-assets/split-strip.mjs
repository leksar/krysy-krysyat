#!/usr/bin/env node
// Режет сгенерированную «ленту» спрайтов (кадры в один ряд на ровном magenta-фоне) на кадры и
// собирает из них спрайт-лист фиксированной сетки для игры.
//
//   node tools/gen-assets/split-strip.mjs --in assets/generated/raw/rat_base_strip.png --out apps/client/public/sprites/rat_base.png \
//        --cell 32x16 --frames 6 [--chroma ff00ff] [--tol 70] [--fit height|width|both] [--scale 0.9] [--anchor bottom|center] [--preview 6]
//
// Шаги: 1) хромакей magenta → альфа (в исходном разрешении); 2) проекция непрозрачных пикселей на ось X,
// разрезы по пустым промежуткам (шире 1.5% ширины); если кусков больше, чем --frames, соседние мелкие сливаются;
// 3) каждый кусок обрезается по альфе, масштабируется lanczos так, чтобы влезть в ячейку (--fit, --scale),
// ставится в ячейку по --anchor; альфа бинаризуется; 4) лист сохраняется, опционально @Nx превью.
import { mkdir } from 'node:fs/promises';
import { dirname, resolve, join, basename } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, 'package.json'));
const sharp = require('sharp');

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const inPath = resolve(args.in); const outPath = resolve(args.out);
const [cellW, cellH] = String(args.cell ?? '32x16').split('x').map(Number);
const wantFrames = Number(args.frames ?? 0);
const chroma = parseHex(String(args.chroma ?? 'ff00ff')); const tol = Number(args.tol ?? 70);
const fit = String(args.fit ?? 'both'); const scaleK = Number(args.scale ?? 1); const anchor = String(args.anchor ?? 'bottom');
const preview = Number(args.preview ?? 0);
const dumpFrames = Boolean(args['dump-frames']);

const img = sharp(inPath).ensureAlpha();
const { width: W, height: H } = await img.metadata();
const buf = await img.raw().toBuffer();
// 1) хромакей
let opaque = 0;
for (let i = 0; i < W * H; i++) {
  const r = buf[i * 4], g = buf[i * 4 + 1], b = buf[i * 4 + 2];
  const d = Math.hypot(r - chroma[0], g - chroma[1], b - chroma[2]);
  if (d < tol) buf[i * 4 + 3] = 0; else opaque++;
}
if (!opaque) { console.error('после хромакея пусто — не тот ключ?'); process.exit(2); }
// 2) разрезы. Если известно число кадров — режем по самым пустым колонкам около ожидаемых границ ячеек
// (хвосты почти касаются соседа, поэтому искать чистые промежутки ненадёжно); иначе — по пустым промежуткам.
const colCnt = new Int32Array(W);
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (buf[(y * W + x) * 4 + 3]) colCnt[x]++;
let runs = [];
if (wantFrames) {
  const cellPx = W / wantFrames, win = Math.round(cellPx * 0.35);
  const cuts = [0];
  for (let i = 1; i < wantFrames; i++) {
    const c0 = Math.round(cellPx * i); let best = c0, bestScore = Infinity;
    for (let x = Math.max(1, c0 - win); x < Math.min(W - 1, c0 + win); x++) { const score = colCnt[x] * 1000 + Math.abs(x - c0); if (score < bestScore) { bestScore = score; best = x; } }
    cuts.push(best);
  }
  cuts.push(W);
  for (let i = 0; i < wantFrames; i++) runs.push([cuts[i], cuts[i + 1]]);
  console.log('разрезы:', cuts.slice(1, -1).map((x, i) => `${x}(${colCnt[x]}px)`).join(' '));
} else {
  const minGap = Math.max(3, Math.round(W * Number(args.gap ?? 0.003)));
  let start = -1, gap = 0;
  for (let x = 0; x <= W; x++) {
    const on = x < W && colCnt[x] > 0;
    if (on) { if (start < 0) start = x; gap = 0; }
    else if (start >= 0) { gap++; if (gap >= minGap || x === W) { runs.push([start, x - gap + (x === W && gap < minGap ? gap : 0)]); start = -1; gap = 0; } }
  }
  runs = runs.filter(([a, b]) => b - a > 2);
}
console.log(`кадров найдено: ${runs.length}${wantFrames ? ` (нужно ${wantFrames})` : ''}; ширины: ${runs.map(([a, b]) => b - a).join(', ')}`);
if (wantFrames && runs.length < wantFrames) console.warn('кадров меньше, чем ожидалось — проверь ленту глазами');

// 3) кадры → ячейки
const n = wantFrames || runs.length;
const sheet = Buffer.alloc(cellW * n * cellH * 4, 0);
// общий масштаб для всех кадров: по самому высокому (или широкому) кадру, чтобы крыса не прыгала в размере между кадрами
const boxes = runs.map(([x0, x1]) => bbox(buf, W, H, x0, x1));
const maxH = Math.max(...boxes.map((b) => b.h)), maxW = Math.max(...boxes.map((b) => b.w));
let k = Math.min(fit === 'height' ? Infinity : (cellW * scaleK) / maxW, fit === 'width' ? Infinity : (cellH * scaleK) / maxH);
const frames = [];
for (let i = 0; i < Math.min(n, runs.length); i++) {
  const b = boxes[i];
  const fw = Math.max(1, Math.round(b.w * k)), fh = Math.max(1, Math.round(b.h * k));
  const crop = await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).extract({ left: b.x, top: b.y, width: b.w, height: b.h })
    .resize(fw, fh, { kernel: 'lanczos3', fit: 'fill' }).raw().toBuffer();
  const ox = Math.floor((cellW - fw) / 2), oy = anchor === 'bottom' ? cellH - fh : Math.floor((cellH - fh) / 2);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const sx = x + ox + i * cellW, sy = y + oy; if (sx < i * cellW || sx >= (i + 1) * cellW || sy < 0 || sy >= cellH) continue;
    const si = (y * fw + x) * 4, di = (sy * cellW * n + sx) * 4; const a = crop[si + 3];
    if (a < 128) continue; sheet[di] = crop[si]; sheet[di + 1] = crop[si + 1]; sheet[di + 2] = crop[si + 2]; sheet[di + 3] = 255;
  }
  frames.push({ i, w: fw, h: fh });
}
await mkdir(dirname(outPath), { recursive: true });
await sharp(sheet, { raw: { width: cellW * n, height: cellH, channels: 4 } }).png({ palette: true, colors: 32, dither: 0 }).toFile(outPath);
console.log(`лист ${cellW * n}x${cellH} (${n} ячеек ${cellW}x${cellH}, масштаб ${k.toFixed(3)}): ${outPath}; кадры: ${frames.map((f) => `${f.w}x${f.h}`).join(', ')}`);
if (preview) {
  const pv = outPath.replace(/\.png$/, `@${preview}x.png`);
  await sharp(outPath).resize(cellW * n * preview, cellH * preview, { kernel: 'nearest' }).flatten({ background: '#555' }).png().toFile(pv);
  console.log('превью:', pv);
}
if (dumpFrames) for (const [i, [x0, x1]] of runs.entries()) await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).extract({ left: x0, top: 0, width: x1 - x0, height: H }).png().toFile(outPath.replace(/\.png$/, `.frame${i}.png`));

function bbox(buf, W, H, x0, x1) {
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) if (buf[(y * W + x) * 4 + 3]) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
function parseHex(s) { const h = s.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
