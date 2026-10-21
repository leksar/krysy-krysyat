// Пиксельные спрайты, нарисованные кодом: символьные карты → canvas → Pixi Texture.
// Временная графика до ассет-пака (тикет 002/016): единый стиль, без лицензий, рисуется за минуты.
import { Texture } from 'pixi.js';
import { KINDS } from '@krysy/sim';

const PAL: Record<string, string> = {
  '.': '', // прозрачный
  k: '#111111', w: '#f2efe9', // чёрный, белый
  g: '#c9c2b8', G: '#8d867c', // крыса: светлая/тёмная шерсть (тонируется цветом игрока)
  p: '#f0a0b0', // нос/уши/хвост
  s: '#e8b48c', S: '#b8805a', // кожа светлая/тень
  h: '#4a2e1c', H: '#8a5a2e', // волосы тёмные/рыжие
  b: '#3a4f8a', B: '#243357', // синяя одежда/тень
  r: '#b8352f', R: '#7a1f1b', // красная
  o: '#e07a1f', O: '#a8540f', // оранжевая (жилет)
  y: '#e8c84a', Y: '#b89a2a', // жёлтая
  n: '#5a5146', N: '#3a332c', // штаны/серое
  v: '#5e8a4a', V: '#3f6230', // зелёная
  c: '#8a8f99', C: '#5a5f69', // голубь
  m: '#d84a7a', // клюв/лапы голубя
  t: '#d99a3a', T: '#a06a1a', // кот рыжий
  e: '#7fd3ff', // блеск/вода
  d: '#6b4a2e', D: '#3c2a19', // дерево/грязь
  q: '#9a9a9a', Q: '#5c5c5c', // металл
};

export type SpriteDef = string[];
const cache = new Map<string, Texture>();

function draw(def: SpriteDef): HTMLCanvasElement {
  const h = def.length, w = Math.max(...def.map((r) => r.length));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  for (let y = 0; y < h; y++) for (let x = 0; x < def[y].length; x++) { const col = PAL[def[y][x]]; if (col) { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); } }
  return cv;
}
export function tex(name: string, def: SpriteDef): Texture {
  let t = cache.get(name);
  if (!t) { t = Texture.from(draw(def)); t.source.scaleMode = 'nearest'; cache.set(name, t); }
  return t;
}
const iconCache = new Map<string, string>();
/** Иконка предмета для DOM (HUD, итоги): спрайт типа, тонированный цветом вида. */
export function itemIcon(kind: string, scale = 2): string {
  const key = kind + ':' + scale; const hit = iconCache.get(key); if (hit) return hit;
  const k = KINDS[kind]; const def = ITEM[k?.type ?? 'trash']; const tint = ITEM_TINT[kind] ?? 0xffffff;
  const src = draw(def); const tctx = src.getContext('2d')!;
  tctx.globalCompositeOperation = 'multiply'; tctx.fillStyle = '#' + tint.toString(16).padStart(6, '0'); tctx.fillRect(0, 0, src.width, src.height);
  tctx.globalCompositeOperation = 'destination-in'; tctx.drawImage(draw(def), 0, 0);
  const cv = document.createElement('canvas'); cv.width = src.width * scale; cv.height = src.height * scale;
  const ctx = cv.getContext('2d')!; ctx.imageSmoothingEnabled = false; ctx.drawImage(src, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL(); iconCache.set(key, url); return url;
}
export function dataUrl(def: SpriteDef, scale = 2): string {
  const src = draw(def); const cv = document.createElement('canvas'); cv.width = src.width * scale; cv.height = src.height * scale;
  const ctx = cv.getContext('2d')!; ctx.imageSmoothingEnabled = false; ctx.drawImage(src, 0, 0, cv.width, cv.height); return cv.toDataURL();
}

// ---------- крыса 16×10 (смотрит вправо; тонируется цветом игрока) ----------
export const RAT: Record<string, SpriteDef> = {
  run1: [
    '................',
    '......ggggg.....',
    '....gggggggggg..',
    'p..ggggggggggggp',
    '.ppgggggGgGkgggg',
    '...ggggggggggggp',
    '....gGgGgGgGgg..',
    '.....GG..GG.G...',
    '....GG....GG....',
    '................',
  ],
  run2: [
    '................',
    '......ggggg.....',
    '....gggggggggg..',
    '.p.ggggggggggggp',
    'pppgggggGgGkgggg',
    '...ggggggggggggp',
    '....gGgGgGgGgg..',
    '......GG.GG.G...',
    '.....GG.....GG..',
    '................',
  ],
  idle: [
    '................',
    '......ggggg.....',
    '....gggggggggg..',
    '...ggggggggggggp',
    'pppgggggGgGkgggg',
    '...ggggggggggggp',
    '....gGgGgGgGgg..',
    '.....GG....GG...',
    '.....GG....GG...',
    '................',
  ],
  jump: [
    '................',
    '.....gggggg.....',
    '...ggggggggggg..',
    '..gggggggggggggp',
    'ppgggggggGgkgggg',
    '..ggggggggggggp.',
    '...gGgGgGgGgg...',
    '...GG.......GG..',
    '..GG.........GG.',
    '................',
  ],
  down: [
    '................',
    '................',
    '................',
    '................',
    '....gggggggg....',
    'pppgggggggggggp.',
    'GGgggggGgGgkgggg',
    '.GGGGGGGGGGGGGp.',
    '..G..G....G..G..',
    '................',
  ],
  dead: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....NNNNNNNN....',
    '..NNNNNNNNNNNNN.',
    '.NNNNNNNNNNNNNNN',
    '................',
    '................',
  ],
};

// ---------- люди ----------
const walk = (head: string[], torso: string[], legsA: string[], legsB: string[]) => ({ a: [...head, ...torso, ...legsA], b: [...head, ...torso, ...legsB] });
export const HUMANS: Record<string, { a: SpriteDef; b: SpriteDef }> = {
  // Прохожий 12×28: кепка, синяя куртка, серые штаны
  P: walk(
    ['....hhhh....', '...hhhhhh...', '...ssssss...', '...sksssk...', '...ssssss...', '....ssss....', '.....ss.....'],
    ['...bbbbbb...', '..bbbbbbbb..', '.sbbbbbbbbs.', '.sbbBbbBbbs.', '.sbbbbbbbbs.', '..bbbbbbbb..', '...BBBBBB...', '...nnnnnn...', '...nnnnnn...'],
    ['...nnn.nnn..', '...nnn.nnn..', '...nnn..nnn.', '...nnn..nnn.', '..nnn...nnn.', '..nnn....nnn', '..nnn....nnn', '..nnn....nnn', '..nnn....nnn', '..nnn....nnn', '.DDDD...DDDD', '.DDDD...DDDD'],
    ['...nnnnnn...', '...nnnnnn...', '...nnnnnn...', '....nnnn....', '....nnnn....', '....nnnn....', '....nnnn....', '....nnnn....', '....nnnn....', '....nnnn....', '...DDDDDD...', '...DDDDDD...']),
  // Дворник 12×28: оранжевый жилет, борода, метла отдельным спрайтом
  D: walk(
    ['....nnnn....', '...nnnnnn...', '...ssssss...', '...sksssk...', '...sSSSSs...', '....SSSS....', '.....SS.....'],
    ['...oooooo...', '..oobbbboo..', '.soobbbboos.', '.soobBbBoos.', '.soobbbboos.', '..oobbbboo..', '...OOOOOO...', '...nnnnnn...', '...nnnnnn...'],
    ['...nnn.nnn..', '...nnn.nnn..', '...nnn..nnn.', '...nnn..nnn.', '..nnn...nnn.', '..nnn....nnn', '..nnn....nnn', '..nnn....nnn', '..nnn....nnn', '..nnn....nnn', '.DDDD...DDDD', '.DDDD...DDDD'],
    ['...nnnnnn...', '...nnnnnn...', '...nnnnnn...', '....nnnn....', '....nnnn....', '....nnnn....', '....nnnn....', '....nnnn....', '....nnnn....', '....nnnn....', '...DDDDDD...', '...DDDDDD...']),
  // Ребёнок 10×18: рыжий, жёлтая футболка
  K: walk(
    ['...HHHH...', '..HHHHHH..', '..ssssss..', '..sksssk..', '..ssssss..', '...ssss...'],
    ['..yyyyyy..', '.syyyyyys.', '.syyYyyys.', '..yyyyyy..', '..YYYYYY..', '..bbbbbb..'],
    ['..bb..bb..', '..bb..bb..', '.bb....bb.', '.bb....bb.', '.DD....DD.', '.DD....DD.'],
    ['...bbbb...', '...bbbb...', '...bbbb...', '...bbbb...', '...DDDD...', '...DDDD...']),
  // Пьяный 14×20: сидит, бутылка
  Z: {
    a: ['....hhhh......', '...hhhhhh.....', '...ssssss.....', '...sSsssS.....', '...ssssss.....', '....ssss......', '..vvvvvvvv....', '.svvvvvvvvs...', '.svvVvvVvvs.v.', '.svvvvvvvvsvv.', '..vvvvvvvv.vv.', '..VVVVVVVV.vv.', '..nnnnnnnnnnnn', '..nnnnnnnnnnnn', '..nnn.....nnnn', '..nnn.....nnnn', '..nnn.....nnnn', '..nnn.....nnnn', '.DDDD....DDDDD', '.DDDD....DDDDD'],
    b: ['....hhhh......', '...hhhhhh.....', '...ssssss.....', '...sSsssS.....', '...ssssss.....', '....ssss......', '..vvvvvvvv....', '.svvvvvvvvs...', '.svvVvvVvvs.v.', '.svvvvvvvvsvv.', '..vvvvvvvv.vv.', '..VVVVVVVV.vv.', '..nnnnnnnnnnnn', '..nnnnnnnnnnnn', '..nnn.....nnnn', '..nnn.....nnnn', '..nnn.....nnnn', '..nnn.....nnnn', '.DDDD....DDDDD', '.DDDD....DDDDD'],
  },
};
export const BROOM: SpriteDef = ['..q', '..q', '..q', '..q', '..q', '..q', '..q', '..q', '..q', '..q', '.yyy', 'yyyy', 'yYYy', 'YYYY'];

// ---------- голубь 12×10 ----------
export const PIGEON: Record<string, SpriteDef> = {
  a: ['............', '.......cc...', '......cccck.', '..cccccccmm.', '.cCCCCCccc..', 'cCCCCCCCcc..', '.CCCCCCCc...', '...cccc.....', '....m.m.....', '....m.m.....'],
  b: ['..cccc......', '.cCCCCc.cc..', '..cCCCccccck', '...ccccccmm.', '....cccccc..', '....cccccc..', '....cccc....', '....m.m.....', '............', '............'],
};
// ---------- кот 22×14 ----------
export const CAT: Record<string, SpriteDef> = {
  a: ['..................t..', '.................tt..', 't...............ttt..', 'tt.............tTtt..', '.tt...tttttttttttttt.', '..tttttttttttttkttkt.', '...tttTttTttTttttttt.', '...tttttttttttttt.m..', '....ttttttttttttt....', '....tttt.....tttt....', '....ttt.......ttt....', '...ttt.........ttt...', '...TTT.........TTT...', '.....................'],
  b: ['..................t..', '.................tt..', '................ttt..', 't..............tTtt..', 'tt....tttttttttttttt.', '.tttttttttttttttkttkt', '...tttTttTttTttttttt.', '...tttttttttttttt.m..', '....ttttttttttttt....', '.....ttt....tttt.....', '......ttt....ttt.....', '.......ttt....ttt....', '.......TTT....TTT....', '.....................'],
};

// ---------- предметы 8×8: по типу, цвет по виду ----------
export const ITEM: Record<string, SpriteDef> = {
  food:  ['........', '..yyyy..', '.yYyyYy.', 'yyyyyyyy', 'yYyyyyYy', '.yyyyyy.', '..YYYY..', '........'],
  trash: ['........', '.qqqqqq.', '.qQqqQq.', '.qqqqqq.', '.qQqqQq.', '.qqqqqq.', '.QQQQQQ.', '........'],
  secr:  ['........', '...ee...', '..eeee..', '..eeee..', '.eeeeee.', '.eewwee.', '..eeee..', '........'],
  organ: ['........', '..rr.rr.', '.rrrrrrr', '.rrRrrrr', '..rrrrr.', '...rrr..', '....r...', '........'],
};
export const ITEM_TINT: Record<string, number> = {
  bread: 0xe0b060, bone: 0xf0e8d0, gum: 0xf080c0, donut: 0xe09070,
  butt: 0xd0c8a0, feather: 0xc0c0c8, ketchup: 0xd04040, mask: 0x90c0e0, battery: 0x60c060, cracker: 0xe04040,
  snot: 0xa0e070, sock: 0xa09080, kidsnot: 0xc0f0a0, drool: 0xa0d8ff,
  kidney: 0xa03030, lung: 0xc07070, tooth: 0xffffff, liver: 0x802020, heart: 0xe03050, carcass: 0xb08060,
};

// ---------- выходы 16×16 ----------
export const EXITS: Record<string, SpriteDef> = {
  '1': ['DDDD.DDDDDD.DDDD', 'DdDD.DdDDDd.DDdD', 'DDDD.DDDDDD.DDDD', 'DDDD........DDDD', 'DdDD........DDdD', 'DDDD..kkkk..DDDD', 'DDDD.kkkkkk.DDDD', 'DdDD.kkkkkk.DDdD', 'DDDD.kkkkkk.DDDD', 'DDDD..kkkk..DDDD', 'DdDD........DDdD', 'DDDD........DDDD', 'DDDD.DDDDDD.DDDD', 'DdDD.DdDDDd.DDdD', 'DDDD.DDDDDD.DDDD', 'DDDD.DDDDDD.DDDD'],
  '2': ['................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '....qqqqqqqq....', '..qqQQQQQQQQqq..', '.qQQkkQQQQkkQQq.', '.qQQQQQQQQQQQQq.', '.qqqqqqqqqqqqqq.', '................'],
  '3': ['......qqqq......', '.....qQQQQq.....', '.....qQkkQq.....', '.....qQkkQq.....', '.....qQkkQq.....', '.....qQkkQq.....', '.....qQkkQq.....', '.....qQkkQq.....', '.....qQkkQq.....', '.....qQkkQq.....', '....qQQkkQQq....', '...qQQkkkkQQq...', '...qQkkkkkkQq...', '...qQQQQQQQQq...', '....qqqqqqqq....', '................'],
  lock: ['................', '................', '................', '................', '.....yyyyyy.....', '....yy....yy....', '....yy....yy....', '...yyyyyyyyyy...', '...yyyyyyyyyy...', '...yyyykkyyyy...', '...yyyyykyyyyy..', '...yyyyyyyyyy...', '...yyyyyyyyyy...', '................', '................', '................'],
};
export const WATER: SpriteDef = ['................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '....eeeeeeee....', '..eeeeewweeeeee.', '.eeeeeeeeeeeeeee', '..eeeeeeeeeeee..', '................', '................'];

// ---------- тайлы 16×16: три варианта на карту; верхняя кромка подсвечивается отдельно ----------
export type TileTheme = { base: string; dark: string; light: string; top: string; bg: string; bgDeco: string };
export const THEMES: Record<string, TileTheme> = {
  yard:    { base: '#6e5538', dark: '#4e3a25', light: '#846846', top: '#8fa15a', bg: '#1b1713', bgDeco: '#2a231c' },
  kitchen: { base: '#7d8591', dark: '#5a6069', light: '#9aa3ad', top: '#b8c0c8', bg: '#14181d', bgDeco: '#1f262e' },
  roof:    { base: '#5f5b57', dark: '#3f3c39', light: '#78736e', top: '#8c8580', bg: '#101216', bgDeco: '#1a1e26' },
};

/** Рисует весь уровень в один canvas (≤ 1920×448) → одна текстура. */
export function drawLevel(cols: number, rows: number, solid: Uint8Array, theme: TileTheme): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = cols * 16; cv.height = rows * 16;
  const ctx = cv.getContext('2d')!;
  // фон: окна/кирпичи
  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = theme.bgDeco;
  for (let i = 0; i < cols * rows / 40; i++) { const x = (i * 97) % cv.width, y = (i * 53) % cv.height; ctx.fillRect(x, y, 10, 14); }
  const isSolid = (c: number, r: number) => c < 0 || r < 0 || c >= cols || r >= rows || solid[r * cols + c] === 1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!solid[r * cols + c]) continue;
    const x = c * 16, y = r * 16, v = (c * 7 + r * 13) % 3;
    ctx.fillStyle = theme.base; ctx.fillRect(x, y, 16, 16);
    ctx.fillStyle = theme.dark;
    if (v === 0) { ctx.fillRect(x + 2, y + 9, 5, 2); ctx.fillRect(x + 10, y + 3, 4, 2); }
    if (v === 1) { ctx.fillRect(x + 8, y + 10, 6, 2); ctx.fillRect(x + 1, y + 2, 3, 3); }
    if (v === 2) { ctx.fillRect(x + 4, y + 5, 2, 2); ctx.fillRect(x + 11, y + 11, 3, 3); }
    ctx.fillStyle = theme.light; ctx.fillRect(x, y, 1, 16); ctx.fillRect(x, y, 16, 1);
    ctx.fillStyle = theme.dark; ctx.fillRect(x + 15, y, 1, 16); ctx.fillRect(x, y + 15, 16, 1);
    if (!isSolid(c, r - 1)) { ctx.fillStyle = theme.top; ctx.fillRect(x, y, 16, 3); ctx.fillStyle = theme.light; ctx.fillRect(x, y + 3, 16, 1); }
  }
  return cv;
}
