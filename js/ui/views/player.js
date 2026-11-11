// 선수 상세 (모달): 프로필, 계약, 능력치(표시값), 스카우트 잠재력, 시즌별/통산 기록
import { allPlayers, teamById } from '../../league/season.js';
import { findTeamOf } from '../../league/roster.js';
import { BAT_KEYS, PIT_KEYS, avg, obp, slg, ops, era, whip, war, leagueBaseline, careerLine, sumLines } from '../../league/stats.js';
import { veloKmh } from '../../data/ratings.js';
import { overall } from '../../data/playerGen.js';
import { esc, R, OVR, POT, fmtMoney, POS_KO, PITCH_TYPES, handLabel, statusBadges, openModal, table, fmt3, fmt2 } from '../common.js';
import { fmtIP } from '../../core/util.js';

function findPlayer(lg, id) {
  return allPlayers(lg).find((p) => p.id === id) || (lg.draftPool || []).find((p) => p.id === id);
}

export function openPlayer(lg, id) {
  const p = findPlayer(lg, id);
  if (!p) return;
  const where = findTeamOf(lg, id);
  const team = where?.team;
  const r = p.ratings;
  const affil = team ? `${esc(team.name)} · ${where.where === 'roster' ? '1군' : '2군'}`
    : lg.freeAgents.includes(p) ? '자유계약(FA)' : '드래프트 대상';
  const contract = p.contract ? `${fmtMoney(p.contract.salary)} · 잔여 ${p.contract.years}년` : p.asking ? `요구 ${fmtMoney(p.asking.salary)} × ${p.asking.years}년` : '-';

  let ratingsHtml;
  if (p.type === 'H') {
    const defs = Object.entries(r.def).sort((a, b) => b[1] - a[1]).map(([pos, v]) => `${POS_KO[pos]} ${R(v)}`).join(' · ');
    ratingsHtml = `<div class="rgrid">
      <div>컨택</div><div>${R(r.contact)}</div><div>파워</div><div>${R(r.power)}</div>
      <div>선구안</div><div>${R(r.eye)}</div><div>삼진회피</div><div>${R(r.avoidK)}</div>
      <div>주력</div><div>${R(r.speed)}</div><div>송구</div><div>${R(r.arm)}</div>
      ${p.pos === 'C' ? `<div>포수 리드</div><div>${R(r.catcherLead)}</div>` : ''}
    </div><div class="subtle" style="margin-top:6px">수비: ${defs}</div>`;
  } else {
    ratingsHtml = `<div class="rgrid">
      <div>구속</div><div>${R(r.velo)} <span class="subtle">${veloKmh(r.velo)}km</span></div><div>제구</div><div>${R(r.control)}</div>
      <div>구위</div><div>${R(r.stuff)}</div><div>스태미나</div><div>${R(r.stamina)}</div>
      <div>멘탈</div><div>${R(r.mental)}</div>
    </div><div class="subtle" style="margin-top:6px">변화구: ${r.pitches.map((x) => `${PITCH_TYPES[x.type].ko} ${R(x.grade)}`).join(' · ')}</div>`;
  }

  // 기록
  const keys = Object.keys(p.stats || {}).sort();
  let statsHtml = '';
  const players = allPlayers(lg);
  if (p.type === 'H' || keys.some((k) => p.stats[k].bat)) {
    const rows = keys.filter((k) => p.stats[k].bat).map((k) => batRow(k, p.stats[k], p, players));
    const car = careerLine(p, 'bat');
    if (car.pa) rows.push(batRow('통산', { bat: car, team: '' }, p, null));
    if (rows.length) statsHtml += table(['시즌', '팀', '경기', '타석', '타율', '출루', '장타', 'OPS', '홈런', '타점', '득점', '도루', '볼넷', '삼진', 'WAR'], rows, 'compact');
  }
  if (p.type === 'P' || keys.some((k) => p.stats[k].pit)) {
    const rows = keys.filter((k) => p.stats[k].pit).map((k) => pitRow(k, p.stats[k], p, players));
    const car = careerLine(p, 'pit');
    if (car.outs) rows.push(pitRow('통산', { pit: car, team: '' }, p, null));
    if (rows.length) statsHtml += table(['시즌', '팀', '경기', '선발', '승', '패', '세', '이닝', 'ERA', 'WHIP', '탈삼진', '볼넷', '피홈런', 'WAR'], rows, 'compact');
  }

  const draftInfo = p.draft ? `<div class="subtle">${p.draft.season} 드래프트 ${p.draft.round}라운드 ${p.draft.pick}순위 (${esc(teamById(lg, p.draft.team)?.short)})</div>` : '';
  openModal(`
    <div class="pl-head">
      <div>
        <h2>${esc(p.name)} <span class="subtle">${p.type === 'P' ? (p.role === 'SP' ? '선발투수' : '구원투수') : POS_KO[p.pos]}</span></h2>
        <div>${affil} · ${p.age}세 · ${handLabel(p)} · 연차 ${p.service}년</div>
        <div>계약: ${contract} ${statusBadges(p)}</div>
        ${p.injury ? `<div class="inj-text">부상: ${esc(p.injury.type)} (복귀까지 약 ${p.injury.days}일)</div>` : ''}
        ${draftInfo}
      </div>
      <div class="ovr-box"><div>종합 ${OVR(p)}</div><div>잠재력 ${POT(p)}</div><div class="subtle">잠재력은 스카우트 평가 (오차 있음)</div></div>
    </div>
    <h3>능력치</h3>${ratingsHtml}
    <h3>기록</h3>${statsHtml || '<p class="subtle">아직 1군 기록이 없습니다.</p>'}
  `, { wide: true });
}

function seasonLabel(k) { return k.endsWith('PS') ? `${k.slice(0, -2)} PS` : k; }

function batRow(k, e, p, players) {
  const b = e.bat;
  const w = players && !k.endsWith('PS') ? war(p, e, leagueBaseline(players, k)) : null;
  return `<tr><td>${seasonLabel(k)}</td><td>${esc(e.team || '')}</td><td>${b.g}</td><td>${b.pa}</td><td>${fmt3(avg(b))}</td><td>${fmt3(obp(b))}</td><td>${fmt3(slg(b))}</td><td>${fmt3(ops(b))}</td>
    <td>${b.hr}</td><td>${b.rbi}</td><td>${b.r}</td><td>${b.sb}</td><td>${b.bb}</td><td>${b.so}</td><td>${w == null ? '' : w.toFixed(1)}</td></tr>`;
}

function pitRow(k, e, p, players) {
  const s = e.pit;
  const w = players && !k.endsWith('PS') ? war(p, e, leagueBaseline(players, k)) : null;
  return `<tr><td>${seasonLabel(k)}</td><td>${esc(e.team || '')}</td><td>${s.g}</td><td>${s.gs}</td><td>${s.w}</td><td>${s.l}</td><td>${s.sv}</td><td>${fmtIP(s.outs)}</td>
    <td>${fmt2(era(s))}</td><td>${fmt2(whip(s))}</td><td>${s.so}</td><td>${s.bb}</td><td>${s.hr}</td><td>${w == null ? '' : w.toFixed(1)}</td></tr>`;
}

export { overall, sumLines, BAT_KEYS, PIT_KEYS };
