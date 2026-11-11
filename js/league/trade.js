// 트레이드: AI 구단의 선수 가치 평가와 수락 판단
import { overall, potentialOverall, marketSalary } from '../data/playerGen.js';
import { autoRoster } from '../data/teamGen.js';
import { teamById, myTeam, addNews, TRADE_DEADLINE_DAY } from './season.js';
import { ensureLineup, TOTAL_MAX, ACTIVE_MAX } from './roster.js';

/** AI가 보는 선수 가치 (실제 잠재력을 어느 정도 안다고 가정) */
export function tradeValue(p) {
  const ov = overall(p);
  const pot = potentialOverall(p);
  const w = p.age <= 22 ? 0.6 : p.age <= 25 ? 0.45 : p.age <= 28 ? 0.2 : 0;
  let blend = ov + (pot - ov) * w;
  if (p.age >= 33) blend -= (p.age - 32) * 1.2;
  let v = Math.exp((blend - 45) / 6);
  // 계약 대비 가성비
  const sal = p.contract?.salary ?? 3000;
  const mkt = marketSalary(p);
  v *= Math.max(0.55, Math.min(1.3, 1 + ((mkt - sal) / mkt) * 0.3));
  if (p.injury?.days > 30) v *= 0.7;
  return v;
}

export function tradeWindowOpen(lg) {
  if (lg.phase === 'postseason') return { open: false, msg: '포스트시즌 중에는 트레이드할 수 없습니다' };
  if (lg.phase === 'regular' && lg.day >= TRADE_DEADLINE_DAY) return { open: false, msg: '트레이드 마감 기한이 지났습니다 (시즌 종료 후 재개)' };
  return { open: true };
}

/**
 * @param give 내가 주는 선수 id[]
 * @param get 상대에게 받는 선수 id[]
 */
export function evaluateTrade(lg, partnerId, give, get) {
  const me = myTeam(lg), them = teamById(lg, partnerId);
  const mine = [...me.roster, ...me.reserve], theirs = [...them.roster, ...them.reserve];
  const G = give.map((id) => mine.find((p) => p.id === id)).filter(Boolean);
  const R = get.map((id) => theirs.find((p) => p.id === id)).filter(Boolean);
  if (!G.length || !R.length) return { accept: false, msg: '주고받을 선수를 각각 1명 이상 고르세요' };
  const vin = G.reduce((a, p) => a + tradeValue(p), 0);
  const vout = R.reduce((a, p) => a + tradeValue(p), 0);
  const ratio = vin / vout;
  // 인원 제약
  const count = (arr, type) => arr.filter((p) => p.type === type).length;
  const afterThem = theirs.filter((p) => !R.includes(p)).concat(G);
  const afterMe = mine.filter((p) => !G.includes(p)).concat(R);
  if (count(afterThem, 'H') < 14 || count(afterThem, 'P') < 14) return { accept: false, ratio, msg: `${them.short}: "그렇게 되면 선수가 모자랍니다."` };
  if (afterMe.length > TOTAL_MAX) return { accept: false, ratio, msg: `소속 선수 한도(${TOTAL_MAX}명)를 넘습니다` };
  const meActive = me.roster.filter((p) => !G.includes(p));
  if (count(meActive, 'H') < 10 || count(meActive, 'P') < 8) return { accept: false, ratio, msg: '내 1군 인원이 부족해집니다. 먼저 2군에서 올리세요' };
  // 3명 이상 받는 쪽은 로스터 부담 → 할인
  const need = 1.12 + Math.max(0, G.length - R.length) * 0.08;
  if (ratio >= need) return { accept: true, ratio, msg: `${them.short}: "좋습니다, 거래하죠."` };
  if (ratio >= need * 0.85) return { accept: false, ratio, msg: `${them.short}: "조금만 더 얹어주시면 생각해보겠습니다."` };
  return { accept: false, ratio, msg: `${them.short}: "그 조건으로는 어렵습니다."` };
}

export function executeTrade(lg, partnerId, give, get) {
  const ev = evaluateTrade(lg, partnerId, give, get);
  if (!ev.accept) return ev;
  const me = myTeam(lg), them = teamById(lg, partnerId);
  const take = (team, ids) => {
    const out = [];
    for (const arr of [team.roster, team.reserve]) {
      for (let i = arr.length - 1; i >= 0; i--) if (ids.includes(arr[i].id)) out.push(...arr.splice(i, 1));
    }
    return out;
  };
  const G = take(me, give), R = take(them, get);
  for (const p of R) (me.roster.length < ACTIVE_MAX ? me.roster : me.reserve).push(p);
  them.reserve.push(...G);
  autoRoster(them);
  ensureLineup(me);
  addNews(lg, `[트레이드] ${me.short} ↔ ${them.short}: ${G.map((p) => p.name).join(', ')} ↔ ${R.map((p) => p.name).join(', ')}`, me.id);
  return { ...ev, done: true };
}
