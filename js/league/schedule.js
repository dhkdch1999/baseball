// 정규시즌 일정: 팀당 144경기 (상대별 16경기, 홈/원정 8경기씩), 2연전 시리즈, 월요일 휴식
import { Rng } from '../core/rng.js';

/** 원형 방식 라운드로빈: 10팀 → 9라운드 × 5경기 */
function roundRobin(ids) {
  const n = ids.length;
  const arr = ids.slice();
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop()); // 첫 팀 고정 회전
  }
  return rounds;
}

/** 시즌 날짜 목록: 개막일부터 월요일 제외 */
export function seasonDates(year, count) {
  const dates = [];
  const d = new Date(Date.UTC(year, 2, 28)); // 3월 28일 개막
  while (dates.length < count) {
    if (d.getUTCDay() !== 1) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  const dow = '일월화수목금토'[new Date(iso + 'T00:00:00Z').getUTCDay()];
  return `${m}월 ${d}일 (${dow})`;
}

export function makeSchedule(teamIds, year, seed) {
  const rng = new Rng('schedule', seed, year);
  const base = roundRobin(teamIds);
  const days = [];
  for (let cycle = 0; cycle < 8; cycle++) {
    const order = rng.shuffle(base.map((_, i) => i));
    for (const ri of order) {
      const pairs = base[ri].map(([a, b]) => (cycle % 2 === 0 ? [a, b] : [b, a])); // [원정, 홈]
      for (let g = 0; g < 2; g++) days.push(pairs);
    }
  }
  const dates = seasonDates(year, days.length);
  let gid = 0;
  return days.map((pairs, i) => ({
    date: dates[i],
    games: pairs.map(([away, home]) => ({ id: `${year}-${++gid}`, away, home, result: null })),
  }));
}
