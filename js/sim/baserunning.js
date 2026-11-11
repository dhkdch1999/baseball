// 주자 진루 처리. bases = [1루, 2루, 3루] (runner 객체 또는 null)
// runner = { player, resp(책임투수 id), earned(자책 여부) }
// 반환: { bases, moves:[{runner, from, to|'out'}], runs:[runner], outs }
//   from/to: 0=타자, 1~3=루, 4=홈
import { z } from '../data/ratings.js';
import { sigmoid, logit } from './log5.js';

const spd = (r) => z(r.player.ratings.speed);
const armOf = (defense, pos) => z(defense[pos]?.ratings.arm ?? 50);

function result(bases) {
  return { bases, moves: [], runs: [], outs: 0 };
}

function move(res, runner, from, to) {
  res.moves.push({ runner, from, to });
  if (to === 4) res.runs.push(runner);
}

/** 볼넷/몸에 맞는 공: 밀어내기만 진루 */
export function walk(bases, batterRunner) {
  const b = bases.slice();
  const res = result(b);
  if (b[0]) {
    if (b[1]) {
      if (b[2]) move(res, b[2], 3, 4);
      move(res, b[1], 2, 3);
      b[2] = b[1];
    }
    move(res, b[0], 1, 2);
    b[1] = b[0];
  }
  move(res, batterRunner, 0, 1);
  b[0] = batterRunner;
  return res;
}

/** 안타 진루 */
export function hit(rng, bases, batterRunner, bb, outs, defense, opts = {}) {
  const hr = opts.hitAndRun ? 1.2 : 0;
  const [r1, r2, r3] = bases;
  const nb = [null, null, null];
  const res = result(nb);
  const twoOut = outs === 2 ? 1 : 0;
  const ofArm = armOf(defense, ['LF', 'CF', 'RF'].includes(bb.fielder) ? bb.fielder : 'CF');
  const kind = bb.outcome;

  if (kind === 'HR') {
    for (const [r, f] of [[r3, 3], [r2, 2], [r1, 1]]) if (r) move(res, r, f, 4);
    move(res, batterRunner, 0, 4);
    return res;
  }
  if (kind === '3B') {
    for (const [r, f] of [[r3, 3], [r2, 2], [r1, 1]]) if (r) move(res, r, f, 4);
    move(res, batterRunner, 0, 3);
    nb[2] = batterRunner;
    return res;
  }
  if (kind === '2B') {
    if (r3) move(res, r3, 3, 4);
    if (r2) move(res, r2, 2, 4);
    if (r1) {
      const p = sigmoid(logit(0.42) + 0.45 * spd(r1) + 0.9 * twoOut - 0.3 * ofArm + hr);
      if (rng.chance(p)) {
        if (rng.chance(0.05)) { move(res, r1, 1, 'out'); res.outs++; }
        else move(res, r1, 1, 4);
      } else { move(res, r1, 1, 3); nb[2] = r1; }
    }
    move(res, batterRunner, 0, 2);
    nb[1] = batterRunner;
    return res;
  }
  // 단타
  if (r3) move(res, r3, 3, 4);
  if (r2) {
    const p = bb.infieldHit ? 0.03 : sigmoid(logit(0.58) + 0.45 * spd(r2) + 1.1 * twoOut - 0.35 * ofArm + (bb.fielder === 'CF' ? 0.2 : 0));
    if (rng.chance(p)) {
      if (rng.chance(0.06)) { move(res, r2, 2, 'out'); res.outs++; }
      else move(res, r2, 2, 4);
    } else { move(res, r2, 2, 3); nb[2] = r2; }
  }
  if (r1) {
    const p = bb.infieldHit ? 0 : sigmoid(logit(bb.fielder === 'RF' ? 0.38 : 0.2) + 0.45 * spd(r1) + 0.4 * twoOut - 0.3 * ofArm + hr);
    if (!nb[2] && rng.chance(p)) { move(res, r1, 1, 3); nb[2] = r1; }
    else { move(res, r1, 1, 2); nb[1] = r1; }
  }
  move(res, batterRunner, 0, 1);
  nb[0] = batterRunner;
  return res;
}

/** 실책 출루: 타자 1루, 주자는 1루씩 + α */
export function error(rng, bases, batterRunner) {
  const [r1, r2, r3] = bases;
  const nb = [null, null, null];
  const res = result(nb);
  if (r3) move(res, r3, 3, 4);
  if (r2) { if (rng.chance(0.5)) move(res, r2, 2, 4); else { move(res, r2, 2, 3); nb[2] = r2; } }
  if (r1) { if (!nb[2] && rng.chance(0.3)) { move(res, r1, 1, 3); nb[2] = r1; } else { move(res, r1, 1, 2); nb[1] = r1; } }
  move(res, batterRunner, 0, 1);
  nb[0] = batterRunner;
  return res;
}

/** 땅볼 아웃: 병살 / 야수선택 / 진루타 */
export function groundOut(rng, bases, batterRunner, bb, outs, defense, opts = {}) {
  const [r1, r2, r3] = bases;
  const nb = bases.slice();
  const res = result(nb);
  const zBat = z(batterRunner.player.ratings.speed);
  const fielder = bb.fielder;
  const zDef = z(defense[fielder]?.ratings.def?.[fielder] ?? 45);

  if (r1 && outs < 2 && !opts.hitAndRun) {
    // 병살 시도
    const dpP = sigmoid(logit(0.40) - 0.45 * zBat + 0.25 * zDef + (bb.q < -0.4 ? -0.3 : 0.2) + (fielder === 'P' ? 0.4 : 0));
    if (rng.chance(dpP)) {
      res.dp = true;
      move(res, r1, 1, 'out');
      move(res, batterRunner, 0, 'out');
      res.outs = 2;
      nb[0] = null;
      if (outs === 0) { // 3아웃이 아니면 다른 주자 진루
        if (r3) { move(res, r3, 3, 4); nb[2] = null; }
        if (r2) { move(res, r2, 2, 3); nb[2] = r2; nb[1] = null; }
      }
      return res;
    }
    if (rng.chance(0.45)) {
      // 선행주자 포스아웃, 타자 1루 (야수선택)
      res.fc = true;
      move(res, r1, 1, 'out');
      res.outs = 1;
      if (r3 && r2 && outs < 2) { move(res, r3, 3, 4); nb[2] = null; }
      if (r2) { move(res, r2, 2, 3); nb[2] = r2; nb[1] = null; }
      else if (r3 && rng.chance(0.45)) { move(res, r3, 3, 4); nb[2] = null; }
      move(res, batterRunner, 0, 1);
      nb[0] = batterRunner;
      return res;
    }
  }
  // 타자 아웃, 주자 진루
  move(res, batterRunner, 0, 'out');
  res.outs = 1;
  if (outs + 1 >= 3) return res;
  const rightSide = fielder === '2B' || fielder === '1B';
  if (r3) {
    const forced = r1 && r2;
    const base3 = opts.infieldIn ? 0.15 : 0.5; // 전진수비면 3루주자 묶임
    if (forced || rng.chance(sigmoid(logit(base3) + 0.3 * spd(r3) + (rightSide ? 0.3 : -0.2)))) { move(res, r3, 3, 4); nb[2] = null; }
  }
  if (r2) {
    const forced = !!r1;
    if (!nb[2] && (forced || opts.hitAndRun || rng.chance(rightSide ? 0.75 : 0.3))) { move(res, r2, 2, 3); nb[2] = r2; nb[1] = null; }
  }
  if (r1) { move(res, r1, 1, 2); nb[1] = r1; nb[0] = null; }
  return res;
}

/** 뜬공/라인드라이브 아웃: 희생플라이, 태그업 */
export function flyOut(rng, bases, batterRunner, bb, outs, defense, opts = {}) {
  const [r1, r2, r3] = bases;
  const nb = bases.slice();
  const res = result(nb);
  move(res, batterRunner, 0, 'out');
  res.outs = 1;
  if (outs + 1 >= 3) return res;
  // 히트앤런 중 직선타/내야 뜬공 → 1루주자 귀루 실패
  if (opts.hitAndRun && r1 && (bb.ballType === 'LD' || bb.ballType === 'PU') && rng.chance(bb.ballType === 'LD' ? 0.5 : 0.25)) {
    move(res, r1, 1, 'out');
    res.outs++;
    res.dp = true;
    nb[0] = null;
    return res;
  }
  const outfield = ['LF', 'CF', 'RF'].includes(bb.fielder);
  if (!outfield || bb.ballType === 'LD') return res;
  const arm = armOf(defense, bb.fielder);
  const depthAdj = bb.depth === 'deep' ? 1.2 : bb.depth === 'shallow' ? -1.6 : 0;
  if (r3 && rng.chance(sigmoid(logit(0.72) + depthAdj + 0.35 * spd(r3) - 0.3 * arm))) {
    if (rng.chance(0.04)) { move(res, r3, 3, 'out'); res.outs++; nb[2] = null; return res; }
    move(res, r3, 3, 4);
    nb[2] = null;
    res.sf = true;
  }
  if (r2 && !nb[2] && rng.chance(sigmoid(logit(bb.fielder === 'RF' ? 0.35 : 0.15) + depthAdj + 0.3 * spd(r2)))) {
    move(res, r2, 2, 3);
    nb[2] = r2;
    nb[1] = null;
  }
  return res;
}

/** 폭투/포일: 모든 주자 한 베이스 */
export function wildPitch(bases) {
  const nb = [null, null, null];
  const res = result(nb);
  const [r1, r2, r3] = bases;
  if (r3) move(res, r3, 3, 4);
  if (r2) { move(res, r2, 2, 3); nb[2] = r2; }
  if (r1) { move(res, r1, 1, 2); nb[1] = r1; }
  return res;
}

/** 도루 성공 확률 */
export function stealSuccessP(runner, catcher, pitcher, toBase) {
  const zs = spd(runner);
  const zArm = z(catcher?.ratings.arm ?? 50);
  const hold = pitcher.throws === 'L' ? 0.25 : 0;
  return sigmoid(logit(toBase === 3 ? 0.68 : 0.74) + 0.55 * zs - 0.35 * zArm - hold);
}

export function steal(rng, bases, fromBase, catcher, pitcher) {
  const nb = bases.slice();
  const res = result(nb);
  const runner = nb[fromBase - 1];
  const to = fromBase + 1;
  const ok = rng.chance(stealSuccessP(runner, catcher, pitcher, to));
  nb[fromBase - 1] = null;
  if (ok) {
    nb[to - 1] = runner;
    move(res, runner, fromBase, to);
  } else {
    move(res, runner, fromBase, 'out');
    res.outs = 1;
  }
  res.success = ok;
  return res;
}

/**
 * 번트. batter: 타자 선수, 반환 res.kind:
 *   'SH'(희생번트 성공) | 'BUNT_HIT'(번트 안타) | 'BUNT_FC'(선행주자 아웃) | 'BUNT_PO'(번트 뜬공) | 'BUNT_DP'
 */
export function bunt(rng, bases, batterRunner, outs, defense) {
  const [r1, r2, r3] = bases;
  const b = batterRunner.player.ratings;
  const skill = z(b.contact) * 0.6 + z(b.avoidK) * 0.4;
  const zs = z(b.speed);
  const nb = [null, null, null];
  const res = result(nb);
  if (!r1 && !r2 && !r3) {
    // 주자 없을 때: 기습번트 (안타 노림)
    const k = rng.weighted([['BUNT_HIT', Math.max(0.05, 0.24 + 0.08 * zs)], ['BUNT_OUT', 0.68], ['BUNT_PO', 0.08]]);
    res.kind = k;
    res.fielder = rng.weighted([['P', 40], ['3B', 45], ['1B', 15]]);
    if (k === 'BUNT_HIT') { move(res, batterRunner, 0, 1); nb[0] = batterRunner; }
    else { move(res, batterRunner, 0, 'out'); res.outs = 1; }
    return res;
  }
  const roll = rng.weighted([
    ['SH', 0.74 + 0.05 * skill],
    ['BUNT_HIT', Math.max(0.01, 0.05 + 0.03 * zs)],
    ['BUNT_FC', Math.max(0.03, 0.12 - 0.03 * skill)],
    ['BUNT_PO', Math.max(0.02, 0.07 - 0.03 * skill)],
    ['BUNT_DP', r1 && outs === 0 ? 0.02 : 0],
  ]);
  res.kind = roll;
  const fielder = rng.weighted([['P', 40], ['3B', 35], ['1B', 25]]);
  res.fielder = fielder;
  const advanceAll = () => {
    if (r3) move(res, r3, 3, 4);
    if (r2) { move(res, r2, 2, 3); nb[2] = r2; }
    if (r1) { move(res, r1, 1, 2); nb[1] = r1; }
  };
  if (roll === 'SH') {
    move(res, batterRunner, 0, 'out'); res.outs = 1;
    if (outs + 1 < 3) advanceAll();
    else { nb[0] = r1; nb[1] = r2; nb[2] = r3; }
  } else if (roll === 'BUNT_HIT') {
    advanceAll();
    move(res, batterRunner, 0, 1); nb[0] = batterRunner;
  } else if (roll === 'BUNT_PO') {
    move(res, batterRunner, 0, 'out'); res.outs = 1;
    nb[0] = r1; nb[1] = r2; nb[2] = r3;
  } else {
    // 선행주자 아웃 (FC) 또는 병살
    const lead = r3 && r2 && r1 ? 3 : r2 && r1 ? 2 : r1 ? 1 : r2 ? 2 : 3;
    for (const [r, f] of [[r3, 3], [r2, 2], [r1, 1]]) {
      if (!r) continue;
      if (f === lead) { move(res, r, f, 'out'); res.outs++; continue; }
      if (f + 1 <= 3) { move(res, r, f, f + 1); nb[f] = r; } else move(res, r, f, 4);
    }
    if (roll === 'BUNT_DP') { move(res, batterRunner, 0, 'out'); res.outs++; }
    else { move(res, batterRunner, 0, 1); nb[0] = batterRunner; }
  }
  return res;
}
