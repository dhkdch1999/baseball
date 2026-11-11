// 타석 카드형 문자중계: 이벤트를 [반이닝 → 타석 카드(투구 목록 + 결과)] 구조로 쌓고 그린다
import { homeWinProb } from '../../sim/winprob.js';
import { POS_KO } from '../../data/ratings.js';
import { seasonKey, avg } from '../../league/stats.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const PITCH_WORD = {
  ball: '볼', calledStrike: '스트라이크', swingStrike: '헛스윙', foul: '파울', inPlay: '타격',
  hbp: '몸에 맞는 볼', buntFoul: '번트 파울', buntInPlay: '번트',
};
export const PITCH_CLASS = {
  ball: 'b', calledStrike: 's', swingStrike: 's', foul: 's', buntFoul: 's', inPlay: 'x', buntInPlay: 'x', hbp: 'h',
};

const wpOf = (snap, maxInnings) => homeWinProb({ ...snap, maxInnings });

export class PbpLog {
  /** @param narrator Narrator, game Game, season 시즌(타율 표시용) */
  constructor(narrator, game, season) {
    this.n = narrator;
    this.game = game;
    this.season = season;
    this.halves = [];
    this.half = null;
    this.pa = null;
    this.intro = [];
    this.final = null;
    this.lastPitch = null;
    this.wp = 0.5;
  }

  push(e) {
    const g = this.game;
    switch (e.t) {
      case 'gameStart':
        this.intro = this.n.lines(e).map((l) => l.text);
        if (e.snap) this.wp = wpOf(e.snap, g.maxInnings);
        break;
      case 'halfStart':
        this.half = { inning: e.inning, half: e.half, team: e.team, items: [], runs: 0, lob: 0, done: false };
        this.halves.push(this.half);
        this.pa = null;
        break;
      case 'pa': {
        const st = e.batter.stats?.[seasonKey(this.season)]?.bat;
        this.pa = {
          type: 'pa', batter: e.batter, slot: e.slot, pos: e.pos, pitcher: e.pitcher, side: e.snap?.half ?? g.half,
          seasonAvg: st && st.ab ? avg(st) : null, pitches: [], notes: [], result: null,
          wpBefore: this.wp, wpAfter: null,
        };
        this.half.items.push(this.pa);
        this.lastPitch = null;
        break;
      }
      case 'pitch': {
        if (!this.pa) break;
        const p = e.pitch;
        let word = PITCH_WORD[p.result] || p.result;
        if (e.tactic === 'bunt' && p.result === 'swingStrike') word = '번트 헛스윙';
        const rec = { n: e.n, word, cls: PITCH_CLASS[p.result] || 's', ko: p.ko, kmh: p.kmh, count: e.count, loc: p.loc, tactic: e.tactic };
        this.pa.pitches.push(rec);
        this.lastPitch = rec;
        break;
      }
      case 'steal': case 'wildPitch': case 'tactic': {
        const lines = this.n.lines(e);
        if (!lines.length) break;
        const note = { text: lines[0].text, cls: lines[0].cls, afterPitch: this.pa?.pitches.length || 0 };
        if (this.pa && !this.pa.result) this.pa.notes.push(note);
        else this.half?.items.push({ type: 'note', ...note });
        if (e.t === 'wildPitch' && e.runs?.length && this.half) this.half.runs += e.runs.length;
        if (e.snap) this.wp = wpOf(e.snap, g.maxInnings);
        break;
      }
      case 'sub': case 'pitchingChange': {
        const l = this.n.lines(e)[0];
        if (l) this.half?.items.push({ type: 'note', text: l.text, meta: l.meta, cls: 'change' });
        break;
      }
      case 'result': {
        if (!this.pa) break;
        const phrase = this.n.resultPhrase(e);
        const moves = this.n.movesText(e.moves);
        const after = e.snap ? wpOf(e.snap, g.maxInnings) : this.wp;
        this.pa.result = {
          kind: e.kind, phrase, moves, runs: e.runs.length, score: e.snap?.score, outs: e.snap?.outs,
          walkoff: e.walkoff, hr: e.kind === 'HR', hit: ['1B', '2B', '3B', 'HR'].includes(e.kind), rbi: e.rbi,
        };
        this.pa.wpAfter = e.walkoff ? 1 : after;
        this.wp = this.pa.wpAfter;
        this.half.runs += e.runs.length;
        break;
      }
      case 'halfEnd':
        if (this.half) { this.half.done = true; this.half.lob = e.lob; }
        break;
      case 'gameEnd':
        this.final = this.n.lines(e).map((l) => l.text);
        this.wp = e.winner == null ? 0.5 : e.winner === 1 ? 1 : 0;
        break;
    }
  }

  /** 현재 진행 중인 이닝 번호 */
  currentInning() {
    return this.half?.inning || 1;
  }
}

/** 오늘 경기 기록 한 줄 */
function todayLine(game, side, player) {
  const l = game.box.bat[side].get(player.id);
  if (!l) return '';
  const parts = [['타석', l.pa], ['타수', l.ab], ['안타', l.h], ['득점', l.r], ['타점', l.rbi], ['홈런', l.hr], ['볼넷', l.bb], ['삼진', l.so]];
  return parts.map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('');
}

function wpText(pa, mySide, teams) {
  if (pa.wpAfter == null) return '';
  const mine = mySide === 1 ? pa.wpAfter : 1 - pa.wpAfter;
  const before = mySide === 1 ? pa.wpBefore : 1 - pa.wpBefore;
  const d = (mine - before) * 100;
  const sign = d > 0.05 ? 'up' : d < -0.05 ? 'down' : '';
  return `<div class="wp">${esc(teams[mySide].short)} 승리 확률 <b>${(mine * 100).toFixed(1)}%</b> <span class="${sign}">(${d >= 0 ? '+' : ''}${d.toFixed(1)}%p)</span></div>`;
}

function paCard(pa, ctx) {
  const { game, mySide } = ctx;
  const team = game.teams[pa.side];
  const r = pa.result;
  const live = !r;
  const pitches = pa.pitches.slice().reverse().map((p) => {
    const notes = pa.notes.filter((x) => x.afterPitch === p.n).map((x) => `<li class="pnote ${x.cls || ''}">${esc(x.text)}</li>`).join('');
    return `${notes}<li><span class="pn ${p.cls}">${p.n}</span><span class="pw">${esc(p.word)}</span><span class="pm">${p.kmh}km/h ${esc(p.ko)}</span><span class="pc">${p.count[0]}-${p.count[1]}</span></li>`;
  }).join('');
  const pre = pa.notes.filter((x) => x.afterPitch === 0).map((x) => `<li class="pnote ${x.cls || ''}">${esc(x.text)}</li>`).join('');
  let resCls = '';
  if (r?.hr) resCls = 'hr';
  else if (r?.runs) resCls = 'scored';
  else if (r?.hit) resCls = 'hit';
  else if (r?.kind === 'K') resCls = 'k';
  const head = r
    ? `<div class="res ${resCls}">${esc(pa.batter.name)} : ${esc(r.phrase)}${r.moves ? `<div class="moves">${esc(r.moves)}</div>` : ''}${r.runs ? `<span class="sc">${r.score[0]} : ${r.score[1]}</span>` : ''}</div>`
    : `<div class="res live">타석 진행 중<span class="blink">●</span></div>`;
  return `<article class="pa-card ${live ? 'live' : ''} ${r?.walkoff ? 'walkoff' : ''}">
    <header>
      <div class="avatar" style="--tc:${team.color}">${pa.slot}</div>
      <div class="who"><div class="nm"><b>${esc(pa.batter.name)}</b> <span>${pa.slot}번타자 · ${POS_KO[pa.pos] || ''}${pa.seasonAvg != null ? ` · 타율 ${pa.seasonAvg.toFixed(3)}` : ''}</span></div>
        <div class="today">${todayLine(game, pa.side, pa.batter)}</div></div>
    </header>
    <div class="body">
      ${head}
      ${r?.walkoff ? '<div class="wo">끝내기!</div>' : ''}
      ${wpText(pa, mySide, game.teams)}
      <ol class="pitches">${pitches}${pre}</ol>
    </div>
  </article>`;
}

function halfBlock(h, ctx) {
  const title = `${h.inning}회${h.half === 0 ? '초' : '말'} ${esc(h.team.short)} 공격`;
  const items = h.items.slice().reverse().map((it) => (it.type === 'pa' ? paCard(it, ctx)
    : `<div class="pbp-note ${it.cls || ''}">${esc(it.text)}${it.meta ? ` <span class="subtle">${esc(it.meta)}</span>` : ''}</div>`)).join('');
  const sum = h.done ? `<div class="half-sum">${h.inning}회${h.half === 0 ? '초' : '말'} 종료 · ${h.runs}득점${h.lob ? ` · 잔루 ${h.lob}` : ''}</div>` : '';
  return `<section class="half-block"><h3>${title}</h3>${sum}${items}</section>`;
}

/**
 * @param tab 'score' | 이닝 번호
 */
export function renderPbp(el, log, tab, ctx) {
  let html = '';
  if (log.final) html += `<div class="pbp-final">${log.final.map(esc).join('<br>')}</div>`;
  if (tab === 'score') {
    const cards = [];
    for (const h of log.halves) for (const it of h.items) if (it.type === 'pa' && it.result?.runs) cards.push({ h, it });
    html += cards.reverse().map(({ h, it }) => `<div class="score-tag">${h.inning}회${h.half === 0 ? '초' : '말'}</div>${paCard(it, ctx)}`).join('')
      || '<p class="subtle pad">아직 득점이 없습니다.</p>';
  } else {
    const halves = log.halves.filter((h) => h.inning === tab).reverse();
    html += halves.map((h) => halfBlock(h, ctx)).join('') || '<p class="subtle pad">아직 진행되지 않은 이닝입니다.</p>';
    if (tab === 1 && log.intro.length) html += `<div class="pbp-intro">${log.intro.map(esc).join('<br>')}</div>`;
  }
  el.innerHTML = html;
}

/** 이닝 탭 버튼 */
export function renderInningTabs(el, log, tab) {
  const n = Math.max(9, log.currentInning());
  const hasScore = log.halves.some((h) => h.runs > 0);
  const btn = (k, label, extra = '') => `<button data-inn="${k}" class="${tab === k ? 'active' : ''} ${extra}">${label}</button>`;
  el.innerHTML = btn('score', `득점${hasScore ? '<i class="dot"></i>' : ''}`)
    + Array.from({ length: n }, (_, i) => btn(i + 1, `${i + 1}회`, i + 1 > log.currentInning() ? 'future' : '')).join('');
}
