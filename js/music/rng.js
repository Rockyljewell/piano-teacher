// Small seeded PRNG so every generated exercise can be reproduced from its seed.
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  // Weighted pick from {value: weight} object or [[value, weight]] array.
  next.weighted = (w) => {
    const entries = Array.isArray(w) ? w : Object.entries(w);
    const total = entries.reduce((a, [, x]) => a + x, 0);
    let r = next() * total;
    for (const [v, x] of entries) {
      r -= x;
      if (r <= 0) return v;
    }
    return entries[entries.length - 1][0];
  };
  return next;
}

export function randomSeed() {
  return (Math.random() * 2 ** 31) | 0;
}
