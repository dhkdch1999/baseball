// 선수 생성: 표시 능력치(현재) + 숨은 잠재력
import { SURNAMES, GIVEN_FIRST, GIVEN_SECOND } from './names.js';
import { POS_CROSSOVER } from './ratings.js';
import { clamp } from '../core/util.js';

const r8 = (x) => Math.round(clamp(x, 20, 80));

let nextId = 1;
export const resetPlayerIds = (n = 1) => { nextId = n; };
export const getNextPlayerId = () => nextId;

export function makeName(rng, usedNames) {
  for (let i = 0; i < 50; i++) {
    const s = rng.weighted(SURNAMES);
    let g = rng.pick(GIVEN_FIRST) + rng.pick(GIVEN_SECOND);
    if (g[0] === g[1]) continue;
    const name = s + g;
    if (!usedNames || !usedNames.has(name)) {
      usedNames?.add(name);
      return name;
    }
  }
  return rng.weighted(SURNAMES) + rng.pick(GIVEN_FIRST) + rng.pick(GIVEN_SECOND);
}

function makeAge(rng) {
  // 19~38, 26~29세가 가장 많음
  return clamp(Math.round(rng.normal(27.5, 4)), 19, 38);
}

/** 나이에 따른 현재 능력치 대비 잠재력 여유 */
function potentialGap(rng, age) {
  if (age <= 22) return Math.max(0, rng.normal(14, 6));
  if (age <= 25) return Math.max(0, rng.normal(7, 4));
  if (age <= 28) return Math.max(0, rng.normal(2, 2));
  return 0;
}

/**
 * 타자 생성
 * @param tier 선수 수준 (0 = 평균 주전, 음수 = 백업)
 */
export function makeHitter(rng, pos, tier = 0, usedNames) {
  const age = makeAge(rng);
  const talent = rng.normal(50 + tier, 7);
  // 포지션별 공격/수비 성향
  const defBias = { C: 4, SS: 6, '2B': 4, CF: 5, '3B': 1, RF: 0, LF: -3, '1B': -6 }[pos] ?? 0;
  const offBias = -defBias * 0.6;

  const powerArch = rng.normal(0, 1); // + 장타형, - 교타형
  const contact = r8(talent + offBias - powerArch * 4 + rng.normal(0, 6));
  const power   = r8(talent + offBias + powerArch * 7 + rng.normal(0, 6) + (pos === '1B' ? 4 : 0));
  const eye     = r8(talent + offBias + rng.normal(0, 8));
  const avoidK  = r8(contact * 0.6 + 20 - powerArch * 3 + rng.normal(0, 6));
  const speedBase = { CF: 8, SS: 6, '2B': 5, LF: 2, RF: 1, '3B': -2, C: -12, '1B': -8 }[pos] ?? 0;
  const speed   = r8(50 + speedBase - (age - 27) * 0.9 - powerArch * 2 + rng.normal(0, 9));
  const arm     = r8(50 + ({ RF: 8, SS: 6, '3B': 6, C: 4, CF: 2, '2B': -4, LF: -6, '1B': -8 }[pos] ?? 0) + rng.normal(0, 9));
  const primaryDef = r8(talent * 0.3 + 35 + defBias + rng.normal(0, 8));
  const catcherLead = pos === 'C' ? r8(rng.normal(52, 9)) : 20;

  const def = { [pos]: primaryDef };
  for (const [other, delta] of Object.entries(POS_CROSSOVER[pos] || {})) {
    def[other] = r8(primaryDef + delta + rng.normal(0, 4));
  }

  const ratings = { contact, power, eye, avoidK, speed, arm, catcherLead, def };
  const gap = potentialGap(rng, age);
  const potential = {};
  for (const k of ['contact', 'power', 'eye', 'avoidK']) {
    potential[k] = r8(ratings[k] + gap * (0.6 + rng.next() * 0.8));
  }
  potential.def = r8(primaryDef + gap * 0.5);

  return {
    id: nextId++,
    name: makeName(rng, usedNames),
    age,
    type: 'H',
    pos,
    bats: rng.weighted([['R', 62], ['L', 33], ['S', 5]]),
    throws: ['C', 'SS', '2B', '3B'].includes(pos) ? 'R' : rng.weighted([['R', 75], ['L', 25]]),
    ratings,
    // 숨은 성향 (스카우트 화면에 직접 표시하지 않음)
    tend: {
      gb: clamp(rng.normal(0, 1) - powerArch * 0.6, -2.5, 2.5), // + 땅볼형
      pull: clamp(rng.normal(0, 1) + powerArch * 0.4, -2.5, 2.5), // + 당겨치기
    },
    potential, // 숨겨진 잠재력
    condition: 0, // -10 ~ +10 (컨디션)
    fatigue: 0,
    ...careerFields(rng, age),
  };
}

const BREAKING_POOL = [['SL', 30], ['CH', 22], ['CU', 18], ['FK', 14], ['CT', 10], ['SP', 6]];

export function makePitcher(rng, role, tier = 0, usedNames) {
  const age = makeAge(rng);
  const talent = rng.normal(50 + tier, 7);
  const velo = r8(talent + rng.normal(0, 8));
  const control = r8(talent + rng.normal(0, 8) - (velo - 50) * 0.15);
  const stuff = r8(talent * 0.5 + velo * 0.35 + 7.5 + rng.normal(0, 6));
  const nPitches = role === 'SP' ? rng.weighted([[2, 35], [3, 45], [1, 20]]) : rng.weighted([[1, 50], [2, 40], [3, 10]]);
  const pitches = [];
  const pool = BREAKING_POOL.slice();
  for (let i = 0; i < nPitches; i++) {
    const t = rng.weighted(pool);
    pool.splice(pool.findIndex(([k]) => k === t), 1);
    pitches.push({ type: t, grade: r8(talent + rng.normal(i === 0 ? 2 : -3, 8)) });
  }
  const twoSeam = rng.chance(0.3);
  const stamina = role === 'SP' ? r8(rng.normal(58, 8)) : r8(rng.normal(36, 8));
  const mental = r8(rng.normal(50, 10));

  const ratings = { velo, control, stuff, pitches, stamina, mental };
  const gap = potentialGap(rng, age);
  const potential = {
    velo: r8(velo + gap * 0.4),
    control: r8(control + gap * (0.6 + rng.next() * 0.6)),
    stuff: r8(stuff + gap * (0.6 + rng.next() * 0.6)),
  };

  return {
    id: nextId++,
    name: makeName(rng, usedNames),
    age,
    type: 'P',
    pos: 'P',
    role, // 'SP' | 'RP'
    throws: rng.weighted([['R', 72], ['L', 28]]),
    bats: 'R',
    ratings,
    tend: { gb: clamp(rng.normal(twoSeam ? 0.8 : 0, 1), -2.5, 2.5), twoSeam },
    potential,
    condition: 0,
    fatigue: 0,
    ...careerFields(rng, age),
  };
}

/** 타자의 대략적인 공격 가치 (타순·라인업 결정용) */
export function offenseScore(p) {
  const r = p.ratings;
  return r.contact * 0.32 + r.power * 0.30 + r.eye * 0.18 + r.avoidK * 0.10 + r.speed * 0.10;
}

export function pitcherScore(p) {
  const r = p.ratings;
  const best = Math.max(50, ...r.pitches.map((x) => x.grade));
  return r.stuff * 0.35 + r.control * 0.3 + r.velo * 0.15 + best * 0.2;
}

/** 경력/계약/기록 공통 필드 */
function careerFields(rng, age) {
  return {
    injury: null, // { type, days }
    stats: {}, // { [시즌키]: { team, bat, pit } }
    service: Math.max(0, Math.min(age - 19, Math.round(age - 20 - rng.next() * 2))), // 1군 등록 연차
    contract: null, // { salary(만원), years }
    scoutNoise: rng.normal(0, 4), // 스카우트 잠재력 평가 오차
    draft: null,
  };
}

const POS_BONUS = { C: 3, SS: 3, CF: 2, '2B': 2, '3B': 1, RF: 0, LF: -1, '1B': -2 };

/** 종합 능력치 (20~80) */
export function overall(p, useRatings) {
  if (!useRatings || typeof useRatings !== 'object') useRatings = p.ratings;
  if (p.type === 'P') {
    const r = useRatings;
    const best = Math.max(45, ...(r.pitches || p.ratings.pitches).map((x) => x.grade));
    const base = r.stuff * 0.33 + r.control * 0.3 + r.velo * 0.17 + best * 0.2;
    return base + (p.role === 'SP' ? (p.ratings.stamina - 55) * 0.12 : -1.5);
  }
  const r = useRatings;
  const off = r.contact * 0.32 + r.power * 0.30 + r.eye * 0.18 + r.avoidK * 0.10 + p.ratings.speed * 0.10;
  const d = (r.def ?? p.ratings.def)[p.pos] ?? 40;
  return off + (d - 50) * 0.25 + (POS_BONUS[p.pos] ?? 0);
}

/** 잠재 종합 능력치 (숨김 값) */
export function potentialOverall(p) {
  const pr = p.potential;
  if (p.type === 'P') {
    return Math.max(overall(p), overall(p, { ...p.ratings, velo: pr.velo, control: pr.control, stuff: pr.stuff }));
  }
  const def = { ...p.ratings.def, [p.pos]: pr.def ?? p.ratings.def[p.pos] };
  return Math.max(overall(p), overall(p, { ...p.ratings, contact: pr.contact, power: pr.power, eye: pr.eye, avoidK: pr.avoidK, def }));
}

/** 스카우트가 보는 잠재력 (오차 포함, 5단위) */
/** 능력치별 잠재력 (스카우트 평가: 선수·항목마다 고정된 오차가 있다). 성장 여지가 없는 항목은 null */
export function scoutPotentialKey(p, key) {
  const cur = key === 'def' ? p.ratings.def?.[p.pos] : p.ratings[key];
  const pot = p.potential?.[key];
  if (cur == null || pot == null) return null;
  let h = 0;
  for (const c of `${p.id}:${key}`) h = (h * 31 + c.charCodeAt(0)) | 0;
  const noise = ((h >>> 0) % 1000) / 1000 * 5 - 2.5; // -2.5 ~ +2.5
  const est = Math.round(Math.min(80, pot + noise + (p.scoutNoise || 0) * 0.5));
  return est > cur + 1 ? est : null;
}

export function scoutPotential(p) {
  const est = Math.max(overall(p), potentialOverall(p) + (p.scoutNoise || 0));
  return Math.max(20, Math.min(80, Math.round(est / 5) * 5));
}

/** 시장 연봉 (만원) */
export function marketSalary(p) {
  const v = overall(p);
  const age = p.age;
  const agePen = age >= 33 ? 0.7 : age >= 31 ? 0.85 : 1;
  return Math.max(3000, Math.min(450000, Math.round((3000 + 4000 * Math.exp((v - 45) / 6.5)) * agePen / 100) * 100));
}

/** 연차 기반 연봉 (FA 전 선수는 시장가보다 낮게) */
export function serviceSalary(p, rng) {
  const m = marketSalary(p);
  const factor = p.service < 2 ? 0.15 : p.service < 4 ? 0.3 : p.service < 6 ? 0.5 : p.service < 8 ? 0.7 : 1;
  const noise = rng ? 0.85 + rng.next() * 0.3 : 1;
  return Math.max(3000, Math.round((m * factor * noise) / 100) * 100);
}

export function initContract(p, rng) {
  const years = p.service >= 8 ? rng.int(1, 4) : rng.int(1, 2);
  p.contract = { salary: serviceSalary(p, rng), years };
}

/** 드래프트 대상 아마추어 선수 */
export function makeProspect(rng, usedNames) {
  const isP = rng.chance(0.52);
  const age = rng.weighted([[18, 45], [19, 5], [21, 10], [22, 40]]);
  const tier = -17 + rng.normal(0, 3);
  let p;
  if (isP) p = makePitcher(rng, rng.chance(0.55) ? 'SP' : 'RP', tier, usedNames);
  else p = makeHitter(rng, rng.weighted([['C', 10], ['1B', 8], ['2B', 12], ['3B', 10], ['SS', 16], ['LF', 10], ['CF', 14], ['RF', 10]]), tier, usedNames);
  p.age = age;
  p.service = 0;
  // 큰 성장 여지: 상위 지명감은 잠재력이 매우 높다
  const gap = Math.max(3, rng.normal(age <= 19 ? 15 : 11, 7));
  const pot = p.potential;
  for (const k of Object.keys(pot)) {
    const cur = k === 'def' ? p.ratings.def[p.pos] : p.ratings[k];
    pot[k] = Math.round(Math.max(20, Math.min(80, cur + gap * (0.7 + rng.next() * 0.6))));
  }
  p.scoutNoise = rng.normal(0, 6);
  p.contract = null;
  return p;
}

// ───────────── 외국인 선수 ─────────────
// KBO 규정: 구단당 외국인 3명 + 아시아쿼터 1명
export const FOREIGN_MAX = 3;
export const ASIA_MAX = 1;
export const FOREIGN_NEW_CAP = 140000; // 신규 외국인 연봉 상한 (만원, 약 100만 달러)
export const ASIA_NEW_CAP = 28000; // 아시아쿼터 상한 (약 20만 달러)

const FOREIGN_NAMES = [
  '스미스', '존슨', '윌리엄스', '브라운', '가르시아', '마르티네스', '로페스', '곤잘레스', '페레스', '산체스', '라미레스',
  '토레스', '플로레스', '리베라', '고메스', '크루스', '모랄레스', '오르티스', '데이비스', '밀러', '윌슨', '무어', '앤더슨',
  '토마스', '잭슨', '해리스', '마틴', '톰슨', '워커', '앨런', '라이트', '스콧', '그린', '베이커', '애덤스', '넬슨', '캠벨',
  '미첼', '로버츠', '카터', '필립스', '에반스', '터너', '파커', '콜린스', '에드워즈', '스튜어트', '모리스', '머피', '쿡',
  '로저스', '모건', '피터슨', '쿠퍼', '리드', '베일리', '켈리', '하워드', '콕스', '리처드슨', '왓슨', '베넷', '그레이',
  '헤이스', '마이어스', '포드', '해밀턴', '그레이엄', '설리번', '월리스', '헤인스', '바스케스', '메디나', '카스티요',
  '로하스', '멘도사', '게레로', '베탄코트', '알몬테', '소토', '히메네스', '피네다', '발렌수엘라', '산타나', '폰세',
, '브래드쇼', '윈슬로', '허드슨', '에버렛', '맥과이어', '브룩스', '코넬', '댈튼', '개릿', '핸슨', '키팅', '라일리', '오닐', '퀸', '레이놀즈', '샌더스', '바르가스', '살라자르', '로사리오', '에스피노자', '델가도', '폰세카', '카브레라', '비야누에바', '알바레스', '곤살레스', '몬테로', '파디야', '에스코바', '스티븐스', '홀랜드', '웹스터', '포스터', '하딩', '패터슨', '스톤', '버크', '헤일', '웨이드', '버넷', '플레처', '헌트', '로완', '블레이크', '칼훈', '도노반', '쉐퍼', '벨'];
const ASIA_NAMES = [
  '다카하시', '이토', '와타나베', '가토', '요시다', '야마다', '사사키', '마쓰모토', '이노우에', '기무라', '하야시',
  '시미즈', '야마자키', '모리', '이케다', '하시모토', '이시카와', '오가와', '후지타', '오카다', '린', '천', '황',
  '장', '우', '차이', '쉬', '쩡', '해밀', '오코너', '맥도널드', '톰킨스',
, '나카무라', '오카모토', '마쓰다', '후지와라', '고바야시', '사이토', '린위민', '천관위', '장즈하오', '우성펑', '리우이', '호지슨', '쿠퍼'];

const usedForeign = new Set();
export const resetForeignNames = (names = []) => { usedForeign.clear(); names.forEach((n) => usedForeign.add(n)); };
function foreignName(rng, asia, usedNames) {
  const pool = asia ? ASIA_NAMES : FOREIGN_NAMES;
  for (let i = 0; i < 40; i++) {
    const n = rng.pick(pool);
    if (!usedNames?.has(n) && !usedForeign.has(n)) { usedNames?.add(n); usedForeign.add(n); return n; }
  }
  // 겹치면 이니셜을 붙인다 (예: J.스미스)
  const n = `${rng.pick('ABCDEJMRT'.split(''))}.${rng.pick(pool)}`;
  usedNames?.add(n);
  return n;
}

/** 외국인 신규 영입 요구 연봉 (만원) */
export function foreignAsk(p, renew = false) {
  const v = overall(p);
  if (p.asia) return Math.round(Math.max(10000, Math.min(renew ? 60000 : ASIA_NEW_CAP, 12000 + (v - 45) * 1500)) / 500) * 500;
  const base = 40000 + (v - 50) * 7000;
  return Math.round(Math.max(30000, Math.min(renew ? 250000 : FOREIGN_NEW_CAP, base)) / 1000) * 1000;
}

/**
 * 외국인 후보 생성. 스카우트 리포트(report)는 실제 능력에 오차를 섞은 값이고,
 * 계약해야 진짜 능력이 드러난다.
 */
export function makeForeignPlayer(rng, { type = 'P', role = 'SP', asia = false, usedNames = null } = {}) {
  const tier = asia ? rng.normal(-1.5, 3.5) : type === 'P' ? rng.normal(0.5, 4) : rng.normal(3.5, 4);
  const p = type === 'P'
    ? makePitcher(rng, role, tier, null)
    : makeHitter(rng, rng.weighted([['1B', 28], ['RF', 18], ['LF', 14], ['3B', 14], ['CF', 12], ['2B', 7], ['SS', 7]]), tier, null);
  p.name = foreignName(rng, asia, usedNames);
  p.age = rng.int(25, 33);
  p.foreign = true;
  p.asia = asia;
  p.service = 0;
  // 전성기 나이라 잠재력 = 현재 능력 근처
  for (const k of Object.keys(p.potential)) {
    const cur = k === 'def' ? p.ratings.def[p.pos] : p.ratings[k];
    if (cur != null) p.potential[k] = Math.max(cur, Math.min(80, cur + Math.round(Math.max(0, rng.normal(1, 2)))));
  }
  // 스카우트 리포트: 관측값(실제+오차)을 같은 유형 후보 평균 쪽으로 당겨서(베이즈 추정) 보여준다.
  // 그냥 실제+오차를 보여주면 "리포트가 좋게 나온 선수"만 고르게 되어 영입 후 늘 실망하게 된다(승자의 저주).
  const NOISE = 3, TRUE_SD = 8, k = TRUE_SD ** 2 / (TRUE_SD ** 2 + NOISE ** 2);
  const mu = asia ? 50.5 : type === 'P' ? (role === 'SP' ? 52 : 50) : 53.5;
  const bias = rng.normal(0, NOISE); // 스카우트 오차 (선수마다 고정)
  const est = (v, m) => Math.round(Math.max(20, Math.min(80, m + (v + bias + rng.normal(0, 2) - m) * k)));
  const keys = type === 'P' ? ['velo', 'control', 'stuff', 'stamina'] : ['contact', 'power', 'eye', 'speed'];
  p.report = {
    ovr: Math.round(mu + (overall(p) + bias - mu) * k),
    err: Math.round(Math.sqrt(k) * NOISE * 1.5), // 표시 오차 범위 (약 ±4)
    keys: Object.fromEntries(keys.map((key) => [key, est(p.ratings[key], 50)])),
    note: rng.pick(type === 'P'
      ? ['마이너리그 트리플A 선발 경험 풍부', '빠른 공이 강점, 제구는 기복', '변화구 완성도가 높음', '이닝 소화력이 좋다는 평가', '일본 리그 경험 있음', '부상 이력은 없음']
      : ['트리플A 장타력 상위권', '컨택형, 삼진이 적음', '선구안이 좋아 출루율이 높음', '수비 안정감이 장점', '빠른 발과 주루 센스', '변화구 대처에 물음표']),
  };
  p.contract = null;
  p.asking = { salary: foreignAsk(p), years: 1 };
  return p;
}

export function foreignCount(players, exclude = null) {
  let reg = 0, asia = 0;
  for (const p of players) {
    if (!p.foreign || exclude?.has(p.id)) continue;
    if (p.asia) asia++; else reg++;
  }
  return { reg, asia };
}
