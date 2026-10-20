// ПРОТОТИП 010. Тач-ввод: снимок состояния, который sim читает на каждом тике.
import type { Input } from './sim';

export type Layout = { name: string; jump: { right: number; bottom: number }; bite: { right: number; bottom: number } };
export const LAYOUTS: Layout[] = [
  { name: 'A: Прыг внизу', jump: { right: 24, bottom: 28 }, bite: { right: 130, bottom: 44 } },
  { name: 'B: Прыг слева', jump: { right: 100, bottom: 28 }, bite: { right: 28, bottom: 60 } },
  { name: 'C: Кус выше', jump: { right: 24, bottom: 28 }, bite: { right: 40, bottom: 134 } },
];

export const EDGE_DEAD = 48;
export const JOY_FIXED_X = 130;

export class Touch {
  axisX = 0;
  jumpHeld = false;
  biteHeld = false;
  private jumpPressed = false;
  private bitePressed = false;
  private joyId: number | null = null;
  private joyCx = 0;
  fixedJoy = true;

  constructor(private joyEl: HTMLElement, private knobEl: HTMLElement, jumpEl: HTMLElement, biteEl: HTMLElement) {
    const bindBtn = (el: HTMLElement, down: () => void, up: () => void) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('on'); down(); });
      const release = () => { el.classList.remove('on'); up(); };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
    };
    bindBtn(jumpEl, () => { this.jumpHeld = true; this.jumpPressed = true; }, () => { this.jumpHeld = false; });
    bindBtn(biteEl, () => { this.biteHeld = true; this.bitePressed = true; }, () => { this.biteHeld = false; });

    document.addEventListener('pointerdown', (e) => {
      if (e.target !== document.body && (e.target as HTMLElement).id !== 'game') return;
      if (e.clientX > window.innerWidth / 2 || this.joyId !== null) return;
      // мёртвая зона у левого края: там iOS/Telegram ловят свайп «назад»
      if (e.clientX < EDGE_DEAD) return;
      this.joyId = e.pointerId;
      const cx = this.fixedJoy ? JOY_FIXED_X : e.clientX;
      const cy = this.fixedJoy ? window.innerHeight - 90 : e.clientY;
      this.joyCx = cx;
      this.joyEl.style.display = 'block';
      this.joyEl.style.left = cx - 55 + 'px';
      this.joyEl.style.top = cy - 55 + 'px';
      this.moveKnob(e.clientX);
    });
    document.addEventListener('pointermove', (e) => { if (e.pointerId === this.joyId) this.moveKnob(e.clientX); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = null; this.axisX = 0;
      this.joyEl.style.display = 'none';
    };
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);

    // клавиатура — для проверки на компе
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

  private keyJump = false;
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

  /** Снимок на тик: нажатия «съедаются» ровно один раз. */
  sample(): Input {
    const i: Input = { moveX: this.axisX, jump: this.jumpPressed, jumpHeld: this.jumpHeld || this.keyJump, bite: this.bitePressed };
    this.jumpPressed = false; this.bitePressed = false;
    return i;
  }
}

export function applyLayout(l: Layout, jumpEl: HTMLElement, biteEl: HTMLElement) {
  jumpEl.style.right = l.jump.right + 'px'; jumpEl.style.bottom = l.jump.bottom + 'px';
  biteEl.style.right = l.bite.right + 'px'; biteEl.style.bottom = l.bite.bottom + 'px';
}
