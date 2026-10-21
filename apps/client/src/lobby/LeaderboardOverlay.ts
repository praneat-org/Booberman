import { type LeaderboardBy, PROTOCOL_VERSION } from '@booberman/protocol';
import { appTitle } from '../title';
import { el, LOBBY_STYLE } from './dom';
import { fetchLeaderboard, type LeaderboardResult } from './leaderboardApi';
import { LEADERBOARD_TABS, leaderboardView, nextTabIndex } from './leaderboardView';

/** `/leaderboard` (FE-25): three tabs over `GET /api/leaderboard?by=`. DOM, same look as the lobby. */
export class LeaderboardOverlay {
  private readonly root = el('div', 'bb-lobby');
  private readonly body = el('div');
  private readonly tabs = new Map<LeaderboardBy, HTMLButtonElement>();
  private abort: AbortController | null = null;

  constructor(parent: HTMLElement, onHome: () => void) {
    const style = el('style', undefined, LOBBY_STYLE);
    const wrap = el('div', 'bb-wrap');
    wrap.append(el('h1', 'bb-title', 'อันดับ'), el('p', 'bb-sub', appTitle(PROTOCOL_VERSION)));

    const list = el('div', 'bb-tabs');
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'หมวดอันดับ');
    for (const { by, label } of LEADERBOARD_TABS) {
      const tab = el('button', 'bb-tab', label);
      tab.type = 'button';
      tab.id = `bb-tab-${by}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'bb-panel');
      tab.addEventListener('click', () => this.select(by));
      tab.addEventListener('keydown', (e) => {
        const i = nextTabIndex(
          e.key,
          LEADERBOARD_TABS.findIndex((t) => t.by === by),
          LEADERBOARD_TABS.length,
        );
        const target = i === null ? undefined : LEADERBOARD_TABS[i];
        if (!target) return;
        e.preventDefault();
        this.tabs.get(target.by)?.focus();
        this.select(target.by);
      });
      this.tabs.set(by, tab);
      list.append(tab);
    }
    this.body.id = 'bb-panel';
    this.body.setAttribute('role', 'tabpanel');
    this.body.setAttribute('aria-live', 'polite');

    const home = el('button', 'bb-btn bb-ghost', 'กลับหน้าแรก');
    home.type = 'button';
    home.addEventListener('click', onHome);
    wrap.append(list, this.body, home);
    this.root.append(style, wrap);
    parent.append(this.root);
    this.select('wins');
  }

  destroy(): void {
    this.abort?.abort();
    this.root.remove();
  }

  private select(by: LeaderboardBy): void {
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    for (const [key, tab] of this.tabs) {
      tab.setAttribute('aria-selected', String(key === by));
      tab.tabIndex = key === by ? 0 : -1;
    }
    this.body.setAttribute('aria-labelledby', `bb-tab-${by}`);
    this.render(by, null);
    // fetchLeaderboard never rejects (everything is caught inside), so no .catch here
    void fetchLeaderboard(by, fetch, abort.signal).then((result) => {
      if (!abort.signal.aborted && result.status !== 'aborted') this.render(by, result);
    });
  }

  private render(by: LeaderboardBy, result: LeaderboardResult | null): void {
    const view = leaderboardView(result);
    const label = LEADERBOARD_TABS.find((t) => t.by === by)?.label ?? '';
    if (view === 'loading') {
      this.body.replaceChildren(el('p', 'bb-note', 'กำลังโหลดอันดับ…'));
    } else if (result?.status !== 'ok') {
      const retry = el('button', 'bb-btn bb-ghost', 'ลองใหม่');
      retry.type = 'button';
      retry.addEventListener('click', () => this.select(by));
      this.body.replaceChildren(el('p', 'bb-error', 'โหลดอันดับไม่สำเร็จ ลองใหม่อีกครั้ง'), retry);
    } else if (view === 'empty') {
      this.body.replaceChildren(el('p', 'bb-note', 'ยังไม่มีข้อมูลอันดับ เล่นสักรอบแล้วกลับมาดูนะ'));
    } else {
      const list = el('ol', 'bb-rank');
      for (const e of result.entries) {
        const li = el('li', 'bb-row');
        li.append(
          el('span', 'bb-pos', String(e.rank)),
          el('span', 'bb-name', e.nickname),
          el('span', 'bb-val', `${e.value} ${label}`),
          el('span', 'bb-matches', `${e.matches} รอบ`),
        );
        list.append(li);
      }
      this.body.replaceChildren(list);
    }
  }
}
