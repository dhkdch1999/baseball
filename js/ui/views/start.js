// 시작 화면: 새 게임(구단 선택) / 불러오기 / JSON 가져오기
import { app, navigate, setLeague, persist, renderHeader } from '../app.js';
import { newCareer } from '../../league/season.js';
import { generateLeague } from '../../data/teamGen.js';
import { generateRealLeague, REAL_SEASON } from '../../data/realRoster.js';
import { overall, offenseScore } from '../../data/playerGen.js';
import { SLOTS, slotMeta, loadFromSlot, importJSONFile } from '../../save/storage.js';
import { esc, teamChip, toast } from '../common.js';

let chosen = null;

function teamStrength(t) {
  const top = (arr, n) => arr.map(overall).sort((a, b) => b - a).slice(0, n);
  const avgOf = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const bat = avgOf(top(t.roster.filter((p) => p.type === 'H'), 9));
  const pit = avgOf(top(t.roster.filter((p) => p.type === 'P'), 10));
  const farm = avgOf(top(t.reserve, 6));
  return { bat, pit, farm };
}

const bar = (v, lo = 40, hi = 60) => `<span class="bar"><i style="width:${Math.max(4, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%"></i></span>`;

export const startView = {
  render(el) {
    renderHeader();
    const seed = app.params.seed || 'kbo-1';
    const mode = app.params.mode || 'real';
    const preview = mode === 'real' ? generateRealLeague(seed) : generateLeague(seed);
    const star = (t) => {
      const h = t.roster.filter((p) => p.type === 'H').sort((a, b) => offenseScore(b) - offenseScore(a))[0];
      const p = t.roster.filter((x) => x.type === 'P').sort((a, b) => overall(b) - overall(a))[0];
      return `${esc(h.name)} · ${esc(p.name)}`;
    };
    const slots = SLOTS.map((s) => ({ s, m: slotMeta(s) }));
    const firstEmpty = slots.find((x) => !x.m)?.s ?? 1;
    el.innerHTML = `
      <section class="card">
        <h2>새 게임 — 맡을 구단을 고르세요</h2>
        <div class="mode-pick">
          <button data-mode="real" class="${mode === 'real' ? 'sel' : ''}"><b>실제 KBO 선수단</b><span>${REAL_SEASON} 시즌 기록으로 능력치를 정한 실제 선수들 (백업·2군 유망주 일부는 랜덤)</span></button>
          <button data-mode="random" class="${mode === 'random' ? 'sel' : ''}"><b>랜덤 선수단</b><span>가상의 선수들, 구단 간 전력이 고르게 맞춰짐</span></button>
        </div>
        <div class="row">
          <label>${mode === 'real' ? '랜덤 요소 시드' : '리그 시드'} <input id="stSeed" value="${esc(seed)}" size="12"></label>
          ${mode === 'random' ? '<button id="stReroll" class="ghost-dark">다른 선수단 보기</button>' : '<span class="subtle">실제 모드에서 시드는 2군 유망주와 숨은 잠재력에만 영향을 줍니다</span>'}
          <label>저장 슬롯 <select id="stSlot">${SLOTS.map((s) => `<option value="${s}" ${s === firstEmpty ? 'selected' : ''}>슬롯 ${s}${slotMeta(s) ? ' (덮어쓰기)' : ''}</option>`).join('')}</select></label>
        </div>
        <div class="team-grid">
          ${preview.teams.map((t) => {
            const st = teamStrength(t);
            return `<button class="team-card ${chosen === t.id ? 'sel' : ''}" data-team="${t.id}" style="--tc:${t.color}">
              <div class="tc-name">${teamChip(t)}${esc(t.name)}</div>
              <div class="subtle">${esc(t.city)} · ${esc(t.park)}</div>
              ${mode === 'real' ? `<div class="tc-star">대표 ${star(t)}</div>` : ''}
              <div class="tc-bars"><span>타선</span>${bar(st.bat)}<span>마운드</span>${bar(st.pit)}<span>2군</span>${bar(st.farm, 34, 54)}</div>
            </button>`;
          }).join('')}
        </div>
        <div class="row" style="margin-top:14px"><button id="stGo" class="primary" ${chosen ? '' : 'disabled'}>이 구단으로 시작</button></div>
      </section>
      <section class="card">
        <h2>이어하기</h2>
        <div class="slot-list">
          ${slots.map(({ s, m }) => `<div class="slot"><b>슬롯 ${s}</b> ${m ? `${esc(m.team)} · ${m.season} ${m.phase === 'regular' ? `${m.day + 1}일차` : m.phase === 'postseason' ? '포스트시즌' : '오프시즌'} <span class="subtle">${new Date(m.savedAt).toLocaleString('ko-KR')}</span> <button data-load="${s}">불러오기</button>` : '<span class="subtle">비어 있음</span>'}</div>`).join('')}
        </div>
        <div class="row" style="margin-top:10px"><label class="file-btn">JSON 파일 불러오기 <input type="file" id="stImport" accept=".json,application/json" hidden></label></div>
      </section>`;

    el.querySelectorAll('[data-team]').forEach((b) => b.onclick = () => { chosen = b.dataset.team; startView.render(el); });
    el.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { app.params.mode = b.dataset.mode; startView.render(el); });
    const rr = el.querySelector('#stReroll');
    if (rr) rr.onclick = () => { app.params.seed = String(Math.floor(Math.random() * 1e6)); startView.render(el); };
    el.querySelector('#stSeed').onchange = (e) => { app.params.seed = e.target.value.trim() || 'kbo-1'; startView.render(el); };
    el.querySelector('#stGo').onclick = () => {
      const slot = Number(el.querySelector('#stSlot').value);
      const lg = newCareer({ seed: el.querySelector('#stSeed').value.trim() || 'kbo-1', myTeamId: chosen, roster: mode });
      setLeague(lg, slot);
      persist();
      navigate('home');
    };
    el.querySelectorAll('[data-load]').forEach((b) => b.onclick = () => {
      try {
        const s = Number(b.dataset.load);
        setLeague(loadFromSlot(s), s);
        navigate('home');
      } catch (e) { toast(e.message, 'error'); }
    });
    el.querySelector('#stImport').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const lg = await importJSONFile(f);
        setLeague(lg, Number(el.querySelector('#stSlot').value));
        persist();
        toast('불러왔습니다');
        navigate('home');
      } catch (err) { toast(err.message, 'error'); }
    };
  },
};
