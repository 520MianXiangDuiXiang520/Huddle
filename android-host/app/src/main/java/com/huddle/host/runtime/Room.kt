package com.huddle.host.runtime

import com.huddle.host.runtime.plugins.GomokuPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs

class Room(
    private val bus: EventBus,
    private val pluginFactory: () -> GamePlugin = { GomokuPlugin() },
    private val catalogGameId: String = "gomoku",
    private val minPlayers: Int = 2,
    private val maxPlayers: Int = 2,
    private val maxVisitors: Int = 10,
    private val onDestroy: () -> Unit = {}
) {
    private val players = ConcurrentHashMap<String, Player>()
    private val joinOrder = mutableListOf<String>()

    @Volatile
    private var phase: RoomPhase = RoomPhase.LOBBY

    @Volatile
    private var hostId: String? = null

    @Volatile
    private var plugin: GamePlugin? = null

    @Volatile
    private var gameId: String? = null

    /** Append-only action log for future replay-based plugins. */
    private val actionLog = mutableListOf<JSONObject>()

    private val scope = CoroutineScope(Dispatchers.Default + Job())
    private var sweeperJob: Job? = null

    private val namePool = listOf(
        "玄狐", "青雀", "石子", "晚风", "雾灯", "赤苇", "银杏", "潮声",
        "星屑", "竹马", "白露", "苍岚", "琥珀", "南巷", "北岛", "渡口"
    )

    init {
        startSweeper()
    }

    private fun startSweeper() {
        sweeperJob?.cancel()
        sweeperJob = scope.launch {
            while (isActive) {
                delay(1000)
                sweepHeartbeats()
            }
        }
    }

    fun shutdown() {
        sweeperJob?.cancel()
    }

    private suspend fun sweepHeartbeats() {
        val now = System.currentTimeMillis()
        var changed = false
        for (p in players.values) {
            if (p.connected && now - p.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
                p.connected = false
                p.ready = false
                changed = true
            }
        }
        if (changed) {
            broadcastRoom()
        }
    }

    /**
     * Connect or resume a player keyed by [deviceKey].
     * [isHostClient] must be true only for the Host App WebView (loopback).
     * Room host is pinned to that client and is never transferred to guests.
     * Returns playerId, or null when the visitor cap is reached.
     * Does NOT send welcome/sync — caller must call [greet] after the WS
     * session is registered so the messages actually reach the client.
     */
    suspend fun onConnect(deviceKey: String, isHostClient: Boolean = false): String? {
        val now = System.currentTimeMillis()

        val existing = players.values.firstOrNull { it.deviceKey == deviceKey }
        if (existing != null) {
            existing.connected = true
            existing.lastHeartbeat = now
            if (isHostClient) {
                hostId = existing.id
            }
            broadcastRoom()
            return existing.id
        }

        // New connection. In LOBBY, auto-fill the standby (player) seats in
        // connection order; overflow becomes a spectator (visitor). During
        // PLAYING/ENDED everyone joins as a visitor. The Host App WebView
        // bypasses the visitor cap.
        val autoSeat = if (phase == RoomPhase.LOBBY) firstFreeSeat() else null
        if (autoSeat == null) {
            val connectedVisitors = players.values.count {
                it.connected && it.role == Player.Role.VISITOR
            }
            if (!isHostClient && connectedVisitors >= maxVisitors) {
                return null
            }
        }

        val playerId = UUID.randomUUID().toString()
        if (isHostClient) {
            hostId = playerId
        }
        val player = Player(
            id = playerId,
            deviceKey = deviceKey,
            name = pickName(),
            color = pickColor(),
            role = if (autoSeat != null) Player.Role.PLAYER else Player.Role.VISITOR,
            seat = autoSeat,
            ready = false,
            connected = true,
            lastHeartbeat = now
        )
        players[playerId] = player
        if (!joinOrder.contains(playerId)) {
            joinOrder += playerId
        }

        broadcastRoom()
        return playerId
    }

    /** Send welcome + room/game snapshot to a freshly connected client. */
    suspend fun greet(playerId: String) {
        welcome(playerId)
        sendSync(playerId)
    }

    private suspend fun welcome(playerId: String) {
        bus.emit(
            OutboundMessage.ToPlayer(
                playerId,
                JSONObject()
                    .put("type", "welcome")
                    .put("playerId", playerId)
                    .put("isHost", playerId == hostId)
                    .put("gameId", catalogGameId)
                    .put("minPlayers", minPlayers)
                    .put("maxPlayers", maxPlayers)
                    .put("ts", System.currentTimeMillis())
                    .toString()
            )
        )
    }

    private fun pickName(): String {
        val used = players.values.map { it.name }.toSet()
        val free = namePool.filter { it !in used }
        return (free.ifEmpty { namePool }).random()
    }

    /** Prefer unused palette slots so each active player looks distinct. */
    private fun pickColor(): Int {
        val used = players.values.filter { it.connected }.map { it.color }.toSet()
        return (0 until 8).firstOrNull { it !in used }
            ?: (abs(UUID.randomUUID().hashCode()) % 8)
    }

    suspend fun onDisconnect(playerId: String) {
        val player = players[playerId] ?: return
        player.connected = false
        player.ready = false
        // Keep seat/role/name/color so a refresh can resume seamlessly.
        // Do NOT transfer room host — only the Host App WebView may hold hostId.
        broadcastRoom()
    }

    suspend fun handle(playerId: String, raw: String) {
        val json = try {
            JSONObject(raw)
        } catch (_: Exception) {
            sendError(playerId, "无效的 JSON")
            return
        }
        when (json.optString("type")) {
            "heartbeat" -> handleHeartbeat(playerId)

            // Room-level requests
            "joinRoom" -> handleJoinRoom(playerId)       // re-confirm presence (no-op if already in)
            "leaveRoom" -> handleLeaveRoom(playerId)     // exit room but keep record
            "destroyRoom" -> handleDestroyRoom(playerId) // host only

            // Game-seat requests
            "joinGame" -> handleJoinGame(playerId, json)  // visitor -> player
            "leaveGame" -> handleLeaveGame(playerId)       // player -> visitor
            "ready" -> handleReady(playerId, json)
            "start" -> handleStart(playerId)
            "rematch" -> handleRematch(playerId)
            "action" -> handleAction(playerId, json)

            // Misc
            "sync" -> sendSync(playerId)
            "ping" -> {
                bus.emit(
                    OutboundMessage.ToPlayer(
                        playerId,
                        JSONObject()
                            .put("type", "pong")
                            .put("ts", System.currentTimeMillis())
                            .toString()
                    )
                )
            }
            // legacy / disabled
            "join", "rename", "setAvatar", "claimSeat", "leaveSeat" -> { /* no-op */ }
            else -> sendError(playerId, "未知消息类型")
        }
    }

    private suspend fun handleHeartbeat(playerId: String) {
        val p = players[playerId] ?: return
        p.lastHeartbeat = System.currentTimeMillis()
        if (!p.connected) {
            p.connected = true
            broadcastRoom()
        }
    }

    private suspend fun handleJoinRoom(playerId: String) {
        val p = players[playerId] ?: return
        if (!p.connected) {
            p.connected = true
            p.lastHeartbeat = System.currentTimeMillis()
            broadcastRoom()
        }
    }

    private suspend fun handleLeaveRoom(playerId: String) {
        val p = players[playerId] ?: return
        p.connected = false
        p.ready = false
        broadcastRoom()
    }

    private suspend fun handleDestroyRoom(playerId: String) {
        if (playerId != hostId) {
            sendError(playerId, "只有房主可以销毁房间")
            return
        }
        bus.emit(
            OutboundMessage.Broadcast(
                JSONObject()
                    .put("type", "roomClosed")
                    .put("reason", "host_ended")
                    .put("text", "房主已结束房间")
                    .put("ts", System.currentTimeMillis())
                    .toString()
            )
        )
        onDestroy()
    }

    private suspend fun handleJoinGame(playerId: String, json: JSONObject) {
        if (phase != RoomPhase.LOBBY) {
            sendError(playerId, "对局中无法换座")
            return
        }
        val player = players[playerId] ?: return
        if (!player.connected) return
        if (player.role == Player.Role.PLAYER && player.seat != null) return
        val chosenSeat = firstFreeSeat()
        if (chosenSeat == null) {
            sendError(playerId, "备战席已满")
            return
        }
        player.role = Player.Role.PLAYER
        player.seat = chosenSeat
        player.ready = false
        broadcastRoom()
    }

    private fun firstFreeSeat(): Int? {
        val taken = players.values
            .filter { it.role == Player.Role.PLAYER && it.seat != null }
            .map { it.seat!! }
            .toSet()
        return (0 until maxPlayers).firstOrNull { it !in taken }
    }

    private suspend fun handleLeaveGame(playerId: String) {
        if (phase != RoomPhase.LOBBY) {
            sendError(playerId, "对局中无法离开备战席")
            return
        }
        val player = players[playerId] ?: return
        player.role = Player.Role.VISITOR
        player.seat = null
        player.ready = false
        broadcastRoom()
    }

    private suspend fun handleReady(playerId: String, json: JSONObject) {
        if (phase != RoomPhase.LOBBY) {
            sendError(playerId, "当前无法准备")
            return
        }
        val player = players[playerId] ?: return
        if (!player.connected) return
        if (player.role != Player.Role.PLAYER || player.seat == null) {
            sendError(playerId, "请先入备战席再准备")
            return
        }
        player.ready = json.optBoolean("ready", !player.ready)
        broadcastRoom()
    }

    private suspend fun handleStart(playerId: String) {
        if (playerId != hostId) {
            sendError(playerId, "只有房主可以开始")
            return
        }
        if (phase != RoomPhase.LOBBY) {
            sendError(playerId, "当前无法开始")
            return
        }
        val seated = seatedPlayers()
        if (seated.size < minPlayers) {
            sendError(playerId, "至少需要 ${minPlayers} 人入座")
            return
        }
        if (seated.size > maxPlayers) {
            sendError(playerId, "最多 ${maxPlayers} 人入座")
            return
        }
        if (seated.any { !it.ready || !it.connected }) {
            sendError(playerId, "入座玩家都准备后才能开始")
            return
        }
        val game = pluginFactory()
        when (val result = game.onStart(seated, playerId)) {
            is PluginResult.Err -> sendError(playerId, result.message)
            is PluginResult.Ok -> {
                plugin = game
                gameId = game.id
                phase = RoomPhase.PLAYING
                actionLog.clear()
                players.values.forEach { it.ready = false }
                result.system?.let { broadcastSystem(it) }
                broadcastRoom()
                broadcastGame()
            }
        }
    }

    private suspend fun handleRematch(playerId: String) {
        if (playerId != hostId) {
            sendError(playerId, "只有房主可以再来一局")
            return
        }
        if (phase != RoomPhase.ENDED && phase != RoomPhase.PLAYING) {
            sendError(playerId, "当前无法重置")
            return
        }
        plugin?.reset()
        plugin = null
        gameId = null
        phase = RoomPhase.LOBBY
        actionLog.clear()
        players.values.forEach { it.ready = false }
        broadcastRoom()
        // Tell every client the board is cleared.
        val empty = emptyGameNtf().toString()
        val targets = players.values.filter { it.connected }.map { it.id }.toList()
        for (id in targets) {
            bus.emit(OutboundMessage.ToPlayer(id, empty))
        }
    }

    private suspend fun handleAction(playerId: String, json: JSONObject) {
        val clientActionId = json.optString("clientActionId", "")
        if (phase != RoomPhase.PLAYING) {
            sendActionAck(playerId, clientActionId, false, "当前不在对局中")
            return
        }
        val player = players[playerId]
        val isHost = playerId == hostId
        // Host may act even as visitor (e.g. undercover reveal). Others must be seated.
        if (player == null || (!isHost && (player.role != Player.Role.PLAYER || player.seat == null))) {
            sendActionAck(playerId, clientActionId, false, "访客不能操作")
            return
        }
        val game = plugin ?: run {
            sendActionAck(playerId, clientActionId, false, "游戏未加载")
            return
        }
        val payload = json.optJSONObject("payload") ?: JSONObject()
        when (val result = game.onAction(playerId, payload)) {
            is PluginResult.Err -> {
                sendActionAck(playerId, clientActionId, false, result.message)
            }
            is PluginResult.Ok -> {
                sendActionAck(playerId, clientActionId, true)
                result.system?.let { broadcastSystem(it) }
                actionLog.add(
                    JSONObject()
                        .put("playerId", playerId)
                        .put("payload", payload)
                        .put("ts", System.currentTimeMillis())
                )
                if (result.broadcastGame) {
                    broadcastGame()
                }
                if (result.finished || game.isFinished()) {
                    phase = RoomPhase.ENDED
                    broadcastRoom()
                    broadcastGame()
                }
            }
        }
    }

    private fun seatedPlayers(): List<Player> {
        return (0 until maxPlayers).mapNotNull { seat ->
            players.values.firstOrNull {
                it.connected && it.role == Player.Role.PLAYER && it.seat == seat
            }
        }
    }

    private suspend fun sendSync(playerId: String) {
        bus.emit(OutboundMessage.ToPlayer(playerId, roomJson(playerId).toString()))
        val game = plugin
        if (game != null) {
            bus.emit(OutboundMessage.ToPlayer(playerId, gameNtf(game, playerId).toString()))
        } else {
            bus.emit(
                OutboundMessage.ToPlayer(
                    playerId,
                    emptyGameNtf().toString()
                )
            )
        }
    }

    private fun roomJson(me: String? = null): JSONObject {
        val arr = JSONArray()
        for (id in joinOrder) {
            val p = players[id] ?: continue
            arr.put(
                JSONObject()
                    .put("id", p.id)
                    .put("name", p.name)
                    .put("color", p.color)
                    .put("role", if (p.role == Player.Role.PLAYER) "player" else "visitor")
                    .put("seat", if (p.seat == null) JSONObject.NULL else p.seat)
                    .put("ready", p.ready)
                    .put("connected", p.connected)
                    .put("isHost", p.id == hostId)
                    .put("isMe", me != null && p.id == me)
            )
        }
        return JSONObject()
            .put("type", "ntf_room")
            .put("me", me ?: JSONObject.NULL)
            .put("phase", phase.wire())
            .put("gameId", gameId ?: catalogGameId)
            .put("hostId", hostId)
            .put("minPlayers", minPlayers)
            .put("maxPlayers", maxPlayers)
            .put("players", arr)
            .put("ts", System.currentTimeMillis())
    }

    /** Per-recipient room broadcast: each connected client gets its own ntf_room with `me`. */
    private suspend fun broadcastRoom() {
        val targets = players.values.filter { it.connected }.map { it.id }.toList()
        for (id in targets) {
            bus.emit(OutboundMessage.ToPlayer(id, roomJson(id).toString()))
        }
    }

    private suspend fun broadcastGame() {
        val game = plugin ?: return
        val targets = players.values.filter { it.connected }.map { it.id }.toList()
        for (id in targets) {
            bus.emit(OutboundMessage.ToPlayer(id, gameNtf(game, id).toString()))
        }
    }

    private fun gameNtf(game: GamePlugin, playerId: String): JSONObject {
        val snap = game.snapshotFor(playerId)
        snap.put("type", "ntf_game")
        snap.put("gameId", game.id)
        snap.put("ts", System.currentTimeMillis())
        return snap
    }

    private fun emptyGameNtf(): JSONObject =
        JSONObject()
            .put("type", "ntf_game")
            .put("gameId", catalogGameId)
            .put("empty", true)
            .put("ts", System.currentTimeMillis())

    private suspend fun broadcastSystem(text: String) {
        val msg = JSONObject()
            .put("type", "ntf_system")
            .put("text", text)
            .put("ts", System.currentTimeMillis())
            .toString()
        bus.emit(OutboundMessage.Broadcast(msg))
    }

    private suspend fun sendError(playerId: String, text: String) {
        val msg = JSONObject()
            .put("type", "error")
            .put("text", text)
            .put("ts", System.currentTimeMillis())
            .toString()
        bus.emit(OutboundMessage.ToPlayer(playerId, msg))
    }

    private suspend fun sendActionAck(
        playerId: String,
        clientActionId: String,
        ok: Boolean,
        text: String? = null
    ) {
        val msg = JSONObject()
            .put("type", "actionAck")
            .put("clientActionId", clientActionId)
            .put("ok", ok)
            .put("ts", System.currentTimeMillis())
        if (text != null) msg.put("text", text)
        bus.emit(OutboundMessage.ToPlayer(playerId, msg.toString()))
    }

    companion object {
        const val HEARTBEAT_TIMEOUT_MS: Long = 3000L
    }
}
