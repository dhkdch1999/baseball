// 시즌/통산 기록 누적, 비율 기록, 간이 WAR, 개인 기록 순위
export const BAT_KEYS = ['g', 'pa', 'ab', 'r', 'h', 'd', 't', 'hr', 'rbi', 'bb', 'ibb', 'so', 'hbp', 'sb', 'cs', 'sf', 'sh', 'gidp'];
export const PIT_KEYS = ['g', 'gs', 'outs', 'bf', 'h', 'r', 'er', 'bb', 'so', 'hr', 'hbp', 'np', 'w', 'l', 'sv', 'hld', 'wp'];

const blank = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));

/** 시즌 키: 정규시즌 "2027", 포스트시즌 "2027PS" */
export const seasonKey = (season, post = false) => (post ? `${season}PS` : String(season));

function entry(p, key, teamId) {
  p.stats ??= {};
  let e = p.stats[key];
  if (!e) e = p.stats[key] = { team: teamId, bat: null, pit: null };
  e.team = teamId;
  return e;
}

/** 경기 박스스코어를 선수 기록에 누적 */
export function recordBox(game, key) {
  const box = game.box;
  for (const side of [0, 1]) {
    const teamId = game.teams[side].id;
    for (const { player } of box.batOrder[side]) {
      const l = box.bat[side].get(player.id);
      const e = entry(player, key, teamId);
      e.bat ??= blank(BAT_KEYS);
      e.bat.g++;
      for (const k of BAT_KEYS) if (k !== 'g') e.bat[k] += l[k] || 0;
    }
    for (const { player } of box.pitOrder[side]) {
      const l = box.pit[side].get(player.id);
      const e = entry(player, key, teamId);
      e.pit ??= blank(PIT_KEYS);
      e.pit.g++;
      for (const k of PIT_KEYS) if (k !== 'g') e.pit[k] += l[k] || 0;
    }
  }
}

export function sumLines(lines, keys) {
  const t = blank(keys);
  for (const l of lines) if (l) for (const k of keys) t[k] += l[k] || 0;
  return t;
}

/** 통산 (정규시즌만) */
export function careerLine(p, kind) {
  const keys = kind === 'bat' ? BAT_KEYS : PIT_KEYS;
  return sumLines(Object.entries(p.stats || {}).filter(([k]) => !k.endsWith('PS')).map(([, e]) => e[kind]), keys);
}

// ───── 비율 기록 ─────
export const avg = (b) => (b.ab ? b.h / b.ab : 0);
export const obp = (b) => { const d = b.ab + b.bb + b.hbp + b.sf; return d ? (b.h + b.bb + b.hbp) / d : 0; };
export const slg = (b) => (b.ab ? (b.h + b.d + 2 * b.t + 3 * b.hr) / b.ab : 0);
export const ops = (b) => obp(b) + slg(b);
export const era = (p) => (p.outs ? (p.er * 27) / p.outs : p.er ? 99.99 : 0);
export const whip = (p) => (p.outs ? ((p.bb + p.h) * 3) / p.outs : 0);
export const ip = (p) => p.outs / 3;

const W = { bb: 0.69, hbp: 0.72, s: 0.88, d: 1.25, t: 1.58, hr: 2.03 };
export function woba(b) {
  const den = b.ab + b.bb - (b.ibb || 0) + b.sf + b.hbp;
  if (!den) return 0;
  const singles = b.h - b.d - b.t - b.hr;
  return (W.bb * (b.bb - (b.ibb || 0)) + W.hbp * b.hbp + W.s * singles + W.d * b.d + W.t * b.t + W.hr * b.hr) / den;
}

const POS_ADJ = { C: 12.5, SS: 7.5, '2B': 2.5, '3B': 2.5, CF: 2.5, LF: -7.5, RF: -7.5, '1B': -12.5, DH: -17.5 };

/** 리그 기준값 (WAR 계산용) */
export function leagueBaseline(players, key) {
  const bats = [], pits = [];
  for (const p of players) {
    const e = p.stats?.[key];
    if (e?.bat) bats.push(e.bat);
    if (e?.pit) pits.push(e.pit);
  }
  const B = sumLines(bats, BAT_KEYS);
  const P = sumLines(pits, PIT_KEYS);
  const lgWoba = woba(B) || 0.32;
  const lgEra = era(P) || 4.5;
  const ipT = ip(P) || 1;
  const fipRaw = (13 * P.hr + 3 * (P.bb + P.hbp) - 2 * P.so) / ipT;
  return { lgWoba, lgEra, fipC: lgEra - fipRaw, rPerPA: B.pa ? B.r / B.pa : 0.12 };
}

export function fip(p, base) {
  const i = ip(p);
  if (!i) return 0;
  return (13 * p.hr + 3 * (p.bb + p.hbp) - 2 * p.so) / i + base.fipC;
}

/** 간이 WAR: 타격(wRAA) + 주루 + 포지션 + 대체선수 / 투수(FIP 기반) */
export function war(player, e, base, games = 144) {
  let w = 0;
  if (e?.bat && e.bat.pa) {
    const b = e.bat;
    const wraa = ((woba(b) - base.lgWoba) / 1.2) * b.pa;
    const br = b.sb * 0.2 - b.cs * 0.4;
    const pos = player.type === 'H' ? (POS_ADJ[player.pos] ?? 0) * (b.g / games) : 0;
    const def = player.type === 'H' ? (((player.ratings.def?.[player.pos] ?? 50) - 50) / 10) * 4 * (b.g / games) : 0;
    const repl = (17.5 * b.pa) / 600;
    if (player.type === 'H') w += (wraa + br + pos + def + repl) / 11;
  }
  if (e?.pit && e.pit.outs) {
    const p = e.pit;
    const starterShare = p.g ? p.gs / p.g : 0;
    const replFip = base.lgEra + 0.55 + 0.45 * starterShare;
    w += ((replFip - fip(p, base)) * ip(p)) / 9 / 11;
  }
  return w;
}

/**
 * 개인 기록 순위
 * @param stat 'avg'|'ops'|'hr'|'rbi'|'sb'|'h'|'war' (타자) / 'era'|'whip'|'w'|'sv'|'so'|'pwar' (투수)
 */
export const LEADER_DEFS = {
  avg: { label: '타율', kind: 'bat', fn: avg, fmt: 'avg', qual: 'pa', desc: true },
  hr: { label: '홈런', kind: 'bat', fn: (b) => b.hr, desc: true },
  rbi: { label: '타점', kind: 'bat', fn: (b) => b.rbi, desc: true },
  ops: { label: 'OPS', kind: 'bat', fn: ops, fmt: 'avg', qual: 'pa', desc: true },
  h: { label: '안타', kind: 'bat', fn: (b) => b.h, desc: true },
  sb: { label: '도루', kind: 'bat', fn: (b) => b.sb, desc: true },
  war: { label: 'WAR(타자)', kind: 'bat', war: true, fmt: 'f2', desc: true },
  era: { label: '평균자책점', kind: 'pit', fn: era, fmt: 'f2', qual: 'ip', desc: false },
  whip: { label: 'WHIP', kind: 'pit', fn: whip, fmt: 'f2', qual: 'ip', desc: false },
  w: { label: '승리', kind: 'pit', fn: (p) => p.w, desc: true },
  sv: { label: '세이브', kind: 'pit', fn: (p) => p.sv, desc: true },
  so: { label: '탈삼진', kind: 'pit', fn: (p) => p.so, desc: true },
  pwar: { label: 'WAR(투수)', kind: 'pit', war: true, fmt: 'f2', desc: true },
};

/** teamGames: 팀당 소화 경기 수 (규정타석 3.1×, 규정이닝 1×) */
export function leaders(players, key, stat, teamGames, n = 10) {
  const def = LEADER_DEFS[stat];
  const base = def.war ? leagueBaseline(players, key) : null;
  const rows = [];
  for (const p of players) {
    const e = p.stats?.[key];
    const line = e?.[def.kind];
    if (!line) continue;
    if (def.qual === 'pa' && line.pa < Math.floor(teamGames * 3.1)) continue;
    if (def.qual === 'ip' && line.outs < teamGames * 3) continue;
    if (def.war && p.type !== (def.kind === 'bat' ? 'H' : 'P')) continue;
    const v = def.war ? war(p, e, base) : def.fn(line);
    rows.push({ player: p, team: e.team, value: v, line });
  }
  rows.sort((a, b) => (def.desc ? b.value - a.value : a.value - b.value));
  return rows.slice(0, n);
}
