// 시작 화면: 새 게임(구단 선택) / 불러오기 / JSON 가져오기
import { app, navigate, setLeague, persist, renderHeader } from '../app.js';
import { newCareer } from '../../league/season.js';
import { generateLeague } from '../../data/teamGen.js';
import { overall } from '../../data/playerGen.js';
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
    const preview = generateLeague(seed);
    const slots = SLOTS.map((s) => ({ s, m: slotMeta(s) }));
    const firstEmpty = slots.find((x) => !x.m)?.s ?? 1;
    el.innerHTML = `
      <section class="card">
        <h2>새 게임 — 맡을 구단을 고르세요</h2>
        <p class="subtle">선수는 리그 시드로 랜덤 생성됩니다. 같은 시드면 같은 선수단이 나옵니다.</p>
        <div class="row">
          <label>리그 시드 <input id="stSeed" value="${esc(seed)}" size="12"></label>
          <button id="stReroll" class="ghost-dark">다른 선수단 보기</button>
          <label>저장 슬롯 <select id="stSlot">${SLOTS.map((s) => `<option value="${s}" ${s === firstEmpty ? 'selected' : ''}>슬롯 ${s}${slotMeta(s) ? ' (덮어쓰기)' : ''}</option>`).join('')}</select></label>
        </div>
        <div class="team-grid">
          ${preview.teams.map((t) => {
            const st = teamStrength(t);
            return `<button class="team-card ${chosen === t.id ? 'sel' : ''}" data-team="${t.id}" style="--tc:${t.color}">
              <div class="tc-name">${teamChip(t)}${esc(t.name)}</div>
              <div class="subtle">${esc(t.city)} · ${esc(t.park)}</div>
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
    el.querySelector('#stReroll').onclick = () => { app.params.seed = String(Math.floor(Math.random() * 1e6)); startView.render(el); };
    el.querySelector('#stSeed').onchange = (e) => { app.params.seed = e.target.value.trim() || 'kbo-1'; startView.render(el); };
    el.querySelector('#stGo').onclick = () => {
      const slot = Number(el.querySelector('#stSlot').value);
      const lg = newCareer({ seed: el.querySelector('#stSeed').value.trim() || 'kbo-1', myTeamId: chosen });
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
