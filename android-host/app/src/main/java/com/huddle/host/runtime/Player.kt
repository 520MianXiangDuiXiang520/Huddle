package com.huddle.host.runtime

data class Player(
    val id: String,
    /** Stable identity key: "d:<deviceId>" or "ip:<ip>" or "tmp:<uuid>". */
    val deviceKey: String,
    var name: String,
    /** Palette index 0..7. */
    var color: Int = 0,
    var role: Role = Role.VISITOR,
    /** null = visitor; 0..maxPlayers-1 = seated player. */
    var seat: Int? = null,
    var ready: Boolean = false,
    var connected: Boolean = true,
    var lastHeartbeat: Long = System.currentTimeMillis()
) {
    enum class Role { PLAYER, VISITOR }

    val isPlayer: Boolean get() = role == Role.PLAYER
    val isVisitor: Boolean get() = role == Role.VISITOR
}
