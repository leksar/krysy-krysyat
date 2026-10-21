// Звук: своя обёртка над Web Audio (docs/research/sounds.md). Все эффекты синтезируются на лету в 8-битном стиле —
// файлов нет, стиль единый. Контекст создаётся и resume() в том же тапе, что и fullscreen. Шины: sfx / music / amb → master.
// Громкость чужих событий падает с расстоянием от своей Крысы.

type Env = { a?: number; d?: number; s?: number; r?: number };
type Tone = { type: OscillatorType | 'noise'; f0: number; f1?: number; dur: number; vol?: number; env?: Env; slide?: 'exp' | 'lin'; lp?: number; hp?: number };

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode; private sfx!: GainNode; private music!: GainNode; private amb!: GainNode;
  muted = localStorage.getItem('mute') === '1';
  private last = new Map<string, number>();
  private noiseBuf: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private musicMode: 'none' | 'nora' | 'raid' | 'tense' = 'none';
  private nextNote = 0; private step = 0;
  private ambNodes: AudioNode[] = [];

  /** Вызывать из обработчика тапа (user activation). */
  unlock() {
    if (!this.ctx) {
      const C = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      this.ctx = new C({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain(); this.sfx.gain.value = 0.5; this.sfx.connect(this.master);
      this.music = this.ctx.createGain(); this.music.gain.value = 0.22; this.music.connect(this.master);
      this.amb = this.ctx.createGain(); this.amb.gain.value = 0.3; this.amb.connect(this.master);
      const len = this.ctx.sampleRate; this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      document.addEventListener('visibilitychange', () => { if (!this.ctx) return; if (document.hidden) this.ctx.suspend(); else this.resume(); });
      this.applyMute();
    }
    this.resume();
  }
  resume() { const c = this.ctx; if (!c) return; if (c.state !== 'running') c.resume().catch(() => {}); if ((c.state as string) === 'interrupted') { c.suspend().then(() => c.resume()).catch(() => {}); } }
  toggleMute() { this.muted = !this.muted; localStorage.setItem('mute', this.muted ? '1' : '0'); this.applyMute(); return this.muted; }
  private applyMute() { if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx!.currentTime, 0.02); }

  // ---------- синтез ----------
  private tone(t: Tone, when = 0, gain = 1) {
    const c = this.ctx; if (!c || this.muted) return;
    const t0 = c.currentTime + when, e = t.env ?? {}, a = e.a ?? 0.005, dcy = e.d ?? t.dur * 0.3, s = e.s ?? 0.4, r = e.r ?? 0.05;
    const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime((t.vol ?? 0.5) * gain, t0 + a);
    g.gain.linearRampToValueAtTime((t.vol ?? 0.5) * gain * s, t0 + a + dcy); g.gain.setValueAtTime((t.vol ?? 0.5) * gain * s, t0 + t.dur); g.gain.linearRampToValueAtTime(0, t0 + t.dur + r);
    let src: AudioScheduledSourceNode;
    if (t.type === 'noise') { const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true; src = n; }
    else { const o = c.createOscillator(); o.type = t.type; o.frequency.setValueAtTime(t.f0, t0); if (t.f1 !== undefined) { if (t.slide === 'lin') o.frequency.linearRampToValueAtTime(t.f1, t0 + t.dur); else o.frequency.exponentialRampToValueAtTime(Math.max(20, t.f1), t0 + t.dur); } src = o; }
    let node: AudioNode = src;
    if (t.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = t.lp; node.connect(f); node = f; }
    if (t.hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = t.hp; node.connect(f); node = f; }
    node.connect(g); g.connect(this.sfx);
    src.start(t0); src.stop(t0 + t.dur + r + 0.02);
  }

  /** Эффект по имени. gain — громкость (0..1) с учётом расстояния. */
  play(name: string, gain = 1) {
    if (!this.ctx || this.muted || gain <= 0.02) return;
    const now = performance.now(); const minGap = ({ step: 110, hit: 60, pick: 50 } as Record<string, number>)[name] ?? 30;
    if (now - (this.last.get(name) ?? 0) < minGap) return; this.last.set(name, now);
    const v = (x: number) => x * (0.85 + Math.random() * 0.3); // вариация, чтобы не «пулемёт»
    switch (name) {
      case 'jump': this.tone({ type: 'square', f0: v(300), f1: 700, dur: 0.12, vol: 0.25, env: { d: 0.05, s: 0.5 } }, 0, gain); break;
      case 'land': this.tone({ type: 'noise', f0: 0, dur: 0.05, vol: 0.18, lp: 600 }, 0, gain); break;
      case 'step': this.tone({ type: 'noise', f0: 0, dur: 0.03, vol: 0.08, lp: v(900), hp: 200 }, 0, gain); break;
      case 'bite': this.tone({ type: 'noise', f0: 0, dur: 0.06, vol: 0.35, hp: 1200 }, 0, gain); this.tone({ type: 'square', f0: v(900), f1: 300, dur: 0.07, vol: 0.2 }, 0, gain); break;
      case 'hit': this.tone({ type: 'square', f0: v(220), f1: 90, dur: 0.1, vol: 0.35 }, 0, gain); this.tone({ type: 'noise', f0: 0, dur: 0.08, vol: 0.25, lp: 1500 }, 0, gain); break;
      case 'hurt': this.tone({ type: 'sawtooth', f0: v(500), f1: 120, dur: 0.2, vol: 0.35, lp: 2500 }, 0, gain); break;
      case 'pick': this.tone({ type: 'square', f0: v(880), dur: 0.05, vol: 0.2 }, 0, gain); this.tone({ type: 'square', f0: v(1320), dur: 0.08, vol: 0.2 }, 0.05, gain); break;
      case 'drop': this.tone({ type: 'triangle', f0: 600, f1: 300, dur: 0.1, vol: 0.2 }, 0, gain); break;
      case 'stomp': this.tone({ type: 'sine', f0: 120, f1: 40, dur: 0.18, vol: 0.6 }, 0, gain); this.tone({ type: 'noise', f0: 0, dur: 0.1, vol: 0.3, lp: 400 }, 0, gain); break;
      case 'swing': this.tone({ type: 'noise', f0: 0, dur: 0.22, vol: 0.3, lp: 3000, hp: 400, env: { a: 0.08, d: 0.08, s: 0.3 } }, 0, gain); break;
      case 'windup': this.tone({ type: 'square', f0: 200, f1: 320, dur: 0.25, vol: 0.12, slide: 'lin' }, 0, gain); break;
      case 'scream': this.tone({ type: 'sawtooth', f0: v(700), f1: 1400, dur: 0.35, vol: 0.3, lp: 3000, env: { a: 0.02, d: 0.1, s: 0.7 } }, 0, gain); this.tone({ type: 'noise', f0: 0, dur: 0.3, vol: 0.12, hp: 1500 }, 0, gain); break;
      case 'panic': this.tone({ type: 'square', f0: v(400), f1: 650, dur: 0.15, vol: 0.18 }, 0, gain); this.tone({ type: 'square', f0: v(650), f1: 400, dur: 0.15, vol: 0.18 }, 0.15, gain); break;
      case 'steal': for (let i = 0; i < 4; i++) this.tone({ type: 'noise', f0: 0, dur: 0.05, vol: 0.25, lp: 2500, hp: 600 }, i * 0.07, gain); break;
      case 'flap': for (let i = 0; i < 3; i++) this.tone({ type: 'noise', f0: 0, dur: 0.04, vol: 0.15, lp: 2000, hp: 500 }, i * 0.09, gain); break;
      case 'pigeondead': this.tone({ type: 'square', f0: 1500, f1: 400, dur: 0.2, vol: 0.25 }, 0, gain); break;
      case 'kill': this.tone({ type: 'sine', f0: 90, f1: 35, dur: 0.3, vol: 0.6 }, 0, gain); this.tone({ type: 'noise', f0: 0, dur: 0.25, vol: 0.3, lp: 800 }, 0.05, gain); break;
      case 'cat': this.tone({ type: 'sawtooth', f0: 500, f1: 900, dur: 0.18, vol: 0.3, lp: 2500, slide: 'lin' }, 0, gain); this.tone({ type: 'sawtooth', f0: 900, f1: 450, dur: 0.3, vol: 0.3, lp: 2500, slide: 'lin' }, 0.18, gain); break;
      case 'drink': for (let i = 0; i < 5; i++) this.tone({ type: 'sine', f0: v(300 + i * 60), f1: 500 + i * 60, dur: 0.07, vol: 0.2 }, i * 0.12, gain); break;
      case 'mark': this.tone({ type: 'noise', f0: 0, dur: 0.5, vol: 0.18, lp: 1200, hp: 300, env: { a: 0.05, d: 0.2, s: 0.5 } }, 0, gain); break;
      case 'eat': for (let i = 0; i < 3; i++) this.tone({ type: 'noise', f0: 0, dur: 0.06, vol: 0.2, lp: 1500 }, i * 0.18, gain); break;
      case 'infect': this.tone({ type: 'triangle', f0: 300, f1: 150, dur: 0.3, vol: 0.3 }, 0, gain); this.tone({ type: 'noise', f0: 0, dur: 0.15, vol: 0.15, lp: 700 }, 0.1, gain); break;
      case 'sick': this.tone({ type: 'sawtooth', f0: 200, f1: 120, dur: 0.4, vol: 0.2, lp: 900 }, 0, gain); break;
      case 'down': this.tone({ type: 'square', f0: 600, f1: 80, dur: 0.5, vol: 0.35 }, 0, gain); break;
      case 'dead': this.tone({ type: 'square', f0: 300, f1: 60, dur: 0.8, vol: 0.35 }, 0, gain); break;
      case 'revive': [440, 554, 659, 880].forEach((f, i) => this.tone({ type: 'square', f0: f, dur: 0.1, vol: 0.22 }, i * 0.09, gain)); break;
      case 'exit': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone({ type: 'square', f0: f, dur: 0.12, vol: 0.25 }, i * 0.1, gain)); break;
      case 'luk': this.tone({ type: 'square', f0: 180, f1: 150, dur: 0.25, vol: 0.4, lp: 1200 }, 0, gain); this.tone({ type: 'noise', f0: 0, dur: 0.15, vol: 0.25, hp: 2000 }, 0, gain); break;
      case 'stage': for (let i = 0; i < 3; i++) this.tone({ type: 'square', f0: 660, f1: 520, dur: 0.18, vol: 0.3 }, i * 0.25, gain); break;
      case 'nofit': this.tone({ type: 'square', f0: 200, dur: 0.1, vol: 0.25 }, 0, gain); this.tone({ type: 'square', f0: 150, dur: 0.15, vol: 0.25 }, 0.12, gain); break;
      case 'ui': this.tone({ type: 'square', f0: 1200, dur: 0.03, vol: 0.15 }, 0, gain); break;
      case 'brew': for (let i = 0; i < 6; i++) this.tone({ type: 'sine', f0: v(200 + i * 90), f1: 900, dur: 0.1, vol: 0.2 }, i * 0.08, gain); break;
      case 'build': for (let i = 0; i < 4; i++) this.tone({ type: 'square', f0: 300, f1: 200, dur: 0.07, vol: 0.3, lp: 1500 }, i * 0.15, gain); break;
      case 'drank': [300, 400, 500, 350, 700].forEach((f, i) => this.tone({ type: 'triangle', f0: f, f1: f * 1.3, dur: 0.12, vol: 0.3 }, i * 0.1, gain)); break;
    }
  }

  // ---------- музыка и эмбиент: простые лупы, планируются с опережением ----------
  setMusic(mode: 'none' | 'nora' | 'raid' | 'tense') {
    if (mode === this.musicMode) return; this.musicMode = mode; this.step = 0;
    for (const n of this.ambNodes) { try { (n as any).stop?.(); } catch {} n.disconnect(); } this.ambNodes = [];
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    if (!this.ctx || mode === 'none') return;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.schedule(), 100);
    if (mode === 'raid' || mode === 'tense') { // эмбиент: тихий шум ветра/гула
      const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = mode === 'tense' ? 500 : 300;
      const g = this.ctx.createGain(); g.gain.value = mode === 'tense' ? 0.25 : 0.12;
      n.connect(f); f.connect(g); g.connect(this.amb); n.start(); this.ambNodes.push(n, f, g);
    }
  }
  private schedule() {
    const c = this.ctx; if (!c || this.muted) return;
    const bpm = this.musicMode === 'tense' ? 150 : this.musicMode === 'raid' ? 100 : 72;
    const beat = 60 / bpm / 2; // восьмые
    while (this.nextNote < c.currentTime + 0.3) {
      const t = this.nextNote, s = this.step;
      if (this.musicMode === 'nora') { // спокойный арпеджио в миноре
        const seq = [220, 262, 330, 392, 330, 262, 196, 247]; const f = seq[s % seq.length];
        this.note('triangle', f, t, beat * 0.9, 0.5); if (s % 8 === 0) this.note('sine', f / 2, t, beat * 6, 0.35);
      } else if (this.musicMode === 'raid') { // редкий пульс баса
        if (s % 4 === 0) this.note('sine', s % 16 === 8 ? 65 : 55, t, beat * 1.5, 0.5);
        if (s % 8 === 6) this.note('square', 330, t, beat * 0.5, 0.12);
      } else if (this.musicMode === 'tense') { // быстрый бас и хэты
        this.note('square', s % 4 === 2 ? 82 : 73, t, beat * 0.5, 0.35);
        this.hat(t + beat * 0.5, 0.12); if (s % 8 === 4) this.note('sawtooth', 440, t, beat, 0.1);
      }
      this.nextNote += beat; this.step++;
    }
  }
  private note(type: OscillatorType, f: number, t: number, dur: number, vol: number) {
    const c = this.ctx!; const o = c.createOscillator(); o.type = type; o.frequency.value = f;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.music); o.start(t); o.stop(t + dur + 0.02);
  }
  private hat(t: number, vol: number) {
    const c = this.ctx!; const n = c.createBufferSource(); n.buffer = this.noiseBuf; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    n.connect(f); f.connect(g); g.connect(this.music); n.start(t); n.stop(t + 0.05);
  }
}

/** Громкость по расстоянию от слушателя (своей Крысы): полная до 6 тайлов, ноль за 30. */
export function falloff(dx: number, dy: number): number { const d = Math.hypot(dx, dy); return d < 96 ? 1 : Math.max(0, 1 - (d - 96) / 384); }
