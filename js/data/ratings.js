// 20~80 스카우트 스케일 정의와 변환
// 50 = 리그 평균, 10점 = 1 표준편차.

export const RATING_MIN = 20;
export const RATING_MAX = 80;

// 65 이상은 효과를 절반으로 (슈퍼스타가 비현실적으로 튀지 않도록)
export const z = (r) => (r <= 65 ? (r - 50) / 10 : 1.5 + (r - 65) / 20);

/** 화면 표시용: 5 단위로 반올림 (OOTP식) */
export const displayRating = (r) => Math.max(20, Math.min(80, Math.round(r / 5) * 5));

export const POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
export const POS_KO = {
  P: '투수', C: '포수', '1B': '1루수', '2B': '2루수', '3B': '3루수', SS: '유격수',
  LF: '좌익수', CF: '중견수', RF: '우익수', DH: '지명타자',
};
export const POS_SHORT_KO = {
  P: '투', C: '포', '1B': '1', '2B': '2', '3B': '3', SS: '유',
  LF: '좌', CF: '중', RF: '우', DH: '지',
};

// 포지션 간 수비 전환표: primary를 가진 선수가 다른 포지션에서 받는 수비 보정
export const POS_CROSSOVER = {
  C:   { '1B': -12 },
  '1B': { LF: -18, RF: -18, '3B': -20 },
  '2B': { SS: -8, '3B': -6, '1B': -4 },
  '3B': { '1B': -2, SS: -12, '2B': -10, LF: -12, RF: -12 },
  SS:  { '2B': -2, '3B': -3, '1B': -6, CF: -15 },
  LF:  { RF: -4, CF: -10, '1B': -10 },
  CF:  { LF: 2, RF: 0 },
  RF:  { LF: -2, CF: -8, '1B': -10 },
};

// 구종
export const PITCH_TYPES = {
  FF: { ko: '직구',     breaking: false },
  SI: { ko: '투심',     breaking: false },
  CT: { ko: '커터',     breaking: true },
  SL: { ko: '슬라이더', breaking: true },
  CU: { ko: '커브',     breaking: true },
  CH: { ko: '체인지업', breaking: true },
  FK: { ko: '포크',     breaking: true },
  SP: { ko: '스플리터', breaking: true },
};

/** 구속 능력치 → 직구 평균 구속(km/h). 50 → 144km */
export const veloKmh = (veloRating) => Math.round(144 + (veloRating - 50) * 0.36);
