// FA 시장: 자유계약 선수 목록 + 계약 제안
import { app, render, persist } from '../app.js';
import { myTeam, teamById } from '../../league/season.js';
import { offerFA, ensureAsking } from '../../league/offseason.js';
import { payroll, TOTAL_MAX } from '../../league/roster.js';
import { overall, marketSalary } from '../../data/playerGen.js';
import { esc, OVR, POT, pLink, posLabel, fmtMoney, statusBadges, toast, R } from '../common.js';

let filter = 'all';

export const faView = {
  render(el) {
    const lg = app.lg;
    ensureAsking(lg);
    const me = myTeam(lg);
    const list = lg.freeAgents
      .filter((p) => filter === 'all' || (filter === 'H' ? p.type === 'H' : p.type === 'P'))
      .sort((a, b) => overall(b) - overall(a)).slice(0, 80);
    const rows = list.map((p) => {
      const ask = p.asking || { salary: marketSalary(p), years: 1 };
      const key = p.type === 'H' ? `컨${R(p.ratings.contact)} 파${R(p.ratings.power)}` : `제${R(p.ratings.control)} 구위${R(p.ratings.stuff)}`;
      return `<tr><td class="l">${pLink(p)}</td><td>${posLabel(p)}</td><td>${p.age}</td><td>${OVR(p)}</td><td>${POT(p)}</td><td>${key}</td>
        <td>${p.prevTeam ? esc(teamById(lg, p.prevTeam)?.short || '') : '-'}</td><td><b>${fmtMoney(ask.salary)}</b> × ${ask.years}년</td><td>${statusBadges(p)}</td>
        <td class="offer"><input type="number" min="3000" step="500" value="${ask.salary}" data-sal="${p.id}" title="연봉 (만원)"> 만원
          <select data-yrs="${p.id}">${[1, 2, 3, 4, 5].map((y) => `<option ${y === ask.years ? 'selected' : ''}>${y}</option>`).join('')}</select>년
          <button data-offer="${p.id}">제안</button></td></tr>`;
    });
    el.innerHTML = `<section class="card">
      <h2>FA 시장 <span class="subtle">(${lg.freeAgents.length}명)</span></h2>
      <p class="subtle">요구 조건 이상을 제시하면 계약합니다. 나이 많은 선수는 계약 기간을 길게 주면 조금 더 양보합니다.
        우리 팀 연봉 총액 ${fmtMoney(payroll(me))} · 소속 ${me.roster.length + me.reserve.length}/${TOTAL_MAX}명</p>
      <nav class="tabs">${[['all', '전체'], ['H', '야수'], ['P', '투수']].map(([k, v]) => `<button data-f="${k}" class="${filter === k ? 'active' : ''}">${v}</button>`).join('')}</nav>
      <div class="tbl-wrap"><table class="tbl compact"><tr><th>선수</th><th>위치</th><th>나이</th><th>종합</th><th>잠재력</th><th>주요 능력</th><th>전 소속</th><th>요구 조건</th><th>상태</th><th>제안</th></tr>${rows.join('') || '<tr><td colspan="10" class="subtle">FA 선수가 없습니다</td></tr>'}</table></div>
    </section>`;
    el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filter = b.dataset.f; render(); });
    el.querySelectorAll('[data-offer]').forEach((b) => b.onclick = () => {
      const id = Number(b.dataset.offer);
      const sal = Math.round(Number(el.querySelector(`[data-sal="${id}"]`).value) / 100) * 100;
      const yrs = Number(el.querySelector(`[data-yrs="${id}"]`).value);
      const r = offerFA(lg, id, sal, yrs);
      toast(r.msg, r.ok ? 'info' : 'error');
      if (r.ok) { persist(); render(); }
    });
  },
};
