import type { GamePlugin } from "./types";
import type { KvStorage } from "./storage";
import { UndercoverWordStore } from "./UndercoverWordStore";
import { DrawGuessWordStore } from "./DrawGuessWordStore";
import { WerewolfRoleStore } from "./WerewolfRoleStore";
import { GomokuPlugin } from "./plugins/GomokuPlugin";
import { UndercoverPlugin } from "./plugins/UndercoverPlugin";
import { DrawGuessPlugin } from "./plugins/DrawGuessPlugin";
import { WerewolfPlugin } from "./plugins/WerewolfPlugin";
import { DoudizhuPlugin } from "./plugins/DoudizhuPlugin";

export interface GameDef {
  id: string;
  title: string;
  subtitle: string;
  playersLabel: string;
  minPlayers: number;
  maxPlayers: number;
  available: boolean;
  hasConfig: boolean;
  factory: () => GamePlugin;
}

export class GameCatalog {
  readonly undercoverStore: UndercoverWordStore;
  readonly drawGuessStore: DrawGuessWordStore;
  readonly werewolfStore: WerewolfRoleStore;
  readonly all: GameDef[];

  constructor(storage: KvStorage) {
    this.undercoverStore = new UndercoverWordStore(storage);
    this.drawGuessStore = new DrawGuessWordStore(storage);
    this.werewolfStore = new WerewolfRoleStore(storage);
    this.all = [
      {
        id: "gomoku", title: "五子棋", subtitle: "经典双人对弈，适合快速开一局",
        playersLabel: "2 人", minPlayers: 2, maxPlayers: 2, available: true, hasConfig: false,
        factory: (): GamePlugin => new GomokuPlugin()
      },
      {
        id: "undercover", title: "谁是卧底", subtitle: "自定义词库，发牌找卧底",
        playersLabel: "3–8 人", minPlayers: 3, maxPlayers: 8, available: true, hasConfig: true,
        factory: (): GamePlugin => new UndercoverPlugin(this.undercoverStore)
      },
      {
        id: "draw_guess", title: "你画我猜", subtitle: "一人作画，大家猜词",
        playersLabel: "3–8 人", minPlayers: 3, maxPlayers: 8, available: true, hasConfig: true,
        factory: (): GamePlugin => new DrawGuessPlugin(this.drawGuessStore)
      },
      {
        id: "werewolf", title: "狼人杀", subtitle: "自定义角色配置，夜晚与白天交替",
        playersLabel: "6–12 人", minPlayers: 6, maxPlayers: 12, available: true, hasConfig: true,
        factory: (): GamePlugin => new WerewolfPlugin(this.werewolfStore)
      },
      {
        id: "doudizhu", title: "斗地主", subtitle: "三人对战，叫分定地主，地主对抗两农民",
        playersLabel: "3 人", minPlayers: 3, maxPlayers: 3, available: true, hasConfig: false,
        factory: (): GamePlugin => new DoudizhuPlugin()
      }
    ];
  }

  find(id: string): GameDef | undefined {
    return this.all.find((g: GameDef): boolean => g.id === id);
  }

  requireAvailable(id: string): GameDef {
    const g: GameDef | undefined = this.find(id);
    if (!g) throw new Error(`unknown game: ${id}`);
    if (!g.available) throw new Error(`game not available: ${id}`);
    return g;
  }

  resolvedMinPlayers(g: GameDef): number {
    if (g.id === "undercover") return this.undercoverStore.minPlayers();
    if (g.id === "werewolf") return this.werewolfStore.minPlayers();
    return g.minPlayers;
  }
  resolvedMaxPlayers(g: GameDef): number {
    if (g.id === "undercover") return this.undercoverStore.maxPlayers();
    if (g.id === "werewolf") return this.werewolfStore.maxPlayers();
    return g.maxPlayers;
  }
  resolvedPlayersLabel(g: GameDef): string {
    if (g.id === "undercover") return this.undercoverStore.playersLabel();
    if (g.id === "werewolf") return this.werewolfStore.playersLabel();
    return g.playersLabel;
  }
}
