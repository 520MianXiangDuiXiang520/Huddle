// Shared authoritative runtime types — framework-agnostic TypeScript.
// Mirrors com.huddle.host.runtime.* (Kotlin) so the HarmonyOS host and any
// future shared runtime use identical authoritative logic.

export type Role = "player" | "visitor";

export interface Player {
  id: string;
  deviceKey: string;
  name: string;
  color: number;
  role: Role;
  seat: number | null;
  ready: boolean;
  connected: boolean;
  lastHeartbeat: number;
}

export type PluginResult =
  | { kind: "ok"; broadcastGame?: boolean; finished?: boolean; system?: string }
  | { kind: "err"; message: string };

export function ok(opts: { finished?: boolean; system?: string; broadcastGame?: boolean } = {}): PluginResult {
  return { kind: "ok", broadcastGame: opts.broadcastGame ?? true, finished: opts.finished ?? false, system: opts.system };
}
export function err(message: string): PluginResult {
  return { kind: "err", message };
}

export interface GamePlugin {
  readonly id: string;
  onStart(players: Player[], hostId: string): PluginResult;
  onAction(playerId: string, payload: any): PluginResult;
  snapshot(): any;
  snapshotFor?(playerId: string): any;
  isFinished(): boolean;
  reset(): void;
}

export type OutboundMessage =
  | { kind: "broadcast"; json: string }
  | { kind: "toPlayer"; playerId: string; json: string };

export type BusSink = (msg: OutboundMessage) => void;
