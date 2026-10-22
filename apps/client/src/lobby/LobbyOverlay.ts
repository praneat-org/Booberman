import { PROTOCOL_VERSION } from '@booberman/protocol';
import { appTitle } from '../title';
import { el, LOBBY_STYLE } from './dom';
import type { LobbyController, LobbyState } from './LobbyController';
import { ROOMS_ERROR_MESSAGE } from './LobbyController';

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
    this.styleEl.textContent = LOBBY_STYLE;
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

    const board = el('a', 'bb-btn bb-ghost bb-link', 'อันดับผู้เล่น');
    board.href = '/leaderboard';
    wrap.append(form, el('h2', 'bb-h2', 'ห้องที่เปิดอยู่'), this.roomsBox, board);
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
