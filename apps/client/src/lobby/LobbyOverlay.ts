import { PROTOCOL_VERSION } from '@booberman/protocol';
import { appTitle } from '../title';
import type { LobbyController, LobbyState } from './LobbyController';
import { ROOMS_ERROR_MESSAGE } from './LobbyController';

const STYLE = `
.bb-lobby{position:fixed;inset:0;z-index:10;overflow-y:auto;background:#1b1b2f;color:#fff;
  font:16px/1.5 system-ui,'Noto Sans Thai','Sarabun',sans-serif;
  padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom));box-sizing:border-box}
.bb-lobby *{box-sizing:border-box}
.bb-wrap{max-width:420px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
.bb-title{margin:8px 0 0;font:700 28px/1.2 monospace;text-align:center;letter-spacing:1px}
.bb-sub{margin:0;text-align:center;color:#9aa0c8;font-size:12px;font-family:monospace}
.bb-label{display:block;margin-bottom:4px;font-weight:600}
.bb-input{width:100%;min-height:48px;padding:8px 12px;font:inherit;color:#fff;background:#262645;
  border:2px solid #4a4a7a;border-radius:6px}
.bb-input:focus{outline:none;border-color:#7fd1ff}
.bb-input[aria-invalid=true]{border-color:#ff7a7a}
.bb-error{min-height:1.5em;margin:4px 0 0;color:#ff9a9a;font-size:14px}
.bb-btn{min-height:48px;padding:8px 16px;font:inherit;font-weight:700;color:#1b1b2f;background:#ffd84d;
  border:0;border-radius:6px;cursor:pointer;touch-action:manipulation}
.bb-btn:disabled{opacity:.5;cursor:not-allowed}
.bb-btn:focus-visible{outline:3px solid #7fd1ff;outline-offset:2px}
.bb-btn.bb-ghost{color:#fff;background:#33335c;border:2px solid #4a4a7a}
.bb-h2{margin:8px 0 0;font-size:16px;font-weight:700}
.bb-rooms{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.bb-room{display:flex;width:100%;justify-content:space-between;align-items:center;gap:8px;text-align:left}
.bb-note{margin:0;color:#9aa0c8;font-size:14px}
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** DOM home screen: real inputs give us IME (Thai), autofill and 16px text at 360px, which canvas text cannot. */
export class LobbyOverlay {
  private readonly root = el('div', 'bb-lobby');
  private readonly styleEl = el('style');
  private readonly input = el('input', 'bb-input');
  private readonly nickError = el('p', 'bb-error');
  private readonly createBtn = el('button', 'bb-btn', 'สร้างห้อง');
  private readonly createError = el('p', 'bb-error');
  private readonly roomsBox = el('div');
  private readonly unsubscribe: () => void;
  /** Last rendered room list; skipped when unchanged so a 5s poll does not drop keyboard focus from a room button. */
  private roomsKey = '';

  constructor(
    private readonly controller: LobbyController,
    parent: HTMLElement,
  ) {
    this.styleEl.textContent = STYLE;
    const wrap = el('div', 'bb-wrap');
    wrap.append(el('h1', 'bb-title', 'Booberman'), el('p', 'bb-sub', appTitle(PROTOCOL_VERSION)));

    const form = el('form');
    form.noValidate = true;
    const label = el('label', 'bb-label', 'ชื่อของคุณ');
    this.input.id = 'bb-nickname';
    label.htmlFor = this.input.id;
    this.input.type = 'text';
    this.input.setAttribute('autocomplete', 'nickname');
    this.input.autocapitalize = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = 'เช่น มิ้นท์ หรือ Mint_01';
    this.input.setAttribute('aria-describedby', 'bb-nick-error');
    this.nickError.id = 'bb-nick-error';
    this.nickError.setAttribute('role', 'alert');
    this.createBtn.type = 'submit';
    this.createError.setAttribute('role', 'alert');
    form.append(label, this.input, this.nickError, this.createBtn, this.createError);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void controller.createRoom();
    });
    this.input.addEventListener('input', () => controller.setNickname(this.input.value));

    wrap.append(form, el('h2', 'bb-h2', 'ห้องที่เปิดอยู่'), this.roomsBox);
    this.root.append(this.styleEl, wrap);
    parent.append(this.root);

    this.input.value = controller.state.nickname;
    this.unsubscribe = controller.subscribe((s) => this.render(s));
    this.render(controller.state);
  }

  destroy(): void {
    this.unsubscribe();
    this.root.remove();
  }

  private render(s: LobbyState): void {
    const busy = s.creating || s.navigating;
    this.nickError.textContent = s.nicknameError ?? '';
    this.input.setAttribute('aria-invalid', s.nicknameError ? 'true' : 'false');
    this.createBtn.disabled = busy || s.cooldownSeconds > 0;
    this.createBtn.textContent = s.creating ? 'กำลังสร้างห้อง…' : 'สร้างห้อง';
    this.createError.textContent = s.createError ?? '';
    const key = JSON.stringify([s.rooms, s.roomsError, busy]);
    if (key === this.roomsKey) return;
    this.roomsKey = key;
    this.renderRooms(s, busy);
  }

  private renderRooms(s: LobbyState, busy: boolean): void {
    this.roomsBox.replaceChildren();
    if (s.rooms === null) {
      this.roomsBox.append(
        s.roomsError ? this.roomsErrorBox() : el('p', 'bb-note', 'กำลังโหลดรายการห้อง…'),
      );
      return;
    }
    if (s.roomsError) this.roomsBox.append(this.roomsErrorBox());
    if (s.rooms.length === 0) {
      this.roomsBox.append(el('p', 'bb-note', 'ยังไม่มีห้องที่เปิดอยู่ สร้างห้องใหม่ได้เลย'));
      return;
    }
    const list = el('ul', 'bb-rooms');
    for (const room of s.rooms) {
      const item = el('li');
      const btn = el('button', 'bb-btn bb-ghost bb-room');
      btn.type = 'button';
      btn.disabled = busy;
      btn.append(
        el('span', undefined, `ห้อง ${room.roomId}`),
        el('span', undefined, `${room.players}/${room.max} คน`),
      );
      btn.addEventListener('click', () => this.controller.joinRoom(room.roomId));
      item.append(btn);
      list.append(item);
    }
    this.roomsBox.append(list);
  }

  private roomsErrorBox(): HTMLElement {
    const box = el('div');
    const retry = el('button', 'bb-btn bb-ghost', 'ลองใหม่');
    retry.type = 'button';
    retry.addEventListener('click', () => void this.controller.refreshRooms());
    box.append(el('p', 'bb-error', ROOMS_ERROR_MESSAGE), retry);
    return box;
  }
}
