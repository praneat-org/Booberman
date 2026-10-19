import { curseFrameVisible } from './hudView';
import type { Drawable } from './roundView';

export interface CurseFrameView {
  key: string;
  px: number;
  py: number;
  /** Blink phase, from the server tick. */
  visible: boolean;
}

/**
 * One purple frame per cursed player that is alive and not mid-death-animation. The curse itself
 * (`curse > 0`) is the server's; this only decides where the frame goes and which blink phase it is in.
 */
export function toCurseFrames(players: Drawable['players'], tick: number): CurseFrameView[] {
  const visible = curseFrameVisible(tick);
  const out: CurseFrameView[] = [];
  for (const { view, anim } of players) {
    if (!view.cursed || !view.alive || anim.phase === 'dying') continue;
    out.push({ key: view.id, px: view.px, py: view.py, visible });
  }
  return out;
}
