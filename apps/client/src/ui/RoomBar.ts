import { el } from '../lobby/dom';
import { roomShareUrl } from '../lobby/joinTarget';
import {
  browserShareEnv,
  type ShareEnv,
  type ShareOutcome,
  shareRoomLink,
  usesNativeShare,
} from '../lobby/shareLink';

const STYLE = `
.bb-roombar{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;
  height:60px;padding:6px max(60px,calc(env(safe-area-inset-right) + 52px)) 6px max(12px,env(safe-area-inset-left));
  background:#262645;border-bottom:2px solid #4a4a7a;color:#fff;box-sizing:border-box;
  font:14px/1.3 system-ui,'Noto Sans Thai','Sarabun',sans-serif}
.bb-roombar *{box-sizing:border-box}
.bb-roombar-room{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bb-roombar-id{font-family:monospace;font-weight:700;color:#ffd84d}
.bb-roombar-btn{flex:none;min-height:44px;padding:6px 14px;font:inherit;font-weight:700;color:#1b1b2f;
  background:#ffd84d;border:0;border-radius:6px;cursor:pointer;touch-action:manipulation}
.bb-roombar-btn:focus-visible{outline:3px solid #7fd1ff;outline-offset:2px}
.bb-roombar-btn[hidden]{display:none}
.bb-roombar-toast{position:fixed;z-index:20;left:50%;transform:translateX(-50%);top:64px;max-width:calc(100vw - 24px);
  padding:8px 14px;background:#1f6f3a;color:#fff;border-radius:6px;font:14px/1.4 system-ui,'Noto Sans Thai','Sarabun',sans-serif;
  box-shadow:0 2px 8px rgba(0,0,0,.5)}
.bb-roombar-toast[hidden]{display:none}
.bb-roombar-manual{position:fixed;z-index:20;left:12px;right:12px;top:64px;max-width:420px;margin:0 auto;padding:12px;
  background:#262645;border:2px solid #ffd84d;border-radius:8px;color:#fff;display:flex;flex-direction:column;gap:8px;
  font:14px/1.4 system-ui,'Noto Sans Thai','Sarabun',sans-serif}
.bb-roombar-manual[hidden]{display:none}
.bb-roombar-manual input{width:100%;min-height:44px;padding:6px 10px;font:16px monospace;color:#fff;background:#1b1b2f;
  border:2px solid #4a4a7a;border-radius:6px}
.bb-roombar-manual button{align-self:flex-end;min-height:44px;padding:6px 14px;font:inherit;font-weight:700;color:#fff;
  background:#33335c;border:2px solid #4a4a7a;border-radius:6px;cursor:pointer}
`;

/** How long "copied" stays on screen. */
const TOAST_MS = 3000;

const COPIED_MESSAGE = 'คัดลอกลิงก์แล้ว ส่งให้เพื่อนได้เลย';
const SHARED_MESSAGE = 'แชร์ลิงก์ห้องแล้ว';
const MANUAL_MESSAGE = 'คัดลอกอัตโนมัติไม่ได้ กดค้างที่ลิงก์ด้านล่างแล้วคัดลอกเอง';

export interface RoomBarOptions {
  roomId: string;
  /** Page origin for the link. Defaults to `window.location.origin`. */
  origin?: string;
  env?: ShareEnv;
}

/**
 * The strip above the board while we are in a room (FE-19): room id and the copy / share link
 * button. DOM, not canvas: the clipboard and the share sheet need a real click, and a real button
 * is easy to hit at 360px. It sits above `#app` in a flex column, so the canvas never goes under it.
 */
export class RoomBar {
  private readonly root = el('div', 'bb-roombar');
  private readonly styleEl = el('style');
  private readonly label = el('div', 'bb-roombar-room');
  private readonly button = el('button', 'bb-roombar-btn');
  private readonly toast = el('div', 'bb-roombar-toast');
  private readonly manual = el('div', 'bb-roombar-manual');
  private readonly manualInput = el('input');
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly url: string;
  private readonly env: ShareEnv;

  constructor(
    private readonly opts: RoomBarOptions,
    private readonly host: HTMLElement,
    /** Called after the bar is added / removed so Phaser can re-fit the canvas to what is left. */
    private readonly onLayoutChange: () => void,
  ) {
    this.url = roomShareUrl(opts.origin ?? window.location.origin, opts.roomId);
    this.env = opts.env ?? browserShareEnv();
    this.styleEl.textContent = STYLE;
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'ห้อง');

    this.button.type = 'button';
    this.button.hidden = true;
    this.button.textContent = usesNativeShare(this.env) ? 'แชร์ลิงก์ห้อง' : 'คัดลอกลิงก์ห้อง';
    this.button.addEventListener('click', () => void this.press());

    this.toast.setAttribute('role', 'status');
    this.toast.hidden = true;

    this.manual.hidden = true;
    this.manualInput.readOnly = true;
    this.manualInput.value = this.url;
    this.manualInput.setAttribute('aria-label', 'ลิงก์ห้อง');
    this.manualInput.addEventListener('focus', () => this.manualInput.select());
    const close = el('button', undefined, 'ปิด');
    close.type = 'button';
    close.addEventListener('click', () => {
      this.manual.hidden = true;
      this.button.focus();
    });
    const manualText = el('div', undefined, MANUAL_MESSAGE);
    manualText.setAttribute('role', 'alert');
    this.manual.append(manualText, this.manualInput, close);

    this.root.append(this.styleEl, this.label, this.button, this.toast, this.manual);
    // above #app, so the flex column hands the canvas whatever height is left
    this.host.parentElement?.insertBefore(this.root, this.host);
    this.setJoined(false);
  }

  /** `false` while connecting (no button yet), `true` once `welcome` arrived. */
  setJoined(joined: boolean): void {
    const id = el('span', 'bb-roombar-id', this.opts.roomId);
    this.label.replaceChildren(joined ? 'ห้อง ' : 'กำลังเข้าห้อง ', id, joined ? '' : '…');
    this.button.hidden = !joined;
    this.onLayoutChange();
  }

  destroy(): void {
    if (this.toastTimer !== undefined) clearTimeout(this.toastTimer);
    this.toastTimer = undefined;
    this.root.remove();
    this.onLayoutChange();
  }

  private async press(): Promise<void> {
    // a new press starts clean: last time's "copied" must not be mistaken for this press's result
    this.toast.hidden = true;
    // no await before this call: navigator.share needs the click gesture
    const outcome = await shareRoomLink(this.url, this.env);
    this.show(outcome);
  }

  private show(outcome: ShareOutcome): void {
    switch (outcome) {
      case 'copied':
        this.flash(COPIED_MESSAGE);
        break;
      case 'shared':
        this.flash(SHARED_MESSAGE);
        break;
      case 'cancelled':
        break;
      case 'manual':
        this.manual.hidden = false;
        this.manualInput.focus();
        this.manualInput.select();
        break;
    }
  }

  private flash(message: string): void {
    this.manual.hidden = true;
    this.toast.textContent = message;
    this.toast.hidden = false;
    if (this.toastTimer !== undefined) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast.hidden = true;
      this.toastTimer = undefined;
    }, TOAST_MS);
  }
}
