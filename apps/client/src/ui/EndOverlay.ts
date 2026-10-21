import { el } from '../lobby/dom';
import {
  type EndRow,
  type EndTitleLine,
  type EndView,
  REMATCH_BUTTON_LABEL,
  REMATCH_WAITING_LABEL,
  type RematchView,
  rematchButtonLocked,
  rematchCountdownText,
  rematchStatusText,
  WAITING_BUTTON_LABEL,
  type WaitingRow,
  waitingStatusText,
} from '../view/endView';
import { cssColor } from '../view/killFeed';

const STYLE = `
.bb-end{position:fixed;inset:0;z-index:15;display:flex;overflow-y:auto;background:rgba(27,27,47,.9);color:#fff;
  padding:60px max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));
  box-sizing:border-box;font:16px/1.5 system-ui,'Noto Sans Thai','Sarabun',sans-serif}
.bb-end[hidden]{display:none}
.bb-end *{box-sizing:border-box}
.bb-end-card{width:100%;max-width:440px;margin:auto;padding:16px;display:flex;flex-direction:column;gap:12px;
  background:#262645;border:2px solid #4a4a7a;border-radius:8px}
.bb-end-head{margin:0;font-size:26px;line-height:1.25;text-align:center;overflow-wrap:anywhere}
.bb-end-head.bb-win{color:#ffd84d}
.bb-end-reason{margin:0;text-align:center;color:#9aa0c8;font-size:14px}
.bb-end-table{width:100%;border-collapse:collapse;font-size:15px}
.bb-end-table caption{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.bb-end-table th{padding:4px 6px;text-align:right;font-size:12px;font-weight:600;color:#9aa0c8;white-space:nowrap}
.bb-end-table th:nth-child(2){text-align:left}
.bb-end-table td{padding:6px;text-align:right;border-top:1px solid #3a3a63;font-variant-numeric:tabular-nums}
.bb-end-table td:first-child{width:28px;text-align:center;color:#9aa0c8}
.bb-end-table td.bb-end-name{width:100%;max-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bb-end-table tr.bb-self{background:#33335c}
.bb-end-table .bb-end-pts{font-weight:700;color:#ffd84d}
.bb-end-swatch{display:inline-block;width:10px;height:10px;margin-right:6px;border:1px solid #fff}
.bb-end-you{margin-left:6px;font-size:12px;color:#7fd1ff}
.bb-end-h3{margin:4px 0 0;font-size:14px;color:#9aa0c8}
.bb-end-titles{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.bb-end-title-name{font-weight:700;color:#ffd84d}
.bb-end-none{margin:0;color:#9aa0c8;font-size:14px}
.bb-end-rematch{display:flex;flex-direction:column;gap:6px;margin-top:4px}
.bb-end-status{margin:0;min-height:3em;font-size:14px;color:#c4c4d8;overflow-wrap:anywhere}
.bb-end-count{margin:0;min-height:1.5em;font-size:14px;color:#ffd84d}
.bb-end-btn{min-height:48px;padding:8px 16px;font:inherit;font-weight:700;color:#1b1b2f;background:#ffd84d;
  border:0;border-radius:6px;cursor:pointer;touch-action:manipulation}
.bb-end-btn:disabled{opacity:.6;cursor:default}
.bb-end-ready{margin-left:auto;padding-left:8px;font-size:13px;white-space:nowrap;color:#9aa0c8}
.bb-end-ready.bb-on{color:#7fe08a;font-weight:700}
.bb-end-btn:focus-visible{outline:3px solid #7fd1ff;outline-offset:2px}
`;

export interface EndActions {
  /** The player pressed "play again": send `rematch`. */
  onRematch(): void;
}

/**
 * The end-of-round screen (CAR-3798 AC 2, 3): the server's table, the titles, and the "play again"
 * button with who is ready and the countdown. A DOM layer over the canvas, not a Phaser scene: the
 * text is Thai (the pixel canvas would blur it), the button must stay 48 px tall on a phone whatever
 * the canvas scale, and the table can scroll on a short screen. Everything shown comes from `EndView`
 * / `RematchView` (the server's `roundEnd` / `rematchStatus`); this class decides nothing about the
 * game. Nicknames go in through `textContent`, never HTML.
 */
export class EndOverlay {
  private readonly root = el('div', 'bb-end');
  private readonly styleEl = el('style');
  private readonly card = el('div', 'bb-end-card');
  private readonly body = el('div');
  private readonly status = el('p', 'bb-end-status');
  private readonly count = el('p', 'bb-end-count');
  private readonly button = el('button', 'bb-end-btn', REMATCH_BUTTON_LABEL);
  /** The `EndView` the screen was built from; a new one (new round ended) rebuilds it. */
  private built: EndView | undefined;
  /** BE-57: the waiting room list as last drawn (`undefined` = not showing the waiting room). */
  private builtWaiting: string | undefined;
  /** When we pressed, until the server's `rematchStatus` says we are ready (see `rematchButtonLocked`). */
  private pressedAt: number | undefined;
  private shownStatus = '';
  private shownCount: string | undefined;
  private shownLabel = REMATCH_BUTTON_LABEL;
  private shownLocked = false;

  constructor(
    private readonly actions: EndActions,
    parent: HTMLElement = document.body,
  ) {
    this.styleEl.textContent = STYLE;
    this.root.dataset.testid = 'end-screen';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'สรุปรอบนี้');
    this.root.hidden = true;

    this.status.dataset.testid = 'rematch-status';
    // the status changes when someone presses; the countdown ticks every second and stays silent
    this.status.setAttribute('aria-live', 'polite');
    this.count.dataset.testid = 'rematch-countdown';
    this.button.type = 'button';
    this.button.dataset.testid = 'rematch-button';
    this.button.addEventListener('click', () => this.press());

    const rematch = el('div', 'bb-end-rematch');
    rematch.append(this.status, this.count, this.button);
    this.card.append(this.body, rematch);
    this.root.append(this.styleEl, this.card);
    parent.append(this.root);
  }

  /** Once per frame. `end` undefined = no end screen (a round is running). `nowMs`: `Date.now()`. */
  sync(end: EndView | undefined, rematch: RematchView | undefined, nowMs: number): void {
    if (!end) {
      if (!this.root.hidden) this.hide();
      return;
    }
    if (end !== this.built) this.build(end);
    this.root.hidden = false;
    if (rematch) this.paintRematch(rematch, nowMs);
  }

  /**
   * BE-57: the room waits for its first round. Same card and button as the end screen: who is in,
   * who pressed "ready", and the rule (two or more players, everyone ready; no countdown).
   */
  syncWaiting(rows: readonly WaitingRow[], rematch: RematchView, nowMs: number): void {
    const key = JSON.stringify(rows);
    if (key !== this.builtWaiting) this.buildWaiting(rows, key);
    this.root.hidden = false;
    this.paintRematch(rematch, nowMs, waitingStatusText(rematch), WAITING_BUTTON_LABEL);
  }

  destroy(): void {
    this.root.remove();
  }

  private press(): void {
    if (this.button.disabled) return;
    this.pressedAt = Date.now();
    this.lock(true, REMATCH_WAITING_LABEL);
    this.actions.onRematch();
  }

  /** A round started: put every part back to how a new screen starts (button free, no status, no countdown). */
  private hide(): void {
    this.root.hidden = true;
    this.built = undefined;
    this.builtWaiting = undefined;
    this.pressedAt = undefined;
    this.body.replaceChildren();
    this.status.textContent = '';
    this.count.textContent = '';
    this.button.disabled = false;
    this.button.textContent = REMATCH_BUTTON_LABEL;
    this.shownStatus = '';
    this.shownCount = undefined;
    this.shownLabel = REMATCH_BUTTON_LABEL;
    this.shownLocked = false;
  }

  private buildWaiting(rows: readonly WaitingRow[], key: string): void {
    // a new screen (not a list update): give the button back like `hide` does
    if (this.builtWaiting === undefined) this.hide();
    this.builtWaiting = key;
    const head = el('h2', 'bb-end-head', 'รอผู้เล่น');
    head.dataset.testid = 'waiting-headline';
    this.root.setAttribute('aria-label', 'ห้องรอ');
    const list = el('ul', 'bb-end-titles');
    list.style.marginTop = '12px';
    list.dataset.testid = 'waiting-players';
    for (const row of rows) {
      const li = el('li');
      li.style.display = 'flex';
      li.dataset.player = row.id;
      const swatch = el('span', 'bb-end-swatch');
      swatch.style.background = cssColor(row.color);
      li.append(swatch, row.name);
      if (row.isSelf) li.append(el('span', 'bb-end-you', 'คุณ'));
      li.append(
        el(
          'span',
          row.ready ? 'bb-end-ready bb-on' : 'bb-end-ready',
          row.ready ? 'พร้อม' : 'ยังไม่พร้อม',
        ),
      );
      list.append(li);
    }
    this.body.replaceChildren(head, list);
  }

  private build(end: EndView): void {
    this.built = end;
    this.builtWaiting = undefined;
    this.root.setAttribute('aria-label', 'สรุปรอบนี้');
    this.pressedAt = undefined;
    const head = el('h2', end.youWon ? 'bb-end-head bb-win' : 'bb-end-head', end.headline);
    head.dataset.testid = 'end-headline';
    const reason = el('p', 'bb-end-reason', end.reason);
    const table = this.table(end.rows);
    const titles = el('h3', 'bb-end-h3', 'ฉายา');
    this.body.replaceChildren(head, reason, table, titles, this.titleList(end.titles));
    this.root.scrollTop = 0;
  }

  private table(rows: readonly EndRow[]): HTMLElement {
    const table = el('table', 'bb-end-table');
    table.dataset.testid = 'end-table';
    table.append(el('caption', undefined, 'ตารางสรุปรอบนี้ เรียงตามแต้มเกรียน'));
    const head = el('tr');
    for (const label of ['#', 'ผู้เล่น', 'ฆ่า', 'ตาย', 'แต้มเกรียน']) {
      const th = el('th', undefined, label);
      th.scope = 'col';
      head.append(th);
    }
    const thead = el('thead');
    thead.append(head);
    table.append(thead);
    const bodyEl = el('tbody');
    for (const row of rows) bodyEl.append(this.tableRow(row));
    table.append(bodyEl);
    return table;
  }

  private tableRow(row: EndRow): HTMLElement {
    const tr = el('tr', row.isSelf ? 'bb-self' : undefined);
    tr.dataset.player = row.id;
    const name = el('td', 'bb-end-name');
    const swatch = el('span', 'bb-end-swatch');
    swatch.style.background = cssColor(row.color);
    name.append(swatch, row.name);
    if (row.isSelf) name.append(el('span', 'bb-end-you', 'คุณ'));
    name.title = row.name;
    tr.append(
      el('td', undefined, String(row.rank)),
      name,
      el('td', undefined, String(row.kills)),
      el('td', undefined, String(row.deaths)),
      el('td', 'bb-end-pts', String(row.trollPoints)),
    );
    return tr;
  }

  private titleList(titles: readonly EndTitleLine[]): HTMLElement {
    if (titles.length === 0) return el('p', 'bb-end-none', 'รอบนี้ยังไม่มีใครได้ฉายา');
    const list = el('ul', 'bb-end-titles');
    list.dataset.testid = 'end-titles';
    for (const t of titles) {
      const li = el('li');
      const holders = t.holders.map((h) => (h.isSelf ? `${h.name} (คุณ)` : h.name)).join(', ');
      li.append(el('span', 'bb-end-title-name', t.label), ` — ${holders} · ${t.value} ${t.unit}`);
      list.append(li);
    }
    return list;
  }

  /** Writes only what changed: this runs every frame while the screen is up. */
  private paintRematch(
    v: RematchView,
    nowMs: number,
    status = rematchStatusText(v),
    label = REMATCH_BUTTON_LABEL,
  ): void {
    if (status !== this.shownStatus) {
      this.shownStatus = status;
      this.status.textContent = status;
    }
    const count = rematchCountdownText(v.secondsLeft);
    if (count !== this.shownCount) {
      this.shownCount = count;
      this.count.textContent = count ?? '';
    }
    const locked = rematchButtonLocked(v.selfReady, this.pressedAt, nowMs);
    this.lock(locked, locked ? REMATCH_WAITING_LABEL : label);
  }

  private lock(locked: boolean, label: string): void {
    if (locked !== this.shownLocked) {
      this.shownLocked = locked;
      this.button.disabled = locked;
    }
    if (label !== this.shownLabel) {
      this.shownLabel = label;
      this.button.textContent = label;
    }
  }
}
