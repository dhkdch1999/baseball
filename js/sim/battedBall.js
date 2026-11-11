// 인플레이 타구 판정: 타구 질 → 종류 → 방향 → 담당 수비수 → 결과
import { BATTED, logit, sigmoid } from './log5.js';
import { z } from '../data/ratings.js';

export const DIRS = ['L', 'LC', 'C', 'RC', 'R']; // 좌측 선상 → 우측 선상

const GB_FIELDER = { L: '3B', LC: 'SS', C: null, RC: '2B', R: '1B' };
const OF_FIELDER = { L: 'LF', LC: null, C: 'CF', RC: null, R: 'RF' };
const IF_FOR_DIR = { L: '3B', LC: 'SS', C: '2B', RC: '2B', R: '1B' };

function pickDir(rng, batter, ballType) {
  // 당겨치기 방향: 우타 = 좌측, 좌타 = 우측. 스위치는 상대 투수 반대손이라 가정해 랜덤.
  const pullLeft = batter.bats === 'R' || (batter.bats === 'S' && rng.chance(0.3));
  const pull = (batter.tend?.pull || 0) * 0.08 + (ballType === 'GB' ? 0.1 : 0.03);
  const w = [0.17, 0.22, 0.22, 0.22, 0.17];
  // pull을 당기는 쪽 가중치로 이동
  const shift = [pull, pull * 0.5, 0, -pull * 0.5, -pull];
  const weights = w.map((x, i) => Math.max(0.02, x + (pullLeft ? shift[i] : -shift[i])));
  return DIRS[rng.weighted(weights.map((x, i) => [i, x]))];
}

function pickType(rng, batter, pitcher, q, inZone) {
  const gbShift = (batter.tend?.gb || 0) * 0.25 + (pitcher.tend?.gb || 0) * 0.22 - q * 0.15 + (inZone ? 0 : 0.12);
  const t = BATTED.type;
  return rng.weighted([
    ['GB', t.GB * Math.exp(gbShift)],
    ['LD', t.LD * Math.exp(q * 0.12)],
    ['FB', t.FB * Math.exp(-gbShift * 0.8)],
    ['PU', t.PU * Math.exp(-gbShift * 0.5 - q * 0.35)],
  ]);
}

/**
 * @param defense {pos: player}  (C,1B,2B,3B,SS,LF,CF,RF + P)
 * @returns {ballType, dir, fielder, outcome, q, depth}
 *   outcome: '1B'|'2B'|'3B'|'HR'|'OUT'|'E'
 */
export function resolveBattedBall(rng, { batter, pitcher, pitch, defense, shift = 'normal', hitAndRun = false }) {
  const br = batter.ratings;
  const zStuff = z(pitch.grade) - (pitch.pen || 0);
  const inZone = pitch.inZone;
  // 타구 질
  const q = rng.normal(0, 1) * 0.85
    + 0.25 * z(br.contact) + 0.2 * z(br.power)
    - 0.25 * zStuff + (pitch.plat || 0) * 1.2 - (inZone ? 0 : 0.35)
    + (batter.condition || 0) * 0.02 - (hitAndRun ? 0.25 : 0);

  const ballType = pickType(rng, batter, pitcher, q, inZone);
  const dir = pickDir(rng, batter, ballType);

  // 홈런
  if (ballType === 'FB' || ballType === 'LD') {
    const base = ballType === 'FB' ? BATTED.hrPerFB : BATTED.hrPerLD;
    const hrL = logit(base) + BATTED.hrQualitySpread * (0.6 * z(br.power) + 0.45 * q - 0.15 * zStuff);
    if (rng.chance(sigmoid(hrL))) {
      return { ballType, dir, fielder: OF_FIELDER[dir] || 'CF', outcome: 'HR', q, depth: 'out' };
    }
  }

  // 담당 수비수
  let fielder;
  if (ballType === 'GB') {
    fielder = GB_FIELDER[dir] || rng.weighted([['SS', 40], ['2B', 40], ['P', 20]]);
  } else if (ballType === 'PU') {
    fielder = rng.chance(0.15) ? 'C' : IF_FOR_DIR[dir];
  } else if (ballType === 'LD' && rng.chance(0.15)) {
    fielder = IF_FOR_DIR[dir];
  } else {
    fielder = OF_FIELDER[dir] || (dir === 'LC' ? rng.weighted([['LF', 45], ['CF', 55]]) : rng.weighted([['RF', 45], ['CF', 55]]));
  }
  const fp = defense[fielder];
  const zDef = fp ? z(fielder === 'P' ? 45 : (fp.ratings.def?.[fielder] ?? 35)) : 0;
  const isInfieldLD = ballType === 'LD' && !['LF', 'CF', 'RF'].includes(fielder);

  let hitL = logit(isInfieldLD ? 0.25 : BATTED.hit[ballType]) + BATTED.qualityHitSpread[ballType] * q - BATTED.defenseSpread * zDef * 2;
  if (ballType === 'GB') {
    hitL += 0.22 * z(br.speed); // 내야안타
    if (shift === 'in') hitL += 0.45; // 전진수비: 땅볼이 빠져나가기 쉬움
    if (shift === 'pull') {
      // 당겨치는 쪽으로 수비 이동: 당긴 땅볼은 잡히고, 밀어친 땅볼은 빈 곳으로
      const pullSide = batter.bats === 'L' ? ['R', 'RC'] : ['L', 'LC'];
      const pushSide = batter.bats === 'L' ? ['L', 'LC'] : ['R', 'RC'];
      if (pullSide.includes(dir)) hitL -= 0.45;
      else if (pushSide.includes(dir)) hitL += 0.35;
    }
  }
  const depth = q > 0.7 ? 'deep' : q < -0.5 ? 'shallow' : 'medium';

  if (!rng.chance(sigmoid(hitL))) {
    // 아웃 처리 중 실책
    if (ballType !== 'PU' && rng.chance(BATTED.errorRate * Math.exp(-0.45 * zDef) * (ballType === 'GB' ? 1.6 : 0.6))) {
      return { ballType, dir, fielder, outcome: 'E', q, depth };
    }
    return { ballType, dir, fielder, outcome: 'OUT', q, depth };
  }

  // 안타 종류
  const zSpd = z(br.speed);
  let outcome = '1B';
  if (ballType === 'GB') {
    if ((dir === 'L' || dir === 'R') && rng.chance(0.14 + 0.03 * zSpd)) outcome = '2B';
  } else if (ballType === 'LD' && !isInfieldLD) {
    const gap = dir === 'LC' || dir === 'RC';
    if (rng.chance(sigmoid(logit(gap ? 0.28 : 0.17) + 0.5 * q + 0.15 * zSpd))) {
      outcome = rng.chance(0.06 + 0.04 * zSpd + (gap ? 0.03 : 0)) ? '3B' : '2B';
    }
  } else if (ballType === 'FB') {
    if (rng.chance(sigmoid(logit(0.45) + 0.4 * q))) {
      outcome = rng.chance(0.1 + 0.05 * zSpd) ? '3B' : '2B';
    }
  }
  // 안타가 된 타구는 외야 방향으로 표기 (땅볼 안타는 내야를 빠져나감)
  if (ballType === 'GB' || ballType === 'PU' || isInfieldLD) {
    const infieldHit = ballType === 'GB' && rng.chance(0.18 + 0.06 * zSpd) && outcome === '1B';
    return { ballType, dir, fielder: infieldHit ? fielder : (OF_FIELDER[dir] || 'CF'), outcome, q, depth, infieldHit };
  }
  return { ballType, dir, fielder, outcome, q, depth };
}
