// Клиент «Крысы крысят» v0: лобби по коду → Вылазка (предсказание своей Крысы, интерполяция остального) → итоги.
import { Application, Container, Graphics, Text } from 'pixi.js';
import { parseMap, MAPS, stepRat, applyRatSnap, TILE, TICK, RAT_W, RAT_H, RULES, KINDS, EXIT_INFO, HUMAN_INFO, type Input, type Rat, type RatSnap, type Snapshot, type Level, type Event } from '@krysy/sim';
import { Touch } from './input';
import { Net, type LobbyMsg, type ResultsMsg } from './net';

const VIEW_W = 480, VIEW_H = 270, INTERP_MS = 100;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const serverUrl = new URLSearchParams(location.search).get('server') ?? (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'ws://localhost:2567';

// ---------- состояние ----------
let level: Level | null = null;
let me: Rat | null = null;
let myId = '';
let seq = 0;
let pendingInputs: Input[] = [];
let lastServerMe: RatSnap | null = null;
let snaps: (Snapshot & { at: number })[] = [];
let lobby: LobbyMsg | null = null;
let phase: 'join' | 'lobby' | 'raid' | 'results' = 'join';
let selectedMap = 'yard';

const touch = new Touch($('joy'), $('knob'), $('jump'), $('bite'), $('act'));
const net = new Net();

// ---------- Safari / iOS ----------
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => { const n = Date.now(); if (n - lastTouchEnd < 350 && (e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault(); lastTouchEnd = n; }, { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
if (!document.fullscreenEnabled) $('iosHint').style.display = 'block';

// ---------- лобби ----------
const nameEl = $<HTMLInputElement>('name'), codeEl = $<HTMLInputElement>('code');
nameEl.value = localStorage.getItem('ratName') ?? '';
codeEl.value = (new URLSearchParams(location.search).get('room') ?? localStorage.getItem('room') ?? '').toUpperCase();
$('join').onclick = async () => {
  const name = nameEl.value.trim() || 'крыса';
  const code = (codeEl.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || randomCode()).slice(0, 6);
  codeEl.value = code;
  localStorage.setItem('ratName', name); localStorage.setItem('room', code);
  history.replaceState(null, '', `?room=${code}`);
  net.connect(serverUrl, name, code);
  try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch {}
  try { await (screen.orientation as any).lock?.('landscape'); } catch {}
  try { await (navigator as any).wakeLock?.request('screen'); } catch {}
};
$('leave').onclick = () => { net.close(); showJoin(); };
$('start').onclick = () => net.send({ t: 'start' });
$('back').onclick = () => { net.send({ t: 'back' }); showLobby(); };
function randomCode() { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }

function showJoin() { phase = 'join'; $('screenLobby').classList.add('open'); $('screenResults').classList.remove('open'); $('joinBox').style.display = ''; $('lobbyBox').style.display = 'none'; setControls(false); }
function showLobby() { phase = 'lobby'; $('screenLobby').classList.add('open'); $('screenResults').classList.remove('open'); $('joinBox').style.display = 'none'; $('lobbyBox').style.display = ''; setControls(false); }
function setControls(on: boolean) { touch.enabled = on; for (const id of ['jump', 'bite', 'act']) $(id).classList.toggle('vis', on); $('hud').classList.toggle('vis', on); $('rotate').classList.toggle('on', on); }

net.on('status', (t, closed) => { $('status').textContent = t; if (closed) { showJoin(); $('joinBox').insertAdjacentHTML('beforeend', `<div class="muted">${t}</div>`); } });
net.on('welcome', (id) => { myId = id; });
net.on('lobby', (m) => {
  lobby = m; selectedMap = m.map;
  if (phase === 'join' || phase === 'lobby') showLobby();
  $('codeShow').textContent = m.code;
  const host = m.hostId === myId;
  $('players').innerHTML = m.players.map((p) => `<span>${p.id === m.hostId ? '👑 ' : '🐀 '}${esc(p.name)}</span>`).join(' · ');
  $('maps').innerHTML = m.maps.map((x) => `<div class="map ${x.id === m.map ? 'sel' : ''} ${host ? '' : 'locked'}" data-id="${x.id}"><b>${x.name}</b><br/><span class="muted">${x.desc}</span></div>`).join('');
  if (host) for (const el of $('maps').querySelectorAll<HTMLElement>('.map')) el.onclick = () => net.send({ t: 'setMap', map: el.dataset.id });
  $<HTMLButtonElement>('start').disabled = !host;
  $('start').textContent = host ? 'В Вылазку' : 'Ждём хозяина комнаты…';
});
net.on('raid', (map) => {
  level = parseMap(MAPS[map]);
  me = null; pendingInputs = []; lastServerMe = null; snaps = []; seq = 0;
  buildLevel(level);
  phase = 'raid';
  $('screenLobby').classList.remove('open'); $('screenResults').classList.remove('open');
  setControls(true);
  toast(`${MAPS[map].name}: собрать и дойти до Выхода`);
});
net.on('results', (m) => showResults(m));
net.on('snapshot', (s) => {
  snaps.push(s); while (snaps.length > 30) snaps.shift();
  const rs = s.rats.find((r) => r.id === myId);
  if (rs && level) {
    if (!me) { me = makeRat(rs); }
    lastServerMe = rs; reconcile(rs);
  }
});
net.on('events', (evs) => { for (const e of evs) onEvent(e); });

function esc(s: string) { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)); }
function makeRat(s: RatSnap): Rat {
  const r: Rat = { id: s.id, name: s.n, x: s.x, y: s.y, w: RAT_W, h: RAT_H, vx: 0, vy: 0, grounded: false, facing: 1, coyoteLeft: 0, bufferLeft: 0, biteLeft: 0, biteCd: 0, lastSeq: 0, hp: 100, down: false, downLeft: 0, dead: false, exited: false, pockets: [], revive: 0, inv: 0, exitProg: 0, banked: [], hits: 0 };
  applyRatSnap(r, s); return r;
}
function solidOthers() {
  const s = snaps[snaps.length - 1]; if (!s) return [];
  return s.rats.filter((r) => r.id !== myId && !r.dd && !r.ex).map((r) => ({ x: r.x, y: r.y, w: RAT_W, h: RAT_H, vx: r.vx, vy: r.vy, grounded: r.g === 1 }));
}
function reconcile(rs: RatSnap) {
  if (!me || !level) return;
  applyRatSnap(me, rs);
  pendingInputs = pendingInputs.filter((i) => i.seq > rs.s);
  const others = solidOthers();
  for (const i of pendingInputs) stepRat(level, me, i, others);
}

// ---------- итоги ----------
function showResults(m: ResultsMsg) {
  phase = 'results'; setControls(false);
  const rows = m.rows.map((r) => `<tr><td>${r.exited ? '🏁' : '💀'} ${esc(r.name)}</td><td>${r.exited ? 'вынесла' : 'не вернулась'}</td><td>${r.loot.map((k) => KINDS[k]?.icon ?? '?').join(' ') || '—'}</td></tr>`).join('');
  $('resultsBody').innerHTML = `<div class="muted">${MAPS[m.map]?.name ?? m.map} · Переполох ${m.panic} %</div><table><tr><th>Крыса</th><th></th><th>Добыча</th></tr>${rows}</table>`;
  $('resultsNote').textContent = 'Нора и Алхимия — следующий слой; пока добыча только в таблице.';
  $('screenResults').classList.add('open');
}

// ---------- события → тосты ----------
let toastTimer = 0;
function toast(t: string) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el.classList.remove('on'), 2200); }
function onEvent(e: Event) {
  switch (e.k) {
    case 'stage': toast(`⚠️ ${e.a}`); break;
    case 'luk': toast('🕳️ Люк открылся'); break;
    case 'down': toast(`${e.a} лежит — поднимите!`); break;
    case 'revive': toast(`${e.a} на лапах`); break;
    case 'dead': toast(`💀 ${e.a}`); break;
    case 'exit': toast(`🏁 ${e.a} вынесла добычу`); break;
    case 'kill': toast(`☠️ ${e.a} мёртв`); break;
    case 'steal': toast(`🐦 Голубь спёр ${e.a}`); break;
    case 'nofit': toast('Орган не пролазит в водосток'); break;
    case 'catdead': toast('Кот сдох'); break;
  }
  if (e.x || e.y) fx(e);
}

// ---------- рендер ----------
const app = new Application();
await app.init({ canvas: $('game') as HTMLCanvasElement, resizeTo: window, background: '#1a1612', antialias: false, resolution: Math.min(2, devicePixelRatio || 1), autoDensity: true, roundPixels: true });
const stage = new Container(); app.stage.addChild(stage);
const lvlG = new Graphics(), bgG = new Graphics(), markG = new Graphics();
const ents = new Container(); const fxLayer = new Container();
stage.addChild(bgG, lvlG, markG, ents, fxLayer);

function buildLevel(l: Level) {
  lvlG.clear(); bgG.clear(); markG.clear();
  const pal = { yard: [0x4a3a2e, 0x7a5f45, 0x1a1612], kitchen: [0x3b3f45, 0x8a8f99, 0x15181c], roof: [0x3a3a3a, 0x6e6a66, 0x121418] }[selectedMapId()] ?? [0x4a3a2e, 0x7a5f45, 0x1a1612];
  app.renderer.background.color = pal[2];
  for (let i = 0; i < 40; i++) bgG.rect(20 + i * 48, 30 + (i % 3) * 60, 18, 24).fill(0x24201b);
  for (let r = 0; r < l.rows; r++) for (let c = 0; c < l.cols; c++) if (l.solid[r * l.cols + c])
    lvlG.rect(c * TILE, r * TILE, TILE, TILE).fill(r === 0 || r === l.rows - 1 || c === 0 || c === l.cols - 1 ? pal[0] : pal[1]);
  for (const wtr of l.water) markG.ellipse(wtr.x + 8, wtr.y + 13, 9, 3).fill(0x3a6fa0);
  for (const v of ents.children) v.destroy(); ents.removeChildren();
  views.clear();
}
function selectedMapId() { return lobby?.map ?? 'yard'; }

type View = { c: Container; g: Graphics; t: Text; label: Text; bar: Graphics };
const views = new Map<string, View>();
function view(key: string, emoji?: string): View {
  let v = views.get(key);
  if (!v) {
    const c = new Container(), g = new Graphics();
    const t = new Text({ text: emoji ?? '', style: { fontSize: 14 } }); t.anchor.set(0.5, 1);
    const label = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 7, fill: 0xe8d9c0 } }); label.anchor.set(0.5, 1);
    const bar = new Graphics();
    c.addChild(g, t, label, bar); ents.addChild(c);
    v = { c, g, t, label, bar }; views.set(key, v);
  }
  return v;
}
const COLORS = [0x8f8378, 0x6f8fa3, 0xa38f6f, 0x7fa36f, 0xa36f9a, 0x6fa39b];
const colorOf = (id: string) => COLORS[(Number(id) - 1 + 600) % COLORS.length];
function drawRat(v: View, r: { facing: 1 | -1; grounded: boolean; biting: boolean; down: boolean; dead: boolean }, color: number, t: number) {
  const b = v.g; b.clear();
  if (r.dead) { b.rect(0, 6, 14, 4).fill(0x333333); return; }
  if (r.down) { b.ellipse(7, 7, 8, 3).fill(color); b.circle(r.facing > 0 ? 13 : 1, 7, 2.5).fill(color + 0x0d0c0c); b.rect(5, 2, 1, 1).fill(0xffffff); return; }
  const sq = r.grounded && !r.biting ? 0 : 1;
  b.moveTo(r.facing > 0 ? 0 : 14, 7).lineTo(r.facing > 0 ? -9 : 23, 4 + Math.sin(t / 4) * 2).stroke({ width: 1.5, color: 0xc9a58a });
  b.roundRect(0, 1 + sq, 14, 9 - sq, 4).fill(color);
  b.circle(r.facing > 0 ? 13 : 1, 4, 3.2).fill(color + 0x0d0c0c);
  b.circle(r.facing > 0 ? 15 : -1, 4, 0.9).fill(0xffb0c0);
  b.circle(r.facing > 0 ? 11 : 3, 1.5, 1.6).fill(0xd9a5a5);
  b.circle(r.facing > 0 ? 13.5 : 0.5, 3, 0.7).fill(0x111111);
  if (r.biting) { const cx = r.facing > 0 ? 19 : -5; const a0 = r.facing > 0 ? -1 : Math.PI - 1; b.arc(cx, 4, 6, a0, a0 + 2).stroke({ width: 2, color: 0xfff1b0 }); }
}
function fx(e: Event) {
  if (e.k === 'hit') { // цифра урона + вспышка по цели
    const weak = e.b === 'weak';
    const n = new Text({ text: weak ? `-${e.a} 👥` : `-${e.a}`, style: { fontSize: weak ? 9 : 12, fontWeight: '700', fill: weak ? 0xbbbbbb : 0xffe066, stroke: { color: 0x000000, width: 2 } } });
    n.anchor.set(0.5, 1); n.position.set(e.x + 6, e.y - 4); fxLayer.addChild(n);
    const born = performance.now();
    const tk = () => { const a = (performance.now() - born) / 800; if (a >= 1) { app.ticker.remove(tk); n.destroy(); return; } n.y -= 0.5; n.alpha = 1 - a * a; };
    app.ticker.add(tk);
    for (const [k, v] of views) if ((k[0] === 'h' || k[0] === 'p') && Math.abs(v.c.x - e.x) < 20 && Math.abs(v.c.y - e.y) < 30) { v.t.tint = 0xff4040; setTimeout(() => { if (!v.t.destroyed) v.t.tint = 0xffffff; }, 150); }
    return;
  }
  const t = new Text({ text: ({ hurt: `-${e.a}`, stomp: '👟', swing: '🧹', scream: '😱', panic: '❗', pick: e.a ?? '', steal: '🐦', cat: '🐈', kill: '☠️', pigeondead: '🪶', down: '💫', exit: '🏁' } as Record<string, string>)[e.k] ?? '', style: { fontSize: 10, fill: 0xffffff } });
  if (!t.text) { t.destroy(); return; }
  if (e.k === 'hurt') { t.style.fill = 0xff5050; t.style.fontSize = 12; t.style.fontWeight = '700'; t.style.stroke = { color: 0x000000, width: 2 }; }
  t.anchor.set(0.5, 1); t.position.set(e.x + 7, e.y - 2); fxLayer.addChild(t);
  const born = performance.now();
  const tick = () => { const a = (performance.now() - born) / 700; if (a >= 1) { app.ticker.remove(tick); t.destroy(); return; } t.y -= 0.4; t.alpha = 1 - a; };
  app.ticker.add(tick);
}

// ---------- цикл ----------
let acc = 0, last = performance.now(), frame = 0, prevX = 0, prevY = 0;
app.ticker.add(() => {
  const now = performance.now();
  acc += Math.min(0.1, (now - last) / 1000); last = now; frame++;
  if (phase !== 'raid' || !level) return;
  while (acc >= TICK) {
    acc -= TICK;
    const s = touch.sample();
    if (me) {
      const input: Input = { seq: ++seq, ...s };
      prevX = me.x; prevY = me.y;
      stepRat(level, me, input, solidOthers()); pendingInputs.push(input);
      net.sendInput(input, lastServerMe?.s ?? 0);
    }
  }
  const a = acc / TICK;
  const scale = Math.max(1, Math.min(app.screen.width / VIEW_W, app.screen.height / VIEW_H));
  stage.scale.set(scale);

  // интерполяция мира: два снапшота вокруг renderAt
  const renderAt = now - INTERP_MS;
  let s0 = snaps[0], s1 = snaps[snaps.length - 1];
  for (let i = 0; i < snaps.length; i++) { if (snaps[i].at <= renderAt) s0 = snaps[i]; if (snaps[i].at >= renderAt) { s1 = snaps[i]; break; } }
  const t = s0 && s1 && s1.at > s0.at ? Math.min(1, Math.max(0, (renderAt - s0.at) / (s1.at - s0.at))) : 1;
  const seen = new Set<string>();

  let camX = level.spawns[0].x, camY = level.spawns[0].y;
  if (me) {
    const rx = prevX + (me.x - prevX) * a, ry = prevY + (me.y - prevY) * a;
    const v = view('r' + myId); v.c.position.set(Math.round(rx), Math.round(ry)); v.label.text = ''; seen.add('r' + myId);
    drawRat(v, { facing: me.facing, grounded: me.grounded, biting: me.biteLeft > 0, down: me.down, dead: me.dead }, colorOf(myId), frame);
    v.bar.clear(); if (me.down) v.bar.rect(0, -6, 14 * (me.revive / RULES.reviveTime), 2).fill(0x6fb06f);
    else if (me.exitProg > 0) v.bar.rect(0, -6, 14 * me.exitProg, 2).fill(0xe8d9c0);
    camX = rx; camY = ry;
    if (me.exited || me.dead) { // зритель: камера за первой живой
      const alive = s1?.rats.find((r) => !r.dd && !r.ex && r.id !== myId); if (alive) { camX = alive.x; camY = alive.y; }
    }
  }
  if (s1) {
    for (const r1 of s1.rats) {
      if (r1.id === myId) continue;
      const r0 = s0?.rats.find((r) => r.id === r1.id) ?? r1;
      const x = r0.x + (r1.x - r0.x) * t, y = r0.y + (r1.y - r0.y) * t;
      const v = view('r' + r1.id); v.c.position.set(Math.round(x), Math.round(y)); v.label.text = r1.n; v.label.position.set(7, -3); seen.add('r' + r1.id);
      drawRat(v, { facing: r1.f, grounded: r1.g === 1, biting: r1.b > 0, down: r1.dn === 1, dead: r1.dd === 1 }, colorOf(r1.id), frame);
      v.bar.clear(); if (r1.dn) v.bar.rect(0, -6, 14 * (r1.rv / RULES.reviveTime), 2).fill(0x6fb06f);
      v.c.visible = !r1.ex;
    }
    for (const h1 of s1.hu) {
      const h0 = s0?.hu.find((h) => h[0] === h1[0]) ?? h1;
      const x = h0[2] + (h1[2] - h0[2]) * t, y = h0[3] + (h1[3] - h0[3]) * t;
      const info = HUMAN_INFO[h1[1]];
      const v = view('h' + h1[0], info.icon); v.t.style.fontSize = h1[1] === 'K' ? 11 : 16; v.t.position.set(info.w / 2, info.h);
      v.t.scale.x = h1[4] > 0 ? 1 : -1;
      v.c.position.set(Math.round(x), Math.round(y)); seen.add('h' + h1[0]);
      v.label.text = h1[5] === 'windup' ? '‼️' : h1[5] === 'panic' ? '❗' : h1[5] === 'chase' ? '💢' : h1[5] === 'sleep' ? '💤' : ''; v.label.position.set(info.w / 2, -2);
      v.label.style.fontSize = h1[5] === 'windup' ? 11 : 7;
      v.bar.clear(); if (h1[6] < info.hp) v.bar.rect(0, -1, info.w * (h1[6] / info.hp), 1.5).fill(0xd04040);
    }
    for (const p1 of s1.pg) {
      const p0 = s0?.pg.find((p) => p[0] === p1[0]) ?? p1;
      const x = p0[2] + (p1[2] - p0[2]) * t, y = p0[3] + (p1[3] - p0[3]) * t;
      const v = view('p' + p1[0], '🐦'); v.t.style.fontSize = 12; v.t.position.set(0, 6);
      v.c.position.set(Math.round(x), Math.round(y)); seen.add('p' + p1[0]);
      v.label.text = p1[5] ? KINDS[p1[5]]?.icon ?? '' : p1[1] === 'F' ? '💢' : ''; v.label.position.set(0, -4);
    }
    for (const i1 of s1.it) {
      const v = view('i' + i1[0], KINDS[i1[1]]?.icon ?? '?'); v.t.style.fontSize = 9; v.t.position.set(4, 9);
      v.c.position.set(i1[2], i1[3]); seen.add('i' + i1[0]);
    }
    for (const e of s1.ex) {
      const key = 'e' + e[0] + e[1]; const v = view(key, e[3] ? EXIT_INFO[e[0]].icon : '🔒'); v.t.style.fontSize = 13; v.t.position.set(8, 16); v.t.text = e[3] ? EXIT_INFO[e[0]].icon : '🔒';
      v.c.position.set(e[1], e[2]); v.label.text = EXIT_INFO[e[0]].name; v.label.position.set(8, 0); seen.add(key);
    }
    if (s1.cat) { const c0 = s0?.cat ?? s1.cat; const v = view('cat', '🐈'); v.t.style.fontSize = 16; v.t.position.set(11, 14); v.t.scale.x = s1.cat[2] > 0 ? 1 : -1; v.c.position.set(Math.round(c0[0] + (s1.cat[0] - c0[0]) * t), Math.round(c0[1] + (s1.cat[1] - c0[1]) * t)); seen.add('cat'); }
    for (const [k, v] of views) if (!seen.has(k)) { v.c.destroy(); views.delete(k); }

    // HUD
    if (frame % 6 === 0) {
      const meS = s1.rats.find((r) => r.id === myId);
      $('panicFill').style.width = s1.panic + '%';
      if (meS) {
        $('hpFill').style.width = meS.hp + '%';
        $('hpFill').style.background = meS.hp > 50 ? '#6fb06f' : meS.hp > 25 ? '#d0a040' : '#d04040';
        let cells = ''; let used = 0;
        for (const k of meS.pk) { const kd = KINDS[k]; used += kd.size; cells += `<span class="full" style="width:${22 * kd.size + 2 * (kd.size - 1)}px">${kd.icon}</span>`; }
        for (let i = used; i < RULES.pockets; i++) cells += '<span></span>';
        $('pockets').innerHTML = cells;
        $('info').textContent = `${meS.dn ? `лежишь ${meS.dl.toFixed(0)} с · ` : ''}${meS.ex ? 'вынесла · ' : ''}${meS.dd ? 'погибла · ' : ''}ping ${net.rtt} · ${Math.round(app.ticker.FPS)} fps`;
      }
    }
  }
  const cx = Math.max(0, Math.min(level.cols * TILE - app.screen.width / scale, camX + RAT_W / 2 - app.screen.width / scale / 2));
  const cy = Math.max(0, Math.min(level.rows * TILE - app.screen.height / scale, camY + RAT_H / 2 - app.screen.height / scale / 2));
  stage.position.set(-Math.round(cx * scale), -Math.round(cy * scale));
});

