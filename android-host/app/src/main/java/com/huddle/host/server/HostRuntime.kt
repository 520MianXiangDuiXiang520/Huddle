package com.huddle.host.server

object HostRuntime {
    const val EXTRA_JOIN_URL = "join_url"
    const val EXTRA_LOCAL_URL = "local_url"
    const val EXTRA_GAME_ID = "game_id"

    @Volatile
    var server: HostServer? = null

    @Volatile
    var joinUrl: String? = null

    @Volatile
    var localUrl: String = "http://127.0.0.1:${HostServer.DEFAULT_PORT}/"

    @Volatile
    var isRunning: Boolean = false

    @Volatile
    var selectedGameId: String = "gomoku"
}
