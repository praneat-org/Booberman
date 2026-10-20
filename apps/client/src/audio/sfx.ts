/**
 * The five sounds of CAR-3796: place a bomb, bombs explode, a player dies, an item is picked up,
 * a round is won. Which server change triggers each one is decided in `sfxTracker.ts`; this file
 * only says what each one sounds like and which files hold the samples.
 */
export const SFX_NAMES = ['bombPlace', 'explode', 'die', 'pickup', 'win'] as const;
export type SfxName = (typeof SFX_NAMES)[number];

/** Phaser audio-cache keys. The files live in `public/audio/` (Kenney, CC0: see `LICENSE.txt` there). */
export const AudioKey = {
  BombPlace: 'sfx-bomb-place',
  BombExplode: 'sfx-bomb-explode',
  PlayerDie: 'sfx-player-die',
  ItemPickup: 'sfx-item-pickup',
  RoundWin: 'sfx-round-win',
} as const;

/**
 * Base names under `audio/`. Each is offered as .ogg and .mp3 and Phaser plays the first the browser
 * supports (older Safari / iOS have no Ogg Vorbis). Plain names for now: the hashed names from the
 * asset manifest (BE-37) replace this list once that lands.
 */
const FILE_BASENAME: Record<(typeof AudioKey)[keyof typeof AudioKey], string> = {
  [AudioKey.BombPlace]: 'bomb-place',
  [AudioKey.BombExplode]: 'bomb-explode',
  [AudioKey.PlayerDie]: 'player-die',
  [AudioKey.ItemPickup]: 'item-pickup',
  [AudioKey.RoundWin]: 'round-win',
};

export interface AudioFile {
  key: string;
  /** Relative to the loader's base URL, preferred format first. */
  urls: string[];
}

export const AUDIO_FILES: readonly AudioFile[] = Object.entries(FILE_BASENAME).map(
  ([key, base]) => ({ key, urls: [`audio/${base}.ogg`, `audio/${base}.mp3`] }),
);

/** One sample played for a sound. A sound with several voices is a short sequence (see `win`). */
export interface SfxVoice {
  key: string;
  volume: number;
  /** Playback speed, 1 = as recorded; also changes the pitch. */
  rate?: number;
  /** Seconds after the trigger. */
  delaySec?: number;
}

export const SFX_VOICES: Record<SfxName, readonly SfxVoice[]> = {
  bombPlace: [{ key: AudioKey.BombPlace, volume: 0.8 }],
  explode: [{ key: AudioKey.BombExplode, volume: 0.8 }],
  die: [{ key: AudioKey.PlayerDie, volume: 0.9 }],
  // the coin sample is the quietest of the five, so it plays at full volume
  pickup: [{ key: AudioKey.ItemPickup, volume: 1 }],
  // one chime four times, each a bit higher and later: a rising "round won" arpeggio
  win: [
    { key: AudioKey.RoundWin, volume: 0.7, rate: 1 },
    { key: AudioKey.RoundWin, volume: 0.7, rate: 1.26, delaySec: 0.09 },
    { key: AudioKey.RoundWin, volume: 0.7, rate: 1.5, delaySec: 0.18 },
    { key: AudioKey.RoundWin, volume: 0.8, rate: 2, delaySec: 0.27 },
  ],
};
