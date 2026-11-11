#!/usr/bin/env node
// 시드 하나로 경기를 재현해서 문자중계를 터미널에 출력 (디버깅용)
//
//   node tools/replay.mjs                          # 기본: LG vs 두산, 시드 1
//   node tools/replay.mjs --away KT --home SS --seed 42
//   node tools/replay.mjs --league myleague --seed 7 --check   # 같은 시드 2회 실행 비교
import { generateLeague } from '../js/data/teamGen.js';
import { Game } from '../js/sim/game.js';
import { Narrator } from '../js/ui/broadcast/narrator.js';
import { fmtAvg, fmtIP } from '../js/core/util.js';

const a = process.argv.slice(2);
const get = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
const leagueSeed = get('league', 'kbo-1');
const seed = get('seed', '1');
const awayId = get('away', 'LG');
const homeId = get('home', 'OB');

function play() {
  const lg = generateLeague(leagueSeed);
  const away = lg.teams.find((t) => t.id === awayId);
  const home = lg.teams.find((t) => t.id === homeId);
  if (!away || !home) throw new Error(`팀 id 확인: ${lg.teams.map((t) => t.id).join(', ')}`);
  const game = new Game({ away, home, seed, verbose: true });
  const nar = new Narrator(seed);
  const out = [];
  for (const e of game.run()) for (const l of nar.lines(e)) out.push(l);
  return { game, out };
}

if (a.includes('--check')) {
  const r1 = play(), r2 = play();
  const t1 = r1.out.map((l) => l.text).join('\n');
  const t2 = r2.out.map((l) => l.text).join('\n');
  const same = t1 === t2;
  console.log(same ? `✓ 재현성 OK — 같은 시드에서 ${r1.out.length}줄 중계가 완전히 일치` : '✗ 재현성 실패: 같은 시드인데 결과가 다름');
  process.exit(same ? 0 : 1);
}

const { game, out } = play();
const C = { inning: '\x1b[1;36m', homerun: '\x1b[1;35m', scored: '\x1b[1;33m', walkoff: '\x1b[1;31m', final: '\x1b[1;32m', change: '\x1b[34m', dim: '\x1b[2m', rst: '\x1b[0m' };
for (const l of out) {
  const key = Object.keys(C).find((k) => l.cls.split(' ').includes(k));
  const indent = ['pitch', 'result', 'steal', 'wp', 'outs'].some((k) => l.cls.startsWith(k)) ? '  ' : '';
  console.log(`${indent}${key ? C[key] : ''}${l.text}${C.rst}${l.meta ? ` ${C.dim}${l.meta}${C.rst}` : ''}`);
}

// 라인스코어 + 박스스코어
const box = game.box;
const n = Math.max(9, box.team[0].line.length);
const pad = (s, w) => String(s).padStart(w);
console.log('\n' + ' '.repeat(6) + Array.from({ length: n }, (_, i) => pad(i + 1, 3)).join('') + '    R  H  E  B');
for (const s of [0, 1]) {
  const t = box.team[s];
  const cells = Array.from({ length: n }, (_, i) => pad(t.line[i] ?? (i < t.line.length ? 0 : '-'), 3)).join('');
  console.log(game.teams[s].short.padEnd(6) + cells + '  ' + [t.runs, t.hits, t.errors, t.bb].map((x) => pad(x, 3)).join(''));
}
for (const s of [0, 1]) {
  console.log(`\n${game.teams[s].name} 타자          타수 안타 타점 득점 볼넷 삼진`);
  for (const { player } of box.batOrder[s]) {
    const l = box.bat[s].get(player.id);
    console.log(`  ${player.name.padEnd(6)}${pad(l.ab, 12)}${pad(l.h, 5)}${pad(l.rbi, 5)}${pad(l.r, 5)}${pad(l.bb, 5)}${pad(l.so, 5)}   ${l.ab ? fmtAvg(l.h / l.ab) : ''}`);
  }
  console.log(`  투수             이닝  피안타 실점 자책 볼넷 삼진 투구수`);
  for (const { player } of box.pitOrder[s]) {
    const l = box.pit[s].get(player.id);
    const dec = l.w ? '승' : l.l ? '패' : l.sv ? '세' : '';
    console.log(`  ${player.name.padEnd(6)}${dec.padStart(3)}${pad(fmtIP(l.outs), 10)}${pad(l.h, 6)}${pad(l.r, 5)}${pad(l.er, 5)}${pad(l.bb, 5)}${pad(l.so, 5)}${pad(l.np, 6)}`);
  }
}
