// 경기 화면: 문자중계 + 감독 작전 + 진행 속도
import { app, navigate, persist, renderHeader } from '../app.js';
import { completeGame, simRemainingGames, endDay } from '../../league/season.js';
import { syncPhase } from '../../league/career.js';
import { roleOf } from '../../sim/aiManager.js';
import { SHIFT_KO } from '../../sim/game.js';
import { overall } from '../../data/playerGen.js';
import { Feed } from '../broadcast/feed.js';
import { renderScoreboard, renderDiamond, renderBSO, renderMatchupNow, renderBox } from '../scoreboard.js';
import { esc, R, toast, POS_SHORT_KO } from '../common.js';

const SPEEDS = { slow: 1300, normal: 650, fast: 250, turbo: 60 };
let timer = null;
let feed = null;
let root = null;
let tab = 'feed';

function L() { return app.live; }

function stopAuto() {
  if (timer) { clearTimeout(timer); timer = null; }
  const b = root?.querySelector('#gAuto');
  if (b) b.textContent = '▶ 자동 진행';
}

/** 이벤트 소비. stop(e, lines) → true면 멈춤 */
function advance(stop, { animate = true } = {}) {
  const live = L();
  if (!live || live.done) return;
  const buf = [];
  let paused = false;
  for (;;) {
    const { value: e, done } = live.it.next();
    if (done) break;
    const lines = live.narrator.lines(e);
    buf.push(...lines);
    track(e);
    if (e.t === 'gameEnd') { finishGame(); break; }
    if (live.autoPause && e.t === 'pa' && important(live.game)) { paused = true; buf.push({ text: '⏸ 승부처! 작전을 고민해 보세요', cls: 'tactic' }); break; }
    if (stop(e, lines)) break;
  }
  live.lines.push(...buf);
  feed.push(buf, { animate: animate && buf.length < 40 });
  feed.scrollToEnd();
  refresh();
  if (paused) stopAuto();
}

function important(g) {
  const live = L();
  const diff = Math.abs(g.score[0] - g.score[1]);
  return g.inning >= 7 && diff <= 2 && (g.bases[1] || g.bases[2]) && (g.batSide === live.mySide || g.defSide === live.mySide);
}

function track(e) {
  const live = L();
  if (e.snap) live.snap = e.snap;
  if (e.t === 'pa') live.cur = { batter: e.batter, pitcher: e.pitcher, slot: e.slot, half: e.snap.half };
  if (e.t === 'pitchingChange' && live.cur) live.cur.pitcher = e.in;
  if (e.t === 'sub' && e.kind === 'PH' && live.cur) live.cur.batter = e.in;
  if (e.t === 'result' || e.t === 'halfEnd') live.countReset = true;
  if (e.t === 'pitch' || e.t === 'pa') live.countReset = false;
}

function finishGame() {
  const live = L();
  if (live.done) return;
  live.done = true;
  stopAuto();
  const lg = app.lg;
  completeGame(lg, live.meta, live.game);
  simRemainingGames(lg, live.meta.id);
  endDay(lg);
  syncPhase(lg);
  persist();
  renderHeader();
}

const stepPitch = () => advance((e, lines) => (e.t === 'pitch' && lines.length > 0) || e.t === 'result' || e.t === 'halfEnd' || e.t === 'steal');
const stepPA = () => advance((e) => e.t === 'result' || e.t === 'halfEnd');
const stepInning = () => advance((e) => e.t === 'halfEnd');
const stepEnd = () => { stopAuto(); L().autoPause = false; advance(() => false, { animate: false }); };
const stepLine = () => advance((e, lines) => lines.length > 0);

function autoLoop() {
  const live = L();
  if (!live || live.done) { stopAuto(); return; }
  stepLine();
  if (!timer) return;
  timer = setTimeout(autoLoop, SPEEDS[live.speed || 'normal']);
}

function refresh() {
  const live = L();
  if (!root || !live) return;
  const g = live.game;
  renderScoreboard(root.querySelector('#scoreboard'), g);
  const snap = live.snap;
  if (snap) {
    const halfOver = snap.outs >= 3 || live.done;
    renderDiamond(root.querySelector('#diamond'), halfOver ? [null, null, null] : snap.bases);
    renderBSO(root.querySelector('#bso'), live.countReset ? [0, 0] : snap.count, Math.min(snap.outs, 3));
  }
  if (live.cur) renderMatchupNow(root.querySelector('#matchupNow'), g, live.cur);
  root.querySelector('#gControls').querySelectorAll('button.step').forEach((b) => { b.disabled = live.done; });
  root.querySelector('#gManager').innerHTML = live.done ? endPanel() : managerPanel();
  bindManager();
  if (tab === 'box') renderBox(root.querySelector('#gBox'), g);
  if (tab === 'lineup') root.querySelector('#gLineup').innerHTML = lineupPanel();
}

function endPanel() {
  const live = L();
  const [a, h] = live.game.score;
  const my = live.mySide === 0 ? a : h, opp = live.mySide === 0 ? h : a;
  const res = my > opp ? '승리' : my < opp ? '패배' : '무승부';
  return `<div class="end-panel ${my > opp ? 'win' : my < opp ? 'lose' : ''}"><b>경기 종료 — ${res}</b>
    <span class="subtle">다른 구장 경기 결과도 반영되었습니다.</span>
    <button class="primary" id="gHome">홈으로</button></div>`;
}

function managerPanel() {
  const live = L();
  const g = live.game;
  const side = live.mySide;
  const o = g.options(side);
  const auto = `<label class="chk"><input type="checkbox" id="gAutoMgr" ${g.autoManage[side] ? 'checked' : ''}> AI 코치 자동 운영</label>`;
  const queued = g.orders[side].map((x) => ({ steal: '도루', bunt: '번트', hitrun: '히트앤런', ph: '대타', pr: '대주자', ibb: '고의사구', pitcher: '투수 교체' }[x.type])).join(', ');
  const q = queued ? `<span class="queued">대기 중: ${queued}</span>` : '';
  if (o.batting) {
    const bench = g.bench(side);
    const benchOpts = bench.map((p) => `<option value="${p.id}">${esc(p.name)} (${POS_SHORT_KO[p.pos]}) 컨${p.ratings.contact} 파${p.ratings.power} 주${p.ratings.speed}</option>`).join('');
    const bases = [1, 2, 3].filter((b) => g.bases[b - 1]).map((b) => `<option value="${b}">${b}루 ${esc(g.bases[b - 1].player.name)}</option>`).join('');
    return `<div class="mgr"><b class="mgr-title">공격 작전</b>${auto}${q}
      <div class="mgr-row">
        <button data-cmd="steal" ${o.steal ? '' : 'disabled'}>도루</button>
        ${g.buntOn ? '<button data-cmd="buntCancel">번트 취소</button>' : `<button data-cmd="bunt">번트</button>`}
        <button data-cmd="hitrun" ${o.hitrun ? '' : 'disabled'}>히트앤런</button>
      </div>
      <div class="mgr-row">
        <select id="gPH" ${o.ph ? '' : 'disabled'}>${benchOpts}</select><button data-cmd="ph" ${o.ph ? '' : 'disabled'}>대타</button>
      </div>
      <div class="mgr-row">
        <select id="gPRbase" ${o.pr ? '' : 'disabled'}>${bases}</select><select id="gPR" ${o.pr ? '' : 'disabled'}>${benchOpts}</select><button data-cmd="pr" ${o.pr ? '' : 'disabled'}>대주자</button>
      </div></div>`;
  }
  const team = g.teams[side];
  const ps = g.ps[side];
  const pitchers = g.availablePitchers(side).sort((a, b) => overall(b) - overall(a));
  const pOpts = pitchers.map((p) => `<option value="${p.id}">${esc(p.name)} [${roleOf(team, p.id)}] 피로 ${Math.round(p.fatigue || 0)}</option>`).join('');
  return `<div class="mgr"><b class="mgr-title">수비 작전</b>${auto}${q}
    <div class="subtle">현재 투수 ${esc(ps.player.name)} · ${ps.pitches}구 (한계 약 ${ps.limit}구)</div>
    <div class="mgr-row">
      <button data-cmd="ibb">고의사구</button>
      <select id="gShift">${Object.entries(SHIFT_KO).map(([k, v]) => `<option value="${k}" ${g.shift[side] === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>
    <div class="mgr-row">
      <select id="gPitcher" ${o.pitcher ? '' : 'disabled'}>${pOpts}</select><button data-cmd="pitcher" ${o.pitcher ? '' : 'disabled'}>투수 교체</button>
    </div></div>`;
}

function bindManager() {
  const live = L();
  const g = live.game;
  const side = live.mySide;
  const m = root.querySelector('#gManager');
  const home = m.querySelector('#gHome');
  if (home) home.onclick = () => { app.live = null; navigate('home'); };
  const am = m.querySelector('#gAutoMgr');
  if (am) am.onchange = () => { g.autoManage[side] = am.checked; toast(am.checked ? 'AI 코치가 투수 교체·작전을 맡습니다' : '직접 운영합니다 (투수 혹사 주의)'); };
  const sh = m.querySelector('#gShift');
  if (sh) sh.onchange = () => { const r = g.command(side, { type: 'shift', mode: sh.value }); toast(r.msg || '시프트 변경'); };
  m.querySelectorAll('[data-cmd]').forEach((b) => b.onclick = () => {
    const t = b.dataset.cmd;
    let cmd = { type: t };
    if (t === 'buntCancel') cmd = { type: 'bunt', cancel: true };
    if (t === 'ph') cmd.playerId = Number(m.querySelector('#gPH').value);
    if (t === 'pr') { cmd.base = Number(m.querySelector('#gPRbase').value); cmd.playerId = Number(m.querySelector('#gPR').value); }
    if (t === 'pitcher') cmd.playerId = Number(m.querySelector('#gPitcher').value);
    const r = g.command(side, cmd);
    toast(r.ok ? (r.msg || '작전 지시 — 다음 투구에 적용됩니다') : r.msg, r.ok ? 'info' : 'error');
    refresh();
  });
}

function lineupPanel() {
  const g = L().game;
  return [0, 1].map((s) => {
    const t = g.teams[s];
    const rows = g.lineups[s].map(({ player, pos }, i) => `<tr><td>${i + 1}</td><td>${esc(player.name)}</td><td>${POS_SHORT_KO[pos]}</td><td>${R(player.ratings.contact)}</td><td>${R(player.ratings.power)}</td><td>${R(player.ratings.speed)}</td></tr>`).join('');
    const pit = g.box.pitOrder[s].map(({ player }) => esc(player.name)).join(' → ');
    const bench = g.bench(s).map((p) => esc(p.name)).join(', ') || '없음';
    return `<div><h4>${esc(t.name)}</h4><table class="tbl compact"><tr><th>#</th><th>타자</th><th>위치</th><th>컨</th><th>파</th><th>주</th></tr>${rows}</table>
      <div class="subtle">투수: ${pit}</div><div class="subtle">벤치: ${bench}</div></div>`;
  }).join('');
}

export const gameView = {
  render(el) {
    root = el;
    const live = L();
    if (!live) { el.innerHTML = '<section class="card"><p>진행 중인 경기가 없습니다.</p><button data-nav="home">홈으로</button></section>'; return; }
    live.speed ??= 'normal';
    live.autoPause ??= true;
    el.innerHTML = `
      <div id="scoreboard" class="scoreboard"></div>
      <div class="situation">
        <div id="diamond" class="diamond"></div>
        <div id="bso" class="bso"></div>
        <div id="matchupNow" class="matchup-now"></div>
      </div>
      <div id="gControls" class="controls">
        <button class="primary step" id="gPitch" title="Space">1구</button>
        <button class="primary step" id="gPA" title="Enter">1타석</button>
        <button class="step" id="gInn">1이닝</button>
        <button class="step" id="gEnd">경기 끝까지</button>
        <span class="sep"></span>
        <button class="step" id="gAuto">▶ 자동 진행</button>
        <select id="gSpeed">${Object.entries({ slow: '느리게', normal: '보통', fast: '빠르게', turbo: '매우 빠르게' }).map(([k, v]) => `<option value="${k}" ${live.speed === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <label class="chk"><input type="checkbox" id="gPause" ${live.autoPause ? 'checked' : ''}> 승부처 자동 정지</label>
      </div>
      <div id="gManager"></div>
      <nav class="tabs">
        <button data-tab="feed">문자중계</button><button data-tab="box">박스스코어</button><button data-tab="lineup">라인업</button>
      </nav>
      <div id="feed" class="feed"></div>
      <div id="gBox" class="box" hidden></div>
      <div id="gLineup" class="lineups" hidden></div>`;
    feed = new Feed(el.querySelector('#feed'));
    feed.push(live.lines, { animate: false });
    if (!live.lines.length) advance((e) => e.t === 'halfStart');
    feed.scrollToEnd();

    const $ = (s) => el.querySelector(s);
    $('#gPitch').onclick = () => { stopAuto(); stepPitch(); };
    $('#gPA').onclick = () => { stopAuto(); stepPA(); };
    $('#gInn').onclick = () => { stopAuto(); stepInning(); };
    $('#gEnd').onclick = stepEnd;
    $('#gAuto').onclick = () => {
      if (timer) { stopAuto(); return; }
      $('#gAuto').textContent = '⏸ 일시정지';
      timer = setTimeout(autoLoop, 10);
    };
    $('#gSpeed').onchange = (e) => { live.speed = e.target.value; };
    $('#gPause').onchange = (e) => { live.autoPause = e.target.checked; };
    el.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => { tab = b.dataset.tab; showTab(); });
    showTab();
    refresh();
  },
  unmount() { stopAuto(); root = null; },
};

function showTab() {
  root.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  root.querySelector('#feed').hidden = tab !== 'feed';
  root.querySelector('#gBox').hidden = tab !== 'box';
  root.querySelector('#gLineup').hidden = tab !== 'lineup';
  refresh();
}

document.addEventListener('keydown', (ev) => {
  if (app.view !== 'game' || !L() || L().done || /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) return;
  if (ev.code === 'Space') { ev.preventDefault(); stopAuto(); stepPitch(); }
  if (ev.code === 'Enter') { ev.preventDefault(); stopAuto(); stepPA(); }
});
