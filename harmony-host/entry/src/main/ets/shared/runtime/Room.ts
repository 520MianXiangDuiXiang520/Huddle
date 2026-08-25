import { EventBus } from "./EventBus";
import type { GamePlugin, OutboundMessage, Player, PluginResult, Role } from "./types";

export type RoomPhase = "lobby" | "playing" | "ended";

const HEARTBEAT_TIMEOUT_MS: number = 3000;
const NAME_POOL: string[] = [
  "玄狐", "青雀", "石子", "晚风", "雾灯", "赤苇", "银杏", "潮声",
  "星屑", "竹马", "白露", "苍岚", "琥珀", "南巷", "北岛", "渡口"
];

export interface RoomOptions {
  bus: EventBus;
  pluginFactory: () => GamePlugin;
  catalogGameId: string;
  minPlayers: number;
  maxPlayers: number;
  maxVisitors?: number;
  // HarmonyOS's TCP/WebSocket bridge uses socket close notifications instead
  // of browser heartbeat frames. A non-positive value disables this sweeper.
  heartbeatTimeoutMs?: number;
  onDestroy?: () => void;
}

function mapValues(m: Map<string, Player>): Player[] {
  const out: Player[] = [];
  m.forEach((p: Player) => { out.push(p); });
  return out;
}

export class Room {
  private bus: EventBus;
  private pluginFactory: () => GamePlugin;
  readonly catalogGameId: string;
  private readonly minPlayers: number;
  private readonly maxPlayers: number;
  private readonly maxVisitors: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly onDestroy: (() => void) | undefined;

  private players: Map<string, Player> = new Map<string, Player>();
  private joinOrder: string[] = [];
  private phase: RoomPhase = "lobby";
  private hostId: string | null = null;
  private plugin: GamePlugin | null = null;
  private gameId: string | null = null;
  private actionLog: ESObject[] = [];
  private sweeper: number = -1;
  /** Player ids removed during the latest onConnect (for HostRuntime to drop sockets). */
  private removedPlayerIds: string[] = [];
  /** When each player id was first created (ms). Used to collapse double-open races. */
  private createdAt: Map<string, number> = new Map<string, number>();
  /** Player ids removed by the latest onConnect ghost purge (for session teardown). */
  private purgedPlayerIds: string[] = [];

  constructor(opts: RoomOptions) {
    this.bus = opts.bus;
    this.pluginFactory = opts.pluginFactory;
    this.catalogGameId = opts.catalogGameId;
    this.minPlayers = opts.minPlayers;
    this.maxPlayers = opts.maxPlayers;
    this.maxVisitors = opts.maxVisitors !== undefined ? opts.maxVisitors : 10;
    this.heartbeatTimeoutMs = opts.heartbeatTimeoutMs !== undefined
      ? opts.heartbeatTimeoutMs
      : HEARTBEAT_TIMEOUT_MS;
    this.onDestroy = opts.onDestroy;
    this.startSweeper();
  }

  private startSweeper(): void {
    if (this.sweeper !== -1) clearInterval(this.sweeper);
    this.sweeper = setInterval((): void => { this.sweepHeartbeats(); }, 1000);
  }

  shutdown(): void {
    if (this.sweeper !== -1) { clearInterval(this.sweeper); this.sweeper = -1; }
  }

  private sweepHeartbeats(): void {
    if (this.heartbeatTimeoutMs <= 0) return;
    const now: number = Date.now();
    let changed: boolean = false;
    this.players.forEach((p: Player) => {
      if (p.connected && now - p.lastHeartbeat > this.heartbeatTimeoutMs) {
        p.connected = false;
        p.ready = false;
        changed = true;
      }
    });
    if (changed) this.broadcastRoom();
  }

  onConnect(deviceKey: string, isHostClient: boolean = false, resumePlayerId: string | null = null): string | null {
    this.removedPlayerIds = [];
    const now: number = Date.now();
    const all: Player[] = mapValues(this.players);
    let existing: Player | undefined = undefined;
    for (const p of all) { if (p.deviceKey === deviceKey) { existing = p; break; } }
    // Resume seat by id (same LAN IP, possibly new browser deviceId). Allow
    // reclaiming even while still "connected" so a double WS open collapses
    // to one player instead of seating two.
    if (!existing && resumePlayerId != null) {
      const byId: Player | undefined = this.players.get(resumePlayerId);
      if (byId) existing = byId;
    }
    // Host key may flip between local-host and d:huddle-host — reclaim the
    // canonical host seat instead of minting a second one.
    if (!existing && isHostClient) {
      if (this.hostId != null) {
        const hostPlayer: Player | undefined = this.players.get(this.hostId);
        if (hostPlayer) existing = hostPlayer;
      }
      if (!existing) {
        for (const p of all) {
          if (isHostDeviceKey(p.deviceKey)) { existing = p; break; }
        }
      }
    }
    // Empty peer IP + double WS open: first connection auto-seats a "ghost",
    // second becomes spectator. If the only non-host was created <2.5s ago,
    // treat this as the same joiner and reclaim that seat.
    if (!existing && !isHostClient) {
      const solo: string | null = this.findFreshSoloNonHost(now);
      if (solo != null) existing = this.players.get(solo);
    }
    if (existing) {
      existing.connected = true;
      existing.lastHeartbeat = now;
      existing.deviceKey = deviceKey;
      // If we reclaimed a visitor into a seat-holding identity, keep the seat.
      if (isHostClient) {
        this.hostId = existing.id;
        this.purgeStaleHostGhosts(existing.id);
      }
      this.broadcastRoom();
      return existing.id;
    }
    // Free standby seats held by disconnected / tmp: ghosts before auto-seat.
    if (this.phase === "lobby" && !isHostClient) {
      this.purgeLobbyGhostSeats();
    }
    let autoSeat: number | null = this.phase === "lobby" ? this.firstFreeSeat() : null;
    if (autoSeat === null) {
      let connectedVisitors: number = 0;
      this.players.forEach((p: Player) => { if (p.connected && p.role === "visitor") connectedVisitors++; });
      if (!isHostClient && connectedVisitors >= this.maxVisitors) return null;
    }
    const playerId: string = uuid();
    if (isHostClient) this.hostId = playerId;
    const np: Player = {
      id: playerId, deviceKey: deviceKey, name: this.pickName(), color: this.pickColor(),
      role: autoSeat !== null ? "player" : "visitor",
      seat: autoSeat, ready: false, connected: true, lastHeartbeat: now
    };
    this.players.set(playerId, np);
    this.createdAt.set(playerId, now);
    if (!this.joinOrder.includes(playerId)) this.joinOrder.push(playerId);
    if (isHostClient) this.purgeStaleHostGhosts(playerId);
    this.broadcastRoom();
    return playerId;
  }

  /**
   * Collapse a double-open that left a tmp:/disconnected ghost in the only
   * non-host seat. Never steal a healthy connected seat — that caused
   * cross-device replace wars (second phone / second tab within 2.5s).
   */
  private findFreshSoloNonHost(now: number): string | null {
    if (this.phase !== "lobby") return null;
    let onlyId: string | null = null;
    let n: number = 0;
    this.players.forEach((p: Player, id: string) => {
      if (this.hostId != null && id === this.hostId) return;
      if (isHostDeviceKey(p.deviceKey)) return;
      n++;
      onlyId = id;
    });
    if (n !== 1 || onlyId == null) return null;
    const p: Player | undefined = this.players.get(onlyId);
    if (!p || p.role !== "player" || p.seat === null) return null;
    const isTmp: boolean = p.deviceKey.indexOf("tmp:") === 0;
    if (p.connected && !isTmp) return null;
    const createdVal: number | undefined = this.createdAt.get(onlyId);
    const created: number = createdVal !== undefined ? createdVal : 0;
    if (now - created > 2500) return null;
    return onlyId;
  }

  /** Remove disconnected / tmp: non-host seat holders so a real guest can sit. */
  private purgeLobbyGhostSeats(): void {
    const remove: string[] = [];
    this.players.forEach((p: Player, id: string) => {
      if (this.hostId != null && id === this.hostId) return;
      if (isHostDeviceKey(p.deviceKey)) return;
      if (p.role !== "player" || p.seat === null) return;
      if (!p.connected || p.deviceKey.indexOf("tmp:") === 0) remove.push(id);
    });
    for (const id of remove) this.removePlayerRecord(id);
  }

  private removePlayerRecord(id: string): void {
    this.players.delete(id);
    this.createdAt.delete(id);
    const idx: number = this.joinOrder.indexOf(id);
    if (idx >= 0) this.joinOrder.splice(idx, 1);
    this.removedPlayerIds.push(id);
  }

  /** Ids removed by the most recent onConnect; HostRuntime closes their sockets. */
  drainRemovedPlayerIds(): string[] {
    const out: string[] = this.removedPlayerIds;
    this.removedPlayerIds = [];
    return out;
  }

  /**
   * Drop duplicate host identities (local-host / d:huddle-host flip) and, in
   * lobby, disconnected seated leftovers that would otherwise show as ghosts.
   */
  private purgeStaleHostGhosts(hostPlayerId: string): void {
    const remove: string[] = [];
    this.players.forEach((p: Player, id: string) => {
      if (id === hostPlayerId) return;
      if (isHostDeviceKey(p.deviceKey)) {
        remove.push(id);
        return;
      }
      if (this.phase === "lobby" && !p.connected && p.role === "player") {
        remove.push(id);
      }
    });
    if (remove.length === 0) return;
    for (const id of remove) this.removePlayerRecord(id);
  }

  async greet(playerId: string): Promise<void> {
    this.welcome(playerId);
    this.sendSync(playerId);
  }

  /** Complete authoritative state for the Harmony HTTP recovery channel. */
  syncSnapshot(playerId: string): string {
    const game: GamePlugin | null = this.plugin;
    const gameJson: string = game
      ? this.gameNtf(game, playerId)
      : this.emptyGameNtf();
    const payload: ESObject = {
      room: JSON.parse(this.roomJson(playerId)) as ESObject,
      game: JSON.parse(gameJson) as ESObject,
      ts: Date.now()
    };
    return JSON.stringify(payload);
  }

  private welcome(playerId: string): void {
    const m: ESObject = {
      type: "welcome", playerId: playerId, isHost: playerId === this.hostId,
      gameId: this.catalogGameId, minPlayers: this.minPlayers, maxPlayers: this.maxPlayers,
      ts: Date.now()
    };
    this.bus.toPlayer(playerId, JSON.stringify(m));
  }

  private pickName(): string {
    const used: Set<string> = new Set<string>();
    this.players.forEach((p: Player) => { used.add(p.name); });
    const free: string[] = NAME_POOL.filter((n: string): boolean => !used.has(n));
    const pool: string[] = free.length > 0 ? free : NAME_POOL;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private pickColor(): number {
    const used: Set<number> = new Set<number>();
    this.players.forEach((p: Player) => { if (p.connected) used.add(p.color); });
    for (let i: number = 0; i < 8; i++) if (!used.has(i)) return i;
    return Math.floor(Math.random() * 8);
  }

  onDisconnect(playerId: string): void {
    const p: Player | undefined = this.players.get(playerId);
    if (!p) return;
    p.connected = false;
    p.ready = false;
    this.broadcastRoom();
  }

  handle(playerId: string, raw: string): void {
    let json: ESObject;
    try { json = JSON.parse(raw) as ESObject; } catch (e) { this.sendError(playerId, "无效的 JSON"); return; }
    const t: string = String((json as ESObject).type != null ? (json as ESObject).type : "");
    switch (t) {
      case "heartbeat": this.handleHeartbeat(playerId); break;
      case "joinRoom": this.handleJoinRoom(playerId); break;
      case "leaveRoom": this.handleLeaveRoom(playerId); break;
      case "destroyRoom": this.handleDestroyRoom(playerId); break;
      case "joinGame": this.handleJoinGame(playerId); break;
      case "leaveGame": this.handleLeaveGame(playerId); break;
      case "ready": this.handleReady(playerId, json); break;
      case "start": this.handleStart(playerId); break;
      case "rematch": this.handleRematch(playerId); break;
      case "action": this.handleAction(playerId, json); break;
      case "sync": this.sendSync(playerId); break;
      case "ping": { const pm: ESObject = { type: "pong", ts: Date.now() }; this.bus.toPlayer(playerId, JSON.stringify(pm)); break; }
      // legacy / disabled — kept as no-op so older clients don't get "未知消息类型"
      case "join":
      case "rename":
      case "setAvatar":
      case "claimSeat":
      case "leaveSeat": break;
      default: this.sendError(playerId, "未知消息类型");
    }
  }

  private handleHeartbeat(playerId: string): void {
    const p: Player | undefined = this.players.get(playerId);
    if (!p) return;
    p.lastHeartbeat = Date.now();
    if (!p.connected) { p.connected = true; this.broadcastRoom(); }
  }

  private handleJoinRoom(playerId: string): void {
    const p: Player | undefined = this.players.get(playerId);
    if (!p) return;
    if (!p.connected) { p.connected = true; p.lastHeartbeat = Date.now(); this.broadcastRoom(); }
  }

  private handleLeaveRoom(playerId: string): void {
    const p: Player | undefined = this.players.get(playerId);
    if (!p) return;
    p.connected = false; p.ready = false;
    this.broadcastRoom();
  }

  private handleDestroyRoom(playerId: string): void {
    if (playerId !== this.hostId) { this.sendError(playerId, "只有房主可以销毁房间"); return; }
    const m: ESObject = { type: "roomClosed", reason: "host_ended", text: "房主已结束房间", ts: Date.now() };
    this.bus.broadcast(JSON.stringify(m));
    if (this.onDestroy) this.onDestroy();
  }

  private handleJoinGame(playerId: string): void {
    if (this.phase !== "lobby") { this.sendError(playerId, "对局中无法换座"); return; }
    const p: Player | undefined = this.players.get(playerId);
    if (!p || !p.connected) return;
    if (p.role === "player" && p.seat !== null) return;
    const seat: number | null = this.firstFreeSeat();
    if (seat === null) { this.sendError(playerId, "备战席已满"); return; }
    p.role = "player"; p.seat = seat; p.ready = false;
    this.broadcastRoom();
  }

  private firstFreeSeat(): number | null {
    const taken: Set<number> = new Set<number>();
    this.players.forEach((p: Player) => {
      if (p.role === "player" && p.seat !== null) taken.add(p.seat as number);
    });
    for (let i: number = 0; i < this.maxPlayers; i++) if (!taken.has(i)) return i;
    return null;
  }

  private handleLeaveGame(playerId: string): void {
    if (this.phase !== "lobby") { this.sendError(playerId, "对局中无法离开备战席"); return; }
    const p: Player | undefined = this.players.get(playerId);
    if (!p) return;
    p.role = "visitor"; p.seat = null; p.ready = false;
    this.broadcastRoom();
  }

  private handleReady(playerId: string, json: ESObject): void {
    if (this.phase !== "lobby") { this.sendError(playerId, "当前无法准备"); return; }
    const p: Player | undefined = this.players.get(playerId);
    if (!p || !p.connected) return;
    if (p.role !== "player" || p.seat === null) { this.sendError(playerId, "请先入备战席再准备"); return; }
    const r: ESObject = json;
    const readyVal: ESObject | undefined = r.ready;
    p.ready = readyVal != null && typeof readyVal === "boolean" ? readyVal as boolean : !p.ready;
    this.broadcastRoom();
  }

  private handleStart(playerId: string): void {
    if (playerId !== this.hostId) { this.sendError(playerId, "只有房主可以开始"); return; }
    if (this.phase !== "lobby") { this.sendError(playerId, "当前无法开始"); return; }
    const seated: Player[] = this.seatedPlayers();
    if (seated.length < this.minPlayers) { this.sendError(playerId, `至少需要 ${this.minPlayers} 人入座`); return; }
    if (seated.length > this.maxPlayers) { this.sendError(playerId, `最多 ${this.maxPlayers} 人入座`); return; }
    let allReady: boolean = true;
    for (const p of seated) { if (!p.ready || !p.connected) { allReady = false; break; } }
    if (!allReady) { this.sendError(playerId, "入座玩家都准备后才能开始"); return; }
    const game: GamePlugin = this.pluginFactory();
    const result: PluginResult = game.onStart(seated, playerId);
    if (result.kind === "err") { this.sendError(playerId, result.message != null ? result.message : ""); return; }
    this.plugin = game;
    this.gameId = game.id;
    this.phase = "playing";
    this.actionLog = [];
    this.players.forEach((p: Player) => { p.ready = false; });
    if (result.system) this.broadcastSystem(result.system);
    this.broadcastRoom();
    this.broadcastGame();
  }

  private handleRematch(playerId: string): void {
    if (playerId !== this.hostId) { this.sendError(playerId, "只有房主可以再来一局"); return; }
    if (this.phase !== "ended" && this.phase !== "playing") { this.sendError(playerId, "当前无法重置"); return; }
    if (this.plugin) this.plugin.reset();
    this.plugin = null; this.gameId = null; this.phase = "lobby";
    this.actionLog = [];
    this.players.forEach((p: Player) => { p.ready = false; });
    this.broadcastRoom();
    const empty: string = this.emptyGameNtf();
    this.players.forEach((p: Player) => { if (p.connected) this.bus.toPlayer(p.id, empty); });
  }

  private handleAction(playerId: string, json: ESObject): void {
    const j: ESObject = json;
    const clientActionId: string = String(j.clientActionId != null ? j.clientActionId : "");
    if (this.phase !== "playing") { this.sendActionAck(playerId, clientActionId, false, "当前不在对局中"); return; }
    const p: Player | undefined = this.players.get(playerId);
    const isHost: boolean = playerId === this.hostId;
    if (!p || (!isHost && (p.role !== "player" || p.seat === null))) { this.sendActionAck(playerId, clientActionId, false, "访客不能操作"); return; }
    const game: GamePlugin | null = this.plugin;
    if (!game) { this.sendActionAck(playerId, clientActionId, false, "游戏未加载"); return; }
    const payload: ESObject = j.payload != null ? j.payload : {};
    const result: PluginResult = game.onAction(playerId, payload);
    if (result.kind === "err") { this.sendActionAck(playerId, clientActionId, false, result.message != null ? result.message : ""); return; }
    this.sendActionAck(playerId, clientActionId, true);
    if (result.system) this.broadcastSystem(result.system);
    const logEntry: ESObject = { playerId: playerId, payload: payload, ts: Date.now() };
    this.actionLog.push(logEntry);
    // undefined means "default on" (matches Kotlin Ok.broadcastGame = true).
    if (result.broadcastGame !== false) this.broadcastGame();
    if (result.finished || game.isFinished()) {
      this.phase = "ended";
      this.broadcastRoom();
      this.broadcastGame();
    }
  }

  private seatedPlayers(): Player[] {
    const out: Player[] = [];
    for (let seat: number = 0; seat < this.maxPlayers; seat++) {
      const all: Player[] = mapValues(this.players);
      let found: Player | undefined = undefined;
      for (const x of all) { if (x.connected && x.role === "player" && x.seat === seat) { found = x; break; } }
      if (found) out.push(found);
    }
    return out;
  }

  private sendSync(playerId: string): void {
    this.bus.toPlayer(playerId, this.roomJson(playerId));
    const game: GamePlugin | null = this.plugin;
    if (game) this.bus.toPlayer(playerId, this.gameNtf(game, playerId));
    else this.bus.toPlayer(playerId, this.emptyGameNtf());
  }

  private roomJson(me: string | null): string {
    const arr: ESObject[] = [];
    for (const id of this.joinOrder) {
      const p: Player | undefined = this.players.get(id);
      if (!p) continue;
      const entry: ESObject = {
        id: p.id, name: p.name, color: p.color,
        role: p.role === "player" ? "player" : "visitor",
        seat: p.seat, ready: p.ready, connected: p.connected,
        isHost: p.id === this.hostId, isMe: me != null && p.id === me
      };
      arr.push(entry);
    }
    const root: ESObject = {
      type: "ntf_room", me: me, phase: this.phase,
      gameId: this.gameId != null ? this.gameId : this.catalogGameId, hostId: this.hostId,
      minPlayers: this.minPlayers, maxPlayers: this.maxPlayers,
      players: arr, ts: Date.now()
    };
    return JSON.stringify(root);
  }

  private broadcastRoom(): void {
    this.players.forEach((p: Player) => { if (p.connected) this.bus.toPlayer(p.id, this.roomJson(p.id)); });
  }

  private broadcastGame(): void {
    const game: GamePlugin | null = this.plugin;
    if (!game) return;
    this.players.forEach((p: Player) => { if (p.connected) this.bus.toPlayer(p.id, this.gameNtf(game, p.id)); });
  }

  private gameNtf(game: GamePlugin, playerId: string): string {
    const snap: ESObject = game.snapshotFor ? game.snapshotFor(playerId) : game.snapshot();
    snap.type = "ntf_game"; snap.gameId = game.id; snap.ts = Date.now();
    return JSON.stringify(snap);
  }

  private emptyGameNtf(): string {
    const m: ESObject = { type: "ntf_game", gameId: this.catalogGameId, empty: true, ts: Date.now() };
    return JSON.stringify(m);
  }

  private broadcastSystem(text: string): void {
    const m: ESObject = { type: "ntf_system", text: text, ts: Date.now() };
    this.bus.broadcast(JSON.stringify(m));
  }

  private sendError(playerId: string, text: string): void {
    const m: ESObject = { type: "error", text: text, ts: Date.now() };
    this.bus.toPlayer(playerId, JSON.stringify(m));
  }

  private sendActionAck(playerId: string, clientActionId: string, okFlag: boolean, text?: string): void {
    const msg: ESObject = { type: "actionAck", clientActionId: clientActionId, ok: okFlag, ts: Date.now() };
    if (text) msg.text = text;
    this.bus.toPlayer(playerId, JSON.stringify(msg));
  }
}

function isHostDeviceKey(deviceKey: string): boolean {
  return deviceKey === "local-host" || deviceKey === "d:huddle-host";
}

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c: string): string => {
    const r: number = Math.random() * 16 | 0;
    const v: number = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
