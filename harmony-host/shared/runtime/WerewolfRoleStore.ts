import type { KvStorage } from "./storage";

export const WEREWOLF_ROLE_IDS = ["werewolf", "seer", "witch", "hunter", "guard", "villager"] as const;
export const WEREWOLF_ROLE_TITLES: Record<string, string> = {
  werewolf: "狼人", seer: "预言家", witch: "女巫", hunter: "猎人", guard: "守卫", villager: "平民"
};
export const WEREWOLF_ROLE_BLURB: Record<string, string> = {
  werewolf: "夜晚与同伴一起选择击杀目标", seer: "每晚查验一名玩家的阵营",
  witch: "拥有一瓶解药和一瓶毒药", hunter: "出局时可开枪带走一名玩家",
  guard: "每晚守护一名玩家免于被刀", villager: "没有夜晚技能，白天靠发言与投票找出狼人"
};

export class WerewolfRoleStore {
  constructor(private s: KvStorage) {}

  minPlayers(): number {
    const min = clamp(this.s.getNumber("ww_min", 6), 6, 12);
    const max = clamp(this.s.getNumber("ww_max", 12), 6, 12);
    return Math.min(min, max);
  }
  maxPlayers(): number {
    const min = clamp(this.s.getNumber("ww_min", 6), 6, 12);
    const max = clamp(this.s.getNumber("ww_max", 12), 6, 12);
    return Math.max(min, max);
  }
  setMinPlayers(v: number) { this.s.setNumber("ww_min", clamp(v, 6, this.maxPlayers())); }
  setMaxPlayers(v: number) { this.s.setNumber("ww_max", clamp(v, this.minPlayers(), 12)); }
  playersLabel(): string { const a = this.minPlayers(), b = this.maxPlayers(); return a === b ? `${a} 人` : `${a}–${b} 人`; }

  werewolfCount(): number { return clamp(this.s.getNumber("ww_werewolf", 2), 1, 4); }
  seerCount(): number { return clamp(this.s.getNumber("ww_seer", 1), 0, 2); }
  witchCount(): number { return clamp(this.s.getNumber("ww_witch", 1), 0, 2); }
  hunterCount(): number { return clamp(this.s.getNumber("ww_hunter", 1), 0, 2); }
  guardCount(): number { return clamp(this.s.getNumber("ww_guard", 0), 0, 2); }
  setWerewolfCount(v: number) { this.s.setNumber("ww_werewolf", clamp(v, 1, 4)); }
  setSeerCount(v: number) { this.s.setNumber("ww_seer", clamp(v, 0, 2)); }
  setWitchCount(v: number) { this.s.setNumber("ww_witch", clamp(v, 0, 2)); }
  setHunterCount(v: number) { this.s.setNumber("ww_hunter", clamp(v, 0, 2)); }
  setGuardCount(v: number) { this.s.setNumber("ww_guard", clamp(v, 0, 2)); }

  specialCounts(): Record<string, number> {
    return {
      werewolf: this.werewolfCount(), seer: this.seerCount(),
      witch: this.witchCount(), hunter: this.hunterCount(), guard: this.guardCount()
    };
  }
  specialTotal(): number { return Object.values(this.specialCounts()).reduce((a, b) => a + b, 0); }

  validate(playerCount: number): string | null {
    const min = this.minPlayers(), max = this.maxPlayers();
    if (playerCount < min) return `狼人杀至少需要 ${min} 人入座`;
    if (playerCount > max) return `狼人杀最多 ${max} 人`;
    const special = this.specialTotal();
    if (special > playerCount) return `角色配置共 ${special} 人，超过本局 ${playerCount} 人，请减少特殊角色`;
    const wolves = this.werewolfCount();
    if (wolves * 2 >= playerCount) return `狼人数量过多，至少需要 ${wolves + 1} 名好人才能开局`;
    return null;
  }
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
