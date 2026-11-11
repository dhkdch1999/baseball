// 저장/불러오기: 슬롯 3개 + JSON 내보내기/가져오기
import { app, navigate, setLeague, render } from '../app.js';
import { SLOTS, slotMeta, saveToSlot, loadFromSlot, deleteSlot, exportJSON, importJSONFile } from '../../save/storage.js';
import { esc, toast } from '../common.js';

export const savesView = {
  render(el) {
    const live = app.live && !app.live.done;
    el.innerHTML = `<section class="card"><h2>저장 / 불러오기</h2>
      ${live ? '<p class="warn">경기 진행 중에는 저장할 수 없습니다. 경기를 마친 뒤 저장하세요. (경기가 끝나면 자동 저장됩니다)</p>' : ''}
      <p class="subtle">현재 슬롯: ${app.slot ? `슬롯 ${app.slot}` : '없음'} · <label class="chk"><input type="checkbox" id="svAuto" ${app.autosave ? 'checked' : ''}> 하루 진행·경기 종료 때 자동 저장</label></p>
      <div class="slot-list">${SLOTS.map((s) => {
        const m = slotMeta(s);
        return `<div class="slot ${app.slot === s ? 'cur' : ''}"><b>슬롯 ${s}</b>
          ${m ? `${esc(m.team)} · ${m.season} ${m.phase === 'regular' ? `${m.day + 1}일차` : m.phase === 'postseason' ? '포스트시즌' : '오프시즌'} <span class="subtle">${new Date(m.savedAt).toLocaleString('ko-KR')}</span>` : '<span class="subtle">비어 있음</span>'}
          <span class="spacer"></span>
          <button data-save="${s}" ${live ? 'disabled' : ''}>여기에 저장</button>
          ${m ? `<button data-load="${s}">불러오기</button><button data-del="${s}" class="danger">삭제</button>` : ''}</div>`;
      }).join('')}</div>
      <div class="row" style="margin-top:12px">
        <button id="svExport" ${live ? 'disabled' : ''}>JSON 파일로 내보내기</button>
        <label class="file-btn">JSON 파일 불러오기 <input type="file" id="svImport" accept=".json,application/json" hidden></label>
        <button id="svNew" class="ghost-dark">새 게임</button>
      </div></section>`;
    el.querySelector('#svAuto').onchange = (e) => { app.autosave = e.target.checked; };
    el.querySelectorAll('[data-save]').forEach((b) => b.onclick = () => {
      const s = Number(b.dataset.save);
      const r = saveToSlot(app.lg, s);
      if (r.ok) app.slot = s;
      toast(r.msg, r.ok ? 'info' : 'error');
      render();
    });
    el.querySelectorAll('[data-load]').forEach((b) => b.onclick = () => {
      if (!confirm('저장하지 않은 진행 상황은 사라집니다. 불러올까요?')) return;
      try { const s = Number(b.dataset.load); setLeague(loadFromSlot(s), s); toast('불러왔습니다'); navigate('home'); } catch (e) { toast(e.message, 'error'); }
    });
    el.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
      if (!confirm('이 슬롯을 삭제할까요?')) return;
      deleteSlot(Number(b.dataset.del));
      if (app.slot === Number(b.dataset.del)) app.slot = null;
      render();
    });
    el.querySelector('#svExport').onclick = () => exportJSON(app.lg);
    el.querySelector('#svImport').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { setLeague(await importJSONFile(f), app.slot); toast('불러왔습니다'); navigate('home'); } catch (err) { toast(err.message, 'error'); }
    };
    el.querySelector('#svNew').onclick = () => {
      if (!confirm('새 게임을 시작할까요? 현재 진행 상황은 저장된 슬롯에만 남습니다.')) return;
      app.lg = null; app.live = null; app.slot = null;
      navigate('start');
    };
  },
};
