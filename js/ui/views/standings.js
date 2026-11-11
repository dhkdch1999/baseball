// 순위표 + 포스트시즌 대진 + 역대 우승
import { app } from '../app.js';
import { teamById } from '../../league/season.js';
import { computeStandings } from '../../league/standings.js';
import { ROUND_KO } from '../../league/postseason.js';
import { esc, teamChip, table } from '../common.js';

export const standingsView = {
  render(el) {
    const lg = app.lg;
    const st = computeStandings(lg);
    const rows = st.map((r) => `<tr class="${r.team.id === lg.myTeamId ? 'me' : ''} ${r.rank === 5 ? 'cutline' : ''}">
      <td>${r.rank}</td><td class="l">${teamChip(r.team)}${esc(r.team.name)}</td><td>${r.gp}</td><td>${r.w}</td><td>${r.l}</td><td>${r.t}</td>
      <td><b>${r.pct.toFixed(3).replace(/^0/, '')}</b></td><td>${r.gb === 0 ? '-' : r.gb}</td><td>${r.last10.join('-')}</td><td>${r.streak}</td>
      <td>${r.home.slice(0, 2).join('-')}</td><td>${r.away.slice(0, 2).join('-')}</td><td>${r.rs}</td><td>${r.ra}</td><td>${r.rs - r.ra > 0 ? '+' : ''}${r.rs - r.ra}</td></tr>`);
    let html = `<section class="card"><h2>${lg.season} 정규시즌 순위</h2>
      ${table(['순위', '팀', '경기', '승', '패', '무', '승률', '게임차', '최근10', '연속', '홈', '원정', '득점', '실점', '득실'], rows, 'standings')}
      <p class="subtle">5위까지 포스트시즌 진출 · 승률 = 승 ÷ (승+패)</p></section>`;
    if (lg.postseason) html += bracket(lg);
    if (lg.history.length) {
      html += `<section class="card"><h2>역대 기록</h2>${table(['시즌', '우승', '준우승', 'MVP', '최고 투수', '신인왕'], lg.history.slice().reverse().map((h) => `<tr>
        <td>${h.season}</td><td>${h.champion ? `${teamChip(teamById(lg, h.champion))}${esc(teamById(lg, h.champion).short)}` : ''}</td>
        <td>${h.runnerUp ? esc(teamById(lg, h.runnerUp).short) : ''}</td>
        <td>${h.mvp ? `<a href="#" data-player="${h.mvp.id}">${esc(h.mvp.name)}</a> (${esc(teamById(lg, h.mvp.team)?.short || '')})` : ''}</td>
        <td>${h.ace ? `<a href="#" data-player="${h.ace.id}">${esc(h.ace.name)}</a> (${esc(teamById(lg, h.ace.team)?.short || '')})` : ''}</td>
        <td>${h.rookie ? `<a href="#" data-player="${h.rookie.id}">${esc(h.rookie.name)}</a> (${esc(teamById(lg, h.rookie.team)?.short || '')})` : ''}</td></tr>`))}</section>`;
    }
    el.innerHTML = html;
  },
};

function bracket(lg) {
  const ps = lg.postseason;
  const items = ps.series.map((s) => {
    const H = teamById(lg, s.high), L = teamById(lg, s.low);
    const w = s.winner;
    return `<div class="series-box"><div class="subtle">${ROUND_KO[s.round]}</div>
      <div class="${w === H.id ? 'won' : w ? 'lost' : ''}">${teamChip(H)}${esc(H.short)} <b>${s.wins[0]}</b></div>
      <div class="${w === L.id ? 'won' : w ? 'lost' : ''}">${teamChip(L)}${esc(L.short)} <b>${s.wins[1]}</b></div></div>`;
  }).join('<span class="arrow">→</span>');
  return `<section class="card"><h2>포스트시즌</h2><div class="bracket">${items}</div>
    ${ps.champion ? `<p class="champ">🏆 ${esc(teamById(lg, ps.champion).name)} 우승</p>` : ''}</section>`;
}
