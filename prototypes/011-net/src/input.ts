// ПРОТОТИП 011. Тач-ввод из 010 (раскладка A, фиксированный джойстик, мёртвая зона у левого края).
export const EDGE_DEAD = 48;
export const JOY_FIXED_X = 130;

export type Sample = { moveX: number; jump: boolean; jumpHeld: boolean; bite: boolean };

export class Touch {
  axisX = 0;
  jumpHeld = false;
  private keyJump = false;
  private jumpPressed = false;
  private bitePressed = false;
  private joyId: number | null = null;
  private joyCx = 0;

  constructor(private joyEl: HTMLElement, private knobEl: HTMLElement, jumpEl: HTMLElement, biteEl: HTMLElement) {
    const bindBtn = (el: HTMLElement, down: () => void, up: () => void) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('on'); down(); });
      const release = () => { el.classList.remove('on'); up(); };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
    };
    bindBtn(jumpEl, () => { this.jumpHeld = true; this.jumpPressed = true; }, () => { this.jumpHeld = false; });
    bindBtn(biteEl, () => { this.bitePressed = true; }, () => {});

    document.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (t !== document.body && t.id !== 'game') return;
      if (e.clientX > window.innerWidth / 2 || this.joyId !== null || e.clientX < EDGE_DEAD) return;
      this.joyId = e.pointerId;
      this.joyCx = JOY_FIXED_X;
      this.joyEl.style.display = 'block';
      this.joyEl.style.left = JOY_FIXED_X - 55 + 'px';
      this.joyEl.style.top = window.innerHeight - 90 - 55 + 'px';
      this.moveKnob(e.clientX);
    });
    document.addEventListener('pointermove', (e) => { if (e.pointerId === this.joyId) this.moveKnob(e.clientX); });
    const end = (e: PointerEvent) => { if (e.pointerId !== this.joyId) return; this.joyId = null; this.axisX = 0; this.joyEl.style.display = 'none'; };
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);

    const keys = new Set<string>();
    addEventListener('keydown', (e) => {
      if (!keys.has(e.code)) {
        if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') this.jumpPressed = true;
        if (e.code === 'KeyF' || e.code === 'KeyX') this.bitePressed = true;
      }
      keys.add(e.code); this.syncKeys(keys);
    });
    addEventListener('keyup', (e) => { keys.delete(e.code); this.syncKeys(keys); });
  }

  private syncKeys(keys: Set<string>) {
    if (this.joyId === null) this.axisX = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
    this.keyJump = keys.has('Space') || keys.has('ArrowUp') || keys.has('KeyW');
  }

  private moveKnob(x: number) {
    const dx = Math.max(-40, Math.min(40, x - this.joyCx));
    this.knobEl.style.transform = `translateX(${dx}px)`;
    const dead = 6;
    this.axisX = Math.abs(dx) < dead ? 0 : Math.sign(dx) * Math.min(1, (Math.abs(dx) - dead) / 28);
  }

  sample(): Sample {
    const s = { moveX: this.axisX, jump: this.jumpPressed, jumpHeld: this.jumpHeld || this.keyJump, bite: this.bitePressed };
    this.jumpPressed = false; this.bitePressed = false;
    return s;
  }
}
