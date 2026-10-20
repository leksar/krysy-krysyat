// Симуляция «Крысы крысят»: чистый TypeScript без DOM и Node-API.
// Один и тот же код гоняют клиент (предсказание своей Крысы) и сервер (авторитет).
// Контракт: никаких Math.random / Date.now / побочных эффектов внутри шага.

export const TILE = 16;
export const TICK_HZ = 60;
export const TICK = 1 / TICK_HZ;

export type Input = { seq: number; moveX: number; jump: boolean; jumpHeld: boolean; bite: boolean };
export const EMPTY_INPUT: Input = { seq: 0, moveX: 0, jump: false, jumpHeld: false, bite: false };

// Физика «Чёткая» из прототипа 010 (тикет 010).
export const PHYS = {
  speed: 95, accel: 1400, airAccel: 900,
  // полный прыжок ≈ 60 px (3.75 тайла), короткий тап ≈ 43 px (2.7 тайла) — уровни строим ступенями по 2 тайла
  jumpVel: 320, gravity: 850, fallGravity: 1250, cutGravity: 1800, maxFall: 320,
  coyote: 0.08, buffer: 0.1,
  biteRange: 14, biteKnockX: 160, biteKnockY: 140, biteCd: 0.3, biteDur: 0.12,
};

export type Rat = {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  facing: 1 | -1;
  grounded: boolean;
  coyoteLeft: number;
  bufferLeft: number;
  biteLeft: number;
  biteCd: number;
  lastSeq: number;   // последний применённый инпут (для reconciliation)
  hits: number;      // сколько раз укусили (отладка)
};

export const RAT_W = 14, RAT_H = 10;

export type Level = { cols: number; rows: number; solid: Uint8Array; spawn: { x: number; y: number } };

// «Двор» для прототипов: 60×17 тайлов. Платформы заданы списком [ряд, от, до] и расставлены так,
// что между соседними — подъём ≤2 тайла (тап) и просвет ≤2 тайла по горизонтали. Две «башни» по краям, спуск через середину.
const YARD_COLS = 60, YARD_ROWS = 17;
const YARD_PLATFORMS: [number, number, number][] = [
  // левая башня: ступеньками вверх от земли
  [14, 13, 15], [12, 9, 11], [10, 4, 7], [8, 9, 12], [6, 14, 17], [4, 19, 23],
  // спуск через середину
  [6, 26, 29], [8, 32, 35], [10, 38, 41], [12, 44, 47], [14, 50, 52],
  // правая башня
  [12, 55, 58], [10, 51, 54], [8, 56, 58], [6, 50, 53], [4, 44, 47],
  // мелочь у земли: одиночные бортики высотой 1 — перепрыгиваются тапом
  [15, 20, 20], [15, 31, 31], [15, 42, 42], [13, 24, 25], [13, 35, 36],
];

export function createLevel(): Level {
  const rows = YARD_ROWS, cols = YARD_COLS;
  const solid = new Uint8Array(rows * cols);
  for (let c = 0; c < cols; c++) { solid[c] = 1; solid[(rows - 1) * cols + c] = 1; }
  for (let r = 0; r < rows; r++) { solid[r * cols] = 1; solid[r * cols + cols - 1] = 1; }
  for (const [r, c0, c1] of YARD_PLATFORMS) for (let c = c0; c <= c1; c++) solid[r * cols + c] = 1;
  return { cols, rows, solid, spawn: { x: 2 * TILE, y: 14 * TILE } };
}

export function createRat(id: string, level: Level, slot = 0): Rat {
  return {
    id, x: level.spawn.x + slot * 20, y: level.spawn.y, vx: 0, vy: 0, facing: 1, grounded: false,
    coyoteLeft: 0, bufferLeft: 0, biteLeft: 0, biteCd: 0, lastSeq: 0, hits: 0,
  };
}

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

function approach(v: number, target: number, step: number): number {
  if (v < target) return Math.min(v + step, target);
  if (v > target) return Math.max(v - step, target);
  return v;
}

/** Один фиксированный шаг одной Крысы по её инпуту. Детерминирован. */
export function stepRat(l: Level, r: Rat, input: Input): void {
  const p = PHYS, dt = TICK;
  r.lastSeq = input.seq;

  const target = input.moveX * p.speed;
  r.vx = approach(r.vx, target, (r.grounded ? p.accel : p.airAccel) * dt);
  if (input.moveX > 0.2) r.facing = 1; else if (input.moveX < -0.2) r.facing = -1;

  r.coyoteLeft = r.grounded ? p.coyote : Math.max(0, r.coyoteLeft - dt);
  r.bufferLeft = input.jump ? p.buffer : Math.max(0, r.bufferLeft - dt);
  r.biteLeft = Math.max(0, r.biteLeft - dt);
  r.biteCd = Math.max(0, r.biteCd - dt);

  if (r.bufferLeft > 0 && (r.grounded || r.coyoteLeft > 0)) {
    r.vy = -p.jumpVel; r.grounded = false; r.coyoteLeft = 0; r.bufferLeft = 0;
  }

  let g = p.gravity;
  if (r.vy > 0) g = p.fallGravity; else if (!input.jumpHeld) g = p.cutGravity;
  r.vy = Math.min(r.vy + g * dt, p.maxFall);

  if (input.bite && r.biteCd === 0) { r.biteLeft = p.biteDur; r.biteCd = p.biteCd; }

  const nx = r.x + r.vx * dt;
  if (collides(l, nx, r.y, RAT_W, RAT_H)) {
    const dir = Math.sign(r.vx);
    while (dir !== 0 && !collides(l, r.x + dir, r.y, RAT_W, RAT_H)) r.x += dir;
    r.vx = 0;
  } else r.x = nx;

  const ny = r.y + r.vy * dt;
  r.grounded = false;
  if (collides(l, r.x, ny, RAT_W, RAT_H)) {
    const dir = Math.sign(r.vy);
    while (dir !== 0 && !collides(l, r.x, r.y + dir, RAT_W, RAT_H)) r.y += dir;
    if (dir > 0) r.grounded = true;
    r.vy = 0;
  } else r.y = ny;
}

/** Взаимодействие Крыс — только на сервере (клиент чужих не предсказывает). Укус отбрасывает. */
export function resolveBites(rats: Rat[]): void {
  for (const a of rats) {
    if (a.biteLeft < PHYS.biteDur - 0.001) continue; // срабатывает один раз, в первый тик укуса
    const mx = a.facing > 0 ? a.x + RAT_W + PHYS.biteRange / 2 : a.x - PHYS.biteRange / 2;
    const my = a.y + RAT_H / 2;
    for (const b of rats) {
      if (b === a) continue;
      if (Math.abs(b.x + RAT_W / 2 - mx) < PHYS.biteRange && Math.abs(b.y + RAT_H / 2 - my) < RAT_H + 4) {
        b.vx = a.facing * PHYS.biteKnockX;
        b.vy = -PHYS.biteKnockY;
        b.grounded = false;
        b.hits++;
      }
    }
  }
}

/** Снимок Крысы для сети (плоские числа). */
export type RatSnap = { id: string; x: number; y: number; vx: number; vy: number; f: 1 | -1; g: 0 | 1; b: number; cd: number; cl: number; bl: number; s: number; h: number };
export function snap(r: Rat): RatSnap {
  return { id: r.id, x: +r.x.toFixed(2), y: +r.y.toFixed(2), vx: +r.vx.toFixed(1), vy: +r.vy.toFixed(1), f: r.facing, g: r.grounded ? 1 : 0, b: +r.biteLeft.toFixed(3), cd: +r.biteCd.toFixed(3), cl: +r.coyoteLeft.toFixed(3), bl: +r.bufferLeft.toFixed(3), s: r.lastSeq, h: r.hits };
}
export function applySnap(r: Rat, s: RatSnap): void {
  r.x = s.x; r.y = s.y; r.vx = s.vx; r.vy = s.vy; r.facing = s.f; r.grounded = s.g === 1;
  r.biteLeft = s.b; r.biteCd = s.cd; r.coyoteLeft = s.cl; r.bufferLeft = s.bl; r.lastSeq = s.s; r.hits = s.h;
}
