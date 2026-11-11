// 리그(10개 구단 + 로스터) 생성과 기본 라인업 구성
import { Rng } from '../core/rng.js';
import { KBO_TEAMS, SHORT_NAME } from './names.js';
import { makeHitter, makePitcher, offenseScore, pitcherScore, resetPlayerIds, initContract, overall } from './playerGen.js';

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
    const teamTier = rng.normal(0, 1.5); // 구단별 전력 차
    const roster = [];
    for (const [pos, tier] of HITTER_SLOTS) roster.push(makeHitter(rng, pos, tier + teamTier, usedNames));
    for (const [role, tier] of PITCHER_SLOTS) roster.push(makePitcher(rng, role, tier + teamTier, usedNames));
    // 2군(퓨처스) 명단: 유망주 + 백업
    const reserve = [];
    for (const pos of ['C', 'SS', '2B', 'CF', '3B', 'RF']) {
      const h = makeHitter(rng, pos, -10 + teamTier, usedNames);
      h.age = Math.min(h.age, rng.int(19, 26));
      reserve.push(h);
    }
    for (const role of ['SP', 'SP', 'RP', 'RP', 'RP', 'RP']) {
      const pp = makePitcher(rng, role, -10 + teamTier, usedNames);
      pp.age = Math.min(pp.age, rng.int(19, 26));
      reserve.push(pp);
    }
    for (const p of [...roster, ...reserve]) {
      if (p.age <= 22) p.service = Math.min(p.service, p.age - 19);
      initContract(p, rng);
    }
    const team = { ...info, short: SHORT_NAME[info.id], roster, reserve, tier: teamTier };
    return team;
  });
  // 전력 평준화: 구단별 주전 평균을 (리그 평균 + 구단 전력차)로 맞춘다
  const top = (arr, n) => arr.map((p) => overall(p)).sort((a, b) => b - a).slice(0, n);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const tH = teams.map((t) => mean(top(t.roster.filter((p) => p.type === 'H'), 9)));
  const tP = teams.map((t) => mean(top(t.roster.filter((p) => p.type === 'P'), 10)));
  const lgH = mean(tH), lgP = mean(tP);
  teams.forEach((t, i) => {
    const dH = Math.round((lgH + t.tier * 0.8 - tH[i]) * 0.85);
    const dP = Math.round((lgP + t.tier * 0.8 - tP[i]) * 0.85);
    for (const p of [...t.roster, ...t.reserve]) {
      const keys = p.type === 'H' ? ['contact', 'power', 'eye'] : ['control', 'stuff'];
      const d = p.type === 'H' ? dH : dP;
      for (const k of keys) {
        p.ratings[k] = Math.max(20, Math.min(80, p.ratings[k] + d));
        if (p.potential[k] != null) p.potential[k] = Math.max(20, Math.min(80, p.potential[k] + d));
      }
    }
    delete t.tier;
    autoDepthChart(t);
  });
  return { seed: String(seed), teams };
}

export function findPlayer(team, id) {
  return team.roster.find((p) => p.id === id);
}

/** AI 기본 뎁스차트: 수비 위치, 타순, 선발 로테이션, 불펜 역할 */
export function autoDepthChart(team) {
  // 1군 인원이 모자라면 2군에서 보충
  team.reserve ??= [];
  for (const [type, min] of [['H', 10], ['P', 9]]) {
    while (team.roster.filter((p) => p.type === type && !p.injury).length < min) {
      const c = team.reserve.filter((p) => p.type === type && !p.injury).sort((a, b) => overall(b) - overall(a))[0];
      if (!c) break;
      team.reserve.splice(team.reserve.indexOf(c), 1);
      team.roster.push(c);
    }
  }
  let hitters = team.roster.filter((p) => p.type === 'H' && !p.injury);
  if (hitters.length < 9) hitters = team.roster.filter((p) => p.type === 'H');
  let pitchers = team.roster.filter((p) => p.type === 'P' && !p.injury);
  if (pitchers.length < 7) pitchers = team.roster.filter((p) => p.type === 'P');

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
    .filter((h) => !used.has(h.id))
    .sort((a, b) => offenseScore(b) - offenseScore(a) - (b.pos === 'C' ? 5 : 0) + (a.pos === 'C' ? 5 : 0))[0]
    || team.roster.find((h) => !used.has(h.id));
  defense.DH = dh.id;

  // 3) 타순
  const starters = Object.entries(defense).map(([pos, id]) => ({ pos, p: hitters.find((h) => h.id === id) }));
  team.lineup = buildBattingOrder(starters).map(({ pos, p }) => ({ id: p.id, pos }));

  // 4) 선발 로테이션 + 불펜
  let sps = pitchers.filter((p) => p.role === 'SP').sort((a, b) => pitcherScore(b) - pitcherScore(a)).slice(0, 5);
  if (sps.length < 5) {
    // 선발 부족: 스태미나 좋은 불펜으로 채움
    const extra = pitchers.filter((p) => !sps.includes(p)).sort((a, b) => b.ratings.stamina - a.ratings.stamina);
    sps = [...sps, ...extra.slice(0, 5 - sps.length)];
  }
  const rps = pitchers.filter((p) => !sps.includes(p)).sort((a, b) => pitcherScore(b) - pitcherScore(a));
  team.rotation = sps.map((p) => p.id);
  team.bullpen = {
    closer: rps[0]?.id ?? null,
    setup: rps.slice(1, 3).map((p) => p.id),
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

// 1군 엔트리 구성 (AI 팀): 1군 26명 = 야수 13 + 투수 13, 나머지는 2군
export const ACTIVE_MAX = 28;
export function autoRoster(team) {
  const all = [...team.roster, ...team.reserve];
  const healthy = (p) => !p.injury || p.injury.days <= 3;
  const score = (p) => overall(p) + (healthy(p) ? 0 : -100);
  const hit = all.filter((p) => p.type === 'H').sort((a, b) => score(b) - score(a));
  const pit = all.filter((p) => p.type === 'P').sort((a, b) => score(b) - score(a));
  const active = new Set();
  // 포수 2명 보장
  hit.filter((p) => p.pos === 'C').slice(0, 2).forEach((p) => active.add(p));
  for (const p of hit) { if ([...active].filter((x) => x.type === 'H').length >= 13) break; active.add(p); }
  // 선발 5명 보장
  pit.filter((p) => p.role === 'SP').slice(0, 5).forEach((p) => active.add(p));
  for (const p of pit) { if ([...active].filter((x) => x.type === 'P').length >= 13) break; active.add(p); }
  team.roster = all.filter((p) => active.has(p));
  team.reserve = all.filter((p) => !active.has(p));
  autoDepthChart(team);
}
