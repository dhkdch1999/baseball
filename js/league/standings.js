// 순위표: 승률 = 승 / (승 + 패), 무승부 제외 (KBO 방식)

export function computeStandings(league) {
  const rows = new Map(league.teams.map((t) => [t.id, {
    team: t, w: 0, l: 0, t: 0, rs: 0, ra: 0, home: [0, 0, 0], away: [0, 0, 0], results: [], h2h: {},
  }]));
  for (const day of league.schedule) {
    for (const g of day.games) {
      if (!g.result) continue;
      const [as, hs] = g.result.score;
      const A = rows.get(g.away), H = rows.get(g.home);
      A.rs += as; A.ra += hs; H.rs += hs; H.ra += as;
      const res = as === hs ? 'T' : as > hs ? 'A' : 'H';
      const add = (row, venue, outcome, opp) => {
        row.results.push(outcome);
        const i = outcome === 'W' ? 0 : outcome === 'L' ? 1 : 2;
        row[venue][i]++;
        row.h2h[opp] ??= [0, 0, 0];
        row.h2h[opp][i]++;
        if (outcome === 'W') row.w++; else if (outcome === 'L') row.l++; else row.t++;
      };
      add(A, 'away', res === 'T' ? 'T' : res === 'A' ? 'W' : 'L', g.home);
      add(H, 'home', res === 'T' ? 'T' : res === 'H' ? 'W' : 'L', g.away);
    }
  }
  const list = [...rows.values()];
  for (const r of list) {
    r.pct = r.w + r.l ? r.w / (r.w + r.l) : 0;
    const last = r.results.slice(-10);
    r.last10 = [last.filter((x) => x === 'W').length, last.filter((x) => x === 'L').length, last.filter((x) => x === 'T').length];
    let k = r.results.length - 1;
    while (k >= 0 && r.results[k] === 'T') k--;
    let n = 0;
    const kind = r.results[k];
    while (k >= 0 && (r.results[k] === kind || r.results[k] === 'T')) { if (r.results[k] === kind) n++; k--; }
    r.streak = kind ? `${n}${kind === 'W' ? '연승' : '연패'}` : '-';
    r.gp = r.w + r.l + r.t;
  }
  list.sort((a, b) => b.pct - a.pct || (b.rs - b.ra) - (a.rs - a.ra) || b.w - a.w);
  const top = list[0];
  for (const r of list) r.gb = ((top.w - r.w) + (r.l - top.l)) / 2;
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}
