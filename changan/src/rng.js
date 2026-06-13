// Deterministic PRNG so the city is identical every visit.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed = 1337) {
  const r = mulberry32(seed);
  return {
    f: () => r(),                                  // [0,1)
    range: (a, b) => a + (b - a) * r(),            // [a,b)
    int: (a, b) => Math.floor(a + (b - a + 1) * r()), // integer [a,b]
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
  };
}
