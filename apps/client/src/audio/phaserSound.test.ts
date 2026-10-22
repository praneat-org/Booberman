import { describe, expect, it } from 'vitest';
import { type PhaserSoundLike, toSoundPort } from './phaserSound';

/** A gain that records the order of the calls made on it. */
function webAudioManager() {
  const calls: string[] = [];
  let value = 1;
  const gain = {
    get value() {
      return value;
    },
    set value(v: number) {
      calls.push(`value=${v}`);
      value = v;
    },
    cancelScheduledValues(t: number) {
      calls.push(`cancel(${t})`);
    },
  };
  const manager = {
    // Phaser's own setter is the unreliable path: it must not be used when there is a gain node
    set mute(_v: boolean) {
      calls.push('PHASER-SETTER');
    },
    get mute() {
      return gain.value === 0;
    },
    locked: true,
    context: { state: 'suspended' },
    masterMuteNode: { gain },
    played: [] as unknown[],
    play(key: string, config?: unknown) {
      this.played.push([key, config]);
      return true;
    },
  };
  return { manager, calls };
}

describe('toSoundPort', () => {
  it('installs a limiter after master volume and restores the original route on dispose', () => {
    const connections: string[] = [];
    const compressor = {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      connect: () => connections.push('compressor->destination'),
      disconnect: () => connections.push('compressor disconnected'),
    } as unknown as DynamicsCompressorNode;
    const context = {
      state: 'running',
      destination: {} as AudioNode,
      createDynamicsCompressor: () => compressor,
    } as unknown as AudioContext;
    const masterVolumeNode = {
      disconnect: () => connections.push('volume disconnected'),
      connect: (target: AudioNode) =>
        connections.push(target === compressor ? 'volume->compressor' : 'volume->destination'),
    } as unknown as GainNode;
    const sound: PhaserSoundLike = {
      mute: false,
      locked: false,
      context,
      masterVolumeNode,
      play: () => true,
    };

    const port = toSoundPort(sound);

    expect(connections).toEqual([
      'volume disconnected',
      'volume->compressor',
      'compressor->destination',
    ]);
    expect(compressor.threshold.value).toBe(-1);
    expect(compressor.knee.value).toBe(0);
    expect(compressor.ratio.value).toBe(20);
    expect(compressor.attack.value).toBe(0.001);
    expect(compressor.release.value).toBe(0.12);

    port.dispose?.();

    expect(connections.slice(3)).toEqual([
      'volume disconnected',
      'compressor disconnected',
      'volume->destination',
    ]);
  });

  it('Web Audio: mute clears what is scheduled on the master gain, then writes the value (never Phaser setter)', () => {
    const { manager, calls } = webAudioManager();
    const port = toSoundPort(manager as PhaserSoundLike);
    port.setMute(true);
    expect(calls).toEqual(['cancel(0)', 'value=0']);
    expect(manager.mute).toBe(true);
    port.setMute(false);
    expect(calls).toEqual(['cancel(0)', 'value=0', 'cancel(0)', 'value=1']);
    expect(manager.mute).toBe(false);
  });

  it('HTML5 / no-audio fallback (no gain node): uses the manager setter', () => {
    let mute = false;
    const manager: PhaserSoundLike = {
      get mute() {
        return mute;
      },
      set mute(v) {
        mute = v;
      },
      locked: false,
      play: () => true,
    };
    toSoundPort(manager).setMute(true);
    expect(mute).toBe(true);
  });

  it('reads locked and context live from the manager (they change when the browser unlocks audio)', () => {
    const { manager } = webAudioManager();
    const port = toSoundPort(manager as PhaserSoundLike);
    expect(port.locked).toBe(true);
    expect(port.context?.state).toBe('suspended');
    manager.locked = false;
    manager.context = { state: 'running' };
    expect(port.locked).toBe(false);
    expect(port.context?.state).toBe('running');
  });

  it('play passes the key and config through', () => {
    const { manager } = webAudioManager();
    toSoundPort(manager as PhaserSoundLike).play('k', { volume: 0.5, rate: 2 });
    expect(manager.played).toEqual([['k', { volume: 0.5, rate: 2 }]]);
  });
});
