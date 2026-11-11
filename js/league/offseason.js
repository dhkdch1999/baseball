// 오프시즌: 시즌 결산(시상) → 성장/노쇠/은퇴/계약 만료 → FA 시장 → 신인 드래프트 → 새 시즌
import { Rng } from '../core/rng.js';
import { clamp } from '../core/util.js';
import {
  overall, potentialOverall, marketSalary, serviceSalary, makeProspect, getNextPlayerId, scoutPotential,
} from '../data/playerGen.js';
import { autoRoster, autoDepthChart, equalizeTeams } from '../data/teamGen.js';
import { makeSchedule } from './schedule.js';
import { leagueBaseline, war, seasonKey, avg, era } from './stats.js';
import { teamById, myTeam, addNews, allPlayers, allTeamPlayers } from './season.js';
import { ensureLineup, payroll, TOTAL_MAX, ACTIVE_MAX } from './roster.js';

export const OFF_STEPS = ['review', 'fa', 'draft', 'ready'];
export const STEP_KO = { review: '시즌 결산', fa: 'FA 시장', draft: '신인 드래프트', ready: '새 시즌 준비' };
export const SOFT_CAP = 1_400_000; // 만원 = 140억 (AI 구단 FA 지출 기준)

const nameOf = (lg, id) => teamById(lg, id)?.name;

/** 포스트시즌 종료 직후 호출: 시상 + 역사 기록 + 성장/계약 처리 */
export function startOffseason(lg) {
  if (lg.offseason) return;
  const key = seasonKey(lg.season);
  const players = allPlayers(lg);
  const base = leagueBaseline(players, key);
  const withWar = players.filter((p) => p.stats?.[key]).map((p) => ({ p, w: war(p, p.stats[key], base), e: p.stats[key] }));
  const mvp = withWar.slice().sort((a, b) => b.w - a.w)[0];
  const ace = withWar.filter((x) => x.p.type === 'P').sort((a, b) => b.w - a.w)[0];
  const rookie = withWar.filter((x) => x.p.service <= 1).sort((a, b) => b.w - a.w)[0];
  const ps = lg.postseason;
  const ks = ps?.series.find((s) => s.round === 'KS');
  const entry = {
    season: lg.season,
    champion: ps?.champion,
    runnerUp: ks ? (ks.winner === ks.high ? ks.low : ks.high) : null,
    standings: lg.finalStandings,
    mvp: mvp && { id: mvp.p.id, name: mvp.p.name, team: mvp.e.team, war: mvp.w },
    ace: ace && { id: ace.p.id, name: ace.p.name, team: ace.e.team, war: ace.w },
    rookie: rookie && { id: rookie.p.id, name: rookie.p.name, team: rookie.e.team, war: rookie.w },
  };
  lg.history.push(entry);
  if (entry.mvp) addNews(lg, `[시상] MVP: ${entry.mvp.name} (${nameOf(lg, entry.mvp.team)}, WAR ${entry.mvp.war.toFixed(1)})`);
  if (entry.ace) addNews(lg, `[시상] 최고 투수: ${entry.ace.name} (${nameOf(lg, entry.ace.team)})`);
  if (entry.rookie) addNews(lg, `[시상] 신인왕: ${entry.rookie.name} (${nameOf(lg, entry.rookie.team)})`);

  // 리그 환경 보정: 타율/장타율이 목표에서 벗어나면 다음 시즌 정규화 기준을 조금 이동
  if (lg.ratingNorm?.contact?.mean != null) {
    const bats = players.map((p) => p.stats?.[key]?.bat).filter(Boolean);
    const H = bats.reduce((a, b) => a + b.h, 0), AB = bats.reduce((a, b) => a + b.ab, 0);
    const TB = bats.reduce((a, b) => a + b.h + b.d + 2 * b.t + 3 * b.hr, 0);
    if (AB > 10000) {
      const nudge = (k, v) => { lg.ratingNorm[k].mean = clamp(lg.ratingNorm[k].mean + clamp(v, -1.5, 1.5), 40, 60); };
      nudge('contact', (0.264 - H / AB) * 200);
      nudge('power', (0.388 - TB / AB) * 80);
    }
  }
  const report = developAndContracts(lg);
  lg.offseason = { step: 'review', report };
}

// ───────────── 성장 / 노쇠 ─────────────

function growRating(rng, cur, pot, age, kind) {
  let next = cur;
  if (age <= 27) {
    const rate = age <= 21 ? 0.22 : age <= 24 ? 0.18 : 0.12;
    next = cur + Math.max(0, pot - cur) * rate + rng.normal(-0.3, 1.5);
    next = Math.min(next, Math.max(cur, pot));
  } else if (age <= 29) {
    next = cur + Math.max(0, pot - cur) * 0.04 + rng.normal(-0.2, 1.2);
  } else {
    const slow = kind === 'eye' || kind === 'control' ? 0.6 : 1;
    next = cur - ((age - 29) * 0.7 + 0.6) * slow + rng.normal(0, 1.2);
  }
  return Math.round(clamp(next, 20, 80));
}

export function developPlayer(rng, p) {
  p.age++;
  const r = p.ratings, pot = p.potential;
  const before = overall(p);
  if (p.type === 'H') {
    for (const k of ['contact', 'power', 'eye', 'avoidK']) {
      r[k] = growRating(rng, r[k], pot[k], p.age, k);
      if (p.age > 27) pot[k] = Math.max(r[k], pot[k] - (p.age > 30 ? 1.5 : 0.5));
    }
    const d0 = r.def[p.pos];
    r.def[p.pos] = growRating(rng, d0, pot.def ?? d0, p.age, 'def');
    const dd = r.def[p.pos] - d0;
    for (const k of Object.keys(r.def)) if (k !== p.pos) r.def[k] = Math.round(clamp(r.def[k] + dd, 20, 80));
    if (p.age >= 27) r.speed = Math.round(clamp(r.speed - (p.age - 26) * 0.6 + rng.normal(0, 1.2), 20, 80));
    else r.speed = Math.round(clamp(r.speed + rng.normal(0.3, 1.2), 20, 80));
    if (p.age >= 31) r.arm = Math.round(clamp(r.arm - 0.8 + rng.normal(0, 1), 20, 80));
  } else {
    const stuff0 = r.stuff;
    for (const k of ['control', 'stuff']) {
      r[k] = growRating(rng, r[k], pot[k], p.age, k);
      if (p.age > 27) pot[k] = Math.max(r[k], pot[k] - (p.age > 30 ? 1.5 : 0.5));
    }
    if (p.age <= 25) r.velo = Math.round(clamp(r.velo + Math.max(0, pot.velo - r.velo) * 0.3 + rng.normal(0, 1.2), 20, 80));
    else if (p.age >= 30) r.velo = Math.round(clamp(r.velo - (p.age - 29) * 0.55 + rng.normal(0, 1), 20, 80));
    const dStuff = r.stuff - stuff0;
    for (const x of r.pitches) x.grade = Math.round(clamp(x.grade + dStuff * 0.8 + rng.normal(0, 1.2), 20, 80));
    if (p.age >= 32) r.stamina = Math.round(clamp(r.stamina - 1 + rng.normal(0, 1), 20, 80));
  }
  // 어린 선수 잠재력은 변동이 있다 (각성/정체)
  if (p.age <= 24) {
    const shift = rng.normal(0, 2.2);
    for (const k of Object.keys(pot)) pot[k] = Math.round(clamp(pot[k] + shift, 20, 80));
  }
  p.injury = null;
  p.fatigue = 0;
  p.condition = 0;
  return overall(p) - before;
}

// ───────────── 리그 능력치 정규화 ─────────────
// 성장/노쇠가 누적되며 타고투저·투고타저로 흐르지 않도록, 1군 평균을 기준값 쪽으로 70% 되돌린다.
const H_KEYS = ['contact', 'power', 'eye', 'avoidK'];
const P_KEYS = ['control', 'stuff', 'velo'];

export function ratingMeans(lg) {
  const act = lg.teams.flatMap((t) => t.roster);
  const H = act.filter((p) => p.type === 'H'), P = act.filter((p) => p.type === 'P');
  const stat = (arr, f) => {
    const v = arr.map(f);
    const mean = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, v.length)) || 1;
    return { mean, sd };
  };
  const m = {};
  for (const k of H_KEYS) m[k] = stat(H, (p) => p.ratings[k]);
  m.speed = stat(H, (p) => p.ratings.speed);
  m.def = stat(H, (p) => p.ratings.def[p.pos] ?? 50);
  for (const k of P_KEYS) m[k] = stat(P, (p) => p.ratings[k]);
  m.pitchGrade = stat(P.flatMap((p) => p.ratings.pitches), (x) => x.grade);
  return m;
}

/** 평균과 분산을 기준값 쪽으로 되돌린다 (x' = 목표평균 + (x-현재평균)×목표SD/현재SD, 70% 반영) */
export function normalizeRatings(lg) {
  const base = lg.ratingNorm;
  if (!base || typeof base.contact !== 'object') return;
  const cur = ratingMeans(lg);
  const everyone = [...allPlayers(lg), ...(lg.draftPool || [])];
  const tf = (k) => {
    const c = cur[k], b = base[k];
    return (x) => {
      const target = b.mean + (x - c.mean) * (b.sd / c.sd);
      return Math.round(clamp(x + (target - x) * 0.7, 20, 80));
    };
  };
  for (const k of [...H_KEYS, ...P_KEYS]) {
    const f = tf(k);
    const isH = H_KEYS.includes(k);
    for (const p of everyone) {
      if ((p.type === 'H') !== isH) continue;
      p.ratings[k] = f(p.ratings[k]);
      if (p.potential[k] != null) p.potential[k] = f(p.potential[k]);
    }
  }
  if (base.def) {
    const fs = tf('speed'), fd = tf('def');
    for (const p of everyone) {
      if (p.type !== 'H') continue;
      p.ratings.speed = fs(p.ratings.speed);
      const d0 = p.ratings.def[p.pos];
      if (d0 == null) continue;
      const dd = fd(d0) - d0;
      for (const k of Object.keys(p.ratings.def)) p.ratings.def[k] = Math.round(clamp(p.ratings.def[k] + dd, 20, 80));
      if (p.potential.def != null) p.potential.def = Math.round(clamp(p.potential.def + dd, 20, 80));
    }
  }
  const fg = tf('pitchGrade');
  for (const p of everyone) if (p.type === 'P') for (const x of p.ratings.pitches) x.grade = fg(x.grade);
}

/** 성장/노쇠, 은퇴, 계약 만료 처리. 반환: 내 팀 리포트 */
function developAndContracts(lg) {
  const rng = new Rng('offseason', lg.seed, lg.season);
  const key = seasonKey(lg.season);
  const report = { changes: [], retired: [], toFA: [], resigned: [] };
  const my = myTeam(lg);

  for (const t of lg.teams) {
    for (const p of [...t.roster, ...t.reserve]) {
      const played = p.stats?.[key];
      if (played && ((played.bat?.g || 0) >= 20 || (played.pit?.g || 0) >= 10)) p.service++;
      const delta = developPlayer(rng, p);
      if (t === my) report.changes.push({ id: p.id, name: p.name, age: p.age, delta, ovr: overall(p) });
    }
  }
  for (const p of lg.freeAgents) developPlayer(rng, p);
  normalizeRatings(lg);

  // 은퇴
  for (const t of lg.teams) {
    for (const arr of [t.roster, t.reserve]) {
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        if (retires(rng, p)) {
          arr.splice(i, 1);
          if (t === my) report.retired.push(p.name);
          if (overall(p) >= 55 || t === my) addNews(lg, `[은퇴] ${t.short} ${p.name} (${p.age}세) 현역 은퇴`, t.id);
        }
      }
    }
  }
  lg.freeAgents = lg.freeAgents.filter((p) => !(p.age >= 31 && rng.chance(0.5)) && !retires(rng, p));

  // 계약 만료
  for (const t of lg.teams) {
    for (const arr of [t.roster, t.reserve]) {
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        if (!p.contract) p.contract = { salary: 3000, years: 1 };
        p.contract.years--;
        if (p.contract.years > 0) continue;
        if (p.service >= 8 && t.id !== lg.myTeamId && overall(p) >= 47 && p.age <= 35 && rng.chance(0.6)) {
          // AI 구단은 상당수 FA를 원소속팀에서 잔류시킨다
          setAsking(rng, p, t.id);
          p.contract = { salary: p.asking.salary, years: p.asking.years };
          delete p.asking;
          if (overall(p) >= 60) addNews(lg, `[FA 잔류] ${t.short} ${p.name}, ${p.contract.years}년 총액 ${fmtMoney(p.contract.salary * p.contract.years)}`, t.id);
        } else if (p.service >= 8) {
          // FA 자격 → 시장으로
          arr.splice(i, 1);
          setAsking(rng, p, t.id);
          lg.freeAgents.push(p);
          if (t === my) report.toFA.push(p.name);
          if (overall(p) >= 58 || t === my) addNews(lg, `[FA] ${t.short} ${p.name} FA 자격 취득`, t.id);
        } else {
          // 보류권: 1년 재계약 (성적 반영 연봉)
          const e = p.stats?.[key];
          const perf = e ? clamp(war(p, e, leagueBaseline(allTeamPlayers(lg), key)), -1, 6) : 0;
          const sal = Math.max(3000, Math.round(serviceSalary(p, rng) * (1 + perf * 0.08) / 100) * 100);
          const old = p.contract.salary;
          p.contract = { salary: sal, years: 1 };
          if (t === my) report.resigned.push({ name: p.name, from: old, to: sal });
        }
      }
    }
    if (t.id === lg.myTeamId) { autoDepthChart(t); ensureLineup(t); } else autoRoster(t);
  }
  return report;
}

function retires(rng, p) {
  if (p.age >= 41) return true;
  if (p.age < 34) return false;
  const ov = overall(p);
  return rng.chance(0.1 * (p.age - 33) + (ov < 45 ? 0.3 : ov < 50 ? 0.12 : 0));
}

function setAsking(rng, p, fromTeam) {
  const sal = Math.round(marketSalary(p) * (0.95 + rng.next() * 0.25) / 100) * 100;
  const years = p.age <= 29 ? 4 : p.age <= 31 ? 3 : p.age <= 33 ? 2 : 1;
  p.asking = { salary: sal, years };
  p.prevTeam = fromTeam ?? p.prevTeam ?? null;
  p.contract = null;
}

// ───────────── FA ─────────────

export function ensureAsking(lg) {
  const rng = new Rng('asking', lg.seed, lg.season);
  for (const p of lg.freeAgents) if (!p.asking) setAsking(rng, p, p.prevTeam);
}

/** 사용자 FA 제안 */
export function offerFA(lg, pid, salary, years) {
  const i = lg.freeAgents.findIndex((p) => p.id === pid);
  if (i < 0) return { ok: false, msg: '자유계약 선수가 아닙니다' };
  const p = lg.freeAgents[i];
  const t = myTeam(lg);
  if (t.roster.length + t.reserve.length >= TOTAL_MAX) return { ok: false, msg: `소속 선수 한도(${TOTAL_MAX}명)를 넘습니다. 먼저 방출하세요` };
  const ask = p.asking || { salary: marketSalary(p), years: 1 };
  const yearsAdj = 1 + 0.04 * clamp(years - ask.years, -2, 2) * (p.age >= 31 ? 1 : -0.5);
  const score = (salary / ask.salary) * yearsAdj;
  const rng = new Rng('mood', lg.seed, lg.season, pid, salary, years);
  const need = 0.97 + rng.next() * 0.06;
  if (score < need) return { ok: false, msg: `${p.name}: "조건이 맞지 않습니다." (요구: ${fmtMoney(ask.salary)} × ${ask.years}년)` };
  lg.freeAgents.splice(i, 1);
  p.contract = { salary, years };
  delete p.asking;
  if (t.roster.length < ACTIVE_MAX) t.roster.push(p); else t.reserve.push(p);
  addNews(lg, `[FA 계약] ${t.name}, ${p.name}와 ${years}년 총액 ${fmtMoney(salary * years)} 계약`, t.id);
  return { ok: true, msg: `${p.name} 영입 성공!` };
}

/** AI 구단 FA 영입 */
export function aiSignFreeAgents(lg, rounds = 1) {
  const rng = new Rng('aifa', lg.seed, lg.season, lg.phase, lg.day);
  const fas = lg.freeAgents.slice().sort((a, b) => overall(b) - overall(a));
  for (const p of fas) {
    if (overall(p) < 44) break;
    const ask = p.asking || { salary: marketSalary(p), years: 1 };
    const cands = lg.teams.filter((t) => t.id !== lg.myTeamId && t.roster.length + t.reserve.length < 58
      && payroll(t) + ask.salary < SOFT_CAP * 1.1);
    if (!cands.length) continue;
    // 필요도: 해당 포지션 주전보다 좋으면 관심
    const interest = cands.map((t) => {
      const same = [...t.roster, ...t.reserve].filter((x) => (p.type === 'P' ? x.type === 'P' && x.role === p.role : x.pos === p.pos));
      const best = Math.max(30, ...same.map(overall));
      return [t, Math.max(0, overall(p) - best + 6) + rng.next() * 3];
    }).filter(([, v]) => v > 2);
    if (!interest.length || !rng.chance(0.75)) continue;
    interest.sort((a, b) => b[1] - a[1]);
    const t = interest[0][0];
    lg.freeAgents.splice(lg.freeAgents.indexOf(p), 1);
    const salary = Math.round(ask.salary * (0.95 + rng.next() * 0.2) / 100) * 100;
    p.contract = { salary, years: ask.years };
    delete p.asking;
    t.reserve.push(p);
    autoRoster(t);
    if (overall(p) >= 55) addNews(lg, `[FA 계약] ${t.short}, ${p.name} 영입 (${ask.years}년 총액 ${fmtMoney(salary * ask.years)})`, t.id);
  }
  // 2차: 인원이 모자란 구단은 저렴한 즉시전력감으로 보강
  for (const t of lg.teams) {
    if (t.id === lg.myTeamId) continue;
    for (const type of ['H', 'P']) {
      const have = () => [...t.roster, ...t.reserve].filter((x) => x.type === type).length;
      while (have() < 20) {
        const c = lg.freeAgents.filter((x) => x.type === type && x.age <= 34).sort((a, b) => overall(b) - overall(a))[0];
        if (!c || overall(c) < 38) break;
        lg.freeAgents.splice(lg.freeAgents.indexOf(c), 1);
        const ask = c.asking || { salary: marketSalary(c), years: 1 };
        c.contract = { salary: ask.salary, years: Math.min(2, ask.years) };
        delete c.asking;
        t.reserve.push(c);
      }
    }
    autoRoster(t);
  }
}

// ───────────── 드래프트 ─────────────

export const DRAFT_ROUNDS = 5;

export function startDraft(lg) {
  const rng = new Rng('draftpool', lg.seed, lg.season);
  const used = new Set(allPlayers(lg).map((p) => p.name));
  lg.draftPool = Array.from({ length: 75 }, () => makeProspect(rng, used));
  // 지명 순서: 정규시즌 역순
  const order = (lg.finalStandings || lg.teams.map((t) => ({ id: t.id }))).map((r) => r.id).reverse();
  lg.draft = { order, pick: 0, picks: [] };
  lg.nextPlayerId = getNextPlayerId();
}

export function draftOnClock(lg) {
  const d = lg.draft;
  if (!d || d.pick >= d.order.length * DRAFT_ROUNDS) return null;
  return { teamId: d.order[d.pick % d.order.length], round: Math.floor(d.pick / d.order.length) + 1, pickNo: d.pick + 1 };
}

export function draftPlayer(lg, teamId, pid) {
  const oc = draftOnClock(lg);
  if (!oc || oc.teamId !== teamId) return { ok: false, msg: '지명 차례가 아닙니다' };
  const i = lg.draftPool.findIndex((p) => p.id === pid);
  if (i < 0) return { ok: false, msg: '드래프트 대상이 아닙니다' };
  const [p] = lg.draftPool.splice(i, 1);
  const t = teamById(lg, teamId);
  p.contract = { salary: 3000, years: 4 };
  p.draft = { season: lg.season, round: oc.round, pick: oc.pickNo, team: teamId };
  t.reserve.push(p);
  lg.draft.picks.push({ ...oc, pid: p.id, name: p.name, pos: p.pos });
  lg.draft.pick++;
  if (teamId === lg.myTeamId || oc.round === 1) addNews(lg, `[드래프트] ${oc.round}라운드 ${oc.pickNo}순위 ${t.short} — ${p.name} (${p.type === 'P' ? '투수' : p.pos}, ${p.age}세)`, teamId);
  return { ok: true, msg: `${p.name} 지명` };
}

/** AI 구단 평가: 잠재력 위주 + 약간의 오차 */
function aiDraftValue(p) {
  return potentialOverall(p) * 0.75 + overall(p) * 0.25 + (p.scoutNoise || 0) * 0.5;
}

/** 사용자 차례가 올 때까지(또는 끝까지) AI 지명. auto=true면 사용자 픽도 자동 */
export function runDraft(lg, auto = false) {
  for (;;) {
    const oc = draftOnClock(lg);
    if (!oc) return null;
    if (oc.teamId === lg.myTeamId && !auto) return oc;
    const team = teamById(lg, oc.teamId);
    const needP = team.reserve.filter((p) => p.type === 'P').length < team.reserve.filter((p) => p.type === 'H').length;
    const best = lg.draftPool.slice().sort((a, b) => aiDraftValue(b) + (needP && b.type === 'P' ? 1 : 0) - aiDraftValue(a) - (needP && a.type === 'P' ? 1 : 0))[0];
    if (!best) return null;
    draftPlayer(lg, oc.teamId, best.id);
  }
}

// ───────────── 새 시즌 ─────────────

export function startNewSeason(lg) {
  lg.season++;
  lg.phase = 'regular';
  lg.day = 0;
  lg.postseason = null;
  lg.offseason = null;
  lg.draft = null;
  lg.draftPool = [];
  lg.lastGame = null;
  lg.schedule = makeSchedule(lg.teams.map((t) => t.id), lg.season, lg.seed);
  const rng = new Rng('newseason', lg.seed, lg.season);
  for (const t of lg.teams) {
    t.rotationIndex = 0;
    const total = () => t.roster.length + t.reserve.length;
    if (t.id !== lg.myTeamId) {
      // AI: 정원 초과 시 하위 선수 방출
      while (total() > 55) {
        const all = [...t.roster, ...t.reserve].sort((a, b) => overall(a) - overall(b) + (potentialOverall(a) - potentialOverall(b)) * 0.5);
        const p = all[0];
        const arr = t.roster.includes(p) ? t.roster : t.reserve;
        arr.splice(arr.indexOf(p), 1);
        p.contract = null;
        if (p.age < 32 && overall(p) >= 40) lg.freeAgents.push(p);
      }
      autoRoster(t);
    } else {
      while (t.roster.length > ACTIVE_MAX) t.reserve.push(t.roster.pop());
      // 1군이 26명 미만이면 2군 최고 선수로 채움
      for (const type of ['P', 'H']) {
        while (t.roster.length < 26 && t.roster.filter((p) => p.type === type).length < 13) {
          const c = t.reserve.filter((p) => p.type === type).sort((a, b) => overall(b) - overall(a))[0];
          if (!c) break;
          t.reserve.splice(t.reserve.indexOf(c), 1);
          t.roster.push(c);
          addNews(lg, `${c.name} 1군 등록 (엔트리 보충)`, t.id);
        }
      }
      ensureLineup(t);
    }
  }
  // AI 구단 전력 평준화: 리그 평균 쪽으로 절반만 당긴다 (사용자 구단은 제외 → 운영 결과가 그대로 남는다)
  equalizeTeams(lg.teams, { factor: 0.5, passes: 1, skip: new Set([lg.myTeamId]) });
  // 남은 FA는 요구 조건 하락
  for (const p of lg.freeAgents) {
    if (p.asking) p.asking.salary = Math.max(3000, Math.round(p.asking.salary * 0.8 / 100) * 100);
    else setAsking(rng, p, p.prevTeam);
  }
  addNews(lg, `${lg.season} 시즌 개막!`);
}

export function fmtMoney(manwon) {
  if (manwon >= 10000) {
    const eok = manwon / 10000;
    return `${eok >= 10 ? eok.toFixed(0) : eok.toFixed(1).replace(/\.0$/, '')}억`;
  }
  return `${manwon.toLocaleString()}만`;
}

export { scoutPotential, avg, era };
