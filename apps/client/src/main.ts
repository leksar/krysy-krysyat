// Клиент «Крысы крысят» v0: лобби по коду → Вылазка (предсказание своей Крысы, интерполяция остального) → итоги.
import { Application, Assets, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import { tex, itemIcon, drawLevel, THEMES, HUMANS, BROOM, PIGEON, CAT, ITEM, ITEM_TINT, EXITS, WATER, PILE, CAULDRON, SHELF, TABLE, RACK, TUNNEL, type SpriteDef } from './sprites';
import { generateLevel, noraLevel, NORA_STATIONS, stationAt, MAPS, stepRat, applyRatSnap, PHYS, TILE, TICK, RAT_W, RAT_H, RULES, KINDS, EXIT_INFO, HUMAN_INFO, PROPS, BASE_MODS, BASE_RAID, MUTATION_NAMES, MUTATION_DESC, MODIFIER_NAMES, MODIFIER_DESC, dominant, type Input, type Rat, type RatSnap, type Snapshot, type Level, type Event, type Potion, type RatMods, type RaidMods, type DNA, type Mutations, type Prop, type StationId } from '@krysy/sim';
import { Touch } from './input';
import { Net, type LobbyMsg, type ResultsMsg, type PubProfile } from './net';
import { Audio, falloff } from './audio';
const audio = new Audio();

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
let raidModsCur: RaidMods = BASE_RAID;
let ratModsById: Record<string, RatMods> = {};
type BuildInfo = { name: string; desc: string; level: number; max: number; cost: Record<string, number> | null; requires?: string | null };
type NoraMsg = { stash: Record<string, number>; potions: Potion[]; cauldron: number; builds: Record<string, BuildInfo>; log: string[] };
type MeMsg = { name: string; code: string; dna: DNA; mut: Mutations; raids: number; banked: number; mods: RatMods; pockets: { level: number; max: number; cost: Record<string, number> | null; desc: string } };
let nora: NoraMsg | null = null, meInfo: MeMsg | null = null;
let cauldron: string[] = [];
// аккаунт: секретный код живёт в телефоне
function acctCode(): string { let c = localStorage.getItem('ratCode'); if (!c) { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; c = ''; for (let i = 0; i < 12; i++) c += a[Math.floor(Math.random() * a.length)]; localStorage.setItem('ratCode', c); } return c; }

const touch = new Touch($('joy'), $('knob'), $('jump'), $('bite'), $('act'));
const net = new Net();

// ---------- Safari / iOS ----------
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => { const n = Date.now(); if (n - lastTouchEnd < 350 && (e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault(); lastTouchEnd = n; }, { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
if (!document.fullscreenEnabled) $('iosHint').style.display = 'block';

// ---------- вход ----------
const nameEl = $<HTMLInputElement>('name'), codeEl = $<HTMLInputElement>('code');
nameEl.value = localStorage.getItem('ratName') ?? '';
codeEl.value = (new URLSearchParams(location.search).get('room') ?? localStorage.getItem('room') ?? '').toUpperCase();
$('join').onclick = async () => {
  const name = nameEl.value.trim() || 'крыса';
  const code = (codeEl.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || randomCode()).slice(0, 6);
  codeEl.value = code;
  localStorage.setItem('ratName', name); localStorage.setItem('room', code);
  history.replaceState(null, '', `?room=${code}`);
  audio.unlock(); audio.play('ui');
  net.connect(serverUrl, name, code, acctCode());
  try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch {}
  try { await (screen.orientation as any).lock?.('landscape'); } catch {}
  try { await (navigator as any).wakeLock?.request('screen'); } catch {}
};
$('leave').onclick = () => { net.close(); showJoin(); };
$('showAcct').onclick = (e) => { e.preventDefault(); prompt('Секретный код твоей крысы (сохрани, чтобы зайти с другого телефона):', acctCode()); };
$('enterAcct').onclick = (e) => { e.preventDefault(); const c = prompt('Введи секретный код крысы:'); if (c && c.replace(/[^A-Za-z0-9]/g, '').length >= 6) { localStorage.setItem('ratCode', c.replace(/[^A-Za-z0-9]/g, '')); alert('Код сохранён. Входи в Нору.'); } };
// список комнат на экране входа: тап по комнате подставляет код
const httpBase = serverUrl.replace(/^ws/, 'http').replace(/\/ws$/, '');
async function pollRooms() {
  if (phase !== 'join') return;
  try {
    const list: { code: string; phase: string; map: string; players: string[] }[] = await (await fetch(`${httpBase}/rooms`, { cache: 'no-store' })).json();
    $('rooms').innerHTML = list.length
      ? 'Комнаты сейчас: ' + list.map((r) => `<span class="room ${r.phase}" data-code="${r.code}"><b>${r.code}</b> · ${esc(r.players.join(', ') || 'пусто')} · ${r.phase === 'raid' ? 'в Вылазке: ' + esc(r.map) : r.phase === 'results' ? 'итоги' : 'в Норе'}</span>`).join('')
      : 'Открытых комнат нет — создай свою: введи любой код.';
    for (const el of $('rooms').querySelectorAll<HTMLElement>('.room')) el.onclick = () => { codeEl.value = el.dataset.code!; };
  } catch { $('rooms').textContent = 'сервер не отвечает'; }
}
setInterval(pollRooms, 3000); pollRooms();
$('joinBox').insertAdjacentHTML('beforeend', `<div class="muted" style="font-size:11px;opacity:.5">сборка ${(import.meta.env.VITE_BUILD as string | undefined) ?? 'dev'}</div>`);
$('back').onclick = () => { net.send({ t: 'back' }); $('screenResults').classList.remove('open'); };
function randomCode() { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }

function showJoin() { audio.setMusic('none'); phase = 'join'; $('screenLobby').classList.add('open'); $('screenResults').classList.remove('open'); setControls(false); document.body.classList.remove('nora'); closeSheet(); }
function setControls(on: boolean) { touch.enabled = on; for (const id of ['jump', 'bite', 'act']) $(id).classList.toggle('vis', on); $('hud').classList.toggle('vis', on); $('rotate').classList.toggle('on', on); $('abort').style.display = on && phase === 'raid' && lobby?.hostId === myId ? '' : 'none'; $('topbar').style.display = on && phase === 'lobby' ? '' : 'none'; }
$('abort').onclick = () => { if (confirm('Прервать Вылазку для всех? Добыча не вернувшихся пропадёт.')) net.send({ t: 'abort' }); };

// ---------- Нора как уровень ----------
let openStation: StationId | null = null;
let ratSheetId: string | null = null;
let profiles: Record<string, PubProfile> = {};
function enterNora() {
  phase = 'lobby'; audio.setMusic('nora');
  level = noraLevel();
  me = null; pendingInputs = []; lastServerMe = null; snaps = []; raidModsCur = BASE_RAID; // seq НЕ сбрасываем: старые пакеты в полёте иначе блокируют ввод
  buildLevel(level, 'nora');
  buildStations();
  $('screenLobby').classList.remove('open'); $('screenResults').classList.remove('open');
  document.body.classList.add('nora');
  setControls(true);
  closeSheet();
  toast('Нора. Подойди к предмету и нажми ДЕЙСТ.');
}
type StationView = { c: Container; label: Text; sub: Text; sp: Sprite; extra: Graphics };
const stationViews = new Map<StationId, StationView>();
const STATION_TEX: Record<StationId, SpriteDef> = { stash: PILE, cauldron: CAULDRON, shelf: SHELF, table: TABLE, rack: RACK, tunnel: TUNNEL };
function buildStations() {
  stationViews.clear();
  for (const st of NORA_STATIONS) {
    const c = new Container();
    const sp = new Sprite(tex('st_' + st.id, STATION_TEX[st.id])); sp.anchor.set(0.5, 1);
    const w = (st.c1 - st.c0 + 1) * TILE; sp.position.set(w / 2, TILE);
    const label = new Text({ text: st.name, resolution: 4, style: { fontFamily: 'monospace', fontSize: 8, fill: 0xe8d9c0, fontWeight: '700' } }); label.anchor.set(0.5, 1); label.position.set(w / 2, TILE - sp.height - 3);
    const sub = new Text({ text: '', resolution: 4, style: { fontFamily: 'monospace', fontSize: 7, fill: 0xbfae94 } }); sub.anchor.set(0.5, 0); sub.position.set(w / 2, TILE + 1);
    const extra = new Graphics();
    c.addChild(extra, sp, label, sub); c.position.set(st.c0 * TILE, st.row * TILE); marks.addChild(c);
    stationViews.set(st.id, { c, label, sub, sp, extra });
  }
  updateStations();
}
/** Подписи и «наполнение» станций из состояния Норы */
function updateStations() {
  if (phase !== 'lobby' || !stationViews.size) return;
  const host = lobby?.hostId === myId;
  const total = nora ? Object.values(nora.stash).reduce((s, n) => s + n, 0) : 0;
  const sv = (id: StationId) => stationViews.get(id)!;
  // Склад — растущая куча посреди норы
  { const v = sv('stash'); v.sp.visible = false; const g = v.extra; g.clear(); drawPile(g, nora?.stash ?? {}, (NORA_STATIONS[2].c1 - NORA_STATIONS[2].c0 + 1) * TILE); v.sub.text = total ? `${total} шт.` : 'пусто — неси добычу'; v.label.position.y = TILE - pileHeight(total) - 4; }
  // стройплощадки: пока не построено — пунктир и табличка с ценой
  const site = (id: StationId, b: BuildInfo | undefined, w: number) => {
    const v = sv(id); const built = (b?.level ?? 0) > 0; v.sp.visible = built; v.extra.clear();
    if (!built) { v.extra.rect(2, -18, w - 4, 32).stroke({ width: 1, color: 0x8a7a5a, alpha: 0.8 }); v.extra.rect(w / 2 - 10, -4, 20, 12).fill(0x3a2a1a); v.label.text = `${b?.name ?? ''}: стройка`; }
    else v.label.text = b?.name ?? '';
    return built;
  };
  const cb = site('cauldron', nora?.builds.cauldron, 5 * TILE);
  sv('cauldron').sub.text = cb ? `${nora!.cauldron} слота` : nora?.builds.cauldron?.cost ? costHtml(nora.builds.cauldron.cost).replace(/, /g, ' · ') : '';
  const sb = site('shelf', nora?.builds.shelf, 6 * TILE);
  sv('shelf').sub.text = sb ? (nora!.potions.length ? `Зелий: ${nora!.potions.length}` : 'пусто') : nora?.builds.shelf?.requires ? `нужен ${nora.builds.shelf.requires}` : nora?.builds.shelf?.cost ? costHtml(nora.builds.shelf.cost).replace(/, /g, ' · ') : '';
  const rb = site('rack', nora?.builds.rack, 5 * TILE);
  sv('rack').sub.text = rb ? (meInfo ? `мои сумки: ${meInfo.pockets.level}/${meInfo.pockets.max}` : '') : nora?.builds.rack?.requires ? `нужен ${nora.builds.rack.requires}` : nora?.builds.rack?.cost ? costHtml(nora.builds.rack.cost).replace(/, /g, ' · ') : '';
  sv('table').sub.text = lobby ? `${MAPS[lobby.map]?.name ?? lobby.map}${lobby.pour.length ? ` + Зелья ${lobby.pour.map((i) => '#' + i).join(',')}` : ''}` : '';
  sv('tunnel').sub.text = host ? 'ДЕЙСТ. — в Вылазку' : 'откроет хозяин';
  if (sb) { const g = sv('shelf').extra; for (let i = 0; i < Math.min(8, nora!.potions.length); i++) g.roundRect(6 + i * 11, 2, 6, 11, 2).fill([0x7fd3ff, 0xa0e070, 0xe07070, 0xe8d070][i % 4]); }
}
function pileHeight(total: number) { return Math.min(44, 6 + total * 0.5); }
/** Куча добычи: холм, высота и ширина от количества, сверху — предметы по видам */
function drawPile(g: Graphics, stash: Record<string, number>, areaW: number) {
  const total = Object.values(stash).reduce((s, n) => s + n, 0);
  if (!total) { g.ellipse(areaW / 2, TILE - 2, 10, 3).fill(0x2a1e14); return; }
  const h = pileHeight(total), w = Math.min(areaW - 8, 40 + total * 1.4), cx = areaW / 2, base = TILE;
  g.moveTo(cx - w / 2, base).quadraticCurveTo(cx - w / 4, base - h * 0.9, cx, base - h).quadraticCurveTo(cx + w / 4, base - h * 0.9, cx + w / 2, base).closePath().fill(0x4a3626);
  g.moveTo(cx - w / 3, base).quadraticCurveTo(cx - w / 8, base - h * 0.7, cx + w / 10, base - h * 0.8).quadraticCurveTo(cx + w / 4, base - h * 0.6, cx + w / 3, base).closePath().fill(0x5c4530);
  // предметы: раскиданы по холму, цвет по виду, количество ограничено
  const kinds = Object.entries(stash).filter(([, n]) => n > 0); let i = 0;
  for (const [k, n] of kinds) for (let j = 0; j < Math.min(n, 6); j++, i++) {
    if (i > 40) break;
    const t = ((i * 7919) % 97) / 97, u = ((i * 104729) % 89) / 89;
    const px = cx + (t - 0.5) * w * 0.9, py = base - (h - 3) * (1 - Math.abs(t - 0.5) * 2) * (0.3 + u * 0.7);
    const col = KINDS[k]?.type === 'food' ? 0xe0b060 : KINDS[k]?.type === 'trash' ? 0xa0a0a8 : KINDS[k]?.type === 'secr' ? 0x80c8e8 : 0xe05070;
    g.rect(Math.round(px), Math.round(py), 3, 3).fill(col);
  }
}
function stationHere(): StationId | null { return me && phase === 'lobby' ? stationAt(me.x, me.y)?.id ?? null : null; }

// ---------- шторка станции ----------
function openSheet(id: StationId) { audio.play('ui'); openStation = id; cauldron = []; $('sheet').classList.add('open'); renderSheet(); }
function closeSheet() { openStation = null; ratSheetId = null; $('sheet').classList.remove('open'); }
// ---------- карточка крысы (тап по крысе) ----------
type Look = { fat: number; acid: number; alive: number; sweet: number; infect: number; loud: number; sticky: number; rot: number };
function lookOf(id: string): Look { const m = profiles[id]?.mut ?? {}; return { fat: m['Жирное'] ?? 0, acid: m['Едкое'] ?? 0, alive: m['Живое'] ?? 0, sweet: m['Сладкое'] ?? 0, infect: m['Заразное'] ?? 0, loud: m['Шумное'] ?? 0, sticky: m['Липкое'] ?? 0, rot: m['Гнилое'] ?? 0 }; }
function openRatSheet(id: string) { audio.play('ui'); openStation = null; ratSheetId = id; $('sheet').classList.add('open'); renderRatSheet(id); }
function renderRatSheet(id: string) {
  const pr = profiles[id]; const body = $('sheetBody');
  if (!pr) { body.innerHTML = '<h2>Крыса</h2><div class="muted">нет данных</div>'; return; }
  const snap = snaps[snaps.length - 1]?.rats.find((r) => r.id === id);
  const mine = id === myId;
  const maxGene = Math.max(100, ...PROPS.map((p) => pr.dna[p] ?? 0));
  const muts = PROPS.filter((p) => pr.mut[p]).map((p) => `<div>🧬 <b>${MUTATION_NAMES[p]} ${pr.mut[p]}</b> <span class="muted">— ${MUTATION_DESC[p][Math.min(2, pr.mut[p]! - 1)]}</span></div>`).join('') || '<div class="muted">Мутаций нет</div>';
  const dom = [...PROPS].sort((a, b) => (pr.dna[b] ?? 0) - (pr.dna[a] ?? 0)).slice(0, 2);
  body.innerHTML = `<h2>${mine ? '🐀 Ты: ' : '🐀 '}${esc(pr.name)}</h2>
    <div class="muted">Вылазок: ${pr.raids} · вынесено: ${pr.banked} · карманов: ${RULES.pockets + pr.pockets + (pr.mut['Жирное'] ?? 0)}${snap ? ` · HP ${snap.hp}/${snap.mh}${snap.dn ? ' · лежит' : ''}${snap.pk.length ? ` · несёт: ${snap.pk.map((k) => KINDS[k]?.name).join(', ')}` : ''}` : ''}</div>
    <div style="margin:6px 0">${muts}</div>
    <div class="muted" style="font-size:12px">Порода по ДНК: <b>${dom.join(' + ')}</b> — такие Мутации у неё сильнее</div>
    <div class="dna" style="margin-top:4px">${PROPS.map((p) => `<span>${p}</span><i><b style="width:${((pr.dna[p] ?? 0) / maxGene) * 100}%"></b></i><span class="muted">${pr.dna[p] ?? 0}</span>`).join('')}</div>`;
}
/** Тап по крысе: короткое касание без сдвига над крысой открывает карточку (и в Норе, и на Вылазке) */
let tapStart: { x: number; y: number; t: number; id: number } | null = null;
document.addEventListener('pointerdown', (e) => { const t = e.target as HTMLElement; if (t.id === 'game' || t === document.body) tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; });
document.addEventListener('pointerup', (e) => {
  if (!tapStart || e.pointerId !== tapStart.id) return;
  const dx = e.clientX - tapStart.x, dy = e.clientY - tapStart.y, dt = performance.now() - tapStart.t; tapStart = null;
  if (Math.hypot(dx, dy) > 8 || dt > 350 || !level || (phase !== 'raid' && phase !== 'lobby')) return;
  const wx = (e.clientX - stage.x) / stage.scale.x, wy = (e.clientY - stage.y) / stage.scale.y;
  const cands: { id: string; x: number; y: number }[] = [];
  if (me) cands.push({ id: myId, x: me.x, y: me.y });
  for (const r of snaps[snaps.length - 1]?.rats ?? []) if (r.id !== myId && !r.ex) cands.push({ id: r.id, x: r.x, y: r.y });
  let best: string | null = null, bd = 18;
  for (const c of cands) { const d = Math.hypot(c.x + RAT_W / 2 - wx, c.y + RAT_H / 2 - wy); if (d < bd) { bd = d; best = c.id; } }
  if (best) openRatSheet(best);
});
$('sheetClose').onclick = closeSheet;
$('mute').textContent = audio.muted ? '🔇' : '🔊';
$('mute').onclick = () => { audio.unlock(); $('mute').textContent = audio.toggleMute() ? '🔇' : '🔊'; };
function chip(kind: string, count?: number, extra = '') { const k = KINDS[kind]; return `<span class="chip ${k.type}" data-kind="${kind}" ${extra}><img src="${itemIcon(kind)}"/>${k.name}${count !== undefined ? ` <b>×${count}</b>` : ''}</span>`; }
function propsHtml(p: Potion) { const d = dominant(p); return `<span class="props">${PROPS.filter((x) => p.props[x]).map((x) => `<span${x === d ? ' style="outline:1px solid #e8d9c0"' : ''}>${x} ${p.props[x]}</span>`).join('')}</span>`; }
const TYPE_RU: Record<string, string> = { food: 'Еда', trash: 'Мусор', secr: 'Выделения', organ: 'Органы' };
function costHtml(cost: Record<string, number> | null) { return cost ? Object.entries(cost).filter(([, n]) => n).map(([t, n]) => `${TYPE_RU[t]} ×${n}`).join(', ') : 'максимум'; }
function renderSheet() {
  if (!openStation || !nora) return;
  const host = lobby?.hostId === myId;
  const body = $('sheetBody');
  const st = NORA_STATIONS.find((s) => s.id === openStation)!;
  let html = `<h2>${st.name}</h2>`;
  const stashEntries = Object.entries(nora.stash).filter(([, n]) => n > 0).sort((a, b) => KINDS[a[0]].type.localeCompare(KINDS[b[0]].type));
  switch (openStation) {
    case 'stash':
      html += stashEntries.length ? `<div>${stashEntries.map(([k, n]) => chip(k, n)).join('')}</div><div class="muted">Неси Ингредиенты в Котёл — он рядом.</div>` : '<div class="muted">Пусто. Всё, что вынесете с Вылазки через Выход, ляжет сюда.</div>';
      break;
    case 'cauldron': {
      if (!(nora.builds.cauldron?.level > 0)) { const b = nora.builds.cauldron; html += `<div class="build"><b>Стройплощадка: Котёл</b> <span class="muted">— ${b.desc}. Цена: ${costHtml(b.cost)}</span> <button class="small primary" data-build="cauldron">Построить</button></div><div class="muted">Склад: ${stashEntries.map(([k, n]) => `${KINDS[k].name} ×${n}`).join(', ') || 'пусто'}</div>`; break; }
      let slots = ''; for (let i = 0; i < nora.cauldron; i++) slots += `<span class="slot" data-i="${i}">${cauldron[i] ? `<img src="${itemIcon(cauldron[i])}"/>` : ''}</span>`;
      const preview = cauldron.length >= 2 ? propsHtml({ id: 0, from: cauldron, props: cauldron.reduce((acc: Record<string, number>, k) => { for (const pr of (ITEM_PROPS_LOCAL[k] ?? [])) acc[pr] = (acc[pr] ?? 0) + 1; return acc; }, {}) as Potion['props'] }) : '';
      const d = cauldron.length >= 2 ? dominant({ id: 0, from: cauldron, props: cauldron.reduce((acc: Record<string, number>, k) => { for (const pr of (ITEM_PROPS_LOCAL[k] ?? [])) acc[pr] = (acc[pr] ?? 0) + 1; return acc; }, {}) as Potion['props'] }) : null;
      html += `<div class="row">${slots}<button id="brewBtn" class="primary" ${cauldron.length < 2 ? 'disabled' : ''}>Сварить</button></div>`;
      html += preview ? `<div>Получится: ${preview}${d ? ` <span class="muted">· выпить → ${MUTATION_NAMES[d]}</span>` : ''}</div>` : '<div class="muted">Положи 2–' + nora.cauldron + ' Ингредиента со Склада:</div>';
      html += `<div>${stashEntries.map(([k, n]) => chip(k, n - cauldron.filter((c) => c === k).length)).join('') || '<span class="muted">Склад пуст</span>'}</div>`;
      const cb = nora.builds.cauldron; html += `<div class="build" style="margin-top:8px"><b>Улучшить Котёл</b> ${cb.level}/${cb.max} <span class="muted">— ${cb.desc}. Цена: ${costHtml(cb.cost)}</span> ${cb.cost ? `<button class="small" data-build="cauldron">Построить</button>` : ''}</div>`;
      break;
    }
    case 'shelf':
      if (!(nora.builds.shelf?.level > 0)) { const b = nora.builds.shelf; html += `<div class="build"><b>Стройплощадка: Полка Зелий</b> <span class="muted">— ${b.desc}. Цена: ${costHtml(b.cost)}${b.requires ? ` · сначала: ${b.requires}` : ''}</span> ${b.requires ? '' : '<button class="small primary" data-build="shelf">Построить</button>'}</div>`; break; }
      html += nora.potions.length ? nora.potions.map((p) => `<div class="potion ${lobby?.pour.includes(p.id) ? 'pour' : ''}"><b>Зелье #${p.id}</b> ${propsHtml(p)}<div class="muted" style="font-size:11px">из: ${p.from.map((k) => KINDS[k].name).join(', ')}${dominant(p) ? ` · выпить → ${MUTATION_NAMES[dominant(p)!]} · вылить → ${PROPS.filter((x) => p.props[x]).map((x) => MODIFIER_NAMES[x]).join(', ')}` : ''}</div><div class="row"><button class="small" data-drink="${p.id}">Выпить</button>${host ? `<button class="small" data-pour="${p.id}">${lobby?.pour.includes(p.id) ? 'Снять со стола' : 'На стол — вылить на карту'}</button>` : ''}</div></div>`).join('') : '<div class="muted">Полка пуста — свари Зелье в Котле.</div>';
      if (meInfo) {
        const muts = PROPS.filter((p) => meInfo!.mut[p]).map((p) => `<span class="props"><span>🧬 ${MUTATION_NAMES[p]} ${meInfo!.mut[p]}</span></span>`).join(' ');
        const maxGene = Math.max(100, ...PROPS.map((p) => meInfo!.dna[p]));
        html += `<details style="margin-top:6px"><summary class="muted">Моя крыса: ${muts || 'без Мутаций'} · ДНК</summary><div class="dna" style="margin-top:4px">${PROPS.map((p) => `<span>${p}</span><i><b style="width:${(meInfo!.dna[p] / maxGene) * 100}%"></b></i><span class="muted">${meInfo!.dna[p]}</span>`).join('')}</div></details>`;
      }
      break;
    case 'table':
      html += `<div class="row">${lobby!.maps.map((x) => { const b = nora!.builds[x.id]; return x.locked
        ? `<div class="map locked"><b>🔒 ${x.name}</b><br/><span class="muted">${b?.desc ?? ''}. Цена: ${costHtml(b?.cost ?? null)}${b?.requires ? ` · сначала: ${b.requires}` : ''}</span>${b && !b.requires && b.cost ? `<br/><button class="small primary" data-build="${x.id}">Построить</button>` : ''}</div>`
        : `<div class="map ${x.id === lobby!.map ? 'sel' : ''} ${host ? '' : 'locked'}" data-id="${x.id}"><b>${x.name}</b><br/><span class="muted">${x.desc}</span></div>`; }).join('')}</div>${host ? '' : '<div class="muted">Карту выбирает хозяин (👑).</div>'}`;
      html += `<div class="muted">${lobby?.pour.length ? `На карту выльем: ${lobby.pour.map((i) => '#' + i).join(', ')} → ${raidPreview()}` : 'Зелья на карту кладутся с Полки.'}</div><div class="muted">Когда готовы — все к Туннелю справа.</div>`;
      break;
    case 'rack': {
      if (!(nora.builds.rack?.level > 0)) { const b = nora.builds.rack; html += `<div class="build"><b>Стройплощадка: Стойка Карманов</b> <span class="muted">— ${b.desc}. Цена: ${costHtml(b.cost)}${b.requires ? ` · сначала: ${b.requires}` : ''}</span> ${b.requires ? '' : '<button class="small primary" data-build="rack">Построить</button>'}</div>`; break; }
      const pb = meInfo?.pockets;
      html += pb ? `<div class="build"><b>Карманы ${esc(meInfo!.name)}</b> ${pb.level}/${pb.max} <span class="muted">— личная постройка: +1 ячейка только этой крысе, платит Стая со Склада. Цена: ${costHtml(pb.cost)}</span> ${pb.cost ? `<button class="small" data-build="pockets">Сшить сумку</button>` : ''}</div><div class="muted">Сейчас у тебя карманов: ${RULES.pockets + (meInfo?.mods.pockets ?? 0)}</div>` : '';
      break;
    }
    case 'tunnel':
      html += host ? `<div class="row"><button id="startBtn" class="primary">В Вылазку: ${MAPS[lobby!.map]?.name}</button><span class="muted">${lobby?.pour.length ? raidPreview() : 'без Модификаторов'}</span></div><div class="muted">Крысы: ${lobby!.players.map((p) => esc(p.name)).join(', ')}</div>` : `<div>Туннель откроет хозяин (👑 ${esc(lobby!.players.find((p) => p.id === lobby!.hostId)?.name ?? '')}). Жди здесь.</div>`;
      break;
  }
  html += `<div class="log" style="margin-top:8px">${nora.log.slice(-4).join('\n')}</div>`;
  body.innerHTML = html;
  for (const el of body.querySelectorAll<HTMLElement>('.chip')) el.onclick = () => { if (openStation !== 'cauldron') return; const k = el.dataset.kind!; const have = nora!.stash[k] - cauldron.filter((c) => c === k).length; if (have > 0 && cauldron.length < nora!.cauldron) { cauldron.push(k); renderSheet(); } };
  for (const el of body.querySelectorAll<HTMLElement>('.slot')) el.onclick = () => { const i = Number(el.dataset.i); if (cauldron[i]) { cauldron.splice(i, 1); renderSheet(); } };
  const brewBtn = body.querySelector<HTMLElement>('#brewBtn'); if (brewBtn) brewBtn.onclick = () => { if (cauldron.length >= 2) { net.send({ t: 'brew', kinds: cauldron }); cauldron = []; audio.play('brew'); } };
  for (const el of body.querySelectorAll<HTMLElement>('[data-build]')) el.onclick = () => { net.send({ t: 'build', what: el.dataset.build }); audio.play('build'); };
  for (const el of body.querySelectorAll<HTMLElement>('[data-pour]')) el.onclick = () => net.send({ t: 'pour', id: Number(el.dataset.pour) });
  for (const el of body.querySelectorAll<HTMLElement>('[data-drink]')) el.onclick = () => { const p = nora!.potions.find((x) => x.id === Number(el.dataset.drink))!; const d = dominant(p); if (confirm(`Выпить Зелье #${p.id}?${d ? ` Мутация «${MUTATION_NAMES[d]}» (${MUTATION_DESC[d][Math.min(2, (meInfo?.mut[d] ?? 0))]}). ` : ' '}Это навсегда.`)) net.send({ t: 'drink', id: p.id }); };
  for (const el of body.querySelectorAll<HTMLElement>('.map[data-id]')) el.onclick = () => net.send({ t: 'setMap', map: el.dataset.id });
  const startBtn = body.querySelector<HTMLElement>('#startBtn'); if (startBtn) startBtn.onclick = () => net.send({ t: 'start' });
}
function raidPreview() { if (!nora || !lobby) return ''; const ps = nora.potions.filter((p) => lobby!.pour.includes(p.id)); const names = new Set<string>(); for (const p of ps) for (const pr of PROPS) if (p.props[pr]) names.add(MODIFIER_NAMES[pr]); return [...names].join(', '); }

net.on('status', (t, closed) => { const st = document.getElementById('status'); if (st) st.textContent = t; if (closed) { showJoin(); $('joinBox').insertAdjacentHTML('beforeend', `<div class="muted">${t}</div>`); } });
net.on('welcome', (id) => { myId = id; });
net.on('lobby', (m) => {
  lobby = m; selectedMap = m.map; profiles = m.profiles ?? {};
  if (ratSheetId) renderRatSheet(ratSheetId);
  if (m.phase === 'lobby' && phase !== 'lobby') enterNora();
  $('roomInfo').innerHTML = `Комната <b>${m.code}</b> · ${m.players.map((p) => `${p.id === m.hostId ? '👑' : '🐀'} ${esc(p.name)}`).join(' · ')} · <span id="status" class="muted"></span>`;
  updateStations(); if (openStation) renderSheet();
});
net.on('raid', (map, seed, mods, ratMods) => {
  raidModsCur = mods ?? BASE_RAID; ratModsById = ratMods ?? {};
  level = generateLevel(map, seed);
  me = null; pendingInputs = []; lastServerMe = null; snaps = [];
  phase = 'raid'; closeSheet(); document.body.classList.remove('nora'); $('hint').textContent = ''; audio.setMusic('raid');
  buildLevel(level, map);
  $('screenLobby').classList.remove('open'); $('screenResults').classList.remove('open');
  setControls(true);
  toast(raidModsCur.names.length ? `${MAPS[map].name} · ${raidModsCur.names.join(', ')}` : `${MAPS[map].name}: собрать и дойти до Выхода`);
});
net.on('results', (m) => showResults(m));
net.on('nora', (m) => { nora = m; updateStations(); if (openStation) renderSheet(); });
net.on('me', (m) => { meInfo = m; updateStations(); if (openStation) renderSheet(); });
net.on('err', (t) => toast(t));
net.on('drank', (fam, tier) => { audio.play('drank'); toast(fam ? `Мутация: ${MUTATION_NAMES[fam as Prop]} ${tier}` : 'Зелье без Доминанты — только ДНК'); });

net.on('snapshot', (s) => {
  snaps.push(s); while (snaps.length > 30) snaps.shift();
  const rs = s.rats.find((r) => r.id === myId);
  if (rs && level) {
    if (!me) { me = makeRat(rs); me.mods = ratModsById[myId] ?? BASE_MODS; me.maxHp = rs.mh; }
    lastServerMe = rs; reconcile(rs);
  }
});
net.on('events', (evs) => { for (const e of evs) onEvent(e); });

function esc(s: string) { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)); }
function makeRat(s: RatSnap): Rat {
  const r: Rat = { id: s.id, name: s.n, x: s.x, y: s.y, w: RAT_W, h: RAT_H, vx: 0, vy: 0, grounded: false, facing: 1, coyoteLeft: 0, bufferLeft: 0, biteLeft: 0, biteCd: 0, lastSeq: 0, hp: 100, down: false, downLeft: 0, dead: false, exited: false, pockets: [], revive: 0, inv: 0, water: false, act: 0, exitProg: 0, banked: [], hits: 0, mods: BASE_MODS, maxHp: 100 };
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
  for (const i of pendingInputs) stepRat(level, me, i, others, raidModsCur.slippery, raidModsCur.sticky);
}

// ---------- итоги ----------
import { ITEM_PROPS as ITEM_PROPS_LOCAL } from '@krysy/sim';
function showResults(m: ResultsMsg) {
  phase = 'results'; setControls(false); audio.setMusic('none');
  const rows = m.rows.map((r) => `<tr><td>${r.exited ? '🏁' : '💀'} ${esc(r.name)}</td><td>${r.exited ? 'вынесла' : 'не вернулась'}</td><td>${r.loot.map((k) => `<img src="${itemIcon(k)}" title="${KINDS[k]?.name ?? k}" style="width:16px;height:16px;vertical-align:middle"/>`).join(' ') || '—'}</td></tr>`).join('');
  $('resultsBody').innerHTML = `<div class="muted">${MAPS[m.map]?.name ?? m.map} · Переполох ${m.panic} %</div><table><tr><th>Крыса</th><th></th><th>Добыча</th></tr>${rows}</table>`;
  $('resultsNote').textContent = 'Добыча вынесших уже на Складе Стаи — вари Зелья в Норе.';
  $('screenResults').classList.add('open');
}

// ---------- события → тосты ----------
let toastTimer = 0;
function toast(t: string) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el.classList.remove('on'), 2200); }
const EVENT_SFX: Record<string, string> = { hit: 'hit', hurt: 'hurt', pick: 'pick', stomp: 'stomp', swing: 'swing', scream: 'scream', panic: 'panic', steal: 'steal', pigeondead: 'pigeondead', kill: 'kill', cat: 'cat', drink: 'drink', mark: 'mark', eat: 'eat', infect: 'infect', sick: 'sick', weak: 'sick', down: 'down', dead: 'dead', revive: 'revive', exit: 'exit', luk: 'luk', stage: 'stage', nofit: 'nofit', catdead: 'kill' };
function onEvent(e: Event) {
  const sfx = EVENT_SFX[e.k];
  if (sfx) { const g = e.x || e.y ? (me ? falloff(e.x - me.x, e.y - me.y) : 0.5) : 1; audio.play(sfx, g); }
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
    case 'drink': toast('Попила — теперь можно пометить еду (Действие у еды)'); break;
    case 'mark': toast('Еда помечена. Ждём, кто съест…'); break;
    case 'infect': toast(`🤢 ${e.a} заражён`); break;
    case 'sick': toast(`${e.a} болеет — роняет Гной`); break;
    case 'weak': toast(`${e.a} ослаб — добивай одна`); break;
  }
  if (e.x || e.y) fx(e);
}

// ---------- рендер ----------
const app = new Application();
await app.init({ canvas: $('game') as HTMLCanvasElement, resizeTo: window, background: '#1a1612', antialias: false, resolution: Math.min(2, devicePixelRatio || 1), autoDensity: true, roundPixels: true });
const bgStage = new Container(); app.stage.addChild(bgStage); // параллакс-фон (сгенерированные слои), экранные координаты
const stage = new Container(); app.stage.addChild(stage);
let levelSprite: Sprite | null = null;
// слои параллакса по темам: имя файла и скорость относительно камеры
const PARALLAX: Record<string, [string, number][]> = {
  yard: [['yard_far', 0.12], ['yard_mid', 0.4], ['yard_near', 0.75]],
  kitchen: [['kitchen_far', 0.1], ['kitchen_mid', 0.35], ['kitchen_near', 0.7]],
  roof: [['roof_far', 0.08], ['roof_mid', 0.35], ['roof_near', 0.75]],
};
let bgLayers: { sp: TilingSprite; speed: number }[] = [];
let bgGen = 0;
async function buildBackdrop(themeId: string) {
  const gen = ++bgGen;
  for (const l of bgLayers) l.sp.destroy(); bgLayers = [];
  for (const [name, speed] of PARALLAX[themeId] ?? []) {
    try {
      const t: Texture = await Assets.load(`${import.meta.env.BASE_URL}bg/${name}.png`);
      if (gen !== bgGen) return;
      t.source.scaleMode = 'nearest';
      const sp = new TilingSprite({ texture: t, width: 2000, height: t.height });
      bgStage.addChild(sp); bgLayers.push({ sp, speed });
    } catch (e) { console.warn('bg', name, e); }
  }
}
const marks = new Container(); const ents = new Container(); const fxLayer = new Container();
stage.addChild(marks, ents, fxLayer);

function buildLevel(l: Level, themeId: string) {
  const theme = THEMES[themeId] ?? THEMES.yard;
  app.renderer.background.color = theme.bg;
  if (levelSprite) { levelSprite.destroy({ texture: true }); }
  void buildBackdrop(themeId);
  const t = Texture.from(drawLevel(l.cols, l.rows, l.solid, theme, !!PARALLAX[themeId])); t.source.scaleMode = 'nearest';
  levelSprite = new Sprite(t); stage.addChildAt(levelSprite, 0);
  for (const m of marks.children) m.destroy(); marks.removeChildren();
  for (const wtr of l.water) { const s = new Sprite(tex('water', WATER)); s.position.set(wtr.x, wtr.y); marks.addChild(s); }
  for (const v of ents.children) v.destroy(); ents.removeChildren();
  views.clear();
}

type View = { c: Container; sp: Sprite; extra: Sprite; g: Graphics; label: Text; bar: Graphics; anim: number; biteOn?: boolean };
const views = new Map<string, View>();
function view(key: string, t?: Texture): View {
  let v = views.get(key);
  if (!v) {
    const c = new Container(), sp = new Sprite(t ?? Texture.EMPTY), extra = new Sprite(Texture.EMPTY), g = new Graphics();
    extra.visible = false;
    const label = new Text({ text: '', resolution: 4, style: { fontFamily: 'monospace', fontSize: 7, fill: 0xe8d9c0, fontWeight: '700' } }); label.anchor.set(0.5, 1);
    const bar = new Graphics();
    c.addChild(extra, sp, g, label, bar); ents.addChild(c);
    v = { c, sp, extra, g, label, bar, anim: 0 }; views.set(key, v);
  }
  return v;
}
const COLORS = [0x8f8378, 0x6f8fa3, 0xa38f6f, 0x7fa36f, 0xa36f9a, 0x6fa39b];
const NO_LOOK: Look = { fat: 0, acid: 0, alive: 0, sweet: 0, infect: 0, loud: 0, sticky: 0, rot: 0 };
function mix(a: number, b: number, k: number) { k = Math.min(1, k); const ch = (x: number, s: number) => (x >> s) & 255; const r = Math.round(ch(a, 16) * (1 - k) + ch(b, 16) * k), g = Math.round(ch(a, 8) * (1 - k) + ch(b, 8) * k), bl = Math.round(ch(a, 0) * (1 - k) + ch(b, 0) * k); return (r << 16) | (g << 8) | bl; }
const colorOf = (id: string) => COLORS[(Number(id) - 1 + 600) % COLORS.length];
// крыса — векторная, как в прототипах (пользователю она нравится больше спрайта)
function drawRat(v: View, r: { facing: 1 | -1; grounded: boolean; biting: boolean; down: boolean; dead: boolean; vx: number; biteT?: number }, color: number, t: number, look: Look = NO_LOOK) {
  const b = v.g; b.clear(); v.sp.visible = false; v.extra.visible = false;
  // внешность от Мутаций: Гнилое темнит и зеленит шерсть, Сладкое розовит
  if (look.rot) color = mix(color, 0x5a6a3a, 0.25 * look.rot); if (look.sweet) color = mix(color, 0xf0b0c0, 0.2 * look.sweet);
  const f = r.facing, dark = color + 0x0d0c0c;
  if (r.dead) { b.rect(0, 6, 14, 4).fill(0x333333); return; }
  if (r.down) { b.ellipse(7, 7, 8, 3).fill(color); b.circle(f > 0 ? 13 : 1, 7, 2.5).fill(dark); b.rect(5, 2, 1, 1).fill(0xffffff); return; }
  const sq = r.grounded && !r.biting ? 0 : 1;
  const fat = Math.min(6, look.fat) * 0.6;            // Жирная мышь: шире и круглее, без предела
  const legLen = look.sticky ? 1 + look.sticky : 0;    // Липучка: длинные лапы
  const wag = Math.abs(r.vx) > 10 ? Math.sin(t / 3) * 3 : Math.sin(t / 8) * 1.5;
  b.moveTo(f > 0 ? 0 : 14, 7).lineTo(f > 0 ? -9 : 23, 4 + wag).stroke({ width: 1.5, color: 0xc9a58a });
  b.roundRect(-fat / 2, 1 + sq - fat * 0.6, 14 + fat, 9 - sq + fat * 0.6, 4 + fat * 0.3).fill(color);
  if (look.alive) { b.circle(f > 0 ? 11 : 3, 1.5 - look.alive * 0.4, 1.6 + look.alive * 0.5).fill(0xe8a0a0); b.circle(f > 0 ? 4 : 10, 5, 1.2).fill({ color: 0xff8090, alpha: 0.5 }); } // Живучка: ушастая и румяная
  else b.circle(f > 0 ? 11 : 3, 1.5, 1.6).fill(0xd9a5a5);
  b.circle(f > 0 ? 13 : 1, 4, 3.2 + (look.loud ? 0.6 : 0)).fill(dark);
  b.circle(f > 0 ? 15 : -1, 4, 0.9).fill(0xffb0c0);
  b.circle(f > 0 ? 13.5 : 0.5, 3, 0.7).fill(0x111111);
  if (look.loud) b.ellipse(f > 0 ? 14.5 : -0.5, 5.5, 1.4, 0.9 + 0.3 * look.loud).fill(0x401010);   // Визгунья: пасть нараспашку
  if (look.acid) { b.rect(f > 0 ? 14 : -1, 6, 1, 1 + look.acid).fill(0x9cff5a); b.rect(f > 0 ? 12 : 1, 6, 1, 1).fill(0x9cff5a); }  // Кислотная пасть: зелёная слюна
  if (look.infect) for (let i = 0; i < look.infect + 1; i++) b.circle(3 + ((i * 5) % 9), 3 + ((i * 3) % 5), 0.9).fill(0x6fbf3a); // Чумная: пятна
  if (look.rot) for (let i = 0; i < look.rot; i++) b.circle(7 + Math.sin(t / 7 + i * 2) * 7, -2 + Math.cos(t / 5 + i) * 2, 0.6).fill(0x222222); // Вонючка: мухи
  if (look.sweet && Math.floor(t / 10 + 0) % 3 === 0) b.rect(2 + (t % 10), -1, 1, 1).fill(0xffffff);  // Сахарная: блёстки
  const ly = 9 + (look.sticky ? 0 : 0);
  if (r.grounded && Math.abs(r.vx) > 10) { const ph = Math.floor(t / 5) % 2; b.rect(2 + ph * 2, ly, 2, 1 + legLen).fill(dark); b.rect(9 - ph * 2, ly, 2, 1 + legLen).fill(dark); }
  else if (legLen) { b.rect(2, ly, 2, 1 + legLen).fill(dark); b.rect(10, ly, 2, 1 + legLen).fill(dark); }
  if (r.biting) {
    // анимация укуса: вариант выбирается на старте укуса (v.anim), прогресс p 0→1 за время укуса
    if (!v.biteOn) { v.biteOn = true; v.anim = Math.floor(Math.random() * 3); }
    const p = Math.min(1, Math.max(0, 1 - (r.biteT ?? 0))), f = r.facing, cx = f > 0 ? 17 : -3, cy = 4;
    const cols = [0xfff1b0, 0xffd27a, 0xffffff];
    if (v.anim === 0) { // дуга-взмах с зубами на кончике
      const rad = 4 + p * 6, a0 = (f > 0 ? -1.2 : Math.PI - 1.2) + p * 0.6, a1 = a0 + 1.6 + p * 0.6;
      b.arc(cx, cy, rad, a0, a1).stroke({ width: 2.5 - p, color: cols[0], alpha: 1 - p * 0.7 });
      const tx = cx + Math.cos(a1) * rad, ty = cy + Math.sin(a1) * rad; b.poly([tx, ty, tx + f * 3, ty - 2, tx + f * 1, ty + 2]).fill({ color: 0xffffff, alpha: 1 - p });
    } else if (v.anim === 1) { // двойной хрум: верхняя и нижняя челюсти смыкаются
      const gap = (1 - p) * 6 + 1, L = 7 + p * 3;
      b.moveTo(cx, cy - gap).lineTo(cx + f * L, cy - gap - 2).lineTo(cx + f * (L - 2), cy - gap + 1).stroke({ width: 2, color: cols[1], alpha: 1 - p * 0.5 });
      b.moveTo(cx, cy + gap).lineTo(cx + f * L, cy + gap + 2).lineTo(cx + f * (L - 2), cy + gap - 1).stroke({ width: 2, color: cols[1], alpha: 1 - p * 0.5 });
      if (p > 0.6) for (let i = 0; i < 3; i++) b.rect(cx + f * (3 + i * 3), cy - 1 + (i % 2) * 2, 1.5, 1.5).fill({ color: 0xffffff, alpha: (1 - p) * 2 });
    } else { // искры из точки укуса
      const n = 6, len = Math.sin(p * Math.PI) * 7;
      for (let i = 0; i < n; i++) { const ang = (f > 0 ? -0.9 : Math.PI - 0.9) + (i / (n - 1)) * 1.8; const sx = cx + f * 2, sy = cy; b.moveTo(sx + Math.cos(ang) * 2, sy + Math.sin(ang) * 2).lineTo(sx + Math.cos(ang) * (2 + len), sy + Math.sin(ang) * (2 + len)).stroke({ width: 1.5, color: cols[i % 3], alpha: 1 - p }); }
    }
  } else v.biteOn = false;
}
const LABEL_STYLE: Record<string, { text: string; fill: number; size: number }> = {
  windup: { text: '!!', fill: 0xff4040, size: 10 }, panic: { text: '!', fill: 0xffd040, size: 9 }, chase: { text: '>', fill: 0xff8040, size: 9 }, sleep: { text: 'z', fill: 0x9fb0ff, size: 8 },
};
function fx(e: Event) {
  const mk = (text: string, fill: number, size: number) => {
    const n = new Text({ text, resolution: 4, style: { fontSize: size, fontWeight: '700', fill, stroke: { color: 0x000000, width: 2 } } });
    n.anchor.set(0.5, 1); n.position.set(e.x + 6, e.y - 4); fxLayer.addChild(n);
    const born = performance.now();
    const tk = () => { const a = (performance.now() - born) / 800; if (a >= 1) { app.ticker.remove(tk); n.destroy(); return; } n.y -= 0.5; n.alpha = 1 - a * a; };
    app.ticker.add(tk);
  };
  switch (e.k) {
    case 'hit': {
      const weak = e.b === 'weak';
      mk(weak ? `-${e.a} (стаей!)` : `-${e.a}`, weak ? 0xbbbbbb : 0xffe066, weak ? 8 : 12);
      for (const [k, v] of views) if ((k[0] === 'h' || k[0] === 'p') && Math.abs(v.c.x - e.x) < 20 && Math.abs(v.c.y - e.y) < 30) { v.sp.tint = 0xff4040; setTimeout(() => { if (!v.sp.destroyed) v.sp.tint = 0xffffff; }, 150); }
      break;
    }
    case 'hurt': mk(`-${e.a}`, 0xff5050, 12); break;
    case 'pick': { const s = new Sprite(itemTex(e.b ?? '')); s.position.set(e.x, e.y - 6); fxLayer.addChild(s); const born = performance.now(); const tk = () => { const a = (performance.now() - born) / 500; if (a >= 1) { app.ticker.remove(tk); s.destroy(); return; } s.y -= 0.6; s.alpha = 1 - a; }; app.ticker.add(tk); break; }
    case 'stomp': mk('ТОП', 0xffffff, 8); break;
    case 'swing': mk('ХРЯСЬ', 0xffffff, 8); break;
    case 'scream': mk('А-А-А!', 0xffd040, 9); break;
    case 'steal': mk('спёр!', 0xffffff, 8); break;
    case 'kill': mk('+Орган', 0xff6080, 9); break;
    case 'pigeondead': mk('+перо', 0xdddddd, 8); break;
    case 'cat': mk('МЯУ', 0xffa040, 10); break;
  }
}
function itemTex(kind: string): Texture { const k = KINDS[kind]; return k ? tex('item_' + k.type, ITEM[k.type]) : Texture.EMPTY; }

// ---------- цикл ----------
let acc = 0, last = performance.now(), frame = 0, prevX = 0, prevY = 0;
app.ticker.add(() => {
  const now = performance.now();
  acc += Math.min(0.1, (now - last) / 1000); last = now; frame++;
  if ((phase !== 'raid' && phase !== 'lobby') || !level) return;
  while (acc >= TICK) {
    acc -= TICK;
    const s = touch.sample();
    if (phase === 'lobby' && s.act) { const st = stationHere(); if (st) openSheet(st); }
    if (me) {
      const input: Input = { seq: ++seq, ...s };
      prevX = me.x; prevY = me.y;
      const wasGrounded = me.grounded, wasBite = me.biteCd;
      if (s.bite && wasBite === 0 && !me.down) audio.play('bite');
      stepRat(level, me, input, solidOthers(), raidModsCur.slippery, raidModsCur.sticky); pendingInputs.push(input);
      if (wasGrounded && me.vy < -150) audio.play('jump');
      if (!wasGrounded && me.grounded) audio.play('land');
      if (me.grounded && Math.abs(me.vx) > 40 && seq % 14 === 0) audio.play('step', 0.6);
      net.sendInput(input, lastServerMe?.s ?? 0);
    }
  }
  const a = acc / TICK;
  const scale = Math.max(1, Math.min(app.screen.width / VIEW_W, app.screen.height / VIEW_H));
  stage.scale.set(scale);

  const renderAt = now - INTERP_MS;
  let s0 = snaps[0], s1 = snaps[snaps.length - 1];
  for (let i = 0; i < snaps.length; i++) { if (snaps[i].at <= renderAt) s0 = snaps[i]; if (snaps[i].at >= renderAt) { s1 = snaps[i]; break; } }
  const t = s0 && s1 && s1.at > s0.at ? Math.min(1, Math.max(0, (renderAt - s0.at) / (s1.at - s0.at))) : 1;
  const seen = new Set<string>();

  let camX = level.spawns[0].x, camY = level.spawns[0].y;
  if (me) {
    const rx = prevX + (me.x - prevX) * a, ry = prevY + (me.y - prevY) * a;
    const v = view('r' + myId); v.c.position.set(Math.round(rx), Math.round(ry)); v.label.text = ''; seen.add('r' + myId);
    drawRat(v, { facing: me.facing, grounded: me.grounded, biting: me.biteLeft > 0, down: me.down, dead: me.dead, vx: me.vx, biteT: me.biteLeft / PHYS.biteDur }, colorOf(myId), frame, lookOf(myId));
    v.g.alpha = me.inv > 0 && Math.floor(frame / 3) % 2 ? 0.4 : 1;
    v.bar.clear(); if (me.down) v.bar.rect(0, -6, 14 * (me.revive / RULES.reviveTime), 2).fill(0x6fb06f);
    else if (me.exitProg > 0) v.bar.rect(0, -6, 14 * me.exitProg, 2).fill(0xe8d9c0);
    else if (me.act > 0) v.bar.rect(0, -6, 14 * me.act, 2).fill(0x7fd3ff);
    if (me.water) v.bar.circle(16, -4, 2).fill(0x7fd3ff);
    camX = rx; camY = ry;
    if (me.exited || me.dead) { const alive = s1?.rats.find((r) => !r.dd && !r.ex && r.id !== myId); if (alive) { camX = alive.x; camY = alive.y; } }
  }
  if (s1) {
    for (const r1 of s1.rats) {
      if (r1.id === myId) continue;
      const r0 = s0?.rats.find((r) => r.id === r1.id) ?? r1;
      const x = r0.x + (r1.x - r0.x) * t, y = r0.y + (r1.y - r0.y) * t;
      const v = view('r' + r1.id); v.c.position.set(Math.round(x), Math.round(y)); v.label.text = r1.n; v.label.position.set(7, -3); seen.add('r' + r1.id);
      drawRat(v, { facing: r1.f, grounded: r1.g === 1, biting: r1.b > 0, down: r1.dn === 1, dead: r1.dd === 1, vx: r1.vx, biteT: r1.b / PHYS.biteDur }, colorOf(r1.id), frame, lookOf(r1.id));
      v.bar.clear(); if (r1.dn) v.bar.rect(0, -6, 14 * (r1.rv / RULES.reviveTime), 2).fill(0x6fb06f);
      if (r1.wt) v.bar.circle(16, -4, 2).fill(0x7fd3ff);
      v.c.visible = !r1.ex;
    }
    for (const h1 of s1.hu) {
      const h0 = s0?.hu.find((h) => h[0] === h1[0]) ?? h1;
      const x = h0[2] + (h1[2] - h0[2]) * t, y = h0[3] + (h1[3] - h0[3]) * t;
      const info = HUMAN_INFO[h1[1]];
      const v = view('h' + h1[0]); seen.add('h' + h1[0]);
      const moving = h1[5] === 'walk' || h1[5] === 'panic' || h1[5] === 'chase';
      const speed = h1[5] === 'panic' || h1[5] === 'chase' ? 4 : 8;
      const frameKey = moving && Math.floor(frame / speed) % 2 ? 'b' : 'a';
      v.sp.texture = tex('h' + h1[1] + frameKey, HUMANS[h1[1]][frameKey]);
      v.sp.anchor.set(0.5, 1); v.sp.position.set(info.w / 2, info.h); v.sp.scale.x = h1[4];
      v.extra.visible = h1[1] === 'D';
      if (v.extra.visible) { v.extra.texture = tex('broom', BROOM); v.extra.anchor.set(0.5, 1); v.extra.position.set(info.w / 2 + h1[4] * 7, info.h); v.extra.scale.x = h1[4]; v.extra.rotation = h1[5] === 'windup' ? -h1[4] * 0.9 : h1[5] === 'chase' ? -h1[4] * 0.3 : 0; }
      v.c.position.set(Math.round(x), Math.round(y));
      const inf = h1[7]; v.sp.tint = inf === 0 ? 0xffffff : inf === 1 ? 0xd8f0c0 : inf === 2 ? 0xa8e088 : 0x70b060;
      const ls = LABEL_STYLE[h1[5]] ?? (inf === 3 ? { text: 'ослаб', fill: 0x70e060, size: 7 } : inf === 2 ? { text: 'болеет', fill: 0xa0e080, size: 7 } : h1[5] === 'eat' ? { text: 'ням', fill: 0xffffff, size: 7 } : undefined);
      v.label.text = ls?.text ?? ''; if (ls) { v.label.style.fill = ls.fill; v.label.style.fontSize = ls.size; } v.label.position.set(info.w / 2, -2);
      v.bar.clear(); if (h1[6] < info.hp) { v.bar.rect(0, -1, info.w, 1.5).fill(0x301010); v.bar.rect(0, -1, info.w * (h1[6] / info.hp), 1.5).fill(0xd04040); }
    }
    for (const p1 of s1.pg) {
      const p0 = s0?.pg.find((p) => p[0] === p1[0]) ?? p1;
      const x = p0[2] + (p1[2] - p0[2]) * t, y = p0[3] + (p1[3] - p0[3]) * t;
      const v = view('p' + p1[0]); seen.add('p' + p1[0]);
      const flying = p1[4] !== 'perch' && p1[4] !== 'hold';
      v.sp.texture = tex('pg' + (flying && Math.floor(frame / 4) % 2 ? 'b' : 'a'), PIGEON[flying && Math.floor(frame / 4) % 2 ? 'b' : 'a']);
      v.sp.anchor.set(0.5, 0.5); v.sp.position.set(0, 0); v.sp.scale.x = p1[2] - p0[2] < 0 ? -1 : 1;
      v.sp.tint = p1[1] === 'F' ? 0xd0b0b0 : 0xffffff;
      v.extra.visible = !!p1[5]; if (v.extra.visible) { v.extra.texture = itemTex(p1[5]); v.extra.anchor.set(0.5, 0); v.extra.position.set(0, 4); v.extra.tint = ITEM_TINT[p1[5]] ?? 0xffffff; v.extra.scale.x = 1; }
      v.c.position.set(Math.round(x), Math.round(y));
      v.label.text = p1[1] === 'F' && p1[4] === 'attack' ? '!' : ''; v.label.style.fill = 0xff8040; v.label.position.set(0, -6);
    }
    for (const i1 of s1.it) {
      const v = view('i' + i1[0]); seen.add('i' + i1[0]);
      v.sp.texture = itemTex(i1[1]); v.sp.tint = i1[4] ? 0xffe040 : ITEM_TINT[i1[1]] ?? 0xffffff; v.sp.anchor.set(0, 0); v.sp.position.set(0, 0); v.sp.scale.x = 1;
      v.label.text = i1[4] ? '~' : ''; v.label.style.fill = 0xffe040; v.label.position.set(4, -1);
      v.c.position.set(i1[2], i1[3] - 1 + Math.round(Math.sin((frame + i1[0] * 7) / 20)));
    }
    for (const e of s1.ex) {
      const key = 'e' + e[0] + e[1]; const v = view(key); seen.add(key);
      v.sp.texture = tex('exit' + e[0], EXITS[e[0]]); v.sp.anchor.set(0, 0); v.sp.position.set(0, 0); v.sp.scale.x = 1; v.sp.alpha = e[3] ? 1 : 0.6;
      v.extra.visible = !e[3]; if (v.extra.visible) { v.extra.texture = tex('lock', EXITS.lock); v.extra.anchor.set(0, 0); v.extra.position.set(0, -6); }
      v.c.position.set(e[1], e[2]); v.label.text = EXIT_INFO[e[0]].name; v.label.style.fill = 0xe8d9c0; v.label.style.fontSize = 7; v.label.position.set(8, -8);
    }
    if (s1.cat) {
      const c0 = s0?.cat ?? s1.cat; const v = view('cat'); seen.add('cat');
      v.sp.texture = tex('cat' + (Math.floor(frame / 6) % 2 ? 'b' : 'a'), CAT[Math.floor(frame / 6) % 2 ? 'b' : 'a']); v.sp.anchor.set(0.5, 1); v.sp.position.set(11, 14); v.sp.scale.x = s1.cat[2] > 0 ? 1 : -1;
      v.c.position.set(Math.round(c0[0] + (s1.cat[0] - c0[0]) * t), Math.round(c0[1] + (s1.cat[1] - c0[1]) * t));
    }
    for (const [k, v] of views) if (!seen.has(k)) { v.c.destroy(); views.delete(k); }

    if (frame % 6 === 0 && phase === 'lobby') {
      const st = stationHere();
      $('hint').textContent = st ? `ДЕЙСТ. — ${NORA_STATIONS.find((x) => x.id === st)!.name}: ${NORA_STATIONS.find((x) => x.id === st)!.hint}` : '';
      if (openStation && st !== openStation) closeSheet();

      $('info').textContent = `ping ${net.rtt} · ${Math.round(app.ticker.FPS)} fps`;
    }
    if (frame % 6 === 0 && phase === 'raid') {
      const meS = s1.rats.find((r) => r.id === myId);
      $('panicFill').style.width = s1.panic + '%';
      audio.setMusic(s1.panic >= 60 ? 'tense' : 'raid');
      if (meS) {
        $('hpFill').style.width = Math.round((meS.hp / (meS.mh || 100)) * 100) + '%';
        $('hpFill').style.background = meS.hp > 50 ? '#6fb06f' : meS.hp > 25 ? '#d0a040' : '#d04040';
        const key = meS.pk.join(',');
        if (key !== lastPocketsKey) {
          lastPocketsKey = key;
          let cells = ''; let used = 0;
          for (const k of meS.pk) { const kd = KINDS[k]; used += kd.size; cells += `<span class="full t-${kd.type}" style="height:${26 * kd.size + 2 * (kd.size - 1)}px"><img src="${itemIcon(k, 3)}" alt="${kd.name}"/><i>${kd.name}</i>${kd.size > 1 ? `<em>×${kd.size}</em>` : ''}</span>`; }
          for (let i = used; i < (meS.pc ?? RULES.pockets); i++) cells += '<span><em>пусто</em></span>';
          $('pockets').innerHTML = cells;
        }
        $('info').textContent = `${meS.dn ? `лежишь ${meS.dl.toFixed(0)} с · ` : ''}${meS.ex ? 'вынесла · ' : ''}${meS.dd ? 'погибла · ' : ''}ping ${net.rtt} · ${Math.round(app.ticker.FPS)} fps`;
      }
    }
  }
  const cx = Math.max(0, Math.min(level.cols * TILE - app.screen.width / scale, camX + RAT_W / 2 - app.screen.width / scale / 2));
  const cy = Math.max(0, Math.min(level.rows * TILE - app.screen.height / scale, camY + RAT_H / 2 - app.screen.height / scale / 2));
  stage.position.set(-Math.round(cx * scale), -Math.round(cy * scale));
  // параллакс: слои в экранных координатах, низ слоя — у низа уровня, сдвиг по камере со своей скоростью
  if (bgLayers.length) {
    bgStage.scale.set(scale);
    const viewW = app.screen.width / scale, viewH = app.screen.height / scale, levelH = level.rows * TILE;
    const cyMax = Math.max(0, levelH - viewH);
    for (const { sp, speed } of bgLayers) {
      sp.width = viewW + 2; sp.tilePosition.x = -cx * speed;
      sp.y = viewH - sp.height + (cyMax - cy) * speed;
    }
  }
});
let lastPocketsKey: string | null = null;
