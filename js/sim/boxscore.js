// 경기 기록 집계

export const newBatLine = () => ({
  pa: 0, ab: 0, r: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, so: 0,
  hbp: 0, sb: 0, cs: 0, sf: 0, sh: 0, gidp: 0,
});

export const newPitLine = () => ({
  outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0, hbp: 0, np: 0, strikes: 0,
  wp: 0, gs: 0, w: 0, l: 0, sv: 0,
});

export class BoxScore {
  constructor() {
    this.bat = [new Map(), new Map()]; // side → id → line
    this.pit = [new Map(), new Map()];
    this.batOrder = [[], []]; // 출전 순서 [{id, pos, slot}]
    this.pitOrder = [[], []];
    this.team = [0, 1].map(() => ({ runs: 0, hits: 0, errors: 0, bb: 0, lob: 0, line: [] }));
  }
  batter(side, player, slot, pos) {
    let l = this.bat[side].get(player.id);
    if (!l) {
      l = newBatLine();
      this.bat[side].set(player.id, l);
      this.batOrder[side].push({ player, slot, pos });
    }
    return l;
  }
  pitcher(side, player) {
    let l = this.pit[side].get(player.id);
    if (!l) {
      l = newPitLine();
      this.pit[side].set(player.id, l);
      this.pitOrder[side].push({ player });
    }
    return l;
  }
}
