// 경기 엔진: 1구 단위 시뮬레이션, 이벤트 스트림 생성
// UI 없음. 브라우저와 Node(밸런스 스크립트) 공용.
//
// 감독 작전은 command(side, cmd)로 큐에 넣으면 다음 체크포인트(타석 시작 / 투구 직전)에 적용된다.
//   공격: steal, bunt, hitrun, ph(대타), pr(대주자)
//   수비: ibb(고의사구), pitcher(투수 교체), shift(수비 시프트)
import { Rng } from '../core/rng.js';
import { z } from '../data/ratings.js';
import { LEAGUE } from './log5.js';
import { throwPitch } from './pitch.js';
import { resolveBattedBall } from './battedBall.js';
import * as BR from './baserunning.js';
import { BoxScore } from './boxscore.js';
import { RULES, newPitcherState, buildDefense, snapshot } from './gameState.js';
import {
  chooseStarter, pitchingDecision, stealDecision, roleOf, buntDecision, ibbDecision, shiftDecision,
} from './aiManager.js';

export const AWAY = 0, HOME = 1;
export const SHIFT_KO = { normal: '정상 수비', pull: '당겨치기 시프트', in: '내야 전진수비' };

export class Game {
  /**
   * @param {object} opts
   *   away, home: 팀 객체
   *   seed: 경기 시드 (같은 시드 + 같은 작전 → 같은 경기)
   *   verbose: 이벤트마다 상태 스냅샷 첨부 (UI용)
   *   starters: [awayStarterId, homeStarterId] (선택)
   *   maxInnings: 연장 한도 (정규시즌 11, 포스트시즌 Infinity)
   *   autoManage: [bool, bool] 팀별 AI 자동 운영 (기본 둘 다 true)
   */
  constructor({ away, home, seed = 1, verbose = true, starters = null, maxInnings = RULES.maxInnings, autoManage = [true, true] }) {
    this.seed = seed;
    this.rng = new Rng('game', seed);
    this.verbose = verbose;
    this.teams = [away, home];
    this.maxInnings = maxInnings;
    this.autoManage = autoManage.slice();
    this.box = new BoxScore();
    this.score = [0, 0];
    this.inning = 1;
    this.half = 0;
    this.outs = 0;
    this.count = [0, 0];
    this.bases = [null, null, null];
    this.orderIdx = [0, 0];
    this.usedPitchers = [new Set(), new Set()];
    this.removed = [new Set(), new Set()]; // 교체되어 나간 선수
    this.orders = [[], []];
    this.shift = ['normal', 'normal']; // 각 팀이 수비할 때의 시프트
    this.userShift = [false, false];
    this.buntOn = false;
    this.over = false;
    this.result = null;
    this.winCand = [null, null];
    this.loseCand = [null, null];

    this.lineups = this.teams.map((t) =>
      t.lineup.map(({ id, pos }) => ({ player: t.roster.find((p) => p.id === id), pos })));
    this.ps = [0, 1].map((side) => {
      const t = this.teams[side];
      const sp = starters?.[side] != null ? t.roster.find((p) => p.id === starters[side]) : chooseStarter(t, t.rotationIndex || 0).player;
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

  // ───────────── 감독 작전 ─────────────

  /** 출전 가능한 벤치 타자 */
  bench(side) {
    const inLineup = new Set(this.lineups[side].map((l) => l.player.id));
    return this.teams[side].roster.filter((p) => p.type === 'H' && !p.injury && !inLineup.has(p.id) && !this.removed[side].has(p.id));
  }

  /** 등판 가능한 투수 */
  availablePitchers(side) {
    return this.teams[side].roster.filter((p) => p.type === 'P' && !p.injury && !this.usedPitchers[side].has(p.id));
  }

  /** 지금 가능한 작전 목록 (UI 버튼 활성화용) */
  options(side) {
    if (this.over) return {};
    const batting = this.batSide === side;
    const [r1, r2, r3] = this.bases;
    const o = { batting };
    if (batting) {
      o.steal = (r1 && !r2) || (r2 && !r3);
      o.bunt = this.count[1] < 2 || true;
      o.hitrun = !!r1 && !r2;
      o.ph = this.bench(side).length > 0;
      o.pr = this.bases.some(Boolean) && this.bench(side).length > 0;
    } else {
      o.ibb = true;
      o.pitcher = this.availablePitchers(side).length > 0;
      o.shift = true;
    }
    return o;
  }

  command(side, cmd) {
    if (this.over) return { ok: false, msg: '경기가 끝났습니다' };
    const opt = this.options(side);
    const need = { steal: 'steal', bunt: 'bunt', hitrun: 'hitrun', ph: 'ph', pr: 'pr', ibb: 'ibb', pitcher: 'pitcher', shift: 'shift' }[cmd.type];
    if (!need || !opt[need]) return { ok: false, msg: '지금은 할 수 없는 작전입니다' };
    if (cmd.type === 'shift') {
      this.shift[side] = cmd.mode;
      this.userShift[side] = true;
      return { ok: true, msg: SHIFT_KO[cmd.mode] };
    }
    if (cmd.type === 'bunt' && cmd.cancel) { this.buntOn = false; return { ok: true, msg: '번트 작전 취소' }; }
    this.orders[side] = this.orders[side].filter((o) => o.type !== cmd.type || o.type === 'pr');
    this.orders[side].push(cmd);
    return { ok: true };
  }

  takeOrder(side, type) {
    const i = this.orders[side].findIndex((o) => o.type === type);
    if (i < 0) return null;
    return this.orders[side].splice(i, 1)[0];
  }

  *substitute(side, slot, newPlayer, kind) {
    const old = this.lineups[side][slot];
    this.removed[side].add(old.player.id);
    this.lineups[side][slot] = { player: newPlayer, pos: old.pos };
    if (old.pos !== 'DH') this.defense[side][old.pos] = newPlayer;
    this.box.batter(side, newPlayer, slot + 1, old.pos);
    // 대주자: 루상의 주자 교체
    for (const r of this.bases) if (r && r.player.id === old.player.id) r.player = newPlayer;
    yield this.ev('sub', { kind, side, team: this.teams[side], out: old.player, in: newPlayer, slot: slot + 1, pos: old.pos });
  }

  slotOf(side, playerId) {
    return this.lineups[side].findIndex((l) => l.player.id === playerId);
  }

  // ───────────── 경기 진행 ─────────────

  *run() {
    yield this.ev('gameStart', { away: this.teams[0], home: this.teams[1], starters: this.ps.map((p) => p.player) });
    for (this.inning = 1; ; this.inning++) {
      for (this.half = 0; this.half < 2; this.half++) {
        if (this.half === 1 && this.inning >= RULES.innings && this.score[HOME] > this.score[AWAY]) {
          return yield* this.finish(false);
        }
        yield* this.halfInning();
        if (this.over) return yield* this.finish(true);
      }
      if (this.inning >= RULES.innings && this.score[0] !== this.score[1]) return yield* this.finish(false);
      if (this.inning >= this.maxInnings) return yield* this.finish(false);
    }
  }

  simulate() {
    const it = this.run();
    while (!it.next().done);
    return this.result;
  }

  *halfInning() {
    const bat = this.batSide, def = this.defSide;
    this.outs = 0;
    this.bases = [null, null, null];
    this.orders = [[], []]; // 공수 교대 시 남은 작전은 취소
    this.buntOn = false;
    this.box.team[bat].line.push(0);
    yield this.ev('halfStart', { inning: this.inning, half: this.half, team: this.teams[bat] });

    let first = true;
    while (this.outs < 3) {
      yield* this.prePA(first);
      first = false;
      if (this.outs >= 3 || this.over) break;
      yield* this.plateAppearance();
      if (this.over) break;
    }
    const lob = this.bases.filter(Boolean).length;
    this.box.team[bat].lob += this.over ? 0 : lob;
    yield this.ev('halfEnd', {
      inning: this.inning, half: this.half, runs: this.box.team[bat].line[this.inning - 1], lob,
    });
  }

  /** 타석 시작 전: 투수 교체, 대타, 시프트 */
  *prePA(halfStart) {
    const bat = this.batSide, def = this.defSide;
    // 수비: 사용자 투수 교체 > AI 교체
    const po = this.takeOrder(def, 'pitcher');
    if (po) {
      const p = this.teams[def].roster.find((x) => x.id === po.playerId);
      if (p && !this.usedPitchers[def].has(p.id)) yield* this.changePitcher(def, p, roleOf(this.teams[def], p.id), true);
    } else if (this.autoManage[def]) {
      const change = pitchingDecision(this, def, halfStart);
      if (change) yield* this.changePitcher(def, change.player, change.role);
    } else if (this.ps[def].pitches >= this.ps[def].limit + 40) {
      // 자동 운영 꺼도 혹사 방지 안전장치
      const change = pitchingDecision(this, def, true);
      if (change) yield* this.changePitcher(def, change.player, change.role);
    }
    // 공격: 대타
    yield* this.applyOffenseSubs(bat);
    // 수비 시프트
    const batter = this.curBatter();
    if (this.autoManage[def] && !this.userShift[def]) {
      const s = shiftDecision(this, def, batter);
      if (s !== this.shift[def]) {
        this.shift[def] = s;
        if (s !== 'normal') yield this.ev('tactic', { kind: 'shift', side: def, team: this.teams[def], mode: s });
      }
    }
    // 공격 AI: 희생번트
    this.buntOn = false;
    if (this.autoManage[bat] && !this.orders[bat].length && buntDecision(this, bat, batter)) {
      this.buntOn = true;
      yield this.ev('tactic', { kind: 'buntSign', side: bat, team: this.teams[bat] });
    }
  }

  *applyOffenseSubs(bat) {
    for (;;) {
      const pr = this.takeOrder(bat, 'pr');
      if (!pr) break;
      const runner = this.bases[pr.base - 1];
      const np = this.bench(bat).find((p) => p.id === pr.playerId);
      if (runner && np) yield* this.substitute(bat, this.slotOf(bat, runner.player.id), np, 'PR');
    }
    const ph = this.takeOrder(bat, 'ph');
    if (ph) {
      const np = this.bench(bat).find((p) => p.id === ph.playerId);
      if (np) yield* this.substitute(bat, this.orderIdx[bat] % 9, np, 'PH');
    }
  }

  curBatter() {
    const bat = this.batSide;
    return this.lineups[bat][this.orderIdx[bat] % 9].player;
  }

  *changePitcher(side, player, role, byUser = false) {
    const old = this.ps[side];
    this.usedPitchers[side].add(player.id);
    const ps = newPitcherState(player, false, this.inning);
    ps.enteredLead = this.score[side] - this.score[1 - side];
    this.ps[side] = ps;
    this.defense[side].P = player;
    this.box.pitcher(side, player);
    yield this.ev('pitchingChange', { side, team: this.teams[side], out: old.player, in: player, role, oldPitches: old.pitches, byUser });
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
    const rng = this.rng;
    this.count = [0, 0];
    {
      const { player: batter, pos } = this.lineups[bat][slot];
      yield this.ev('pa', { batter, slot: slot + 1, pos, pitcher: this.ps[def].player, team: this.teams[bat] });
    }

    // 고의사구 (타석 시작 시 AI 판단)
    const nextBatter = this.lineups[bat][(slot + 1) % 9].player;
    if (this.autoManage[def] && ibbDecision(this, def, this.curBatter(), nextBatter)) {
      return yield* this.intentionalWalk(bat, def);
    }

    let n = 0;
    for (;;) {
      // ── 투구 직전 체크포인트: 사용자 작전 ──
      yield* this.applyOffenseSubs(bat);
      const pOrder = this.takeOrder(def, 'pitcher');
      if (pOrder) {
        const p = this.teams[def].roster.find((x) => x.id === pOrder.playerId);
        if (p && !this.usedPitchers[def].has(p.id)) yield* this.changePitcher(def, p, roleOf(this.teams[def], p.id), true);
      }
      if (this.takeOrder(def, 'ibb')) return yield* this.intentionalWalk(bat, def);
      if (this.takeOrder(bat, 'bunt')) {
        this.buntOn = true;
        yield this.ev('tactic', { kind: 'buntSign', side: bat, team: this.teams[bat], byUser: true });
      }
      const hitAndRun = !!this.takeOrder(bat, 'hitrun') && !!this.bases[0] && !this.bases[1];
      if (hitAndRun) yield this.ev('tactic', { kind: 'hitrun', side: bat, team: this.teams[bat] });

      const batter = this.curBatter();
      const ps = this.ps[def];
      const pitcher = ps.player;
      const bl = this.box.batter(bat, batter, slot + 1, this.lineups[bat][slot].pos);
      const pl = this.box.pitcher(def, pitcher);

      // 도루 (사용자 지시 또는 AI)
      let sb = 0;
      if (this.takeOrder(bat, 'steal')) sb = this.bases[1] && !this.bases[2] ? 2 : this.bases[0] && !this.bases[1] ? 1 : 0;
      else if (this.autoManage[bat] && !hitAndRun && !this.buntOn) sb = stealDecision(this, bat, rng);
      if (sb) {
        yield* this.doSteal(bat, def, sb, pitcher);
        if (this.outs >= 3) return;
      }

      const pitch = throwPitch(rng, { batter, ps, count: this.count, leverage: this.leverage(), hitAndRun });
      n++;
      ps.pitches++;
      pl.np++;
      // 번트 시도: 투구 결과를 번트 판정으로 대체
      let tactic = hitAndRun ? 'hitrun' : null;
      if (this.buntOn && pitch.result !== 'hbp') {
        tactic = 'bunt';
        if (!pitch.inZone && rng.chance(0.7)) pitch.result = 'ball';
        else {
          const r = rng.weighted([['miss', 0.1], ['foul', 0.25], ['inPlay', 0.65]]);
          pitch.result = r === 'miss' ? 'swingStrike' : r === 'foul' ? 'buntFoul' : 'buntInPlay';
        }
      }
      const r = pitch.result;
      if (r !== 'ball' && r !== 'hbp') pl.strikes++;

      if (r === 'hbp') {
        yield this.ev('pitch', { n, pitch, count: this.count.slice(), tactic });
        return yield* this.endPA('HBP', bat, def, batter, bl, pl, BR.walk(this.bases, this.runnerFor(batter, pitcher)));
      }
      if (r === 'ball') {
        this.count[0]++;
        yield this.ev('pitch', { n, pitch, count: this.count.slice(), tactic });
        if (this.count[0] === 4) {
          return yield* this.endPA('BB', bat, def, batter, bl, pl, BR.walk(this.bases, this.runnerFor(batter, pitcher)));
        }
      } else if (r === 'calledStrike' || r === 'swingStrike') {
        this.count[1]++;
        yield this.ev('pitch', { n, pitch, count: this.count.slice(), tactic });
        if (this.count[1] === 3) {
          yield* this.endPA('K', bat, def, batter, bl, pl, { bases: this.bases, moves: [], runs: [], outs: 1 }, { looking: r === 'calledStrike' });
          if (hitAndRun && this.outs < 3 && this.bases[0]) yield* this.doSteal(bat, def, 1, pitcher);
          return;
        }
      } else if (r === 'foul' || r === 'buntFoul') {
        if (r === 'buntFoul' && this.count[1] === 2) {
          this.count[1] = 3;
          yield this.ev('pitch', { n, pitch, count: this.count.slice(), tactic });
          return yield* this.endPA('K', bat, def, batter, bl, pl, { bases: this.bases, moves: [], runs: [], outs: 1 }, { buntK: true });
        }
        if (this.count[1] < 2) this.count[1]++;
        yield this.ev('pitch', { n, pitch, count: this.count.slice(), tactic });
      } else if (r === 'buntInPlay') {
        yield this.ev('pitch', { n, pitch, count: this.count.slice(), tactic });
        return yield* this.buntInPlay(bat, def, batter, pitcher, bl, pl);
      } else if (r === 'inPlay') {
        yield this.ev('pitch', { n, pitch, count: this.count.slice(), tactic });
        return yield* this.inPlay(bat, def, batter, pitcher, pitch, bl, pl, hitAndRun);
      }

      // 히트앤런인데 공을 못 맞힘 → 주자는 이미 뛰었다
      if (hitAndRun && this.bases[0] && !this.bases[1] && (r === 'ball' || r === 'calledStrike' || r === 'swingStrike')) {
        yield* this.doSteal(bat, def, 1, pitcher);
        if (this.outs >= 3) return;
      }

      // 폭투 / 포일
      if (this.bases.some(Boolean) && !pitch.inZone && pitch.result !== 'foul' && tactic !== 'bunt') {
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
          if (this.over) return;
        }
      }
    }
  }

  *doSteal(bat, def, fromBase, pitcher) {
    const runner = this.bases[fromBase - 1];
    if (!runner) return;
    const res = BR.steal(this.rng, this.bases, fromBase, this.defense[def].C, pitcher);
    this.bases = res.bases;
    const line = this.box.batter(bat, runner.player);
    if (res.success) line.sb++; else line.cs++;
    this.addOuts(res.outs, def);
    yield this.ev('steal', { runner: runner.player, from: fromBase, success: res.success });
  }

  *intentionalWalk(bat, def) {
    const batter = this.curBatter();
    const slot = this.orderIdx[bat] % 9;
    const bl = this.box.batter(bat, batter, slot + 1, this.lineups[bat][slot].pos);
    const pl = this.box.pitcher(def, this.ps[def].player);
    return yield* this.endPA('IBB', bat, def, batter, bl, pl, BR.walk(this.bases, this.runnerFor(batter, this.ps[def].player)));
  }

  runnerFor(batter, pitcher, earned = true) {
    return { player: batter, resp: pitcher.id, earned };
  }

  *buntInPlay(bat, def, batter, pitcher, bl, pl) {
    const res = BR.bunt(this.rng, this.bases, this.runnerFor(batter, pitcher), this.outs, this.defense[def]);
    const bb = { ballType: 'GB', fielder: res.fielder, dir: res.fielder === '1B' ? 'R' : res.fielder === '3B' ? 'L' : 'C', bunt: true, infieldHit: true, q: -1, outcome: '' };
    const kind = { SH: 'SH', BUNT_HIT: '1B', BUNT_FC: 'FC', BUNT_PO: 'PO', BUNT_DP: 'DP', BUNT_OUT: 'GO' }[res.kind];
    this.buntOn = false;
    return yield* this.endPA(kind, bat, def, batter, bl, pl, res, { bb });
  }

  *inPlay(bat, def, batter, pitcher, pitch, bl, pl, hitAndRun) {
    const rng = this.rng;
    const shift = this.shift[def];
    const bb = resolveBattedBall(rng, { batter, pitcher, pitch, defense: this.defense[def], shift, hitAndRun });
    const runner = this.runnerFor(batter, pitcher);
    const opts = { hitAndRun, infieldIn: shift === 'in' };
    let res, kind;
    if (bb.outcome === 'OUT') {
      if (bb.ballType === 'GB') {
        res = BR.groundOut(rng, this.bases, runner, bb, this.outs, this.defense[def], opts);
        kind = res.dp ? 'DP' : res.fc ? 'FC' : 'GO';
      } else {
        res = BR.flyOut(rng, this.bases, runner, bb, this.outs, this.defense[def], opts);
        kind = res.dp ? 'LDP' : res.sf ? 'SF' : bb.ballType === 'LD' ? 'LO' : bb.ballType === 'PU' ? 'PO' : 'FO';
      }
    } else if (bb.outcome === 'E') {
      runner.earned = false;
      res = BR.error(rng, this.bases, runner);
      kind = 'E';
      this.box.team[def].errors++;
    } else {
      res = BR.hit(rng, this.bases, runner, bb, this.outs, this.defense[def], opts);
      kind = bb.outcome;
    }
    return yield* this.endPA(kind, bat, def, batter, bl, pl, res, { bb, hitAndRun });
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
      if (this.ps[def].player.id === rn.resp) this.ps[def].runs++;
      if (batterLine && rbiEligible) batterLine.rbi++;
      scored.push(rn.player);
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

  *endPA(kind, bat, def, batter, bl, pl, res, extra = {}) {
    const isAB = !['BB', 'IBB', 'HBP', 'SF', 'SH'].includes(kind);
    bl.pa++;
    pl.bf++;
    if (isAB) bl.ab++;
    const team = this.box.team[bat];
    switch (kind) {
      case 'K': bl.so++; pl.so++; break;
      case 'BB': case 'IBB': bl.bb++; pl.bb++; team.bb++; if (kind === 'IBB') { bl.ibb = (bl.ibb || 0) + 1; } break;
      case 'HBP': bl.hbp++; pl.hbp++; team.bb++; break;
      case 'SF': bl.sf++; break;
      case 'SH': bl.sh++; break;
      case 'DP': bl.gidp++; break;
      case '1B': case '2B': case '3B': case 'HR':
        bl.h++; pl.h++; team.hits++;
        if (kind === '2B') bl.d++;
        if (kind === '3B') bl.t++;
        if (kind === 'HR') { bl.hr++; pl.hr++; }
        break;
    }
    this.bases = res.bases;
    this.addOuts(res.outs, def);
    const rbiOk = kind !== 'DP' && kind !== 'E' && kind !== 'LDP';
    const scored = this.scoreRuns(res.runs, bat, def, bl, rbiOk, kind === 'HR');
    const rbi = rbiOk ? scored.length : 0;
    this.orderIdx[bat]++;
    this.buntOn = false;
    yield this.ev('result', {
      kind, batter, pitcher: this.ps[def].player, moves: res.moves, runs: scored, rbi,
      bb: extra.bb, looking: extra.looking, buntK: extra.buntK, hitAndRun: extra.hitAndRun,
      walkoff: this.over && this.walkoff, count: this.count.slice(),
    });
  }

  *finish(walkoff) {
    const [a, h] = this.score;
    const winner = a === h ? null : a > h ? AWAY : HOME;
    const decisions = { W: null, L: null, S: null, H: [] };
    if (winner != null) {
      const loser = 1 - winner;
      let wId = this.winCand[winner];
      const starterId = this.box.pitOrder[winner][0].player.id;
      const starterLine = this.box.pit[winner].get(starterId);
      if (wId === starterId && starterLine.outs < 15) {
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
