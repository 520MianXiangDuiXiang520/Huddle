package com.huddle.host.runtime

import org.json.JSONObject

sealed class PluginResult {
    data class Ok(
        val broadcastGame: Boolean = true,
        val finished: Boolean = false,
        val system: String? = null
    ) : PluginResult()

    data class Err(val message: String) : PluginResult()
}

interface GamePlugin {
    val id: String

    /** Called when room enters playing. [players] are seated participants in seat order. */
    fun onStart(players: List<Player>, hostId: String): PluginResult

    fun onAction(playerId: String, payload: JSONObject): PluginResult

    /** Public / common game fields. Prefer [snapshotFor] for delivery. */
    fun snapshot(): JSONObject

    /**
     * Per-recipient view. Default equals [snapshot] (fully public games).
     * Secret-role games override to omit private fields for other players.
     */
    fun snapshotFor(playerId: String): JSONObject = snapshot()

    fun isFinished(): Boolean

    fun reset()
}
