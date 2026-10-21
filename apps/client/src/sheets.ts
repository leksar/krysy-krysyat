// Спрайт-листы, сгенерированные Codex (tools/gen-assets/split-strip.mjs): крысы по семействам Мутаций и Люди.
// Лист — одна строка из n ячеек cw×ch; кадры режутся на текстуры с nearest-фильтром. Грузятся лениво, до загрузки
// отрисовка идёт старым процедурным способом (drawRat / пиксельные SpriteDef).
import { Assets, Rectangle, Texture } from 'pixi.js';

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
};

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
