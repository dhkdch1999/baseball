// 상단 스코어보드 + 상황판(주자 다이아몬드, 볼카운트, 현재 투수/타자) + 박스스코어
import { POS_SHORT_KO } from '../data/ratings.js';
import { fmtIP, fmtAvg, fmtERA } from '../core/util.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderScoreboard(el, game) {
  const box = game.box;
  const n = Math.max(9, box.team[0].line.length, box.team[1].line.length);
  const head = Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join('');
  const row = (s) => {
    const t = box.team[s];
    const team = game.teams[s];
    const cells = Array.from({ length: n }, (_, i) => {
      const v = t.line[i];
      const isCur = !game.over && game.inning === i + 1 && game.half === s;
      let txt = v ?? '';
      if (v === undefined && s === 1 && game.over && i === box.team[0].line.length - 1) txt = 'X';
      return `<td class="${isCur ? 'cur' : ''}">${txt}</td>`;
    }).join('');
    return `<tr><td class="team"><span class="chip" style="background:${team.color}"></span>${esc(team.short)}</td>${cells}
      <td class="tot R">${t.runs}</td><td>${t.hits}</td><td>${t.errors}</td><td>${t.bb}</td></tr>`;
  };
  el.innerHTML = `<table><thead><tr><th></th>${head}<th class="tot">R</th><th>H</th><th>E</th><th>B</th></tr></thead>
    <tbody>${row(0)}${row(1)}</tbody></table>`;
}

export function renderDiamond(el, bases) {
  const on = (i) => (bases[i] ? 'on' : '');
  const title = (i) => (bases[i] ? `<title>${i + 1}루: ${esc(bases[i])}</title>` : '');
  el.innerHTML = `<svg viewBox="0 0 92 70" aria-label="주자 상황">
    <rect class="base ${on(1)}" x="38" y="4" width="16" height="16" transform="rotate(45 46 12)">${title(1)}</rect>
    <rect class="base ${on(2)}" x="10" y="30" width="16" height="16" transform="rotate(45 18 38)">${title(2)}</rect>
    <rect class="base ${on(0)}" x="66" y="30" width="16" height="16" transform="rotate(45 74 38)">${title(0)}</rect>
    <polygon class="home" points="40,56 52,56 52,62 46,67 40,62" />
  </svg>`;
}

export function renderBSO(el, count, outs) {
  const dots = (cls, n, max) => Array.from({ length: max }, (_, i) => `<span class="dot ${cls} ${i < n ? 'on' : ''}"></span>`).join('');
  el.innerHTML = `<span>B</span><span class="dots">${dots('b', count[0], 3)}</span>
    <span>S</span><span class="dots">${dots('s', count[1], 2)}</span>
    <span>O</span><span class="dots">${dots('o', outs, 2)}</span>`;
}

export function renderMatchupNow(el, game, cur) {
  if (!cur.batter) { el.innerHTML = ''; return; }
  const def = cur.half === 0 ? 1 : 0;
  const bat = 1 - def;
  const bl = game.box.bat[bat].get(cur.batter.id);
  const pl = game.box.pit[def].get(cur.pitcher.id);
  const today = bl ? `${bl.ab}타수 ${bl.h}안타${bl.rbi ? ` ${bl.rbi}타점` : ''}${bl.bb ? ` ${bl.bb}볼넷` : ''}` : '';
  el.innerHTML = `
    <div><span class="lbl">투수</span><b>${esc(cur.pitcher.name)}</b>
      <span class="subtle">${esc(game.teams[def].short)} · ${pl ? `${fmtIP(pl.outs)}이닝 ${pl.np}구 ${pl.so}K` : ''}</span></div>
    <div><span class="lbl">타자</span><b>${cur.slot}번 ${esc(cur.batter.name)}</b>
      <span class="subtle">${esc(game.teams[bat].short)} · 오늘 ${today}</span></div>`;
}

export function renderBox(el, game) {
  const box = game.box;
  const parts = [];
  for (const s of [0, 1]) {
    const team = game.teams[s];
    const rows = box.batOrder[s].map(({ player, slot, pos }) => {
      const l = box.bat[s].get(player.id);
      return `<tr><td class="p">${slot}</td><td class="n">${esc(player.name)}</td><td class="p">${POS_SHORT_KO[pos] ?? pos}</td>
        <td>${l.pa}</td><td>${l.ab}</td><td>${l.r}</td><td>${l.h}</td><td>${l.d}</td><td>${l.t}</td><td>${l.hr}</td>
        <td>${l.rbi}</td><td>${l.bb}</td><td>${l.so}</td><td>${l.sb}</td><td>${l.ab ? fmtAvg(l.h / l.ab) : '-'}</td></tr>`;
    }).join('');
    const prow = box.pitOrder[s].map(({ player }) => {
      const l = box.pit[s].get(player.id);
      const dec = l.w ? '승' : l.l ? '패' : l.sv ? '세' : '';
      return `<tr><td class="n">${esc(player.name)}${dec ? `<span class="dec">${dec}</span>` : ''}</td>
        <td>${fmtIP(l.outs)}</td><td>${l.bf}</td><td>${l.np}</td><td>${l.h}</td><td>${l.hr}</td><td>${l.bb + l.hbp}</td>
        <td>${l.so}</td><td>${l.r}</td><td>${l.er}</td><td>${fmtERA(l.er, l.outs)}</td></tr>`;
    }).join('');
    parts.push(`<h4>${esc(team.name)}</h4>
      <div class="wrap"><table><thead><tr><th></th><th style="text-align:left">타자</th><th></th><th>타석</th><th>타수</th><th>득점</th><th>안타</th><th>2루타</th><th>3루타</th><th>홈런</th><th>타점</th><th>볼넷</th><th>삼진</th><th>도루</th><th>타율</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="wrap"><table><thead><tr><th style="text-align:left">투수</th><th>이닝</th><th>타자</th><th>투구수</th><th>피안타</th><th>피홈런</th><th>4사구</th><th>삼진</th><th>실점</th><th>자책</th><th>평균자책</th></tr></thead><tbody>${prow}</tbody></table></div>`);
  }
  el.innerHTML = parts.join('');
}
