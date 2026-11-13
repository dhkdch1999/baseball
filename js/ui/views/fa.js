// FA 시장: 왼쪽 목록(필터·정렬·검색) + 오른쪽 선수 상세·계약 제안 패널
import { app, render, persist } from '../app.js';
import { myTeam, teamById } from '../../league/season.js';
import { offerFA, ensureAsking, faAcceptChance } from '../../league/offseason.js';
import { payroll, TOTAL_MAX } from '../../league/roster.js';
import { overall, potentialOverall, marketSalary, scoutPotential } from '../../data/playerGen.js';
import { seasonKey, avg, ops, era, whip } from '../../league/stats.js';
import { fmtIP } from '../../core/util.js';
import { esc, OVR, POT, posLabel, fmtMoney, statusBadges, toast, ratingBars, handLabel, fmt3, fmt2, POS_KO } from '../common.js';

const state = { filter: 'all', pos: 'all', sort: 'ovr', q: '', sel: null, offer: null };

const FILTERS = [['all', '전체'], ['H', '야수'], ['SP', '선발투수'], ['RP', '불펜투수']];
const SORTS = [['ovr', '종합 높은 순'], ['pot', '잠재력 높은 순'], ['young', '나이 어린 순'], ['cheap', '요구액 낮은 순'], ['value', '가성비 순']];

const askOf = (p) => p.asking || { salary: marketSalary(p), years: 1 };

function lastSeason(lg, p) {
  for (const key of [seasonKey(lg.season), seasonKey(lg.season - 1)]) {
    const e = p.stats?.[key];
    if (p.type === 'H' && e?.bat?.pa) return `${key} · ${e.bat.g}경기 타율 ${fmt3(avg(e.bat))} ${e.bat.hr}홈런 OPS ${fmt3(ops(e.bat))}`;
    if (p.type === 'P' && e?.pit?.outs) return `${key} · ${e.pit.g}경기 ${fmtIP(e.pit.outs)}이닝 ERA ${fmt2(era(e.pit))} WHIP ${fmt2(whip(e.pit))}${e.pit.sv ? ` ${e.pit.sv}세` : ''}`;
  }
  const r = p.realStat;
  if (r) return p.type === 'H' ? `${lg.realSeason || 2026} 실제 · 타율 ${fmt3(r.AVG)} ${r.HR}홈런` : `${lg.realSeason || 2026} 실제 · ERA ${fmt2(r.ERA)} ${fmtIP(r.outs)}이닝`;
  return '최근 1군 기록 없음';
}

/** 우리 팀에서 이 선수와 경쟁할 선수 */
function compareText(lg, p) {
  const t = myTeam(lg);
  const pool = [...t.roster, ...t.reserve];
  let rival, label;
  if (p.type === 'H') {
    const lu = t.lineup.find((l) => l.pos === p.pos);
    rival = lu && pool.find((x) => x.id === lu.id);
    label = `우리 팀 주전 ${POS_KO[p.pos]}`;
  } else if (p.role === 'SP') {
    const rot = t.rotation.map((id) => pool.find((x) => x.id === id)).filter(Boolean).sort((a, b) => overall(a) - overall(b));
    rival = rot[0];
    label = '우리 팀 5선발(가장 약한 선발)';
  } else {
    const bp = [t.bullpen.closer, ...t.bullpen.setup, ...t.bullpen.middle].map((id) => pool.find((x) => x.id === id)).filter(Boolean).sort((a, b) => overall(a) - overall(b));
    rival = bp[0];
    label = '우리 팀 필승조·중간계투 중 가장 약한 투수';
  }
  if (!rival) return `<div class="cmp">${label}: 없음 → <b class="up">바로 주전감</b></div>`;
  const d = Math.round(overall(p) - overall(rival));
  return `<div class="cmp">${label}: <b>${esc(rival.name)}</b> ${OVR(rival)} → 이 선수가 <b class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</b></div>`;
}

function listRow(p, selId) {
  const a = askOf(p);
  return `<button class="fa-row ${p.id === selId ? 'sel' : ''}" data-sel="${p.id}">
    <span class="nm"><b>${esc(p.name)}</b><span class="subtle">${p.type === 'P' ? posLabel(p) : POS_KO[p.pos]} · ${p.age}세</span></span>
    <span class="rt">${OVR(p)}${POT(p)}</span>
    <span class="ask">${fmtMoney(a.salary)}<small>×${a.years}년</small></span>
    ${p.injury ? '<span class="badge inj">부상</span>' : ''}
  </button>`;
}

function detailPanel(lg, p) {
  if (!p) return '<div class="fa-empty">왼쪽 목록에서 선수를 고르면<br>능력치와 계약 조건이 여기에 나옵니다.</div>';
  const a = askOf(p);
  state.offer ??= { id: p.id, salary: a.salary, years: a.years };
  if (state.offer.id !== p.id) state.offer = { id: p.id, salary: a.salary, years: a.years };
  const o = state.offer;
  const chance = faAcceptChance(p, o.salary, o.years);
  const pct = Math.round(chance * 100);
  const word = pct >= 100 ? '수락 확실' : pct >= 60 ? '수락 가능성 높음' : pct > 0 ? '고민 중' : '거절할 것';
  const prev = p.prevTeam ? teamById(lg, p.prevTeam)?.name : null;
  return `<div class="fa-detail">
    <div class="fd-head">
      <div><h3><a href="#" data-player="${p.id}">${esc(p.name)}</a></h3>
        <div class="subtle">${p.type === 'P' ? (p.role === 'SP' ? '선발투수' : '불펜투수') : POS_KO[p.pos]} · ${p.age}세 · ${handLabel(p)}${prev ? ` · 전 소속 ${esc(prev)}` : ''}</div>
        <div>${statusBadges(p)}</div></div>
      <div class="fd-ovr"><div>종합 ${OVR(p)}</div><div>잠재력 ${POT(p)}</div></div>
    </div>
    <div class="bars">${ratingBars(p, p.ratings, false, { pot: true })}</div>
    <div class="subtle season">${lastSeason(lg, p)}</div>
    ${compareText(lg, p)}
    <div class="offer-box">
      <div class="ask-line">요구 조건 <b>${fmtMoney(a.salary)} × ${a.years}년</b> <span class="subtle">(총액 ${fmtMoney(a.salary * a.years)})</span></div>
      <label class="field">연봉
        <span class="money"><button data-adj="-0.1">−10%</button><input id="faSal" type="number" step="0.1" min="0.3" value="${(o.salary / 10000).toFixed(1)}"><span>억</span><button data-adj="0.1">+10%</button></span>
      </label>
      <div class="quick"><button data-q="0.95">요구액의 95%</button><button data-q="1">요구액 그대로</button><button data-q="1.1">요구액 +10%</button></div>
      <label class="field">계약 기간
        <span class="seg">${[1, 2, 3, 4, 5].map((y) => `<button data-yrs="${y}" class="${o.years === y ? 'on' : ''}">${y}년</button>`).join('')}</span>
      </label>
      <div class="total">총액 <b>${fmtMoney(o.salary * o.years)}</b></div>
      <div class="chance"><div class="meter"><i style="width:${Math.max(3, pct)}%" class="${pct >= 60 ? 'ok' : pct > 0 ? 'mid' : 'no'}"></i></div><span>${word} (${pct}%)</span></div>
      <button class="primary big" id="faOffer">계약 제안</button>
      <p class="subtle tip">${p.age >= 31 ? '나이가 많은 선수라 계약 기간을 길게 주면 연봉을 조금 양보합니다.' : '젊은 선수라 짧은 계약을 선호합니다 (길게 주면 조금 더 요구).'}</p>
    </div>
  </div>`;
}

export const faView = {
  render(el) {
    const lg = app.lg;
    ensureAsking(lg);
    const me = myTeam(lg);
    const q = state.q.trim();
    let list = lg.freeAgents.filter((p) => {
      if (state.filter === 'H' && p.type !== 'H') return false;
      if (state.filter === 'SP' && !(p.type === 'P' && p.role === 'SP')) return false;
      if (state.filter === 'RP' && !(p.type === 'P' && p.role === 'RP')) return false;
      if (state.filter === 'H' && state.pos !== 'all' && p.pos !== state.pos) return false;
      if (q && !p.name.includes(q)) return false;
      return true;
    });
    const key = {
      ovr: (p) => -overall(p), pot: (p) => -scoutPotential(p) - overall(p) / 100, young: (p) => p.age,
      cheap: (p) => askOf(p).salary, value: (p) => -(overall(p) - 40) / Math.log10(askOf(p).salary + 10),
    }[state.sort];
    list = list.sort((a, b) => key(a) - key(b));
    if (state.sel && !lg.freeAgents.some((p) => p.id === state.sel)) state.sel = null;
    if (!state.sel && list.length) state.sel = list[0].id;
    const sel = lg.freeAgents.find((p) => p.id === state.sel);

    el.innerHTML = `<section class="card fa">
      <div class="fa-top">
        <h2>FA 시장</h2>
        <div class="fa-stats"><span>FA <b>${lg.freeAgents.length}</b>명</span><span>우리 팀 연봉 총액 <b>${fmtMoney(payroll(me))}</b></span><span>소속 <b>${me.roster.length + me.reserve.length}/${TOTAL_MAX}</b>명</span></div>
      </div>
      <div class="fa-filters">
        <nav class="tabs">${FILTERS.map(([k, v]) => `<button data-f="${k}" class="${state.filter === k ? 'active' : ''}">${v}</button>`).join('')}</nav>
        ${state.filter === 'H' ? `<select id="faPos"><option value="all">전체 포지션</option>${['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'].map((x) => `<option value="${x}" ${state.pos === x ? 'selected' : ''}>${POS_KO[x]}</option>`).join('')}</select>` : ''}
        <select id="faSort">${SORTS.map(([k, v]) => `<option value="${k}" ${state.sort === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input id="faQ" placeholder="이름 검색" value="${esc(state.q)}">
      </div>
      <div class="fa-body">
        <div class="fa-list">
          <div class="fa-list-head"><span>선수</span><span>종합 / 잠재력</span><span>요구 조건</span></div>
          ${list.slice(0, 120).map((p) => listRow(p, state.sel)).join('') || '<p class="subtle pad">조건에 맞는 FA가 없습니다.</p>'}
        </div>
        <aside class="fa-side">${detailPanel(lg, sel)}</aside>
      </div>
    </section>`;

    el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { state.filter = b.dataset.f; state.pos = 'all'; state.sel = null; render(); });
    const pos = el.querySelector('#faPos'); if (pos) pos.onchange = () => { state.pos = pos.value; state.sel = null; render(); };
    el.querySelector('#faSort').onchange = (e) => { state.sort = e.target.value; render(); };
    const qi = el.querySelector('#faQ');
    qi.oninput = () => { state.q = qi.value; state.sel = null; const pos0 = qi.selectionStart; render(); const n = document.getElementById('faQ'); n.focus(); n.setSelectionRange(pos0, pos0); };
    el.querySelectorAll('[data-sel]').forEach((b) => b.onclick = () => { state.sel = Number(b.dataset.sel); render(); });
    if (!sel) return;
    const a = askOf(sel);
    const setSal = (manwon) => { state.offer.salary = Math.max(3000, Math.round(manwon / 100) * 100); render(); };
    el.querySelectorAll('[data-adj]').forEach((b) => b.onclick = () => setSal(state.offer.salary * (1 + Number(b.dataset.adj))));
    el.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => setSal(a.salary * Number(b.dataset.q)));
    el.querySelector('#faSal').onchange = (e) => setSal(Number(e.target.value) * 10000);
    el.querySelectorAll('[data-yrs]').forEach((b) => b.onclick = () => { state.offer.years = Number(b.dataset.yrs); render(); });
    el.querySelector('#faOffer').onclick = () => {
      const r = offerFA(lg, sel.id, state.offer.salary, state.offer.years);
      toast(r.msg, r.ok ? 'info' : 'error');
      if (r.ok) { state.sel = null; state.offer = null; persist(); render(); }
    };
  },
};

export { potentialOverall };
