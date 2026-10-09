/* Deterministic PRNG (mulberry32).

   Every state generator seeds its own stream, so the field looks identical
   on every load and on every machine. A cloud that reshuffles between page
   navigations would break the illusion that it is one object. */

export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
