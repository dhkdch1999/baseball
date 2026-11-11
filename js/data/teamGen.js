// 리그(10개 구단 + 로스터) 생성과 기본 라인업 구성
import { Rng } from '../core/rng.js';
import { KBO_TEAMS, SHORT_NAME } from './names.js';
import { makeHitter, makePitcher, offenseScore, pitcherScore, resetPlayerIds } from './playerGen.js';

// 1군 엔트리 26명: 야수 13 + 투수 13
const HITTER_SLOTS = [
  ['C', 0], ['1B', 0], ['2B', 0], ['3B', 0], ['SS', 0], ['LF', 0], ['CF', 0], ['RF', 0],
  ['C', -8], ['SS', -6], ['2B', -6], ['CF', -6], ['1B', -3], // 백업 + 지명타자 후보
];
const PITCHER_SLOTS = [
  ['SP', 3], ['SP', 1], ['SP', 0], ['SP', -2], ['SP', -4],
  ['RP', 2], ['RP', 1], ['RP', 0], ['RP', -1], ['RP', -2], ['RP', -3], ['RP', -4], ['RP', -5],
];

export function generateLeague(seed = 'default') {
  const rng = new Rng('league', seed);
  resetPlayerIds(1);
  const usedNames = new Set();
  const teams = KBO_TEAMS.map((info) => {
    const teamTier = rng.normal(0, 2.5); // 구단별 전력 차
    const roster = [];
    for (const [pos, tier] of HITTER_SLOTS) roster.push(makeHitter(rng, pos, tier + teamTier, usedNames));
    for (const [role, tier] of PITCHER_SLOTS) roster.push(makePitcher(rng, role, tier + teamTier, usedNames));
    const team = { ...info, short: SHORT_NAME[info.id], roster };
    autoDepthChart(team);
    return team;
  });
  return { seed: String(seed), teams };
}

export function findPlayer(team, id) {
  return team.roster.find((p) => p.id === id);
}

/** AI 기본 뎁스차트: 수비 위치, 타순, 선발 로테이션, 불펜 역할 */
export function autoDepthChart(team) {
  const hitters = team.roster.filter((p) => p.type === 'H');
  const pitchers = team.roster.filter((p) => p.type === 'P');

  // 1) 포지션별 주전: 수비 + 공격 가치로 선택
  const fieldOrder = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'];
  const used = new Set();
  const defense = {};
  for (const pos of fieldOrder) {
    let best = null, bestScore = -1e9;
    for (const h of hitters) {
      if (used.has(h.id)) continue;
      const d = h.ratings.def[pos];
      if (d === undefined) continue;
      const s = offenseScore(h) * 0.6 + d * 0.4 + (h.pos === pos ? 3 : 0);
      if (s > bestScore) { bestScore = s; best = h; }
    }
    if (!best) best = hitters.find((h) => !used.has(h.id));
    used.add(best.id);
    defense[pos] = best.id;
  }
  // 2) 지명타자: 남은 타자 중 공격력 최고 (포수 백업 제외)
  const dh = hitters
    .filter((h) => !used.has(h.id) && h.pos !== 'C')
    .sort((a, b) => offenseScore(b) - offenseScore(a))[0];
  defense.DH = dh.id;

  // 3) 타순
  const starters = Object.entries(defense).map(([pos, id]) => ({ pos, p: hitters.find((h) => h.id === id) }));
  team.lineup = buildBattingOrder(starters).map(({ pos, p }) => ({ id: p.id, pos }));

  // 4) 선발 로테이션 + 불펜
  const sps = pitchers.filter((p) => p.role === 'SP').sort((a, b) => pitcherScore(b) - pitcherScore(a));
  const rps = pitchers.filter((p) => p.role === 'RP').sort((a, b) => pitcherScore(b) - pitcherScore(a));
  team.rotation = sps.map((p) => p.id);
  team.bullpen = {
    closer: rps[0].id,
    setup: [rps[1].id, rps[2].id],
    middle: rps.slice(3, 6).map((p) => p.id),
    long: rps.slice(6).map((p) => p.id),
  };
  team.rotationIndex = team.rotationIndex ?? 0;
}

function buildBattingOrder(starters) {
  const obp = (p) => p.ratings.contact * 0.5 + p.ratings.eye * 0.5;
  const left = starters.slice();
  const take = (scoreFn) => {
    left.sort((a, b) => scoreFn(b.p) - scoreFn(a.p));
    return left.shift();
  };
  const order = new Array(9);
  order[2] = take(offenseScore);                                   // 3번: 최고 타자
  order[3] = take((p) => p.ratings.power * 0.7 + offenseScore(p) * 0.3); // 4번: 거포
  order[0] = take((p) => obp(p) * 0.7 + p.ratings.speed * 0.3);    // 1번: 출루 + 발
  order[1] = take((p) => obp(p) * 0.6 + p.ratings.contact * 0.4);  // 2번
  order[4] = take(offenseScore);
  order[5] = take(offenseScore);
  order[6] = take(offenseScore);
  order[7] = take(offenseScore);
  order[8] = take((p) => p.ratings.speed);                         // 9번: 남은 선수
  return order;
}
