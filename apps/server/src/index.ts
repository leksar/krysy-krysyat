// Сервер «Крысы крысят»: комнаты по коду, лобби → Вылазка → итоги, авторитетная симуляция из @krysy/sim.
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { createWorld, addRat, stepRat, stepWorld, snapWorld, MAPS, TICK, TICK_HZ, EMPTY_INPUT, type Input, type World, type Phase } from '@krysy/sim';

const PORT = Number(process.env.PORT ?? 2567);
const MAX_RATS = 6;
const SNAP_EVERY = 3; // 60 Гц тик → 20 Гц снапшоты
const RESULTS_SEC = 15;
const VERSION = 'v0';

type Peer = { ws: WebSocket; id: string; name: string; room: Room; queue: Input[]; last: Input; alive: boolean };
type Room = { code: string; peers: Map<string, Peer>; hostId: string | null; map: string; phase: Phase; world: World | null; phaseLeft: number; seed: number };
const rooms = new Map<string, Room>();
let nextId = 1;

const http = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    const r: Record<string, unknown> = {};
    for (const [c, room] of rooms) r[c] = { phase: room.phase, map: room.map, rats: room.peers.size, queues: [...room.peers.values()].map((p) => p.queue.length) };
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, version: VERSION, tps: tpsLast, rooms: r }));
  } else { res.writeHead(404); res.end(); }
});
const wss = new WebSocketServer({ server: http, maxPayload: 4096 });

function getRoom(code: string): Room {
  let r = rooms.get(code);
  if (!r) { r = { code, peers: new Map(), hostId: null, map: 'yard', phase: 'lobby', world: null, phaseLeft: 0, seed: hash(code) }; rooms.set(code, r); }
  return r;
}
function hash(s: string) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h | 0; }
const send = (ws: WebSocket, o: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(o)); };
const broadcast = (room: Room, o: unknown) => { const s = JSON.stringify(o); for (const p of room.peers.values()) if (p.ws.readyState === p.ws.OPEN) p.ws.send(s); };
function lobbyMsg(room: Room) {
  return { t: 'lobby', code: room.code, phase: room.phase, map: room.map, hostId: room.hostId, maps: Object.values(MAPS).map((m) => ({ id: m.id, name: m.name, desc: m.desc })), players: [...room.peers.values()].map((p) => ({ id: p.id, name: p.name })) };
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const code = (url.searchParams.get('room') ?? 'XXXX').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'XXXX';
  const name = (url.searchParams.get('name') ?? '').trim().slice(0, 12) || `крыса${nextId}`;
  const room = getRoom(code);
  if (room.peers.size >= MAX_RATS) { ws.close(4000, 'full'); return; }
  const id = String(nextId++);
  const peer: Peer = { ws, id, name, room, queue: [], last: { ...EMPTY_INPUT }, alive: true };
  room.peers.set(id, peer);
  if (!room.hostId) room.hostId = id;
  console.log(`+ ${name} (#${id}) → ${code} [${room.peers.size}]`);
  send(ws, { t: 'welcome', id, tickHz: TICK_HZ, version: VERSION });
  // опоздавший в идущую Вылазку — заходит зрителем-крысой у входа
  if (room.phase === 'raid' && room.world) { addRat(room.world, id, name); }
  broadcast(room, lobbyMsg(room));

  ws.on('message', (data) => {
    let m: any; try { m = JSON.parse(String(data)); } catch { return; }
    switch (m.t) {
      case 'i': {
        for (const i of m.inputs as Input[]) {
          if (typeof i.seq !== 'number') continue;
          const newest = peer.queue.length ? peer.queue[peer.queue.length - 1].seq : peer.last.seq;
          if (i.seq <= newest) continue;
          if (peer.queue.length > 60) break;
          peer.queue.push({ seq: i.seq, moveX: clamp(Number(i.moveX) || 0, -1, 1), jump: !!i.jump, jumpHeld: !!i.jumpHeld, bite: !!i.bite, act: !!i.act, actHeld: !!i.actHeld });
        }
        break;
      }
      case 'ping': send(ws, { t: 'pong', c: m.c }); break;
      case 'setMap': if (peer.id === room.hostId && room.phase === 'lobby' && MAPS[m.map]) { room.map = m.map; broadcast(room, lobbyMsg(room)); } break;
      case 'start': if (peer.id === room.hostId && room.phase === 'lobby') startRaid(room); break;
      case 'back': if (room.phase === 'results') toLobby(room); break;
    }
  });
  ws.on('close', () => {
    room.peers.delete(id);
    if (room.world) { const r = room.world.rats.get(id); if (r && !r.exited) { r.dead = true; } }
    if (room.hostId === id) room.hostId = room.peers.keys().next().value ?? null;
    console.log(`- ${name} (#${id}) ← ${code} [${room.peers.size}]`);
    if (!room.peers.size) rooms.delete(code); else broadcast(room, lobbyMsg(room));
  });
  ws.on('pong', () => (peer.alive = true));
});

function startRaid(room: Room) {
  room.seed = (room.seed * 1103515245 + 12345) | 0;
  const w = createWorld(room.map, room.seed);
  for (const p of room.peers.values()) { addRat(w, p.id, p.name); p.queue = []; p.last = { ...EMPTY_INPUT }; }
  room.world = w; room.phase = 'raid';
  broadcast(room, { t: 'raid', map: w.map, seed: room.seed });
  console.log(`▶ ${room.code}: ${w.map} with ${room.peers.size} rats`);
}
function endRaid(room: Room) {
  const w = room.world!;
  room.phase = 'results'; room.phaseLeft = RESULTS_SEC;
  const rows = [...w.rats.values()].map((r) => ({ id: r.id, name: r.name, exited: r.exited, dead: r.dead, loot: r.banked }));
  broadcast(room, { t: 'results', rows, panic: Math.round(w.panic), map: w.map });
  console.log(`■ ${room.code}: ${rows.map((r) => `${r.name}:${r.exited ? 'out' : 'dead'}(${r.loot.length})`).join(' ')}`);
}
function toLobby(room: Room) { room.phase = 'lobby'; room.world = null; broadcast(room, lobbyMsg(room)); }
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
      if (room.phase !== 'raid' || !room.world) continue;
      const w = room.world;
      const inputs = new Map<string, Input>();
      const solidRats = [...w.rats.values()].filter((r) => !r.dead && !r.exited);
      for (const p of room.peers.values()) {
        const steps = p.queue.length > 8 ? 3 : p.queue.length > 3 ? 2 : 1;
        let input = p.last;
        for (let k = 0; k < steps; k++) {
          input = p.queue.length ? p.queue.shift()! : { ...p.last, jump: false, bite: false, act: false, seq: p.last.seq };
          p.last = input;
          const r = w.rats.get(p.id); if (r) stepRat(w.level, r, input, solidRats);
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
    p.alive = false; p.ws.ping();
  }
}, 10_000);

http.listen(PORT, () => console.log(`krysy server ${VERSION} on :${PORT}, tick ${TICK_HZ} Hz, snapshots ${TICK_HZ / SNAP_EVERY} Hz, maps: ${Object.keys(MAPS).join(',')}`));
