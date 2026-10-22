import { describe, expect, it, vi } from 'vitest';
import { GameAudio, type SfxLogEntry, type SoundPort } from './GameAudio';
import { AudioKey, SFX_NAMES, SFX_VOICES } from './sfx';

interface Played {
  key: string;
  config?: { volume?: number; rate?: number; delay?: number };
}

function fakeSound(init: Partial<Pick<SoundPort, 'locked' | 'context'>> = {}) {
  const played: Played[] = [];
  const sound = {
    /** What the last `setMute` asked for (the real port writes the master gain). */
    mute: false,
    muteCalls: [] as boolean[],
    locked: false,
    context: undefined,
    ...init,
    setMute(muted: boolean) {
      this.mute = muted;
      this.muteCalls.push(muted);
    },
    play: (key: string, config?: Played['config']) => {
      played.push({ key, config });
      return true;
    },
  } as SoundPort & {
    mute: boolean;
    muteCalls: boolean[];
    locked: boolean;
    context?: { state: string };
  };
  return { sound, played };
}

function setup(
  options: {
    sound?: ReturnType<typeof fakeSound>;
    loaded?: readonly string[];
    saved?: boolean;
    onLog?: (e: SfxLogEntry) => void;
  } = {},
) {
  const s = options.sound ?? fakeSound();
  const keys = new Set(options.loaded ?? Object.values(AudioKey));
  const saves: boolean[] = [];
  const audio = new GameAudio({
    sound: s.sound,
    cache: { exists: (k) => keys.has(k) },
    loadMuted: () => options.saved ?? false,
    saveMuted: (m) => saves.push(m),
    now: () => 123,
    onLog: options.onLog,
  });
  return { audio, ...s, saves, keys };
}

describe('GameAudio.trigger', () => {
  it('plays one sample for the simple sounds, at their own volume', () => {
    const { audio, played } = setup();
    expect(audio.trigger('bombPlace')).toBe('played');
    expect(played).toEqual([{ key: AudioKey.BombPlace, config: { volume: 0.8 } }]);
  });

  it('win is a rising arpeggio: the same sample at four rates, each a little later', () => {
    const { audio, played } = setup();
    expect(audio.trigger('win')).toBe('played');
    expect(played.map((p) => p.key)).toEqual(Array(4).fill(AudioKey.RoundWin));
    const rates = played.map((p) => p.config?.rate);
    expect(rates).toEqual([...rates].sort((a, b) => (a ?? 0) - (b ?? 0)));
    expect(new Set(rates).size).toBe(4);
    const delays = played.map((p) => p.config?.delay);
    expect(delays[0]).toBeUndefined(); // no key with an undefined value: it would overwrite Phaser's default
    expect(delays.slice(1)).toEqual([...delays.slice(1)].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it('every sound has at least one voice and every voice uses a loaded key', () => {
    for (const name of SFX_NAMES) {
      expect(SFX_VOICES[name].length).toBeGreaterThan(0);
      for (const v of SFX_VOICES[name]) expect(Object.values(AudioKey)).toContain(v.key);
    }
  });

  it('muted: nothing reaches the sound manager, but the trigger is still logged', () => {
    const { audio, played, sound } = setup({ saved: true });
    expect(sound.mute).toBe(true);
    expect(audio.trigger('explode')).toBe('muted');
    expect(played).toEqual([]);
    expect(audio.log).toEqual([{ name: 'explode', outcome: 'muted', at: 123 }]);
  });

  it('locked (no tap / key yet): dropped, and NOT queued for the moment audio unlocks', () => {
    const s = fakeSound({ locked: true });
    const { audio, played } = setup({ sound: s });
    expect(audio.trigger('bombPlace')).toBe('locked');
    expect(audio.trigger('explode')).toBe('locked');
    s.sound.locked = false;
    expect(played).toEqual([]);
    expect(audio.trigger('die')).toBe('played');
    expect(played).toHaveLength(1);
  });

  it('a suspended audio context (tab in the background) counts as locked; running plays', () => {
    const s = fakeSound({ context: { state: 'suspended' } });
    const { audio, played } = setup({ sound: s });
    expect(audio.trigger('pickup')).toBe('locked');
    (s.sound.context as { state: string }).state = 'running';
    expect(audio.trigger('pickup')).toBe('played');
    expect(played).toHaveLength(1);
  });

  it('a sample that never loaded is "missing": no throw, nothing played, other sounds still work', () => {
    const { audio, played } = setup({
      loaded: Object.values(AudioKey).filter((k) => k !== AudioKey.BombExplode),
    });
    expect(audio.trigger('explode')).toBe('missing');
    expect(audio.trigger('die')).toBe('played');
    expect(played.map((p) => p.key)).toEqual([AudioKey.PlayerDie]);
  });

  it('nothing loaded at all: every sound is "missing" and nothing throws', () => {
    const { audio } = setup({ loaded: [] });
    for (const name of SFX_NAMES) expect(audio.trigger(name)).toBe('missing');
  });

  it('a sound manager that throws is "error", not a crash of the frame loop', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = fakeSound();
    s.sound.play = () => {
      throw new Error('decode');
    };
    const { audio } = setup({ sound: s });
    expect(audio.trigger('pickup')).toBe('error');
    warn.mockRestore();
  });

  it('logs every trigger (newest last, capped) and tells onLog', () => {
    const seen: SfxLogEntry[] = [];
    const { audio } = setup({ onLog: (e) => seen.push(e) });
    for (let i = 0; i < 250; i++) audio.trigger(i % 2 === 0 ? 'bombPlace' : 'die');
    expect(audio.log).toHaveLength(200);
    expect(seen).toHaveLength(250);
    expect(audio.log.at(-1)).toEqual(seen.at(-1));
  });
});

describe('GameAudio mute switch', () => {
  it('starts unmuted by default and takes the saved choice, also onto the sound manager', () => {
    expect(setup().audio.isMuted).toBe(false);
    const saved = setup({ saved: true });
    expect(saved.audio.isMuted).toBe(true);
    expect(saved.sound.mute).toBe(true);
  });

  it('disposes its sound port once and drops mute listeners', () => {
    const s = fakeSound();
    const dispose = vi.fn();
    s.sound.dispose = dispose;
    const { audio } = setup({ sound: s });
    const listener = vi.fn();
    audio.onMuteChange(listener);

    audio.dispose();
    audio.dispose();
    audio.setMuted(true);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('a new GameAudio resets a sound manager that a previous scene left muted', () => {
    const s = fakeSound();
    s.sound.mute = true;
    const { sound } = setup({ sound: s, saved: false });
    expect(sound.mute).toBe(false);
    expect(sound.muteCalls).toEqual([false]); // told explicitly, not left to a default
  });

  it('toggle mutes the sound manager, saves, and silences later triggers; toggling back restores', () => {
    const { audio, sound, saves, played } = setup();
    expect(audio.toggleMuted()).toBe(true);
    expect(sound.mute).toBe(true);
    expect(saves).toEqual([true]);
    expect(audio.trigger('win')).toBe('muted');
    expect(audio.toggleMuted()).toBe(false);
    expect(sound.mute).toBe(false);
    expect(saves).toEqual([true, false]);
    expect(audio.trigger('win')).toBe('played');
    expect(played).toHaveLength(4);
  });

  it('setting the value it already has saves and notifies nothing', () => {
    const { audio, saves } = setup();
    const cb = vi.fn();
    audio.onMuteChange(cb);
    audio.setMuted(false);
    expect(saves).toEqual([]);
    expect(cb).not.toHaveBeenCalled();
  });

  it('listeners hear every change until they unsubscribe', () => {
    const { audio } = setup();
    const cb = vi.fn();
    const off = audio.onMuteChange(cb);
    audio.setMuted(true);
    audio.setMuted(false);
    expect(cb.mock.calls).toEqual([[true], [false]]);
    off();
    audio.setMuted(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
