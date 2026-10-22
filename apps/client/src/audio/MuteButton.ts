import type { GameAudio } from './GameAudio';

const SPEAKER = '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/>';
const ICON_ON = `${SPEAKER}<path d="M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
const ICON_OFF = `${SPEAKER}<path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;

/** 44 px is the smallest comfortable touch target; the canvas is scaled to fit, so a DOM button keeps its real size. */
const SIZE_PX = 44;
const STYLE =
  `position:fixed;z-index:20;top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));` +
  `width:${SIZE_PX}px;height:${SIZE_PX}px;padding:0;display:flex;align-items:center;justify-content:center;` +
  `color:#fff;background:rgba(27,27,47,.85);border:2px solid #4a4a7a;border-radius:8px;cursor:pointer;` +
  `touch-action:manipulation;-webkit-tap-highlight-color:transparent;`;

type MuteSource = Pick<GameAudio, 'isMuted' | 'toggleMuted' | 'onMuteChange'>;

/**
 * Mute switch in the corner of the screen (not inside the canvas, whose scale would shrink it below
 * a finger). Not reachable with Tab on purpose: a focused button would also react to Space, the
 * bomb key; keyboard players use `M` instead.
 */
export class MuteButton {
  private readonly button = document.createElement('button');
  private readonly icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private readonly off: () => void;

  constructor(
    private readonly audio: MuteSource,
    parent: HTMLElement = document.body,
  ) {
    const { button, icon } = this;
    button.type = 'button';
    button.tabIndex = -1;
    button.dataset.testid = 'mute-button';
    button.title = 'ปิดเสียง (M)';
    button.setAttribute('aria-label', 'ปิดเสียง');
    button.style.cssText = STYLE;
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('width', '26');
    icon.setAttribute('height', '26');
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);
    // keep the canvas as the focused thing: no focus ring, and Space never lands on this button
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', () => {
      this.audio.toggleMuted();
      button.blur();
    });
    this.off = audio.onMuteChange(() => this.render());
    parent.append(button);
    this.render();
  }

  destroy(): void {
    this.off();
    this.button.remove();
  }

  private render(): void {
    const muted = this.audio.isMuted;
    this.button.setAttribute('aria-pressed', String(muted));
    this.button.style.opacity = muted ? '0.7' : '1';
    // static strings above, not user data
    this.icon.innerHTML = muted ? ICON_OFF : ICON_ON;
  }
}
