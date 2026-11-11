// 기록: 개인 순위(타율·OPS·홈런·타점·ERA·WHIP·탈삼진·WAR) + 우리 팀 선수 기록
import { app } from '../app.js';
import { allPlayers, myTeam, teamGamesPlayed, teamById } from '../../league/season.js';
import { leaders, LEADER_DEFS, seasonKey, avg, obp, slg, ops, era, whip, war, leagueBaseline } from '../../league/stats.js';
import { fmtIP } from '../../core/util.js';
import { esc, pLink, table, fmt3, fmt2, teamChip } from '../common.js';

let season = null;
let post = false;

const fmtV = (def, v) => (def.fmt === 'avg' ? fmt3(v) : def.fmt === 'f2' ? fmt2(v) : v);

export const leadersView = {
  render(el) {
    const lg = app.lg;
    const seasons = [];
    for (let s = lg.startYear || lg.season; s <= lg.season; s++) seasons.push(s);
    season ??= lg.season;
    const key = seasonKey(season, post);
    const players = allPlayers(lg);
    const games = season === lg.season && !post ? teamGamesPlayed(lg) : 144;
    const qualGames = post ? 0 : games;
    const boxes = Object.entries(LEADER_DEFS).map(([k, def]) => {
      const rows = leaders(players, key, k, qualGames, 10);
      return `<div class="leader-box"><h4>${def.label}</h4><ol>${rows.map((r) => `<li class="${r.team === lg.myTeamId ? 'mine' : ''}">${pLink(r.player)} <span class="subtle">${esc(teamById(lg, r.team)?.short || r.team)}</span> <b>${fmtV(def, r.value)}</b></li>`).join('') || '<li class="subtle">기록 없음</li>'}</ol></div>`;
    }).join('');

    // 우리 팀
    const t = myTeam(lg);
    const mine = players.filter((p) => p.stats?.[key]?.team === t.id);
    const base = leagueBaseline(players, key);
    const bats = mine.filter((p) => p.stats[key].bat?.pa).sort((a, b) => b.stats[key].bat.pa - a.stats[key].bat.pa).map((p) => {
      const b = p.stats[key].bat;
      return `<tr><td class="l">${pLink(p)}</td><td>${b.g}</td><td>${b.pa}</td><td>${b.ab}</td><td>${b.h}</td><td>${b.d}</td><td>${b.t}</td><td>${b.hr}</td><td>${b.rbi}</td><td>${b.r}</td><td>${b.sb}</td><td>${b.bb}</td><td>${b.so}</td>
        <td>${fmt3(avg(b))}</td><td>${fmt3(obp(b))}</td><td>${fmt3(slg(b))}</td><td>${fmt3(ops(b))}</td><td>${p.type === 'H' ? war(p, p.stats[key], base).toFixed(1) : ''}</td></tr>`;
    });
    const pits = mine.filter((p) => p.stats[key].pit?.g).sort((a, b) => b.stats[key].pit.outs - a.stats[key].pit.outs).map((p) => {
      const s = p.stats[key].pit;
      return `<tr><td class="l">${pLink(p)}</td><td>${s.g}</td><td>${s.gs}</td><td>${s.w}</td><td>${s.l}</td><td>${s.sv}</td><td>${fmtIP(s.outs)}</td><td>${s.h}</td><td>${s.hr}</td><td>${s.bb}</td><td>${s.so}</td><td>${s.er}</td>
        <td>${fmt2(era(s))}</td><td>${fmt2(whip(s))}</td><td>${war(p, p.stats[key], base).toFixed(1)}</td></tr>`;
    });

    el.innerHTML = `<section class="card">
      <div class="row"><h2 style="margin:0">개인 기록 순위</h2>
        <select id="lSeason">${seasons.map((s) => `<option ${s === season ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <label class="chk"><input type="checkbox" id="lPost" ${post ? 'checked' : ''}> 포스트시즌</label>
        <span class="subtle">규정타석 ${Math.floor(qualGames * 3.1)} · 규정이닝 ${qualGames}</span></div>
      <div class="leader-grid">${boxes}</div></section>
      <section class="card"><h2>${teamChip(t)}${esc(t.name)} 타자 기록</h2>
        ${table(['선수', '경기', '타석', '타수', '안타', '2루타', '3루타', '홈런', '타점', '득점', '도루', '볼넷', '삼진', '타율', '출루율', '장타율', 'OPS', 'WAR'], bats, 'compact')}</section>
      <section class="card"><h2>${esc(t.short)} 투수 기록</h2>
        ${table(['선수', '경기', '선발', '승', '패', '세', '이닝', '피안타', '피홈런', '볼넷', '탈삼진', '자책', 'ERA', 'WHIP', 'WAR'], pits, 'compact')}</section>`;
    el.querySelector('#lSeason').onchange = (e) => { season = Number(e.target.value); leadersView.render(el); };
    el.querySelector('#lPost').onchange = (e) => { post = e.target.checked; leadersView.render(el); };
  },
};
