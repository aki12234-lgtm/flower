// Seeded, deterministic randomness.
// The whole plant must be reproducible from (seed + response sequence),
// otherwise we cannot tell whether two plants differ because of the answers
// or because of noise.

export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 1;
  const rng = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.int = (lo, hi) => Math.floor(lo + rng() * (hi - lo + 1));
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  rng.chance = (p) => rng() < p;
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  // roughly gaussian, centred on 0, sd ~0.29
  rng.bell = () => (rng() + rng() + rng()) / 3 - 0.5;
  rng.weighted = (items, weightOf) => {
    let total = 0;
    for (const it of items) total += Math.max(0, weightOf(it));
    if (total <= 0) return rng.pick(items);
    let r = rng() * total;
    for (const it of items) {
      r -= Math.max(0, weightOf(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  };
  // derive an independent stream (so re-rendering never disturbs simulation)
  rng.fork = (label) => makeRng(hashString(String(label) + ':' + Math.floor(rng() * 1e9)));
  return rng;
}

// Cheap value noise, used by the material renderers for grain and jitter.
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n) => {
    let t = Math.imul(n ^ seed, 2246822519);
    t = (t ^ (t >>> 13)) >>> 0;
    return t / 4294967296;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

export function noise2(x, y, seed = 0) {
  return noise1(x * 1.7 + y * 31.4, seed) * 0.5 + noise1(y * 2.3 - x * 17.9, seed + 977) * 0.5;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => { const c = clamp01(t); return c * c * (3 - 2 * c); };
