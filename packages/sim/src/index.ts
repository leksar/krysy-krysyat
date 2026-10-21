// Симуляция «Крысы крысят»: чистый TypeScript без DOM и Node-API.
// Клиент предсказывает только движение своей Крысы (stepRat); всё остальное (Люди, Голуби, предметы,
// Переполох, Выходы) считает сервер в stepWorld и рассылает снапшотами.
// Контракт: внутри шагов нет Math.random / Date.now — только world.rng.

export * from './gen.js';
import { MAPS, generateLevel } from './gen.js';

export const TILE = 16;
export const TICK_HZ = 60;
export const TICK = 1 / TICK_HZ;

// ---------- ввод ----------
export type Input = { seq: number; moveX: number; jump: boolean; jumpHeld: boolean; bite: boolean; act: boolean; actHeld: boolean };
export const EMPTY_INPUT: Input = { seq: 0, moveX: 0, jump: false, jumpHeld: false, bite: false, act: false, actHeld: false };

// ---------- физика (пресет «Чёткая», тикет 010) ----------
export const PHYS = {
  speed: 95, accel: 1400, airAccel: 900,
  jumpVel: 320, gravity: 850, fallGravity: 1250, cutGravity: 1800, maxFall: 320,
  coyote: 0.08, buffer: 0.1,
  biteRange: 18, biteKnockX: 160, biteKnockY: 140, biteCd: 0.3, biteDur: 0.12, biteDmg: 15,
  soloBite: 0.4, humanStun: 0.35, windup: 0.35, invTime: 0.6, stompDmg: 20, swingDmg: 20, peckDmg: 6, pigeonHp: 15,
};
export const RULES = {
  ratHp: 100, pockets: 6, downTime: 30, reviveTime: 3, reviveHp: 40,
  exitTime: { '1': 5, '2': 5, '3': 1 } as Record<ExitType, number>,
  panicPerSec: 0.25, panicHuman: 1, panicKid: 4, panicKillP: 8, panicKillD: 10, panicKillK: 25, panicKillZ: 5,
  thresholds: { pigeons: 30, cat: 60, flock: 85 },
  lukInfected: 2, lukOpenPanic: 70, // Люк: ≥2 Заражённых Людей (или Переполох как запасной путь)
  drinkTime: 1, markTime: 0.6, eatTime: 1.5, infStage: 30, contagion: 0.05, pusEvery: 15,
};

// ---------- предметы ----------
export type ItemType = 'food' | 'trash' | 'secr' | 'organ';
export type ItemKind = { name: string; type: ItemType; size: 1 | 2 | 3; icon: string };
export const KINDS: Record<string, ItemKind> = {
  bread:   { name: 'Корка хлеба',       type: 'food',  size: 1, icon: '🍞' },
  bone:    { name: 'Куриная косточка',  type: 'food',  size: 1, icon: '🍗' },
  gum:     { name: 'Жвачка',            type: 'food',  size: 1, icon: '🫧' },
  donut:   { name: 'Пончик',            type: 'food',  size: 1, icon: '🍩' },
  butt:    { name: 'Окурок',            type: 'trash', size: 1, icon: '🚬' },
  feather: { name: 'Перо голубя',       type: 'trash', size: 1, icon: '🪶' },
  ketchup: { name: 'Пакетик кетчупа',   type: 'trash', size: 1, icon: '🧃' },
  mask:    { name: 'Маска',             type: 'trash', size: 1, icon: '😷' },
  battery: { name: 'Батарейка',         type: 'trash', size: 1, icon: '🔋' },
  cracker: { name: 'Петарда',           type: 'trash', size: 1, icon: '🧨' },
  snot:    { name: 'Платок с соплями',  type: 'secr',  size: 1, icon: '🤧' },
  sock:    { name: 'Носок потный',      type: 'secr',  size: 1, icon: '🧦' },
  kidsnot: { name: 'Детские сопли',     type: 'secr',  size: 1, icon: '👶' },
  drool:   { name: 'Слюна Пьяного',     type: 'secr',  size: 1, icon: '💧' },
  kidney:  { name: 'Почка',             type: 'organ', size: 3, icon: '🫘' },
  lung:    { name: 'Лёгкое прокуренное', type: 'organ', size: 3, icon: '🫁' },
  tooth:   { name: 'Молочный зуб',      type: 'organ', size: 1, icon: '🦷' },
  liver:   { name: 'Печень',            type: 'organ', size: 3, icon: '🥩' },
  heart:   { name: 'Сердце',            type: 'organ', size: 3, icon: '🫀' },
  carcass: { name: 'Тушка голубя',      type: 'organ', size: 2, icon: '🍖' },
  pus:     { name: 'Гной',              type: 'secr',  size: 1, icon: '🟢' },
  tear:    { name: 'Слеза',             type: 'secr',  size: 1, icon: '💧' },
  brain:   { name: 'Мозг Ослабшего',    type: 'organ', size: 3, icon: '🧠' },
  bile:    { name: 'Жёлчный пузырь',    type: 'organ', size: 2, icon: '🟡' },
  kidheart:{ name: 'Сердце Ослабшего Ребёнка', type: 'organ', size: 2, icon: '💗' },
};
export type Item = { id: number; kind: string; x: number; y: number; vy: number; grounded: boolean; marked: boolean };

// ---------- сущности ----------
export type Body = { x: number; y: number; w: number; h: number; vx: number; vy: number; grounded: boolean };

export type Rat = Body & {
  id: string; name: string;
  facing: 1 | -1;
  coyoteLeft: number; bufferLeft: number; biteLeft: number; biteCd: number;
  lastSeq: number;
  hp: number; down: boolean; downLeft: number; dead: boolean; exited: boolean;
  pockets: string[];        // kinds
  revive: number;           // прогресс подъёма ЭТОЙ крысы (её поднимают)
  inv: number;              // неуязвимость после удара, с
  water: boolean;           // попила — готова поставить Метку
  act: number;              // прогресс длительного действия (пить/метить)
  exitProg: number;         // прогресс выхода
  banked: string[];         // вынесенное (после выхода)
  hits: number;
};
export const RAT_W = 14, RAT_H = 10;

export type HumanType = 'P' | 'D' | 'K' | 'Z';
export type HumanState = 'walk' | 'panic' | 'chase' | 'sleep' | 'stomp' | 'swing' | 'windup' | 'eat';
export type Human = Body & {
  id: number; type: HumanType; facing: 1 | -1; state: HumanState; hp: number;
  timer: number; cd: number; target: string | null; dropped: boolean;
  biters: { id: string; at: number }[];
  stun: number; wind: 'stomp' | 'swing' | null; after: HumanState;
  pcd: number; // кулдаун вклада в Переполох: один и тот же Человек не накручивает шкалу каждые 3 с
  inf: 0 | 1 | 2 | 3; infT: number; pusT: number; // Заражение: стадия, время в стадии, таймер Гноя
};
const HUMAN: Record<HumanType, { hp: number; w: number; h: number; speed: number; icon: string; name: string }> = {
  P: { hp: 80, w: 12, h: 28, speed: 40, icon: '🧍', name: 'Прохожий' },
  D: { hp: 120, w: 12, h: 28, speed: 55, icon: '🧹', name: 'Дворник' },
  K: { hp: 30,  w: 10, h: 18, speed: 60, icon: '🧒', name: 'Ребёнок' },
  Z: { hp: 60,  w: 14, h: 20, speed: 0,  icon: '🍺', name: 'Пьяный' },
};
export const HUMAN_INFO = HUMAN;

export type PigeonType = 'V' | 'F';
export type Pigeon = { id: number; type: PigeonType; x: number; y: number; vx: number; vy: number; state: 'perch' | 'fly' | 'dive' | 'hold' | 'attack' | 'flee'; hp: number; timer: number; target: string | null; carry: string | null; tx: number; ty: number };
export type Cat = Body & { id: number; hp: number; cd: number; alive: boolean };

export type ExitType = '1' | '2' | '3';
export type Exit = { type: ExitType; x: number; y: number; open: boolean; name: string };
export const EXIT_INFO: Record<ExitType, { name: string; icon: string }> = {
  '1': { name: 'Щель в заборе', icon: '🕳️' }, '2': { name: 'Люк', icon: '🕳️' }, '3': { name: 'Водосток', icon: '🚰' },
};

export type Level = {
  cols: number; rows: number; solid: Uint8Array; spawns: { x: number; y: number }[];
  humans: { type: HumanType; x: number; y: number }[]; perches: { x: number; y: number }[];
  items: { kind: string; x: number; y: number }[]; exits: Exit[]; water: { x: number; y: number }[]; cat: { x: number; y: number } | null;
};

export type Phase = 'lobby' | 'raid' | 'results';
export type Event = { k: string; x: number; y: number; a?: string; b?: string };
export type World = {
  map: string; level: Level; tick: number; rng: number;
  rats: Map<string, Rat>; humans: Human[]; pigeons: Pigeon[]; items: Item[]; cat: Cat | null;
  panic: number; stage: number; nextId: number; events: Event[]; over: boolean;
};

// ---------- RNG (xorshift32) ----------
export function rand(w: World): number { let x = w.rng | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; w.rng = x | 0; return ((x >>> 0) % 100000) / 100000; }
const ri = (w: World, n: number) => Math.floor(rand(w) * n);

// ---------- карта ----------
export function createWorld(map: string, seed: number): World {
  const def = MAPS[map] ?? MAPS[Object.keys(MAPS)[0]];
  const level = generateLevel(def.id, seed);
  const w: World = { map: def.id, level, tick: 0, rng: (seed | 0) || 1, rats: new Map(), humans: [], pigeons: [], items: [], cat: null, panic: 0, stage: 0, nextId: 1, events: [], over: false };
  for (const h of level.humans) w.humans.push(makeHuman(w, h.type, h.x, h.y));
  // предметы: случайный вид в пределах типа
  for (const it of level.items) {
    const pool = it.kind === 'heart' ? ['heart'] : KINDS[it.kind].type === 'food' ? ['bread', 'bone', 'gum', 'donut'] : ['butt', 'ketchup', 'mask', 'battery', 'cracker'];
    spawnItem(w, pool[ri(w, pool.length)], it.x + 2, it.y + 4);
  }
  for (let i = 0; i < Math.min(def.pigeons.V, level.perches.length); i++) spawnPigeon(w, 'V');
  for (let i = 0; i < Math.min(def.pigeons.F, level.perches.length); i++) spawnPigeon(w, 'F');
  return w;
}

function makeHuman(w: World, type: HumanType, x: number, y: number): Human {
  const d = HUMAN[type];
  return { id: w.nextId++, type, x: x + (16 - d.w) / 2, y: y + 16 - d.h, w: d.w, h: d.h, vx: 0, vy: 0, grounded: false, facing: 1, state: type === 'Z' ? 'sleep' : 'walk', hp: d.hp, timer: 0, cd: 0, target: null, dropped: false, biters: [], stun: 0, wind: null, after: 'walk', pcd: 0, inf: 0, infT: 0, pusT: 0 };
}
function spawnItem(w: World, kind: string, x: number, y: number): Item { const it = { id: w.nextId++, kind, x, y, vy: 0, grounded: false, marked: false }; w.items.push(it); return it; }
function spawnPigeon(w: World, type: PigeonType): Pigeon {
  const p = w.level.perches[ri(w, w.level.perches.length)] ?? { x: 100, y: 40 };
  const pg: Pigeon = { id: w.nextId++, type, x: p.x, y: p.y, vx: 0, vy: 0, state: 'perch', hp: PHYS.pigeonHp, timer: 6 + rand(w) * 8, target: null, carry: null, tx: p.x, ty: p.y };
  w.pigeons.push(pg); return pg;
}

export function addRat(w: World, id: string, name: string): Rat {
  const n = w.rats.size, sp = w.level.spawns;
  const s = sp[n % sp.length];
  const r: Rat = { id, name, x: s.x + 1 + Math.floor(n / sp.length) * 18, y: s.y - Math.floor(n / sp.length) * 12, w: RAT_W, h: RAT_H, vx: 0, vy: 0, grounded: false, facing: 1, coyoteLeft: 0, bufferLeft: 0, biteLeft: 0, biteCd: 0, lastSeq: 0, hp: RULES.ratHp, down: false, downLeft: 0, dead: false, exited: false, pockets: [], revive: 0, inv: 0, water: false, act: 0, exitProg: 0, banked: [], hits: 0 };
  w.rats.set(id, r); return r;
}

// ---------- коллизии ----------
export function isSolid(l: Level, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= l.cols || r >= l.rows) return true;
  return l.solid[r * l.cols + c] === 1;
}
function collides(l: Level, x: number, y: number, w: number, h: number): boolean {
  const c0 = Math.floor(x / TILE), c1 = Math.floor((x + w - 0.001) / TILE);
  const r0 = Math.floor(y / TILE), r1 = Math.floor((y + h - 0.001) / TILE);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (isSolid(l, c, r)) return true;
  return false;
}
/** Двигает тело по vx/vy с AABB против тайлов; выставляет grounded. Возвращает, упёрлось ли по X. */
function moveBody(l: Level, b: Body, dt: number): boolean {
  let blocked = false;
  const nx = b.x + b.vx * dt;
  if (collides(l, nx, b.y, b.w, b.h)) {
    const dir = Math.sign(b.vx);
    while (dir !== 0 && !collides(l, b.x + dir, b.y, b.w, b.h)) b.x += dir;
    b.vx = 0; blocked = true;
  } else b.x = nx;
  const ny = b.y + b.vy * dt;
  b.grounded = false;
  if (collides(l, b.x, ny, b.w, b.h)) {
    const dir = Math.sign(b.vy);
    while (dir !== 0 && !collides(l, b.x, b.y + dir, b.w, b.h)) b.y += dir;
    if (dir > 0) b.grounded = true;
    b.vy = 0;
  } else b.y = ny;
  return blocked;
}
function approach(v: number, target: number, step: number): number {
  if (v < target) return Math.min(v + step, target);
  if (v > target) return Math.max(v - step, target);
  return v;
}
const overlap = (a: Body, b: { x: number; y: number; w?: number; h?: number }, pad = 0) =>
  a.x < b.x + (b.w ?? 0) + pad && a.x + a.w + pad > b.x && a.y < b.y + (b.h ?? 0) + pad && a.y + a.h + pad > b.y;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const edgeAhead = (l: Level, b: Body, dir: number) => !isSolid(l, Math.floor((dir > 0 ? b.x + b.w + 2 : b.x - 2) / TILE), Math.floor((b.y + b.h + 2) / TILE));

// ---------- шаг Крысы (клиент предсказывает, сервер авторитетен) ----------
/** Крысы — твёрдые друг для друга: можно встать напарнику на спину и подсадить. others — остальные живые крысы. */
function collideRats(l: Level, r: Body, prevY: number, others: Body[]): void {
  for (const o of others) {
    if (o === r || !overlap(r, o)) continue;
    if (r.vy >= 0 && prevY + r.h <= o.y + 3) { r.y = o.y - r.h; r.vy = 0; r.grounded = true; }       // приземлилась сверху
    else if (r.vy < 0 && prevY >= o.y + o.h - 3) { r.y = o.y + o.h; r.vy = 0; }                        // стукнулась снизу
    else {                                                                                               // бок — вытолкнуть
      const px = r.x + r.w / 2 < o.x + o.w / 2 ? o.x - r.w : o.x + o.w;
      if (!collides(l, px, r.y, r.w, r.h)) { r.x = px; r.vx = 0; }
    }
  }
}

export function stepRat(l: Level, r: Rat, input: Input, others: Body[] = []): void {
  const p = PHYS, dt = TICK;
  r.lastSeq = input.seq;
  const prevY = r.y;
  if (r.down || r.dead || r.exited) { // лежит: не двигается, только падает
    r.vx = approach(r.vx, 0, p.accel * dt);
    r.vy = Math.min(r.vy + p.fallGravity * dt, p.maxFall);
    moveBody(l, r, dt); collideRats(l, r, prevY, others); r.biteLeft = 0; return;
  }
  const target = input.moveX * p.speed;
  r.vx = approach(r.vx, target, (r.grounded ? p.accel : p.airAccel) * dt);
  if (input.moveX > 0.2) r.facing = 1; else if (input.moveX < -0.2) r.facing = -1;
  r.coyoteLeft = r.grounded ? p.coyote : Math.max(0, r.coyoteLeft - dt);
  r.bufferLeft = input.jump ? p.buffer : Math.max(0, r.bufferLeft - dt);
  r.biteLeft = Math.max(0, r.biteLeft - dt);
  r.biteCd = Math.max(0, r.biteCd - dt);
  if (r.bufferLeft > 0 && (r.grounded || r.coyoteLeft > 0)) { r.vy = -p.jumpVel; r.grounded = false; r.coyoteLeft = 0; r.bufferLeft = 0; }
  let g = p.gravity;
  if (r.vy > 0) g = p.fallGravity; else if (!input.jumpHeld) g = p.cutGravity;
  r.vy = Math.min(r.vy + g * dt, p.maxFall);
  if (input.bite && r.biteCd === 0) { r.biteLeft = p.biteDur; r.biteCd = p.biteCd; }
  moveBody(l, r, dt);
  collideRats(l, r, prevY, others);
}

export function pocketsUsed(r: Rat): number { return r.pockets.reduce((s, k) => s + KINDS[k].size, 0); }
export function biteBox(r: Rat) { return { x: r.facing > 0 ? r.x + r.w : r.x - PHYS.biteRange, y: r.y - 4, w: PHYS.biteRange, h: r.h + 8 }; }

// ---------- шаг мира (только сервер) ----------
export function stepWorld(w: World, inputs: Map<string, Input>): void {
  const l = w.level, dt = TICK; w.tick++; w.events.length = 0;
  const alive = [...w.rats.values()].filter((r) => !r.dead && !r.exited);

  // --- укусы крыс по всему живому ---
  for (const a of alive) {
    if (a.down || a.biteLeft < PHYS.biteDur - 0.001) continue; // первый тик укуса
    const box = biteBox(a);
    for (const b of alive) if (b !== a && !b.down && overlap(b, box)) { b.vx = a.facing * PHYS.biteKnockX; b.vy = -PHYS.biteKnockY; b.grounded = false; b.hits++; }
    for (const h of w.humans) if (overlap(h, box)) biteHuman(w, h, a);
    for (const pg of w.pigeons) if (pg.hp > 0 && Math.abs(pg.x - (box.x + box.w / 2)) < 12 && Math.abs(pg.y - (box.y + box.h / 2)) < 12) bitePigeon(w, pg, a);
    if (w.cat && w.cat.alive && overlap(w.cat, box)) { w.cat.vx = a.facing * 200; w.cat.hp -= PHYS.biteDmg; ev(w, 'hit', w.cat.x, w.cat.y); }
  }

  // --- Люди ---
  for (const h of w.humans) {
    const d = HUMAN[h.type];
    h.cd = Math.max(0, h.cd - dt); h.timer = Math.max(0, h.timer - dt); h.stun = Math.max(0, h.stun - dt); h.pcd = Math.max(0, h.pcd - dt);
    h.biters = h.biters.filter((b) => w.tick - Number(b.at) < 3 * TICK_HZ);
    const near = nearestRat(alive, h, 12 * TILE);
    // Заражение: стадии по RULES.infStage с; Болеет — медленнее и роняет Гной; контакт заражает других
    if (h.inf > 0) {
      h.infT += dt;
      if (h.inf < 3 && h.infT >= RULES.infStage) { h.inf++; h.infT = 0; ev(w, h.inf === 2 ? 'sick' : 'weak', h.x, h.y, HUMAN[h.type].name); }
      if (h.inf >= 2) { h.pusT += dt; if (h.pusT >= RULES.pusEvery) { h.pusT = 0; dropFrom(w, h, [h.type === 'K' ? 'tear' : 'pus']); } }
      for (const o of w.humans) if (o !== h && o.inf === 0 && o.hp > 0 && overlap(h, o, 2) && rand(w) < RULES.contagion * dt) infect(w, o);
    }
    if (h.stun > 0) { h.vx = 0; }
    else if (h.state === 'eat') {
      h.vx = 0;
      if (h.timer === 0) h.state = 'walk';
    }
    else if (h.state === 'windup') {
      h.vx = 0;
      if (h.timer === 0) { if (h.wind === 'stomp') stomp(w, h, alive); else swing(w, h, alive); h.state = h.after; h.timer = h.after === 'chase' ? 4 : 2; h.wind = null; }
    }
    else if (h.state === 'sleep') { /* спит */ }
    else if (h.state === 'panic') {
      if (h.timer === 0) h.state = 'walk';
      else {
        const from = near ?? { x: h.x };
        h.facing = h.x < from.x ? -1 : 1;
        h.vx = h.facing * d.speed * 1.8;
        // зажат — замахивается ногой
        if (near && Math.abs(near.x - h.x) < 18 && h.cd === 0) windup(h, 'stomp', 'panic');
      }
    } else if (h.state === 'chase') {
      if (!near || h.timer === 0) { h.state = 'walk'; h.target = null; }
      else {
        h.facing = near.x > h.x ? 1 : -1;
        h.vx = h.facing * d.speed * 1.5;
        if (Math.abs(near.x + near.w / 2 - (h.x + h.w / 2)) < 24 && Math.abs(near.y - h.y) < 30 && h.cd === 0) windup(h, 'swing', 'chase');
      }
    } else { // walk
      if (h.vx === 0) h.vx = h.facing * d.speed;
      // Еда под ногами — остановиться и съесть (Меченая — заразиться)
      for (const it of w.items) {
        if (it.id < 0 || !it.grounded || KINDS[it.kind].type !== 'food') continue;
        if (Math.abs(it.x + 4 - (h.x + h.w / 2)) < 10 && Math.abs(it.y + 8 - (h.y + h.h)) < 6) {
          it.id = -1; h.state = 'eat'; h.timer = RULES.eatTime; h.vx = 0; ev(w, 'eat', h.x, h.y, it.marked ? 'marked' : '');
          if (it.marked && h.inf === 0) infect(w, h);
          break;
        }
      }
      if (near && Math.abs(near.y + near.h - (h.y + h.h)) < 40 && Math.abs(near.x - h.x) < (h.type === 'D' ? 8 : 5) * TILE) {
        if (h.type === 'D') { h.state = 'chase'; h.timer = 6; if (!h.dropped) { h.dropped = true; dropFrom(w, h, ['sock']); } }
        else {
          h.state = 'panic'; h.timer = h.type === 'K' ? 4 : 3;
          if (h.pcd === 0) { w.panic += h.type === 'K' ? RULES.panicKid : RULES.panicHuman; h.pcd = 15; }
          ev(w, h.type === 'K' ? 'scream' : 'panic', h.x, h.y);
          if (!h.dropped) { h.dropped = true; dropFrom(w, h, h.type === 'K' ? ['donut', 'kidsnot'] : ['bread', 'snot']); }
        }
      }
      // у края или стены — разворот
      if (h.grounded && (edgeAhead(l, h, h.facing) )) { h.facing = -h.facing as 1 | -1; h.vx = h.facing * d.speed; }
      if (h.type === 'K' && rand(w) < 0.004) { h.facing = -h.facing as 1 | -1; h.vx = h.facing * d.speed; }
    }
    if (h.inf >= 2) h.vx *= h.inf === 3 ? 0.4 : 0.6;
    h.vy = Math.min(h.vy + PHYS.fallGravity * dt, PHYS.maxFall);
    const blocked = moveBody(l, h, dt);
    if (blocked && h.state === 'walk') { h.facing = -h.facing as 1 | -1; h.vx = h.facing * d.speed; }
    if (blocked && h.state === 'panic' && near && Math.abs(near.x - h.x) < 24 && h.cd === 0) windup(h, 'stomp', 'panic');
  }
  w.humans = w.humans.filter((h) => h.hp > 0);

  // --- Голуби ---
  for (const pg of w.pigeons) {
    pg.timer = Math.max(0, pg.timer - dt);
    const speed = pg.type === 'V' ? 150 : 120;
    if (pg.state === 'perch') {
      if (pg.timer === 0) {
        const victim = pg.type === 'V' ? pickRat(w, alive.filter((r) => !r.down && r.pockets.length >= 2), pg, 14 * TILE) : pickRat(w, alive.filter((r) => !r.down), pg, 8 * TILE);
        if (victim) { pg.state = pg.type === 'V' ? 'dive' : 'attack'; pg.target = victim.id; pg.timer = 4; }
        else pg.timer = 4 + rand(w) * 6;
      }
    } else if (pg.state === 'dive' || pg.state === 'attack') {
      const t = pg.target ? w.rats.get(pg.target) : null;
      if (!t || t.dead || t.exited || pg.timer === 0) { toPerch(w, pg); }
      else {
        flyTo(pg, t.x + t.w / 2, t.y + t.h / 2, speed, dt);
        if (Math.abs(pg.x - (t.x + t.w / 2)) < 10 && Math.abs(pg.y - (t.y + t.h / 2)) < 10) {
          if (pg.type === 'V' && t.pockets.length) { pg.carry = t.pockets.pop()!; ev(w, 'steal', pg.x, pg.y, KINDS[pg.carry].icon); pg.state = 'hold'; pg.tx = clampX(w, pg.x + (rand(w) < 0.5 ? -1 : 1) * 6 * TILE); pg.ty = Math.max(24, pg.y - 3 * TILE); pg.timer = 8; }
          else if (pg.type === 'F') { damageRat(w, t, PHYS.peckDmg, alive); pg.vx = -pg.vx; toPerch(w, pg); pg.timer = 5; }
          else toPerch(w, pg);
        }
      }
    } else if (pg.state === 'hold') { // сидит с добычей — можно догнать
      flyTo(pg, pg.tx, pg.ty, 100, dt);
      if (pg.timer === 0) { pg.carry = null; toPerch(w, pg); }
    } else if (pg.state === 'flee' || pg.state === 'fly') {
      flyTo(pg, pg.tx, pg.ty, speed, dt);
      if (dist(pg, { x: pg.tx, y: pg.ty }) < 4) { pg.state = 'perch'; pg.timer = 3 + rand(w) * 6; }
    }
  }
  w.pigeons = w.pigeons.filter((p) => p.hp > 0);

  // --- Кот ---
  if (w.cat && w.cat.alive) {
    const c = w.cat; c.cd = Math.max(0, c.cd - dt);
    const t = nearestRat(alive.filter((r) => !r.down), c, 40 * TILE);
    if (t) { const dir = t.x > c.x ? 1 : -1; c.vx = approach(c.vx, dir * 120, 600 * dt); if (overlap(c, t, 2) && c.cd === 0) { damageRat(w, t, 40, alive); c.cd = 1.5; ev(w, 'cat', c.x, c.y); } }
    else c.vx = approach(c.vx, 0, 600 * dt);
    c.vy = Math.min(c.vy + PHYS.fallGravity * dt, PHYS.maxFall);
    const blocked = moveBody(l, c, dt);
    if (blocked && c.grounded) c.vy = -300;
    if (c.hp <= 0) { c.alive = false; ev(w, 'catdead', c.x, c.y); }
  }

  // --- предметы: падают, подбираются ---
  for (const it of w.items) {
    if (!it.grounded) { it.vy = Math.min(it.vy + PHYS.fallGravity * dt, PHYS.maxFall); const b: Body = { x: it.x, y: it.y, w: 8, h: 8, vx: 0, vy: it.vy, grounded: false }; moveBody(l, b, dt); it.y = b.y; it.grounded = b.grounded; if (b.grounded) it.vy = 0; }
  }
  for (const r of alive) {
    if (r.down) continue;
    for (const it of w.items) {
      if (it.id < 0) continue;
      const k = KINDS[it.kind];
      if (it.marked) continue; // Меченая еда — приманка, не подбираем
      if (overlap(r, { x: it.x, y: it.y, w: 8, h: 8 }, 2) && pocketsUsed(r) + k.size <= RULES.pockets) { r.pockets.push(it.kind); it.id = -1; ev(w, 'pick', it.x, it.y, k.icon); }
    }
  }
  w.items = w.items.filter((it) => it.id >= 0);

  // --- Крысы: лежание, подъём, Выход, выброс ---
  for (const r of alive) {
    const inp = inputs.get(r.id) ?? EMPTY_INPUT;
    r.inv = Math.max(0, r.inv - dt);
    if (r.down) {
      r.downLeft -= dt;
      if (r.downLeft <= 0) { r.dead = true; r.down = false; spill(w, r); ev(w, 'dead', r.x, r.y, r.name); }
      continue;
    }
    // подъём напарника
    let reviving = false;
    if (inp.actHeld) {
      for (const o of alive) if (o !== r && o.down && dist(o, r) < 22) { o.revive += dt; reviving = true; if (o.revive >= RULES.reviveTime) { o.down = false; o.hp = RULES.reviveHp; o.revive = 0; ev(w, 'revive', o.x, o.y, o.name); } }
    }
    // попить (у воды) / поставить Метку (у Еды на земле) — длительное действие
    let acting = false;
    if (!reviving && inp.actHeld) {
      if (!r.water) {
        for (const wt of l.water) if (overlap(r, { x: wt.x - 2, y: wt.y, w: 20, h: 16 })) { acting = true; r.act += dt / RULES.drinkTime; if (r.act >= 1) { r.water = true; r.act = 0; ev(w, 'drink', r.x, r.y); } break; }
      } else {
        for (const it of w.items) if (it.id >= 0 && it.grounded && !it.marked && KINDS[it.kind].type === 'food' && overlap(r, { x: it.x, y: it.y, w: 8, h: 8 }, 4)) { acting = true; r.act += dt / RULES.markTime; if (r.act >= 1) { it.marked = true; r.water = false; r.act = 0; ev(w, 'mark', it.x, it.y); } break; }
      }
    }
    if (!acting) r.act = 0;
    // выход
    let exiting = false;
    if (!reviving && !acting && inp.actHeld) {
      for (const e of l.exits) {
        if (!e.open || !overlap(r, { x: e.x - 4, y: e.y - 4, w: 24, h: 24 })) continue;
        if (e.type === '3' && r.pockets.some((k) => KINDS[k].size === 3)) { ev(w, 'nofit', r.x, r.y); continue; }
        exiting = true; r.exitProg += dt / RULES.exitTime[e.type];
        if (r.exitProg >= 1) { r.exited = true; r.banked = r.pockets.slice(); r.pockets = []; ev(w, 'exit', r.x, r.y, r.name); }
      }
    }
    if (!exiting) r.exitProg = 0;
    // выбросить последний предмет (тап по Действию без контекста)
    if (inp.act && !reviving && !exiting && !acting && r.pockets.length) { const k = r.pockets.pop()!; const it = spawnItem(w, k, r.x + (r.facing > 0 ? r.w + 2 : -10), r.y); it.vy = -80; }
  }

  // --- Переполох и пороги ---
  w.panic = Math.min(100, w.panic + RULES.panicPerSec * dt);
  const infected = w.humans.filter((h) => h.inf > 0).length;
  for (const e of l.exits) if (e.type === '2' && !e.open && (infected >= RULES.lukInfected || w.panic >= RULES.lukOpenPanic)) { e.open = true; ev(w, 'luk', e.x, e.y); }
  if (w.stage < 1 && w.panic >= RULES.thresholds.pigeons) { w.stage = 1; spawnPigeon(w, 'V'); spawnPigeon(w, 'F'); ev(w, 'stage', 0, 0, 'Голуби слетаются'); }
  if (w.stage < 2 && w.panic >= RULES.thresholds.cat) { w.stage = 2; const cp = l.cat ?? l.spawns[0]; w.cat = { id: w.nextId++, x: cp.x, y: cp.y - 8, w: 22, h: 14, vx: 0, vy: 0, grounded: false, hp: 200, cd: 2, alive: true }; ev(w, 'stage', 0, 0, 'Пришёл кот'); }
  if (w.stage < 3 && w.panic >= RULES.thresholds.flock) { w.stage = 3; for (let i = 0; i < 4; i++) spawnPigeon(w, 'F'); ev(w, 'stage', 0, 0, 'Стая голубей'); }

  // --- конец Вылазки ---
  const living = [...w.rats.values()].filter((r) => !r.dead && !r.exited);
  if (w.rats.size && (living.length === 0 || living.every((r) => r.down))) {
    for (const r of living) { r.dead = true; r.down = false; spill(w, r); }
    w.over = true;
  }
}

function ev(w: World, k: string, x: number, y: number, a?: string, b?: string) { w.events.push({ k, x, y, a, b }); }
function clampX(w: World, x: number) { return Math.max(TILE, Math.min((w.level.cols - 2) * TILE, x)); }
function nearestRat<T extends { x: number; y: number }>(rats: Rat[], from: T, maxD: number): Rat | null {
  let best: Rat | null = null, bd = maxD;
  for (const r of rats) { const d = dist(r, from); if (d < bd) { bd = d; best = r; } }
  return best;
}
function pickRat(w: World, rats: Rat[], from: { x: number; y: number }, maxD: number): Rat | null {
  const c = rats.filter((r) => dist(r, from) < maxD); return c.length ? c[ri(w, c.length)] : null;
}
function flyTo(pg: Pigeon, tx: number, ty: number, speed: number, dt: number) {
  const dx = tx - pg.x, dy = ty - pg.y, d = Math.hypot(dx, dy) || 1;
  pg.vx = (dx / d) * speed; pg.vy = (dy / d) * speed; pg.x += pg.vx * dt; pg.y += pg.vy * dt;
}
function toPerch(w: World, pg: Pigeon) { const p = w.level.perches[ri(w, w.level.perches.length)] ?? { x: pg.x, y: 40 }; pg.state = 'fly'; pg.tx = p.x; pg.ty = p.y; pg.target = null; pg.timer = 3; }
function dropFrom(w: World, h: Human, kinds: string[]) { for (const k of kinds) { const it = spawnItem(w, k, h.x + h.w / 2 - 4 + (rand(w) - 0.5) * 16, h.y + h.h - 10); it.vy = -60; } }
function damageRat(w: World, r: Rat, dmg: number, alive: Rat[]) {
  if (r.down || r.dead || r.inv > 0) return;
  r.inv = PHYS.invTime;
  r.hp -= dmg; ev(w, 'hurt', r.x, r.y, String(dmg));
  if (r.hp <= 0) { r.hp = 0; r.down = true; r.downLeft = RULES.downTime; r.revive = 0; ev(w, 'down', r.x, r.y, r.name); }
}
function windup(h: Human, kind: 'stomp' | 'swing', after: HumanState) { h.state = 'windup'; h.wind = kind; h.after = after; h.timer = PHYS.windup; h.cd = kind === 'stomp' ? 1.2 : 1.5; }
function stomp(w: World, h: Human, alive: Rat[]) { for (const r of alive) if (Math.abs(r.x - h.x) < 18 && Math.abs(r.y + r.h - (h.y + h.h)) < 12) { damageRat(w, r, PHYS.stompDmg, alive); r.vx = (r.x < h.x ? -1 : 1) * 140; r.vy = -100; } ev(w, 'stomp', h.x, h.y); }
function swing(w: World, h: Human, alive: Rat[]) { for (const r of alive) if (Math.abs(r.x + r.w / 2 - (h.x + h.w / 2)) < 28 && Math.abs(r.y - h.y) < 32) { damageRat(w, r, PHYS.swingDmg, alive); r.vx = h.facing * 180; r.vy = -120; } ev(w, 'swing', h.x, h.y); }
function biteHuman(w: World, h: Human, a: Rat) {
  if (!h.biters.some((b) => b.id === a.id)) h.biters.push({ id: a.id, at: w.tick });
  const pack = h.biters.length >= 2 || h.type === 'K' || h.type === 'Z' || h.inf === 3;
  const dmg = pack ? PHYS.biteDmg : PHYS.biteDmg * PHYS.soloBite;
  h.hp -= dmg; h.stun = PHYS.humanStun; h.vx = a.facing * 40; if (h.state === 'windup') { h.state = h.after; h.wind = null; }
  ev(w, 'hit', h.x, h.y, String(Math.round(dmg)), pack ? '' : 'weak');
  if (h.type === 'Z') { if (rand(w) < 0.3) dropFrom(w, h, ['drool']); }
  else if (h.state === 'walk' || h.state === 'sleep') { h.state = h.type === 'D' ? 'chase' : 'panic'; h.timer = 3; }
  if (h.hp <= 0) {
    const organ = h.inf === 3 ? (h.type === 'Z' ? 'bile' : h.type === 'K' ? 'kidheart' : 'brain') : h.type === 'P' ? (rand(w) < 0.2 ? 'heart' : 'kidney') : h.type === 'D' ? 'lung' : h.type === 'K' ? 'tooth' : 'liver';
    dropFrom(w, h, [organ]);
    w.panic += h.type === 'P' ? RULES.panicKillP : h.type === 'D' ? RULES.panicKillD : h.type === 'K' ? RULES.panicKillK : RULES.panicKillZ;
    ev(w, 'kill', h.x, h.y, HUMAN[h.type].name);
  }
}
function infect(w: World, h: Human) { h.inf = 1; h.infT = 0; h.pusT = 0; ev(w, 'infect', h.x, h.y, HUMAN[h.type].name); }
function bitePigeon(w: World, pg: Pigeon, a: Rat) {
  pg.hp -= PHYS.biteDmg; ev(w, 'hit', pg.x, pg.y, String(PHYS.biteDmg));
  if (pg.carry) { const it = spawnItem(w, pg.carry, pg.x, pg.y); it.vy = -40; pg.carry = null; }
  if (pg.hp <= 0) { spawnItem(w, 'feather', pg.x, pg.y); if (rand(w) < 0.25) spawnItem(w, 'carcass', pg.x + 6, pg.y); ev(w, 'pigeondead', pg.x, pg.y); }
  else { pg.state = 'flee'; pg.tx = clampX(w, pg.x + (a.facing) * 8 * TILE); pg.ty = Math.max(24, pg.y - 4 * TILE); pg.timer = 3; }
}
function spill(w: World, r: Rat) { let i = 0; for (const k of r.pockets) { const it = spawnItem(w, k, r.x + (i++ - 1) * 10, r.y - 4); it.vy = -80 - i * 10; } r.pockets = []; }

// ---------- снапшоты ----------
export type RatSnap = { id: string; n: string; x: number; y: number; vx: number; vy: number; f: 1 | -1; g: 0 | 1; b: number; cd: number; cl: number; bl: number; s: number; hp: number; dn: 0 | 1; dl: number; dd: 0 | 1; ex: 0 | 1; pk: string[]; rv: number; ep: number; bk: string[]; wt: 0 | 1; ac: number };
export type Snapshot = {
  tick: number; panic: number; rats: RatSnap[];
  hu: [number, HumanType, number, number, 1 | -1, HumanState, number, number][];
  pg: [number, PigeonType, number, number, string, string][];
  it: [number, string, number, number, 0 | 1][];
  ex: [ExitType, number, number, 0 | 1][];
  cat: [number, number, number, 0 | 1] | null;
};
export function snapRat(r: Rat): RatSnap {
  return { id: r.id, n: r.name, x: +r.x.toFixed(2), y: +r.y.toFixed(2), vx: +r.vx.toFixed(1), vy: +r.vy.toFixed(1), f: r.facing, g: r.grounded ? 1 : 0, b: +r.biteLeft.toFixed(3), cd: +r.biteCd.toFixed(3), cl: +r.coyoteLeft.toFixed(3), bl: +r.bufferLeft.toFixed(3), s: r.lastSeq, hp: Math.round(r.hp), dn: r.down ? 1 : 0, dl: +r.downLeft.toFixed(1), dd: r.dead ? 1 : 0, ex: r.exited ? 1 : 0, pk: r.pockets, rv: +r.revive.toFixed(2), ep: +r.exitProg.toFixed(2), bk: r.banked, wt: r.water ? 1 : 0, ac: +r.act.toFixed(2) };
}
export function applyRatSnap(r: Rat, s: RatSnap): void {
  r.x = s.x; r.y = s.y; r.vx = s.vx; r.vy = s.vy; r.facing = s.f; r.grounded = s.g === 1;
  r.biteLeft = s.b; r.biteCd = s.cd; r.coyoteLeft = s.cl; r.bufferLeft = s.bl; r.lastSeq = s.s;
  r.hp = s.hp; r.down = s.dn === 1; r.downLeft = s.dl; r.dead = s.dd === 1; r.exited = s.ex === 1; r.pockets = s.pk; r.revive = s.rv; r.exitProg = s.ep; r.banked = s.bk; r.name = s.n; r.water = s.wt === 1; r.act = s.ac;
}
export function snapWorld(w: World): Snapshot {
  return {
    tick: w.tick, panic: +w.panic.toFixed(1),
    rats: [...w.rats.values()].map(snapRat),
    hu: w.humans.map((h) => [h.id, h.type, Math.round(h.x), Math.round(h.y), h.facing, h.state, Math.round(h.hp), h.inf]),
    pg: w.pigeons.map((p) => [p.id, p.type, Math.round(p.x), Math.round(p.y), p.state, p.carry ?? '']),
    it: w.items.map((i) => [i.id, i.kind, Math.round(i.x), Math.round(i.y), i.marked ? 1 : 0]),
    ex: w.level.exits.map((e) => [e.type, e.x, e.y, e.open ? 1 : 0]),
    cat: w.cat && w.cat.alive ? [Math.round(w.cat.x), Math.round(w.cat.y), Math.sign(w.cat.vx) || 1, 1] : null,
  };
}
