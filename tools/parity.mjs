#!/usr/bin/env node
// 전력 평준화 점검: 여러 리그·여러 시즌의 1위/꼴찌 승률과 팀 승률 표준편차
//   node tools/parity.mjs --leagues 12 --seasons 1
//   node tools/parity.mjs --leagues 4 --seasons 5     # 시즌이 지나도 격차가 벌어지지 않는지
import { newCareer } from '../js/league/season.js';
import { advanceUntil, nextOffseasonStep, syncPhase } from '../js/league/career.js';
import { computeStandings } from '../js/league/standings.js';
import { autoDepthChart } from '../js/data/teamGen.js';
import { aiSignFreeAgents } from '../js/league/offseason.js';

const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? Number(a[i + 1]) : d; };
const L = arg('leagues', 12), S = arg('seasons', 1);
const bySeason = Array.from({ length: S }, () => ({ top: [], bot: [], sd: [], top2: [] }));
for (let l = 0; l < L; l++) {
  const lg = newCareer({ seed: `parity-${l}`, myTeamId: 'LG' });
  for (let s = 0; s < S; s++) {
    // 내 팀도 AI처럼 운영 (방치로 인한 왜곡 제거)
    lg.teams.find((t) => t.id === lg.myTeamId).autoLineup = true;
    advanceUntil(lg, 'season');
    const st = computeStandings(lg);
    const p = st.map((r) => r.pct);
    const m = p.reduce((x, y) => x + y, 0) / p.length;
    const b = bySeason[s];
    b.top.push(p[0]); b.top2.push(p[1]); b.bot.push(p[9]);
    b.sd.push(Math.sqrt(p.reduce((x, y) => x + (y - m) ** 2, 0) / p.length));
    if (s < S - 1) {
      advanceUntil(lg, 'postseason'); syncPhase(lg);
      nextOffseasonStep(lg); nextOffseasonStep(lg); // review → foreign → fa
      const myId = lg.myTeamId; lg.myTeamId = '__none__'; aiSignFreeAgents(lg); lg.myTeamId = myId;
      while (lg.phase !== 'regular') nextOffseasonStep(lg);
      autoDepthChart(lg.teams.find((t) => t.id === myId));
    }
  }
}
const avg = (x) => x.reduce((p, q) => p + q, 0) / x.length;
const f = (x) => x.toFixed(3).replace(/^0/, '');
console.log(`리그 ${L}개 × ${S}시즌 (참고: 최근 KBO 1위 .580~.620, 꼴찌 .380~.420, 표준편차 약 .060)`);
bySeason.forEach((b, i) => console.log(`${i + 1}시즌차  1위 평균 ${f(avg(b.top))} (최고 ${f(Math.max(...b.top))})  2위 ${f(avg(b.top2))}  꼴찌 평균 ${f(avg(b.bot))} (최저 ${f(Math.min(...b.bot))})  팀 승률 SD ${f(avg(b.sd))}`));
