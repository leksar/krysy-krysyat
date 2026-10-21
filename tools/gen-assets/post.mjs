#!/usr/bin/env node
// Пост-обработка сгенерированных картинок до пиксельной сетки.
// Требует sharp:  cd tools/gen-assets && npm install
//
//   node tools/gen-assets/post.mjs                      # все id из prompts.json, у которых есть raw/<id>.png
//   node tools/gen-assets/post.mjs --only bg_yard_far
//   node tools/gen-assets/post.mjs --chroma ff00ff      # снять ровный magenta-фон (для gpt-image-2 или если фон не прозрачный)
//   node tools/gen-assets/post.mjs --chroma ff00ff --chroma-tolerance 90 --alpha-threshold 128
//   node tools/gen-assets/post.mjs --kernel lanczos3    # переопределить фильтр даунскейла для всех
//   node tools/gen-assets/post.mjs --preview 4          # дополнительно сохранить увеличенную x4 копию (nearest) для просмотра
//   node tools/gen-assets/post.mjs --in <папка с png> --out <папка>   # обработать картинки, полученные из Codex CLI
//
// Шаги для каждого файла:
//   1) crop=cover: обрезка по центру до пропорций target (например 1536x1024 -> 1536x864 под 480x270)
//   2) даунскейл до target.w x target.h (nearest — для сеточного пиксель-арта, lanczos3 — для фонов)
//   3) --chroma: пиксели, близкие к ключевому цвету, становятся прозрачными. Ключ снимается ДО даунскейла
//      (в исходном разрешении), чтобы фильтр не подмешивал цвет фона в края; после даунскейла альфа
//      бинаризуется порогом 50% (--alpha-threshold, 0 — не бинаризовать)
//   4) квантование палитры до N цветов (png palette, без дизеринга)
// Вывод: <out>/<id>.png (и <out>/preview/<id>@Nx.png при --preview).

import { readFile, mkdir, access, readdir } from 'node:fs/promises';
import { dirname, resolve, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('Не найден модуль sharp. Выполните:  cd tools/gen-assets && npm install');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));

const promptsPath = resolve(args.prompts ?? join(here, 'prompts.json'));
const baseOut = resolve(args.out ?? join(here, '..', '..', 'assets', 'generated'));
const inDir = resolve(args.in ?? join(baseOut, 'raw'));
const outDir = args.in && !args.out ? join(inDir, 'processed') : baseOut;
const previewScale = args.preview ? Number(args.preview) : 0;
const chroma = args.chroma ? parseHex(String(args.chroma)) : null;
const chromaTol = Number(args['chroma-tolerance'] ?? 60); // евклидово расстояние в RGB
const alphaThreshold = Number(args['alpha-threshold'] ?? 128); // после даунскейла: alpha < порога -> 0, иначе 255
const only = args.only ? String(args.only).split(',').map((s) => s.trim()).filter(Boolean) : null;

const spec = JSON.parse(await readFile(promptsPath, 'utf8'));
const defaults = spec.defaults ?? {};
const byId = new Map((spec.items ?? []).map((it) => [it.id, it]));

// Список входных файлов: либо по prompts.json, либо всё, что лежит в --in
let files;
if (args.in) {
  files = (await readdir(inDir)).filter((f) => /\.(png|webp|jpe?g)$/i.test(f)).map((f) => join(inDir, f));
} else {
  files = [];
  for (const it of spec.items ?? []) {
    const p = join(inDir, `${it.id}.png`);
    if (await exists(p)) files.push(p);
  }
}
if (only) files = files.filter((f) => only.includes(stem(f)));
if (files.length === 0) {
  console.error('Нет входных файлов в', inDir);
  process.exit(2);
}

await mkdir(outDir, { recursive: true });
if (previewScale > 1) await mkdir(join(outDir, 'preview'), { recursive: true });

for (const file of files) {
  const id = stem(file);
  const it = byId.get(id) ?? byId.get(id.replace(/@.*$/, '')) ?? {};
  const target = pickTarget(it, args);
  const colors = Number(args.colors ?? it.colors ?? defaults.colors ?? 16);
  const kernel = String(args.kernel ?? it.kernel ?? defaults.kernel ?? 'nearest');
  const crop = args.crop ?? it.crop ?? null;

  try {
    let img = sharp(file).ensureAlpha();
    const meta = await img.metadata();

    if (target && crop === 'cover') {
      const ratio = target.w / target.h;
      let w = meta.width;
      let h = Math.round(w / ratio);
      if (h > meta.height) {
        h = meta.height;
        w = Math.round(h * ratio);
      }
      img = img.extract({ left: Math.floor((meta.width - w) / 2), top: Math.floor((meta.height - h) / 2), width: w, height: h });
    }

    // Хромакей: снимаем ключевой цвет в исходном разрешении, до даунскейла (иначе lanczos
    // подмешивает magenta в края и получается розовая кайма). sharp ресайзит с premultiplied alpha.
    if (chroma) {
      const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += info.channels) {
        const d = Math.hypot(data[i] - chroma[0], data[i + 1] - chroma[1], data[i + 2] - chroma[2]);
        if (d <= chromaTol) data[i + 3] = 0;
      }
      img = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    }

    if (target) {
      img = img.resize(target.w, target.h, { kernel: kernelOf(kernel), fit: 'fill' });
    }

    // Бинаризация альфы: пиксель-арту не нужны полупрозрачные края
    if (chroma && alphaThreshold > 0) {
      const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
      for (let i = 3; i < data.length; i += info.channels) data[i] = data[i] < alphaThreshold ? 0 : 255;
      img = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    }

    const outPath = join(outDir, `${id}.png`);
    await img
      .clone()
      .png({ palette: true, colours: clamp(colors, 2, 256), dither: 0, effort: 10, compressionLevel: 9 })
      .toFile(outPath);

    if (previewScale > 1 && target) {
      await sharp(outPath)
        .resize(target.w * previewScale, target.h * previewScale, { kernel: 'nearest' })
        .png()
        .toFile(join(outDir, 'preview', `${id}@${previewScale}x.png`));
    }

    console.log(`  + ${id}: ${meta.width}x${meta.height} -> ${target ? `${target.w}x${target.h}` : 'без ресайза'}, ${colors} цв., ${kernel}${chroma ? ', chroma' : ''} -> ${outPath}`);
  } catch (err) {
    console.error(`  ! ${id}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------

function pickTarget(it, a) {
  if (a.w && a.h) return { w: Number(a.w), h: Number(a.h) };
  if (it.target?.w && it.target?.h) return { w: it.target.w, h: it.target.h };
  return null;
}

function kernelOf(name) {
  const k = sharp.kernel ?? {};
  return k[name] ?? name;
}

function parseHex(s) {
  const h = s.replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`--chroma ожидает RRGGBB, получено "${s}"`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}

function stem(p) {
  return basename(p, extname(p));
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, inline] = a.slice(2).split('=', 2);
    if (inline !== undefined) out[k] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}
