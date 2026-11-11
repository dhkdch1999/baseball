// 홈(대시보드): 오늘 경기, 진행 버튼, 순위 요약, 최근 결과, 소식, 부상자
import { app, navigate, persist, render } from '../app.js';
import { myTeam, myGameToday, teamById, todayGames, prepareGame, currentDate } from '../../league/season.js';
import { advanceDay, advanceUntil } from '../../league/career.js';
import { computeStandings } from '../../league/standings.js';
import { chooseStarter } from '../../sim/aiManager.js';
import { ROUND_KO, currentSeries } from '../../league/postseason.js';
import { fmtDate } from '../../league/schedule.js';
import { Narrator } from '../broadcast/narrator.js';
import { esc, teamChip, pLink, statusBadges, toast, R } from '../common.js';
import { overall } from '../../data/playerGen.js';

export function startLiveGame() {
  const lg = app.lg;
  const meta = myGameToday(lg);
  if (!meta || meta.result) return;
  const { game, msgs } = prepareGame(lg, meta, { verbose: true });
  const mySide = meta.away === lg.myTeamId ? 0 : 1;
  app.live = { game, meta, it: game.run(), narrator: new Narrator(game.seed), mySide, lines: [], msgs, done: false };
  for (const m of msgs) toast(m);
  navigate('game');
}

function busy(fn) {
  document.body.classList.add('busy');
  setTimeout(() => {
    try { fn(); } finally {
      document.body.classList.remove('busy');
      persist();
      render();
    }
  }, 30);
}

function lineScore(lg, g) {
  const A = teamById(lg, g.away), H = teamById(lg, g.home);
  const n = Math.max(9, g.line[0].line.length);
  const cells = (i) => Array.from({ length: n }, (_, k) => `<td>${g.line[i].line[k] ?? (i === 1 && k === g.line[0].line.length - 1 ? 'X' : '')}</td>`).join('');
  return `<div class="mini-score"><table>
    <tr><th></th>${Array.from({ length: n }, (_, k) => `<th>${k + 1}</th>`).join('')}<th>R</th><th>H</th><th>E</th></tr>
    <tr><td class="t">${teamChip(A)}${esc(A.short)}</td>${cells(0)}<td class="R">${g.line[0].r}</td><td>${g.line[0].h}</td><td>${g.line[0].e}</td></tr>
    <tr><td class="t">${teamChip(H)}${esc(H.short)}</td>${cells(1)}<td class="R">${g.line[1].r}</td><td>${g.line[1].h}</td><td>${g.line[1].e}</td></tr>
  </table></div>
  <div class="subtle">${g.W ? `승 ${esc(g.W)} · 패 ${esc(g.L)}${g.S ? ` · 세 ${esc(g.S)}` : ''}` : '무승부'}${g.innings > 9 ? ` · 연장 ${g.innings}회` : ''}${g.walkoff ? ' · 끝내기' : ''}</div>`;
}

function todayCard(lg) {
  const t = myTeam(lg);
  const meta = myGameToday(lg);
  if (app.live && !app.live.done) {
    return `<section class="card today"><h2>경기 진행 중</h2><button class="primary" data-nav="game">중계 화면으로 돌아가기</button></section>`;
  }
  if (lg.phase === 'postseason') return postseasonCard(lg, meta);
  if (!meta) return `<section class="card today"><h2>오늘은 경기가 없습니다</h2><div class="row"><button class="primary" id="hDay">하루 진행</button></div></section>`;
  const opp = teamById(lg, meta.away === t.id ? meta.home : meta.away);
  const home = meta.home === t.id;
  const st = computeStandings(lg);
  const rec = (id) => { const r = st.find((x) => x.team.id === id); return `${r.w}승 ${r.l}패 (${r.rank}위)`; };
  const sp = (team) => { const s = chooseStarter(team, team.rotationIndex || 0).player; return `${pLink(s)} ${R(overall(s))}`; };
  return `<section class="card today">
    <div class="today-head"><h2>${fmtDate(currentDate(lg))} 오늘의 경기</h2><span class="subtle">${lg.day + 1} / ${lg.schedule.length}경기</span></div>
    <div class="matchup-card">
      <div class="side">${teamChip(t)}<b>${esc(t.short)}</b><div class="subtle">${rec(t.id)}</div><div>선발 ${sp(t)}</div></div>
      <div class="vs">${home ? '홈' : '원정'}<br>vs</div>
      <div class="side">${teamChip(opp)}<b>${esc(opp.short)}</b><div class="subtle">${rec(opp.id)}</div><div>선발 ${sp(opp)}</div></div>
    </div>
    <div class="row">
      <button class="primary" id="hLive">경기 시작 (문자중계)</button>
      <button id="hDay">결과만 보고 하루 진행</button>
      <button data-nav="roster">라인업 확인</button>
    </div>
    <div class="row sim-row">
      <span class="subtle">빠른 진행:</span>
      <button id="hWeek">1주일</button><button id="hMonth">한 달</button><button id="hSeason">정규시즌 끝까지</button>
    </div>
  </section>`;
}

function postseasonCard(lg, meta) {
  const ps = lg.postseason;
  const s = currentSeries(ps);
  const H = teamById(lg, s.high), L = teamById(lg, s.low);
  const g = todayGames(lg)[0];
  const mine = !!meta;
  const games = s.games.map((x, i) => `${i + 1}차전 ${teamById(lg, x.away).short} ${x.score[0]}:${x.score[1]} ${teamById(lg, x.home).short}`).join(' · ');
  return `<section class="card today">
    <h2>${ROUND_KO[s.round]} ${g ? `${g.gameNo}차전` : ''}</h2>
    <div class="series"><span>${teamChip(H)}${esc(H.name)} <b>${s.wins[0]}</b></span> : <span><b>${s.wins[1]}</b> ${esc(L.name)}${teamChip(L)}</span>
    <span class="subtle">(${s.need}승 선승${s.round === 'WC' ? ', 4위 1승 어드밴티지' : ''})</span></div>
    <div class="subtle">${games}</div>
    <div class="row">
      ${mine ? '<button class="primary" id="hLive">경기 시작 (문자중계)</button><button id="hDay">결과만 보기</button>' : '<button class="primary" id="hDay">다음 경기 진행</button>'}
      <button id="hPost">포스트시즌 끝까지</button>
    </div>
  </section>`;
}

export const homeView = {
  render(el) {
    const lg = app.lg;
    if (lg.phase === 'offseason') {
      el.innerHTML = `<section class="card today"><h2>${lg.season} 시즌 종료 — 오프시즌</h2>
        <p>시즌 결산, FA 시장, 신인 드래프트를 거쳐 다음 시즌을 준비하세요.</p>
        <button class="primary" data-nav="offseason">오프시즌 진행</button></section>${newsCard(lg)}`;
      return;
    }
    const t = myTeam(lg);
    const st = computeStandings(lg);
    const injured = [...t.roster, ...t.reserve].filter((p) => p.injury);
    el.innerHTML = `
      ${todayCard(lg)}
      <div class="grid2">
        <section class="card">
          <h3>최근 경기</h3>
          ${lg.lastGame ? lineScore(lg, lg.lastGame) : '<p class="subtle">아직 경기가 없습니다.</p>'}
          ${recentForm(lg)}
        </section>
        <section class="card">
          <h3>순위 <a href="#" data-nav="standings" class="more">전체 보기</a></h3>
          <table class="tbl compact">${st.map((r) => `<tr class="${r.team.id === t.id ? 'me' : ''}"><td>${r.rank}</td><td>${teamChip(r.team)}${esc(r.team.short)}</td><td>${r.w}-${r.l}-${r.t}</td><td>${r.pct.toFixed(3).replace(/^0/, '')}</td><td>${r.gb === 0 ? '-' : r.gb}</td><td>${r.streak}</td></tr>`).join('')}</table>
        </section>
      </div>
      <div class="grid2">
        ${newsCard(lg)}
        <section class="card"><h3>부상자 명단</h3>${injured.length ? injured.map((p) => `<div>${pLink(p)} ${statusBadges(p)} <span class="subtle">${esc(p.injury.type)}</span></div>`).join('') : '<p class="subtle">부상자 없음</p>'}</section>
      </div>`;
    const on = (id, fn) => { const b = el.querySelector(id); if (b) b.onclick = fn; };
    on('#hLive', startLiveGame);
    on('#hDay', () => busy(() => advanceDay(lg)));
    on('#hWeek', () => busy(() => advanceUntil(lg, 'week')));
    on('#hMonth', () => busy(() => advanceUntil(lg, 'month')));
    on('#hSeason', () => busy(() => advanceUntil(lg, 'season')));
    on('#hPost', () => busy(() => advanceUntil(lg, 'postseason')));
  },
};

function recentForm(lg) {
  const id = lg.myTeamId;
  const games = [];
  for (let i = Math.min(lg.day, lg.schedule.length) - 1; i >= 0 && games.length < 10; i--) {
    const g = lg.schedule[i].games.find((x) => x.away === id || x.home === id);
    if (g?.result) games.push(g);
  }
  if (!games.length) return '';
  return `<div class="form">${games.reverse().map((g) => {
    const r = g.result;
    const res = r.winner == null ? 'T' : r.winner === id ? 'W' : 'L';
    const opp = teamById(lg, g.away === id ? g.home : g.away).short;
    const my = g.away === id ? r.score[0] : r.score[1], ot = g.away === id ? r.score[1] : r.score[0];
    return `<span class="f ${res}" title="${esc(opp)} ${my}:${ot}">${res === 'W' ? '승' : res === 'L' ? '패' : '무'}</span>`;
  }).join('')}</div>`;
}

function newsCard(lg) {
  const items = lg.news.slice(0, 25);
  return `<section class="card news"><h3>소식</h3>${items.map((n) => `<div class="news-item ${n.team === lg.myTeamId ? 'mine' : ''}"><span class="subtle">${n.date ? fmtDate(n.date).replace(/ \(.\)/, '') : ''}</span> ${esc(n.text)}</div>`).join('') || '<p class="subtle">소식 없음</p>'}</section>`;
}
