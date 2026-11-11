// 실제 KBO 선수단 (2026 시즌 기록 → 20~80 능력치 변환)
// 기록이 적은 선수는 리그 평균 쪽으로 당겨서(표본 보정) 몇 경기 반짝한 선수가 과대평가되지 않게 한다.
import { HITTERS_2026, PITCHERS_2026, POSITIONS_2026 } from './kbo2026.js';
import { Rng } from '../core/rng.js';
import { clamp } from '../core/util.js';
import { KBO_TEAMS, SHORT_NAME } from './names.js';
import { POS_CROSSOVER } from './ratings.js';
import { makeHitter, makePitcher, initContract, resetPlayerIds, marketSalary } from './playerGen.js';
import { autoDepthChart } from './teamGen.js';

export const REAL_SEASON = 2026;
const TEAM_CODE = { SK: 'SSG' }; // Daum 코드 → 게임 팀 id

// 외국인 선수 (계약 방식이 달라 따로 표시)
const FOREIGN = new Set([
  '오스틴', '힐리어드', '레이예스', '디아즈', '페라자', '데이비슨', '에레디아', '카스트로', '카메론', '히우라', '블레인',
  '세베리노', '브룩스', '데일', '아데를린', '마드리스',
  '네일', '올러', '잭로그', '톨허스트', '로드리게스', '알칸타라', '후라도', '비슬리', '토다', '화이트', '라일리', '왕옌청',
  '벤자민', '테일러', '사우어', '타케다', '웰스', '아빌라', '로건', '시라카와', '오러클린', '베니지아노', '페덱', '스기모토',
  '에르난데스', '보쉴리', '카라스코', '대니엘', '타카다', '유토', '해치', '이이무라', '치리노스', '짐머맨', '미야지',
  '로젠버그', '보스', '버하겐', '와일스', '케네디', '클레빈저', '쿠싱', '사토시', '리오스', '긴지로', '타무라',
]);

// 세부 수비 위치 (Daum은 내야/외야까지만 제공 → 주전급은 실제 포지션으로 지정, 나머지는 기록으로 추정)
const POS = {
  LG: { 오스틴: '1B', 신민재: '2B', 오지환: 'SS', 문보경: '3B', 구본혁: '3B', 문정빈: '1B', 이영빈: 'SS', 천성호: '2B',
    박해민: 'CF', 홍창기: 'RF', 문성주: 'LF', 송찬의: 'LF', 이재원: 'RF' },
  KT: { 힐리어드: '1B', 김상수: '2B', 허경민: '3B', 권동진: 'SS', 장준원: 'SS', 이강민: 'SS', 류현인: '2B', 오윤석: '1B',
    최원준: 'CF', 배정대: 'CF', 김현수: 'LF', 안현민: 'RF', 김민혁: 'LF' },
  NC: { 김주원: 'SS', 박민우: '2B', 김휘집: '3B', 서호철: '3B', 최정원: '2B', 김한별: 'SS', 도태훈: '1B', 블레인: '1B', 오영수: '1B',
    천재환: 'CF', 박건우: 'RF', 이우성: 'LF', 권희동: 'LF' },
  OB: { 박찬호: 'SS', 안재석: '3B', 박준순: '2B', 강승호: '1B', 양석환: '1B', 오명진: '2B', 이유찬: 'SS', 박지훈: '3B',
    정수빈: 'CF', 김민석: 'LF', 카메론: 'RF', 조수행: 'CF', 손아섭: 'RF' },
  HT: { 김도영: '3B', 김선빈: '2B', 하주석: 'SS', 박민: 'SS', 김규성: '2B', 데일: 'SS', 아데를린: '1B', 변우혁: '1B', 오선우: '1B',
    윤도현: '2B', 정현창: 'SS', 이호연: '2B', 김호령: 'CF', 나성범: 'RF', 카스트로: 'LF', 박재현: 'CF' },
  LT: { 나승엽: '1B', 고승민: '2B', 전민재: 'SS', 한동희: '3B', 노진혁: '3B', 박승욱: 'SS', 한태양: '2B', 김세민: 'SS', 이호준: 'SS',
    황성빈: 'CF', 레이예스: 'RF', 윤동희: 'RF', 장두성: 'CF', 전준우: 'LF', 손호영: 'LF' },
  SS: { 디아즈: '1B', 류지혁: '2B', 이재현: 'SS', 김영웅: '3B', 전병우: '3B', 양우현: '2B', 김상준: 'SS', 박계범: 'SS', 심재훈: '2B',
    김지찬: 'CF', 구자욱: 'LF', 김성윤: 'RF', 박승규: 'CF', 최형우: 'LF', 김헌곤: 'RF' },
  SSG: { 박성한: 'SS', 정준재: '2B', 최정: '3B', 고명준: '1B', 전의산: '1B', 안상현: '2B', 홍대인: 'SS',
    최지훈: 'CF', 에레디아: 'LF', 김재환: 'LF', 한유섬: 'RF', 오태곤: 'RF', 김성욱: 'CF' },
  HH: { 노시환: '3B', 강백호: '1B', 심우준: 'SS', 이도윤: '2B', 황영묵: '2B', 채은성: '1B', 박정현: '3B', 정은원: '2B',
    문현빈: 'LF', 페라자: 'RF', 이원석: 'CF', 김태연: 'RF', 최인호: 'LF' },
  WO: { 데이비슨: '1B', 안치홍: '2B', 서건창: '2B', 김웅빈: '3B', 권혁빈: 'SS', 히우라: '1B', 최주환: '1B', 여동욱: '3B', 어준서: 'SS',
    오선진: '3B', 김지석: 'SS', 최재영: 'SS', 염승원: '2B', 양현종: '3B', 박주홍: 'CF', 임병욱: 'CF', 추재현: 'RF', 이형종: 'LF', 박찬혁: 'RF', 브룩스: 'CF' },
};

function parse(csv) {
  return csv.trim().split('\n').map((l) => l.split(','));
}

const num = (v) => (v === '' || v == null ? 0 : Number(v));

function loadHitters() {
  const posMap = new Map(POSITIONS_2026.split(',').map((x) => { const [id, g, no] = x.split(':'); return [id, { group: g, no }]; }));
  return parse(HITTERS_2026).map((r) => {
    const [id, name, team, bats, throws, birth] = r;
    const [G, PA, AB, H, D, T, HR, BB, HBP, SO, SB, CS, SF, GDP, E] = r.slice(6).map(num);
    return {
      id, name, team: TEAM_CODE[team] || team, bats: bats === '좌타' ? 'L' : bats === '양타' ? 'S' : 'R',
      throws: throws === '좌투' ? 'L' : 'R', birth: Number(birth.slice(0, 4)),
      G, PA, AB, H, D, T, HR, BB, HBP, SO, SB, CS, SF, GDP, E, group: posMap.get(id)?.group || 'IF',
    };
  });
}

function loadPitchers() {
  return parse(PITCHERS_2026).map((r) => {
    const [id, name, team, throws, birth] = r;
    const [G, , outs, W, L, SV, HLD, BF, H, HR, BB, HBP, SO, ER, NP] = r.slice(5).map(num);
    return {
      id, name, team: TEAM_CODE[team] || team, throws: throws === '좌투' ? 'L' : 'R', side: throws === '우언',
      birth: Number(birth.slice(0, 4)), G, outs, W, L, SV, HLD, BF, H, HR, BB, HBP, SO, ER, NP,
    };
  });
}

// 표본 보정 비율: (기록 + 리그평균×k) / (표본 + k)
const shrink = (x, n, m, k) => (x + m * k) / (n + k);
const toR = (z) => Math.round(clamp(50 + 10 * z, 20, 80));

function hitterRatings(rows) {
  const tot = rows.reduce((a, r) => { for (const k of ['PA', 'AB', 'H', 'D', 'T', 'HR', 'BB', 'HBP', 'SO', 'SB', 'CS']) a[k] = (a[k] || 0) + r[k]; return a; }, {});
  const lg = {
    avg: tot.H / tot.AB, iso: (tot.D + 2 * tot.T + 3 * tot.HR) / tot.AB, bb: tot.BB / tot.PA, k: tot.SO / tot.PA,
    sb: (tot.SB + tot.CS) / (tot.H + tot.BB + tot.HBP), tr: tot.T / Math.max(1, tot.H),
  };
  const SD = { avg: 0.026, iso: 0.05, bb: 0.024, k: 0.045, sb: 0.06, tr: 0.02 };
  return rows.map((r) => {
    const avg = shrink(r.H, r.AB, lg.avg, 160);
    const iso = shrink(r.D + 2 * r.T + 3 * r.HR, r.AB, lg.iso, 200);
    const bb = shrink(r.BB, r.PA, lg.bb, 120);
    const k = shrink(r.SO, r.PA, lg.k, 100);
    const sb = shrink(r.SB + r.CS, r.H + r.BB + r.HBP, lg.sb, 60);
    const tr = shrink(r.T, r.H, lg.tr, 80);
    const z = { avg: (avg - lg.avg) / SD.avg, iso: (iso - lg.iso) / SD.iso, bb: (bb - lg.bb) / SD.bb, k: (lg.k - k) / SD.k, sb: (sb - lg.sb) / SD.sb, tr: (tr - lg.tr) / SD.tr };
    return {
      contact: toR(0.75 * z.avg + 0.25 * z.k),
      power: toR(z.iso),
      eye: toR(z.bb),
      avoidK: toR(z.k),
      speedZ: 0.75 * z.sb + 0.25 * z.tr,
    };
  });
}

function pitcherRatings(rows) {
  const tot = rows.reduce((a, r) => { for (const k of ['BF', 'SO', 'BB', 'HBP', 'HR', 'H']) a[k] = (a[k] || 0) + r[k]; return a; }, {});
  const bip = (r) => Math.max(1, r.BF - r.SO - r.BB - r.HBP - r.HR);
  const lg = { k: tot.SO / tot.BF, bb: (tot.BB + tot.HBP) / tot.BF, hr: tot.HR / tot.BF, h: (tot.H - tot.HR) / (tot.BF - tot.SO - tot.BB - tot.HBP - tot.HR) };
  const SD = { k: 0.045, bb: 0.022, hr: 0.009, h: 0.022 };
  return rows.map((r) => {
    const k = shrink(r.SO, r.BF, lg.k, 150);
    const bb = shrink(r.BB + r.HBP, r.BF, lg.bb, 200);
    const hr = shrink(r.HR, r.BF, lg.hr, 500);
    const h = shrink(r.H - r.HR, bip(r), lg.h, 600);
    const z = { k: (k - lg.k) / SD.k, bb: (lg.bb - bb) / SD.bb, hr: (lg.hr - hr) / SD.hr, h: (lg.h - h) / SD.h };
    return { control: toR(z.bb), stuff: toR(0.65 * z.k + 0.25 * z.hr + 0.1 * z.h), kz: z.k };
  });
}

/** 내야/외야만 아는 선수의 세부 위치 추정 */
function guessPos(r, rt) {
  if (r.group === 'C') return 'C';
  if (r.group === 'OF') return rt.speedZ > 0.6 ? 'CF' : rt.power >= 55 ? 'RF' : 'LF';
  if (rt.power >= 56 && rt.speedZ < 0) return '1B';
  if (rt.power >= 52) return '3B';
  return rt.speedZ > 0.3 ? 'SS' : '2B';
}

const BREAKING = [['SL', 30], ['CH', 22], ['CU', 18], ['FK', 14], ['CT', 10], ['SP', 6]];

/** 실제 선수단 리그 생성 (generateLeague와 같은 형태 반환) */
export function generateRealLeague(seed = 'kbo-real', gameYear = REAL_SEASON + 1) {
  const rng = new Rng('real', seed);
  resetPlayerIds(1);
  const hitters = loadHitters();
  const pitchers = loadPitchers();
  const hR = hitterRatings(hitters);
  const pR = pitcherRatings(pitchers);
  const used = new Set([...hitters, ...pitchers].map((x) => x.name));
  let nextId = 1;
  const potentialGap = (age) => (age <= 22 ? Math.max(0, rng.normal(10, 5)) : age <= 25 ? Math.max(0, rng.normal(5, 3)) : age <= 27 ? Math.max(0, rng.normal(1.5, 1.5)) : 0);

  const careerBase = (name, age) => {
    const foreign = FOREIGN.has(name);
    return {
      injury: null, stats: {}, condition: 0, fatigue: 0, draft: null, foreign,
      service: foreign ? 0 : Math.max(0, Math.min(18, age - 20)), scoutNoise: rng.normal(0, 3), real: true,
    };
  };

  const byTeam = new Map(KBO_TEAMS.map((t) => [t.id, { H: [], P: [] }]));

  hitters.forEach((r, i) => {
    const rt = hR[i];
    const age = gameYear - r.birth;
    const pos = POS[r.team]?.[r.name] || guessPos(r, rt);
    const speed = Math.round(clamp(50 + 10 * rt.speedZ - (pos === 'C' ? 6 : 0), 20, 80));
    const defBase = { C: 52, SS: 56, '2B': 53, CF: 55, '3B': 51, RF: 50, LF: 48, '1B': 48 }[pos] ?? 50;
    const errPerG = r.E / Math.max(1, r.G);
    const primaryDef = Math.round(clamp(defBase + rng.normal(0, 4) - (errPerG > 0.1 ? 4 : 0) + (r.PA > 400 ? 2 : 0), 25, 75));
    const def = { [pos]: primaryDef };
    for (const [o, d] of Object.entries(POS_CROSSOVER[pos] || {})) def[o] = Math.round(clamp(primaryDef + d + rng.normal(0, 3), 20, 80));
    const ratings = {
      contact: rt.contact, power: rt.power, eye: rt.eye, avoidK: rt.avoidK, speed,
      arm: Math.round(clamp(50 + ({ RF: 8, SS: 6, '3B': 6, C: 4, CF: 2, '2B': -4, LF: -6, '1B': -8 }[pos] ?? 0) + rng.normal(0, 7), 20, 80)),
      catcherLead: pos === 'C' ? Math.round(clamp(rng.normal(52, 7) + (age - 28) * 0.4, 30, 75)) : 20, def,
    };
    const gap = potentialGap(age);
    const potential = {};
    for (const k of ['contact', 'power', 'eye', 'avoidK']) potential[k] = Math.round(clamp(ratings[k] + gap * (0.6 + rng.next() * 0.8), 20, 80));
    potential.def = Math.round(clamp(primaryDef + gap * 0.5, 20, 80));
    const p = {
      id: nextId++, name: r.name, age, type: 'H', pos, bats: r.bats, throws: r.throws, ratings,
      tend: { gb: clamp(rng.normal(0, 0.8) - (rt.power - 50) / 15, -2.5, 2.5), pull: clamp(rng.normal(0, 0.8) + (rt.power - 50) / 25, -2.5, 2.5) },
      potential, ...careerBase(r.name, age),
      realStat: { G: r.G, PA: r.PA, AVG: r.H / Math.max(1, r.AB), OBP: (r.H + r.BB + r.HBP) / Math.max(1, r.AB + r.BB + r.HBP + r.SF),
        SLG: (r.H + r.D + 2 * r.T + 3 * r.HR) / Math.max(1, r.AB), HR: r.HR, SB: r.SB, SO: r.SO, BB: r.BB },
    };
    byTeam.get(r.team)?.H.push(p);
  });

  pitchers.forEach((r, i) => {
    const rt = pR[i];
    const age = gameYear - r.birth;
    const outsPerG = r.outs / Math.max(1, r.G);
    const role = outsPerG >= 11 && r.G <= 35 ? 'SP' : 'RP';
    const velo = Math.round(clamp(50 + 6 * rt.kz + rng.normal(0, 5) - (r.side ? 7 : 0) - (r.throws === 'L' ? 2 : 0), 20, 80));
    const nP = role === 'SP' ? rng.weighted([[2, 40], [3, 45], [1, 15]]) : rng.weighted([[1, 45], [2, 45], [3, 10]]);
    const pool = BREAKING.slice();
    const pitches = [];
    for (let k = 0; k < nP; k++) {
      const t = rng.weighted(pool);
      pool.splice(pool.findIndex(([x]) => x === t), 1);
      pitches.push({ type: t, grade: Math.round(clamp(rt.stuff + rng.normal(k === 0 ? 3 : -2, 6), 20, 80)) });
    }
    const stamina = role === 'SP' ? Math.round(clamp(50 + (outsPerG / 3 - 5.2) * 9 + rng.normal(0, 3), 30, 80)) : Math.round(clamp(rng.normal(34, 6) + (outsPerG - 3) * 3, 20, 55));
    const ratings = {
      velo, control: rt.control, stuff: rt.stuff, pitches, stamina,
      mental: Math.round(clamp(50 + Math.min(12, (r.SV + r.HLD) * 0.4) + rng.normal(0, 7), 25, 80)),
    };
    const gap = potentialGap(age);
    const potential = {
      velo: Math.round(clamp(velo + gap * 0.4, 20, 80)),
      control: Math.round(clamp(rt.control + gap * (0.6 + rng.next() * 0.6), 20, 80)),
      stuff: Math.round(clamp(rt.stuff + gap * (0.6 + rng.next() * 0.6), 20, 80)),
    };
    const p = {
      id: nextId++, name: r.name, age, type: 'P', pos: 'P', role, throws: r.throws, bats: 'R', ratings,
      tend: { gb: clamp(rng.normal(r.side ? 1 : 0, 0.9), -2.5, 2.5), twoSeam: r.side || rng.chance(0.3) },
      potential, ...careerBase(r.name, age),
      realStat: { G: r.G, IP: r.outs / 3, outs: r.outs, W: r.W, L: r.L, SV: r.SV, HLD: r.HLD, SO: r.SO, BB: r.BB,
        ERA: (r.ER * 27) / Math.max(1, r.outs), WHIP: ((r.H + r.BB) * 3) / Math.max(1, r.outs) },
    };
    byTeam.get(r.team)?.P.push(p);
  });
  resetPlayerIds(nextId);

  const teams = KBO_TEAMS.map((info) => {
    const g = byTeam.get(info.id);
    const H = g.H.sort((a, b) => b.realStat.PA - a.realStat.PA);
    const P = g.P.sort((a, b) => b.realStat.IP - a.realStat.IP);
    // 1군 26명: 야수 13 (포수 2 보장) + 투수 13 (선발 5 보장)
    const act = new Set();
    H.filter((p) => p.pos === 'C').slice(0, 2).forEach((p) => act.add(p));
    for (const p of H) { if ([...act].filter((x) => x.type === 'H').length >= 13) break; act.add(p); }
    P.filter((p) => p.role === 'SP').slice(0, 5).forEach((p) => act.add(p));
    for (const p of P) { if ([...act].filter((x) => x.type === 'P').length >= 13) break; act.add(p); }
    const all = [...H, ...P];
    const roster = all.filter((p) => act.has(p));
    const reserve = all.filter((p) => !act.has(p));
    // 기록 표본에 없는 2군 유망주 보충 (랜덤 생성)
    while (reserve.filter((p) => p.type === 'H').length < 6) {
      const h = makeHitter(rng, rng.pick(['C', 'SS', '2B', 'CF', '3B', 'RF', 'LF', '1B']), -11, used);
      h.age = rng.int(19, 24); h.service = Math.max(0, h.age - 20); h.id = nextIdBump();
      reserve.push(h);
    }
    while (reserve.filter((p) => p.type === 'P').length < 6) {
      const pp = makePitcher(rng, rng.chance(0.4) ? 'SP' : 'RP', -11, used);
      pp.age = rng.int(19, 24); pp.service = Math.max(0, pp.age - 20); pp.id = nextIdBump();
      reserve.push(pp);
    }
    for (const p of [...roster, ...reserve]) {
      if (p.foreign) p.contract = { salary: Math.max(80000, Math.min(150000, Math.round(marketSalary(p) / 1000) * 1000)), years: 1 };
      else initContract(p, rng);
    }
    const team = { ...info, short: SHORT_NAME[info.id], roster, reserve };
    autoDepthChart(team);
    return team;
  });

  function nextIdBump() { return nextId++; }
  resetPlayerIds(nextId);
  return { seed: String(seed), teams, real: true };
}
