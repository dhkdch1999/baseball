// 경기 전 화면: 팀 선택, 양 팀 라인업·선발투수 미리보기 (표시 능력치는 5단위)
import { displayRating, POS_SHORT_KO, PITCH_TYPES, veloKmh } from '../data/ratings.js';
import { Rng } from '../core/rng.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const R = (v) => { const d = displayRating(v); return `<span class="r g${d}">${d}</span>`; };

export function fillTeamSelects(awaySel, homeSel, league) {
  const opts = league.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  const prevA = awaySel.value, prevH = homeSel.value;
  awaySel.innerHTML = opts;
  homeSel.innerHTML = opts;
  awaySel.value = prevA || league.teams[0].id;
  homeSel.value = prevH || league.teams[4].id;
}

/** 시드로 선발 로테이션 순번을 정해 양 팀 선발투수 id를 반환 */
export function pickStarters(away, home, gameSeed) {
  const rng = new Rng('starter', gameSeed);
  return [away, home].map((t) => t.rotation[rng.int(0, t.rotation.length - 1)]);
}

export function renderLineups(el, away, home, starters) {
  el.innerHTML = [away, home].map((t, i) => teamCard(t, starters[i], i === 0 ? '원정' : '홈')).join('');
}

function teamCard(team, starterId, label) {
  const rows = team.lineup.map(({ id, pos }, i) => {
    const p = team.roster.find((x) => x.id === id);
    const r = p.ratings;
    const defPos = pos === 'DH' ? '-' : R(r.def[pos] ?? 25);
    return `<tr><td>${i + 1}</td><td class="name">${esc(p.name)}</td><td class="pos">${POS_SHORT_KO[pos]}</td>
      <td>${p.bats === 'S' ? '양' : p.bats === 'L' ? '좌' : '우'}</td><td>${p.age}</td>
      <td>${R(r.contact)}</td><td>${R(r.power)}</td><td>${R(r.eye)}</td><td>${R(r.avoidK)}</td><td>${R(r.speed)}</td><td>${defPos}</td></tr>`;
  }).join('');
  const sp = team.roster.find((x) => x.id === starterId);
  const s = sp.ratings;
  const pitches = s.pitches.map((x) => `${PITCH_TYPES[x.type].ko} ${R(x.grade)}`).join(' · ');
  return `<div>
    <h3><span class="chip" style="background:${team.color}"></span>${esc(team.name)} <span class="subtle">${label} · ${esc(team.city)}</span></h3>
    <table class="ratings">
      <thead><tr><th>#</th><th style="text-align:left">타자</th><th>위치</th><th>타</th><th>나이</th><th>컨택</th><th>파워</th><th>선구</th><th>삼진회피</th><th>주력</th><th>수비</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="ratings" style="margin-top:10px">
      <thead><tr><th style="text-align:left">선발투수</th><th>투</th><th>나이</th><th>구속</th><th>제구</th><th>구위</th><th>스태미나</th><th>멘탈</th></tr></thead>
      <tbody><tr><td class="name">${esc(sp.name)}</td><td>${sp.throws === 'L' ? '좌' : '우'}</td><td>${sp.age}</td>
        <td>${R(s.velo)} <span class="subtle">${veloKmh(s.velo)}km</span></td><td>${R(s.control)}</td><td>${R(s.stuff)}</td><td>${R(s.stamina)}</td><td>${R(s.mental)}</td></tr></tbody>
    </table>
    <div class="subtle" style="margin-top:4px">변화구: ${pitches}</div>
  </div>`;
}
