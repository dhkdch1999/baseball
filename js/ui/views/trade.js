// 트레이드: 상대 구단 선택 → 주고받을 선수 체크 → AI 반응 확인 → 제안
import { app, render, persist } from '../app.js';
import { myTeam, teamById } from '../../league/season.js';
import { evaluateTrade, executeTrade, tradeWindowOpen, tradeValue } from '../../league/trade.js';
import { esc, OVR, POT, pLink, posLabel, fmtMoney, statusBadges, teamChip, toast } from '../common.js';

let partner = null;
const give = new Set(), get = new Set();
let lastMsg = '';

function list(players, set, name) {
  return `<table class="tbl compact"><tr><th></th><th>선수</th><th>위치</th><th>나이</th><th>종합</th><th>잠재력</th><th>연봉</th><th></th></tr>
    ${players.map((p) => `<tr class="${set.has(p.id) ? 'sel' : ''}"><td><input type="checkbox" data-${name}="${p.id}" ${set.has(p.id) ? 'checked' : ''}></td>
    <td class="l">${pLink(p)}</td><td>${posLabel(p)}</td><td>${p.age}</td><td>${OVR(p)}</td><td>${POT(p)}</td><td>${fmtMoney(p.contract?.salary || 0)}×${p.contract?.years ?? 0}</td><td>${statusBadges(p)}</td></tr>`).join('')}</table>`;
}

export const tradeView = {
  render(el) {
    const lg = app.lg;
    const me = myTeam(lg);
    const win = tradeWindowOpen(lg);
    const others = lg.teams.filter((t) => t.id !== me.id);
    partner ??= others[0].id;
    const them = teamById(lg, partner);
    const sortP = (arr) => arr.slice().sort((a, b) => tradeValue(b) - tradeValue(a));
    const mine = sortP([...me.roster, ...me.reserve]);
    const theirs = sortP([...them.roster, ...them.reserve]);
    for (const id of [...give]) if (!mine.some((p) => p.id === id)) give.delete(id);
    for (const id of [...get]) if (!theirs.some((p) => p.id === id)) get.delete(id);
    const ev = give.size && get.size ? evaluateTrade(lg, partner, [...give], [...get]) : null;
    const meter = ev?.ratio ? Math.min(100, (ev.ratio / 1.3) * 100) : 0;
    el.innerHTML = `<section class="card">
      <h2>트레이드</h2>
      ${win.open ? '' : `<p class="warn">${win.msg}</p>`}
      <div class="row"><label>상대 구단 <select id="tPartner">${others.map((t) => `<option value="${t.id}" ${t.id === partner ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label></div>
      <div class="trade-bar">
        <div><b>보내는 선수</b> ${[...give].map((id) => esc(mine.find((p) => p.id === id)?.name)).join(', ') || '<span class="subtle">없음</span>'}</div>
        <div><b>받는 선수</b> ${[...get].map((id) => esc(theirs.find((p) => p.id === id)?.name)).join(', ') || '<span class="subtle">없음</span>'}</div>
        ${ev ? `<div class="meter"><i style="width:${meter}%" class="${ev.accept ? 'ok' : ''}"></i></div><div>${esc(ev.msg)}</div>` : '<div class="subtle">양쪽에서 선수를 고르면 상대 구단의 반응이 표시됩니다.</div>'}
        <button class="primary" id="tGo" ${ev?.accept && win.open ? '' : 'disabled'}>트레이드 성사</button>
        ${lastMsg ? `<div class="subtle">${esc(lastMsg)}</div>` : ''}
      </div>
      <div class="grid2">
        <div><h3>${teamChip(me)}${esc(me.short)}</h3>${list(mine, give, 'give')}</div>
        <div><h3>${teamChip(them)}${esc(them.short)}</h3>${list(theirs, get, 'get')}</div>
      </div>
      <p class="subtle">AI 구단은 나이·잠재력·계약을 함께 따집니다. 젊고 잠재력 높은 선수, 연봉 대비 성능이 좋은 선수를 비싸게 봅니다.</p>
    </section>`;
    el.querySelector('#tPartner').onchange = (e) => { partner = e.target.value; get.clear(); lastMsg = ''; render(); };
    el.querySelectorAll('[data-give]').forEach((c) => c.onchange = () => { c.checked ? give.add(+c.dataset.give) : give.delete(+c.dataset.give); render(); });
    el.querySelectorAll('[data-get]').forEach((c) => c.onchange = () => { c.checked ? get.add(+c.dataset.get) : get.delete(+c.dataset.get); render(); });
    el.querySelector('#tGo').onclick = () => {
      const r = executeTrade(lg, partner, [...give], [...get]);
      toast(r.msg, r.done ? 'info' : 'error');
      if (r.done) { lastMsg = '트레이드 완료!'; give.clear(); get.clear(); persist(); }
      render();
    };
  },
};
