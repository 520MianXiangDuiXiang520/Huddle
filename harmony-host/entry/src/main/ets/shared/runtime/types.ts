// Shared authoritative runtime types — ArkTS-strict compatible.
// `ESObject` is ArkTS's dynamic escape hatch for JSON payloads/snapshots;
// a node-side shim (test/esobject-shim.d.ts) aliases it to `any` for the smoke test.

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

export interface PluginResult {
  kind: string;
  message?: string;
  finished?: boolean;
  system?: string;
  broadcastGame?: boolean;
}

export interface OkOptions {
  finished?: boolean;
  system?: string;
  broadcastGame?: boolean;
}

export function ok(opts?: OkOptions): PluginResult {
  // ArkTS has no `??` in older toolchains; mirror Kotlin/shared defaults:
  // broadcastGame/finished default to true/false when omitted (including ok({})).
  // Bug: `opts ? opts.broadcastGame : true` yields undefined for ok({}), so
  // Room skipped broadcastGame after every normal move (gomoku stones, strokes…).
  const broadcastGame: boolean = (opts != null && opts.broadcastGame != null)
    ? opts.broadcastGame
    : true;
  const finished: boolean = (opts != null && opts.finished != null)
    ? opts.finished
    : false;
  const r: PluginResult = {
    kind: "ok",
    broadcastGame: broadcastGame,
    finished: finished,
    system: opts != null ? opts.system : undefined
  };
  return r;
}

export function err(message: string): PluginResult {
  const r: PluginResult = { kind: "err", message: message };
  return r;
}

export interface GamePlugin {
  readonly id: string;
  onStart(players: Player[], hostId: string): PluginResult;
  onAction(playerId: string, payload: ESObject): PluginResult;
  snapshot(): ESObject;
  snapshotFor?(playerId: string): ESObject;
  isFinished(): boolean;
  reset(): void;
}

export interface OutboundMessage {
  kind: string;
  json: string;
  playerId?: string;
}

export type BusSink = (msg: OutboundMessage) => void;
