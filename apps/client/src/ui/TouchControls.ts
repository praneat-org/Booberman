import { el } from '../lobby/dom';
import {
  hitTouch,
  type Rect,
  type TouchButton,
  type TouchEnv,
  type TouchHandlers,
  type TouchHit,
  TouchPointers,
} from '../view/touchControls';

const STYLE = `
.bb-touch{position:relative;z-index:15;flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:8px max(16px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));
  background:#262645;border-top:2px solid #4a4a7a;box-sizing:border-box;
  user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:none}
.bb-touch *{box-sizing:border-box}
.bb-touch-pad{display:grid;grid-template:repeat(3,56px) / repeat(3,56px);gap:2px}
.bb-touch-btn{display:flex;align-items:center;justify-content:center;margin:0;padding:0;min-width:44px;min-height:44px;
  font:700 20px/1 system-ui,'Noto Sans Thai','Sarabun',sans-serif;color:#fff;background:#33335c;border:2px solid #4a4a7a;
  border-radius:10px;cursor:pointer;touch-action:none;-webkit-tap-highlight-color:transparent}
.bb-touch-btn[data-active=true]{color:#1b1b2f;background:#ffd84d;border-color:#ffd84d}
.bb-touch-up{grid-area:1/2}
.bb-touch-left{grid-area:2/1}
.bb-touch-right{grid-area:2/3}
.bb-touch-down{grid-area:3/2}
.bb-touch-bomb{width:92px;height:92px;border-radius:50%;font-size:16px;color:#fff;background:#c0392b;border-color:#e8665a}
.bb-touch-bomb[data-active=true]{color:#1b1b2f;background:#ffd84d;border-color:#ffd84d}
/* a phone on its side has no height to give: the controls float over the empty sides of the screen instead */
@media (orientation:landscape) and (max-height:500px){
  .bb-touch{position:fixed;left:0;right:0;bottom:0;background:transparent;border:0;pointer-events:none}
  .bb-touch-btn{pointer-events:auto;opacity:.85}
}
`;

const GLYPHS: Record<TouchButton, string> = {
  up: '▲',
  down: '▼',
  left: '◀',
  right: '▶',
  bomb: 'ระเบิด',
};
const LABELS: Record<TouchButton, string> = {
  up: 'เดินขึ้น',
  down: 'เดินลง',
  left: 'เดินซ้าย',
  right: 'เดินขวา',
  bomb: 'วางระเบิด',
};
const BUTTONS: readonly TouchButton[] = ['up', 'left', 'right', 'down', 'bomb'];

/** What the page tells us about the device; `touchEnabled` decides from it. */
export function browserTouchEnv(): TouchEnv {
  const coarse =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : undefined;
  return { coarsePointer: coarse, maxTouchPoints: navigator.maxTouchPoints ?? 0 };
}

/**
 * On-screen D-pad + bomb button for phones (FE-28). DOM, like the room bar: real buttons are easy
 * to hit and, in a flex column under `#app`, the canvas gets whatever height is left, so they never
 * sit on the board in portrait. All the thinking (which finger is on which button, multi-touch,
 * dragging off) is in `TouchPointers` and `hitTouch`; this class only turns pointer events into
 * their calls and paints which buttons are down. The handlers drive the same `DirectionTracker`
 * as the keyboard. The D-pad listens as a whole (not per button): where the finger is inside the
 * pad's box picks the direction, so the empty centre and the gaps between the buttons never drop it.
 */
export class TouchControls {
  private readonly root = el('div', 'bb-touch');
  private readonly styleEl = el('style');
  private readonly buttons = new Map<TouchButton, HTMLButtonElement>();
  private readonly pad = el('div', 'bb-touch-pad');
  private readonly pointers: TouchPointers;
  private readonly offs: (() => void)[] = [];

  constructor(
    handlers: TouchHandlers,
    private readonly host: HTMLElement,
    /** Called after the controls are added / removed so Phaser can re-fit the canvas to what is left. */
    private readonly onLayoutChange: () => void,
  ) {
    this.pointers = new TouchPointers({
      press: (b) => {
        this.paint(b, true);
        handlers.press(b);
      },
      release: (b) => {
        this.paint(b, false);
        handlers.release(b);
      },
    });
    this.styleEl.textContent = STYLE;
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'ปุ่มควบคุม');
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());

    for (const name of BUTTONS) {
      const button = this.makeButton(name);
      this.buttons.set(name, button);
      (name === 'bomb' ? this.root : this.pad).append(button);
    }
    this.root.prepend(this.pad);
    this.root.prepend(this.styleEl);
    // pointer events of the four direction buttons bubble to the pad: it decides from the position
    this.listen(this.pad, (e) => this.hit(e));
    const bomb = this.buttons.get('bomb');
    if (bomb) this.listen(bomb, () => 'bomb');

    // blur / hidden tab: a finger that is still down will never send its pointerup here
    const release = () => this.pointers.clear();
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    this.offs.push(() => {
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', release);
    });

    // below #app, so the flex column hands the canvas whatever height is left
    this.host.parentElement?.insertBefore(this.root, this.host.nextSibling);
    this.onLayoutChange();
  }

  destroy(): void {
    this.pointers.clear();
    for (const off of this.offs.splice(0)) off();
    this.root.remove();
    this.onLayoutChange();
  }

  private makeButton(name: TouchButton): HTMLButtonElement {
    const button = el('button', `bb-touch-btn bb-touch-${name}`, GLYPHS[name]);
    button.type = 'button';
    button.tabIndex = -1; // a finger is all this is for; never a keyboard focus stop
    button.setAttribute('aria-label', LABELS[name]);
    return button;
  }

  /**
   * Pointer events of one touch area. `onDown` says what the finger landed on; moves are re-read from
   * where the finger is now (`hit`), so a finger that slid away is still followed, and let go of when
   * it is over neither the pad nor the bomb.
   */
  private listen(area: HTMLElement, onDown: (e: PointerEvent) => TouchHit | undefined): void {
    area.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // no focus, no text selection, no emulated mouse events
      // keep receiving this finger's moves and its up even after it slides off the area
      try {
        area.setPointerCapture(e.pointerId);
      } catch {
        // a pointer the browser no longer knows (it lifted already): the press still counts, its up follows
      }
      const hit = onDown(e);
      if (hit !== undefined) this.pointers.down(e.pointerId, hit);
    });
    area.addEventListener('pointermove', (e) => this.pointers.move(e.pointerId, this.hit(e)));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      area.addEventListener(type, (e) => this.pointers.up(e.pointerId));
    }
  }

  /** What is under this pointer right now, by position. */
  private hit(e: PointerEvent): TouchHit | undefined {
    return hitTouch(this.rect(this.pad), this.rect(this.buttons.get('bomb')), e.clientX, e.clientY);
  }

  private rect(node: HTMLElement | undefined): Rect {
    const r = node?.getBoundingClientRect();
    return r
      ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      : { left: 0, top: 0, right: 0, bottom: 0 };
  }

  private paint(button: TouchButton, down: boolean): void {
    this.buttons.get(button)?.setAttribute('data-active', String(down));
  }
}
