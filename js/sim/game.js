// 경기 엔진: 1구 단위 시뮬레이션, 이벤트 스트림 생성
// UI 없음. 브라우저와 Node(밸런스 스크립트) 공용.
import { Rng } from '../core/rng.js';
import { z } from '../data/ratings.js';
import { LEAGUE } from './log5.js';
import { throwPitch } from './pitch.js';
import { resolveBattedBall } from './battedBall.js';
import * as BR from './baserunning.js';
import { BoxScore } from './boxscore.js';
import { RULES, newPitcherState, buildDefense, snapshot } from './gameState.js';
import { chooseStarter, pitchingDecision, stealDecision, roleOf } from './aiManager.js';

export const AWAY = 0, HOME = 1;

export class Game {
  /**
   * @param {object} opts
   *   away, home: 팀 객체 (teamGen 결과)
   *   seed: 경기 시드 (같은 시드 → 같은 경기)
   *   verbose: true면 이벤트마다 상태 스냅샷 첨부 (UI용)
   *   starters: [awayStarterId, homeStarterId] (선택)
   */
  constructor({ away, home, seed = 1, verbose = true, starters = null, rotationIndex = [0, 0] }) {
    this.seed = seed;
    this.rng = new Rng('game', seed);
    this.verbose = verbose;
    this.teams = [away, home];
    this.box = new BoxScore();
    this.score = [0, 0];
    this.inning = 1;
    this.half = 0; // 0 = 초(원정 공격), 1 = 말(홈 공격)
    this.outs = 0;
    this.count = [0, 0];
    this.bases = [null, null, null];
    this.orderIdx = [0, 0];
    this.usedPitchers = [new Set(), new Set()];
    this.over = false;
    this.result = null;
    this.winCand = [null, null];
    this.loseCand = [null, null];

    this.lineups = this.teams.map((t) =>
      t.lineup.map(({ id, pos }) => ({ player: t.roster.find((p) => p.id === id), pos })));
    this.ps = [0, 1].map((side) => {
      const t = this.teams[side];
      const sp = starters?.[side] != null ? t.roster.find((p) => p.id === starters[side]) : chooseStarter(t, rotationIndex[side]);
      this.usedPitchers[side].add(sp.id);
      return newPitcherState(sp, true, 1);
    });
    this.defense = [0, 1].map((s) => buildDefense(this.teams[s], this.lineups[s], this.ps[s].player));
    for (const s of [0, 1]) {
      this.box.pitcher(s, this.ps[s].player).gs = 1;
      this.lineups[s].forEach(({ player, pos }, i) => this.box.batter(s, player, i + 1, pos));
    }
  }

  ev(t, data = {}) {
    const e = { t, ...data };
    if (this.verbose) e.snap = snapshot(this);
    return e;
  }

  get batSide() { return this.half; }
  get defSide() { return 1 - this.half; }

  /** 전체 경기 제너레이터: 이벤트를 하나씩 yield */
  *run() {
    yield this.ev('gameStart', { away: this.teams[0], home: this.teams[1], starters: this.ps.map((p) => p.player) });
    for (this.inning = 1; ; this.inning++) {
      for (this.half = 0; this.half < 2; this.half++) {
        // 9회 이후 말 공격: 홈팀이 이기고 있으면 생략
        if (this.half === 1 && this.inning >= RULES.innings && this.score[HOME] > this.score[AWAY]) {
          return yield* this.finish(false);
        }
        yield* this.halfInning();
        if (this.over) return yield* this.finish(true);
      }
      if (this.inning >= RULES.innings && this.score[0] !== this.score[1]) return yield* this.finish(false);
      if (this.inning >= RULES.maxInnings) return yield* this.finish(false);
    }
  }

  /** 이벤트를 모두 소비하고 결과 반환 (빠른 시뮬레이션) */
  simulate() {
    const it = this.run();
    while (!it.next().done);
    return this.result;
  }

  *halfInning() {
    const bat = this.batSide, def = this.defSide;
    this.outs = 0;
    this.bases = [null, null, null];
    this.box.team[bat].line.push(0);
    yield this.ev('halfStart', { inning: this.inning, half: this.half, team: this.teams[bat] });

    let first = true;
    while (this.outs < 3) {
      const change = pitchingDecision(this, def, first);
      if (change) yield* this.changePitcher(def, change.player, change.role);
      first = false;
      yield* this.plateAppearance();
      if (this.over) break;
    }
    const lob = this.bases.filter(Boolean).length;
    this.box.team[bat].lob += this.over ? 0 : lob;
    yield this.ev('halfEnd', {
      inning: this.inning, half: this.half, runs: this.box.team[bat].line[this.inning - 1], lob,
    });
  }

  *changePitcher(side, player, role) {
    const old = this.ps[side];
    this.usedPitchers[side].add(player.id);
    const ps = newPitcherState(player, false, this.inning);
    ps.enteredLead = this.score[side] - this.score[1 - side];
    this.ps[side] = ps;
    this.defense[side].P = player;
    this.box.pitcher(side, player);
    yield this.ev('pitchingChange', { side, team: this.teams[side], out: old.player, in: player, role, oldPitches: old.pitches });
  }

  leverage() {
    let l = 1;
    if (this.bases[1] || this.bases[2]) l += 0.5;
    if (this.inning >= 7 && Math.abs(this.score[0] - this.score[1]) <= 2) l += 0.5;
    return l;
  }

  *plateAppearance() {
    const bat = this.batSide, def = this.defSide;
    const slot = this.orderIdx[bat] % 9;
    const { player: batter, pos } = this.lineups[bat][slot];
    const ps = this.ps[def];
    const pitcher = ps.player;
    const bl = this.box.batter(bat, batter, slot + 1, pos);
    const pl = this.box.pitcher(def, pitcher);
    this.count = [0, 0];
    yield this.ev('pa', { batter, slot: slot + 1, pos, pitcher, team: this.teams[bat], season: null });

    const rng = this.rng;
    let n = 0;
    for (;;) {
      // 도루 (투구 전)
      const sb = stealDecision(this, bat, rng);
      if (sb) {
        const runner = this.bases[sb - 1];
        const res = BR.steal(rng, this.bases, sb, this.defense[def].C, pitcher);
        this.bases = res.bases;
        const line = this.box.batter(bat, runner.player);
        if (res.success) line.sb++; else line.cs++;
        this.addOuts(res.outs, def);
        yield this.ev('steal', { runner: runner.player, from: sb, success: res.success });
        if (this.outs >= 3) return; // 타자는 다음 이닝에 다시 타석 (타순 유지)
      }

      const pitch = throwPitch(rng, { batter, ps, count: this.count, leverage: this.leverage() });
      n++;
      ps.pitches++;
      pl.np++;
      const r = pitch.result;
      if (r !== 'ball' && r !== 'hbp') pl.strikes++;

      if (r === 'hbp') {
        yield this.ev('pitch', { n, pitch, count: this.count.slice() });
        return yield* this.endPA('HBP', bat, def, batter, bl, pl, BR.walk(this.bases, this.runnerFor(batter, pitcher)));
      }
      if (r === 'ball') {
        this.count[0]++;
        yield this.ev('pitch', { n, pitch, count: this.count.slice() });
        if (this.count[0] === 4) {
          return yield* this.endPA('BB', bat, def, batter, bl, pl, BR.walk(this.bases, this.runnerFor(batter, pitcher)));
        }
      } else if (r === 'calledStrike' || r === 'swingStrike') {
        this.count[1]++;
        yield this.ev('pitch', { n, pitch, count: this.count.slice() });
        if (this.count[1] === 3) {
          return yield* this.endPA('K', bat, def, batter, bl, pl, { bases: this.bases, moves: [], runs: [], outs: 1 }, { looking: r === 'calledStrike' });
        }
      } else if (r === 'foul') {
        if (this.count[1] < 2) this.count[1]++;
        yield this.ev('pitch', { n, pitch, count: this.count.slice() });
      } else if (r === 'inPlay') {
        yield this.ev('pitch', { n, pitch, count: this.count.slice() });
        return yield* this.inPlay(bat, def, batter, pitcher, pitch, bl, pl);
      }

      // 폭투 / 포일
      if (this.bases.some(Boolean) && !pitch.inZone && pitch.result !== 'foul') {
        const zc = z(pitcher.ratings.control);
        const catcher = this.defense[def].C;
        const zcd = z(catcher?.ratings.def?.C ?? 45);
        const breaking = pitch.type !== 'FF' && pitch.type !== 'SI';
        let kind = null;
        if (breaking && rng.chance(LEAGUE.wildPitch * Math.exp(-0.35 * zc))) kind = 'WP';
        else if (rng.chance(LEAGUE.passedBall * Math.exp(-0.6 * zcd))) kind = 'PB';
        if (kind) {
          const res = BR.wildPitch(this.bases);
          this.bases = res.bases;
          if (kind === 'WP') pl.wp++;
          const scored = this.scoreRuns(res.runs, bat, def, null, false);
          yield this.ev('wildPitch', { kind, moves: res.moves, runs: scored });
          if (this.checkWalkoff()) return;
        }
      }
    }
  }

  runnerFor(batter, pitcher, earned = true) {
    return { player: batter, resp: pitcher.id, earned };
  }

  *inPlay(bat, def, batter, pitcher, pitch, bl, pl) {
    const rng = this.rng;
    const bb = resolveBattedBall(rng, { batter, pitcher, pitch, defense: this.defense[def] });
    const runner = this.runnerFor(batter, pitcher);
    let res, kind;
    if (bb.outcome === 'OUT') {
      if (bb.ballType === 'GB') {
        res = BR.groundOut(rng, this.bases, runner, bb, this.outs, this.defense[def]);
        kind = res.dp ? 'DP' : res.fc ? 'FC' : 'GO';
      } else {
        res = BR.flyOut(rng, this.bases, runner, bb, this.outs, this.defense[def]);
        kind = res.sf ? 'SF' : bb.ballType === 'LD' ? 'LO' : bb.ballType === 'PU' ? 'PO' : 'FO';
      }
    } else if (bb.outcome === 'E') {
      runner.earned = false;
      res = BR.error(rng, this.bases, runner);
      kind = 'E';
      this.box.team[def].errors++;
    } else {
      res = BR.hit(rng, this.bases, runner, bb, this.outs, this.defense[def]);
      kind = bb.outcome;
    }
    return yield* this.endPA(kind, bat, def, batter, bl, pl, res, { bb });
  }

  addOuts(n, def) {
    if (!n) return;
    const before = this.outs;
    this.outs = Math.min(3, this.outs + n);
    const added = this.outs - before;
    this.ps[def].outsThisOuting += added;
    this.box.pitcher(def, this.ps[def].player).outs += added;
  }

  /** 득점 처리. 끝내기 상황이면 결승점까지만 인정 (홈런 제외) */
  scoreRuns(runners, bat, def, batterLine, rbiEligible, isHR = false) {
    const scored = [];
    for (const rn of runners) {
      if (this.over) break;
      const wasLeading = this.score[bat] > this.score[def];
      this.score[bat]++;
      this.box.team[bat].runs++;
      this.box.team[bat].line[this.inning - 1]++;
      this.box.batter(bat, rn.player).r++;
      const respLine = this.box.pit[def].get(rn.resp);
      if (respLine) { respLine.r++; if (rn.earned) respLine.er++; }
      const respPs = this.ps[def].player.id === rn.resp ? this.ps[def] : null;
      if (respPs) respPs.runs++;
      if (batterLine && rbiEligible) batterLine.rbi++;
      scored.push(rn.player);
      // 리드 변화 → 승/패 후보
      if (!wasLeading && this.score[bat] > this.score[def]) {
        this.winCand[bat] = this.ps[bat].player.id;
        this.loseCand[def] = rn.resp;
      }
      if (!isHR && this.isWalkoffState()) { this.over = true; this.walkoff = true; }
    }
    if (isHR && this.isWalkoffState()) { this.over = true; this.walkoff = true; }
    return scored;
  }

  isWalkoffState() {
    return this.half === 1 && this.inning >= RULES.innings && this.score[HOME] > this.score[AWAY];
  }

  checkWalkoff() {
    return this.over;
  }

  *endPA(kind, bat, def, batter, bl, pl, res, extra = {}) {
    const isAB = !['BB', 'HBP', 'SF'].includes(kind);
    bl.pa++;
    pl.bf++;
    if (isAB) bl.ab++;
    const team = this.box.team[bat];
    switch (kind) {
      case 'K': bl.so++; pl.so++; break;
      case 'BB': bl.bb++; pl.bb++; team.bb++; break;
      case 'HBP': bl.hbp++; pl.hbp++; team.bb++; break;
      case 'SF': bl.sf++; break;
      case 'DP': bl.gidp++; break;
      case '1B': case '2B': case '3B': case 'HR':
        bl.h++; pl.h++; team.hits++;
        if (kind === '2B') bl.d++;
        if (kind === '3B') bl.t++;
        if (kind === 'HR') { bl.hr++; pl.hr++; }
        break;
    }
    this.bases = res.bases;
    // 아웃을 먼저 반영 (3아웃이면 득점 불가한 플레이는 baserunning에서 이미 처리)
    this.addOuts(res.outs, def);
    const rbiOk = kind !== 'DP' && kind !== 'E';
    const scored = this.scoreRuns(res.runs, bat, def, bl, rbiOk, kind === 'HR');
    const rbi = rbiOk ? scored.length : 0;
    this.orderIdx[bat]++;
    yield this.ev('result', {
      kind, batter, pitcher: pl && this.ps[def].player, moves: res.moves, runs: scored, rbi,
      bb: extra.bb, looking: extra.looking, walkoff: this.over && this.walkoff,
      count: this.count.slice(),
    });
  }

  *finish(walkoff) {
    const [a, h] = this.score;
    const winner = a === h ? null : a > h ? AWAY : HOME;
    const decisions = { W: null, L: null, S: null };
    if (winner != null) {
      const loser = 1 - winner;
      let wId = this.winCand[winner];
      const starterId = this.box.pitOrder[winner][0].player.id;
      const starterLine = this.box.pit[winner].get(starterId);
      if (wId === starterId && starterLine.outs < 15) {
        // 선발 5이닝 미만 → 가장 많이 던진 구원투수
        let best = null;
        for (const { player } of this.box.pitOrder[winner].slice(1)) {
          const l = this.box.pit[winner].get(player.id);
          if (!best || l.outs > best.l.outs) best = { id: player.id, l };
        }
        if (best) wId = best.id;
      }
      decisions.W = wId;
      decisions.L = this.loseCand[loser];
      const last = this.ps[winner];
      if (!last.starter && last.player.id !== wId) {
        const ok = (last.enteredLead >= 1 && last.enteredLead <= 3 && last.outsThisOuting >= 1) || last.outsThisOuting >= 9;
        if (ok) decisions.S = last.player.id;
      }
      const set = (side, id, k) => { const l = id != null && this.box.pit[side].get(id); if (l) l[k] = 1; };
      set(winner, decisions.W, 'w');
      set(loser, decisions.L, 'l');
      set(winner, decisions.S, 'sv');
    }
    this.over = true;
    this.result = {
      score: this.score.slice(), winner, walkoff: walkoff && !!this.walkoff,
      innings: this.inning, box: this.box, decisions,
    };
    yield this.ev('gameEnd', this.result);
  }
}

export { roleOf };
