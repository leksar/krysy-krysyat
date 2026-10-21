// Сервер «Крысы крысят»: комнаты по коду, лобби → Вылазка → итоги, авторитетная симуляция из @krysy/sim.
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { createWorld, createNoraWorld, addRat, stepRat, stepWorld, snapWorld, stationAt, MAPS, TICK, TICK_HZ, EMPTY_INPUT, KINDS, brew, drink, raidMods, ratMods, type Input, type World, type Phase, type Potion, type StationId } from '@krysy/sim';
import { Store, BUILD_INFO, type Profile, type Builds } from './store.js';

const PORT = Number(process.env.PORT ?? 2567);
const MAX_RATS = 6;
const SNAP_EVERY = 3; // 60 Гц тик → 20 Гц снапшоты
const RESULTS_SEC = 15;
const VERSION = 'v1-nora';
const BUILD = process.env.BUILD_SHA ?? 'dev'; // одинаков у клиента и сервера, если собраны из одного коммита
const DB_PATH = (process.env.DB_PATH ?? 'data/krysy.json').replace(/\.sqlite$/, '.json');
const store = new Store(DB_PATH);
process.on('SIGTERM', () => { store.flush(); process.exit(0); });
process.on('SIGINT', () => { store.flush(); process.exit(0); });

type Peer = { ws: WebSocket; id: string; name: string; room: Room; queue: Input[]; last: Input; alive: boolean; profile: Profile; transAt: number; ignoreBelow: number; net: NetStats };
/** Диагностика соединения: RTT по ws ping/pong, входящие пакеты ввода, стойлы (>1 с без ввода в Вылазке), пиковая очередь */
type NetStats = { rtt: number; pingAt: number; inPk: number; inSeq: number; lastInAt: number; stalls: number; maxQ: number; since: number; ip: string; ua: string };
type Room = { code: string; peers: Map<string, Peer>; hostId: string | null; map: string; phase: Phase; world: World | null; nora: World; phaseLeft: number; seed: number; pour: number[] };
const rooms = new Map<string, Room>();
let nextId = 1;

const http = createServer((req, res) => {
  if (req.url === '/rooms') {
    const list = [...rooms.values()].map((r) => ({ code: r.code, phase: r.phase, map: MAPS[r.map]?.name ?? r.map, players: [...r.peers.values()].map((p) => p.name) }));
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(JSON.stringify(list)); return;
  }
  if (req.url === '/health' || req.url === '/') {
    const r: Record<string, unknown> = {};
    for (const [c, room] of rooms) r[c] = { phase: room.phase, map: room.map, rats: room.peers.size, queues: [...room.peers.values()].map((p) => p.queue.length), net: [...room.peers.values()].map((p) => ({ name: p.name, rtt: p.net.rtt, stalls: p.net.stalls, maxQ: p.net.maxQ, ua: p.net.ua })) };
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, version: VERSION, build: BUILD, tps: tpsLast, rooms: r }));
  } else { res.writeHead(404); res.end(); }
});
const wss = new WebSocketServer({ server: http, maxPayload: 4096 });

function getRoom(code: string): Room {
  let r = rooms.get(code);
  if (!r) { r = { code, peers: new Map(), hostId: null, map: 'yard', phase: 'lobby', world: null, nora: createNoraWorld(), phaseLeft: 0, seed: hash(code), pour: [] }; rooms.set(code, r); }
  return r;
}
function hash(s: string) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h | 0; }
const send = (ws: WebSocket, o: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(o)); };
const broadcast = (room: Room, o: unknown) => { const s = JSON.stringify(o); for (const p of room.peers.values()) if (p.ws.readyState === p.ws.OPEN) p.ws.send(s); };
function lobbyMsg(room: Room) {
  room.pour = room.pour.filter((id) => store.nora(room.code).potions.some((p) => p.id === id));
  const profiles: Record<string, unknown> = {}; for (const p of room.peers.values()) profiles[p.id] = { name: p.profile.name, dna: p.profile.dna, mut: p.profile.mut, raids: p.profile.raids, banked: p.profile.banked, pockets: p.profile.pockets };
  return { t: 'lobby', code: room.code, phase: room.phase, map: room.map, hostId: room.hostId, pour: room.pour, profiles, maps: Object.values(MAPS).map((m) => ({ id: m.id, name: m.name, desc: m.desc, locked: m.id !== 'yard' && !store.built(room.code, m.id as keyof Builds) })), players: [...room.peers.values()].map((p) => ({ id: p.id, name: p.name })) };
}
// Нора — своя у каждой комнаты (по коду): рассылаем комнате, своё («me») — каждому отдельно
function noraMsg(room: Room) {
  const n = store.nora(room.code);
  const builds: Record<string, unknown> = {};
  for (const k of ['cauldron', 'shelf', 'rack', 'kitchen', 'roof'] as (keyof Builds)[]) { const b = BUILD_INFO[k]; const lvl = n.builds[k]; builds[k] = { name: b.name, desc: b.desc(lvl), level: lvl, max: b.max, cost: lvl < b.max ? b.cost(lvl) : null, requires: b.requires && !store.built(room.code, b.requires) ? BUILD_INFO[b.requires].name : null }; }
  return { t: 'nora', stash: n.stash, potions: n.potions, cauldron: store.cauldronSize(room.code), builds, log: n.log.slice(-8) };
}
function meMsg(p: Profile) { const b = BUILD_INFO.pockets; return { t: 'me', name: p.name, code: p.code, dna: p.dna, mut: p.mut, raids: p.raids, banked: p.banked, mods: (() => { const m = ratMods(p.dna, p.mut); m.pockets += p.pockets; return m; })(), pockets: { level: p.pockets, max: b.max, cost: p.pockets < b.max ? b.cost(p.pockets) : null, desc: b.desc(p.pockets) } }; }
function pushNora(room: Room) { broadcast(room, noraMsg(room)); }

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const code = (url.searchParams.get('room') ?? 'XXXX').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'XXXX';
  const name = (url.searchParams.get('name') ?? '').trim().slice(0, 12) || `крыса${nextId}`;
  const acct = (url.searchParams.get('code') ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  if (acct.length < 6) { ws.close(4001, 'no account'); return; }
  // клиент другой сборки строит другую карту из того же сида — не пускаем, пусть перезагрузится
  const cv = url.searchParams.get('v') ?? 'dev';
  if (BUILD !== 'dev' && cv !== 'dev' && cv !== BUILD) { console.log(`✗ ${name}: client build ${cv} ≠ server ${BUILD}`); ws.close(4002, 'outdated'); return; }
  const room = getRoom(code);
  if (room.peers.size >= MAX_RATS) { ws.close(4000, 'full'); return; }
  const id = String(nextId++);
  const peer: Peer = { ws, id, name, room, queue: [], last: { ...EMPTY_INPUT }, alive: true, profile: store.profile(acct, name), transAt: 0, ignoreBelow: 0, net: { rtt: -1, pingAt: 0, inPk: 0, inSeq: 0, lastInAt: Date.now(), stalls: 0, maxQ: 0, since: Date.now(), ip: String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim(), ua: shortUa(String(req.headers['user-agent'] ?? '')) } };
  room.peers.set(id, peer);
  if (!room.hostId) room.hostId = id;
  console.log(`+ ${name} (#${id}) → ${code} [${room.peers.size}] ${peer.net.ip} ${peer.net.ua}`);
  send(ws, { t: 'welcome', id, tickHz: TICK_HZ, version: VERSION });
  send(ws, noraMsg(room)); send(ws, meMsg(peer.profile));
  if (room.phase !== 'raid') addRat(room.nora, id, name, peerMods(peer));
  // опоздавший в идущую Вылазку — заходит крысой у входа
  if (room.phase === 'raid' && room.world) { addRat(room.world, id, name, peerMods(peer)); send(ws, { t: 'raid', map: room.world.map, seed: room.seed, mods: room.world.mods, ratMods: Object.fromEntries([...room.world.rats.values()].map((r) => [r.id, r.mods])) }); }
  broadcast(room, lobbyMsg(room));

  ws.on('message', (data) => {
    let m: any; try { m = JSON.parse(String(data)); } catch { return; }
    switch (m.t) {
      case 'i': {
        peer.net.inPk++; peer.net.inSeq += (m.inputs as Input[]).length; peer.net.lastInAt = Date.now(); if (peer.queue.length > peer.net.maxQ) peer.net.maxQ = peer.queue.length;
        for (const i of m.inputs as Input[]) {
          if (typeof i.seq !== 'number') continue;
          // 500 мс после смены фазы вход закрыт: хвост пакетов прошлой фазы (в полёте ≤ RTT) не доходит до нового мира
          if (Date.now() - peer.transAt < 500) continue;
          let newest = peer.queue.length ? peer.queue[peer.queue.length - 1].seq : peer.last.seq;
          if (i.seq + 200 < newest) { peer.queue = []; peer.last = { ...peer.last, seq: i.seq - 1 }; newest = i.seq - 1; } // клиент сбросил счётчик — принимаем заново
          if (i.seq <= newest) continue;
          if (peer.queue.length > 60) break;
          peer.queue.push({ seq: i.seq, moveX: clamp(Number(i.moveX) || 0, -1, 1), jump: !!i.jump, jumpHeld: !!i.jumpHeld, bite: !!i.bite, act: !!i.act, actHeld: !!i.actHeld });
        }
        break;
      }
      case 'ping': send(ws, { t: 'pong', c: m.c }); break;
      case 'setMap': if (peer.id === room.hostId && room.phase === 'lobby' && MAPS[m.map] && at(peer, 'table') && (m.map === 'yard' || store.built(room.code, m.map as keyof Builds))) { room.map = m.map; broadcast(room, lobbyMsg(room)); } break;
      case 'start': if (peer.id === room.hostId && room.phase === 'lobby' && at(peer, 'tunnel')) startRaid(room); break;
      case 'back': if (room.phase === 'results') toLobby(room); break;
      // --- Нора ---
      case 'brew': {
        if (!at(peer, 'cauldron')) { send(ws, { t: 'err', text: 'Подойди к Котлу' }); break; }
        if (!store.built(room.code, 'cauldron')) { send(ws, { t: 'err', text: 'Котёл ещё не построен' }); break; }
        const kinds: string[] = Array.isArray(m.kinds) ? m.kinds.filter((k: unknown) => typeof k === 'string' && KINDS[k]).slice(0, store.cauldronSize(room.code)) : [];
        if (kinds.length < 2) { send(ws, { t: 'err', text: 'В Котёл нужно хотя бы 2 Ингредиента' }); break; }
        if (!store.take(room.code, kinds)) { send(ws, { t: 'err', text: 'На Складе столько нет' }); break; }
        const pot = brew(store.nora(room.code).nextPotion++, kinds); store.nora(room.code).potions.push(pot); store.log(room.code, `${peer.name} сварила Зелье #${pot.id}`); store.save(); pushNora(room); break;
      }
      case 'pour': {
        if (peer.id !== room.hostId || room.phase !== 'lobby' || !at(peer, 'shelf') || !store.built(room.code, 'shelf')) break;
        const id = Number(m.id); if (!store.nora(room.code).potions.some((p) => p.id === id)) break;
        if (room.pour.includes(id)) room.pour = room.pour.filter((x) => x !== id); else if (room.pour.length < 2) room.pour.push(id);
        broadcast(room, lobbyMsg(room)); break;
      }
      case 'drink': {
        if (!at(peer, 'shelf') || !store.built(room.code, 'shelf')) { send(ws, { t: 'err', text: 'Подойди к построенной Полке' }); break; }
        const id = Number(m.id); const i = store.nora(room.code).potions.findIndex((p) => p.id === id); if (i < 0) break;
        const pot = store.nora(room.code).potions.splice(i, 1)[0];
        for (const r of rooms.values()) r.pour = r.pour.filter((x) => x !== id);
        const res = drink(peer.profile.dna, peer.profile.mut, pot);
        store.log(room.code, `${peer.name} выпила Зелье #${pot.id}${res.family ? ` → ${res.family} ${res.tier}` : ''}`); store.save();
        send(ws, { t: 'drank', family: res.family, tier: res.tier }); send(ws, meMsg(peer.profile)); pushNora(room); broadcast(room, lobbyMsg(room)); break;
      }
      case 'build': {
        const k = m.what as keyof Builds; const b = BUILD_INFO[k]; if (!b) break;
        const site = k === 'pockets' ? 'rack' : k === 'kitchen' || k === 'roof' ? 'table' : k;
        if (!at(peer, site)) { send(ws, { t: 'err', text: 'Подойди к стройплощадке' }); break; }
        if (b.requires && !store.built(room.code, b.requires)) { send(ws, { t: 'err', text: `Сначала построй: ${BUILD_INFO[b.requires].name}` }); break; }
        if (k === 'pockets') { // личная постройка крысы за общие Ингредиенты
          const lvl = peer.profile.pockets; if (lvl >= b.max) break;
          if (!store.payByType(room.code, b.cost(lvl))) { send(ws, { t: 'err', text: 'Не хватает Ингредиентов' }); break; }
          peer.profile.pockets = lvl + 1; store.log(room.code, `${peer.name} расширила свои Карманы до ${lvl + 1}`); store.save(); send(ws, meMsg(peer.profile)); pushNora(room); broadcast(room, lobbyMsg(room)); break;
        }
        const lvl = store.nora(room.code).builds[k]; if (lvl >= b.max) break;
        if (!store.payByType(room.code, b.cost(lvl))) { send(ws, { t: 'err', text: 'Не хватает Ингредиентов' }); break; }
        store.nora(room.code).builds[k] = lvl + 1; store.log(room.code, `${peer.name} построила: ${b.name}${b.max > 1 ? ' ' + (lvl + 1) : ''}`); store.save(); pushNora(room);
        if (k === 'kitchen' || k === 'roof') for (const r of rooms.values()) broadcast(r, lobbyMsg(r));
        break;
      }
      case 'abort': if (peer.id === room.hostId && room.phase === 'raid' && room.world) { console.log(`✖ ${room.code}: aborted by host`); room.world.over = true; } break;
    }
  });
  ws.on('close', (ccode, creason) => {
    const n = peer.net; console.log(`- ${name} (#${id}) ← ${code} [${room.peers.size - 1}] close=${ccode}${creason?.length ? ' ' + creason : ''} ${Math.round((Date.now() - n.since) / 1000)}s rtt=${n.rtt}ms stalls=${n.stalls} maxQ=${n.maxQ}`);
    room.peers.delete(id);
    room.nora.rats.delete(id);
    if (room.world) { const r = room.world.rats.get(id); if (r && !r.exited) { r.dead = true; } }
    if (room.hostId === id) room.hostId = room.peers.keys().next().value ?? null;
    if (!room.peers.size) rooms.delete(code); else broadcast(room, lobbyMsg(room));
  });
  ws.on('pong', () => { peer.alive = true; if (peer.net.pingAt) peer.net.rtt = Math.round(performance.now() - peer.net.pingAt); });
});

/** Крыса стоит у станции Норы (сервер не верит клиенту на слово) */
function at(p: Peer, id: StationId): boolean { if (p.room.phase !== 'lobby') return false; const r = p.room.nora.rats.get(p.id); return !!r && stationAt(r.x, r.y)?.id === id; }
/** Смена фазы: счётчик подтверждений с нуля, хвост прошлой фазы игнорируется 2 с — работает и со старым клиентом (сброс в 1), и с новым (монотонный) */
function transition(p: Peer) { p.ignoreBelow = Math.max(p.last.seq, ...p.queue.map((q) => q.seq)); p.transAt = Date.now(); p.queue = []; p.last = { ...EMPTY_INPUT }; }
function peerMods(p: Peer) { const m = ratMods(p.profile.dna, p.profile.mut); m.pockets += p.profile.pockets; return m; }
function startRaid(room: Room) {
  room.seed = (room.seed * 1103515245 + 12345) | 0;
  // вылитые Зелья расходуются и становятся Модификаторами этой Вылазки
  const poured: Potion[] = [];
  for (const id of room.pour) { const i = store.nora(room.code).potions.findIndex((p) => p.id === id); if (i >= 0) poured.push(store.nora(room.code).potions.splice(i, 1)[0]); }
  room.pour = [];
  const mods = raidMods(poured);
  if (poured.length) { store.log(room.code, `${room.code}: вылито ${poured.length} — ${mods.names.join(', ')}`); store.save(); pushNora(room); }
  const w = createWorld(room.map, room.seed, mods);
  // номер последнего инпута сохраняем: пакеты из Норы ещё в полёте, сброс в 0 заблокировал бы ввод до догона счётчика
  for (const p of room.peers.values()) { addRat(w, p.id, p.name, peerMods(p)); transition(p); }
  room.world = w; room.phase = 'raid';
  broadcast(room, { t: 'raid', map: w.map, seed: room.seed, mods, ratMods: Object.fromEntries([...w.rats.values()].map((r) => [r.id, r.mods])) });
  console.log(`▶ ${room.code}: ${w.map} with ${room.peers.size} rats`);
}
function endRaid(room: Room) {
  const w = room.world!;
  room.phase = 'results'; room.phaseLeft = RESULTS_SEC;
  const rows = [...w.rats.values()].map((r) => ({ id: r.id, name: r.name, exited: r.exited, dead: r.dead, loot: r.banked }));
  // добыча вынесших — на общий Склад
  for (const r of w.rats.values()) { if (r.banked.length) store.addLoot(room.code, r.banked); const p = [...room.peers.values()].find((x) => x.id === r.id); if (p) { p.profile.raids++; p.profile.banked += r.banked.length; } }
  store.log(room.code, `${room.code}: ${MAPS[w.map]?.name ?? w.map} — вынесено ${rows.reduce((s, r) => s + r.loot.length, 0)}`); store.save(); pushNora(room);
  for (const p of room.peers.values()) send(p.ws, meMsg(p.profile));
  broadcast(room, { t: 'results', rows, panic: Math.round(w.panic), map: w.map });
  console.log(`■ ${room.code}: ${rows.map((r) => `${r.name}:${r.exited ? 'out' : 'dead'}(${r.loot.length})`).join(' ')}`);
}
function toLobby(room: Room) {
  room.phase = 'lobby'; room.world = null; room.nora = createNoraWorld();
  for (const p of room.peers.values()) { addRat(room.nora, p.id, p.name, peerMods(p)); transition(p); }
  broadcast(room, lobbyMsg(room));
}
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }

// --- цикл ---
let acc = 0, last = performance.now();
let tpsCount = 0, tpsLast = 0, tpsAt = performance.now();
setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000); last = now;
  if (now - tpsAt >= 1000) { tpsLast = tpsCount; tpsCount = 0; tpsAt = now; }
  while (acc >= TICK) {
    acc -= TICK; tpsCount++;
    for (const room of rooms.values()) {
      if (room.phase === 'results') { room.phaseLeft -= TICK; if (room.phaseLeft <= 0) toLobby(room); continue; }
      if (room.phase === 'lobby') { // Нора: крысы бегают, мир без NPC
        const w = room.nora; w.tick++;
        const solid = [...w.rats.values()];
        for (const p of room.peers.values()) {
          const steps = p.queue.length > 8 ? 3 : p.queue.length > 3 ? 2 : 1;
          if (w.tick % 60 === 0 && Date.now() - p.net.lastInAt > 1000 && Date.now() - p.net.since > 3000) p.net.stalls++;
          for (let k = 0; k < steps; k++) { const input = p.queue.length ? p.queue.shift()! : { ...p.last, jump: false, bite: false, act: false, seq: p.last.seq }; p.last = input; const r = w.rats.get(p.id); if (r) stepRat(w.level, r, input, solid); }
        }
        if (w.tick % SNAP_EVERY === 0) broadcast(room, { t: 's', ...snapWorld(w), ev: [] });
        continue;
      }
      if (room.phase !== 'raid' || !room.world) continue;
      const w = room.world;
      const inputs = new Map<string, Input>();
      const solidRats = [...w.rats.values()].filter((r) => !r.dead && !r.exited);
      for (const p of room.peers.values()) {
        const steps = p.queue.length > 8 ? 3 : p.queue.length > 3 ? 2 : 1;
        if (w.tick % 60 === 0 && Date.now() - p.net.lastInAt > 1000 && Date.now() - p.net.since > 3000) p.net.stalls++;
        let input = p.last;
        for (let k = 0; k < steps; k++) {
          input = p.queue.length ? p.queue.shift()! : { ...p.last, jump: false, bite: false, act: false, seq: p.last.seq };
          p.last = input;
          const r = w.rats.get(p.id); if (r) stepRat(w.level, r, input, solidRats, w.mods.slippery, w.mods.sticky);
        }
        inputs.set(p.id, input);
      }
      stepWorld(w, inputs);
      if (w.tick % SNAP_EVERY === 0) broadcast(room, { t: 's', ...snapWorld(w), ev: w.events });
      else if (w.events.length) broadcast(room, { t: 'ev', ev: w.events });
      if (w.over) endRaid(room);
    }
  }
}, 1000 / TICK_HZ / 2);

// зомби-соединения: ws ping каждые 10 с
setInterval(() => {
  for (const room of rooms.values()) for (const p of room.peers.values()) {
    if (!p.alive) { p.ws.terminate(); continue; }
    p.alive = false; p.net.pingAt = performance.now(); p.ws.ping();
  }
}, 10_000);
// диагностика соединений: раз в 15 с строка на комнату — RTT, пакетов ввода в секунду, очередь, стойлы
let netAt = Date.now();
setInterval(() => {
  const dt = (Date.now() - netAt) / 1000; netAt = Date.now();
  for (const room of rooms.values()) {
    if (!room.peers.size) continue;
    const parts = [...room.peers.values()].map((p) => { const n = p.net; const line = `${p.name} rtt=${n.rtt}ms in=${(n.inPk / dt).toFixed(0)}pk/${(n.inSeq / dt).toFixed(0)}i q=${p.queue.length}/${n.maxQ}${n.stalls ? ` stalls=${n.stalls}` : ''}`; n.inPk = 0; n.inSeq = 0; n.maxQ = p.queue.length; return line; });
    console.log(`~ ${room.code} ${room.phase}: ${parts.join(' | ')}`);
  }
}, 15_000);
function shortUa(ua: string): string {
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Win' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '?';
  const br = /YaBrowser/.test(ua) ? 'Yandex' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox/.test(ua) ? 'Firefox' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '?';
  return `${os}/${br}`;
}

http.listen(PORT, () => console.log(`krysy server ${VERSION} on :${PORT}, tick ${TICK_HZ} Hz, snapshots ${TICK_HZ / SNAP_EVERY} Hz, maps: ${Object.keys(MAPS).join(',')}`));
