// UI 공용 도우미
import { displayRating, POS_KO, POS_SHORT_KO, PITCH_TYPES } from '../data/ratings.js';
import { overall, scoutPotential } from '../data/playerGen.js';
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
