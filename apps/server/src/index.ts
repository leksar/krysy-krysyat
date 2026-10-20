// Сервер «Крысы крысят» — авторитетная симуляция поверх ws.
// Прототип 011: одна общая комната, до 6 Крыс, JSON-протокол. Цель — проверить ощущение сети.
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { createLevel, createRat, stepRat, resolveBites, snap, TICK, TICK_HZ, EMPTY_INPUT, type Input, type Rat } from '@krysy/sim';

const PORT = Number(process.env.PORT ?? 2567);
const MAX_RATS = 6;
const SNAP_EVERY = 2; // 60 Гц тик → 30 Гц снапшоты
const VERSION = '011';

const level = createLevel();
type Peer = { ws: WebSocket; rat: Rat; queue: Input[]; last: Input; name: string; joinedAt: number };
const peers = new Map<string, Peer>();
let tick = 0;
let nextId = 1;

const http = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    // отладка очередей инпутов: длина очереди на Крысу и сколько тиков мы реально сделали за последнюю секунду
    const q: Record<string, number> = {}; for (const [id, p] of peers) q[p.name + '#' + id] = p.queue.length;
    res.end(JSON.stringify({ ok: true, version: VERSION, rats: peers.size, tick, tps: tpsLast, queues: q }));
  } else { res.writeHead(404); res.end(); }
});
const wss = new WebSocketServer({ server: http, maxPayload: 4096 });

wss.on('connection', (ws, req) => {
  if (peers.size >= MAX_RATS) { ws.close(4000, 'full'); return; }
  const url = new URL(req.url ?? '/', 'http://x');
  const name = (url.searchParams.get('name') ?? '').slice(0, 12) || `rat${nextId}`;
  const id = String(nextId++);
  const rat = createRat(id, level, peers.size);
  const peer: Peer = { ws, rat, queue: [], last: { ...EMPTY_INPUT }, name, joinedAt: Date.now() };
  peers.set(id, peer);
  console.log(`+ ${name} (#${id}) from ${req.socket.remoteAddress}, now ${peers.size}`);
  ws.send(JSON.stringify({ t: 'welcome', id, tickHz: TICK_HZ, tick, names: namesOf() }));
  broadcast({ t: 'join', id, name });

  ws.on('message', (data) => {
    let m: any;
    try { m = JSON.parse(String(data)); } catch { return; }
    if (m.t === 'i') {
      // пачка инпутов (клиент шлёт неподтверждённые повторно — защита от потери)
      for (const i of m.inputs as Input[]) {
        if (typeof i.seq !== 'number' || i.seq <= peer.last.seq && !(peer.queue.length && i.seq <= peer.queue[peer.queue.length - 1].seq)) {
          if (i.seq <= (peer.queue.length ? peer.queue[peer.queue.length - 1].seq : peer.last.seq)) continue;
        }
        if (peer.queue.length > 60) break;
        peer.queue.push({ seq: i.seq, moveX: clamp(Number(i.moveX) || 0, -1, 1), jump: !!i.jump, jumpHeld: !!i.jumpHeld, bite: !!i.bite });
      }
    } else if (m.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', c: m.c, tick }));
    }
  });
  ws.on('close', () => { peers.delete(id); broadcast({ t: 'leave', id }); console.log(`- ${name} (#${id}), now ${peers.size}`); });
  (ws as any).alive = true;
  ws.on('pong', () => ((ws as any).alive = true));
});

// зомби-соединения (перезагруженная вкладка, уснувший телефон): ws ping каждые 10 с, нет pong — рвём
setInterval(() => {
  for (const p of peers.values()) {
    const w = p.ws as any;
    if (!w.alive) { p.ws.terminate(); continue; }
    w.alive = false; p.ws.ping();
  }
}, 10_000);

function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function namesOf() { const o: Record<string, string> = {}; for (const [id, p] of peers) o[id] = p.name; return o; }
function broadcast(msg: unknown) { const s = JSON.stringify(msg); for (const p of peers.values()) if (p.ws.readyState === p.ws.OPEN) p.ws.send(s); }

// --- авторитетный цикл: ровно один инпут на тик на Крысу; нет инпута — держим последний ---
let acc = 0, last = performance.now();
let tpsCount = 0, tpsLast = 0, tpsAt = performance.now();
setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000); last = now;
  if (now - tpsAt >= 1000) { tpsLast = tpsCount; tpsCount = 0; tpsAt = now; }
  while (acc >= TICK) {
    acc -= TICK; tick++; tpsCount++;
    const rats: Rat[] = [];
    for (const p of peers.values()) {
      // часы клиента и сервера расходятся → очередь дрейфует; при накоплении догоняем по два за тик
      const steps = p.queue.length > 4 ? 2 : 1;
      for (let k = 0; k < steps; k++) {
        const input = p.queue.length ? p.queue.shift()! : { ...p.last, jump: false, bite: false, seq: p.last.seq };
        p.last = input;
        stepRat(level, p.rat, input);
      }
      rats.push(p.rat);
    }
    resolveBites(rats);
    if (tick % SNAP_EVERY === 0) broadcast({ t: 's', tick, rats: rats.map(snap) });
  }
}, 1000 / TICK_HZ / 2);

http.listen(PORT, () => console.log(`krysy server ${VERSION} on :${PORT}, tick ${TICK_HZ} Hz, snapshots ${TICK_HZ / SNAP_EVERY} Hz`));
