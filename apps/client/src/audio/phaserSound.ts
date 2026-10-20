import type { SoundPort } from './GameAudio';

/** The master gain of Phaser's Web Audio manager: all we need of an `AudioParam`. */
interface GainParam {
  value: number;
  cancelScheduledValues(startTime: number): unknown;
}

/** What we read off Phaser's sound managers (Web Audio, HTML5 and "no audio" share most of it). */
export interface PhaserSoundLike {
  mute: boolean;
  readonly locked: boolean;
  readonly context?: { readonly state: string };
  /** Web Audio only. */
  readonly masterMuteNode?: { readonly gain: GainParam } | null;
  play(key: string, config?: { volume?: number; rate?: number; delay?: number }): boolean;
}

/**
 * Phaser's Web Audio `sound.mute = x` is `gain.setValueAtTime(x ? 0 : 1, 0)`: an event at time 0,
 * which is always in the past. Chromium sometimes keeps the old value after that (measured: ~30 %
 * of rapid toggles, and 1 in 8 for a single mute right after a sound played), so a muted game kept
 * the gain at 1 and sounds already playing stayed audible. Cancelling what is scheduled and writing
 * `gain.value` directly always took effect (0 of 300 failed in the same test). The HTML5 fallback has
 * no gain node, its own setter is fine.
 */
export function toSoundPort(sound: PhaserSoundLike): SoundPort {
  return {
    get locked() {
      return sound.locked;
    },
    get context() {
      return sound.context;
    },
    setMute(muted) {
      const gain = sound.masterMuteNode?.gain;
      if (!gain) {
        sound.mute = muted;
        return;
      }
      gain.cancelScheduledValues(0);
      gain.value = muted ? 0 : 1;
    },
    play: (key, config) => sound.play(key, config),
  };
}
