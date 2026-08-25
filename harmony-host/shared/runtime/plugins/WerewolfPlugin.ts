import type { GamePlugin, Player, PluginResult } from "../types";
import { ok, err } from "../types";
import type { WerewolfRoleStore } from "../WerewolfRoleStore";

export class WerewolfPlugin implements GamePlugin {
  readonly id = "werewolf";
  constructor(private store: WerewolfRoleStore) {}

  private hostId: string | null = null;
  private started = false;
  private finished = false;
  private phase = "night";
  private round = 0;

  private roles = new Map<string, string>();
  private names = new Map<string, string>();
  private seats = new Map<string, number>();
  private alive = new Map<string, boolean>();
  private deathReason = new Map<string, string>();

  private wolfTarget: string | null = null;
  private wolfVotes = new Map<string, string>();
  private seerTarget: string | null = null;
  private seerChecks: any[] = [];
  private witchHealUsed = false;
  private witchPoisonUsed = false;
  private witchHealTonight = false;
  private witchPoisonTarget: string | null = null;
  private witchActed = false;
  private guardTarget: string | null = null;
  private guardLastTarget: string | null = null;
  private guardActed = false;

  private votes = new Map<string, string>();
  private pendingHunterId: string | null = null;
  private pendingHunterFromVote = false;
  private deathsThisRound: string[] = [];
  private winner: string | null = null;

  onStart(players: Player[], hostId: string): PluginResult {
    const e = this.store.validate(players.length);
    if (e) return err(e);
    this.reset();
    this.hostId = hostId;
    const specials = this.store.specialCounts();
    const villagerCount = players.length - Object.values(specials).reduce((a, b) => a + b, 0);
    const pool: string[] = [];
    for (const [role, n] of Object.entries(specials)) for (let i = 0; i < n; i++) pool.push(role);
    for (let i = 0; i < villagerCount; i++) pool.push("villager");
    pool.sort(() => Math.random() - 0.5);
    players.forEach((p, i) => {
      const role = pool[i];
      this.roles.set(p.id, role); this.names.set(p.id, p.name);
      this.seats.set(p.id, p.seat ?? i); this.alive.set(p.id, true);
    });
    this.round = 1; this.phase = "night"; this.started = true; this.finished = false;
    const wc = specials["werewolf"] ?? 1;
    return ok({ system: `天黑请闭眼 · 第 1 夜 · ${players.length} 人 · 狼人 ${wc} 名 · 各角色夜间操作后由房主「天亮」` });
  }

  private isHost(id: string): boolean { return id === this.hostId; }
  private roleOf(id: string): string | undefined { return this.roles.get(id); }
  private isAlive(id: string): boolean { return this.alive.get(id) === true; }
  private aliveWerewolves(): string[] { return [...this.roles.keys()].filter((id) => this.roles.get(id) === "werewolf" && this.isAlive(id)); }
  private aliveGood(): string[] { return [...this.roles.keys()].filter((id) => this.roles.get(id) !== "werewolf" && this.isAlive(id)); }
  private checkWin(): string | null {
    const w = this.aliveWerewolves().length, g = this.aliveGood().length;
    if (w === 0) return "villager";
    if (w >= g) return "werewolf";
    return null;
  }
  private endGame(side: string): PluginResult {
    this.winner = side; this.phase = "ended"; this.finished = true;
    return ok({ finished: true, system: side === "werewolf" ? "狼人胜利 · 好人被屠" : "好人胜利 · 狼人出局" });
  }

  onAction(playerId: string, payload: any): PluginResult {
    if (!this.started) return err("对局未开始");
    if (this.finished) return err("本局已结束");
    if (!this.roles.has(playerId) && !this.isHost(playerId)) return err("只有入座玩家可以操作");
    switch (payload.op) {
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

  private handleNightAction(playerId: string, payload: any): PluginResult {
    if (this.phase !== "night") return err("当前不是夜晚");
    if (!this.isAlive(playerId)) return err("你已出局");
    const role = this.roleOf(playerId);
    if (!role) return err("无角色");
    const target = payload.target ? String(payload.target) : null;
    switch (role) {
      case "werewolf": {
        if (target != null && !this.isAlive(target)) return err("目标无效");
        if (target != null && this.roles.get(target) === "werewolf") return err("狼人不能刀同伴");
        this.wolfVotes.set(playerId, target ?? "");
        this.wolfTarget = target;
        return ok({});
      }
      case "seer": {
        if (this.seerTarget) return err("本夜已查验");
        if (!target || !this.isAlive(target)) return err("目标无效");
        if (target === playerId) return err("不能查验自己");
        this.seerTarget = target;
        this.seerChecks.push({ target, name: this.names.get(target) ?? "玩家", result: this.roles.get(target) === "werewolf" ? "evil" : "good" });
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
        const choice = payload.choice;
        if (choice === "heal") {
          if (this.witchHealUsed) return err("解药已用过");
          if (!this.wolfTarget) return err("今晚无人被刀");
          this.witchHealTonight = true; this.witchHealUsed = true; this.witchActed = true;
        } else if (choice === "poison") {
          if (this.witchPoisonUsed) return err("毒药已用过");
          const pt = payload.poisonTarget ? String(payload.poisonTarget) : null;
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
    const w = this.checkWin();
    if (w) return this.endGame(w);
    if (this.pendingHunterId) {
      this.pendingHunterFromVote = false; this.phase = "hunter_shot";
      return ok({ system: `天亮了 · ${this.names.get(this.pendingHunterId) ?? "猎人"} 是猎人，请选择是否开枪` });
    }
    this.phase = "day_announce";
    return ok({ system: this.announceText() });
  }

  private announceText(): string {
    const dn = this.deathsThisRound.map((id) => this.names.get(id) ?? "玩家").join("、");
    return dn ? `天亮了 · 昨夜 ${dn} 出局` : "天亮了 · 昨夜平安";
  }

  private resolveNight(): void {
    this.deathsThisRound = [];
    const victim = this.wolfTarget;
    if (victim) {
      const guarded = this.guardTarget === victim;
      const healed = this.witchHealTonight;
      const protectedFromWolves = guarded !== healed; // XOR
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
  private handleVote(playerId: string, payload: any): PluginResult {
    if (this.phase !== "day_vote") return err("当前不是投票阶段");
    if (!this.isAlive(playerId)) return err("你已出局");
    const target = payload.target ? String(payload.target) : null;
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
    const tally = new Map<string, number>();
    for (const t of this.votes.values()) tally.set(t, (tally.get(t) ?? 0) + 1);
    const maxV = Math.max(0, ...tally.values());
    const top = maxV > 0 ? [...tally.entries()].filter(([, v]) => v === maxV).map(([k]) => k) : [];
    this.deathsThisRound = [];
    if (top.length === 1) this.kill(top[0], "vote");
    if (this.pendingHunterId) this.pendingHunterFromVote = true;
    const w = this.checkWin();
    if (w) return this.endGame(w);
    if (this.pendingHunterId) {
      this.phase = "hunter_shot";
      return ok({ system: `${this.names.get(this.pendingHunterId) ?? "猎人"} 被放逐，请选择是否开枪` });
    }
    return this.nextNight();
  }

  private nextNight(): PluginResult {
    this.round++; this.phase = "night"; this.deathsThisRound = [];
    return ok({ system: `天黑请闭眼 · 第 ${this.round} 夜` });
  }

  private handleShoot(playerId: string, payload: any): PluginResult {
    if (this.phase !== "hunter_shot") return err("当前不是开枪阶段");
    if (playerId !== this.pendingHunterId) return err("只有该猎人可以开枪");
    const target = payload.target ? String(payload.target) : null;
    if (!target || !this.isAlive(target)) return err("开枪目标无效");
    const fromVote = this.pendingHunterFromVote;
    this.kill(target, "hunter");
    this.pendingHunterId = null; this.pendingHunterFromVote = false;
    const w = this.checkWin();
    if (w) return this.endGame(w);
    if (fromVote) return this.nextNight();
    this.phase = "day_announce";
    return ok({ system: `猎人开枪 · ${this.deathsThisRound.map((id) => this.names.get(id) ?? "玩家").join("、")} 出局` });
  }
  private handleSkipShot(playerId: string): PluginResult {
    if (this.phase !== "hunter_shot") return err("当前不是开枪阶段");
    if (playerId !== this.pendingHunterId) return err("只有该猎人可以操作");
    const fromVote = this.pendingHunterFromVote;
    this.pendingHunterId = null; this.pendingHunterFromVote = false;
    const w = this.checkWin();
    if (w) return this.endGame(w);
    if (fromVote) return this.nextNight();
    this.phase = "day_announce";
    const dn = this.deathsThisRound.map((id) => this.names.get(id) ?? "玩家").join("、");
    return ok({ system: dn ? `猎人未开枪 · ${dn} 出局` : "猎人未开枪 · 继续白天" });
  }

  snapshot(): any { return this.build(null); }
  snapshotFor(playerId: string): any { return this.build(playerId); }

  private build(viewerId: string | null): any {
    const players: any[] = [];
    for (const [pid, role] of this.roles) {
      players.push({
        id: pid, name: this.names.get(pid) ?? "玩家", seat: this.seats.get(pid) ?? 0,
        alive: this.isAlive(pid),
        role: this.phase === "ended" ? role : null,
        deathReason: this.deathReason.get(pid) ?? null
      });
    }
    const snap: any = {
      phase: this.phase, round: this.round, players,
      deathsThisRound: this.deathsThisRound, winner: this.winner,
      pendingHunterId: this.pendingHunterId, finished: this.finished,
      votes: Object.fromEntries(this.votes), nightReady: this.nightReady()
    };
    if (viewerId && this.roles.has(viewerId)) {
      const role = this.roles.get(viewerId)!;
      snap.myRole = role; snap.myAlive = this.isAlive(viewerId);
      if (role === "werewolf") {
        const fellows: string[] = [];
        for (const [pid, r] of this.roles) if (r === "werewolf" && pid !== viewerId) fellows.push(pid);
        snap.fellowWerewolves = fellows; snap.wolfTarget = this.wolfTarget; snap.wolfActed = this.wolfVotes.has(viewerId);
      } else if (role === "seer") {
        snap.seerChecks = this.seerChecks; snap.seerActed = this.seerTarget != null;
      } else if (role === "witch") {
        snap.healUsed = this.witchHealUsed; snap.poisonUsed = this.witchPoisonUsed;
        snap.witchActed = this.witchActed; snap.wolfVictimId = this.wolfTarget;
      } else if (role === "guard") {
        snap.guardActed = this.guardActed; snap.guardLastTarget = this.guardLastTarget;
      }
      if (this.phase === "day_vote") snap.myVote = this.votes.get(viewerId) ?? null;
    }
    return snap;
  }

  private nightReady(): any {
    const wolves = this.aliveWerewolves();
    const werewolf = wolves.length > 0 && wolves.every((id) => this.wolfVotes.has(id));
    const seerAlive = [...this.roles.entries()].some(([id, r]) => r === "seer" && this.isAlive(id));
    const witchAlive = [...this.roles.entries()].some(([id, r]) => r === "witch" && this.isAlive(id));
    const guardAlive = [...this.roles.entries()].some(([id, r]) => r === "guard" && this.isAlive(id));
    return {
      werewolf,
      seer: !seerAlive || this.seerTarget != null,
      witch: !witchAlive || this.witchActed,
      guard: !guardAlive || this.guardActed
    };
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
