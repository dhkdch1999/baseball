// 앱 상태 + 화면 전환 + 상단 헤더
import { myTeam, currentDate, attachLeague } from '../league/season.js';
import { computeStandings } from '../league/standings.js';
import { fmtDate } from '../league/schedule.js';
import { STEP_KO } from '../league/offseason.js';
import { ROUND_KO } from '../league/postseason.js';
import { saveToSlot } from '../save/storage.js';
import { esc, teamChip, toast } from './common.js';
import { openPlayer } from './views/player.js';

export const app = {
  lg: null,
  slot: null,
  live: null, // 진행 중인 내 경기 { game, meta, ... }
  view: 'start',
  params: {},
  views: {},
  autosave: true,
};

const NAV = [
  ['home', '홈'], ['game', '중계'], ['roster', '로스터'], ['standings', '순위'], ['schedule', '일정'],
  ['leaders', '기록'], ['trade', '트레이드'], ['fa', 'FA'], ['offseason', '오프시즌'], ['saves', '저장'],
];

export function registerView(name, mod) { app.views[name] = mod; }

export function navigate(view, params = {}) {
  if (app.views[app.view]?.unmount) app.views[app.view].unmount();
  app.view = view;
  app.params = params;
  render();
  window.scrollTo(0, 0);
}

export function render() {
  renderHeader();
  const el = document.getElementById('view');
  const v = app.views[app.view];
  if (!v) { el.innerHTML = '<p>화면을 찾을 수 없습니다</p>'; return; }
  v.render(el, app.params);
}

export function renderHeader() {
  const lg = app.lg;
  const info = document.getElementById('hdrInfo');
  const nav = document.getElementById('nav');
  if (!lg) { info.innerHTML = ''; nav.innerHTML = ''; nav.hidden = true; return; }
  nav.hidden = false;
  const t = myTeam(lg);
  let status = '';
  if (lg.phase === 'regular') {
    const row = computeStandings(lg).find((r) => r.team.id === t.id);
    status = `${fmtDate(currentDate(lg))} · ${row.w}승 ${row.l}패${row.t ? ` ${row.t}무` : ''} · ${row.rank}위`;
  } else if (lg.phase === 'postseason') {
    status = `포스트시즌 · ${ROUND_KO[lg.postseason.round]}`;
  } else {
    status = `오프시즌 · ${STEP_KO[lg.offseason?.step] || ''}`;
  }
  info.innerHTML = `${teamChip(t)}<b>${esc(t.name)}</b> <span>${lg.season} 시즌</span> <span class="hdr-status">${status}</span>`;
  nav.innerHTML = NAV.filter(([k]) => k !== 'game' || app.live)
    .filter(([k]) => k !== 'offseason' || lg.phase === 'offseason')
    .map(([k, label]) => `<button data-nav="${k}" class="${app.view === k ? 'active' : ''}">${label}${k === 'game' ? ' ●' : ''}</button>`).join('');
}

export function setLeague(lg, slot = null) {
  app.lg = lg;
  app.slot = slot;
  app.live = null;
  attachLeague(lg);
}

export function persist(silent = true) {
  if (!app.autosave || !app.slot || !app.lg) return;
  const r = saveToSlot(app.lg, app.slot);
  if (!r.ok) toast(r.msg, 'error');
  else if (!silent) toast(r.msg);
}

// 전역 클릭 위임: 화면 이동, 선수 상세
document.addEventListener('click', (ev) => {
  const nav = ev.target.closest('[data-nav]');
  if (nav) { ev.preventDefault(); navigate(nav.dataset.nav, nav.dataset.params ? JSON.parse(nav.dataset.params) : {}); return; }
  const pl = ev.target.closest('[data-player]');
  if (pl && app.lg) { ev.preventDefault(); openPlayer(app.lg, Number(pl.dataset.player)); }
});
