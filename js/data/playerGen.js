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
export function scoutPotential(p) {
  return Math.max(20, Math.min(80, Math.round((potentialOverall(p) + (p.scoutNoise || 0)) / 5) * 5));
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
