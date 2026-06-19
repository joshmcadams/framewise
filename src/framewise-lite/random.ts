// A seeded, deterministic PRNG. Compositions that need randomness MUST use this
// instead of Math.random() — Math.random() is not seeded, so parallel render
// workers and the preview playback would each see a different sequence, which
// silently breaks the sha256 frame-determinism guarantee.
//
// Implementation: FNV-1a 32-bit hash for string seeds → mulberry32 PRNG.
// Both are fast single-pass functions with good statistical properties.

function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}

function mulberry32(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Returns a deterministic pseudo-random number in [0, 1) for the given seed.
 * The same seed always produces the same value, everywhere and always —
 * in preview, in render workers, across machines.
 *
 * Compose with the frame number for per-frame randomness:
 * ```
 * const x = random(frame);            // changes each frame
 * const y = random('particle:' + frame);  // namespaced variant
 * ```
 */
export function random(seed: number | string): number {
  const s = typeof seed === 'string' ? fnv1a32(seed) : Math.trunc(seed) >>> 0;
  return mulberry32(s);
}
