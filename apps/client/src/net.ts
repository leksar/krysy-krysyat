// Сеть: инпуты пачкой (последние 5 неподтверждённых), снапшоты, события, лобби.
import type { Input, Snapshot, Event } from '@krysy/sim';

export type LobbyMsg = { code: string; phase: string; map: string; hostId: string | null; maps: { id: string; name: string; desc: string }[]; players: { id: string; name: string }[] };
export type ResultsMsg = { rows: { id: string; name: string; exited: boolean; dead: boolean; loot: string[] }[]; panic: number; map: string };
export type Handlers = {
  welcome: (id: string) => void;
  lobby: (m: LobbyMsg) => void;
  raid: (map: string, seed: number) => void;
  results: (m: ResultsMsg) => void;
  snapshot: (s: Snapshot & { at: number }) => void;
  events: (ev: Event[]) => void;
  status: (text: string, closed?: boolean) => void;
};

export class Net {
  ws: WebSocket | null = null;
  id = '';
  rtt = 0;
  bytesIn = 0;
  private pending: Input[] = [];
  private h: Partial<Handlers> = {};
  private pingTimer: number | null = null;
  on<K extends keyof Handlers>(k: K, f: Handlers[K]) { this.h[k] = f; }

  connect(url: string, name: string, room: string) {
    this.close();
    this.h.status?.(`подключаюсь…`);
    const ws = new WebSocket(`${url}?name=${encodeURIComponent(name)}&room=${encodeURIComponent(room)}`);
    this.ws = ws;
    ws.onopen = () => { this.h.status?.('на связи'); this.pingTimer = window.setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000); };
    ws.onclose = (e) => { this.h.status?.(e.code === 4000 ? 'комната полна' : `отключено (${e.code})`, true); if (this.pingTimer) clearInterval(this.pingTimer); };
    ws.onerror = () => this.h.status?.('ошибка соединения', true);
    ws.onmessage = (ev) => { this.bytesIn += String(ev.data).length; this.handle(JSON.parse(String(ev.data))); };
  }
  close() { if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; } if (this.pingTimer) clearInterval(this.pingTimer); this.pending = []; }

  private handle(m: any) {
    switch (m.t) {
      case 'welcome': this.id = m.id; this.h.welcome?.(m.id); break;
      case 'lobby': this.h.lobby?.(m); break;
      case 'raid': this.pending = []; this.h.raid?.(m.map, m.seed); break;
      case 'results': this.h.results?.(m); break;
      case 's': this.h.snapshot?.({ ...m, at: performance.now() }); if (m.ev?.length) this.h.events?.(m.ev); break;
      case 'ev': this.h.events?.(m.ev); break;
      case 'pong': this.rtt = Math.round(performance.now() - m.c); break;
    }
  }
  send(o: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o)); }
  sendInput(i: Input, ackedSeq: number) {
    this.pending.push(i);
    this.pending = this.pending.filter((p) => p.seq > ackedSeq).slice(-5);
    this.send({ t: 'i', inputs: this.pending });
  }
}
