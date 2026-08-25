import type { GamePlugin, Player, PluginResult } from "../types";
import { ok, err } from "../types";
import type { WerewolfRoleStore, SpecialCounts } from "../WerewolfRoleStore";

const SPECIAL_ROLE_KEYS: string[] = ["werewolf", "seer", "witch", "hunter", "guard"];

function mapKeys(m: Map<string, string>): string[] {
  const out: string[] = [];
  m.forEach((v: string, k: string) => { out.push(k); });
  return out;
}

export class WerewolfPlugin implements GamePlugin {
  readonly id: string = "werewolf";
  private store: WerewolfRoleStore;
  constructor(store: WerewolfRoleStore) { this.store = store; }

  private hostId: string | null = null;
  private started: boolean = false;
  private finished: boolean = false;
  private phase: string = "night";
  private round: number = 0;

  private roles: Map<string, string> = new Map<string, string>();
  private names: Map<string, string> = new Map<string, string>();
  private seats: Map<string, number> = new Map<string, number>();
  private alive: Map<string, boolean> = new Map<string, boolean>();
  private deathReason: Map<string, string> = new Map<string, string>();

  private wolfTarget: string | null = null;
  private wolfVotes: Map<string, string> = new Map<string, string>();
  private seerTarget: string | null = null;
  private seerChecks: ESObject[] = [];
  private witchHealUsed: boolean = false;
  private witchPoisonUsed: boolean = false;
  private witchHealTonight: boolean = false;
  private witchPoisonTarget: string | null = null;
  private witchActed: boolean = false;
  private guardTarget: string | null = null;
  private guardLastTarget: string | null = null;
  private guardActed: boolean = false;

  private votes: Map<string, string> = new Map<string, string>();
  private pendingHunterId: string | null = null;
  private pendingHunterFromVote: boolean = false;
  private deathsThisRound: string[] = [];
  private winner: string | null = null;

  onStart(players: Player[], hostId: string): PluginResult {
    const e: string | null = this.store.validate(players.length);
    if (e) return err(e);
    this.reset();
    this.hostId = hostId;
    const specials: SpecialCounts = this.store.specialCounts();
    const specialTotal: number = specials.werewolf + specials.seer + specials.witch + specials.hunter + specials.guard;
    const villagerCount: number = players.length - specialTotal;
    const pool: string[] = [];
    for (const role of SPECIAL_ROLE_KEYS) {
      const n: number = role === "werewolf" ? specials.werewolf : role === "seer" ? specials.seer : role === "witch" ? specials.witch : role === "hunter" ? specials.hunter : specials.guard;
      for (let i: number = 0; i < n; i++) pool.push(role);
    }
    for (let i: number = 0; i < villagerCount; i++) pool.push("villager");
    pool.sort((a: string, b: string): number => Math.random() - 0.5);
    players.forEach((p: Player, i: number) => {
      const role: string = pool[i];
      this.roles.set(p.id, role); this.names.set(p.id, p.name);
      this.seats.set(p.id, p.seat != null ? p.seat : i); this.alive.set(p.id, true);
    });
    this.round = 1; this.phase = "night"; this.started = true; this.finished = false;
    const wc: number = specials.werewolf;
    return ok({ system: `天黑请闭眼 · 第 1 夜 · ${players.length} 人 · 狼人 ${wc} 名 · 各角色夜间操作后由房主「天亮」` });
  }

  private isHost(id: string): boolean { return id === this.hostId; }
  private roleOf(id: string): string | undefined { return this.roles.get(id); }
  private isAlive(id: string): boolean { return this.alive.get(id) === true; }
  private aliveWerewolves(): string[] {
    return mapKeys(this.roles).filter((id: string): boolean => this.roles.get(id) === "werewolf" && this.isAlive(id));
  }
  private aliveGood(): string[] {
    return mapKeys(this.roles).filter((id: string): boolean => this.roles.get(id) !== "werewolf" && this.isAlive(id));
  }
  private checkWin(): string | null {
    const w: number = this.aliveWerewolves().length, g: number = this.aliveGood().length;
    if (w === 0) return "villager";
    if (w >= g) return "werewolf";
    return null;
  }
  private endGame(side: string): PluginResult {
    this.winner = side; this.phase = "ended"; this.finished = true;
    return ok({ finished: true, system: side === "werewolf" ? "狼人胜利 · 好人被屠" : "好人胜利 · 狼人出局" });
  }

  onAction(playerId: string, payload: ESObject): PluginResult {
    if (!this.started) return err("对局未开始");
    if (this.finished) return err("本局已结束");
    if (!this.roles.has(playerId) && !this.isHost(playerId)) return err("只有入座玩家可以操作");
    const op: string = String(payload.op != null ? payload.op : "");
    switch (op) {
      case "night_action": return this.handleNightAction(playerId, payload);
      case "vote": return this.handleVote(playerId, payload);
      case "skip_vote": return this.handleSkipVote(playerId);
      case "dawn": return this.handleDawn(playerId);
      case "start_vote": return this.handleStartVote(playerId);
      case "resolve_vote": return this.handleResolveVote(playerId);
      case "shoot": return this.handleShoot(playerId, payload);
      case "skip_shot": return this.handleSkipShot(playerId);
      default: return err("未知操作");
    }
  }

  private handleNightAction(playerId: string, payload: ESObject): PluginResult {
    if (this.phase !== "night") return err("当前不是夜晚");
    if (!this.isAlive(playerId)) return err("你已出局");
    const role: string | undefined = this.roleOf(playerId);
    if (!role) return err("无角色");
    const target: string | null = payload.target != null ? String(payload.target) : null;
    switch (role) {
      case "werewolf": {
        if (target != null && !this.isAlive(target)) return err("目标无效");
        if (target != null && this.roles.get(target) === "werewolf") return err("狼人不能刀同伴");
        this.wolfVotes.set(playerId, target != null ? target : "");
        this.wolfTarget = target;
        return ok({});
      }
      case "seer": {
        if (this.seerTarget != null) return err("本夜已查验");
        if (!target || !this.isAlive(target)) return err("目标无效");
        if (target === playerId) return err("不能查验自己");
        this.seerTarget = target;
        const chk: ESObject = { target: target, name: this.names.get(target) != null ? this.names.get(target) as string : "玩家", result: this.roles.get(target) === "werewolf" ? "evil" : "good" };
        this.seerChecks.push(chk);
        return ok({});
      }
      case "guard": {
        if (this.guardActed) return err("本夜已守护");
        if (!target || !this.isAlive(target)) return err("目标无效");
        if (target === this.guardLastTarget) return err("不能连续两晚守同一人");
        this.guardTarget = target; this.guardActed = true;
        return ok({});
      }
      case "witch": {
        if (this.witchActed) return err("本夜已操作");
        const choice: string = String(payload.choice != null ? payload.choice : "");
        if (choice === "heal") {
          if (this.witchHealUsed) return err("解药已用过");
          if (!this.wolfTarget) return err("今晚无人被刀");
          this.witchHealTonight = true; this.witchHealUsed = true; this.witchActed = true;
        } else if (choice === "poison") {
          if (this.witchPoisonUsed) return err("毒药已用过");
          const pt: string | null = payload.poisonTarget != null ? String(payload.poisonTarget) : null;
          if (!pt || !this.isAlive(pt)) return err("毒杀目标无效");
          if (pt === playerId) return err("不能毒自己");
          this.witchPoisonTarget = pt; this.witchPoisonUsed = true; this.witchActed = true;
        } else if (choice === "pass") {
          this.witchActed = true;
        } else return err("未知的女巫操作");
        return ok({});
      }
      default: return err("你的角色夜晚无需操作");
    }
  }

  private handleDawn(playerId: string): PluginResult {
    if (!this.isHost(playerId)) return err("只有房主可以天亮");
    if (this.phase !== "night") return err("当前不是夜晚");
    this.resolveNight();
    const w: string | null = this.checkWin();
    if (w) return this.endGame(w);
    if (this.pendingHunterId) {
      this.pendingHunterFromVote = false; this.phase = "hunter_shot";
      return ok({ system: `天亮了 · ${this.names.get(this.pendingHunterId) != null ? this.names.get(this.pendingHunterId) as string : "猎人"} 是猎人，请选择是否开枪` });
    }
    this.phase = "day_announce";
    return ok({ system: this.announceText() });
  }

  private announceText(): string {
    let dn: string = "";
    for (let i: number = 0; i < this.deathsThisRound.length; i++) {
      const id: string = this.deathsThisRound[i];
      dn += (i > 0 ? "、" : "") + (this.names.get(id) != null ? this.names.get(id) as string : "玩家");
    }
    return dn ? `天亮了 · 昨夜 ${dn} 出局` : "天亮了 · 昨夜平安";
  }

  private resolveNight(): void {
    this.deathsThisRound = [];
    const victim: string | null = this.wolfTarget;
    if (victim) {
      const guarded: boolean = this.guardTarget === victim;
      const healed: boolean = this.witchHealTonight;
      const protectedFromWolves: boolean = guarded !== healed;
      if (!protectedFromWolves) this.kill(victim, "wolves");
    }
    if (this.witchPoisonTarget && this.witchPoisonUsed) this.kill(this.witchPoisonTarget, "poison");
    this.guardLastTarget = this.guardTarget;
    this.resetNightActions();
  }

  private kill(id: string, reason: string): void {
    if (!this.isAlive(id)) return;
    this.alive.set(id, false); this.deathReason.set(id, reason); this.deathsThisRound.push(id);
    if (this.roles.get(id) === "hunter" && this.phase !== "ended") this.pendingHunterId = id;
  }

  private resetNightActions(): void {
    this.wolfTarget = null; this.wolfVotes.clear(); this.seerTarget = null;
    this.witchHealTonight = false; this.witchPoisonTarget = null; this.witchActed = false;
    this.guardTarget = null; this.guardActed = false;
  }

  private handleStartVote(playerId: string): PluginResult {
    if (!this.isHost(playerId)) return err("只有房主可以发起投票");
    if (this.phase !== "day_announce") return err("当前不能发起投票");
    this.votes.clear(); this.phase = "day_vote";
    return ok({ system: "进入白天投票 · 请选择放逐对象" });
  }
  private handleVote(playerId: string, payload: ESObject): PluginResult {
    if (this.phase !== "day_vote") return err("当前不是投票阶段");
    if (!this.isAlive(playerId)) return err("你已出局");
    const target: string | null = payload.target != null ? String(payload.target) : null;
    if (!target || !this.isAlive(target)) return err("投票目标无效");
    if (target === playerId) return err("不能投自己");
    this.votes.set(playerId, target);
    return ok({});
  }
  private handleSkipVote(playerId: string): PluginResult {
    if (this.phase !== "day_vote") return err("当前不是投票阶段");
    if (!this.isAlive(playerId)) return err("你已出局");
    this.votes.delete(playerId);
    return ok({});
  }

  private handleResolveVote(playerId: string): PluginResult {
    if (!this.isHost(playerId)) return err("只有房主可以结算投票");
    if (this.phase !== "day_vote") return err("当前不是投票阶段");
    const tally: Map<string, number> = new Map<string, number>();
    this.votes.forEach((t: string) => { tally.set(t, (tally.get(t) != null ? tally.get(t) as number : 0) + 1); });
    let maxV: number = 0;
    tally.forEach((v: number) => { if (v > maxV) maxV = v; });
    const top: string[] = [];
    tally.forEach((v: number, k: string) => { if (v === maxV) top.push(k); });
    this.deathsThisRound = [];
    if (top.length === 1) this.kill(top[0], "vote");
    if (this.pendingHunterId) this.pendingHunterFromVote = true;
    const w: string | null = this.checkWin();
    if (w) return this.endGame(w);
    if (this.pendingHunterId) {
      this.phase = "hunter_shot";
      return ok({ system: `${this.names.get(this.pendingHunterId) != null ? this.names.get(this.pendingHunterId) as string : "猎人"} 被放逐，请选择是否开枪` });
    }
    return this.nextNight();
  }

  private nextNight(): PluginResult {
    this.round++; this.phase = "night"; this.deathsThisRound = [];
    return ok({ system: `天黑请闭眼 · 第 ${this.round} 夜` });
  }

  private handleShoot(playerId: string, payload: ESObject): PluginResult {
    if (this.phase !== "hunter_shot") return err("当前不是开枪阶段");
    if (playerId !== this.pendingHunterId) return err("只有该猎人可以开枪");
    const target: string | null = payload.target != null ? String(payload.target) : null;
    if (!target || !this.isAlive(target)) return err("开枪目标无效");
    const fromVote: boolean = this.pendingHunterFromVote;
    this.kill(target, "hunter");
    this.pendingHunterId = null; this.pendingHunterFromVote = false;
    const w: string | null = this.checkWin();
    if (w) return this.endGame(w);
    if (fromVote) return this.nextNight();
    this.phase = "day_announce";
    let dn: string = "";
    for (let i: number = 0; i < this.deathsThisRound.length; i++) {
      const id: string = this.deathsThisRound[i];
      dn += (i > 0 ? "、" : "") + (this.names.get(id) != null ? this.names.get(id) as string : "玩家");
    }
    return ok({ system: `猎人开枪 · ${dn} 出局` });
  }
  private handleSkipShot(playerId: string): PluginResult {
    if (this.phase !== "hunter_shot") return err("当前不是开枪阶段");
    if (playerId !== this.pendingHunterId) return err("只有该猎人可以操作");
    const fromVote: boolean = this.pendingHunterFromVote;
    this.pendingHunterId = null; this.pendingHunterFromVote = false;
    const w: string | null = this.checkWin();
    if (w) return this.endGame(w);
    if (fromVote) return this.nextNight();
    this.phase = "day_announce";
    let dn: string = "";
    for (let i: number = 0; i < this.deathsThisRound.length; i++) {
      const id: string = this.deathsThisRound[i];
      dn += (i > 0 ? "、" : "") + (this.names.get(id) != null ? this.names.get(id) as string : "玩家");
    }
    return ok({ system: dn ? `猎人未开枪 · ${dn} 出局` : "猎人未开枪 · 继续白天" });
  }

  snapshot(): ESObject { return this.build(null); }
  snapshotFor(playerId: string): ESObject { return this.build(playerId); }

  private build(viewerId: string | null): ESObject {
    const players: ESObject[] = [];
    this.roles.forEach((role: string, pid: string) => {
      const o: ESObject = {
        id: pid, name: this.names.get(pid) != null ? this.names.get(pid) as string : "玩家",
        seat: this.seats.get(pid) != null ? this.seats.get(pid) as number : 0,
        alive: this.isAlive(pid),
        role: this.phase === "ended" ? role : null,
        deathReason: this.deathReason.get(pid) != null ? this.deathReason.get(pid) as string : null
      };
      players.push(o);
    });
    const votesObj: ESObject = {};
    this.votes.forEach((t: string, k: string) => { votesObj[k] = t; });
    const snap: ESObject = {
      phase: this.phase, round: this.round, players: players,
      deathsThisRound: this.deathsThisRound, winner: this.winner,
      pendingHunterId: this.pendingHunterId, finished: this.finished,
      votes: votesObj, nightReady: this.nightReady()
    };
    if (viewerId != null && this.roles.has(viewerId)) {
      const role: string = this.roles.get(viewerId) as string;
      snap.myRole = role; snap.myAlive = this.isAlive(viewerId);
      if (role === "werewolf") {
        const fellows: string[] = [];
        this.roles.forEach((r: string, pid: string) => { if (r === "werewolf" && pid !== viewerId) fellows.push(pid); });
        snap.fellowWerewolves = fellows; snap.wolfTarget = this.wolfTarget; snap.wolfActed = this.wolfVotes.has(viewerId);
      } else if (role === "seer") {
        snap.seerChecks = this.seerChecks; snap.seerActed = this.seerTarget != null;
      } else if (role === "witch") {
        snap.healUsed = this.witchHealUsed; snap.poisonUsed = this.witchPoisonUsed;
        snap.witchActed = this.witchActed; snap.wolfVictimId = this.wolfTarget;
      } else if (role === "guard") {
        snap.guardActed = this.guardActed; snap.guardLastTarget = this.guardLastTarget;
      }
      if (this.phase === "day_vote") snap.myVote = this.votes.get(viewerId) != null ? this.votes.get(viewerId) as string : null;
    }
    return snap;
  }

  private nightReady(): ESObject {
    const wolves: string[] = this.aliveWerewolves();
    let werewolf: boolean = wolves.length > 0;
    for (const id of wolves) { if (!this.wolfVotes.has(id)) { werewolf = false; break; } }
    let seerAlive: boolean = false; let witchAlive: boolean = false; let guardAlive: boolean = false;
    this.roles.forEach((r: string, id: string) => {
      if (!this.isAlive(id)) return;
      if (r === "seer") seerAlive = true;
      else if (r === "witch") witchAlive = true;
      else if (r === "guard") guardAlive = true;
    });
    const nr: ESObject = {
      werewolf: werewolf,
      seer: !seerAlive || this.seerTarget != null,
      witch: !witchAlive || this.witchActed,
      guard: !guardAlive || this.guardActed
    };
    return nr;
  }

  isFinished(): boolean { return this.finished; }
  reset(): void {
    this.hostId = null; this.started = false; this.finished = false; this.phase = "night"; this.round = 0;
    this.roles.clear(); this.names.clear(); this.seats.clear(); this.alive.clear(); this.deathReason.clear();
    this.resetNightActions();
    this.votes.clear(); this.pendingHunterId = null; this.pendingHunterFromVote = false;
    this.deathsThisRound = []; this.seerChecks = [];
    this.witchHealUsed = false; this.witchPoisonUsed = false; this.guardLastTarget = null; this.winner = null;
  }
}
