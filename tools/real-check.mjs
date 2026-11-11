#!/usr/bin/env node
// 실제 선수단 점검: 시즌을 N번 돌려 리그 평균과 선수별 기록이 실제 2026 기록과 얼마나 맞는지 확인
//   node tools/real-check.mjs --seasons 3
import { newCareer, allPlayers } from '../js/league/season.js';
import { advanceUntil } from '../js/league/career.js';
import { computeStandings } from '../js/league/standings.js';
import { sumLines, BAT_KEYS, avg, obp, slg, era } from '../js/league/stats.js';
import { overall } from '../js/data/playerGen.js';

const a = process.argv.slice(2);
const N = Number(a[a.indexOf('--seasons') + 1] || 2);
const agg = new Map(); // name|team → {real, sims:[]}
const tbl = new Map();
let lgLines = [];
for (let s = 0; s < N; s++) {
  const lg = newCareer({ seed: `real-check-${s}`, myTeamId: 'LG', roster: 'real' });
  lg.teams.find((t) => t.id === 'LG').autoLineup = true;
  if (s === 0) {
    console.log('팀별 주전 평균 종합:', lg.teams.map((t) => `${t.short} ${Math.round(t.lineup.map((l) => overall(t.roster.find((p) => p.id === l.id))).reduce((x, y) => x + y, 0) / 9)}`).join(' '));
  }
  advanceUntil(lg, 'season');
  const key = String(lg.season);
  const st = computeStandings(lg);
  for (const r of st) { const o = tbl.get(r.team.short) || { w: 0, l: 0, t: 0 }; o.w += r.w; o.l += r.l; o.t += r.t; tbl.set(r.team.short, o); }
  const ps = allPlayers(lg);
  lgLines.push(...ps.map((p) => p.stats?.[key]?.bat).filter(Boolean));
  for (const p of ps) {
    if (!p.realStat) continue;
    const k = `${p.name}|${p.id}`;
    const e = p.stats?.[key];
    const o = agg.get(k) || { p, sims: [] };
    o.sims.push(e || null);
    agg.set(k, o);
  }
}
const B = sumLines(lgLines, BAT_KEYS);
console.log(`\n리그 (시뮬 ${N}시즌 합산): 타율 ${avg(B).toFixed(3)} 출루 ${obp(B).toFixed(3)} 장타 ${slg(B).toFixed(3)} 경기당 득점 ${(B.r / (1440 * N)).toFixed(2)}`);
console.log('\n순위 (평균):', [...tbl.entries()].map(([t, o]) => [t, o.w / (o.w + o.l)]).sort((x, y) => y[1] - x[1]).map(([t, p]) => `${t} ${p.toFixed(3)}`).join(' | '));

// 주전 타자: 실제 타율·홈런 vs 시뮬
const rows = [...agg.values()].filter((o) => o.p.type === 'H' && o.p.realStat.PA >= 400);
const simAvg = (o) => { const l = sumLines(o.sims.map((e) => e?.bat), BAT_KEYS); return { avg: avg(l), hrRate: l.pa ? l.hr / l.pa : 0, ops: obp(l) + slg(l), pa: l.pa / N }; };
const corr = (x, y) => { const m = (v) => v.reduce((a, b) => a + b, 0) / v.length; const mx = m(x), my = m(y); const c = m(x.map((v, i) => (v - mx) * (y[i] - my))); return c / Math.sqrt(m(x.map((v) => (v - mx) ** 2)) * m(y.map((v) => (v - my) ** 2))); };
const S = rows.map(simAvg);
console.log(`\n주전 타자 ${rows.length}명 상관: 타율 ${corr(rows.map((o) => o.p.realStat.AVG), S.map((s) => s.avg)).toFixed(2)}, 홈런율 ${corr(rows.map((o) => o.p.realStat.HR / o.p.realStat.PA), S.map((s) => s.hrRate)).toFixed(2)}, OPS ${corr(rows.map((o) => o.p.realStat.OBP + o.p.realStat.SLG), S.map((s) => s.ops)).toFixed(2)}`);
console.log('실제 → 시뮬 (상위 12명, OPS 순):');
rows.map((o, i) => ({ o, s: S[i] })).sort((x, y) => (y.o.p.realStat.OBP + y.o.p.realStat.SLG) - (x.o.p.realStat.OBP + x.o.p.realStat.SLG)).slice(0, 12).forEach(({ o, s }) => {
  const r = o.p.realStat;
  console.log(`  ${o.p.name.padEnd(5)} 실제 ${r.AVG.toFixed(3)} ${String(r.HR).padStart(2)}홈런 OPS ${(r.OBP + r.SLG).toFixed(3)}  →  시뮬 ${s.avg.toFixed(3)} ${(s.hrRate * r.PA).toFixed(0).padStart(2)}홈런(같은 타석 환산) OPS ${s.ops.toFixed(3)}`);
});
// 투수
const prow = [...agg.values()].filter((o) => o.p.type === 'P' && o.p.realStat.IP >= 100);
const pera = prow.map((o) => { const l = sumLines(o.sims.map((e) => e?.pit), ['outs', 'er', 'so', 'bb', 'h', 'hr']); return l.outs ? (l.er * 27) / l.outs : null; });
const ok = prow.map((o, i) => [o.p.realStat.ERA, pera[i]]).filter(([, b]) => b != null);
console.log(`\n선발급 투수 ${ok.length}명 ERA 상관: ${corr(ok.map((x) => x[0]), ok.map((x) => x[1])).toFixed(2)}`);
