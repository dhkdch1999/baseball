// 커리어(구단 운영) 진행: 새 게임, 하루 진행, 경기 결과 반영, 부상·피로·컨디션, 포스트시즌 진입
import { Rng } from '../core/rng.js';
import { clamp } from '../core/util.js';
import { generateLeague, autoDepthChart } from '../data/teamGen.js';
import { generateRealLeague, REAL_SEASON } from '../data/realRoster.js';
import { getNextPlayerId, resetPlayerIds } from '../data/playerGen.js';
import { Game } from '../sim/game.js';
import { chooseStarter } from '../sim/aiManager.js';
import { makeSchedule, seasonDates } from './schedule.js';
import { recordBox, seasonKey } from './stats.js';
import { computeStandings } from './standings.js';
import { buildPostseason, nextPostseasonGame, recordPostseasonGame, ROUND_KO } from './postseason.js';
import { ensureLineup, callUpsIfNeeded } from './roster.js';
import { ratingMeans } from './offseason.js';

export const SAVE_VERSION = 2;
export const TRADE_DEADLINE_DAY = 100;

export function newCareer({ seed = 'kbo-1', myTeamId, year = 2027, roster = 'random' }) {
  // roster: 'random' = 랜덤 선수단 / 'real' = 실제 KBO 선수단 (2026 기록 기반)
  const lg = roster === 'real' ? generateRealLeague(seed, year) : generateLeague(seed);
  const league = {
    version: SAVE_VERSION,
    seed: String(seed),
    season: year,
    startYear: year,
    myTeamId,
    phase: 'regular', // regular | postseason | offseason
    day: 0,
    teams: lg.teams,
    schedule: makeSchedule(lg.teams.map((t) => t.id), year, seed),
    freeAgents: [],
    draftPool: [],
    news: [],
    history: [],
    postseason: null,
    offseason: null,
    nextPlayerId: getNextPlayerId(),
    lastGame: null,
    rosterMode: roster,
    realSeason: roster === 'real' ? REAL_SEASON : null,
  };
  for (const t of league.teams) { t.rotationIndex = 0; }
  league.ratingNorm = ratingMeans(league);
  addNews(league, `${year} 시즌, ${teamById(league, myTeamId).name} 감독으로 부임했습니다.`, myTeamId);
  if (roster === 'real') addNews(league, `실제 KBO 선수단으로 시작합니다. 선수 능력치는 ${REAL_SEASON} 시즌 기록을 바탕으로 정했습니다.`);
  return league;
}

/** 불러온 세이브에 런타임 상태 복원 */
export function attachLeague(league) {
  resetPlayerIds(league.nextPlayerId || 100000);
}

export const teamById = (lg, id) => lg.teams.find((t) => t.id === id);
export const myTeam = (lg) => teamById(lg, lg.myTeamId);
export const allTeamPlayers = (lg) => lg.teams.flatMap((t) => [...t.roster, ...t.reserve]);
export const allPlayers = (lg) => [...allTeamPlayers(lg), ...lg.freeAgents];

export function currentDate(lg) {
  if (lg.phase === 'regular') return lg.schedule[lg.day]?.date;
  if (lg.phase === 'postseason') {
    const last = lg.schedule[lg.schedule.length - 1].date;
    const d = new Date(last + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 2 + (lg.postseason?.dayCount || 0));
    return d.toISOString().slice(0, 10);
  }
  return `${lg.season}-11-15`;
}

export function addNews(lg, text, teamId = null) {
  lg.news.unshift({ date: currentDate(lg) || '', season: lg.season, text, team: teamId });
  if (lg.news.length > 300) lg.news.length = 300;
}

/** 오늘 경기 목록: [{id, away, home, round?, gameNo?, result}] */
export function todayGames(lg) {
  if (lg.phase === 'regular') return lg.schedule[lg.day]?.games || [];
  if (lg.phase === 'postseason') {
    const ps = lg.postseason;
    if (!ps.today || ps.today.day !== ps.dayCount) {
      const g = nextPostseasonGame(ps);
      if (!g) return [];
      ps.today = { id: `${lg.season}PS-${g.round}-${g.gameNo}`, ...g, post: true, result: null, day: ps.dayCount };
    }
    return [ps.today];
  }
  return [];
}

export function myGameToday(lg) {
  return todayGames(lg).find((g) => g.away === lg.myTeamId || g.home === lg.myTeamId) || null;
}

/** 경기 전 준비: 라인업 점검, 선발 결정 → Game 인스턴스 */
export function prepareGame(lg, meta, { verbose = false } = {}) {
  const msgs = [];
  for (const id of [meta.away, meta.home]) {
    const t = teamById(lg, id);
    if (id === lg.myTeamId) {
      msgs.push(...callUpsIfNeeded(t));
      if (t.autoLineup !== false) autoDepthChart(t); // AI 코치가 라인업 관리
      else msgs.push(...ensureLineup(t));
    } else {
      callUpsIfNeeded(t);
      autoDepthChart(t);
    }
  }
  const away = teamById(lg, meta.away), home = teamById(lg, meta.home);
  const sa = chooseStarter(away, away.rotationIndex || 0);
  const sh = chooseStarter(home, home.rotationIndex || 0);
  meta._rot = [sa.index, sh.index];
  const game = new Game({
    away, home, verbose,
    seed: `${lg.seed}-${meta.id}`,
    starters: [sa.player.id, sh.player.id],
    maxInnings: meta.post ? Infinity : 11,
  });
  return { game, msgs };
}

const INJ_H = ['햄스트링 부상', '손목 염좌', '옆구리 근육 손상', '발목 염좌', '허리 통증', '손가락 골절', '종아리 근육 경련', '무릎 타박상'];
const INJ_P = ['팔꿈치 염증', '어깨 통증', '옆구리 근육 손상', '손가락 물집', '허리 통증', '전완근 뭉침'];

/** 경기 종료 후 반영: 기록, 피로, 로테이션, 부상, 결과 저장 */
export function completeGame(lg, meta, game) {
  const res = game.result;
  const winnerId = res.winner == null ? null : res.winner === 0 ? meta.away : meta.home;
  const key = seasonKey(lg.season, !!meta.post);
  recordBox(game, key);

  // 선발 로테이션 다음 순번
  [meta.away, meta.home].forEach((id, i) => { teamById(lg, id).rotationIndex = (meta._rot?.[i] ?? 0) + 1; });
  delete meta._rot;

  // 투수 피로
  for (const side of [0, 1]) {
    for (const { player } of game.box.pitOrder[side]) {
      const l = game.box.pit[side].get(player.id);
      player.fatigue = Math.min(100, (player.fatigue || 0) + l.np * 0.8 + 6);
    }
  }

  // 부상 판정 (경기 시드 기반 → 재현 가능)
  const rng = new Rng('injury', lg.seed, meta.id);
  const injuries = [];
  for (const side of [0, 1]) {
    for (const { player } of game.box.batOrder[side]) {
      const p = 0.0019 + (player.age > 32 ? 0.0007 : 0);
      if (!player.injury && rng.chance(p)) injuries.push(injure(rng, player, INJ_H));
    }
    for (const { player } of game.box.pitOrder[side]) {
      const np = game.box.pit[side].get(player.id).np;
      const p = 0.0006 + np * 0.000028 + (player.fatigue > 70 ? 0.002 : 0);
      if (!player.injury && rng.chance(p)) injuries.push(injure(rng, player, INJ_P));
    }
  }
  for (const pl of injuries) {
    const t = lg.teams.find((x) => x.roster.includes(pl));
    if (t) addNews(lg, `[부상] ${t.short} ${pl.name} — ${pl.injury.type} (약 ${pl.injury.days}일)`, t.id);
  }

  const name = (side, id) => game.box.pitOrder[side].find((x) => x.player.id === id)?.player.name;
  const w = res.winner;
  const result = {
    score: res.score, winner: winnerId, innings: res.innings, walkoff: res.walkoff,
    W: w != null ? name(w, res.decisions.W) : null,
    L: w != null ? name(1 - w, res.decisions.L) : null,
    S: w != null && res.decisions.S ? name(w, res.decisions.S) : null,
    line: game.box.team.map((t) => ({ line: t.line.slice(), r: t.runs, h: t.hits, e: t.errors, b: t.bb })),
  };
  meta.result = result;
  if (meta.post) {
    const ps = lg.postseason;
    const out = recordPostseasonGame(ps, meta, result, winnerId);
    const [a, h] = res.score;
    const A = teamById(lg, meta.away), H = teamById(lg, meta.home);
    addNews(lg, `[${ROUND_KO[meta.round]} ${meta.gameNo}차전] ${A.short} ${a} : ${h} ${H.short}`);
    if (out.seriesOver && out.champion) {
      addNews(lg, `🏆 ${teamById(lg, out.champion).name}, ${lg.season} 한국시리즈 우승!`, out.champion);
    } else if (out.seriesOver) {
      addNews(lg, `${teamById(lg, out.winner).name}, ${ROUND_KO[meta.round]} 통과`, out.winner);
    }
  }
  if (meta.away === lg.myTeamId || meta.home === lg.myTeamId) lg.lastGame = { id: meta.id, away: meta.away, home: meta.home, ...result, round: meta.round, gameNo: meta.gameNo };
  return { winnerId, injuries };
}

function injure(rng, p, pool) {
  const days = rng.weighted([[rng.int(2, 7), 50], [rng.int(8, 20), 30], [rng.int(21, 45), 15], [rng.int(46, 110), 5]]);
  p.injury = { type: rng.pick(pool), days };
  return p;
}

/** 오늘 남은 경기를 모두 결과만 시뮬레이션 (exceptId 제외) */
export function simRemainingGames(lg, exceptId = null) {
  for (const meta of todayGames(lg)) {
    if (meta.result || meta.id === exceptId) continue;
    const { game } = prepareGame(lg, meta);
    game.simulate();
    completeGame(lg, meta, game);
  }
}

/** 하루 마감: 회복, 부상 경과, 컨디션, 날짜 진행, 정규시즌 종료 → 포스트시즌 */
export function endDay(lg) {
  const rng = new Rng('day', lg.seed, lg.season, lg.phase, lg.day, lg.postseason?.dayCount || 0);
  for (const t of lg.teams) {
    for (const p of [...t.roster, ...t.reserve]) {
      if (p.type === 'P') p.fatigue = Math.max(0, (p.fatigue || 0) - (p.role === 'SP' ? 20 : 26));
      p.condition = Math.round(clamp((p.condition || 0) * 0.7 + rng.normal(0, 3.5), -10, 10));
      if (p.injury) {
        p.injury.days--;
        if (p.injury.days <= 0) {
          p.injury = null;
          if (t.id === lg.myTeamId) addNews(lg, `[복귀] ${p.name} 부상에서 회복`, t.id);
        }
      }
    }
  }
  for (const p of lg.freeAgents) if (p.injury && --p.injury.days <= 0) p.injury = null;

  if (lg.phase === 'regular') {
    lg.day++;
    if (lg.day >= lg.schedule.length) startPostseason(lg);
  } else if (lg.phase === 'postseason') {
    lg.postseason.dayCount = (lg.postseason.dayCount || 0) + 1;
    if (lg.postseason.champion) lg.phase = 'offseason';
  }
}

export function startPostseason(lg) {
  const st = computeStandings(lg);
  lg.phase = 'postseason';
  lg.postseason = buildPostseason(st);
  lg.postseason.dayCount = 0;
  lg.finalStandings = st.map((r) => ({ id: r.team.id, w: r.w, l: r.l, t: r.t, pct: r.pct, gb: r.gb }));
  const names = lg.postseason.seeds.map((id, i) => `${i + 1}위 ${teamById(lg, id).short}`).join(', ');
  addNews(lg, `정규시즌 종료! 가을야구 진출: ${names}`);
  if (!lg.postseason.seeds.includes(lg.myTeamId)) addNews(lg, `${myTeam(lg).name}은(는) 포스트시즌 진출에 실패했습니다.`, lg.myTeamId);
}

/** 사용자 경기를 포함해 하루 전체를 빠르게 진행 */
export function simDay(lg) {
  if (lg.phase !== 'regular' && lg.phase !== 'postseason') return false;
  if (!todayGames(lg).length && lg.phase === 'postseason') { endDay(lg); return true; }
  simRemainingGames(lg);
  endDay(lg);
  return true;
}

/** 팀당 소화 경기 수 (규정타석/이닝 계산용) */
export function teamGamesPlayed(lg) {
  if (lg.phase !== 'regular') return 144;
  let n = 0;
  for (let i = 0; i < lg.day; i++) n++;
  return Math.max(1, n);
}

export { seasonDates };
