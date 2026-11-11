// 포스트시즌: 와일드카드(4위 1승 어드밴티지) → 준플레이오프(5전3선승) → 플레이오프(5전3선승) → 한국시리즈(7전4선승)

export const ROUND_KO = { WC: '와일드카드 결정전', SPO: '준플레이오프', PO: '플레이오프', KS: '한국시리즈' };

export function buildPostseason(standings) {
  const seeds = standings.slice(0, 5).map((r) => r.team.id);
  return {
    seeds, // [1위 ... 5위]
    round: 'WC',
    series: [{ round: 'WC', high: seeds[3], low: seeds[4], wins: [1, 0], need: 2, games: [] }],
    champion: null,
  };
}

const NEXT = { WC: ['SPO', 2, 3], SPO: ['PO', 1, 3], PO: ['KS', 0, 4] };

export function currentSeries(ps) {
  return ps.series[ps.series.length - 1];
}

/** 다음 경기 {away, home, gameNo} 또는 null(종료) */
export function nextPostseasonGame(ps) {
  if (ps.champion) return null;
  const s = currentSeries(ps);
  const n = s.games.length + 1;
  // 홈: bo5 → 1,2,5차전 상위팀 / bo7 → 1,2,6,7차전 상위팀 / WC → 상위팀 홈
  let highHome;
  if (s.round === 'WC') highHome = true;
  else if (s.need === 3) highHome = [1, 2, 5].includes(n);
  else highHome = [1, 2, 6, 7].includes(n);
  return {
    round: s.round, gameNo: n,
    home: highHome ? s.high : s.low,
    away: highHome ? s.low : s.high,
  };
}

/** 경기 결과 반영. winnerId == null 이면 무승부 (재경기) */
export function recordPostseasonGame(ps, gameInfo, result, winnerId) {
  const s = currentSeries(ps);
  s.games.push({ away: gameInfo.away, home: gameInfo.home, score: result.score, winner: winnerId });
  if (winnerId === s.high) s.wins[0]++;
  else if (winnerId === s.low) s.wins[1]++;
  if (s.wins[0] >= s.need || s.wins[1] >= s.need) {
    s.winner = s.wins[0] >= s.need ? s.high : s.low;
    if (s.round === 'KS') { ps.champion = s.winner; return { seriesOver: true, champion: s.winner }; }
    const [round, seedIdx, need] = NEXT[s.round];
    ps.round = round;
    ps.series.push({ round, high: ps.seeds[seedIdx], low: s.winner, wins: [0, 0], need, games: [] });
    return { seriesOver: true, winner: s.winner };
  }
  return { seriesOver: false };
}
