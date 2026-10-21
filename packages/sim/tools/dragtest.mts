// Запуск: npx tsx packages/sim/tools/dragtest.mts
// Тест физики волочения: крыса тащит тяжёлое вправо через ступеньки в 1 и 2 тайла, одна (сила 1) и вдвоём (сила 2)
import { createWorld, addRat, stepWorld, stepRat, BASE_MODS, TILE, EMPTY_INPUT, type Input, type Level } from '../src/index.ts';

function flatLevel(steps: { col: number; up: number }[]): Level {
  const cols = 40, rows = 12; const solid = new Uint8Array(cols * rows);
  const set = (r: number, c: number) => { solid[r * cols + c] = 1; };
  for (let c = 0; c < cols; c++) { set(0, c); set(rows - 1, c); set(rows - 2, c); }
  for (let r = 0; r < rows; r++) { set(r, 0); set(r, cols - 1); }
  // ступеньки: с колонки col земля выше на up рядов до конца
  let h = 0;
  for (let c = 1; c < cols - 1; c++) { const st = steps.find((s) => s.col === c); if (st) h += st.up; for (let k = 1; k <= h; k++) set(rows - 2 - k, c); }
  return { cols, rows, solid, spawns: [{ x: 2 * TILE, y: 8 * TILE }], humans: [], perches: [], items: [], exits: [], water: [], cat: null };
}
function run(name: string, steps: { col: number; up: number }[], ratsN: number, strength: number) {
  const w = createWorld('yard', 1);
  w.level = flatLevel(steps); w.humans = []; w.items = []; w.pigeons = []; w.cat = null;
  const mods = { ...BASE_MODS, strength };
  const inputs = new Map<string, Input>();
  for (let i = 0; i < ratsN; i++) { const r = addRat(w, 'r' + i, 'R' + i, mods); r.x = (4 + i) * TILE; r.y = 8 * TILE; inputs.set(r.id, { ...EMPTY_INPUT, moveX: 1, actHeld: true, jump: false, jumpHeld: false }); }
  const it = { id: w.nextId++, kind: 'heart', x: 6 * TILE, y: 9 * TILE, vy: 0, vx: 0, grounded: false, marked: false, grab: [] as string[] };
  w.items.push(it as any);
  for (let t = 0; t < 60 * 20; t++) { for (const [id, inp] of inputs) { inp.seq = t; const r = w.rats.get(id)!; const blockedAhead = r.grounded && r.vx < 5; inp.jump = blockedAhead && t % 20 === 0; if (inp.jump) (inp as any).hold = t + 12; inp.jumpHeld = t < ((inp as any).hold ?? 0); stepRat(w.level, r, inp, [], 0, 0); } stepWorld(w, inputs); }
  const hi = w.items.find((i) => i.kind === 'heart'); for (const r of w.rats.values()) console.log('  rat', r.id, (r.x / TILE).toFixed(1), (r.y / TILE).toFixed(1), 'hp', r.hp, 'down', r.down, 'grab', r.grab, 'over', w.over, 'panic', w.panic);
  console.log(name.padEnd(44), 'heart col', hi ? (hi.x / TILE).toFixed(1) : '-', 'row', hi ? (hi.y / TILE).toFixed(1) : '-', 'grab', hi?.grab.length);
}
run('ступенька 1: одна крыса (сила 1)', [{ col: 14, up: 1 }], 1, 1);
run('ступенька 2: одна крыса (сила 1) — не должна', [{ col: 14, up: 2 }], 1, 1);
run('ступенька 2: две крысы (сила 1+1)', [{ col: 14, up: 2 }], 2, 1);
run('ступенька 2: одна жирная (сила 2)', [{ col: 14, up: 2 }], 1, 2);
run('лесенка 1+1+2: две крысы', [{ col: 12, up: 1 }, { col: 16, up: 1 }, { col: 22, up: 2 }], 2, 1);
