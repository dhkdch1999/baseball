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
    const teamTier = rng.normal(0, 1); // 구단별 전력 차 (평준화 단계에서 일부만 반영)
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
  // 1차 평준화: 같은 슬롯(주전 포수, 1선발, 마무리 …)끼리 모아서 '지금까지 전력이 가장 약한 팀'에 좋은 선수부터 배분
  {
    const W = (i, isRes) => (isRes ? 0.15 : i < 8 ? 1 : i < 13 ? 0.35 : i < 18 ? 1 : 0.6);
    const tally = teams.map(() => 0);
    const order = teams.map((_, i) => i);
    const nRoster = teams[0].roster.length, nRes = teams[0].reserve.length;
    const slots = [...Array.from({ length: nRoster }, (_, i) => ['roster', i]), ...Array.from({ length: nRes }, (_, i) => ['reserve', i])];
    // 중요한 슬롯부터 배분해야 균형이 잘 맞는다
    slots.sort((a, b) => W(b[1], b[0] === 'reserve') - W(a[1], a[0] === 'reserve'));
    for (const [list, i] of slots) {
      const players = teams.map((t) => t[list][i]).sort((a, b) => overall(b) - overall(a));
      const recv = order.slice().sort((a, b) => tally[a] - tally[b]);
      players.forEach((p, k) => {
        const ti = recv[k];
        teams[ti][list][i] = p;
        tally[ti] += overall(p) * W(i, list === 'reserve');
      });
    }
  }
  equalizeTeams(teams, { tiers: teams.map((t) => t.tier * 0.3) });
  teams.forEach((t) => { delete t.tier; autoDepthChart(t); });
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

// 전력 평준화: 실제 KBO처럼 1위가 5할 후반에 오도록 구단 간 전력 차를 작게 둔다.
// 주전급(실제 라인업·로테이션·불펜)의 능력치 평균을 항목별로 리그 평균에 맞춘다. factor<1이면 그 비율만큼만 당긴다.
export function equalizeTeams(teams, { factor = 1, tiers = null, skip = null, passes = 3 } = {}) {
  // 구단별로 모든 선수에게 같은 값을 더하거나 빼므로 팀 안의 선수 간 차이는 그대로 유지된다.
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const clampR = (v) => Math.max(20, Math.min(80, Math.round(v)));
  // 실제로 뛰는 선수 기준: 선발 라인업 9명, 선발 로테이션 5명, 필승조·중간계투
  const groups = (t) => {
    if (skip?.has(t.id)) t = { ...t, roster: [...t.roster], reserve: [...t.reserve] }; // 사용자 팀 라인업은 건드리지 않음
    autoDepthChart(t);
    const by = (id) => t.roster.find((p) => p.id === id);
    const H = t.lineup.map((l) => ({ p: by(l.id), pos: l.pos }));
    const SP = t.rotation.map(by);
    const bp = t.bullpen;
    const RP = [bp.closer, ...bp.setup, ...bp.middle].map(by).filter(Boolean);
    return { H, SP, RP };
  };
  const H_ITEMS = {
    contact: (x) => x.p.ratings.contact, power: (x) => x.p.ratings.power, eye: (x) => x.p.ratings.eye,
    avoidK: (x) => x.p.ratings.avoidK, speed: (x) => x.p.ratings.speed,
    def: (x) => (x.pos === 'DH' ? null : x.p.ratings.def[x.pos] ?? 30),
  };
  const P_ITEMS = {
    control: (p) => p.ratings.control, stuff: (p) => p.ratings.stuff, velo: (p) => p.ratings.velo,
    grade: (p) => mean(p.ratings.pitches.map((x) => x.grade)), stamina: (p) => p.ratings.stamina,
  };
  const vals = (arr, f) => arr.map(f).filter((v) => v != null);
  const applyH = (p, k, d) => {
    if (k === 'def') { for (const pos of Object.keys(p.ratings.def)) p.ratings.def[pos] = clampR(p.ratings.def[pos] + d); if (p.potential.def != null) p.potential.def = clampR(p.potential.def + d); return; }
    p.ratings[k] = clampR(p.ratings[k] + d);
    if (p.potential[k] != null) p.potential[k] = clampR(p.potential[k] + d);
  };
  const applyP = (p, k, d) => {
    if (k === 'grade') { for (const x of p.ratings.pitches) x.grade = clampR(x.grade + d); return; }
    p.ratings[k] = clampR(p.ratings[k] + d);
    if (p.potential[k] != null) p.potential[k] = clampR(p.potential[k] + d);
  };
  for (let pass = 0; pass < passes; pass++) {
    const G = teams.map(groups);
    for (const [k, f] of Object.entries(H_ITEMS)) {
      const lgM = mean(G.map((g) => mean(vals(g.H, f))));
      teams.forEach((t, i) => {
        if (skip?.has(t.id)) return;
        const d = ((tiers?.[i] ?? 0) + lgM - mean(vals(G[i].H, f))) * factor;
        for (const p of [...t.roster, ...t.reserve]) if (p.type === 'H') applyH(p, k, d);
      });
    }
    for (const grp of ['SP', 'RP']) {
      for (const [k, f] of Object.entries(P_ITEMS)) {
        if (k === 'stamina' && grp === 'RP') continue;
        const lgM = mean(G.map((g) => mean(g[grp].map(f))));
        teams.forEach((t, i) => {
          if (skip?.has(t.id)) return;
          const d = (lgM + (k === 'stamina' ? 0 : tiers?.[i] ?? 0) - mean(G[i][grp].map(f))) * factor;
          for (const p of [...t.roster, ...t.reserve]) if (p.type === 'P' && p.role === grp) applyP(p, k, d);
        });
      }
    }
  }
  teams.forEach((t) => { if (!skip?.has(t.id)) autoDepthChart(t); });
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
