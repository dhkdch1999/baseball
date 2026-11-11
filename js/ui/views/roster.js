// 로스터: 라인업·타순 편집, 투수진(선발 로테이션·불펜 보직), 1군/2군 명단 이동·방출
import { app, render, persist } from '../app.js';
import { myTeam, seasonDates } from '../../league/season.js';
import { autoDepthChart } from '../../data/teamGen.js';
import { promote, demote, release, ensureLineup, payroll, ACTIVE_MAX, TOTAL_MAX } from '../../league/roster.js';
import { seasonKey, avg, ops, era } from '../../league/stats.js';
import { offenseScore } from '../../data/playerGen.js';
import { esc, R, OVR, POT, pLink, posLabel, statusBadges, fmtMoney, table, toast, POS_SHORT_KO, fmt3, fmt2 } from '../common.js';

const POSS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
let tab = 'lineup';
let draft = null; // 편집 중인 라인업

function seasonLine(lg, p) {
  const e = p.stats?.[seasonKey(lg.season)];
  if (p.type === 'H') return e?.bat ? `${fmt3(avg(e.bat))} ${e.bat.hr}홈런 OPS ${fmt3(ops(e.bat))}` : '';
  return e?.pit ? `${e.pit.w}승 ${e.pit.l}패 ${e.pit.sv ? e.pit.sv + '세 ' : ''}ERA ${fmt2(era(e.pit))}` : '';
}

function lineupTab(lg, t) {
  draft ??= t.lineup.map((x) => ({ ...x }));
  const hitters = t.roster.filter((p) => p.type === 'H');
  const rows = draft.map((s, i) => {
    const p = hitters.find((h) => h.id === s.id);
    return `<tr>
      <td>${i + 1}</td>
      <td><select data-pos="${i}">${POSS.map((x) => `<option ${x === s.pos ? 'selected' : ''} value="${x}">${POS_SHORT_KO[x]}</option>`).join('')}</select></td>
      <td><select data-pl="${i}">${hitters.map((h) => `<option value="${h.id}" ${h.id === s.id ? 'selected' : ''} ${h.injury ? 'disabled' : ''}>${esc(h.name)} (${POS_SHORT_KO[h.pos]})${h.injury ? ' - 부상' : ''}</option>`).join('')}</select></td>
      <td>${p ? R(p.ratings.contact) : ''}</td><td>${p ? R(p.ratings.power) : ''}</td><td>${p ? R(p.ratings.eye) : ''}</td><td>${p ? R(p.ratings.speed) : ''}</td>
      <td>${p && s.pos !== 'DH' ? R(p.ratings.def[s.pos] ?? 25) : '-'}</td>
      <td class="subtle">${p ? seasonLine(lg, p) : ''}</td>
      <td><button data-up="${i}" ${i === 0 ? 'disabled' : ''}>▲</button><button data-down="${i}" ${i === 8 ? 'disabled' : ''}>▼</button></td>
    </tr>`;
  });
  return `${autoBox(t)}<p class="subtle">타순과 수비 위치를 바꾼 뒤 <b>라인업 저장</b>을 누르세요 (저장하면 직접 관리 모드로 바뀝니다). 부상자가 생기면 경기 전에 자동으로 대체됩니다.</p>
    ${table(['타순', '위치', '선수', '컨택', '파워', '선구', '주력', '수비', '시즌 성적', '순서'], rows)}
    <div class="row"><button class="primary" id="rSave">라인업 저장</button><button id="rAuto">AI 자동 편성</button><button id="rReset">되돌리기</button></div>`;
}

function autoBox(t) {
  const on = t.autoLineup !== false;
  return `<label class="chk auto-box ${on ? 'on' : ''}"><input type="checkbox" id="rAutoMode" ${on ? 'checked' : ''}>
    AI 코치가 매 경기 라인업·투수진을 자동 관리 ${on ? '(켜짐 — 내가 정한 라인업은 무시됩니다)' : '(꺼짐 — 내가 정한 라인업으로 출전)'}</label>`;
}

function staffTab(lg, t) {
  const pit = t.roster.filter((p) => p.type === 'P');
  const opt = (sel) => `<option value="">— 없음 —</option>` + pit.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)} (${p.role === 'SP' ? '선발형' : '불펜형'})${p.injury ? ' - 부상' : ''}</option>`).join('');
  const bp = t.bullpen;
  const rot = t.rotation;
  const rows = pit.map((p) => {
    const role = rot.includes(p.id) ? `선발 ${rot.indexOf(p.id) + 1}` : bp.closer === p.id ? '마무리' : bp.setup.includes(p.id) ? '셋업' : bp.long.includes(p.id) ? '롱릴리프' : '중간계투';
    return `<tr><td>${pLink(p)}</td><td>${role}</td><td>${p.age}</td><td>${OVR(p)}</td><td>${R(p.ratings.velo)}</td><td>${R(p.ratings.control)}</td><td>${R(p.ratings.stuff)}</td><td>${R(p.ratings.stamina)}</td><td>${Math.round(p.fatigue || 0)}</td><td>${statusBadges(p)}</td><td class="subtle">${seasonLine(lg, p)}</td></tr>`;
  });
  return `${autoBox(t)}<div class="staff-grid">
      ${[0, 1, 2, 3, 4].map((i) => `<label>선발 ${i + 1} <select data-rot="${i}">${opt(rot[i])}</select></label>`).join('')}
      <label>마무리 <select id="sCloser">${opt(bp.closer)}</select></label>
      <label>셋업 1 <select data-setup="0">${opt(bp.setup[0])}</select></label>
      <label>셋업 2 <select data-setup="1">${opt(bp.setup[1])}</select></label>
    </div>
    <div class="row"><button class="primary" id="sSave">투수진 저장</button><button id="rAuto">AI 자동 편성</button></div>
    <p class="subtle">피로도 30 이하인 투수가 선발로 나갑니다. 나머지 투수는 중간계투/롱릴리프로 자동 배치됩니다.</p>
    ${table(['투수', '보직', '나이', '종합', '구속', '제구', '구위', '스태미나', '피로', '상태', '시즌 성적'], rows)}`;
}

function listTab(lg, t, which) {
  const list = which === 'roster' ? t.roster : t.reserve;
  const sorted = list.slice().sort((a, b) => (a.type === b.type ? 0 : a.type === 'H' ? -1 : 1) || (b.type === 'H' ? offenseScore(b) - offenseScore(a) : 0));
  const rows = sorted.map((p) => `<tr><td>${pLink(p)}</td><td>${posLabel(p)}</td><td>${p.age}</td><td>${OVR(p)}</td><td>${POT(p)}</td>
    <td>${fmtMoney(p.contract?.salary || 0)} / ${p.contract?.years ?? '-'}년</td><td>${statusBadges(p)}</td><td class="subtle">${seasonLine(lg, p)}</td>
    <td>${which === 'roster' ? `<button data-demote="${p.id}">2군</button>` : `<button data-promote="${p.id}">1군</button>`}<button data-release="${p.id}" class="danger">방출</button></td></tr>`);
  return `<p class="subtle">1군 ${t.roster.length}/${ACTIVE_MAX}명 · 전체 ${t.roster.length + t.reserve.length}/${TOTAL_MAX}명 · 연봉 총액 ${fmtMoney(payroll(t))}</p>
    ${table(['선수', '포지션', '나이', '종합', '잠재력', '연봉/잔여', '상태', '시즌 성적', ''], rows)}`;
}

export const rosterView = {
  render(el) {
    const lg = app.lg;
    const t = myTeam(lg);
    const tabs = { lineup: '라인업', staff: '투수진', roster: `1군 (${t.roster.length})`, reserve: `2군 (${t.reserve.length})` };
    let body = '';
    if (tab === 'lineup') body = lineupTab(lg, t);
    else if (tab === 'staff') body = staffTab(lg, t);
    else body = listTab(lg, t, tab);
    el.innerHTML = `<section class="card"><nav class="tabs">${Object.entries(tabs).map(([k, v]) => `<button data-rtab="${k}" class="${tab === k ? 'active' : ''}">${v}</button>`).join('')}</nav>${body}</section>`;
    const live = app.live && !app.live.done;
    if (live) el.querySelector('.card').insertAdjacentHTML('afterbegin', '<p class="warn">경기 진행 중에는 변경 사항이 다음 경기부터 적용됩니다.</p>');

    el.querySelectorAll('[data-rtab]').forEach((b) => b.onclick = () => { tab = b.dataset.rtab; draft = null; render(); });
    const on = (sel, fn) => el.querySelectorAll(sel).forEach((b) => b.onclick = () => fn(b));
    // 라인업
    el.querySelectorAll('[data-pos]').forEach((s) => s.onchange = () => { draft[+s.dataset.pos].pos = s.value; render(); });
    el.querySelectorAll('[data-pl]').forEach((s) => s.onchange = () => { draft[+s.dataset.pl].id = Number(s.value); render(); });
    on('[data-up]', (b) => { const i = +b.dataset.up; [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; render(); });
    on('[data-down]', (b) => { const i = +b.dataset.down; [draft[i + 1], draft[i]] = [draft[i], draft[i + 1]]; render(); });
    on('#rSave', () => {
      const pos = new Set(draft.map((x) => x.pos)), ids = new Set(draft.map((x) => x.id));
      if (pos.size !== 9) return toast('수비 위치가 중복되었습니다 (포수~우익수 + 지명타자 각 1명)', 'error');
      if (ids.size !== 9) return toast('같은 선수가 두 번 들어갔습니다', 'error');
      t.lineup = draft.map((x) => ({ ...x }));
      t.autoLineup = false;
      draft = null;
      persist();
      toast('라인업 저장');
      render();
    });
    on('#rReset', () => { draft = null; render(); });
    const am = el.querySelector('#rAutoMode');
    if (am) am.onchange = () => { t.autoLineup = am.checked; if (am.checked) autoDepthChart(t); draft = null; persist(); render(); };
    on('#rAuto', () => { autoDepthChart(t); t.autoLineup = true; draft = null; persist(); toast('AI가 라인업과 투수진을 편성했습니다'); render(); });
    // 투수진
    on('#sSave', () => {
      const rot = [...el.querySelectorAll('[data-rot]')].map((s) => Number(s.value)).filter(Boolean);
      if (new Set(rot).size !== rot.length || rot.length < 5) return toast('선발 5명을 서로 다르게 지정하세요', 'error');
      const closer = Number(el.querySelector('#sCloser').value) || null;
      const setup = [...el.querySelectorAll('[data-setup]')].map((s) => Number(s.value)).filter(Boolean);
      const used = new Set([...rot, closer, ...setup].filter(Boolean));
      if (used.size !== rot.length + (closer ? 1 : 0) + setup.length) return toast('한 투수에게 보직이 중복되었습니다', 'error');
      const rest = t.roster.filter((p) => p.type === 'P' && !used.has(p.id));
      const long = rest.filter((p) => p.role === 'SP').map((p) => p.id);
      t.rotation = rot;
      t.bullpen = { closer, setup, middle: rest.filter((p) => !long.includes(p.id)).map((p) => p.id), long };
      t.autoLineup = false;
      persist();
      toast('투수진 저장');
      render();
    });
    // 명단 이동
    const act = (fn, b, key) => { const r = fn(t, Number(b.dataset[key])); toast(r.msg, r.ok ? 'info' : 'error'); if (r.ok) { ensureLineup(t); persist(); } render(); };
    on('[data-promote]', (b) => act(promote, b, 'promote'));
    on('[data-demote]', (b) => act(demote, b, 'demote'));
    on('[data-release]', (b) => {
      const p = [...t.roster, ...t.reserve].find((x) => x.id === Number(b.dataset.release));
      if (!confirm(`${p.name}을(를) 방출할까요? 잔여 연봉 계약은 사라지고 FA가 됩니다.`)) return;
      const r = release(lg, t, p.id);
      toast(r.msg, r.ok ? 'info' : 'error');
      if (r.ok) { ensureLineup(t); persist(); }
      render();
    });
  },
};

export { seasonDates };
