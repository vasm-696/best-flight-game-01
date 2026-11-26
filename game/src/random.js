// random.js — a small seeded generator (mulberry32). The same seed always gives
// the same stream, which is what makes the world, the sorties and the screenshot
// scenes repeatable. Accepts a number or a string seed.

export function hashString(text) {
  let h = 2166136261 >>> 0;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRandom(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
