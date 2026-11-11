export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** 타율 형식: 0.2673 → ".267" */
export function fmtAvg(x) {
  if (!isFinite(x)) return '-';
  const s = x.toFixed(3);
  return s.startsWith('0') ? s.slice(1) : s;
}

/** 아웃 수 → 이닝 표기: 17 → "5 2/3" */
export function fmtIP(outs) {
  const full = Math.floor(outs / 3), rem = outs % 3;
  if (rem === 0) return `${full}`;
  return full === 0 ? `${rem}/3` : `${full} ${rem}/3`;
}

export function fmtERA(er, outs) {
  if (outs === 0) return er > 0 ? '∞' : '-';
  return ((er * 27) / outs).toFixed(2);
}

export const sum = (arr) => arr.reduce((a, b) => a + b, 0);
