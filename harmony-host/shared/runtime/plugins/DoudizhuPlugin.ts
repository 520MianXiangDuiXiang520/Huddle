import type { GamePlugin, Player, PluginResult } from "../types";
import { ok, err } from "../types";

export class DoudizhuPlugin implements GamePlugin {
  readonly id = "doudizhu";
  private hostId: string | null = null;
  private started = false;
  private finished = false;
  private phase: "bid" | "play" | "ended" = "bid";
  private seats = new Map<string, number>();
  private names = new Map<string, string>();
  private hands = new Map<string, number[]>();
  private bottomCards: number[] = [];
  private landlordId: string | null = null;
  private bidValue = 0;
  private bids = new Map<string, number>();
  private bidIndex = 0;
  private seatOrder: string[] = [];
  private lastPlay: any = null;
  private lastPlayerId: string | null = null;
  private currentTurnId: string | null = null;
  private consecutivePasses = 0;
  private winnerId: string | null = null;
  private winnerSide: string | null = null;

  static rankOf(c: number): number { if (c === 52) return 13; if (c === 53) return 14; return Math.floor(c / 4); }

  onStart(players: Player[], hostId: string): PluginResult {
    if (players.length !== 3) return err("斗地主需要 3 人入座");
    this.reset();
    this.hostId = hostId;
    players.forEach((p, i) => { this.seats.set(p.id, p.seat ?? i); this.names.set(p.id, p.name); this.hands.set(p.id, []); this.seatOrder.push(p.id); });
    this.dealNewHand();
    this.started = true;
    return ok({ system: "发牌完成 · 请按顺序叫分（1/2/3 或不叫）" });
  }

  private dealNewHand(): void {
    const deck = Array.from({ length: 54 }, (_, i) => i);
    deck.sort(() => Math.random() - 0.5);
    for (const pid of this.seatOrder) this.hands.set(pid, []);
    for (let i = 0; i < deck.length; i++) {
      if (i < 51) this.hands.get(this.seatOrder[i % 3])!.push(deck[i]);
      else this.bottomCards.push(deck[i]);
    }
    for (const pid of this.seatOrder) this.sortHand(this.hands.get(pid)!);
    this.bottomCards.sort((a, b) => DoudizhuPlugin.rankOf(a) - DoudizhuPlugin.rankOf(b) || a - b);
    this.phase = "bid"; this.bids.clear(); this.bidValue = 0; this.landlordId = null;
    this.lastPlay = null; this.lastPlayerId = null; this.consecutivePasses = 0; this.bidIndex = 0;
    this.currentTurnId = this.seatOrder[0];
  }
  private sortHand(h: number[]): void { h.sort((a, b) => DoudizhuPlugin.rankOf(a) - DoudizhuPlugin.rankOf(b) || a - b); }

  onAction(playerId: string, payload: any): PluginResult {
    if (!this.started) return err("对局未开始");
    if (this.finished) return err("本局已结束");
    if (!this.seats.has(playerId)) return err("只有入座玩家可以操作");
    switch (payload.op) {
      case "bid": return this.handleBid(playerId, payload);
      case "play": return this.handlePlay(playerId, payload);
      case "pass": return this.handlePass(playerId);
      default: return err("未知操作");
    }
  }

  private handleBid(playerId: string, payload: any): PluginResult {
    if (this.phase !== "bid") return err("当前不是叫分阶段");
    if (playerId !== this.currentTurnId) return err("还没轮到你叫分");
    const v = payload.value | 0;
    if (v < 0 || v > 3) return err("叫分无效");
    if (v !== 0 && v <= this.bidValue) return err("必须高于当前最高分");
    this.bids.set(playerId, v);
    if (v === 3) return this.finishBid(playerId, v);
    this.bidIndex++;
    if (this.bidIndex >= this.seatOrder.length) {
      const winner = [...this.bids.entries()].filter(([, val]) => val > 0).sort((a, b) => b[1] - a[1])[0];
      if (!winner) { this.dealNewHand(); return ok({ system: "无人叫地主 · 重新发牌" }); }
      return this.finishBid(winner[0], winner[1]);
    }
    this.currentTurnId = this.seatOrder[this.bidIndex];
    return ok({});
  }

  private finishBid(winnerId: string, value: number): PluginResult {
    this.landlordId = winnerId; this.bidValue = value;
    for (const c of this.bottomCards) this.hands.get(winnerId)!.push(c);
    this.sortHand(this.hands.get(winnerId)!);
    this.phase = "play"; this.currentTurnId = winnerId; this.consecutivePasses = 0; this.lastPlay = null;
    return ok({ system: `${this.names.get(winnerId) ?? "玩家"} 叫地主 · ${value} 分 · 底牌已亮明，地主先出牌` });
  }

  private handlePlay(playerId: string, payload: any): PluginResult {
    if (this.phase !== "play") return err("当前不是出牌阶段");
    if (playerId !== this.currentTurnId) return err("还没轮到你出牌");
    const cardsIn = payload.cards;
    if (!Array.isArray(cardsIn) || cardsIn.length === 0) return err("请选择要出的牌");
    const cards: number[] = [];
    for (const c of cardsIn) { if (typeof c !== "number" || c < 0 || c > 53) return err("牌面无效"); cards.push(c); }
    const hand = this.hands.get(playerId)!;
    for (const c of cards) { const idx = hand.indexOf(c); if (idx < 0) return err("你没有这些牌"); }
    const combo = this.parseCombo(cards);
    if (!combo) return err("牌型不合法");
    if (this.lastPlay && !this.beats(combo, this.lastPlay)) return err("压不过上家");
    for (const c of cards) hand.splice(hand.indexOf(c), 1);
    this.lastPlay = this.comboToJson(playerId, cards, combo);
    this.lastPlayerId = playerId; this.consecutivePasses = 0;
    if (hand.length === 0) {
      this.winnerId = playerId;
      this.winnerSide = playerId === this.landlordId ? "landlord" : "peasant";
      this.phase = "ended"; this.finished = true;
      const side = playerId === this.landlordId ? "地主" : "农民";
      return ok({ finished: true, system: `${side} ${this.names.get(playerId)} 出完牌 · ${this.winnerSide}胜利` });
    }
    this.currentTurnId = this.nextSeat(playerId);
    return ok({});
  }

  private handlePass(playerId: string): PluginResult {
    if (this.phase !== "play") return err("当前不是出牌阶段");
    if (playerId !== this.currentTurnId) return err("还没轮到你");
    if (!this.lastPlay) return err("首出不能不要");
    if (playerId === this.lastPlayerId) return err("轮到你出牌");
    this.consecutivePasses++;
    if (this.consecutivePasses >= 2) { this.currentTurnId = this.lastPlayerId; this.lastPlay = null; this.consecutivePasses = 0; }
    else this.currentTurnId = this.nextSeat(playerId);
    return ok({});
  }

  private nextSeat(pid: string): string {
    const idx = this.seatOrder.indexOf(pid);
    return this.seatOrder[(idx + 1) % this.seatOrder.length];
  }

  private parseCombo(cards: number[]): any | null {
    const n = cards.length;
    if (n === 0) return null;
    const ranks = cards.map((c) => DoudizhuPlugin.rankOf(c)).sort((a, b) => a - b);
    const counts = new Map<number, number>();
    for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
    const groups = [...counts.values()].sort((a, b) => b - a);
    const min = ranks[0], max = ranks[ranks.length - 1];
    if (n === 2 && cards.includes(52) && cards.includes(53)) return { type: "rocket", mainRank: 14, length: 2 };
    if (n === 4 && groups.join() === "4") return { type: "bomb", mainRank: min, length: 4 };
    if (n === 1) return { type: "single", mainRank: min, length: 1 };
    if (n === 2 && groups.join() === "2") return { type: "pair", mainRank: min, length: 2 };
    if (n === 3 && groups.join() === "3") return { type: "triple", mainRank: min, length: 3 };
    if (n === 4 && groups.join() === "3,1") return { type: "triple_single", mainRank: this.rankWithCount(counts, 3), length: 4 };
    if (n === 5 && groups.join() === "3,2") return { type: "triple_pair", mainRank: this.rankWithCount(counts, 3), length: 5 };
    if (n >= 5 && groups.every((g) => g === 1) && this.isConsecutive(ranks) && max <= 11) return { type: "straight", mainRank: min, length: n };
    if (n >= 6 && n % 2 === 0 && groups.every((g) => g === 2)) {
      const pr = [...counts.keys()].sort((a, b) => a - b);
      if (this.isConsecutive(pr) && pr[pr.length - 1] <= 11) return { type: "pair_straight", mainRank: pr[0], length: n };
    }
    if (n >= 6 && n % 3 === 0 && groups.every((g) => g === 3)) {
      const tr = [...counts.keys()].sort((a, b) => a - b);
      if (this.isConsecutive(tr) && tr[tr.length - 1] <= 11) return { type: "plane", mainRank: tr[0], length: n };
    }
    if (n >= 8 && n % 4 === 0) {
      const triples = [...counts.entries()].filter(([, c]) => c === 3).map(([r]) => r).sort((a, b) => a - b);
      const singles = [...counts.entries()].filter(([, c]) => c === 1).length;
      const k = n / 4;
      if (triples.length === k && singles === k && this.isConsecutive(triples) && triples[triples.length - 1] <= 11) return { type: "plane_single", mainRank: triples[0], length: n };
    }
    if (n >= 10 && n % 5 === 0) {
      const triples = [...counts.entries()].filter(([, c]) => c === 3).map(([r]) => r).sort((a, b) => a - b);
      const pairs = [...counts.entries()].filter(([, c]) => c === 2).length;
      const k = n / 5;
      if (triples.length === k && pairs === k && this.isConsecutive(triples) && triples[triples.length - 1] <= 11) return { type: "plane_pair", mainRank: triples[0], length: n };
    }
    if (n === 6 && groups.join() === "4,1,1") return { type: "four_two_single", mainRank: this.rankWithCount(counts, 4), length: 6 };
    if (n === 8 && groups.join() === "4,2,2") return { type: "four_two_pair", mainRank: this.rankWithCount(counts, 4), length: 8 };
    return null;
  }

  private rankWithCount(counts: Map<number, number>, c: number): number {
    for (const [r, v] of counts) if (v === c) return r;
    return 0;
  }
  private isConsecutive(ranks: number[]): boolean {
    for (let i = 1; i < ranks.length; i++) if (ranks[i] !== ranks[i - 1] + 1) return false;
    return true;
  }

  private beats(cur: any, last: any): boolean {
    if (cur.type === "rocket") return true;
    if (last.type === "rocket") return false;
    if (cur.type === "bomb" && last.type !== "bomb") return true;
    if (cur.type === "bomb" && last.type === "bomb") return cur.mainRank > last.mainRank;
    if (last.type === "bomb") return false;
    if (cur.type === last.type && cur.length === last.length) return cur.mainRank > last.mainRank;
    return false;
  }

  private comboToJson(playerId: string, cards: number[], combo: any): any {
    return { playerId, cards: [...cards].sort((a, b) => DoudizhuPlugin.rankOf(a) - DoudizhuPlugin.rankOf(b)), type: combo.type, mainRank: combo.mainRank, length: combo.length };
  }

  snapshot(): any { return this.build(null); }
  snapshotFor(playerId: string): any { return this.build(playerId); }

  private build(viewerId: string | null): any {
    const players: any[] = [];
    for (const pid of this.seatOrder) {
      players.push({ id: pid, name: this.names.get(pid) ?? "玩家", seat: this.seats.get(pid) ?? 0, cardCount: this.hands.get(pid)?.length ?? 0, isLandlord: pid === this.landlordId });
    }
    const snap: any = {
      phase: this.phase, players, landlordId: this.landlordId, bidValue: this.bidValue,
      currentTurnId: this.currentTurnId, lastPlay: this.lastPlay, winnerId: this.winnerId,
      winnerSide: this.winnerSide, finished: this.finished, bids: Object.fromEntries(this.bids)
    };
    if (this.phase === "play" || this.phase === "ended") snap.bottomCards = this.bottomCards;
    if (viewerId && this.hands.has(viewerId)) snap.myHand = this.hands.get(viewerId);
    return snap;
  }

  isFinished(): boolean { return this.finished; }
  reset(): void {
    this.hostId = null; this.started = false; this.finished = false; this.phase = "bid";
    this.seats.clear(); this.names.clear(); this.hands.clear(); this.bottomCards = [];
    this.landlordId = null; this.bidValue = 0; this.bids.clear(); this.bidIndex = 0; this.seatOrder = [];
    this.lastPlay = null; this.lastPlayerId = null; this.currentTurnId = null; this.consecutivePasses = 0;
    this.winnerId = null; this.winnerSide = null;
  }
}
