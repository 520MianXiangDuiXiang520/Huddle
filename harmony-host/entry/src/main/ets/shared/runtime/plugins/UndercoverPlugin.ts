import type { GamePlugin, Player, PluginResult } from "../types";
import { ok, err } from "../types";
import type { UndercoverWordStore } from "../UndercoverWordStore";

export class UndercoverPlugin implements GamePlugin {
  readonly id: string = "undercover";
  private store: UndercoverWordStore;
  constructor(store: UndercoverWordStore) { this.store = store; }

  private hostId: string | null = null;
  private undercoverCount: number = 1;
  private civilianWord: string = "";
  private undercoverWord: string = "";
  private phase: string = "secret";
  private finished: boolean = false;
  private started: boolean = false;
  private roles: Map<string, string> = new Map<string, string>();
  private names: Map<string, string> = new Map<string, string>();
  private seats: Map<string, number> = new Map<string, number>();

  onStart(players: Player[], hostId: string): PluginResult {
    this.reset();
    const minNeed: number = this.store.minPlayers();
    if (players.length < minNeed) return err(`谁是卧底至少需要 ${minNeed} 人入座`);
    const count: number = this.store.undercoverCount();
    if (count < 1 || count >= players.length) return err(`卧底人数须在 1 到 ${players.length - 1} 之间，请先在配置里调整`);
    const pair = this.store.pickUnused();
    if (!pair) return err("词库没有可用词组，请先在配置里添加或重新加入");
    this.hostId = hostId; this.undercoverCount = count;
    this.civilianWord = pair.civilian; this.undercoverWord = pair.undercover;
    const shuffled: Player[] = players.slice();
    shuffled.sort((a: Player, b: Player): number => Math.random() - 0.5);
    const ucIds: Set<string> = new Set<string>();
    for (let i: number = 0; i < count && i < shuffled.length; i++) ucIds.add(shuffled[i].id);
    for (const p of players) {
      this.roles.set(p.id, ucIds.has(p.id) ? "undercover" : "civilian");
      this.names.set(p.id, p.name); this.seats.set(p.id, p.seat != null ? p.seat : 0);
    }
    this.store.markUsed(pair.id);
    this.phase = "secret"; this.finished = false; this.started = true;
    return ok({ system: `词语已发放 · ${players.length} 人 · 卧底 ${count} 人 · 线下讨论后由房主揭晓` });
  }

  onAction(playerId: string, payload: ESObject): PluginResult {
    if (!this.started) return err("对局未开始");
    if (this.finished || this.phase === "revealed") return err("已经揭晓");
    if (payload.op !== "reveal") return err("未知操作");
    if (playerId !== this.hostId) return err("只有房主可以揭晓");
    this.phase = "revealed"; this.finished = true;
    return ok({ finished: true, system: "身份已揭晓" });
  }

  snapshot(): ESObject { return this.build(null); }
  snapshotFor(playerId: string): ESObject { return this.build(playerId); }

  private build(viewerId: string | null): ESObject {
    const revealed: boolean = this.phase === "revealed";
    const players: ESObject[] = [];
    this.roles.forEach((role: string, pid: string) => {
      const o: ESObject = { id: pid, name: this.names.get(pid) != null ? this.names.get(pid) as string : "玩家", seat: this.seats.get(pid) != null ? this.seats.get(pid) as number : 0 };
      if (revealed) { o.role = role; o.word = role === "undercover" ? this.undercoverWord : this.civilianWord; }
      players.push(o);
    });
    const snap: ESObject = { phase: this.phase, undercoverCount: this.undercoverCount, players: players, finished: this.finished };
    if (viewerId != null && this.roles.has(viewerId)) {
      const myRole: string = this.roles.get(viewerId) as string;
      snap.myWord = myRole === "undercover" ? this.undercoverWord : this.civilianWord;
      if (revealed) snap.myRole = myRole;
    }
    if (revealed) { snap.civilianWord = this.civilianWord; snap.undercoverWord = this.undercoverWord; }
    return snap;
  }

  isFinished(): boolean { return this.finished; }
  reset(): void {
    this.hostId = null; this.undercoverCount = 1; this.civilianWord = ""; this.undercoverWord = "";
    this.phase = "secret"; this.finished = false; this.started = false;
    this.roles.clear(); this.names.clear(); this.seats.clear();
  }
}
