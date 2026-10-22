import { SFX_VOICES, type SfxName } from './sfx';

/** The part of Phaser's sound manager we use, so the rules below can be unit tested without Phaser (see `phaserSound.ts` for the real one). */
export interface SoundPort {
  /** Silences / restores everything the port plays, including sounds that are already in flight. */
  setMute(muted: boolean): void;
  /** Releases any nodes installed into the shared sound manager. */
  dispose?(): void;
  /** True until the browser lets us make sound (first tap / key press). */
  readonly locked: boolean;
  /** Only the Web Audio manager has one; `suspended` also happens when the tab is in the background. */
  readonly context?: { readonly state: string };
  play(key: string, config?: { volume?: number; rate?: number; delay?: number }): boolean;
}

export interface AudioCachePort {
  exists(key: string): boolean;
}

/**
 * - `played`: handed to the sound manager
 * - `muted`: the player muted the game
 * - `locked`: the browser has not allowed sound yet (no tap / key press so far) or the tab is in the background
 * - `missing`: the sample file never loaded (404, decode error); the game carries on silently
 * - `error`: the sound manager threw
 */
export type SfxOutcome = 'played' | 'muted' | 'locked' | 'missing' | 'error';

export interface SfxLogEntry {
  name: SfxName;
  outcome: SfxOutcome;
  /** `performance.now()` when it was triggered. */
  at: number;
}

export interface GameAudioDeps {
  sound: SoundPort;
  cache: AudioCachePort;
  loadMuted: () => boolean;
  saveMuted: (muted: boolean) => void;
  now?: () => number;
  /** Called for every trigger, played or not (QA / `?debug=1` logging). */
  onLog?: (entry: SfxLogEntry) => void;
}

const LOG_LIMIT = 200;

/**
 * Plays the five sounds and owns the mute switch. Every trigger is logged with what became of it,
 * so "the server said a bomb was placed" can be checked without ears (headless browsers have none).
 *
 * Sound is never queued: a trigger that arrives before the browser unlocks audio is dropped, because
 * Web Audio would otherwise play all of them in one burst on the first key press.
 */
export class GameAudio {
  /** Newest last, capped at `LOG_LIMIT`. */
  readonly log: SfxLogEntry[] = [];
  private muted: boolean;
  private readonly listeners = new Set<(muted: boolean) => void>();
  private readonly sound: SoundPort;
  private readonly cache: AudioCachePort;
  private readonly saveMuted: (muted: boolean) => void;
  private readonly now: () => number;
  private readonly onLog: ((entry: SfxLogEntry) => void) | undefined;
  private disposed = false;

  constructor(deps: GameAudioDeps) {
    this.sound = deps.sound;
    this.cache = deps.cache;
    this.saveMuted = deps.saveMuted;
    this.now = deps.now ?? (() => performance.now());
    this.onLog = deps.onLog;
    this.muted = deps.loadMuted();
    // the sound manager outlives the scene: always bring it in line with the saved choice
    this.sound.setMute(this.muted);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    this.sound.setMute(muted);
    this.saveMuted(muted);
    for (const cb of this.listeners) cb(muted);
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** The mute button follows this, so the `M` key and the button stay in step. */
  onMuteChange(cb: (muted: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.sound.dispose?.();
  }

  /** Whether the browser lets us make sound right now. */
  get audible(): boolean {
    if (this.sound.locked) return false;
    const state = this.sound.context?.state;
    return state === undefined || state === 'running';
  }

  trigger(name: SfxName): SfxOutcome {
    const entry: SfxLogEntry = { name, outcome: this.play(name), at: this.now() };
    this.log.push(entry);
    if (this.log.length > LOG_LIMIT) this.log.shift();
    this.onLog?.(entry);
    return entry.outcome;
  }

  private play(name: SfxName): SfxOutcome {
    if (this.muted) return 'muted';
    if (!this.audible) return 'locked';
    const voices = SFX_VOICES[name];
    if (!voices.every((v) => this.cache.exists(v.key))) return 'missing';
    try {
      for (const v of voices) {
        // keys with undefined values would overwrite Phaser's defaults, so only set what is given
        const config: { volume: number; rate?: number; delay?: number } = { volume: v.volume };
        if (v.rate !== undefined) config.rate = v.rate;
        if (v.delaySec !== undefined) config.delay = v.delaySec;
        this.sound.play(v.key, config);
      }
      return 'played';
    } catch (error) {
      console.warn('[audio] could not play', name, error);
      return 'error';
    }
  }
}
