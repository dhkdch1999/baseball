// 1구 판정: 구종 선택 → 존 여부 → 스윙 → 컨택 → 파울/인플레이
import { LEAGUE, logit, sigmoid, matchup, rateFrom } from './log5.js';
import { z, PITCH_TYPES, veloKmh } from '../data/ratings.js';

/** 투수 피로/멘탈/컨디션을 반영한 z 보정값 */
export function pitcherPenalty(ps, leverage) {
  const r = ps.player.ratings;
  const limit = ps.limit;
  let pen = 0;
  const over = ps.pitches - limit;
  if (over > 0) pen += over * 0.03;                 // 한계 투구 수 이후 급격히 떨어짐
  else pen += Math.max(0, ps.pitches - limit * 0.7) * 0.004;
  // 위기 상황에서 멘탈 영향
  if (leverage > 1) pen -= z(r.mental) * 0.12 * (leverage - 1);
  pen -= (ps.player.condition || 0) * 0.02;
  return pen;
}

/** 투수 레퍼토리 → [{type, grade, breaking}] */
export function repertoire(p) {
  const r = p.ratings;
  const fbType = p.tend?.twoSeam ? 'SI' : 'FF';
  const fbGrade = r.stuff * 0.55 + r.velo * 0.45;
  return [
    { type: fbType, grade: fbGrade, breaking: false },
    ...r.pitches.map((x) => ({ type: x.type, grade: x.grade * 0.7 + r.stuff * 0.3, breaking: true })),
  ];
}

function choosePitch(rng, rep, b, s) {
  const weights = rep.map((pt, i) => {
    let w = i === 0 ? 1.7 : 0.55 + (pt.grade - 50) / 40;
    if (pt.breaking) {
      if (s === 2) w *= 1.45;
      if (b >= 3 || (b === 2 && s === 0)) w *= 0.45;
    }
    return [i, Math.max(0.05, w)];
  });
  return rep[rng.weighted(weights)];
}

/** 좌우 상성: 타자에게 유리하면 + */
export function platoon(batter, pitcher) {
  if (batter.bats === 'S') return 0.08;
  return batter.bats !== pitcher.throws ? 0.12 : -0.12;
}

/**
 * @returns {{type, ko, kmh, inZone, result, swung}}
 *   result: 'ball' | 'calledStrike' | 'swingStrike' | 'foul' | 'inPlay' | 'hbp'
 */
export function throwPitch(rng, { batter, ps, count, leverage = 1, hitAndRun = false }) {
  const [b, s] = count;
  const key = `${b}-${s}`;
  const pit = ps.player;
  const pr = pit.ratings;
  const br = batter.ratings;
  const pen = pitcherPenalty(ps, leverage);
  const plat = platoon(batter, pit);

  const pt = choosePitch(rng, ps.rep, b, s);
  const kmh = pt.breaking
    ? Math.round(veloKmh(pr.velo) - 12 - rng.next() * 14)
    : Math.round(veloKmh(pr.velo) + rng.normal(0, 1.6) - pen * 3);
  const base = { type: pt.type, ko: PITCH_TYPES[pt.type].ko, kmh };

  // 몸에 맞는 공 (제구 나쁠수록)
  if (rng.chance(LEAGUE.hbp * Math.exp(-z(pr.control) * 0.35 + pen * 0.5))) {
    return { ...base, inZone: false, result: 'hbp', swung: false };
  }

  // 1) 존
  const zCtl = z(pr.control) - pen;
  const zoneP = sigmoid(logit(LEAGUE.zoneByCount[key]) + LEAGUE.controlSpread * zCtl + (pt.breaking ? LEAGUE.breakingZonePenalty : 0));
  const inZone = rng.chance(zoneP);

  // 2) 스윙
  const zEye = z(br.eye);
  const zGrade = z(pt.grade) - pen;
  let swingP;
  if (inZone) {
    swingP = sigmoid(logit(LEAGUE.swingZone) + (LEAGUE.swingZoneCount[key] || 0) - LEAGUE.eyeSpreadZone * zEye * 0.3);
  } else {
    // 체이스: 타자 선구안 vs 공의 위력(속임수)
    const chaseBase = sigmoid(logit(LEAGUE.chase) + (LEAGUE.chaseCount[key] || 0));
    swingP = matchup(chaseBase, -zEye, LEAGUE.eyeSpreadChase, -zGrade, 0.22);
  }
  if (hitAndRun) swingP = inZone ? 0.97 : 0.82; // 히트앤런: 무조건 휘두른다
  if (!rng.chance(swingP)) {
    return { ...base, inZone, result: inZone ? 'calledStrike' : 'ball', swung: false };
  }

  // 3) 컨택
  const zBatContact = z(br.contact) * 0.65 + z(br.avoidK) * 0.35 + plat
    + (batter.condition || 0) * 0.02 + (hitAndRun ? 0.15 : 0);
  const contactBase = inZone ? LEAGUE.contactZone : LEAGUE.contactOut;
  const contactP = matchup(contactBase, zBatContact, LEAGUE.contactSpreadBat, zGrade, LEAGUE.contactSpreadPit);
  if (!rng.chance(contactP)) {
    return { ...base, inZone, result: 'swingStrike', swung: true };
  }

  // 4) 파울 / 인플레이
  let foulL = logit(inZone ? LEAGUE.foulZone : LEAGUE.foulOut);
  if (s === 2) foulL += LEAGUE.twoStrikeFoulBonus + z(br.avoidK) * 0.2;
  if (rng.chance(sigmoid(foulL))) {
    return { ...base, inZone, result: 'foul', swung: true };
  }
  return { ...base, inZone, result: 'inPlay', swung: true, grade: pt.grade, pen, plat };
}

/** 투수 한계 투구 수 */
export function pitchLimit(p, asStarter) {
  const st = p.ratings.stamina;
  const base = asStarter ? 55 + st * 0.75 : 14 + st * 0.45;
  // 누적 피로(0~100)가 높으면 한계 투구 수 감소
  return Math.max(8, Math.round(base * (1 - Math.min(80, p.fatigue || 0) / 140)));
}

export { rateFrom };
