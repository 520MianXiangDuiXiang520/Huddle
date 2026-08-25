// Public surface of the shared authoritative runtime.
// Import from the HarmonyOS host (ArkTS) or any TS tooling/tests.

export * from "./types";
export { EventBus } from "./EventBus";
export { Room } from "./Room";
export type { RoomOptions, RoomPhase } from "./Room";
export { GameCatalog } from "./catalog";
export type { GameDef } from "./catalog";
export type { KvStorage } from "./storage";
export { MemoryStorage } from "./storage";
export { UndercoverWordStore } from "./UndercoverWordStore";
export type { UndercoverWordPair } from "./UndercoverWordStore";
export { DrawGuessWordStore } from "./DrawGuessWordStore";
export type { DrawGuessWord } from "./DrawGuessWordStore";
export { WerewolfRoleStore, WEREWOLF_ROLE_IDS, WEREWOLF_ROLE_TITLES, WEREWOLF_ROLE_BLURB } from "./WerewolfRoleStore";
