// AI 감독: 선발 결정, 투수 교체, 도루 시도
import { z } from '../data/ratings.js';
import { stealSuccessP } from './baserunning.js';

export function chooseStarter(team, rotationIndex) {
  const id = team.rotation[rotationIndex % team.rotation.length];
  return team.roster.find((p) => p.id === id);
}

function rpById(team, id) {
  return team.roster.find((p) => p.id === id);
}

/** 불펜에서 상황에 맞는 투수 선택. used = 이미 등판한 id Set */
export function pickReliever(team, used, situation) {
  const bp = team.bullpen;
  const avail = (id) => id != null && !used.has(id);
  let order;
  if (situation === 'save') order = [bp.closer, ...bp.setup, ...bp.middle, ...bp.long];
  else if (situation === 'hold8') order = [bp.setup[0], bp.setup[1], ...bp.middle, bp.closer, ...bp.long];
  else if (situation === 'close') order = [bp.setup[1], ...bp.middle, bp.setup[0], ...bp.long, bp.closer];
  else if (situation === 'long') order = [...bp.long, ...bp.middle, ...bp.setup, bp.closer];
  else order = [...bp.middle, ...bp.long, ...bp.setup, bp.closer];
  const id = order.find(avail);
  if (id != null) return { player: rpById(team, id), role: roleOf(team, id) };
  return null;
}

export function roleOf(team, id) {
  const bp = team.bullpen;
  if (bp.closer === id) return '마무리';
  if (bp.setup.includes(id)) return '셋업';
  if (bp.long.includes(id)) return '롱릴리프';
  return '중간계투';
}

/**
 * 타석 시작 전에 투수 교체 여부 판단.
 * @param g game 객체 (읽기 전용으로 사용)
 * @param side 수비 팀 side
 * @param halfStart 이닝 시작 시점인지
 */
export function pitchingDecision(g, side, halfStart) {
  const ps = g.ps[side];
  const team = g.teams[side];
  const used = g.usedPitchers[side];
  const inning = g.inning;
  const lead = g.score[side] - g.score[1 - side];
  const onBase = g.bases.filter(Boolean).length;

  // 이닝 시작 시 필승조 투입
  if (halfStart && inning >= 7) {
    let sit = null;
    if (inning >= 9 && lead >= 1 && lead <= 3) sit = 'save';
    else if (inning === 8 && lead >= 1 && lead <= 3) sit = 'hold8';
    else if (inning === 7 && lead >= 0 && lead <= 2) sit = 'close';
    else if (inning >= 9 && lead === 0) sit = 'save';
    if (sit) {
      const wantRole = sit === 'save' ? '마무리' : '셋업';
      const curRole = ps.starter ? '선발' : roleOf(team, ps.player.id);
      const starterCruising = ps.starter && ps.pitches < ps.limit * 0.85 && ps.runs <= 2 && sit === 'close';
      if (!starterCruising && curRole !== wantRole) {
        const r = pickReliever(team, used, sit);
        if (r) return r;
      }
    }
    // 불펜 투수는 1이닝 소화하면 교체 (롱릴리프 제외)
    if (!ps.starter && ps.outsThisOuting >= 3 && roleOf(team, ps.player.id) !== '롱릴리프') {
      const r = pickReliever(team, used, Math.abs(lead) >= 4 ? 'mid' : 'close');
      if (r) return r;
    }
  }

  // 체력·난조 교체
  const tired = ps.pitches >= ps.limit;
  const nearTired = ps.pitches >= ps.limit * 0.88 && onBase >= 2;
  const shelled = ps.starter
    ? ps.runs >= 7 || (ps.runs >= 5 && ps.pitches >= 60) || (ps.runs >= 4 && inning >= 6 && onBase >= 1)
    : ps.runs >= 3 || (ps.runs >= 2 && onBase >= 2);
  const longRelieverInning = !ps.starter && halfStart && ps.outsThisOuting >= 6;
  if (tired || nearTired || shelled || longRelieverInning) {
    const sit = inning <= 5 ? 'long' : lead >= 1 && lead <= 3 ? (inning >= 9 ? 'save' : 'close') : 'mid';
    const r = pickReliever(team, used, sit);
    if (r) return r;
  }
  return null;
}

/** 공격 팀 AI: 도루 시도할 주자 루 번호 (1 또는 2), 없으면 0 */
export function stealDecision(g, side, rng) {
  const [r1, r2, r3] = g.bases;
  const count = g.count;
  if (g.outs === 2 && r2) return 0;
  const diff = g.score[side] - g.score[1 - side];
  if (diff <= -4 || diff >= 6) return 0;
  const catcher = g.defense[1 - side].C;
  const pitcher = g.ps[1 - side].player;
  if (r1 && !r2) {
    const zs = z(r1.player.ratings.speed);
    if (zs < 0.4) return 0;
    const p = stealSuccessP(r1, catcher, pitcher, 2);
    if (p < 0.7) return 0;
    const rate = 0.06 * (zs + 0.2) * (count[1] === 2 && count[0] === 3 ? 4 : 1);
    return rng.chance(rate) ? 1 : 0;
  }
  if (r2 && !r3 && !r1 && g.outs < 2) {
    const zs = z(r2.player.ratings.speed);
    if (zs < 1.2) return 0;
    const p = stealSuccessP(r2, catcher, pitcher, 3);
    if (p < 0.78) return 0;
    return rng.chance(0.012 * zs) ? 2 : 0;
  }
  return 0;
}
