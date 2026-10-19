import { PROTOCOL_VERSION } from '@booberman/protocol';
import { appTitle } from '../title';
import { el, LOBBY_STYLE } from './dom';
import { type NoticeActionId, type NoticeKind, noticeFor } from './entryNotice';
import type { LobbyController, LobbyState } from './LobbyController';

/** What the `/room/:id` page shows. The nickname lives in the controller, not here. */
export type EntryScreen =
  /** Name box + "เข้าห้อง". `hint` is a sentence above the box (e.g. the server refused the name). */
  | { kind: 'form'; roomId: string; hint?: string }
  /** A dead end with a way forward (room full, not found, no connection...). */
  | { kind: 'notice'; notice: NoticeKind; roomId?: string };

export interface EntryActions {
  /** Try the same room again with the same name. */
  retry(): void;
  /** Reload the page (new client version). */
  reload(): void;
  /** Go to `/`. */
  home(): void;
}

/**
 * DOM screens for opening a room link (FE-19), over the same controller as the home screen so the
 * name rules, name memory and "create room" (with its 429 countdown) are not written twice.
 */
export class EntryOverlay {
  private readonly root = el('div', 'bb-lobby');
  private readonly styleEl = el('style');
  private readonly unsubscribe: () => void;
  private readonly input = el('input', 'bb-input');
  private readonly nickError = el('p', 'bb-error');
  private readonly submitBtn = el('button', 'bb-btn', 'เข้าห้อง');
  private readonly createError = el('p', 'bb-error');
  private readonly buttons = new Map<NoticeActionId, HTMLButtonElement>();

  constructor(
    private readonly controller: LobbyController,
    parent: HTMLElement,
    private readonly screen: EntryScreen,
    private readonly actions: EntryActions,
  ) {
    this.styleEl.textContent = LOBBY_STYLE;
    const wrap = el('div', 'bb-wrap');
    wrap.append(el('h1', 'bb-title', 'Booberman'), el('p', 'bb-sub', appTitle(PROTOCOL_VERSION)));
    wrap.append(screen.kind === 'form' ? this.buildForm(screen) : this.buildNotice(screen));
    this.root.append(this.styleEl, wrap);
    parent.append(this.root);

    this.unsubscribe = controller.subscribe((s) => this.render(s));
    this.render(controller.state);
    this.focusFirst();
  }

  destroy(): void {
    this.unsubscribe();
    this.root.remove();
  }

  private buildForm(screen: Extract<EntryScreen, { kind: 'form' }>): HTMLElement {
    const card = el('form', 'bb-card');
    card.noValidate = true;
    card.append(el('h2', undefined, `เข้าห้อง ${screen.roomId}`));
    if (screen.hint) {
      const hint = el('p', 'bb-hint', screen.hint);
      hint.setAttribute('role', 'alert');
      card.append(hint);
    }
    const label = el('label', 'bb-label', 'ชื่อของคุณ');
    this.input.id = 'bb-nickname';
    label.htmlFor = this.input.id;
    this.input.type = 'text';
    this.input.setAttribute('autocomplete', 'nickname');
    this.input.autocapitalize = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = 'เช่น มิ้นท์ หรือ Mint_01';
    this.input.setAttribute('aria-describedby', 'bb-nick-error');
    this.input.value = this.controller.state.nickname;
    this.nickError.id = 'bb-nick-error';
    this.nickError.setAttribute('role', 'alert');
    this.submitBtn.type = 'submit';
    const home = el('button', 'bb-btn bb-ghost', 'กลับหน้าแรก');
    home.type = 'button';
    home.addEventListener('click', () => this.actions.home());
    card.addEventListener('submit', (e) => {
      e.preventDefault();
      this.controller.joinRoom(screen.roomId);
    });
    this.input.addEventListener('input', () => this.controller.setNickname(this.input.value));
    const field = el('div');
    field.append(label, this.input, this.nickError);
    const row = el('div', 'bb-actions');
    row.append(this.submitBtn, home);
    card.append(field, row);
    return card;
  }

  private buildNotice(screen: Extract<EntryScreen, { kind: 'notice' }>): HTMLElement {
    const canCreate = this.controller.state.nicknameError === null && this.hasName();
    const notice = noticeFor(screen.notice, screen.roomId, canCreate);
    const card = el('div', 'bb-card');
    card.setAttribute('role', 'alert');
    card.append(el('h2', undefined, notice.title), el('p', undefined, notice.message));
    const row = el('div', 'bb-actions');
    for (const action of notice.actions) {
      const btn = el('button', action.primary ? 'bb-btn' : 'bb-btn bb-ghost', action.label);
      btn.type = 'button';
      btn.addEventListener('click', () => this.run(action.id));
      this.buttons.set(action.id, btn);
      row.append(btn);
    }
    this.createError.setAttribute('role', 'status');
    card.append(row, this.createError);
    return card;
  }

  private hasName(): boolean {
    return this.controller.state.nickname.trim() !== '';
  }

  private run(id: NoticeActionId): void {
    switch (id) {
      case 'create':
        void this.controller.createRoom();
        break;
      case 'retry':
        this.actions.retry();
        break;
      case 'reload':
        this.actions.reload();
        break;
      case 'home':
        this.actions.home();
        break;
    }
  }

  private render(s: LobbyState): void {
    const busy = s.creating || s.navigating;
    if (this.screen.kind === 'form') {
      this.nickError.textContent = s.nicknameError ?? '';
      this.input.setAttribute('aria-invalid', s.nicknameError ? 'true' : 'false');
      this.submitBtn.disabled = busy;
      this.submitBtn.textContent = s.navigating ? 'กำลังเข้าห้อง…' : 'เข้าห้อง';
      return;
    }
    for (const btn of this.buttons.values()) btn.disabled = busy;
    const create = this.buttons.get('create');
    if (create) {
      create.disabled = busy || s.cooldownSeconds > 0;
      create.textContent = s.creating ? 'กำลังสร้างห้อง…' : 'สร้างห้องใหม่';
    }
    this.createError.textContent = s.createError ?? '';
  }

  /**
   * Keyboard focus lands where the player acts next. A remembered name means "press the button" (and
   * keeps the phone keyboard down); an empty or bad name means "type it".
   */
  private focusFirst(): void {
    const s = this.controller.state;
    const target =
      this.screen.kind === 'form'
        ? s.nicknameError === null && this.hasName() && !this.screen.hint
          ? this.submitBtn
          : this.input
        : [...this.buttons.values()][0];
    target?.focus({ preventScroll: true });
  }
}
