#!/usr/bin/env node
// 커리어 모드 통합 테스트: 여러 시즌을 자동 진행하며 불변 조건을 확인
//   node tools/career-test.mjs --seasons 3
import { newCareer, myTeam, allPlayers, todayGames } from '../js/league/season.js';
import { advanceUntil, nextOffseasonStep, syncPhase } from '../js/league/career.js';
import { computeStandings } from '../js/league/standings.js';
import { leaders, seasonKey, sumLines, BAT_KEYS, PIT_KEYS, avg, obp, slg } from '../js/league/stats.js';
import { overall } from '../js/data/playerGen.js';
import { payroll } from '../js/league/roster.js';
import { fmtMoney } from '../js/league/offseason.js';

const a = process.argv.slice(2);
const N = parseInt(a[a.indexOf('--seasons') + 1] || '2', 10);
const lg = newCareer({ seed: 'ct', myTeamId: 'HH' });
let fail = 0;
const check = (c, m) => { if (!c) { fail++; console.log('✗', m); } };

for (let s = 0; s < N; s++) {
  const t0 = Date.now();
  advanceUntil(lg, 'season');
  const st = computeStandings(lg);
  check(st.every((r) => r.gp === 144), '모든 팀 144경기');
  const key = seasonKey(lg.season);
  const ps = allPlayers(lg).map((p) => p.stats?.[key]).filter(Boolean);
  const B = sumLines(ps.map((e) => e.bat), BAT_KEYS), P = sumLines(ps.map((e) => e.pit), PIT_KEYS);
  const runs = st.reduce((x, r) => x + r.rs, 0);
  check(B.r === runs, `득점 합계 일치 (${B.r} vs ${runs})`);
  check(P.r === runs, `실점 합계 일치`);
  console.log(`\n=== ${lg.season} 정규시즌 (${((Date.now() - t0) / 1000).toFixed(1)}s) — 타율 ${avg(B).toFixed(3)} OPS ${(obp(B) + slg(B)).toFixed(3)} 경기당 득점 ${(runs / 1440).toFixed(2)}`);
  console.log(st.map((r) => `${r.rank}.${r.team.short} ${r.w}-${r.l}-${r.t} ${r.pct.toFixed(3)} ${r.gb}`).join(' | '));
  for (const stat of ['avg', 'hr', 'era', 'war']) {
    const L = leaders(allPlayers(lg), key, stat, 144, 3);
    console.log(`  ${stat}: ` + L.map((x) => `${x.player.name}(${x.team}) ${typeof x.value === 'number' ? (x.value < 1 && stat === 'avg' ? x.value.toFixed(3) : x.value.toFixed?.(2)) : x.value}`).join(', '));
  }
  const injured = lg.news.filter((n) => n.season === lg.season && n.text.startsWith('[부상]')).length;
  console.log(`  부상 ${injured}건`);
  advanceUntil(lg, 'postseason');
  syncPhase(lg);
  check(lg.phase === 'offseason', '포스트시즌 종료 → 오프시즌');
  const h = lg.history[lg.history.length - 1];
  console.log(`  우승: ${h.champion}  MVP: ${h.mvp?.name} (${h.mvp?.war.toFixed(1)})`);
  const rep = lg.offseason.report;
  console.log(`  내 팀: 은퇴 ${rep.retired.length}, FA ${rep.toFA.length}, 재계약 ${rep.resigned.length}, 최대 성장 ${rep.changes.sort((x, y) => y.delta - x.delta)[0]?.name}(+${rep.changes[0]?.delta.toFixed(1)})`);
  nextOffseasonStep(lg); // → fa
  console.log(`  FA 시장 ${lg.freeAgents.length}명`);
  nextOffseasonStep(lg); // → draft (AI 지명 진행, 내 차례에서 멈춤)
  nextOffseasonStep(lg); // → ready (내 픽 자동)
  check(lg.draft.picks.length === 50, `드래프트 50명 지명 (${lg.draft.picks.length})`);
  nextOffseasonStep(lg); // → 새 시즌
  check(lg.phase === 'regular' && lg.day === 0, '새 시즌 시작');
  for (const t of lg.teams) {
    check(t.roster.length <= 28 && t.roster.length >= 20, `${t.short} 1군 인원 ${t.roster.length}`);
    check(t.lineup.length === 9, `${t.short} 라인업 9명`);
  }
  const my = myTeam(lg);
  console.log(`  ${my.short} 연봉 총액 ${fmtMoney(payroll(my))}, 1군 ${my.roster.length} / 2군 ${my.reserve.length}, FA 잔류 ${lg.freeAgents.length}`);
}
const json = JSON.stringify(lg);
console.log(`\n세이브 크기: ${(json.length / 1024).toFixed(0)} KB`);
const back = JSON.parse(json);
check(back.teams.length === 10, 'JSON 왕복');
console.log(fail ? `\n✗ 실패 ${fail}건` : '\n✓ 모든 검사 통과');
process.exitCode = fail ? 1 : 0;
