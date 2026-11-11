// 로스터 관리: 1군/2군 이동, 방출, 라인업 유효성, 부상 대체 콜업
import { autoDepthChart, ACTIVE_MAX } from '../data/teamGen.js';
import { overall, offenseScore, pitcherScore } from '../data/playerGen.js';

export { ACTIVE_MAX };
export const TOTAL_MAX = 65; // 구단 소속 선수 한도 (KBO 65명)
const FIELD = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

export const healthy = (p) => !p.injury;

export function findTeamOf(league, pid) {
  for (const t of league.teams) {
    if (t.roster.some((p) => p.id === pid)) return { team: t, where: 'roster' };
    if (t.reserve.some((p) => p.id === pid)) return { team: t, where: 'reserve' };
  }
  return null;
}

export function promote(team, pid) {
  if (team.roster.length >= ACTIVE_MAX) return { ok: false, msg: `1군 엔트리는 최대 ${ACTIVE_MAX}명입니다` };
  const i = team.reserve.findIndex((p) => p.id === pid);
  if (i < 0) return { ok: false, msg: '2군에 없는 선수입니다' };
  const [p] = team.reserve.splice(i, 1);
  team.roster.push(p);
  return { ok: true, msg: `${p.name} 1군 등록` };
}

export function demote(team, pid) {
  const i = team.roster.findIndex((p) => p.id === pid);
  if (i < 0) return { ok: false, msg: '1군에 없는 선수입니다' };
  const p = team.roster[i];
  const left = team.roster.filter((x) => x.type === p.type && x.id !== pid).length;
  if (left < (p.type === 'P' ? 8 : 10)) return { ok: false, msg: p.type === 'P' ? '1군 투수는 최소 8명 필요합니다' : '1군 야수는 최소 10명 필요합니다' };
  team.roster.splice(i, 1);
  team.reserve.push(p);
  removeFromDepth(team, pid);
  return { ok: true, msg: `${p.name} 2군 말소` };
}

export function release(league, team, pid) {
  let arr = team.roster;
  let i = arr.findIndex((p) => p.id === pid);
  if (i < 0) { arr = team.reserve; i = arr.findIndex((p) => p.id === pid); }
  if (i < 0) return { ok: false, msg: '소속 선수가 아닙니다' };
  if (arr === team.roster) {
    const p = arr[i];
    const left = team.roster.filter((x) => x.type === p.type && x.id !== pid).length;
    if (left < (p.type === 'P' ? 8 : 10)) return { ok: false, msg: '1군 최소 인원 때문에 방출할 수 없습니다. 먼저 2군에서 올리세요' };
  }
  const [p] = arr.splice(i, 1);
  removeFromDepth(team, pid);
  p.contract = null;
  league.freeAgents.push(p);
  return { ok: true, msg: `${p.name} 방출 (자유계약 선수 명단으로 이동)` };
}

function removeFromDepth(team, pid) {
  if (team.rotation) team.rotation = team.rotation.filter((id) => id !== pid);
  if (team.bullpen) {
    const bp = team.bullpen;
    if (bp.closer === pid) bp.closer = null;
    bp.setup = bp.setup.filter((id) => id !== pid);
    bp.middle = bp.middle.filter((id) => id !== pid);
    bp.long = bp.long.filter((id) => id !== pid);
  }
}

/**
 * 사용자 팀 라인업 점검: 부상·미등록 선수를 같은 포지션 최적 선수로 자동 대체.
 * 사용자가 정한 타순은 최대한 유지한다. 반환: 바뀐 내용 메시지 배열
 */
export function ensureLineup(team) {
  const msgs = [];
  const active = new Map(team.roster.map((p) => [p.id, p]));
  const usable = (p) => p && p.type === 'H' && healthy(p);
  if (!team.lineup || team.lineup.length !== 9) { autoDepthChart(team); return ['라인업을 자동 편성했습니다']; }
  const used = new Set();
  const slots = team.lineup.map((l) => ({ ...l }));
  for (const s of slots) { const p = active.get(s.id); if (usable(p) && !used.has(p.id)) used.add(p.id); else s.bad = true; }
  for (const s of slots) {
    if (!s.bad) continue;
    const old = active.get(s.id) || null;
    const cands = team.roster.filter((p) => usable(p) && !used.has(p.id));
    if (!cands.length) { autoDepthChart(team); return ['출전 가능한 야수가 부족해 라인업을 자동 편성했습니다']; }
    const score = (p) => (s.pos === 'DH' ? offenseScore(p) : offenseScore(p) * 0.5 + (p.ratings.def[s.pos] ?? 25) * 0.5);
    cands.sort((a, b) => score(b) - score(a));
    const np = cands[0];
    used.add(np.id);
    msgs.push(`${s.pos === 'DH' ? '지명타자' : s.pos} ${old ? old.name : '공석'} → ${np.name}${old?.injury ? ' (부상)' : ''}`);
    s.id = np.id;
    delete s.bad;
  }
  // 포지션 중복/누락 점검
  const posSet = new Set(slots.map((s) => s.pos));
  if (posSet.size !== 9 || !FIELD.every((p) => posSet.has(p))) { autoDepthChart(team); return ['수비 위치가 맞지 않아 라인업을 자동 편성했습니다']; }
  team.lineup = slots.map(({ id, pos }) => ({ id, pos }));

  // 로테이션 / 불펜
  const pit = team.roster.filter((p) => p.type === 'P');
  const pitIds = new Set(pit.map((p) => p.id));
  team.rotation = (team.rotation || []).filter((id) => pitIds.has(id));
  if (team.rotation.length < 5) {
    const extra = pit.filter((p) => !team.rotation.includes(p.id) && healthy(p))
      .sort((a, b) => (b.role === 'SP') - (a.role === 'SP') || b.ratings.stamina - a.ratings.stamina);
    while (team.rotation.length < 5 && extra.length) {
      const p = extra.shift();
      team.rotation.push(p.id);
      msgs.push(`선발 로테이션에 ${p.name} 추가`);
    }
  }
  const bp = team.bullpen || { closer: null, setup: [], middle: [], long: [] };
  const okRp = (id) => pitIds.has(id) && !team.rotation.includes(id);
  bp.closer = okRp(bp.closer) ? bp.closer : null;
  bp.setup = bp.setup.filter(okRp);
  bp.middle = bp.middle.filter(okRp);
  bp.long = bp.long.filter(okRp);
  const assigned = new Set([bp.closer, ...bp.setup, ...bp.middle, ...bp.long]);
  const free = pit.filter((p) => !team.rotation.includes(p.id) && !assigned.has(p.id)).sort((a, b) => pitcherScore(b) - pitcherScore(a));
  if (bp.closer == null && free.length) { bp.closer = free.shift().id; msgs.push('마무리 투수 자동 지정'); }
  for (const p of free) bp.middle.push(p.id);
  team.bullpen = bp;
  return msgs;
}

/** 부상 등으로 1군 가용 인원이 모자라면 2군에서 콜업 (AI·사용자 공통). 반환: 메시지 */
export function callUpsIfNeeded(team) {
  const msgs = [];
  for (const type of ['H', 'P']) {
    const need = type === 'H' ? 11 : 11;
    let tries = 0;
    while (team.roster.filter((p) => p.type === type && healthy(p)).length < need && tries++ < 5) {
      const cand = team.reserve.filter((p) => p.type === type && healthy(p)).sort((a, b) => overall(b) - overall(a))[0];
      if (!cand) break;
      if (team.roster.length >= ACTIVE_MAX) {
        // 장기 부상자를 2군(부상자 명단)으로
        const inj = team.roster.filter((p) => p.injury).sort((a, b) => b.injury.days - a.injury.days)[0];
        if (!inj) break;
        team.roster.splice(team.roster.indexOf(inj), 1);
        team.reserve.push(inj);
        removeFromDepth(team, inj.id);
        msgs.push(`${inj.name} 부상으로 엔트리 말소`);
      }
      team.reserve.splice(team.reserve.indexOf(cand), 1);
      team.roster.push(cand);
      msgs.push(`${cand.name} 1군 콜업`);
    }
  }
  return msgs;
}

export function payroll(team) {
  return [...team.roster, ...team.reserve].reduce((a, p) => a + (p.contract?.salary || 0), 0);
}
