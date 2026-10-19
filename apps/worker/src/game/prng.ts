/**
 * mulberry32, written as a pure step: seed in → [value in [0, 1), next seed] out.
 * Keep the returned seed in `GameState.rngSeed` so every draw is replayable.
 */
export function nextRandom(seed: number): [value: number, nextSeed: number] {
  const t = (seed + 0x6d2b79f5) >>> 0;
  let r = Math.imul(t ^ (t >>> 15), t | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, t];
}
