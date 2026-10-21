// Процедурный генератор карт: каждая Вылазка — новая карта из сида (как карты в PoE).
// Детерминирован: сервер и клиент строят одинаковый уровень из (тема, сид). Никакого Math.random.
// Гарантия: все Люди, предметы и Выходы стоят на клетках, достижимых со спавна прыжком ≤2 тайла (тап) / ≤3 (зажатый).
import type { Level, Exit, HumanType, ExitType } from './index.js';
import { TILE, EXIT_INFO } from './index.js';

export type ThemeId = 'yard' | 'kitchen' | 'roof';
export type MapDef = { id: ThemeId; name: string; desc: string; pigeons: { V: number; F: number } };
export const MAPS: Record<string, MapDef> = {
  yard: { id: 'yard', name: 'Двор', desc: 'Деревья, гаражи, дома с балконами, подвал. Базовая карта.', pigeons: { V: 1, F: 1 } },
  kitchen: { id: 'kitchen', name: 'Кухня', desc: 'Столы, полки, холодильники и шахта лифта. Много Еды, мало Голубей.', pigeons: { V: 1, F: 0 } },
  roof: { id: 'roof', name: 'Крыша', desc: 'Дома разной высоты, будки, антенны. Голуби и Мусор.', pigeons: { V: 2, F: 1 } },
};

const ROWS = 28;
const JUMP_UP = 3, JUMP_GAP = 3;

class G {
  cols: number; rows = ROWS; s: Uint8Array; rng: number;
  constructor(cols: number, seed: number) { this.cols = cols; this.s = new Uint8Array(cols * ROWS); this.rng = (seed | 0) || 1; }
  rand(): number { let x = this.rng | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rng = x | 0; return ((x >>> 0) % 100000) / 100000; }
  ri(n: number): number { return Math.floor(this.rand() * n); }
  pick<T>(a: T[]): T { return a[this.ri(a.length)]; }
  solid(r: number, c: number): boolean { return r < 0 || c < 0 || r >= this.rows || c >= this.cols || this.s[r * this.cols + c] === 1; }
  set(r: number, c: number, v = 1) { if (r >= 0 && c >= 0 && r < this.rows && c < this.cols) this.s[r * this.cols + c] = v; }
  box(r0: number, r1: number, c0: number, c1: number) { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.set(r, c); }
  ledge(r: number, c0: number, c1: number) { this.box(r, r, c0, c1); }
  wall(c: number, r0: number, r1: number) { this.box(r0, r1, c, c); }
  stand(r: number, c: number): boolean { return !this.solid(r, c) && this.solid(r + 1, c); }
  /** Достижимые стойки (крыса — 1 тайл). Та же модель, что в tools/mapgen.py. */
  reach(start: [number, number]): Set<number> {
    const key = (r: number, c: number) => r * this.cols + c;
    const fall = (r: number, c: number): [number, number] | null => { while (!this.stand(r, c) && !this.solid(r + 1, c) && r < this.rows - 2) r++; return this.stand(r, c) ? [r, c] : null; };
    const seen = new Set<number>(); const q: [number, number][] = [];
    const f0 = fall(start[0], start[1]); if (!f0) return seen;
    seen.add(key(...f0)); q.push(f0);
    while (q.length) {
      const [r, c] = q.shift()!;
      const cand: [number, number][] = [];
      for (const dc of [-1, 1]) if (!this.solid(r, c + dc)) cand.push([r, c + dc]);
      // прыжок вверх на up рядов, затем вбок: свободен должен быть ВЕСЬ путь (вертикаль над крысой и горизонталь на высоте апекса),
      // иначе проверка «прыгает сквозь стены» (баг первой версии: ловушка на спавне)
      for (let up = 1; up <= JUMP_UP; up++) {
        let blocked = false; for (let k = 1; k <= up; k++) if (this.solid(r - k, c)) { blocked = true; break; }
        if (blocked) break;
        const maxDx = up === 3 ? 2 : JUMP_GAP + 1; // на полную высоту далеко не улетишь
        for (const dir of [-1, 1]) for (let d = 1; d <= maxDx; d++) {
          const cc = c + dir * d; if (cc <= 0 || cc >= this.cols - 1) break;
          if (this.solid(r - up, cc)) break; // стена на высоте апекса — дальше не пролететь
          cand.push([r - up, cc]);
        }
        cand.push([r - up, c]);
      }
      // прыжок через просвет на том же уровне: дуга идёт на ряд выше, путь должен быть свободен
      for (const dir of [-1, 1]) for (let d = 1; d <= JUMP_GAP + 1; d++) {
        const cc = c + dir * d; if (cc <= 0 || cc >= this.cols - 1) break;
        if (this.solid(r - 1, cc) || this.solid(r, cc)) break;
        cand.push([r, cc]);
      }
      for (const [rr, cc] of cand) { const f = fall(rr, cc); if (f && !seen.has(key(...f))) { seen.add(key(...f)); q.push(f); } }
    }
    return seen;
  }
}

type Cell = { r: number; c: number };

export let lastGenAttempts = 0;
export function generateLevel(themeId: string, seed: number): Level {
  const theme = (MAPS[themeId] ? themeId : 'yard') as ThemeId;
  for (let attempt = 0; attempt < 40; attempt++) {
    const lvl = tryGenerate(theme, (seed + attempt * 7919) | 0);
    lastGenAttempts = attempt + 1;
    if (lvl) return lvl;
  }
  lastGenAttempts = -1;
  return tryGenerate(theme, 1, true)!;
}

function tryGenerate(theme: ThemeId, seed: number, force = false): Level | null {
  const g = new G(96 + (((seed >>> 0) % 5) * 10), seed);
  const cols = g.cols, G0 = ROWS - 5; // базовый ряд стояния
  // рамка
  g.box(0, 0, 0, cols - 1); g.box(ROWS - 1, ROWS - 1, 0, cols - 1); g.wall(0, 0, ROWS - 1); g.wall(cols - 1, 0, ROWS - 1);

  // --- рельеф: террасы по 6–14 колонок, перепады по 2 ряда, редкие ямы ---
  let h = 0, c = 1;
  const groundTop: number[] = new Array(cols).fill(G0); // ряд, на котором стоим над землёй
  const pits: number[] = [];
  while (c < cols - 1) {
    const w = 6 + g.ri(9);
    const end = Math.min(cols - 2, c + w - 1);
    if (c > 26 && end < cols - 14 && h === 0 && g.rand() < (theme === 'roof' ? 0.25 : 0.18)) {
      // яма шириной 2 (на крыше — провал между домами с карнизами внизу); не раньше 26-й колонки
      const pw = 2;
      for (let x = c; x < c + pw && x < cols - 2; x++) { groundTop[x] = ROWS - 2; pits.push(x); }
      c += pw; continue;
    }
    for (let x = c; x <= end; x++) groundTop[x] = G0 - h;
    const dh = g.pick([-2, 0, 0, 2]);
    h = Math.max(0, Math.min(theme === 'roof' ? 8 : 4, h + dh));
    c = end + 1;
  }
  for (let x = 1; x < cols - 1; x++) g.box(groundTop[x] + 1, ROWS - 2, x, x);
  // карнизы в ямах, чтобы падение было дорогой, а не смертью: ступенька у одного края
  for (const x of pits) { if (!pits.includes(x - 1)) g.ledge(ROWS - 4, x, x); if (!pits.includes(x + 1)) g.ledge(ROWS - 6, x, x); } // карнизы с обеих сторон — выбраться можно в любую сторону

  // --- структуры по теме ---
  const structs: ((anchorC: number) => void)[] = theme === 'yard' ? [
    (a) => tree(g, a, groundTop[a]), (a) => tree(g, a, groundTop[a]), (a) => garage(g, a, groundTop[a]), (a) => tower(g, a, groundTop[a], 'balcony'), (a) => bench(g, a, groundTop[a]), (a) => bins(g, a, groundTop[a]),
  ] : theme === 'kitchen' ? [
    (a) => table(g, a, groundTop[a]), (a) => shelves(g, a, groundTop[a]), (a) => fridge(g, a, groundTop[a]), (a) => tower(g, a, groundTop[a], 'lift'), (a) => table(g, a, groundTop[a]),
  ] : [
    (a) => hut(g, a, groundTop[a]), (a) => antenna(g, a, groundTop[a]), (a) => ventbox(g, a, groundTop[a]), (a) => tower(g, a, groundTop[a], 'escape'), (a) => ventbox(g, a, groundTop[a]),
  ];
  // стартовая зона (до 18-й колонки) свободна: первая структура не должна быть стеной у спавна
  const soft: ((anchorC: number) => void)[] = theme === 'yard' ? [(a) => bench(g, a, groundTop[a]), (a) => bins(g, a, groundTop[a])] : theme === 'kitchen' ? [(a) => table(g, a, groundTop[a])] : [(a) => ventbox(g, a, groundTop[a])];
  for (let x = 18; x < cols - 10; x += 9 + g.ri(8)) { if (pits.includes(x) || pits.includes(x + 3)) continue; (x < 36 ? g.pick(soft) : g.pick(structs))(x); }
  // случайные полки в воздухе (крыша — верёвки, кухня — полки)
  const airN = theme === 'kitchen' ? 14 : 10;
  for (let i = 0; i < airN; i++) { const r = 4 + g.ri(G0 - 8), cc = 14 + g.ri(cols - 22), w = 3 + g.ri(5); if (!g.solid(r, cc) && !g.solid(r - 1, cc)) g.ledge(r, cc, Math.min(cols - 3, cc + w)); }
  // подвал во Дворе: коридор под землёй с дырами
  if (theme === 'yard') {
    for (let x = 1; x < cols - 1; x++) { g.set(ROWS - 3, x, 0); g.set(ROWS - 2, x, 0); }
    for (let x = 1; x < cols - 1; x += 17) g.set(ROWS - 2, x);
    for (let x = 16; x < cols - 16; x += 24 + g.ri(14)) if (groundTop[x] === G0 && groundTop[x + 1] === G0) { g.set(G0 + 1, x, 0); g.set(G0 + 1, x + 1, 0); for (let r = G0 + 2; r < ROWS - 3; r++) { g.set(r, x, 0); g.set(r, x + 1, 0); } }
  }

  // --- достижимость ---
  const spawnC = 2; let spawnR = 1; while (!g.stand(spawnR, spawnC) && spawnR < ROWS - 2) spawnR++;
  const seen = g.reach([spawnR, spawnC]);
  const cells: Cell[] = []; for (const k of seen) cells.push({ r: Math.floor(k / cols), c: k % cols });
  if (cells.length < cols * 1.8 && !force) return null;
  const used = new Set<number>(); const key = (x: Cell) => x.r * cols + x.c;
  const take = (pred: (x: Cell) => boolean, minDist = 0, from: Cell[] = []): Cell | null => {
    const pool = cells.filter((x) => !used.has(key(x)) && pred(x) && from.every((f) => Math.abs(f.c - x.c) >= minDist));
    if (!pool.length) return null; const x = g.pick(pool); used.add(key(x)); return x;
  };
  const headroom = (x: Cell) => !g.solid(x.r - 1, x.c) && !g.solid(x.r - 2, x.c) && !g.solid(x.r - 1, x.c + 1) && !g.solid(x.r - 2, x.c + 1);
  const farFromSpawn = (x: Cell) => x.c > 10;
  const maxC = Math.max(...cells.map((x) => x.c)), minR = Math.min(...cells.map((x) => x.r));
  used.add(key({ r: spawnR, c: spawnC }));

  // Выходы: Щель — самая дальняя; Люк — самая высокая; Водосток — высокая в середине
  const exits: Exit[] = [];
  const e1 = take((x) => x.c >= maxC - 6); if (!e1 && !force) return null;
  const e2 = take((x) => x.r <= minR + 3 && x.c > 10, 8, e1 ? [e1] : []);
  const e3 = take((x) => x.r <= minR + 8 && x.c > cols * 0.3 && x.c < cols * 0.75, 8, [e1, e2].filter(Boolean) as Cell[]) ?? take((x) => x.r <= minR + 10 && x.c > 10, 6, [e1, e2].filter(Boolean) as Cell[]);
  for (const [t, cell] of [['1', e1], ['2', e2], ['3', e3]] as [ExitType, Cell | null][]) if (cell) exits.push({ type: t, x: cell.c * TILE, y: cell.r * TILE, open: t !== '2', name: EXIT_INFO[t].name });
  if (exits.length < 2 && !force) return null;

  // Люди
  const humans: { type: HumanType; x: number; y: number }[] = [];
  const counts: Record<HumanType, number> = theme === 'yard' ? { P: 6 + g.ri(3), D: 2, K: 2 + g.ri(2), Z: 2 } : theme === 'kitchen' ? { P: 7 + g.ri(3), D: 2, K: 2 + g.ri(2), Z: 2 } : { P: 4 + g.ri(2), D: 2, K: 1, Z: 2 };
  const placed: Cell[] = [];
  for (const t of ['D', 'P', 'K', 'Z'] as HumanType[]) for (let i = 0; i < counts[t]; i++) {
    const cell = take((x) => farFromSpawn(x) && headroom(x) && (t === 'Z' ? x.r < G0 : true), 5, placed) ?? take((x) => farFromSpawn(x) && headroom(x));
    if (cell) { humans.push({ type: t, x: cell.c * TILE, y: cell.r * TILE }); placed.push(cell); }
  }
  // Предметы
  const items: { kind: string; x: number; y: number }[] = [];
  const itemCounts = theme === 'yard' ? { f: 12, m: 14, o: 2 } : theme === 'kitchen' ? { f: 22, m: 8, o: 2 } : { f: 7, m: 20, o: 2 };
  for (const [k, n] of Object.entries(itemCounts)) for (let i = 0; i < n; i++) {
    const cell = take((x) => x.c > 4 && (k === 'o' ? x.r <= minR + 10 : true)) ?? take((x) => x.c > 4);
    if (cell) items.push({ kind: k === 'f' ? 'bread' : k === 'm' ? 'butt' : 'heart', x: cell.c * TILE, y: cell.r * TILE });
  }
  // вода, кот, насесты
  const water: { x: number; y: number }[] = [];
  for (let i = 0; i < 2; i++) { const cell = take((x) => x.r >= G0 - 4 && x.c > 6); if (cell) water.push({ x: cell.c * TILE, y: cell.r * TILE }); }
  const catCell = take((x) => x.c > cols * 0.6 && x.r >= G0 - 6) ?? e1;
  const perches: { x: number; y: number }[] = [];
  for (let i = 0; i < 6 + g.ri(4); i++) { const r = 2 + g.ri(8), cc = 4 + g.ri(cols - 8); if (!g.solid(r, cc)) perches.push({ x: cc * TILE + 8, y: r * TILE + 8 }); }

  return {
    cols, rows: ROWS, solid: g.s, spawns: [{ x: spawnC * TILE, y: spawnR * TILE }, { x: (spawnC + 1) * TILE, y: spawnR * TILE }, { x: (spawnC + 2) * TILE, y: spawnR * TILE }],
    humans, perches, items, exits, water, cat: catCell ? { x: catCell.c * TILE, y: catCell.r * TILE } : null,
  };
}

// ---------- структуры (anchor — колонка, top — ряд стояния на земле в этой колонке) ----------
function tree(g: G, a: number, top: number) {
  const h = 6 + g.ri(5);
  g.wall(a, top - h + 1, top); g.wall(a + 1, top - h + 1, top);
  // кроны с обеих сторон каждые 2 ряда, через уровень смещены наружу: тогда над одним концом кроны всегда свободно,
  // и подъём «вверх на 2, потом вбок на 2» проходит (ствол перекрывает проход — дерево обязано быть лазабельным)
  let k = 0;
  for (let r = top - 2; r > top - h; r -= 2, k++) { const o = k % 2 ? 2 : 0; g.ledge(r, a + 2 + o, a + 4 + o); g.ledge(r, a - 3 - o, a - 1 - o); }
  g.ledge(top - h, a - 2, a + 3);
}
function garage(g: G, a: number, top: number) {
  const w = 7 + g.ri(5), h = 5;
  g.box(top - h + 1, top, a, a + w);
  g.ledge(top - 1, a - 3, a - 2); g.ledge(top - 3, a - 2, a - 1);          // ящики
  if (g.rand() < 0.6) g.ledge(top - h - 2, a + 2, a + 5);                // труба над крышей
}
function tower(g: G, a: number, top: number, kind: 'balcony' | 'lift' | 'escape') {
  const h = 12 + g.ri(8), w = kind === 'lift' ? 1 : 2;
  g.box(top - h + 1, top - 2, a, a + w); // внизу — арка в 2 тайла: башня не перегораживает двор
  let k = 0;
  for (let r = top - 2; r > top - h; r -= 2, k++) { const o = k % 2 ? 2 : 0; g.ledge(r, a + w + 1 + o, a + w + 3 + o); g.ledge(r, a - 3 - o, a - 1 - o); }
  g.ledge(top - h, a - 1, a + w + 1);
}
function bench(g: G, a: number, top: number) { g.ledge(top - 1, a, a + 3); if (g.rand() < 0.5) g.box(top - 2, top, a + 6, a + 7); }
function bins(g: G, a: number, top: number) { g.box(top - 2, top, a, a + 2); g.box(top - 2, top, a + 4, a + 6); }
function table(g: G, a: number, top: number) { const w = 5 + g.ri(4); g.box(top - 1, top, a, a + w); g.ledge(top, a - 1, a - 1); if (g.rand() < 0.5) g.ledge(top - 4, a + 1, a + w - 1); }
function shelves(g: G, a: number, top: number) { let r = top - 2; let off = 0; for (let i = 0; i < 3 + g.ri(3); i++) { g.ledge(r, a + off, a + off + 3); r -= 2; off += g.pick([-3, 3]); } }
function fridge(g: G, a: number, top: number) { g.box(top - 5, top, a, a + 2); g.ledge(top - 1, a - 2, a - 2); g.ledge(top - 3, a - 3, a - 2); }
function hut(g: G, a: number, top: number) { const w = 4 + g.ri(3); g.box(top - 3, top, a, a + w); g.ledge(top - 1, a - 2, a - 1); g.ledge(top - 5, a + 1, a + 2); }
function antenna(g: G, a: number, top: number) { const h = 8 + g.ri(6); g.wall(a, top - h + 1, top); let k = 0; for (let r = top - 2; r > top - h; r -= 2, k++) { const o = k % 2 ? 2 : 0; g.ledge(r, a + 1 + o, a + 2 + o); g.ledge(r, a - 2 - o, a - 1 - o); } }
function ventbox(g: G, a: number, top: number) { g.box(top - 1, top, a, a + 1 + g.ri(2)); }
