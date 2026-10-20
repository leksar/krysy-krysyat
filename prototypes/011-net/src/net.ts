// ПРОТОТИП 011. Сеть: отправка инпутов пачкой, приём снапшотов, пинг, искусственная задержка.
import type { Input, RatSnap } from '@krysy/sim';

export type Snapshot = { tick: number; rats: RatSnap[]; at: number };
export type NetEvents = {
  welcome: (id: string, names: Record<string, string>) => void;
  snapshot: (s: Snapshot) => void;
  join: (id: string, name: string) => void;
  leave: (id: string) => void;
  status: (text: string) => void;
};

export class Net {
  ws!: WebSocket;
  id = '';
  rtt = 0;
  lagMs = 0;              // искусственная задержка в каждую сторону
  bytesIn = 0;
  private pending: Input[] = [];
  private handlers: Partial<NetEvents> = {};
  on<K extends keyof NetEvents>(k: K, f: NetEvents[K]) { this.handlers[k] = f; }

  connect(url: string, name: string) {
    this.handlers.status?.(`подключаюсь к ${url}…`);
    const ws = new WebSocket(`${url}${url.includes('?') ? '&' : '?'}name=${encodeURIComponent(name)}`);
    this.ws = ws;
    ws.onopen = () => { this.handlers.status?.('подключено'); setInterval(() => this.send({ t: 'ping', c: performance.now() }), 1000); };
    ws.onclose = (e) => this.handlers.status?.(`отключено (${e.code} ${e.reason || ''})`);
    ws.onerror = () => this.handlers.status?.('ошибка соединения');
    ws.onmessage = (ev) => {
      this.bytesIn += String(ev.data).length;
      const deliver = () => this.handle(JSON.parse(String(ev.data)));
      this.lagMs ? setTimeout(deliver, this.lagMs) : deliver();
    };
  }

  private handle(m: any) {
    switch (m.t) {
      case 'welcome': this.id = m.id; this.handlers.welcome?.(m.id, m.names); break;
      case 's': this.handlers.snapshot?.({ tick: m.tick, rats: m.rats, at: performance.now() }); break;
      case 'join': this.handlers.join?.(m.id, m.name); break;
      case 'leave': this.handlers.leave?.(m.id); break;
      case 'pong': this.rtt = Math.round(performance.now() - m.c); break;
    }
  }

  private send(o: unknown) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const s = JSON.stringify(o);
    this.lagMs ? setTimeout(() => this.ws.readyState === WebSocket.OPEN && this.ws.send(s), this.lagMs) : this.ws.send(s);
  }

  /** Шлём инпут + хвост неподтверждённых (до 5) — дешёвая защита от потери/задержки. */
  sendInput(i: Input, ackedSeq: number) {
    this.pending.push(i);
    this.pending = this.pending.filter((p) => p.seq > ackedSeq).slice(-5);
    this.send({ t: 'i', inputs: this.pending });
  }
}
