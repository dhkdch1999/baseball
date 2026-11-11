// 경기 상태 보조: 규칙 상수, 수비 배치, 투수 상태, UI용 스냅샷
import { repertoire, pitchLimit } from './pitch.js';

export const RULES = {
  innings: 9,
  maxInnings: 11, // KBO 정규시즌: 11회까지, 이후 무승부
  dh: true,
};

/** 투수 등판 상태 */
export function newPitcherState(player, starter, inning) {
  return {
    player,
    starter,
    rep: repertoire(player),
    limit: pitchLimit(player, starter),
    pitches: 0,
    outsThisOuting: 0,
    runs: 0,
    enteredInning: inning,
    enteredLead: 0,
  };
}

/** 라인업 [{id,pos}] → 수비 배치 {pos: player} */
export function buildDefense(team, lineup, pitcher) {
  const d = { P: pitcher };
  for (const { player, pos } of lineup) if (pos !== 'DH') d[pos] = player;
  return d;
}

export function snapshot(g) {
  return {
    inning: g.inning,
    half: g.half,
    outs: g.outs,
    count: g.count.slice(),
    bases: g.bases.map((r) => (r ? r.player.name : null)),
    score: g.score.slice(),
  };
}
