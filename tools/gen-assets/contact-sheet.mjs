// Contact sheet: processed previews (nearest-upscaled) + raw thumbnails, with labels.
// Usage: node contact-sheet.mjs <projectRoot> [batch]   (batch 1 = default sheet, batch 2 = kitchen/roof parallax -> contact-sheet-2.png)
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFile, access } from 'node:fs/promises';

const root = process.argv[2] ?? 'D:/web-apatia';
const require = createRequire(join(root, 'tools/gen-assets/package.json'));
const sharp = require('sharp');

const gen = join(root, 'assets/generated');
const spec = JSON.parse(await readFile(join(root, 'tools/gen-assets/prompts.json'), 'utf8'));
const batch = String(process.argv[3] ?? '1');
const batches = {
  '1': { ids: ['secretion_drop', 'secretion_puddle', 'secretion_smear', 'rat_jump_1', 'human_panic_1', 'bg_yard_far', 'bg_yard_mid', 'bg_yard_near'], out: 'contact-sheet.png', title: 'generated batch 1 (Codex CLI / gpt-image-2, chroma #FF00FF)' },
  '3': { ids: ['bg_nora_far', 'st_cauldron', 'st_potion_shelf', 'st_map_table', 'st_pockets_rack', 'st_pockets_rack.v1', 'st_tunnel_exit', 'st_construction', 'st_construction.v1', 'dec_rag_bed', 'dec_rag_bed.v1', 'dec_candles', 'dec_pickle_jar', 'dec_root_bundle', 'dec_root_bundle.v1'], out: 'contact-sheet-3.png', title: 'generated batch 3 — Nora hub: far layer + station/decor sprites (Codex CLI / gpt-image-2, chroma #FF00FF)' },
  '2': { ids: ['bg_kitchen_far', 'bg_kitchen_mid', 'bg_kitchen_near', 'bg_roof_far', 'bg_roof_mid', 'bg_roof_near'], out: 'contact-sheet-2.png', title: 'generated batch 2 — kitchen/roof parallax (Codex CLI / gpt-image-2, chroma #FF00FF)' },
};
if (!batches[batch]) { console.error('unknown batch', batch); process.exit(2); }
const ids = batches[batch].ids;

const PAD = 16, LABEL = 28, CELL_W = 480, CELL_H = 270 + LABEL + 8;
const checker = async (w, h) => {
  // 8px checkerboard so transparency is visible
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><pattern id="p" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#9a9a9a"/><rect x="8" y="8" width="8" height="8" fill="#9a9a9a"/><rect x="8" width="8" height="8" fill="#6e6e6e"/><rect y="8" width="8" height="8" fill="#6e6e6e"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
};
const label = (text, w) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${LABEL}"><rect width="100%" height="100%" fill="#202020"/><text x="6" y="19" font-family="Consolas, monospace" font-size="14" fill="#f0f0f0">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`)).png().toBuffer();

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

// Layout: 2 columns x 4 rows for processed; each cell shows the processed image scaled to fit 480x270 (nearest)
// For small sprites: show @Nx preview enlarged more, up to 8x, next to raw thumbnail.
const cells = [];
for (const id of ids) {
  const it = spec.items.find((i) => i.id === id.replace(/.v1$/, ''));
  const outP = join(gen, `${id}.png`);
  const rawP = join(gen, 'raw', `${id}.png`);
  if (!(await exists(outP))) { console.warn('missing', outP); continue; }
  const m = await sharp(outP).metadata();
  const isSmall = m.width <= 128;
  const bg = await checker(CELL_W, 270);
  const layers = [];
  if (isSmall && batch === '3') {
    // batch 3 layout: nearest-upscaled processed sprite on top, 1x copy bottom-left, raw thumbnail bottom-right
    const altP = join(gen, 'alt-lanczos', `${id}.png`);
    const hasAlt = await exists(altP);
    const n = hasAlt ? 2 : 1;
    const scale = Math.max(1, Math.min(8, Math.floor((CELL_W - 16 - 12 * (n - 1)) / (n * m.width)), Math.floor(160 / m.height)));
    const big = await sharp(outP).resize(m.width * scale, m.height * scale, { kernel: 'nearest' }).png().toBuffer();
    const x0 = Math.floor((CELL_W - (n * m.width * scale + 12 * (n - 1))) / 2);
    layers.push({ input: big, left: x0, top: Math.floor((166 - m.height * scale) / 2) });
    if (hasAlt) layers.push({ input: await sharp(altP).resize(m.width * scale, m.height * scale, { kernel: 'nearest' }).png().toBuffer(), left: x0 + m.width * scale + 12, top: Math.floor((166 - m.height * scale) / 2) });
    layers.push({ input: await sharp(outP).png().toBuffer(), left: 8, top: 270 - m.height - 8 });
    const raw = await sharp(rawP).resize({ height: 96, fit: 'inside' }).png().toBuffer();
    const rm = await sharp(raw).metadata();
    layers.push({ input: raw, left: CELL_W - rm.width - 8, top: 270 - rm.height - 4 });
    var txt = `${id} ${m.width}x${m.height}/${it.colors}c | nearest ${scale}x${hasAlt ? ` | lanczos ${scale}x` : ''} | 1x | raw`;
  } else if (isSmall) {
    // processed at 8x (nearest) on the left; raw downscaled to 200px on the right
    const scale = Math.max(1, Math.floor(Math.min(8, 260 / m.height, (CELL_W - 128 - 48 - m.width) / (2 * m.width))));
    const big = await sharp(outP).resize(m.width * scale, m.height * scale, { kernel: 'nearest' }).png().toBuffer();
    layers.push({ input: big, left: 8, top: Math.floor((270 - m.height * scale) / 2) });
    const raw = await sharp(rawP).resize({ height: 128, fit: "inside" }).png().toBuffer();
    const rm = await sharp(raw).metadata();
    layers.push({ input: raw, left: CELL_W - rm.width - 8, top: Math.floor((270 - rm.height) / 2) });
    // lanczos variant (alt-lanczos/) at the same scale, right of the nearest one
    const altP = join(gen, 'alt-lanczos', `${id}.png`);
    let x = 8 + m.width * scale + 12;
    if (await exists(altP)) {
      const alt = await sharp(altP).resize(m.width * scale, m.height * scale, { kernel: 'nearest' }).png().toBuffer();
      layers.push({ input: alt, left: x, top: Math.floor((270 - m.height * scale) / 2) });
      x += m.width * scale + 12;
    }
    // 1x copies so the user can see true size
    const one = await sharp(outP).png().toBuffer();
    layers.push({ input: one, left: x, top: 270 - m.height - 8 });
    var txt = `${id} ${m.width}x${m.height}/${it.colors}c | nearest ${scale}x | lanczos ${scale}x | 1x | raw`;
  } else {
    layers.push({ input: await sharp(outP).png().toBuffer(), left: 0, top: 0 });
    var txt = `${id}  ${m.width}x${m.height} (${it.colors} colors, ${it.kernel})`;
  }
  const img = await sharp(bg).composite(layers).png().toBuffer();
  const lab = await label(txt, CELL_W);
  const cell = await sharp({ create: { width: CELL_W, height: CELL_H, channels: 4, background: '#303030' } })
    .composite([{ input: lab, left: 0, top: 0 }, { input: img, left: 0, top: LABEL + 4 }]).png().toBuffer();
  cells.push(cell);
}

const cols = 2, rows = Math.ceil(cells.length / cols);
const W = PAD + cols * (CELL_W + PAD), H = PAD + rows * (CELL_H + PAD) + 30;
const title = await label(`Krysy krysyat — ${batches[batch].title} — ${new Date().toISOString().slice(0, 10)}`, W - 2 * PAD);
const comp = [{ input: title, left: PAD, top: 4 }];
cells.forEach((c, i) => comp.push({ input: c, left: PAD + (i % cols) * (CELL_W + PAD), top: 30 + PAD + Math.floor(i / cols) * (CELL_H + PAD) }));
const out = join(gen, batches[batch].out);
await sharp({ create: { width: W, height: H, channels: 4, background: '#181818' } }).composite(comp).png().toFile(out);
console.log('wrote', out, `${W}x${H}`);
