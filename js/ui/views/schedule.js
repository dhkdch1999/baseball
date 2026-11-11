// 일정/결과: 내 팀 월별 일정 + 날짜별 리그 전체 결과
import { app } from '../app.js';
import { teamById } from '../../league/season.js';
import { fmtDate } from '../../league/schedule.js';
import { esc, teamChip } from '../common.js';

let month = null;
let dayView = null;

export const scheduleView = {
  render(el) {
    const lg = app.lg;
    const id = lg.myTeamId;
    const months = [...new Set(lg.schedule.map((d) => d.date.slice(5, 7)))];
    const curMonth = lg.schedule[Math.min(lg.day, lg.schedule.length - 1)].date.slice(5, 7);
    month ??= curMonth;
    const days = lg.schedule.map((d, i) => ({ ...d, i })).filter((d) => d.date.slice(5, 7) === month);
    const rows = days.map((d) => {
      const g = d.games.find((x) => x.away === id || x.home === id);
      if (!g) return '';
      const home = g.home === id;
      const opp = teamById(lg, home ? g.away : g.home);
      let res = '<span class="subtle">예정</span>';
      if (g.result) {
        const r = g.result;
        const my = home ? r.score[1] : r.score[0], ot = home ? r.score[0] : r.score[1];
        const k = r.winner == null ? 'T' : r.winner === id ? 'W' : 'L';
        res = `<span class="f ${k}">${k === 'W' ? '승' : k === 'L' ? '패' : '무'}</span> ${my}:${ot} <span class="subtle">${r.W ? `승 ${esc(r.W)} 패 ${esc(r.L)}${r.S ? ` 세 ${esc(r.S)}` : ''}` : ''}</span>`;
      }
      return `<tr class="${d.i === lg.day && lg.phase === 'regular' ? 'me' : ''}"><td><a href="#" data-day="${d.i}">${fmtDate(d.date)}</a></td><td>${home ? '홈' : '원정'}</td><td class="l">${teamChip(opp)}${esc(opp.short)}</td><td class="l">${res}</td></tr>`;
    }).join('');
    let dayHtml = '';
    if (dayView != null) {
      const d = lg.schedule[dayView];
      dayHtml = `<section class="card"><h3>${fmtDate(d.date)} 전체 경기</h3>${d.games.map((g) => {
        const A = teamById(lg, g.away), H = teamById(lg, g.home);
        return `<div class="game-line">${teamChip(A)}${esc(A.short)} ${g.result ? `<b>${g.result.score[0]} : ${g.result.score[1]}</b>` : 'vs'} ${esc(H.short)}${teamChip(H)} <span class="subtle">${g.result?.W ? `승 ${esc(g.result.W)} · 패 ${esc(g.result.L)}${g.result.S ? ` · 세 ${esc(g.result.S)}` : ''}` : ''}</span></div>`;
      }).join('')}</section>`;
    }
    el.innerHTML = `<section class="card"><h2>${lg.season} 일정 · 결과</h2>
      <nav class="tabs">${months.map((m) => `<button data-month="${m}" class="${m === month ? 'active' : ''}">${Number(m)}월</button>`).join('')}</nav>
      <table class="tbl"><tbody>${rows}</tbody></table></section>${dayHtml}`;
    el.querySelectorAll('[data-month]').forEach((b) => b.onclick = () => { month = b.dataset.month; dayView = null; scheduleView.render(el); });
    el.querySelectorAll('[data-day]').forEach((a) => a.onclick = (e) => { e.preventDefault(); dayView = Number(a.dataset.day); scheduleView.render(el); });
  },
};
