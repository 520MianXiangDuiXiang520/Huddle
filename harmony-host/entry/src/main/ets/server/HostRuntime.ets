import { common } from '@kit.AbilityKit';
import resourceManager from '@ohos.resourceManager';
import { fileIo } from '@kit.CoreFileKit';
import { HttpFileServer, HttpJsonResponse, WsConn } from './HttpFileServer';
import { EventBus, Room, GameCatalog } from '../shared/runtime/index';
import type { GameDef, OutboundMessage } from '../shared/runtime/index';
import { PrefsStorage } from '../data/Prefs';

const HTTP_PORT: number = 8765;

/**
 * Glues the shared authoritative Room to the HarmonyOS network layer.
 * One HostRuntime per room session: starts HTTP (static www) + WS (room
 * protocol), tracks playerId -> WsClient, and drives the EventBus sink.
 */
export class HostRuntime {
  static selectedGameId: string = 'gomoku';

  private context: common.UIAbilityContext;
  private catalog: GameCatalog;
  private bus: EventBus;
  private room: Room;
  private http: HttpFileServer;
  private sessions: Map<string, WsConn> = new Map<string, WsConn>();
  private connToPlayer: Map<string, string> = new Map<string, string>();
  private playerToConn: Map<string, string> = new Map<string, string>();
  // Browser-stable deviceId -> Room player identity for HTTP state recovery.
  private deviceToPlayer: Map<string, string> = new Map<string, string>();
  // LAN IP -> last Room player for that address. One phone per LAN IP: reclaim
  // even when the previous socket is still open (QR in-app preview + system
  // browser, or double WS with a fresh localStorage deviceId).
  private ipToPlayer: Map<string, string> = new Map<string, string>();
  // Serialize connect/message/close against Room — Harmony TCP callbacks can
  // interleave across connections around await points in the WS upgrade.
  private roomGate: Promise<void> = Promise.resolve();
  private heartbeatTimer: number | null = null;
  private wwwRoot: string;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
    const storage: PrefsStorage = new PrefsStorage(context, 'huddle_runtime');
    this.catalog = new GameCatalog(storage);
    const game: GameDef = (() => {
      try { return this.catalog.requireAvailable(HostRuntime.selectedGameId); }
      catch (e) { return this.catalog.requireAvailable('gomoku'); }
    })();
    this.bus = new EventBus((msg: OutboundMessage) => { this.deliver(msg); });
    this.room = new Room({
      bus: this.bus,
      pluginFactory: game.factory,
      catalogGameId: game.id,
      minPlayers: this.catalog.resolvedMinPlayers(game),
      maxPlayers: this.catalog.resolvedMaxPlayers(game),
      // Harmony browser clients use socket-close detection. Sending application
      // heartbeat frames triggers a platform TCP half-duplex defect.
      heartbeatTimeoutMs: 0,
      onDestroy: () => { this.stop(); }
    });
    this.wwwRoot = `${context.filesDir}/www`;
    this.http = new HttpFileServer(this.wwwRoot);
  }

  get catalogRef(): GameCatalog { return this.catalog; }
  get clientCount(): number { return this.sessions.size; }

  async start(): Promise<void> {
    await this.materializeWww();
    this.http.onWsConnect = (connId: string, client: WsConn, deviceId: string): void => { this.onWsConnect(connId, client, deviceId); };
    this.http.onWsMessage = (connId: string, text: string): void => { this.onWsMessage(connId, text); };
    this.http.onWsClose = (connId: string): void => { this.onWsClose(connId); };
    this.http.onSyncRequest = (deviceId: string): HttpJsonResponse | null => {
      return this.syncForDevice(deviceId);
    };
    await this.http.start();
    // Do NOT send application-level serverHeartbeat on Harmony. The local
    // TCP↔WebSocket bridge can enter a half-duplex state where later
    // server→browser frames (ntf_game / actionAck) are silently dropped after
    // bidirectional app traffic. Clients use hb=0 + HTTP /sync polling instead.
    this.heartbeatTimer = null;
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer != null) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    this.broadcastRaw(JSON.stringify({ type: 'roomClosed', reason: 'host_ended', text: '房主已结束房间', ts: Date.now() }));
    this.room.shutdown();
    await this.http.stop();
    this.sessions.clear();
    this.connToPlayer.clear();
    this.playerToConn.clear();
    this.deviceToPlayer.clear();
    this.ipToPlayer.clear();
  }

  /** Copy rawfile/www -> sandbox wwwRoot so HttpFileServer can read by path. */
  private async materializeWww(): Promise<void> {
    try { await fileIo.mkdir(this.wwwRoot, true); } catch (e) {}
    const rm: resourceManager.ResourceManager = this.context.resourceManager;
    await copyRawfileDir(rm, 'www', this.wwwRoot);
  }

  private onWsConnect(connId: string, client: WsConn, deviceId: string): void {
    this.withRoomGate(() => { this.onWsConnectLocked(connId, client, deviceId); });
  }

  private onWsConnectLocked(connId: string, client: WsConn, deviceId: string): void {
    const trimmedDevice: string = deviceId.trim();
    // Host App always passes ?d=huddle-host. Keep that as host even when the
    // peer IP is mis-reported as a LAN address (common on Harmony TCP servers).
    // Guests must not keep "huddle-host" in localStorage — ws.js clears it.
    const isHostClient: boolean = isLoopback(client.remoteHost) || trimmedDevice === 'huddle-host';
    if (!isHostClient && trimmedDevice.length < 8) {
      // Refuse anonymous WS — tmp: random keys become un-mergeable ghost seats.
      client.close();
      return;
    }
    const clientKey: string = resolveClientKey(trimmedDevice, client.remoteHost);
    const ip: string = normalizeRemoteIp(client.remoteHost);
    // One non-host seat per LAN IP. Reclaim even if the previous socket is still
    // open — otherwise a double-open (preview browser + real browser, or two
    // deviceIds) mints a second player the moment the guest joins.
    let resumePlayerId: string | null = null;
    if (!isHostClient && ip.length > 0 && !isLoopback(ip)) {
      const prev: string | undefined = this.ipToPlayer.get(ip);
      if (prev != null) resumePlayerId = prev;
    }
    const playerId: string | null = this.room.onConnect(clientKey, isHostClient, resumePlayerId);
    if (!playerId) { client.close(); return; }
    if (trimmedDevice.length > 0) this.deviceToPlayer.set(trimmedDevice, playerId);
    if (!isHostClient && ip.length > 0 && !isLoopback(ip)) {
      this.ipToPlayer.set(ip, playerId);
    }
    // Drop TCP sessions for identities Room just purged (host key flip ghosts).
    const removed: string[] = this.room.drainRemovedPlayerIds();
    for (let i: number = 0; i < removed.length; i++) {
      this.dropSession(removed[i], false, true);
    }
    // A previous connection for this player may still be open (reconnect).
    // Supersede it BEFORE registering the new one, so the stale close event
    // becomes a no-op (mirrors Android's `sessions[playerId] === session`).
    const prevConnId: string | undefined = this.playerToConn.get(playerId);
    if (prevConnId != null && prevConnId !== connId) {
      this.connToPlayer.delete(prevConnId);
      const prevClient: WsConn | undefined = this.sessions.get(playerId);
      // Notify + close with 4000. Text frame is the reliable signal when the
      // close code is lost (browser reports 1006) — client must not reconnect.
      if (prevClient) this.replaceSession(prevClient);
    }
    this.connToPlayer.set(connId, playerId);
    this.playerToConn.set(playerId, connId);
    this.sessions.set(playerId, client);
    this.room.greet(playerId);
  }

  /** Tell a superseded socket to stay down, then tear it down. */
  private replaceSession(client: WsConn): void {
    const payload: string = JSON.stringify({ type: 'sessionReplaced', ts: Date.now() });
    const finish: () => void = (): void => {
      try { client.close(true); } catch (e) {}
    };
    client.send(payload).then(finish).catch(finish);
  }

  private onWsMessage(connId: string, text: string): void {
    this.withRoomGate(() => {
      const playerId: string | undefined = this.connToPlayer.get(connId);
      if (playerId) this.room.handle(playerId, text);
    });
  }

  private onWsClose(connId: string): void {
    this.withRoomGate(() => {
      const playerId: string | undefined = this.connToPlayer.get(connId);
      if (!playerId) return; // already superseded by a newer connection
      this.connToPlayer.delete(connId);
      // Only tear down the player session if this conn is still the live one.
      if (this.playerToConn.get(playerId) === connId) {
        this.playerToConn.delete(playerId);
        this.sessions.delete(playerId);
        this.room.onDisconnect(playerId);
      }
    });
  }

  /** Run Room-touching work strictly one-at-a-time. */
  private withRoomGate(fn: () => void): void {
    this.roomGate = this.roomGate.then(() => {
      try { fn(); } catch (e) {
        console.error(`HostRuntime roomGate error: ${String(e)}`);
      }
    }).catch(() => {});
  }

  private deliver(msg: OutboundMessage): void {
    if (msg.kind === 'broadcast') this.broadcastRaw(msg.json);
    else if (msg.playerId != null) this.sendToPlayer(msg.playerId, msg.json);
  }

  private broadcastRaw(json: string): void {
    this.sessions.forEach((client: WsConn, playerId: string) => {
      this.sendToPlayer(playerId, json);
    });
  }

  private sendToPlayer(playerId: string, json: string): void {
    const client: WsConn | undefined = this.sessions.get(playerId);
    if (!client) return;
    client.send(json).catch((e: Error) => {
      // Match Android: a failed send removes only the session that failed.
      if (this.sessions.get(playerId) === client) {
        this.dropSession(playerId, true);
      }
      console.error(`WebSocket send to ${playerId} failed: ${String(e)}`);
    });
  }

  /** Remove socket maps for [playerId]; optionally mark the Room player offline. */
  private dropSession(playerId: string, disconnectRoom: boolean, replaced: boolean = false): void {
    const client: WsConn | undefined = this.sessions.get(playerId);
    const connId: string | undefined = this.playerToConn.get(playerId);
    this.sessions.delete(playerId);
    this.playerToConn.delete(playerId);
    if (connId != null) this.connToPlayer.delete(connId);
    if (client) {
      if (replaced) this.replaceSession(client);
      else { try { client.close(false); } catch (e) {} }
    }
    if (disconnectRoom) this.room.onDisconnect(playerId);
  }

  private syncForDevice(deviceId: string): HttpJsonResponse | null {
    const playerId: string | undefined = this.deviceToPlayer.get(deviceId.trim());
    if (!playerId) return null;
    return { status: 200, json: this.room.syncSnapshot(playerId) };
  }
}

export function isLoopback(host: string): boolean {
  const h: string = host.trim().toLowerCase();
  return h === '127.0.0.1' || h === '::1' || h === 'localhost' ||
    h === '0:0:0:0:0:0:0:1' || h === '::ffff:127.0.0.1';
}

export function resolveClientKey(deviceId: string, remoteHost: string): string {
  // Prefer browser-stable deviceId (same order as Android HostServer). Looking
  // at loopback first caused host reconnects to flip between `local-host` and
  // `d:huddle-host` whenever getRemoteAddress() was empty on one connect and
  // 127.0.0.1 on the next — each flip minted an extra seat.
  const d: string = deviceId.trim();
  if (d.length >= 8) return `d:${d}`;
  if (isLoopback(remoteHost)) return 'local-host';
  const ip: string = normalizeRemoteIp(remoteHost);
  if (ip.length > 0) return `ip:${ip}`;
  return `tmp:${Math.random().toString(36).slice(2)}`;
}

export function normalizeRemoteIp(remoteHost: string): string {
  const h: string = remoteHost.trim().toLowerCase();
  if (h.length === 0) return '';
  if (isLoopback(h)) return '127.0.0.1';
  return h.startsWith('::ffff:') ? h.substring(7) : h;
}

async function copyRawfileDir(rm: resourceManager.ResourceManager, dir: string, dest: string): Promise<void> {
  // HarmonyOS rawfile has no directory listing; we copy a known manifest of
  // files. Keep this list in sync with android www (see copy-www.sh).
  const manifest: string[] = [
    'index.html', 'style.css', 'app.js', 'ws.js',
    'games/gomoku/gomoku.js', 'games/gomoku/gomoku.css',
    'games/undercover/undercover.js', 'games/undercover/undercover.css',
    'games/draw_guess/draw_guess.js', 'games/draw_guess/draw_guess.css',
    'games/werewolf/werewolf.js', 'games/werewolf/werewolf.css',
    'games/doudizhu/doudizhu.js', 'games/doudizhu/doudizhu.css'
  ];
  for (const rel of manifest) {
    try {
      const raw: Uint8Array = await rm.getRawFileContent(`www/${rel}`);
      const target: string = `${dest}/${rel}`;
      const parent: string = target.substring(0, target.lastIndexOf('/'));
      try { await fileIo.mkdir(parent, true); } catch (e) {}
      const file = await fileIo.open(target, fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.CREATE);
      await fileIo.write(file.fd, raw.buffer as ArrayBuffer);
      await fileIo.close(file);
    } catch (e) {
      // Missing file is non-fatal; the HTTP layer will 404.
    }
  }
}
