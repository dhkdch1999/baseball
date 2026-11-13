// UI 공용 도우미
import { displayRating, POS_KO, POS_SHORT_KO, PITCH_TYPES, veloKmh } from '../data/ratings.js';
import { overall, scoutPotential, scoutPotentialKey } from '../data/playerGen.js';
import { fmtMoney } from '../league/offseason.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const R = (v) => { const d = displayRating(v); return `<span class="r g${d}">${d}</span>`; };
export const OVR = (p) => R(overall(p));
export const POT = (p) => { const d = scoutPotential(p); return `<span class="r pot g${d}">${d}</span>`; };
export { fmtMoney, POS_KO, POS_SHORT_KO, PITCH_TYPES };

export const posLabel = (p) => (p.type === 'P' ? (p.role === 'SP' ? '선발' : '불펜') : POS_SHORT_KO[p.pos]);
export const handLabel = (p) => (p.type === 'P' ? `${p.throws === 'L' ? '좌' : '우'}투` : `${p.throws === 'L' ? '좌' : '우'}투${p.bats === 'S' ? '양' : p.bats === 'L' ? '좌' : '우'}타`);

export function pLink(p) {
  return `<a href="#" class="plink" data-player="${p.id}">${esc(p.name)}</a>`;
}

export function statusBadges(p) {
  const out = [];
  if (p.injury) out.push(`<span class="badge inj" title="${esc(p.injury.type)}">부상 ${p.injury.days}일</span>`);
  if (p.type === 'P' && (p.fatigue || 0) > 35) out.push(`<span class="badge tired">피로 ${Math.round(p.fatigue)}</span>`);
  if ((p.condition || 0) >= 6) out.push('<span class="badge hot">컨디션↑</span>');
  if ((p.condition || 0) <= -6) out.push('<span class="badge cold">컨디션↓</span>');
  return out.join(' ');
}

export function teamChip(t) {
  return `<span class="chip" style="background:${t.color}"></span>`;
}

export function toast(msg, kind = 'info') {
  const el = document.getElementById('toast');
  const d = document.createElement('div');
  d.className = `toast ${kind}`;
  d.textContent = msg;
  el.appendChild(d);
  setTimeout(() => d.classList.add('out'), 2600);
  setTimeout(() => d.remove(), 3200);
}

export function openModal(html, { wide = false } = {}) {
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="modal-back"></div><div class="modal-box ${wide ? 'wide' : ''}"><button class="modal-x" aria-label="닫기">✕</button>${html}</div>`;
  m.hidden = false;
  const close = () => { m.hidden = true; m.innerHTML = ''; };
  m.querySelector('.modal-back').onclick = close;
  m.querySelector('.modal-x').onclick = close;
  return { el: m.querySelector('.modal-box'), close };
}

export function table(headers, rows, cls = '') {
  return `<div class="tbl-wrap"><table class="tbl ${cls}"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

export const fmt3 = (x) => (isFinite(x) ? x.toFixed(3).replace(/^0/, '') : '-');
export const fmt2 = (x) => (isFinite(x) ? x.toFixed(2) : '-');

/** 능력치 막대 (20~80) */
export function bar(label, v, { est = false, pot = null, extra = '' } = {}) {
  const d = Math.max(20, Math.min(80, Math.round(v / 5) * 5));
  const pct = ((v - 20) / 60) * 100;
  const pd = pot != null ? Math.max(20, Math.min(80, Math.round(pot / 5) * 5)) : null;
  const potW = pot != null ? Math.max(0, ((pot - 20) / 60) * 100 - pct) : 0;
  const potHtml = pd != null && pd > d ? `<span class="rp" title="잠재력(스카우트 평가)">→ <span class="r pot g${pd}">${pd}</span></span>` : '';
  return `<div class="rbar ${pot != null ? 'haspot' : ''}"><span class="rl">${label}</span><span class="rt"><i class="g${d}" style="width:${Math.max(3, pct)}%"></i>${potW > 0 ? `<b class="pt" style="width:${potW}%"></b>` : ''}</span><span class="rv"><span class="r g${d}">${est ? '≈' : ''}${d}</span>${potHtml}${extra}</span></div>`;
}

/** 선수 유형에 맞는 주요 능력치 막대 묶음 */
export function ratingBars(p, ratings = p.ratings, est = false, { pot = false, full = false } = {}) {
  const P = (k) => (pot && !est ? scoutPotentialKey(p, k) : null);
  const o = (k) => ({ est, pot: P(k) });
  if (p.type === 'P') {
    const best = (ratings.pitches || p.ratings.pitches || []).slice().sort((a, b) => b.grade - a.grade)[0];
    return [bar('구속', ratings.velo, { ...o('velo'), extra: !est ? ` <small class="subtle">${veloKmh(ratings.velo)}km</small>` : '' }), bar('제구', ratings.control, o('control')), bar('구위', ratings.stuff, o('stuff')), bar('스태미나', ratings.stamina, { est }),
      full ? bar('멘탈', ratings.mental) : '',
      full ? (ratings.pitches || []).map((x) => bar(PITCH_TYPES[x.type].ko, x.grade)).join('') : best && !est ? bar(`주무기(${PITCH_TYPES[best.type].ko})`, best.grade) : ''].join('');
  }
  return [bar('컨택', ratings.contact, o('contact')), bar('파워', ratings.power, o('power')), bar('선구안', ratings.eye, o('eye')),
    ratings.avoidK != null ? bar('삼진회피', ratings.avoidK, o('avoidK')) : '', bar('주력', ratings.speed, { est }),
    full ? bar('송구', ratings.arm) : '',
    full && p.pos === 'C' ? bar('포수 리드', ratings.catcherLead) : '',
    !est && p.ratings.def?.[p.pos] != null ? bar(`수비(${POS_SHORT_KO[p.pos]})`, p.ratings.def[p.pos], { pot: P('def') }) : ''].join('');
}
