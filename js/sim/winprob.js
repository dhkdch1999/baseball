// 승리 확률 (win expectancy): 이닝·아웃·주자·점수차로 남은 득점 분포를 합성해서 계산
// 반이닝 득점 분포 = P(0점) + (1점 이상일 때) 기하분포. 기준값은 RE24 / 득점확률 표.

// [아웃][주자상태] 주자상태 비트: 1루=1, 2루=2, 3루=4
const RE = [
  [0.48, 0.86, 1.10, 1.44, 1.35, 1.73, 1.96, 2.29],
  [0.25, 0.51, 0.66, 0.88, 0.95, 1.14, 1.35, 1.53],
  [0.10, 0.22, 0.32, 0.42, 0.35, 0.48, 0.57, 0.74],
];
const P0 = [
  [0.73, 0.58, 0.38, 0.38, 0.16, 0.14, 0.18, 0.14],
  [0.84, 0.73, 0.59, 0.56, 0.34, 0.38, 0.32, 0.33],
  [0.93, 0.87, 0.78, 0.77, 0.73, 0.73, 0.74, 0.68],
];
// 주자 비트 → 표 인덱스 (빈 루, 1, 2, 12, 3, 13, 23, 123)
const IDX = [0, 1, 2, 3, 4, 5, 6, 7];
const MAXR = 15;

const cache = new Map();
function runDist(outs, baseBits) {
  const key = outs * 8 + baseBits;
  if (cache.has(key)) return cache.get(key);
  const i = IDX[baseBits];
  const p0 = P0[outs][i], m = RE[outs][i];
  const q = Math.max(0, Math.min(0.85, 1 - (1 - p0) / Math.max(m, 1e-6)));
  const d = new Array(MAXR + 1).fill(0);
  d[0] = p0;
  let rest = 1 - p0;
  for (let k = 1; k < MAXR; k++) { d[k] = rest * (1 - q) * q ** (k - 1); }
  d[MAXR] = Math.max(0, 1 - d.reduce((a, b) => a + b, 0));
  cache.set(key, d);
  return d;
}

const OFF = 40; // 점수차 배열 오프셋 (홈 - 원정)

/** 점수차 분포에 반이닝 득점 분포를 더한다 (home=true면 홈팀 득점) */
function addHalf(diff, dist, home) {
  const out = new Array(diff.length).fill(0);
  for (let d = 0; d < diff.length; d++) {
    if (!diff[d]) continue;
    for (let r = 0; r < dist.length; r++) {
      const nd = Math.max(0, Math.min(diff.length - 1, d + (home ? r : -r)));
      out[nd] += diff[d] * dist[r];
    }
  }
  return out;
}

/**
 * 홈팀 승리 확률 (무승부는 절반으로 계산)
 * @param s { inning, half(0초/1말), outs, bases:[b1,b2,b3], score:[away, home], maxInnings }
 */
export function homeWinProb(s, innings = 9) {
  const maxInn = Math.min(s.maxInnings ?? 11, 15);
  let diff = new Array(OFF * 2 + 1).fill(0);
  diff[Math.max(0, Math.min(OFF * 2, OFF + s.score[1] - s.score[0]))] = 1;
  let inning = s.inning, half = s.half;
  let win = 0, tie = 0;
  // 현재 반이닝 남은 부분
  if (s.outs < 3) {
    const bits = (s.bases[0] ? 1 : 0) | (s.bases[1] ? 2 : 0) | (s.bases[2] ? 4 : 0);
    diff = addHalf(diff, runDist(s.outs, bits), half === 1);
  }
  const full = runDist(0, 0);
  const settle = () => {
    // 정규이닝 이후 이닝이 끝나면 승부가 난 경우는 확정
    for (let d = 0; d < diff.length; d++) {
      if (d === OFF || !diff[d]) continue;
      if (d > OFF) win += diff[d];
      diff[d] = 0;
    }
  };
  // 다음 반이닝들
  for (;;) {
    if (half === 0) {
      // 초 종료 → 9회 이상 말에 홈팀이 앞서면 경기 종료
      if (inning >= innings) for (let d = OFF + 1; d < diff.length; d++) { win += diff[d]; diff[d] = 0; }
      half = 1;
      diff = addHalf(diff, full, true);
    } else {
      if (inning >= innings) settle();
      if (inning >= maxInn) break;
      inning++;
      half = 0;
      diff = addHalf(diff, full, false);
    }
    if (diff.reduce((a, b) => a + b, 0) < 1e-6) break;
  }
  tie = diff[OFF] || 0;
  for (let d = 0; d < diff.length; d++) if (d > OFF) win += diff[d];
  return Math.max(0, Math.min(1, win + tie * 0.5));
}
