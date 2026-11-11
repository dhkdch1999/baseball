// 중계 상단 패널: 타석보기(스트라이크존 투구 위치) / 주루보기(수비 위치·주자·대기타석) + 미니 스코어보드
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PITCH_COLOR = { b: '#16a34a', s: '#f59e0b', x: '#2563eb', h: '#9333ea' };

// ───── 미니 스코어보드 (왼쪽 위) ─────
function overlay(game, snap, pitcher, pitches) {
  const [a, h] = snap.score;
  const t = game.teams;
  const dots = (n, max, cls) => Array.from({ length: max }, (_, i) => `<i class="${i < n ? cls : ''}"></i>`).join('');
  const b = snap.bases;
  const outs = Math.min(snap.outs, 3);
  return `<div class="ov">
    <div class="ov-t ${snap.half === 0 ? 'bat' : ''}" style="--tc:${t[0].color}"><span>${esc(t[0].short)}</span><b>${a}</b></div>
    <div class="ov-t ${snap.half === 1 ? 'bat' : ''}" style="--tc:${t[1].color}"><span>${esc(t[1].short)}</span><b>${h}</b></div>
    <div class="ov-inn">
      <div class="arr"><i class="${snap.half === 0 ? 'on' : ''}">▲</i><b>${snap.inning}</b><i class="${snap.half === 1 ? 'on' : ''}">▼</i></div>
      <svg viewBox="0 0 40 30" class="mini-dia"><rect x="15" y="1" width="10" height="10" transform="rotate(45 20 6)" class="${b[1] ? 'on' : ''}"/>
        <rect x="3" y="13" width="10" height="10" transform="rotate(45 8 18)" class="${b[2] ? 'on' : ''}"/>
        <rect x="27" y="13" width="10" height="10" transform="rotate(45 32 18)" class="${b[0] ? 'on' : ''}"/></svg>
    </div>
    <div class="ov-bso">
      <span>B</span><span class="d">${dots(snap.count[0], 3, 'b')}</span>
      <span>S</span><span class="d">${dots(snap.count[1], 2, 's')}</span>
      <span>O</span><span class="d">${dots(outs, 2, 'o')}</span>
    </div>
    <div class="ov-p"><span>${esc(pitcher?.name || '')}</span><span>투구수 ${pitches}</span></div>
  </div>`;
}

// ───── 타석보기 ─────
const ZX = (x) => 500 + x * 72;
const ZY = (z) => 318 - z * 88;

function batterFigure(bats, color) {
  // 포수 시점: 우타자는 왼쪽, 좌타자는 오른쪽에 선다
  const left = bats !== 'L';
  const x = left ? 330 : 670;
  const s = left ? 1 : -1;
  return `<g class="batter" transform="translate(${x} 0) scale(${s} 1)">
    <ellipse cx="0" cy="545" rx="70" ry="12" fill="rgba(0,0,0,.18)"/>
    <path d="M-28 545 L-14 430 L10 430 L22 545 L8 545 L0 470 L-12 545 Z" fill="#e8e8e8" stroke="#c9c9c9"/>
    <rect x="-32" y="330" width="56" height="110" rx="18" fill="${color}"/>
    <rect x="-34" y="420" width="60" height="16" rx="6" fill="#333"/>
    <circle cx="-2" cy="300" r="30" fill="${color}"/>
    <path d="M-30 300 Q-2 262 30 300 L40 306 L-30 306 Z" fill="${color}" stroke="rgba(0,0,0,.25)"/>
    <circle cx="10" cy="312" r="15" fill="#e9b892"/>
    <path d="M22 360 Q48 352 52 330" stroke="#e9b892" stroke-width="16" fill="none" stroke-linecap="round"/>
    <line x1="52" y1="332" x2="-10" y2="170" stroke="#8b5a2b" stroke-width="11" stroke-linecap="round"/>
  </g>`;
}

function batView(game, pa, lastPitch, batterColor) {
  const pitches = pa?.pitches || [];
  const markers = pitches.map((p, i) => {
    if (!p.loc) return '';
    const last = i === pitches.length - 1;
    return `<g class="pm ${last ? 'last' : ''}"><circle cx="${ZX(p.loc.x)}" cy="${ZY(p.loc.z)}" r="${(last ? 15 : 13) * Math.min(K, 1.4)}" fill="${PITCH_COLOR[p.cls]}"/>
      <text x="${ZX(p.loc.x)}" y="${ZY(p.loc.z) + 5 * Math.min(K, 1.4)}" style="font-size:${15 * Math.min(K, 1.4)}px">${p.n}</text></g>`;
  }).join('');
  const bw = 220 * K, bh = 62 * K, by = 180 - bh;
  const bub = (a, b) => `<g class="bubble"><rect x="${500 - bw / 2}" y="${by}" width="${bw}" height="${bh}" rx="8"/>
    <text x="500" y="${by + 25 * K}" style="font-size:${20 * K}px">${a}</text><text x="500" y="${by + 50 * K}" style="font-size:${20 * K}px">${b}</text></g>`;
  const bubble = lastPitch ? bub(`${lastPitch.n}구 ${esc(lastPitch.ko)}`, `${lastPitch.kmh}km/h`)
    : pa ? bub(`${pa.slot}번타자`, esc(pa.batter.name)) : '';
  const grid = [1, 2].map((i) => `<line x1="${ZX(-1) + (i * 144) / 3}" y1="${ZY(1)}" x2="${ZX(-1) + (i * 144) / 3}" y2="${ZY(-1)}"/><line x1="${ZX(-1)}" y1="${ZY(1) + (i * 176) / 3}" x2="${ZX(1)}" y2="${ZY(1) + (i * 176) / 3}"/>`).join('');
  return `<svg viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid slice" class="stage-svg">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fa8dc"/><stop offset="1" stop-color="#cfe2f3"/></linearGradient>
      <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f8f3f"/><stop offset="1" stop-color="#2e6e2e"/></linearGradient>
    </defs>
    <rect width="1000" height="170" fill="url(#sky)"/>
    <rect y="150" width="1000" height="140" fill="#1f3550"/>
    ${Array.from({ length: 6 }, (_, i) => `<rect y="${158 + i * 20}" width="1000" height="9" fill="rgba(255,255,255,${0.05 + (i % 2) * 0.04})"/>`).join('')}
    <rect y="282" width="1000" height="14" fill="#123"/>
    <rect y="296" width="1000" height="264" fill="url(#grass)"/>
    <ellipse cx="500" cy="560" rx="430" ry="150" fill="#b8865a"/>
    <path d="M150 560 L420 470 M850 560 L580 470" stroke="#fff" stroke-width="4" opacity=".85"/>
    <polygon points="465,500 535,500 535,515 500,532 465,515" fill="#fafafa" stroke="#ddd"/>
    ${batterFigure(pa?.batter?.bats, batterColor)}
    <rect x="${ZX(-1)}" y="${ZY(1)}" width="144" height="176" class="zone"/>
    <g class="zone-grid">${grid}</g>
    ${markers}
    ${bubble}
  </svg>`;
}

// ───── 주루보기 ─────
const FIELD_POS = {
  C: [500, 530], P: [500, 372], '1B': [700, 335], '2B': [600, 262], SS: [395, 262], '3B': [300, 335],
  LF: [250, 175], CF: [500, 112], RF: [750, 175],
};
const BASE_POS = [[652, 380], [500, 262], [348, 380]];

let K = 1; // 좁은 화면에서 글자·칩 확대 배율

function pill(x, y, text, cls = '') {
  const w = Math.max(56, String(text).length * 17 + 20) * K, h = 32 * K;
  return `<g class="pill ${cls}"><rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${h / 2}"/><text x="${x}" y="${y + 6 * K}" style="font-size:${17 * K}px">${esc(text)}</text></g>`;
}

function chip(x, y, name, color, label = '') {
  return `<g class="chip-p"><circle cx="${x}" cy="${y}" r="${24 * K}" fill="${color}" stroke="#fff" stroke-width="3"/>
    <text x="${x}" y="${y + 7 * K}" class="chip-l" style="font-size:${15 * K}px">${esc(label)}</text>${pill(x, y + 40 * K, name, 'light')}</g>`;
}

function fieldView(game, snap, pa, runners) {
  const def = 1 - snap.half;
  const d = game.defense[def];
  const defColor = game.teams[def].color, batColor = game.teams[snap.half].color;
  const fielders = Object.entries(FIELD_POS).filter(([pos]) => pos !== 'P').map(([pos, [x, y]]) => (d[pos] ? pill(x, y, d[pos].name) : '')).join('');
  const pitcher = d.P ? chip(FIELD_POS.P[0], FIELD_POS.P[1] - 8, d.P.name, defColor, 'P') : '';
  const batter = pa?.batter && !pa.result ? chip(pa.batter.bats === 'L' ? 590 : 410, 478, pa.batter.name, batColor, String(pa.slot)) : '';
  const run = runners.map((r, i) => (r ? chip(BASE_POS[i][0], BASE_POS[i][1] - 30, r.name, batColor, `${i + 1}루`) : '')).join('');
  return `<svg viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid slice" class="stage-svg">
    <rect width="1000" height="560" fill="#2f7a3d"/>
    <path d="M500 560 L-40 40 Q500 -120 1040 40 Z" fill="#358a45"/>
    <path d="M500 520 L190 330 Q500 120 810 330 Z" fill="#b89c79"/>
    <polygon points="500,470 615,380 500,290 385,380" fill="#358a45"/>
    <circle cx="500" cy="375" r="30" fill="#b89c79"/>
    <circle cx="500" cy="505" r="46" fill="#b89c79"/>
    <path d="M500 505 L20 70 M500 505 L980 70" stroke="#e8f0e8" stroke-width="3" opacity=".7"/>
    ${BASE_POS.map(([x, y]) => `<rect x="${x - 11}" y="${y - 11}" width="22" height="22" transform="rotate(45 ${x} ${y})" fill="#fff"/>`).join('')}
    <polygon points="489,500 511,500 511,510 500,518 489,510" fill="#fff"/>
    ${fielders}${pitcher}${batter}${run}
  </svg>`;
}

/**
 * @param mode 'bat' | 'field'
 */
export function renderStage(el, { game, snap, pa, lastPitch, mode, runnersNames }) {
  if (!snap) { el.innerHTML = ''; return; }
  K = el.clientWidth && el.clientWidth < 600 ? 1.75 : 1;
  const ps = game.ps[1 - snap.half];
  const batColor = game.teams[snap.half].color;
  let waiting = '';
  if (mode === 'field') {
    const side = snap.half;
    const idx = game.orderIdx[side];
    const nextStart = pa && !pa.result ? idx + 1 : idx;
    waiting = `<div class="waiting"><b>대기타석</b>${[0, 1, 2].map((k) => {
      const s = (nextStart + k) % 9;
      return `<div>${s + 1}.${esc(game.lineups[side][s].player.name)}</div>`;
    }).join('')}</div>`;
  }
  el.innerHTML = `${mode === 'field' ? fieldView(game, snap, pa, runnersNames) : batView(game, pa, lastPitch, batColor)}
    ${overlay(game, snap, ps.player, ps.pitches)}
    ${waiting}
    <button class="stage-toggle" data-stage="${mode === 'field' ? 'bat' : 'field'}">
      ${mode === 'field' ? '<span>⚾</span>타석보기' : '<span>◇</span>주루보기'}</button>`;
}
