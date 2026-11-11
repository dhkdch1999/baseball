// AI 감독: 선발 결정, 투수 교체, 도루, 번트, 고의사구, 수비 시프트
import { z } from '../data/ratings.js';
import { stealSuccessP } from './baserunning.js';
import { offenseScore } from '../data/playerGen.js';

const healthy = (p) => p && !p.injury;

/** 로테이션 순번부터 충분히 쉰 선발을 찾는다. 반환 { player, index } */
export function chooseStarter(team, rotationIndex = 0) {
  const n = team.rotation.length;
  for (let k = 0; k < n; k++) {
    const idx = (rotationIndex + k) % n;
    const p = team.roster.find((x) => x.id === team.rotation[idx]);
    if (healthy(p) && (p.fatigue || 0) <= 30) return { player: p, index: idx };
  }
  // 모두 지쳤으면 가장 덜 지친 투수 (불펜데이)
  const pool = team.roster.filter((p) => p.type === 'P' && healthy(p)).sort((a, b) => (a.fatigue || 0) - (b.fatigue || 0));
  return { player: pool[0], index: rotationIndex % Math.max(1, n) };
}

const byId = (team, id) => team.roster.find((p) => p.id === id);

export function roleOf(team, id) {
  const bp = team.bullpen;
  if (bp.closer === id) return '마무리';
  if (bp.setup.includes(id)) return '셋업';
  if (bp.long.includes(id)) return '롱릴리프';
  if (team.rotation.includes(id)) return '선발';
  return '중간계투';
}

/** 불펜에서 상황에 맞는 투수 선택. used = 이미 등판한 id Set */
export function pickReliever(team, used, situation) {
  const bp = team.bullpen;
  let order;
  if (situation === 'save') order = [bp.closer, ...bp.setup, ...bp.middle, ...bp.long];
  else if (situation === 'hold8') order = [bp.setup[0], bp.setup[1], ...bp.middle, bp.closer, ...bp.long];
  else if (situation === 'close') order = [bp.setup[1], ...bp.middle, bp.setup[0], ...bp.long, bp.closer];
  else if (situation === 'long') order = [...bp.long, ...bp.middle, ...bp.setup, bp.closer];
  else order = [...bp.middle, ...bp.long, ...bp.setup, bp.closer];
  // 등록된 다른 투수도 후보 (보직 없는 투수)
  const others = team.roster.filter((p) => p.type === 'P' && !team.rotation.includes(p.id) && !order.includes(p.id)).map((p) => p.id);
  order = [...order, ...others].filter((id, i, a) => id != null && a.indexOf(id) === i);
  const ok = (id, maxFat) => { const p = byId(team, id); return p && !used.has(id) && healthy(p) && (p.fatigue || 0) <= maxFat; };
  let id = order.find((x) => ok(x, 35)) ?? order.find((x) => ok(x, 70));
  if (id == null) {
    // 최후: 선발 로테이션 중 덜 지친 투수
    id = team.roster.filter((p) => p.type === 'P' && !used.has(p.id) && healthy(p)).sort((a, b) => (a.fatigue || 0) - (b.fatigue || 0))[0]?.id;
  }
  if (id == null) return null;
  return { player: byId(team, id), role: roleOf(team, id) };
}

/** 타석 시작 전에 투수 교체 여부 판단 */
export function pitchingDecision(g, side, halfStart) {
  const ps = g.ps[side];
  const team = g.teams[side];
  const used = g.usedPitchers[side];
  const inning = g.inning;
  const lead = g.score[side] - g.score[1 - side];
  const onBase = g.bases.filter(Boolean).length;

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
    if (!ps.starter && ps.outsThisOuting >= 3 && roleOf(team, ps.player.id) !== '롱릴리프') {
      const r = pickReliever(team, used, Math.abs(lead) >= 4 ? 'mid' : 'close');
      if (r) return r;
    }
  }

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

/** 공격 AI: 도루할 주자 루 번호 (1 또는 2), 없으면 0 */
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

/** 공격 AI: 희생번트 지시 여부 (타석 시작 시) */
export function buntDecision(g, side, batter) {
  const [r1, r2, r3] = g.bases;
  if (g.outs > 0 || r3 || (!r1 && !r2)) return false;
  const diff = g.score[side] - g.score[1 - side];
  const late = g.inning >= 7 && diff >= -1 && diff <= 1;
  const weak = offenseScore(batter) < 46;
  return late && (weak || g.inning >= 9);
}

/** 수비 AI: 고의사구 여부 */
export function ibbDecision(g, side, batter, nextBatter) {
  const [r1, r2, r3] = g.bases;
  if (r1 || (!r2 && !r3) || g.inning < 7) return false;
  const diff = g.score[side] - g.score[1 - side];
  if (diff < -1 || diff > 1) return false;
  return offenseScore(batter) - offenseScore(nextBatter) > 7;
}

/** 수비 AI: 시프트 결정 */
export function shiftDecision(g, side, batter) {
  const r3 = g.bases[2];
  const diff = g.score[side] - g.score[1 - side];
  if (r3 && g.outs < 2 && g.inning >= 7 && diff >= -1 && diff <= 1) return 'in';
  if ((batter.tend?.pull || 0) > 1.2 && !g.bases[0]) return 'pull';
  return 'normal';
}
