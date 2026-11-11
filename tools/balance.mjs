#!/usr/bin/env node
// 밸런스 테스트: 시즌 N번 시뮬레이션 → 리그 평균 지표가 목표 범위인지 확인
//
//   node tools/balance.mjs                    # 기본 1000시즌 (멀티코어)
//   node tools/balance.mjs --seasons 50       # 빠른 확인
//   node tools/balance.mjs --seasons 200 --seed 7 --workers 4
//
// 1단계에는 일정 모듈이 없으므로 "시즌 = 팀당 144경기(상대별 16경기, 홈/원정 8경기씩)".
// 시즌마다 새 리그(선수)를 생성해서 특정 로스터에 치우치지 않게 한다.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const TARGETS = {
  AVG: [0.260, 0.270],
  'R/G': [4.0, 5.0],
};
// 참고용 범위 (KBO 최근 시즌 수준). 벗어나면 노란색 경고만.
const SOFT = {
  OBP: [0.330, 0.355],
  SLG: [0.380, 0.420],
  'K%': [0.17, 0.22],
  'BB%': [0.08, 0.105],
  'HR/G': [0.70, 1.05],
  BABIP: [0.295, 0.320],
  'P/PA': [3.75, 4.0],
  'SB/G': [0.5, 1.1],
  'E/G': [0.45, 0.75],
};

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
  return {
    seasons: parseInt(get('seasons', '1000'), 10),
    seed: get('seed', 'balance'),
    workers: parseInt(get('workers', String(Math.max(1, os.cpus().length))), 10),
  };
}

const KEYS = ['g', 'r', 'pa', 'ab', 'h', 'd', 't', 'hr', 'bb', 'hbp', 'so', 'sf', 'sb', 'cs', 'gidp', 'np', 'e', 'extra', 'ties', 'er', 'outs'];
const zero = () => Object.fromEntries(KEYS.map((k) => [k, 0]));

async function simSeason(seasonIdx, baseSeed) {
  const { generateLeague } = await import('../js/data/teamGen.js');
  const { Game } = await import('../js/sim/game.js');
  const lg = generateLeague(`${baseSeed}-S${seasonIdx}`);
  const T = lg.teams;
  const acc = zero();
  const rot = new Array(T.length).fill(0);
  let gid = 0;
  for (let rep = 0; rep < 8; rep++) {
    for (let i = 0; i < T.length; i++) {
      for (let j = 0; j < T.length; j++) {
        if (i === j) continue;
        const g = new Game({ away: T[i], home: T[j], seed: `${baseSeed}-S${seasonIdx}-G${gid++}`, verbose: false, rotationIndex: [rot[i]++, rot[j]++] });
        const res = g.simulate();
        acc.g++;
        if (res.innings > 9) acc.extra++;
        if (res.winner == null) acc.ties++;
        for (const s of [0, 1]) {
          acc.r += res.score[s];
          acc.e += res.box.team[s].errors;
          for (const l of res.box.bat[s].values()) {
            acc.pa += l.pa; acc.ab += l.ab; acc.h += l.h; acc.d += l.d; acc.t += l.t; acc.hr += l.hr;
            acc.bb += l.bb; acc.hbp += l.hbp; acc.so += l.so; acc.sf += l.sf; acc.sb += l.sb; acc.cs += l.cs; acc.gidp += l.gidp;
          }
          for (const l of res.box.pit[s].values()) { acc.np += l.np; acc.er += l.er; acc.outs += l.outs; }
        }
      }
    }
  }
  return acc;
}

function metrics(a) {
  const tg = a.g * 2; // 팀-경기 수
  const singles = a.h - a.d - a.t - a.hr;
  const tb = singles + 2 * a.d + 3 * a.t + 4 * a.hr;
  const obp = (a.h + a.bb + a.hbp) / (a.ab + a.bb + a.hbp + a.sf);
  const slg = tb / a.ab;
  return {
    AVG: a.h / a.ab,
    OBP: obp,
    SLG: slg,
    OPS: obp + slg,
    'R/G': a.r / tg,
    ERA: (a.er * 27) / a.outs,
    'K%': a.so / a.pa,
    'BB%': a.bb / a.pa,
    'HR/G': a.hr / tg,
    BABIP: (a.h - a.hr) / (a.ab - a.so - a.hr + a.sf),
    'P/PA': a.np / a.pa,
    'SB/G': a.sb / tg,
    'SB%': a.sb / Math.max(1, a.sb + a.cs),
    'GIDP/G': a.gidp / tg,
    'E/G': a.e / tg,
    '연장%': a.extra / a.g,
    '무승부%': a.ties / a.g,
  };
}

const fmt = (k, v) => {
  if (['AVG', 'OBP', 'SLG', 'OPS', 'BABIP'].includes(k)) return v.toFixed(3).replace(/^0/, '');
  if (k.endsWith('%')) return (v * 100).toFixed(1) + '%';
  return v.toFixed(2);
};

// ───────────── worker ─────────────
if (!isMainThread) {
  const { seasons, seed } = workerData;
  for (const s of seasons) {
    const acc = await simSeason(s, seed);
    parentPort.postMessage({ season: s, acc });
  }
  process.exit(0);
}

// ───────────── main ─────────────
const args = parseArgs();
const t0 = Date.now();
const nW = Math.min(args.workers, args.seasons);
const buckets = Array.from({ length: nW }, () => []);
for (let s = 0; s < args.seasons; s++) buckets[s % nW].push(s);

console.log(`시즌 ${args.seasons}회 × 720경기 = ${(args.seasons * 720).toLocaleString()}경기, 워커 ${nW}개, 시드 "${args.seed}"`);
const total = zero();
const perSeason = [];
let done = 0;
await Promise.all(buckets.map((seasons) => new Promise((resolve, reject) => {
  const w = new Worker(fileURLToPath(import.meta.url), { workerData: { seasons, seed: args.seed } });
  w.on('message', ({ acc }) => {
    for (const k of KEYS) total[k] += acc[k];
    perSeason.push(metrics(acc));
    done++;
    if (process.stdout.isTTY) {
      const el = (Date.now() - t0) / 1000;
      process.stdout.write(`\r진행 ${done}/${args.seasons}  (${el.toFixed(0)}s, 남은 시간 약 ${((el / done) * (args.seasons - done)).toFixed(0)}s)   `);
    }
  });
  w.on('error', reject);
  w.on('exit', resolve);
})));
if (process.stdout.isTTY) process.stdout.write('\n');

const m = metrics(total);
const RED = '\x1b[31m', YEL = '\x1b[33m', GRN = '\x1b[32m', RST = '\x1b[0m';
const stat = (k) => {
  const vals = perSeason.map((x) => x[k]);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  return { min: Math.min(...vals), max: Math.max(...vals), sd };
};

console.log('\n지표        리그평균    시즌최소    시즌최대     표준편차   목표');
console.log('─'.repeat(72));
let fail = 0;
for (const [k, v] of Object.entries(m)) {
  const s = stat(k);
  const hard = TARGETS[k], soft = SOFT[k];
  const range = hard || soft;
  let color = '', mark = '';
  if (range) {
    const ok = v >= range[0] && v <= range[1];
    if (!ok && hard) { color = RED; mark = '✗'; fail++; }
    else if (!ok) { color = YEL; mark = '△'; }
    else { color = GRN; mark = '✓'; }
  }
  const target = range ? `${fmt(k, range[0])}~${fmt(k, range[1])}${hard ? ' (필수)' : ''}` : '';
  console.log(`${color}${k.padEnd(10)} ${fmt(k, v).padStart(9)}  ${fmt(k, s.min).padStart(10)}  ${fmt(k, s.max).padStart(10)}  ${fmt(k, s.sd).padStart(10)}   ${mark} ${target}${RST}`);
}
console.log('─'.repeat(72));
console.log(`소요 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(fail ? `${RED}필수 목표 ${fail}개 벗어남 → js/sim/log5.js 의 LEAGUE/BATTED 값을 조정하세요${RST}` : `${GRN}필수 목표 모두 통과${RST}`);
process.exitCode = fail ? 1 : 0;
