// 이벤트 → 중계 문장. DOM을 쓰지 않으므로 Node에서도 동작 (tools/replay.mjs).
// 문구 선택용 난수는 경기 난수와 분리되어 있어 문구가 경기 결과에 영향을 주지 않는다.
import { Rng } from '../../core/rng.js';
import { POS_KO } from '../../data/ratings.js';
import { P, PITCH_WORD, DIR_WORD, DIR_SINGLE, DIR_LINE, DIR_TO, HR_NAME } from './phrases.js';

/** 받침 여부에 따라 '으로'/'로' */
export function euro(word) {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return word + '로';
  const jong = (c - 0xac00) % 28;
  return word + (jong === 0 || jong === 8 ? '로' : '으로'); // 받침 없음 또는 ㄹ
}

const bb_isBunt = (e) => !!e.bb?.bunt;

const halfName = (inning, half) => `${inning}회${half === 0 ? '초' : '말'}`;

export class Narrator {
  constructor(seed) {
    this.rng = new Rng('narrator', seed);
    this.recent = new Map();
    this.pending = null; // 타석을 끝낸 마지막 투구 (결과와 한 줄로 합침)
    this.lastScore = [0, 0];
  }

  pick(key, pool = P[key]) {
    const rec = this.recent.get(key) || [];
    const memory = Math.min(3, pool.length - 1);
    let idx, tries = 0;
    do { idx = Math.floor(this.rng.next() * pool.length); } while (rec.includes(idx) && ++tries < 20);
    rec.push(idx);
    while (rec.length > memory) rec.shift();
    this.recent.set(key, rec);
    return pool[idx];
  }

  fill(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  }

  scoreText(snap) {
    return `(${snap.score[0]}:${snap.score[1]})`;
  }

  /** @returns [{text, cls, meta?}] */
  lines(e) {
    switch (e.t) {
      case 'gameStart': {
        const [a, h] = [e.away, e.home];
        return [
          { text: `${a.name} vs ${h.name} — ${h.park} 야구장`, cls: 'title' },
          { text: `선발투수: ${a.short} ${e.starters[0].name} / ${h.short} ${e.starters[1].name}`, cls: 'info' },
        ];
      }
      case 'halfStart':
        return [{ text: `[${halfName(e.inning, e.half)}] ${e.team.short} 공격`, cls: 'inning' }];
      case 'pa':
        return [{ text: `${e.slot}번타자 ${e.batter.name}`, cls: 'batter', meta: POS_KO[e.pos] }];
      case 'pitchingChange':
        return [{
          text: `투수 교체: ${e.out.name}(${e.oldPitches}구) → ${e.in.name}`,
          cls: 'change', meta: `${e.team.short} ${e.role}${e.byUser ? ' · 감독 지시' : ''}`,
        }];
      case 'sub':
        return [{
          text: `${e.kind === 'PH' ? '대타' : '대주자'} ${e.in.name} (← ${e.out.name})`,
          cls: 'change', meta: `${e.team.short} ${e.slot}번 타순`,
        }];
      case 'tactic':
        if (e.kind === 'shift') return [{ text: `[수비] ${e.team.short} ${{ pull: '당겨치기 대비 시프트', in: '내야 전진수비' }[e.mode]}`, cls: 'tactic' }];
        if (e.kind === 'buntSign') return [{ text: '번트 자세를 잡습니다', cls: 'tactic' }];
        if (e.kind === 'hitrun') return [{ text: '히트앤런 작전! 주자 스타트', cls: 'tactic' }];
        return [];
      case 'pitch':
        return this.pitchLine(e);
      case 'steal':
        return this.stealLine(e);
      case 'wildPitch':
        return this.wildPitchLine(e);
      case 'result':
        return this.resultLine(e);
      case 'halfEnd':
        return [{ text: `${halfName(e.inning, e.half)} 종료 — ${e.runs}득점${e.lob ? `, 잔루 ${e.lob}` : ''}`, cls: 'halfEnd' }];
      case 'gameEnd':
        return this.endLines(e);
      default:
        return [];
    }
  }

  pitchWord(pitch) {
    return this.pick('pw_' + pitch.result, PITCH_WORD[pitch.result]);
  }

  pitchLine(e) {
    const { pitch, count, n } = e;
    const terminal = pitch.result === 'inPlay' || pitch.result === 'hbp' || pitch.result === 'buntInPlay'
      || (pitch.result === 'buntFoul' && count[1] === 3)
      || (pitch.result === 'ball' && count[0] === 4)
      || ((pitch.result === 'calledStrike' || pitch.result === 'swingStrike') && count[1] === 3);
    const meta = `${pitch.ko} ${pitch.kmh}km`;
    if (e.tactic === 'bunt' && pitch.result === 'swingStrike') {
      return [{ text: `${n}구 번트 헛스윙 (${count[0]}-${count[1]})`, cls: 'pitch', meta }];
    }
    if (terminal) {
      this.pending = { n, pitch, meta };
      return [];
    }
    return [{ text: `${n}구 ${this.pitchWord(pitch)} (${count[0]}-${count[1]})`, cls: 'pitch', meta }];
  }

  runnerLabel(m) {
    return `${m.from}루주자 ${m.runner.player.name}`;
  }

  movesText(moves, { skipBatter = true } = {}) {
    const parts = [];
    for (const m of moves) {
      if (m.from === 0 && skipBatter) continue;
      if (m.from === 0) continue;
      if (m.to === 4) parts.push(`${this.runnerLabel(m)} 홈인`);
      else if (m.to === 'out') parts.push(`${this.runnerLabel(m)} 아웃`);
      else if (m.to - m.from >= 2) parts.push(`${this.runnerLabel(m)} ${m.to}루까지`);
      else if (m.to !== m.from) parts.push(`${this.runnerLabel(m)} ${m.to}루 진루`);
    }
    // 홈인을 먼저 보여준다
    parts.sort((a, b) => (b.includes('홈인') ? 1 : 0) - (a.includes('홈인') ? 1 : 0));
    return parts.join(', ');
  }

  resultPhrase(e) {
    const bb = e.bb;
    const f = bb ? POS_KO[bb.fielder] : '';
    const vars = {
      f, d: bb ? DIR_WORD[bb.dir] : '', dro: bb ? DIR_TO[bb.dir] : '', s: bb ? DIR_SINGLE[bb.dir] : '', dl: bb ? DIR_LINE[bb.dir] : '',
      hr: HR_NAME[Math.min(3, Math.max(0, e.runs.length - 1))],
    };
    let key = e.kind;
    if (bb?.bunt) {
      key = { SH: 'SH', '1B': 'BUNT_HIT', FC: 'BUNT_FC', PO: 'BUNT_PO', GO: 'BUNT_OUT', DP: 'BUNT_FC' }[e.kind] || 'SH';
      return this.fill(this.pick(key), vars);
    }
    switch (e.kind) {
      case 'K': key = e.buntK ? 'K_BUNT' : e.looking ? 'K_LOOK' : 'K_SWING'; break;
      case '1B':
        if (bb.infieldHit) key = '1B_IF';
        else if (bb.ballType === 'GB') key = '1B_GB';
        break;
      case 'GO': if (bb.fielder === 'P') key = 'GO_P'; break;
      case 'FO': if (bb.depth === 'deep') key = 'FO_DEEP'; else if (bb.depth === 'shallow') key = 'FO_SHALLOW'; break;
    }
    if (e.kind === 'HR' && e.runs.length === 4) return this.fill('그랜드슬램!!! {d} 담장을 넘기는 만루 홈런!!', vars);
    return this.fill(this.pick(key), vars);
  }

  resultLine(e) {
    const pend = this.pending;
    this.pending = null;
    const phrase = this.resultPhrase(e);
    const moves = this.movesText(e.moves);
    const scored = e.runs.length > 0;
    let text;
    if (!pend) text = phrase;
    else if (e.kind === 'K' || e.kind === 'HBP' || e.kind === 'SH' || bb_isBunt(e)) text = `${pend.n}구 ${phrase}`;
    else text = `${pend.n}구 ${pend.pitch.result === 'inPlay' ? '타격' : this.pitchWord(pend.pitch)} → ${phrase}`;
    if (moves) text += /[!.]$/.test(text) ? ` ${moves}` : `, ${moves}`;
    if (scored) text += ` ${this.scoreText(e.snap)}`;
    let cls = 'result';
    if (['1B', '2B', '3B'].includes(e.kind)) cls += ' hit';
    if (e.kind === 'K') cls += ' strikeout';
    if (scored) cls += ' scored';
    if (e.kind === 'HR') cls += ' homerun';
    const out = [{ text, cls, meta: pend?.meta }];
    if (e.walkoff) out.push({ text: `끝내기! ${e.batter.name}의 ${euro(this.walkoffName(e))} 경기가 끝납니다!`, cls: 'walkoff' });
    if (e.snap && ['K', 'GO', 'FO', 'LO', 'PO', 'SF', 'DP', 'FC', 'SH', 'LDP'].includes(e.kind) && e.snap.outs < 3) {
      out.push({ text: `${e.snap.outs}아웃`, cls: 'outs' });
    }
    return out;
  }

  walkoffName(e) {
    return { HR: '끝내기 홈런', '1B': '끝내기 안타', '2B': '끝내기 2루타', '3B': '끝내기 3루타', BB: '끝내기 볼넷', IBB: '끝내기 볼넷', HBP: '끝내기 사구', SF: '끝내기 희생플라이', E: '끝내기 실책', GO: '끝내기 땅볼', FC: '끝내기 야수선택' }[e.kind] || '끝내기';
  }

  stealLine(e) {
    const who = `${e.from}루주자 ${e.runner.name}`;
    const to = e.from + 1;
    if (e.success) return [{ text: `${who} ${to}루 도루 성공!`, cls: 'steal' }];
    return [{ text: `${who} ${to}루 도루 실패, 아웃`, cls: 'steal fail' }];
  }

  wildPitchLine(e) {
    const name = e.kind === 'WP' ? '폭투' : '포일';
    const moves = this.movesText(e.moves);
    const scored = e.runs.length > 0;
    return [{ text: `${name}! ${moves}${scored ? ' ' + this.scoreText(e.snap) : ''}`, cls: 'wp' + (scored ? ' scored' : '') }];
  }

  endLines(e) {
    const [a, h] = e.score;
    const box = e.box;
    const lines = [];
    if (e.winner == null) lines.push({ text: `경기 종료 — ${a} : ${h} 무승부 (${e.innings}회)`, cls: 'final' });
    else lines.push({ text: `경기 종료 — ${a} : ${h}${e.walkoff ? ' (끝내기)' : ''}`, cls: 'final' });
    const name = (side, id) => {
      for (const { player } of box.pitOrder[side]) if (player.id === id) return player.name;
      return null;
    };
    if (e.winner != null) {
      const w = e.winner, l = 1 - w;
      const parts = [`승: ${name(w, e.decisions.W)}`, `패: ${name(l, e.decisions.L)}`];
      if (e.decisions.S) parts.push(`세: ${name(w, e.decisions.S)}`);
      lines.push({ text: parts.join('  '), cls: 'info' });
    }
    return lines;
  }
}
