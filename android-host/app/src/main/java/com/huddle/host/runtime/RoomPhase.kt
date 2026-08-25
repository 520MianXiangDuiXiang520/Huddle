package com.huddle.host.runtime

enum class RoomPhase {
    LOBBY,
    PLAYING,
    ENDED;

    fun wire(): String = name.lowercase()

    companion object {
        fun fromWire(value: String): RoomPhase =
            entries.firstOrNull { it.wire() == value.lowercase() } ?: LOBBY
    }
}
