// log5 결합 + 리그 기준값 (밸런스 조정은 거의 이 파일에서 함)

export const logit = (p) => Math.log(p / (1 - p));
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/**
 * log5: 타자 비율 b, 투수 비율 p, 리그 평균 L → 이 대결의 기대 비율
 * (Bill James) = (b·p/L) / (b·p/L + (1-b)(1-p)/(1-L))
 */
export function log5(b, p, L) {
  const num = (b * p) / L;
  return num / (num + ((1 - b) * (1 - p)) / (1 - L));
}

/**
 * 능력치 z점수 → 리그평균 base 주변의 개인 비율.
 * spread는 1 표준편차당 로짓 이동량.
 */
export const rateFrom = (base, zScore, spread) => sigmoid(logit(base) + spread * zScore);

/** 타자 쪽 z와 투수 쪽 z(투수에게 유리할수록 +)를 log5로 합친다 */
export function matchup(base, zBat, spreadBat, zPit, spreadPit) {
  const b = rateFrom(base, zBat, spreadBat);
  const p = rateFrom(base, -zPit, spreadPit);
  return log5(b, p, base);
}

// ─────────────────────────────────────────────
// 리그 기준값 (1구 단위). 밸런스 스크립트로 조정한다.
// ─────────────────────────────────────────────
export const LEAGUE = {
  // 존 안으로 들어올 확률 (볼카운트별)
  zoneByCount: {
    '0-0': 0.555, '1-0': 0.585, '2-0': 0.625, '3-0': 0.710,
    '0-1': 0.505, '1-1': 0.535, '2-1': 0.575, '3-1': 0.640,
    '0-2': 0.395, '1-2': 0.445, '2-2': 0.505, '3-2': 0.595,
  },
  breakingZonePenalty: -0.30, // 변화구는 존 비율 낮음 (로짓)
  controlSpread: 0.30,

  // 스윙률
  swingZone: 0.66,
  chase: 0.31,
  swingZoneCount: { '3-0': -1.6, '3-1': 0.25, '0-2': 0.9, '1-2': 0.9, '2-2': 0.9, '3-2': 1.1, '0-0': -0.35 },
  chaseCount: { '3-0': -2.0, '0-2': 0.5, '1-2': 0.5, '2-2': 0.55, '3-2': 0.6, '0-0': -0.3 },
  eyeSpreadChase: 0.32,
  eyeSpreadZone: 0.08,

  // 컨택률 (스윙 시)
  contactZone: 0.92,
  contactOut: 0.77,
  contactSpreadBat: 0.32,
  contactSpreadPit: 0.30,

  // 컨택 시 파울 비율
  foulZone: 0.49,
  foulOut: 0.61,
  twoStrikeFoulBonus: 0.45, // 로짓, 삼진회피에 비례해 추가

  hbp: 0.0034, // 1구당 몸에 맞는 공

  // 폭투/포일 (주자 있을 때, 존 밖 변화구 1구당)
  wildPitch: 0.010,
  passedBall: 0.0025,
};

// 타구 기준값
export const BATTED = {
  // 타구 종류 기본 비율
  type: { GB: 0.44, LD: 0.21, FB: 0.27, PU: 0.08 },
  // 종류별 안타 확률 (홈런 제외, 평균 수비 기준)
  hit: { GB: 0.29, LD: 0.74, FB: 0.19, PU: 0.015 },
  qualityHitSpread: { GB: 0.35, LD: 0.40, FB: 0.45, PU: 0.2 },
  // 뜬공 중 홈런 확률 (로짓 기본값 + 타구 질 계수)
  hrPerFB: 0.054,
  hrPerLD: 0.012,
  hrQualitySpread: 0.95,
  defenseSpread: 0.12, // 수비 1표준편차당 안타 확률 로짓 변화
  errorRate: 0.028,    // 처리 가능한 타구당 실책
};
