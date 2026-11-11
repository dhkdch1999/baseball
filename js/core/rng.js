// 시드 기반 난수 생성기 (sfc32 + cyrb128 문자열 해시)
// 같은 시드 → 같은 수열. 브라우저/Node 공용.

export function hashSeed(...parts) {
  const str = parts.map(String).join('|');
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

export class Rng {
  constructor(...seedParts) {
    [this.a, this.b, this.c, this.d] = hashSeed(...seedParts);
    for (let i = 0; i < 12; i++) this.next(); // 워밍업
  }

  /** [0, 1) 실수 */
  next() {
    let { a, b, c, d } = this;
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return (r >>> 0) / 4294967296;
  }

  /** 확률 p로 true */
  chance(p) { return this.next() < p; }

  /** [min, max] 정수 */
  int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }

  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  /** 표준정규분포 (Box-Muller) */
  normal(mean = 0, sd = 1) {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** {key: weight} 또는 [[key, weight], ...] 에서 하나 선택 */
  weighted(table) {
    const entries = Array.isArray(table) ? table : Object.entries(table);
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = this.next() * total;
    for (const [k, w] of entries) {
      r -= w;
      if (r < 0) return k;
    }
    return entries[entries.length - 1][0];
  }

  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
