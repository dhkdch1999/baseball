// 부트스트랩: 리그 생성 → 경기 선택 → 문자중계 진행
import { generateLeague } from './data/teamGen.js';
import { Game } from './sim/game.js';
import { Narrator } from './ui/broadcast/narrator.js';
import { Feed } from './ui/broadcast/feed.js';
import { renderScoreboard, renderDiamond, renderBSO, renderMatchupNow, renderBox } from './ui/scoreboard.js';
import { fillTeamSelects, renderLineups, pickStarters } from './ui/pregame.js';

const $ = (id) => document.getElementById(id);

const state = {
  league: null,
  game: null,
  it: null,
  narrator: null,
  feed: new Feed($('feed')),
  cur: { batter: null, pitcher: null, slot: 0, half: 0 },
  lastSnap: null,
  done: false,
};

function randomSeed() {
  return String(Math.floor(Math.random() * 1e6));
}

function loadLeague() {
  state.league = generateLeague($('leagueSeed').value.trim() || 'kbo-1');
  fillTeamSelects($('awaySel'), $('homeSel'), state.league);
  refreshPreview();
}

function teams() {
  const t = (id) => state.league.teams.find((x) => x.id === id);
  return [t($('awaySel').value), t($('homeSel').value)];
}

function refreshPreview() {
  const [away, home] = teams();
  const same = away.id === home.id;
  $('btnStart').disabled = same;
  if (same) { $('lineupPreview').innerHTML = '<p class="subtle">서로 다른 두 팀을 선택하세요.</p>'; return; }
  renderLineups($('lineupPreview'), away, home, pickStarters(away, home, $('gameSeed').value));
}

function startGame() {
  const [away, home] = teams();
  const seed = $('gameSeed').value.trim() || randomSeed();
  // 같은 리그 시드 + 경기 시드 → 같은 경기
  state.league = generateLeague($('leagueSeed').value.trim() || 'kbo-1');
  const A = state.league.teams.find((t) => t.id === away.id);
  const H = state.league.teams.find((t) => t.id === home.id);
  state.game = new Game({ away: A, home: H, seed, verbose: true, starters: pickStarters(A, H, seed) });
  state.it = state.game.run();
  state.narrator = new Narrator(seed);
  state.cur = { batter: null, pitcher: null, slot: 0, half: 0 };
  state.done = false;
  state.lastSnap = null;
  state.feed.clear();
  $('pregame').hidden = true;
  $('game').hidden = false;
  showTab('feed');
  setButtons();
  advance((e) => e.t === 'halfStart'); // 경기 시작 안내 + 1회초 헤더까지
}

/** 이벤트를 소비하다가 stop(e, lines)가 true면 멈춤 */
function advance(stop, { animate = true } = {}) {
  const buffer = [];
  for (;;) {
    const { value: e, done } = state.it.next();
    if (done) { state.done = true; break; }
    const lines = state.narrator.lines(e);
    buffer.push(...lines);
    track(e);
    if (e.t === 'gameEnd') { state.done = true; break; }
    if (stop(e, lines)) break;
  }
  state.feed.push(buffer, { animate: animate && buffer.length < 40 });
  render();
  state.feed.scrollToEnd();
  setButtons();
}

function track(e) {
  if (e.snap) state.lastSnap = e.snap;
  if (e.t === 'pa') state.cur = { batter: e.batter, pitcher: e.pitcher, slot: e.slot, half: e.snap.half };
  if (e.t === 'pitchingChange') state.cur.pitcher = e.in;
  if (e.t === 'result' || e.t === 'halfEnd') state.countReset = true;
  if (e.t === 'pitch' || e.t === 'pa') state.countReset = false;
}

function render() {
  const g = state.game;
  const snap = state.lastSnap;
  renderScoreboard($('scoreboard'), g);
  if (snap) {
    const halfOver = snap.outs >= 3 || state.done;
    renderDiamond($('diamond'), halfOver ? [null, null, null] : snap.bases);
    renderBSO($('bso'), state.countReset ? [0, 0] : snap.count, Math.min(snap.outs, 2) + (snap.outs >= 3 ? 1 : 0));
  }
  renderMatchupNow($('matchupNow'), g, state.cur);
  if (!$('box').hidden) renderBox($('box'), g);
}

function setButtons() {
  for (const id of ['btnPitch', 'btnPA', 'btnEnd']) $(id).disabled = state.done;
}

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('feed').hidden = name !== 'feed';
  $('box').hidden = name !== 'box';
  if (name === 'box' && state.game) renderBox($('box'), state.game);
}

// ── 진행 단위 ──
const stepPitch = () => advance((e, lines) => (e.t === 'pitch' && lines.length > 0) || e.t === 'result' || e.t === 'halfEnd');
const stepPA = () => advance((e) => e.t === 'result' || e.t === 'halfEnd');
const stepEnd = () => advance(() => false, { animate: false });

// ── 이벤트 연결 ──
$('btnNewLeague').addEventListener('click', loadLeague);
$('leagueSeed').addEventListener('change', loadLeague);
$('awaySel').addEventListener('change', refreshPreview);
$('homeSel').addEventListener('change', refreshPreview);
$('gameSeed').addEventListener('change', refreshPreview);
$('btnDice').addEventListener('click', () => { $('gameSeed').value = randomSeed(); refreshPreview(); });
$('btnStart').addEventListener('click', startGame);
$('btnPitch').addEventListener('click', stepPitch);
$('btnPA').addEventListener('click', stepPA);
$('btnEnd').addEventListener('click', stepEnd);
$('btnBack').addEventListener('click', () => { $('game').hidden = true; $('pregame').hidden = false; refreshPreview(); });
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.addEventListener('keydown', (ev) => {
  if ($('game').hidden || state.done || ev.target.tagName === 'INPUT') return;
  if (ev.code === 'Space') { ev.preventDefault(); stepPitch(); }
  if (ev.code === 'Enter') { ev.preventDefault(); stepPA(); }
});

$('gameSeed').value = randomSeed();
loadLeague();
