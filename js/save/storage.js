// 세이브: localStorage 슬롯 3개 + JSON 파일 내보내기/불러오기
import { SAVE_VERSION, teamById } from '../league/season.js';

const KEY = (slot) => `bbgm.save.${slot}`;
const META = (slot) => `bbgm.meta.${slot}`;
export const SLOTS = [1, 2, 3];

function metaOf(lg) {
  const t = teamById(lg, lg.myTeamId);
  return {
    team: t?.name, teamId: lg.myTeamId, season: lg.season, phase: lg.phase, day: lg.day,
    savedAt: new Date().toISOString(),
  };
}

export function saveToSlot(lg, slot) {
  try {
    lg.version = SAVE_VERSION;
    localStorage.setItem(KEY(slot), JSON.stringify(lg));
    localStorage.setItem(META(slot), JSON.stringify(metaOf(lg)));
    return { ok: true, msg: `슬롯 ${slot}에 저장했습니다` };
  } catch (e) {
    return { ok: false, msg: `저장 실패: ${e.name === 'QuotaExceededError' ? '브라우저 저장 공간이 부족합니다. JSON으로 내보내세요' : e.message}` };
  }
}

export function loadFromSlot(slot) {
  const raw = localStorage.getItem(KEY(slot));
  if (!raw) return null;
  return parseSave(raw);
}

export function slotMeta(slot) {
  try { return JSON.parse(localStorage.getItem(META(slot)) || 'null'); } catch { return null; }
}

export function deleteSlot(slot) {
  localStorage.removeItem(KEY(slot));
  localStorage.removeItem(META(slot));
}

export function parseSave(text) {
  const lg = JSON.parse(text);
  if (!lg || !Array.isArray(lg.teams) || !lg.schedule) throw new Error('올바른 세이브 파일이 아닙니다');
  if ((lg.version || 0) < SAVE_VERSION) throw new Error(`이전 버전 세이브(v${lg.version || 1})는 불러올 수 없습니다`);
  return lg;
}

export function exportJSON(lg) {
  const blob = new Blob([JSON.stringify(lg)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `baseball-${lg.myTeamId}-${lg.season}-${lg.phase}-${lg.day}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function importJSONFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { try { resolve(parseSave(r.result)); } catch (e) { reject(e); } };
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/** 자동 저장 (마지막으로 사용한 슬롯) */
export function autosave(lg, slot) {
  if (!slot) return;
  saveToSlot(lg, slot);
}
