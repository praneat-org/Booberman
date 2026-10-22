import { el } from '../lobby/dom';
import { RECONNECTING_TITLE, reconnectingText, secondsLeft } from '../view/reconnectView';

const STYLE = `
.bb-reconnect{position:fixed;inset:0;z-index:18;display:flex;align-items:center;justify-content:center;
  padding:16px;background:rgba(27,27,47,.85);color:#fff;box-sizing:border-box;
  font:16px/1.5 system-ui,'Noto Sans Thai','Sarabun',sans-serif}
.bb-reconnect[hidden]{display:none}
.bb-reconnect *{box-sizing:border-box}
.bb-reconnect-card{width:100%;max-width:360px;padding:20px 16px;display:flex;flex-direction:column;align-items:center;
  gap:12px;text-align:center;background:#262645;border:2px solid #4a4a7a;border-radius:8px}
.bb-reconnect-spin{width:32px;height:32px;border:4px solid #4a4a7a;border-top-color:#ffd84d;border-radius:50%;
  animation:bb-reconnect-spin 1s linear infinite}
@keyframes bb-reconnect-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.bb-reconnect-spin{animation:none}}
.bb-reconnect-title{margin:0;font-size:20px;line-height:1.3;color:#ffd84d}
.bb-reconnect-text{margin:0;font-size:14px;color:#c4c4d8;overflow-wrap:anywhere}
`;

/**
 * "กำลังเชื่อมต่อใหม่" over the whole page while the connection is being won back (FE-22). It covers the
 * touch controls too, so a thumb does not keep pressing buttons that go nowhere. Hidden until `show`.
 */
export class ReconnectOverlay {
  private readonly root = el('div', 'bb-reconnect');
  private readonly styleEl = el('style');
  private readonly text = el('p', 'bb-reconnect-text');
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    host: HTMLElement,
    private readonly now: () => number = Date.now,
  ) {
    this.styleEl.textContent = STYLE;
    this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    const card = el('div', 'bb-reconnect-card');
    card.append(
      el('div', 'bb-reconnect-spin'),
      el('h2', 'bb-reconnect-title', RECONNECTING_TITLE),
      this.text,
    );
    this.root.append(this.styleEl, card);
    host.append(this.root);
  }

  /** `deadline`: when we stop trying, on the clock `now` reads. */
  show(deadline: number): void {
    this.stop();
    const paint = () => {
      this.text.textContent = reconnectingText(secondsLeft(deadline, this.now()));
    };
    paint();
    this.timer = setInterval(paint, 500);
    this.root.hidden = false;
  }

  hide(): void {
    this.stop();
    this.root.hidden = true;
  }

  destroy(): void {
    this.stop();
    this.root.remove();
  }

  private stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}
