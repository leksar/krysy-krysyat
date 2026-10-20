// ПРОТОТИП 010. Чистая симуляция без DOM — черновик будущего packages/sim.
// Фиксированный шаг, AABB против тайловой сетки, прыжок с coyote time / jump buffer.

export const TILE = 16;
export const TICK = 1 / 60;

export type Input = { moveX: number; jump: boolean; jumpHeld: boolean; bite: boolean };

export type Preset = {
  name: string;
  speed: number;      // px/s
  accel: number;      // px/s^2 на земле
  airAccel: number;
  jumpVel: number;    // px/s вверх
  gravity: number;    // px/s^2
  fallGravity: number;// px/s^2 при падении (тяжелее — «хрустче»)
  cutGravity: number; // px/s^2, когда отпустили прыжок рано
  maxFall: number;
  coyote: number;     // с
  buffer: number;     // с
};

export const PRESETS: Preset[] = [
  // высота прыжка ≈ jumpVel² / (2·gravity): везде ~3.3 тайла, различается «характер»
  { name: 'Чёткая', speed: 95, accel: 1400, airAccel: 900, jumpVel: 300, gravity: 850, fallGravity: 1250, cutGravity: 2200, maxFall: 320, coyote: 0.08, buffer: 0.1 },
  { name: 'Лёгкая', speed: 85, accel: 900, airAccel: 600, jumpVel: 250, gravity: 600, fallGravity: 800, cutGravity: 1400, maxFall: 260, coyote: 0.1, buffer: 0.12 },
  { name: 'Жирная', speed: 110, accel: 2000, airAccel: 1200, jumpVel: 380, gravity: 1400, fallGravity: 1900, cutGravity: 3200, maxFall: 420, coyote: 0.06, buffer: 0.08 },
];

export type Flags = { coyote: boolean; buffer: boolean; varJump: boolean };

export type Rat = {
  x: number; y: number; w: number; h: number;
  vx: number; vy: number;
  facing: 1 | -1;
  grounded: boolean;
  coyoteLeft: number;
  bufferLeft: number;
  biteLeft: number;   // с, пока активен укус
  biteCd: number;
  jumps: number;
};

export type World = {
  cols: number; rows: number;
  solid: Uint8Array;
  rat: Rat;
  tick: number;
};

const LEVEL = [
  '############################################################',
  '#..........................................................#',
  '#..........................................................#',
  '#..........................................................#',
  '#..............................#####.......................#',
  '#......................................................#####',
  '#..........####............................................#',
  '#.....................#####................##..............#',
  '#..........................................##..............#',
  '#...####......................###..........##......###.....#',
  '#..........................................##..............#',
  '#.........................#................##..............#',
  '#.......#####.............#.......#........................#',
  '#.........................#.......#.............#..........#',
  '#.........................#.......#.............#....###...#',
  '#.........................#.......#.............#..........#',
  '############################################################',
];

export function createWorld(): World {
  const rows = LEVEL.length, cols = LEVEL[0].length;
  const solid = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) solid[r * cols + c] = LEVEL[r][c] === '#' ? 1 : 0;
  return {
    cols, rows, solid, tick: 0,
    rat: { x: 3 * TILE, y: 14 * TILE, w: 14, h: 10, vx: 0, vy: 0, facing: 1, grounded: false, coyoteLeft: 0, bufferLeft: 0, biteLeft: 0, biteCd: 0, jumps: 0 },
  };
}

export function isSolid(w: World, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= w.cols || r >= w.rows) return true;
  return w.solid[r * w.cols + c] === 1;
}

function collides(w: World, x: number, y: number, bw: number, bh: number): boolean {
  const c0 = Math.floor(x / TILE), c1 = Math.floor((x + bw - 0.001) / TILE);
  const r0 = Math.floor(y / TILE), r1 = Math.floor((y + bh - 0.001) / TILE);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (isSolid(w, c, r)) return true;
  return false;
}

function approach(v: number, target: number, step: number): number {
  if (v < target) return Math.min(v + step, target);
  if (v > target) return Math.max(v - step, target);
  return v;
}

export function step(w: World, input: Input, p: Preset, f: Flags): void {
  const r = w.rat;
  const dt = TICK;
  w.tick++;

  // горизонталь
  const target = input.moveX * p.speed;
  r.vx = approach(r.vx, target, (r.grounded ? p.accel : p.airAccel) * dt);
  if (input.moveX > 0.2) r.facing = 1; else if (input.moveX < -0.2) r.facing = -1;

  // таймеры
  r.coyoteLeft = r.grounded ? p.coyote : Math.max(0, r.coyoteLeft - dt);
  if (input.jump) r.bufferLeft = f.buffer ? p.buffer : 0.0001; else r.bufferLeft = Math.max(0, r.bufferLeft - dt);
  r.biteLeft = Math.max(0, r.biteLeft - dt);
  r.biteCd = Math.max(0, r.biteCd - dt);

  // прыжок
  const canJump = r.grounded || (f.coyote && r.coyoteLeft > 0);
  if (r.bufferLeft > 0 && canJump) {
    r.vy = -p.jumpVel;
    r.grounded = false;
    r.coyoteLeft = 0;
    r.bufferLeft = 0;
    r.jumps++;
  }

  // гравитация
  let g = p.gravity;
  if (r.vy > 0) g = p.fallGravity;
  else if (f.varJump && !input.jumpHeld) g = p.cutGravity;
  r.vy = Math.min(r.vy + g * dt, p.maxFall);

  // укус
  if (input.bite && r.biteCd === 0) { r.biteLeft = 0.12; r.biteCd = 0.3; }

  // движение по X
  let nx = r.x + r.vx * dt;
  if (collides(w, nx, r.y, r.w, r.h)) {
    const dir = Math.sign(r.vx);
    while (!collides(w, r.x + dir, r.y, r.w, r.h)) r.x += dir;
    r.vx = 0;
  } else r.x = nx;

  // движение по Y
  let ny = r.y + r.vy * dt;
  r.grounded = false;
  if (collides(w, r.x, ny, r.w, r.h)) {
    const dir = Math.sign(r.vy);
    while (!collides(w, r.x, r.y + dir, r.w, r.h)) r.y += dir;
    if (dir > 0) r.grounded = true;
    r.vy = 0;
  } else r.y = ny;
}
