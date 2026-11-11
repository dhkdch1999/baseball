// 커리어 진행 오케스트레이션 (UI와 테스트에서 공통 사용)
import { simDay, myGameToday, todayGames } from './season.js';
import {
  startOffseason, ensureAsking, aiSignFreeAgents, startDraft, runDraft, startNewSeason, draftOnClock,
} from './offseason.js';

/** 오프시즌 진입 처리 (포스트시즌 종료 후 자동) */
export function syncPhase(lg) {
  if (lg.phase === 'offseason' && !lg.offseason) startOffseason(lg);
}

/** 하루 진행 (내 경기도 결과만). 반환: 진행 여부 */
export function advanceDay(lg) {
  if (lg.phase === 'offseason') return false;
  simDay(lg);
  syncPhase(lg);
  return true;
}

/**
 * 조건을 만족할 때까지 연속 진행.
 * stop: 'myGame' (내 경기 직전에 멈춤) | 'week' | 'month' | 'season'(정규시즌 끝) | 'postseason'(가을야구 끝)
 */
export function advanceUntil(lg, stop, { maxDays = 400 } = {}) {
  const startDay = lg.day;
  const startPhase = lg.phase;
  for (let i = 0; i < maxDays; i++) {
    if (lg.phase === 'offseason') return;
    if (stop === 'week' && lg.phase === 'regular' && lg.day - startDay >= 6) return;
    if (stop === 'month' && lg.phase === 'regular' && lg.day - startDay >= 26) return;
    if (stop === 'season' && startPhase === 'regular' && lg.phase !== 'regular') return;
    if (stop === 'myGame' && i > 0 && myGameToday(lg)) return;
    advanceDay(lg);
  }
}

/** 오프시즌 다음 단계로 */
export function nextOffseasonStep(lg) {
  const off = lg.offseason;
  if (!off) return;
  if (off.step === 'review') {
    ensureAsking(lg);
    off.step = 'fa';
  } else if (off.step === 'fa') {
    aiSignFreeAgents(lg);
    startDraft(lg);
    runDraft(lg, false);
    off.step = 'draft';
  } else if (off.step === 'draft') {
    if (draftOnClock(lg)) runDraft(lg, true);
    off.step = 'ready';
  } else if (off.step === 'ready') {
    startNewSeason(lg);
  }
}

export { todayGames };
