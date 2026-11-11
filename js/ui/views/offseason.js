// 오프시즌 진행: 시즌 결산 → FA 시장 → 신인 드래프트 → 새 시즌
import { app, render, persist, navigate } from '../app.js';
import { myTeam, teamById } from '../../league/season.js';
import { nextOffseasonStep } from '../../league/career.js';
import { OFF_STEPS, STEP_KO, draftOnClock, draftPlayer, runDraft, DRAFT_ROUNDS, fmtMoney } from '../../league/offseason.js';
import { overall, scoutPotential } from '../../data/playerGen.js';
import { esc, OVR, POT, pLink, posLabel, teamChip, toast, R } from '../common.js';

let dFilter = 'all';

export const offseasonView = {
  render(el) {
    const lg = app.lg;
    if (lg.phase !== 'offseason' || !lg.offseason) { navigate('home'); return; }
    const step = lg.offseason.step;
    const steps = OFF_STEPS.map((s) => `<span class="step ${s === step ? 'cur' : OFF_STEPS.indexOf(s) < OFF_STEPS.indexOf(step) ? 'done' : ''}">${STEP_KO[s]}</span>`).join('<span class="arrow">›</span>');
    let body = '';
    if (step === 'review') body = review(lg);
    else if (step === 'fa') body = `<p>FA 시장이 열렸습니다. <a href="#" data-nav="fa">FA 화면</a>에서 선수에게 제안하거나, <a href="#" data-nav="trade">트레이드</a>, <a href="#" data-nav="roster">로스터 정리</a>를 하세요.
      다음 단계로 넘어가면 AI 구단들이 남은 FA를 영입합니다.</p><button class="primary" id="oNext">드래프트로 진행</button>`;
    else if (step === 'draft') body = draft(lg);
    else body = `<p>${lg.season + 1} 시즌 준비가 끝났습니다. 로스터와 라인업을 확인하고 시즌을 시작하세요.</p>
      <div class="row"><button data-nav="roster">로스터 확인</button><button class="primary" id="oNext">${lg.season + 1} 시즌 시작</button></div>`;
    el.innerHTML = `<section class="card"><h2>${lg.season} 오프시즌</h2><div class="steps">${steps}</div>${body}</section>`;
    const next = el.querySelector('#oNext');
    if (next) next.onclick = () => {
      nextOffseasonStep(lg);
      persist();
      if (lg.phase === 'regular') { toast(`${lg.season} 시즌 개막!`); navigate('home'); } else render();
    };
    el.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => {
      const r = draftPlayer(lg, lg.myTeamId, Number(b.dataset.pick));
      toast(r.msg, r.ok ? 'info' : 'error');
      runDraft(lg, false);
      persist();
      render();
    });
    el.querySelectorAll('[data-df]').forEach((b) => b.onclick = () => { dFilter = b.dataset.df; render(); });
    const auto = el.querySelector('#oAuto');
    if (auto) auto.onclick = () => { runDraft(lg, true); persist(); render(); };
  },
};

function review(lg) {
  const h = lg.history[lg.history.length - 1];
  const rep = lg.offseason.report;
  const t = myTeam(lg);
  const name = (id) => esc(teamById(lg, id)?.name || '');
  const changes = rep.changes.slice().sort((a, b) => b.delta - a.delta);
  const up = changes.filter((c) => c.delta >= 1.5).slice(0, 8);
  const down = changes.filter((c) => c.delta <= -1.5).reverse().slice(0, 8);
  const rank = (lg.finalStandings || []).findIndex((r) => r.id === t.id) + 1;
  const li = (c) => `<li><a href="#" data-player="${c.id}">${esc(c.name)}</a> (${c.age}세) <b class="${c.delta > 0 ? 'up' : 'down'}">${c.delta > 0 ? '+' : ''}${c.delta.toFixed(1)}</b> → 종합 ${R(c.ovr)}</li>`;
  return `
    <div class="grid2">
      <div><h3>시즌 결과</h3>
        <p>🏆 우승: <b>${name(h.champion)}</b> · 준우승: ${name(h.runnerUp)}</p>
        <p>정규시즌 ${rank}위: ${esc(t.name)}</p>
        <p>MVP ${h.mvp ? `<a href="#" data-player="${h.mvp.id}">${esc(h.mvp.name)}</a> (${name(h.mvp.team)})` : '-'}<br>
        최고 투수 ${h.ace ? `<a href="#" data-player="${h.ace.id}">${esc(h.ace.name)}</a> (${name(h.ace.team)})` : '-'}<br>
        신인왕 ${h.rookie ? `<a href="#" data-player="${h.rookie.id}">${esc(h.rookie.name)}</a> (${name(h.rookie.team)})` : '-'}</p></div>
      <div><h3>우리 팀 변화</h3>
        <p class="subtle">나이를 한 살 먹고 능력치가 변했습니다. (종합 능력치 변화)</p>
        <div class="grid2"><div><b>성장</b><ul>${up.map(li).join('') || '<li class="subtle">없음</li>'}</ul></div>
        <div><b>하락</b><ul>${down.map(li).join('') || '<li class="subtle">없음</li>'}</ul></div></div>
        ${rep.retired.length ? `<p>은퇴: ${rep.retired.map(esc).join(', ')}</p>` : ''}
        ${rep.toFA.length ? `<p>FA 자격 취득으로 이탈: ${rep.toFA.map(esc).join(', ')} <span class="subtle">(FA 시장에서 다시 잡을 수 있습니다)</span></p>` : ''}
        ${rep.resigned.length ? `<details><summary>재계약 ${rep.resigned.length}명</summary>${rep.resigned.map((r) => `${esc(r.name)} ${fmtMoney(r.from)} → ${fmtMoney(r.to)}`).join('<br>')}</details>` : ''}
      </div>
    </div>
    <button class="primary" id="oNext">FA 시장 열기</button>`;
}

function draft(lg) {
  const oc = draftOnClock(lg);
  const myTurn = oc && oc.teamId === lg.myTeamId;
  const pool = lg.draftPool.filter((p) => dFilter === 'all' || (dFilter === 'H' ? p.type === 'H' : p.type === 'P'))
    .sort((a, b) => scoutPotential(b) - scoutPotential(a) || overall(b) - overall(a));
  const picks = lg.draft.picks.slice().reverse().slice(0, 30).map((pk) => `<div class="${pk.teamId === lg.myTeamId ? 'mine' : ''}">${pk.round}R ${pk.pickNo}번 ${teamChip(teamById(lg, pk.teamId))}${esc(teamById(lg, pk.teamId).short)} — <a href="#" data-player="${pk.pid}">${esc(pk.name)}</a></div>`).join('');
  const rows = pool.map((p) => `<tr><td class="l">${pLink(p)}</td><td>${posLabel(p)}</td><td>${p.age}</td><td>${OVR(p)}</td><td>${POT(p)}</td>
    <td>${p.type === 'H' ? `컨${R(p.ratings.contact)} 파${R(p.ratings.power)} 주${R(p.ratings.speed)}` : `구속${R(p.ratings.velo)} 제${R(p.ratings.control)} 구위${R(p.ratings.stuff)}`}</td>
    <td>${myTurn ? `<button data-pick="${p.id}" class="primary">지명</button>` : ''}</td></tr>`).join('');
  return `<p>${oc ? `${oc.round}라운드 ${oc.pickNo}순위 — ${myTurn ? '<b>우리 차례입니다! 선수를 지명하세요.</b>' : `${esc(teamById(lg, oc.teamId).name)} 지명 중`}` : '드래프트가 끝났습니다.'}
    <span class="subtle">(총 ${DRAFT_ROUNDS}라운드, 지명 선수는 2군으로 갑니다. 잠재력은 스카우트 추정치입니다.)</span></p>
    <div class="row">${oc ? '<button id="oAuto">남은 지명 자동 진행</button>' : ''}<button class="primary" id="oNext">${oc ? '드래프트 마치고 다음 단계' : '다음 단계'}</button></div>
    <div class="grid2 draft">
      <div><nav class="tabs">${[['all', '전체'], ['H', '야수'], ['P', '투수']].map(([k, v]) => `<button data-df="${k}" class="${dFilter === k ? 'active' : ''}">${v}</button>`).join('')}</nav>
        <div class="tbl-wrap"><table class="tbl compact"><tr><th>선수</th><th>위치</th><th>나이</th><th>현재</th><th>잠재력</th><th>주요 능력</th><th></th></tr>${rows}</table></div></div>
      <div><h3>지명 결과</h3><div class="picks">${picks || '<span class="subtle">아직 없음</span>'}</div></div>
    </div>`;
}
