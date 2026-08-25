package com.huddle.host.server

import android.content.Context
import com.huddle.host.data.GameCatalog
import com.huddle.host.runtime.EventBus
import com.huddle.host.runtime.OutboundMessage
import com.huddle.host.runtime.Room
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.defaultForFileExtension
import io.ktor.http.withCharset
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.engine.ApplicationEngine
import io.ktor.server.engine.embeddedServer
import io.ktor.server.request.path
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytes
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.WebSocketSession
import io.ktor.websocket.close
import io.ktor.websocket.readText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap

class HostServer(
    private val wwwRoot: File,
    val port: Int = DEFAULT_PORT
) {
    companion object {
        const val DEFAULT_PORT = 8765

        @Deprecated("Use WwwStore.prepare", ReplaceWith("WwwStore.prepare(context)"))
        fun prepareWwwRoot(context: Context): File = WwwStore.prepare(context)

        /**
         * Prefer browser-stable [deviceId]; fall back to IP only when usable.
         * Never collapse everyone onto a shared "unknown" key.
         */
        fun resolveClientKey(deviceId: String?, remoteHost: String?): String {
            val d = deviceId?.trim().orEmpty()
            if (d.length >= 8) return "d:$d"
            val h = remoteHost?.trim()?.lowercase().orEmpty()
            val ip = when {
                h.isEmpty() -> null
                isLoopbackHost(h) -> "local-host"
                h.startsWith("::ffff:") -> h.removePrefix("::ffff:")
                else -> h
            }
            if (ip != null) return "ip:$ip"
            return "tmp:${java.util.UUID.randomUUID()}"
        }

        /** Host App WebView loads 127.0.0.1; guests join via LAN IP. */
        fun isLoopbackHost(remoteHost: String?): Boolean {
            val h = remoteHost?.trim()?.lowercase().orEmpty()
            return h == "127.0.0.1" || h == "::1" || h == "localhost" ||
                h == "0:0:0:0:0:0:0:1" || h == "::ffff:127.0.0.1"
        }
    }

    private var engine: ApplicationEngine? = null
    private val sessions = ConcurrentHashMap<String, WebSocketSession>()
    private val sessionToPlayer = ConcurrentHashMap<WebSocketSession, String>()
    private val deliverMutex = Mutex()
    private val roomMutex = Mutex()

    private val bus = EventBus { message ->
        when (message) {
            is OutboundMessage.Broadcast -> broadcast(message.json)
            is OutboundMessage.ToPlayer -> sendToPlayer(message.playerId, message.json)
        }
    }

    private val room: Room = run {
        val game = try {
            GameCatalog.requireAvailable(HostRuntime.selectedGameId)
        } catch (_: Throwable) {
            GameCatalog.requireAvailable("gomoku")
        }
        Room(
            bus = bus,
            pluginFactory = game.factory,
            catalogGameId = game.id,
            minPlayers = GameCatalog.resolvedMinPlayers(game),
            maxPlayers = GameCatalog.resolvedMaxPlayers(game),
            onDestroy = { destroyRequested = true }
        )
    }

    @Volatile
    private var destroyRequested: Boolean = false

    private val serverScope = CoroutineScope(Dispatchers.Default + Job())
    private var heartbeatJob: Job? = null

    @Volatile
    var clientCount: Int = 0
        private set

    fun start() {
        if (engine != null) return

        heartbeatJob?.cancel()
        heartbeatJob = serverScope.launch {
            while (isActive) {
                delay(1000)
                val msg = JSONObject()
                    .put("type", "serverHeartbeat")
                    .put("ts", System.currentTimeMillis())
                    .toString()
                broadcast(msg)
            }
        }

        engine = embeddedServer(CIO, host = "0.0.0.0", port = port) {
            install(WebSockets)

            routing {
                get("/") {
                    val index = File(wwwRoot, "index.html")
                    if (!index.exists()) {
                        call.respondText("index.html missing", status = HttpStatusCode.NotFound)
                        return@get
                    }
                    call.response.header(HttpHeaders.CacheControl, "no-store, no-cache, must-revalidate")
                    call.respondBytes(
                        index.readBytes(),
                        ContentType.Text.Html.withCharset(Charsets.UTF_8)
                    )
                }

                get("/health") {
                    call.response.header(HttpHeaders.CacheControl, "no-store")
                    call.respondText(
                        """{"ok":true,"clients":$clientCount}""",
                        ContentType.Application.Json
                    )
                }

                get("/{path...}") {
                    val relative = call.request.path().trimStart('/')
                    if (relative.isBlank() || relative.contains("..")) {
                        call.respond(HttpStatusCode.BadRequest)
                        return@get
                    }
                    val file = File(wwwRoot, relative)
                    if (!file.exists() || !file.isFile || !file.canonicalPath.startsWith(wwwRoot.canonicalPath)) {
                        call.respond(HttpStatusCode.NotFound)
                        return@get
                    }
                    val ext = file.extension.ifBlank { "txt" }
                    call.response.header(HttpHeaders.CacheControl, "no-store, no-cache, must-revalidate")
                    call.respondBytes(file.readBytes(), ContentType.defaultForFileExtension(ext))
                }

                webSocket("/ws") {
                    val session = this
                    val deviceId = call.request.queryParameters["d"]
                    val remoteHost = call.request.local.remoteHost
                    val clientKey = resolveClientKey(deviceId, remoteHost)
                    // Only the Host App WebView (loopback) is the room host — never guests.
                    val isHostClient = isLoopbackHost(remoteHost)
                    val playerId = roomMutex.withLock {
                        room.onConnect(clientKey, isHostClient = isHostClient)
                    } ?: run {
                        // Visitor cap reached.
                        try {
                            session.close(
                                CloseReason(CloseReason.Codes.VIOLATED_POLICY, "visitor cap")
                            )
                        } catch (_: Exception) {
                        }
                        return@webSocket
                    }

                    // Register session BEFORE greeting so welcome/sync reach this socket.
                    val previous = sessions.put(playerId, session)
                    if (previous != null && previous !== session) {
                        sessionToPlayer.remove(previous)
                        try {
                            previous.close(CloseReason(CloseReason.Codes.NORMAL, "replaced"))
                        } catch (_: Exception) {
                        }
                    }
                    sessionToPlayer[session] = playerId
                    clientCount = sessions.size

                    // Now that the session is known, deliver welcome + room/game snapshot.
                    roomMutex.withLock {
                        room.greet(playerId)
                    }

                    try {
                        for (frame in incoming) {
                            if (destroyRequested) break
                            if (frame is Frame.Text) {
                                val text = frame.readText()
                                roomMutex.withLock {
                                    room.handle(playerId, text)
                                }
                            }
                        }
                    } finally {
                        // Ignore stale socket close after a newer session took over.
                        if (sessions[playerId] === session) {
                            sessions.remove(playerId, session)
                            sessionToPlayer.remove(session)
                            clientCount = sessions.size
                            roomMutex.withLock {
                                room.onDisconnect(playerId)
                            }
                        } else {
                            sessionToPlayer.remove(session)
                            clientCount = sessions.size
                        }
                        if (destroyRequested) stop()
                    }
                }
            }
        }.start(wait = false)
    }

    fun stop() {
        heartbeatJob?.cancel()
        heartbeatJob = null
        // Tell every client to leave the live room before the socket dies,
        // so guests stop aggressive reconnect and clear stale game UI.
        runBlocking {
            notifyRoomClosed()
            delay(200)
            for ((_, session) in sessions.toMap()) {
                try {
                    session.close(CloseReason(CloseReason.Codes.GOING_AWAY, "room_closed"))
                } catch (_: Exception) {
                }
            }
        }
        room.shutdown()
        engine?.stop(1_000, 2_000)
        engine = null
        sessions.clear()
        sessionToPlayer.clear()
        clientCount = 0
    }

    private suspend fun notifyRoomClosed() {
        val msg = JSONObject()
            .put("type", "roomClosed")
            .put("reason", "host_ended")
            .put("text", "房主已结束房间")
            .put("ts", System.currentTimeMillis())
            .toString()
        broadcast(msg)
    }

    private suspend fun broadcast(message: String) {
        deliverMutex.withLock {
            val dead = mutableListOf<String>()
            for ((playerId, session) in sessions) {
                try {
                    session.send(Frame.Text(message))
                } catch (_: Exception) {
                    dead += playerId
                }
            }
            for (id in dead) {
                val session = sessions.remove(id)
                if (session != null) sessionToPlayer.remove(session)
            }
            clientCount = sessions.size
        }
    }

    private suspend fun sendToPlayer(playerId: String, message: String) {
        deliverMutex.withLock {
            val session = sessions[playerId] ?: return
            try {
                session.send(Frame.Text(message))
            } catch (_: Exception) {
                sessions.remove(playerId)
                sessionToPlayer.remove(session)
                clientCount = sessions.size
            }
        }
    }
}
