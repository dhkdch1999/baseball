// 오프시즌 '외국인 선수' 단계: 기존 외국인 재계약/결별 + 신규 후보 스카우팅·영입
import { myTeam } from '../../league/season.js';
import { foreignSlots, setForeignDecision, signForeign } from '../../league/offseason.js';
import { seasonKey, avg, ops, era, whip } from '../../league/stats.js';
import { fmtIP } from '../../core/util.js';
import { esc, OVR, pLink, posLabel, fmtMoney, toast, ratingBars, fmt3, fmt2, R, POS_KO } from '../common.js';

let filter = 'all';

function seasonLine(lg, p) {
  const e = p.stats?.[seasonKey(lg.season)];
  if (p.type === 'H' && e?.bat) return `${e.bat.g}경기 타율 ${fmt3(avg(e.bat))} ${e.bat.hr}홈런 OPS ${fmt3(ops(e.bat))}`;
  if (p.type === 'P' && e?.pit) return `${e.pit.g}경기 ${fmtIP(e.pit.outs)}이닝 ${e.pit.w}승 ${e.pit.l}패 ERA ${fmt2(era(e.pit))} WHIP ${fmt2(whip(e.pit))}`;
  return '1군 기록 없음';
}

function slotChips(sl) {
  const chip = (used, max, label) => `<span class="slot-chip ${used >= max ? 'full' : ''}">${label} <b>${used}/${max}</b></span>`;
  return chip(sl.reg, sl.maxReg, '외국인') + chip(sl.asia, sl.maxAsia, '아시아쿼터');
}

export function renderForeignStep(el, lg, rerender) {
  const t = myTeam(lg);
  const sl = foreignSlots(lg, t);
  const dec = lg.offseason.foreignDecisions || {};
  const mine = [...t.roster, ...t.reserve].filter((p) => p.foreign);
  const mineCards = mine.map((p) => {
    const pending = !!p.foreignPending;
    const d = dec[p.id] || 'keep';
    const w = p.lastWar;
    return `<div class="fx-card ${pending && d === 'release' ? 'leaving' : ''}">
      <div class="fx-head"><div>${pLink(p)} <span class="tag">${p.asia ? '아시아쿼터' : '외국인'}</span> <span class="subtle">${p.type === 'P' ? posLabel(p) : POS_KO[p.pos]} · ${p.age}세</span></div><div>${OVR(p)}</div></div>
      <div class="subtle">${seasonLine(lg, p)}${w != null ? ` · WAR ${w.toFixed(1)}` : ''}</div>
      ${pending ? `<div class="fx-decide">
          <span>재계약 조건 <b>${fmtMoney(p.renewAsk)}</b> (1년)</span>
          <div class="seg"><button data-keep="${p.id}" class="${d === 'keep' ? 'on' : ''}">재계약</button><button data-release="${p.id}" class="${d === 'release' ? 'on danger' : ''}">결별</button></div>
        </div>` : `<div class="subtle">계약 ${fmtMoney(p.contract?.salary || 0)} · 잔여 ${p.contract?.years ?? 0}년</div>`}
    </div>`;
  }).join('') || '<p class="subtle">외국인 선수가 없습니다.</p>';

  const pool = (lg.foreignPool || []).filter((p) => filter === 'all'
    || (filter === 'SP' && !p.asia && p.type === 'P' && p.role === 'SP')
    || (filter === 'RP' && !p.asia && p.type === 'P' && p.role === 'RP')
    || (filter === 'H' && !p.asia && p.type === 'H')
    || (filter === 'asia' && p.asia))
    .sort((a, b) => b.report.ovr - a.report.ovr);
  const shown = pool.length;
  const cands = pool.map((p) => {
    const full = p.asia ? sl.asia >= sl.maxAsia : sl.reg >= sl.maxReg;
    const e = p.report.err ?? 4, lo = p.report.ovr - e, hi = p.report.ovr + e;
    return `<div class="fx-card cand">
      <div class="fx-head"><div><b>${esc(p.name)}</b> ${p.asia ? '<span class="tag asia">아시아쿼터</span>' : ''} <span class="subtle">${p.type === 'P' ? posLabel(p) : POS_KO[p.pos]} · ${p.age}세 · ${p.type === 'P' ? (p.throws === 'L' ? '좌투' : '우투') : (p.bats === 'L' ? '좌타' : p.bats === 'S' ? '양타' : '우타')}</span></div>
        <div class="est">예상 종합 ${R(p.report.ovr)} <span class="subtle">(${Math.round(lo)}~${Math.round(hi)})</span></div></div>
      <div class="bars">${ratingBars(p, p.report.keys, true)}</div>
      <div class="subtle note">스카우트 메모: ${esc(p.report.note)}</div>
      <div class="fx-buy"><span>요구 연봉 <b>${fmtMoney(p.asking.salary)}</b> · 1년</span><button class="primary" data-sign="${p.id}" ${full ? 'disabled title="자리가 없습니다"' : ''}>영입</button></div>
    </div>`;
  }).join('') || '<p class="subtle">후보가 없습니다.</p>';

  el.innerHTML = `
    <p>외국인 선수는 매년 1년 계약입니다. 기존 선수와 <b>재계약</b>할지 <b>결별</b>할지 정하고, 빈 자리는 아래 후보 중에서 영입하세요.
      후보 능력치는 <b>스카우트 리포트(오차 있음)</b>이고, 계약하면 실제 능력이 드러납니다.</p>
    <div class="slots">${slotChips(sl)} <span class="subtle">결별을 선택한 선수는 자리 계산에서 빠집니다</span></div>
    <h3>우리 팀 외국인 선수</h3>
    <div class="fx-grid">${mineCards}</div>
    <h3 style="margin-top:18px">영입 후보 <span class="subtle">${(lg.foreignPool || []).length}명</span></h3>
    <nav class="tabs">${[['all', '전체'], ['SP', '선발'], ['RP', '불펜'], ['H', '타자'], ['asia', '아시아쿼터']].map(([k, v]) => `<button data-ff="${k}" class="${filter === k ? 'active' : ''}">${v}</button>`).join('')}</nav>
    <div class="fx-grid">${cands}</div>
    <div class="row" style="margin-top:14px"><button class="primary" id="oNext">외국인 선수 확정 → FA 시장</button>
      <span class="subtle">다음 단계로 가면 다른 구단들이 남은 후보를 영입합니다</span></div>`;

  el.querySelectorAll('[data-keep]').forEach((b) => b.onclick = () => { setForeignDecision(lg, Number(b.dataset.keep), 'keep'); rerender(); });
  el.querySelectorAll('[data-release]').forEach((b) => b.onclick = () => { setForeignDecision(lg, Number(b.dataset.release), 'release'); rerender(); });
  el.querySelectorAll('[data-ff]').forEach((b) => b.onclick = () => { filter = b.dataset.ff; rerender(); });
  el.querySelectorAll('[data-sign]').forEach((b) => b.onclick = () => {
    const r = signForeign(lg, Number(b.dataset.sign));
    toast(r.msg, r.ok ? 'info' : 'error');
    rerender(true);
  });
}
