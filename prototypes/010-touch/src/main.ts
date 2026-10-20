// ПРОТОТИП 010 — выбрасываемый. Вопрос: приятно ли прыгать крысой на телефоне, какая физика и где кнопки.
import { Application, Container, Graphics, Text } from 'pixi.js';
import { createWorld, step, PRESETS, TILE, TICK, type Flags, type Preset } from './sim';
import { Touch, LAYOUTS, applyLayout } from './input';

const VIEW_W = 480, VIEW_H = 270;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const startEl = $('start'), hud = $('hud'), panel = $('panel');
const jumpEl = $('jump'), biteEl = $('bite');

let preset: Preset = PRESETS[0];
let layoutIdx = 0;
const flags: Flags = { coyote: true, buffer: true, varJump: true };

const world = createWorld();
const touch = new Touch($('joy'), $('knob'), jumpEl, biteEl);
applyLayout(LAYOUTS[0], jumpEl, biteEl);

// --- панель настроек ---
function renderPanel() {
  const presets = $('presets'); presets.innerHTML = '';
  PRESETS.forEach((p) => {
    const b = document.createElement('button'); b.textContent = p.name; b.className = p === preset ? 'sel' : '';
    b.onclick = () => { preset = p; renderPanel(); }; presets.appendChild(b);
  });
  const layouts = $('layouts'); layouts.innerHTML = '';
  LAYOUTS.forEach((l, i) => {
    const b = document.createElement('button'); b.textContent = l.name; b.className = i === layoutIdx ? 'sel' : '';
    b.onclick = () => { layoutIdx = i; applyLayout(l, jumpEl, biteEl); renderPanel(); }; layouts.appendChild(b);
  });
}
renderPanel();
$('gear').onclick = () => panel.classList.toggle('open');
$<HTMLInputElement>('coyote').onchange = (e) => (flags.coyote = (e.target as HTMLInputElement).checked);
$<HTMLInputElement>('buffer').onchange = (e) => (flags.buffer = (e.target as HTMLInputElement).checked);
$<HTMLInputElement>('varjump').onchange = (e) => (flags.varJump = (e.target as HTMLInputElement).checked);
$<HTMLInputElement>('joyFixed').onchange = (e) => {
  touch.fixedJoy = (e.target as HTMLInputElement).checked;
  $('joyBase').style.display = touch.fixedJoy ? 'block' : 'none';
};
// iOS Safari / встроенные браузеры (Telegram) не умеют Fullscreen API — подсказываем PWA
if (!document.fullscreenEnabled) $('iosHint').style.display = 'block';

// --- старт: один тап = fullscreen + поворот ---
startEl.addEventListener('pointerup', async () => {
  startEl.style.display = 'none';
  try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch {}
  try { await (screen.orientation as any).lock?.('landscape'); } catch {}
  try { await (navigator as any).wakeLock?.request('screen'); } catch {}
});

// --- рендер ---
const app = new Application();
await app.init({ canvas: $('game') as HTMLCanvasElement, resizeTo: window, background: '#1a1612', antialias: false, resolution: Math.min(2, devicePixelRatio || 1), autoDensity: true, roundPixels: true });

const stage = new Container();
app.stage.addChild(stage);
const level = new Graphics();
for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) {
  if (world.solid[r * world.cols + c]) level.rect(c * TILE, r * TILE, TILE, TILE).fill(r === 0 || r === world.rows - 1 || c === 0 || c === world.cols - 1 ? 0x4a3a2e : 0x7a5f45);
}
// фон: окна/кирпичи для ощущения скорости
const bg = new Graphics();
for (let i = 0; i < 40; i++) bg.rect(20 + i * 48, 30 + (i % 3) * 60, 18, 24).fill(0x24201b);
stage.addChild(bg, level);

const rat = new Container();
const body = new Graphics();
const biteFx = new Graphics();
rat.addChild(biteFx, body);
stage.addChild(rat);

function drawRat(facing: 1 | -1, grounded: boolean, biting: boolean, vy: number) {
  body.clear();
  const sq = grounded && !biting ? 0 : 1;
  // хвост
  body.moveTo(facing > 0 ? 0 : 14, 7).lineTo(facing > 0 ? -9 : 23, 4 + Math.sin(world.tick / 4) * 2).stroke({ width: 1.5, color: 0xc9a58a });
  // тело
  body.roundRect(0, 1 + sq, 14, 9 - sq, 4).fill(0x8f8378);
  // голова
  body.circle(facing > 0 ? 13 : 1, 4, 3.2).fill(0x9c8f84);
  body.circle(facing > 0 ? 15 : -1, 4, 0.9).fill(0xffb0c0);
  // ухо, глаз
  body.circle(facing > 0 ? 11 : 3, 1.5, 1.6).fill(0xd9a5a5);
  body.circle(facing > 0 ? 13.5 : 0.5, 3, 0.7).fill(0x111111);
  biteFx.clear();
  // дуга укуса — перед мордой, зеркально по направлению
  if (biting) {
    const cx = facing > 0 ? 19 : -5;
    const a0 = facing > 0 ? -1 : Math.PI - 1, a1 = facing > 0 ? 1 : Math.PI + 1;
    biteFx.arc(cx, 4, 6, a0, a1).stroke({ width: 2, color: 0xfff1b0 });
  }
}

const label = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 9, fill: 0xe8d9c0 } });
label.position.set(4, 4);
app.stage.addChild(label);

// --- цикл с фиксированным шагом ---
let acc = 0, last = performance.now();
let prevX = world.rat.x, prevY = world.rat.y;
app.ticker.add(() => {
  const now = performance.now();
  acc += Math.min(0.1, (now - last) / 1000); last = now;
  while (acc >= TICK) {
    prevX = world.rat.x; prevY = world.rat.y;
    step(world, touch.sample(), preset, flags);
    acc -= TICK;
  }
  const a = acc / TICK;
  const r = world.rat;
  const rx = prevX + (r.x - prevX) * a, ry = prevY + (r.y - prevY) * a;

  // дробный масштаб: на телефоне ~800×360 css-px целый ×1 делает крысу муравьём
  const scale = Math.max(1, Math.min(app.screen.width / VIEW_W, app.screen.height / VIEW_H));
  stage.scale.set(scale);
  const camX = Math.max(0, Math.min(world.cols * TILE - app.screen.width / scale, rx + r.w / 2 - app.screen.width / scale / 2));
  const camY = Math.max(0, Math.min(world.rows * TILE - app.screen.height / scale, ry + r.h / 2 - app.screen.height / scale / 2));
  stage.position.set(-Math.round(camX * scale), -Math.round(camY * scale));

  rat.position.set(Math.round(rx), Math.round(ry));
  drawRat(r.facing, r.grounded, r.biteLeft > 0, r.vy);

  hud.textContent = `${preset.name} · ${LAYOUTS[layoutIdx].name}\nvx ${r.vx.toFixed(0)} vy ${r.vy.toFixed(0)} ${r.grounded ? 'земля' : 'воздух'} coyote ${r.coyoteLeft.toFixed(2)} buf ${r.bufferLeft.toFixed(2)} прыжков ${r.jumps}\n${Math.round(app.ticker.FPS)} fps ×${scale.toFixed(2)}`;
});
