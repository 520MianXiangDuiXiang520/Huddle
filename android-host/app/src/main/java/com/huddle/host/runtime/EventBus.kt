package com.huddle.host.runtime

/**
 * Thin outbound bus: Room pushes wire JSON strings; HostServer delivers them.
 */
fun interface EventBus {
    suspend fun emit(message: OutboundMessage)
}

sealed class OutboundMessage {
    data class Broadcast(val json: String) : OutboundMessage()
    data class ToPlayer(val playerId: String, val json: String) : OutboundMessage()
}
