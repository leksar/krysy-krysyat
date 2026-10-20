// ПРОТОТИП 011 — выбрасываемый. Вопрос: терпима ли задержка в онлайн-платформере
// при server-authoritative + предсказание своей Крысы + интерполяция чужих.
import { Application, Container, Graphics, Text } from 'pixi.js';
import { createLevel, createRat, stepRat, applySnap, TILE, TICK, RAT_W, RAT_H, type Input, type Rat, type RatSnap } from '@krysy/sim';
import { Touch } from './input';
import { Net, type Snapshot } from './net';

const VIEW_W = 480, VIEW_H = 270;
const INTERP_MS = 100;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// --- адрес сервера: ?server=… > VITE_SERVER_URL > localhost ---
const serverUrl = new URLSearchParams(location.search).get('server') ?? (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'ws://localhost:2567';

const level = createLevel();
const touch = new Touch($('joy'), $('knob'), $('jump'), $('bite'));
const net = new Net();
const flags = { predict: true, interp: true, ghost: false };

// --- состояние клиента ---
let me: Rat | null = null;                 // предсказанная своя Крыса
let myId = '';
const names: Record<string, string> = {};
const others = new Map<string, Snapshot[]>(); // буферы снапшотов чужих
let lastServerMe: RatSnap | null = null;
let pendingInputs: Input[] = [];
let seq = 0;
let corrections = 0, lastCorr = 0, snapsIn = 0;

net.on('status', (t) => ($('status').textContent = t));
net.on('welcome', (id, ns) => { myId = id; Object.assign(names, ns); me = createRat(id, level); });
net.on('join', (id, name) => { names[id] = name; });
net.on('leave', (id) => { others.delete(id); delete names[id]; });
net.on('snapshot', (s) => {
  snapsIn++;
  for (const rs of s.rats) {
    if (rs.id === myId) { lastServerMe = rs; reconcile(rs); continue; }
    const buf = others.get(rs.id) ?? [];
    buf.push({ tick: s.tick, rats: [rs], at: s.at });
    while (buf.length > 20) buf.shift();
    others.set(rs.id, buf);
  }
});

/** Reconciliation (Gambetta II): берём серверное состояние, переигрываем неподтверждённые инпуты. */
function reconcile(rs: RatSnap) {
  if (!me) return;
  if (!flags.predict) { applySnap(me, rs); pendingInputs = []; return; }
  const before = { x: me.x, y: me.y };
  applySnap(me, rs);
  pendingInputs = pendingInputs.filter((i) => i.seq > rs.s);
  for (const i of pendingInputs) stepRat(level, me, i);
  const err = Math.hypot(me.x - before.x, me.y - before.y);
  if (err > 0.5) { corrections++; lastCorr = err; }
}

// --- панель ---
$('gear').onclick = () => $('panel').classList.toggle('open');
$<HTMLInputElement>('predict').onchange = (e) => (flags.predict = (e.target as HTMLInputElement).checked);
$<HTMLInputElement>('interp').onchange = (e) => (flags.interp = (e.target as HTMLInputElement).checked);
$<HTMLInputElement>('ghost').onchange = (e) => (flags.ghost = (e.target as HTMLInputElement).checked);
$<HTMLInputElement>('lag').oninput = (e) => { net.lagMs = Number((e.target as HTMLInputElement).value); $('lagV').textContent = String(net.lagMs); };

// --- Safari: зум ---
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => { const n = Date.now(); if (n - lastTouchEnd < 350) e.preventDefault(); lastTouchEnd = n; }, { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

// --- старт ---
const nameEl = $<HTMLInputElement>('name');
nameEl.value = localStorage.getItem('ratName') ?? '';
$('go').addEventListener('click', async () => {
  const name = nameEl.value.trim() || 'крыса';
  localStorage.setItem('ratName', name);
  net.connect(serverUrl, name);
  $('start').style.display = 'none';
  try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch {}
  try { await (screen.orientation as any).lock?.('landscape'); } catch {}
  try { await (navigator as any).wakeLock?.request('screen'); } catch {}
});

// --- рендер ---
const app = new Application();
await app.init({ canvas: $('game') as HTMLCanvasElement, resizeTo: window, background: '#1a1612', antialias: false, resolution: Math.min(2, devicePixelRatio || 1), autoDensity: true, roundPixels: true });
const stage = new Container(); app.stage.addChild(stage);
const lvl = new Graphics();
for (let r = 0; r < level.rows; r++) for (let c = 0; c < level.cols; c++) if (level.solid[r * level.cols + c])
  lvl.rect(c * TILE, r * TILE, TILE, TILE).fill(r === 0 || r === level.rows - 1 || c === 0 || c === level.cols - 1 ? 0x4a3a2e : 0x7a5f45);
const bg = new Graphics(); for (let i = 0; i < 40; i++) bg.rect(20 + i * 48, 30 + (i % 3) * 60, 18, 24).fill(0x24201b);
stage.addChild(bg, lvl);

type View = { c: Container; body: Graphics; fx: Graphics; label: Text };
const views = new Map<string, View>();
const ghost = new Graphics(); stage.addChild(ghost);
function view(id: string): View {
  let v = views.get(id);
  if (!v) {
    const c = new Container(), body = new Graphics(), fx = new Graphics();
    const label = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 7, fill: 0xe8d9c0 } });
    label.anchor.set(0.5, 1); label.position.set(RAT_W / 2, -2);
    c.addChild(fx, body, label); stage.addChild(c);
    v = { c, body, fx, label }; views.set(id, v);
  }
  return v;
}
function drawRat(v: View, facing: 1 | -1, grounded: boolean, biting: boolean, color: number, t: number) {
  const b = v.body; b.clear();
  const sq = grounded && !biting ? 0 : 1;
  b.moveTo(facing > 0 ? 0 : 14, 7).lineTo(facing > 0 ? -9 : 23, 4 + Math.sin(t / 4) * 2).stroke({ width: 1.5, color: 0xc9a58a });
  b.roundRect(0, 1 + sq, 14, 9 - sq, 4).fill(color);
  b.circle(facing > 0 ? 13 : 1, 4, 3.2).fill(color + 0x0d0c0c);
  b.circle(facing > 0 ? 15 : -1, 4, 0.9).fill(0xffb0c0);
  b.circle(facing > 0 ? 11 : 3, 1.5, 1.6).fill(0xd9a5a5);
  b.circle(facing > 0 ? 13.5 : 0.5, 3, 0.7).fill(0x111111);
  v.fx.clear();
  if (biting) { const cx = facing > 0 ? 19 : -5; const a0 = facing > 0 ? -1 : Math.PI - 1; v.fx.arc(cx, 4, 6, a0, a0 + 2).stroke({ width: 2, color: 0xfff1b0 }); }
}
const COLORS = [0x8f8378, 0x6f8fa3, 0xa38f6f, 0x7fa36f, 0xa36f9a, 0x6fa39b];
const colorOf = (id: string) => COLORS[(Number(id) - 1) % COLORS.length];

// --- цикл: фиксированный шаг предсказания + отправка инпута ---
let acc = 0, last = performance.now(), frame = 0;
let prevX = 0, prevY = 0;
app.ticker.add(() => {
  const now = performance.now();
  acc += Math.min(0.1, (now - last) / 1000); last = now; frame++;
  while (acc >= TICK) {
    acc -= TICK;
    const s = touch.sample();
    if (me) {
      const input: Input = { seq: ++seq, ...s };
      prevX = me.x; prevY = me.y;
      if (flags.predict) { stepRat(level, me, input); pendingInputs.push(input); }
      net.sendInput(input, lastServerMe?.s ?? 0);
    }
  }
  const a = acc / TICK;
  const scale = Math.max(1, Math.min(app.screen.width / VIEW_W, app.screen.height / VIEW_H));
  stage.scale.set(scale);

  // своя
  let camTarget = { x: level.spawn.x, y: level.spawn.y };
  if (me) {
    const rx = flags.predict ? prevX + (me.x - prevX) * a : me.x, ry = flags.predict ? prevY + (me.y - prevY) * a : me.y;
    const v = view(myId); v.c.position.set(Math.round(rx), Math.round(ry)); v.label.text = names[myId] ?? '';
    drawRat(v, me.facing, me.grounded, me.biteLeft > 0, colorOf(myId), frame);
    camTarget = { x: rx, y: ry };
    ghost.clear();
    if (flags.ghost && lastServerMe) ghost.rect(lastServerMe.x, lastServerMe.y, RAT_W, RAT_H).stroke({ width: 1, color: 0xff6060 });
  }
  // чужие: интерполяция с задержкой
  const renderAt = performance.now() - (flags.interp ? INTERP_MS : 0);
  for (const [id, buf] of others) {
    if (!buf.length) continue;
    let s0 = buf[0], s1 = buf[0];
    for (let i = 0; i < buf.length; i++) { if (buf[i].at <= renderAt) s0 = buf[i]; if (buf[i].at >= renderAt) { s1 = buf[i]; break; } s1 = buf[i]; }
    const r0 = s0.rats[0], r1 = s1.rats[0];
    const t = s1.at > s0.at ? Math.min(1, Math.max(0, (renderAt - s0.at) / (s1.at - s0.at))) : 1;
    const x = r0.x + (r1.x - r0.x) * t, y = r0.y + (r1.y - r0.y) * t;
    const v = view(id); v.c.position.set(Math.round(x), Math.round(y)); v.label.text = names[id] ?? id;
    drawRat(v, r1.f, r1.g === 1, r1.b > 0, colorOf(id), frame);
  }
  for (const id of [...views.keys()]) if (id !== myId && !others.has(id)) { views.get(id)!.c.destroy(); views.delete(id); }

  const camX = Math.max(0, Math.min(level.cols * TILE - app.screen.width / scale, camTarget.x + RAT_W / 2 - app.screen.width / scale / 2));
  const camY = Math.max(0, Math.min(level.rows * TILE - app.screen.height / scale, camTarget.y + RAT_H / 2 - app.screen.height / scale / 2));
  stage.position.set(-Math.round(camX * scale), -Math.round(camY * scale));

  if (frame % 10 === 0) $('hud').textContent =
    `${serverUrl.replace(/^wss?:\/\//, '')} · крыс ${others.size + (me ? 1 : 0)}\n` +
    `ping ${net.rtt} мс${net.lagMs ? ` (+${net.lagMs * 2} иск.)` : ''} · снапшотов ${snapsIn} · ${(net.bytesIn / 1024).toFixed(0)} КБ\n` +
    `коррекций ${corrections} (посл. ${lastCorr.toFixed(1)} px) · неподтв. инпутов ${pendingInputs.length} · укушен ${me?.hits ?? 0}\n` +
    `${Math.round(app.ticker.FPS)} fps`;
});
