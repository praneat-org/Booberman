import { el } from '../lobby/dom';
import { cssColor, DEPARTED_NAME, type KillFeedLine } from '../view/killFeed';
import { CANVAS_HEIGHT_PX, HUD_HEIGHT_PX } from '../view/layout';

const CAUSE_COLOR: Readonly<Record<KillFeedLine['cause'], string>> = {
  curse: '#d58bff',
  ghost: '#7fd1ff',
  kick: '#7cfc7c',
  bomb: '#ffb347',
  self: '#c4c4d8',
};

const STYLE = `
.bb-killfeed{position:fixed;z-index:14;display:flex;flex-direction:column;align-items:flex-end;gap:3px;
  pointer-events:none;font:13px/1.3 system-ui,'Noto Sans Thai','Sarabun',sans-serif;color:#fff}
.bb-killfeed[hidden]{display:none}
.bb-kf-line{max-width:100%;padding:3px 8px;background:rgba(27,27,47,.78);border-radius:4px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bb-kf-cause{margin-left:6px;padding:0 5px;border:1px solid currentColor;border-radius:3px;font-size:11px}
`;

/** Inset from the board edge, in real px. */
const EDGE_PX = 4;
/** Longest the list may be, as a share of the board width, so it never covers most of the board. */
const MAX_WIDTH_SHARE = 0.7;

/**
 * Who killed whom, in the top-right corner of the board (CAR-3798 AC 1). DOM rather than canvas:
 * nicknames are Thai, and canvas text at 8 px logical is pixelated by the FIT scale. It never takes
 * the pointer (`pointer-events:none`), so it cannot block a touch on the board. Nicknames go in
 * through `textContent`, never HTML.
 */
export class KillFeedOverlay {
  private readonly root = el('div', 'bb-killfeed');
  private readonly styleEl = el('style');
  /** Ids of the lines on screen, so a frame that changes nothing touches nothing. */
  private shown = '';

  constructor(parent: HTMLElement = document.body) {
    this.styleEl.textContent = STYLE;
    this.root.dataset.testid = 'kill-feed';
    this.root.setAttribute('role', 'log');
    this.root.setAttribute('aria-label', 'ใครฆ่าใคร');
    this.root.hidden = true;
    this.root.append(this.styleEl);
    parent.append(this.root);
  }

  /** `canvas`: where the game canvas is on screen, only needed while there is something to show. */
  sync(lines: readonly KillFeedLine[], canvas: () => DOMRect | undefined): void {
    const key = lines.map((l) => l.id).join(',');
    if (lines.length === 0) {
      if (this.shown !== '') {
        this.shown = '';
        this.root.replaceChildren(this.styleEl);
        this.root.hidden = true;
      }
      return;
    }
    if (key !== this.shown) {
      this.shown = key;
      this.root.replaceChildren(this.styleEl, ...lines.map(renderLine));
      this.root.hidden = false;
    }
    const rect = canvas();
    if (rect) this.place(rect);
  }

  destroy(): void {
    this.root.remove();
  }

  /** Right edge of the board, just under the HUD strip; the canvas may move (resize, room bar). */
  private place(rect: DOMRect): void {
    const scale = rect.height / CANVAS_HEIGHT_PX;
    const style = this.root.style;
    style.top = `${Math.round(rect.top + HUD_HEIGHT_PX * scale + EDGE_PX)}px`;
    style.right = `${Math.max(0, Math.round(window.innerWidth - rect.right + EDGE_PX))}px`;
    style.maxWidth = `${Math.round(rect.width * MAX_WIDTH_SHARE)}px`;
  }
}

function renderLine(line: KillFeedLine): HTMLElement {
  const row = el('div', 'bb-kf-line');
  row.title = line.text;
  const victim = el('span', undefined, line.victimName);
  victim.style.color = cssColor(line.victimColor);
  const cause = el('span', 'bb-kf-cause', line.label);
  cause.style.color = CAUSE_COLOR[line.cause];
  if (line.self) {
    row.append(victim, cause);
    return row;
  }
  const killer = el('span', undefined, line.killerName ?? DEPARTED_NAME);
  if (line.killerColor !== undefined) killer.style.color = cssColor(line.killerColor);
  else killer.style.color = '#9aa0c8';
  row.append(killer, el('span', undefined, ' → '), victim, cause);
  return row;
}
