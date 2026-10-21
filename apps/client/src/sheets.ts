// Спрайт-листы, сгенерированные Codex (tools/gen-assets/split-strip.mjs): крысы по семействам Мутаций и Люди.
// Лист — одна строка из n ячеек cw×ch; кадры режутся на текстуры с nearest-фильтром. Грузятся лениво, до загрузки
// отрисовка идёт старым процедурным способом (drawRat / пиксельные SpriteDef).
import { Assets, Rectangle, Texture } from 'pixi.js';
import { setIconOverride } from './sprites';

export type Sheet = { frames: Texture[]; cw: number; ch: number };
type Def = { file: string; cw: number; ch: number; n: number };

export const RAT_FAMILIES = ['base', 'fat', 'rot', 'sweet', 'alive', 'acid', 'infect', 'loud', 'sticky'] as const;
export type RatFamily = (typeof RAT_FAMILIES)[number];
/** Кадры крысы: 0 стоит, 1–2 бег, 3 прыжок, 4 укус, 5 лежит. Лист 48×24 на кадр, в мире рисуется в масштабе 0.5. */
export const RAT_CELL = { cw: 48, ch: 24, n: 6, scale: 0.5 };
/** Кадры Людей: 0 стоит, 1–2 шаг, 3 паника/замах, 4 удар/плач/оглушён, 5 болеет. Пьяный: 0–1 спит, 2 просыпается, 3 машет бутылкой, 4 оглушён, 5 болеет. */
const DEFS: Record<string, Def> = {
  ...Object.fromEntries(RAT_FAMILIES.map((f) => [`rat_${f}`, { file: `sprites/rat_${f}.png`, ...RAT_CELL }])),
  human_P: { file: 'sprites/human_P.png', cw: 24, ch: 32, n: 6 },
  human_D: { file: 'sprites/human_D.png', cw: 24, ch: 32, n: 6 },
  human_K: { file: 'sprites/human_K.png', cw: 20, ch: 22, n: 6 },
  human_Z: { file: 'sprites/human_Z.png', cw: 28, ch: 24, n: 6 },
  /** Голуби: 0 сидит, 1–2 машет, 3 пикирует, 4 клюёт/дерётся, 5 с хлебом (V) / улетает (F). В мире масштаб 0.5. */
  pigeon_V: { file: 'sprites/pigeon_V.png', cw: 32, ch: 24, n: 6 },
  pigeon_F: { file: 'sprites/pigeon_F.png', cw: 32, ch: 24, n: 6 },
  /** Кот: 0 сидит, 1–2 крадётся, 3 прыжок, 4 удар лапой, 5 шипит. В мире масштаб 0.5. */
  cat: { file: 'sprites/cat.png', cw: 64, ch: 32, n: 6 },
  /** Иконки предметов 16×16 (в мире рисуются в 0.5): порядок — см. ITEM_INDEX */
  items_a: { file: 'sprites/items_a.png', cw: 16, ch: 16, n: 16 },
  items_b: { file: 'sprites/items_b.png', cw: 16, ch: 16, n: 9 },
};
export const ITEM_INDEX: Record<string, [string, number]> = {
  bread: ['items_a', 0], bone: ['items_a', 1], gum: ['items_a', 2], donut: ['items_a', 3], butt: ['items_a', 4], feather: ['items_a', 5], ketchup: ['items_a', 6], mask: ['items_a', 7],
  battery: ['items_a', 8], cracker: ['items_a', 9], snot: ['items_a', 10], sock: ['items_a', 11], kidsnot: ['items_a', 12], drool: ['items_a', 13], pus: ['items_a', 14], tear: ['items_a', 15],
  kidney: ['items_b', 0], lung: ['items_b', 1], tooth: ['items_b', 2], liver: ['items_b', 3], heart: ['items_b', 4], carcass: ['items_b', 5], brain: ['items_b', 6], bile: ['items_b', 7], kidheart: ['items_b', 8],
};
/** Кадр предмета из листа иконок (null, пока лист не загружен) */
export function itemFrame(kind: string): Texture | null { const ix = ITEM_INDEX[kind]; if (!ix) return null; const sh = sheet(ix[0]); return sh ? sh.frames[ix[1]] : null; }
const iconUrlCache = new Map<string, string>();
/** data-URL иконки предмета для HTML (карманы, чипы): вырезаем ячейку из листа без сглаживания */
function itemIconFromSheet(kind: string, scale: number): string | null {
  const ix = ITEM_INDEX[kind]; if (!ix) return null; const sh = loaded.get(ix[0]); if (!sh) return null;
  const key = kind + ':' + scale; const hit = iconUrlCache.get(key); if (hit) return hit;
  const res = sh.frames[0].source.resource as CanvasImageSource | undefined; if (!res) return null;
  const cv = document.createElement('canvas'); cv.width = sh.cw * scale; cv.height = sh.ch * scale;
  const ctx = cv.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  ctx.drawImage(res, ix[1] * sh.cw, 0, sh.cw, sh.ch, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL(); iconUrlCache.set(key, url); return url;
}
setIconOverride(itemIconFromSheet);

const loaded = new Map<string, Sheet>();
const pending = new Set<string>();
const failed = new Set<string>();

/** Лист по id; null, пока не загружен (загрузка стартует при первом обращении). */
export function sheet(id: string): Sheet | null {
  const s = loaded.get(id); if (s) return s;
  if (!pending.has(id) && !failed.has(id) && DEFS[id]) { pending.add(id); void load(id); }
  return null;
}
async function load(id: string) {
  const d = DEFS[id];
  try {
    const t: Texture = await Assets.load(`${import.meta.env.BASE_URL}${d.file}`);
    t.source.scaleMode = 'nearest';
    const frames: Texture[] = [];
    for (let i = 0; i < d.n; i++) frames.push(new Texture({ source: t.source, frame: new Rectangle(i * d.cw, 0, d.cw, d.ch) }));
    loaded.set(id, { frames, cw: d.cw, ch: d.ch });
  } catch (e) { failed.add(id); console.warn('лист не загрузился', id, e); }
  pending.delete(id);
}
export function preloadSheets() { for (const id of Object.keys(DEFS)) sheet(id); }

/** Кадр Человека по типу, состоянию, стадии Заражения и номеру кадра анимации */
export function humanFrame(type: string, state: string, inf: number, frame: number): number {
  const walk = 1 + (Math.floor(frame / 8) % 2), fast = 1 + (Math.floor(frame / 4) % 2);
  if (type === 'Z') {
    switch (state) {
      case 'sleep': return Math.floor(frame / 30) % 2;
      case 'swing': case 'stomp': case 'windup': case 'panic': return 3;
      default: return inf >= 2 ? 5 : 2;
    }
  }
  switch (state) {
    case 'sleep': return 0;
    case 'walk': return inf >= 2 && Math.floor(frame / 40) % 3 === 0 ? 5 : walk;
    case 'eat': return inf >= 2 ? 5 : 0;
    case 'panic': return type === 'D' ? fast : Math.floor(frame / 4) % 2 ? 3 : 1;
    case 'chase': return fast;
    case 'windup': return 3;
    case 'swing': case 'stomp': return type === 'D' || type === 'K' ? 4 : 3;
  }
  return 0;
}
