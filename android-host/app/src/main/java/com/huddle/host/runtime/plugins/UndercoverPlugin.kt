package com.huddle.host.runtime.plugins

import android.content.Context
import com.huddle.host.data.UndercoverWordStore
import com.huddle.host.runtime.GamePlugin
import com.huddle.host.runtime.Player
import com.huddle.host.runtime.PluginResult
import org.json.JSONArray
import org.json.JSONObject

/**
 * Who-is-the-undercover MVP: deal private words, host reveals.
 * Word pairs persist in [UndercoverWordStore]; used pairs are marked after deal.
 */
class UndercoverPlugin(
    private val appContext: Context
) : GamePlugin {
    override val id: String = "undercover"

    private var hostId: String? = null
    private var undercoverCount: Int = 1
    private var pairId: String? = null
    private var civilianWord: String = ""
    private var undercoverWord: String = ""
    private var phase: String = "secret" // secret | revealed
    private var finished: Boolean = false
    private var started: Boolean = false

    /** playerId -> role ("civilian" | "undercover") */
    private val roles = linkedMapOf<String, String>()
    private val names = linkedMapOf<String, String>()
    private val seats = linkedMapOf<String, Int>()

    override fun onStart(players: List<Player>, hostId: String): PluginResult {
        reset()
        val minNeed = UndercoverWordStore.minPlayers(appContext)
        if (players.size < minNeed) {
            return PluginResult.Err("谁是卧底至少需要 ${minNeed} 人入座")
        }
        val count = UndercoverWordStore.undercoverCount(appContext)
        if (count < 1 || count >= players.size) {
            return PluginResult.Err("卧底人数须在 1 到 ${players.size - 1} 之间，请先在配置里调整")
        }
        val pair = UndercoverWordStore.pickUnused(appContext)
            ?: return PluginResult.Err("词库没有可用词组，请先在配置里添加或重新加入")

        this.hostId = hostId
        undercoverCount = count
        pairId = pair.id
        civilianWord = pair.civilian
        undercoverWord = pair.undercover

        val shuffled = players.shuffled()
        val undercoverIds = shuffled.take(count).map { it.id }.toSet()
        for (p in players) {
            roles[p.id] = if (p.id in undercoverIds) "undercover" else "civilian"
            names[p.id] = p.name
            seats[p.id] = p.seat ?: 0
        }

        UndercoverWordStore.markUsed(appContext, pair.id)
        phase = "secret"
        finished = false
        started = true

        return PluginResult.Ok(
            system = "词语已发放 · ${players.size} 人 · 卧底 $count 人 · 线下讨论后由房主揭晓"
        )
    }

    override fun onAction(playerId: String, payload: JSONObject): PluginResult {
        if (!started) return PluginResult.Err("对局未开始")
        if (finished || phase == "revealed") return PluginResult.Err("已经揭晓")
        val op = payload.optString("op", "")
        if (op != "reveal") {
            return PluginResult.Err("未知操作")
        }
        if (playerId != hostId) {
            return PluginResult.Err("只有房主可以揭晓")
        }
        phase = "revealed"
        finished = true
        return PluginResult.Ok(
            finished = true,
            system = "身份已揭晓"
        )
    }

    override fun snapshot(): JSONObject = buildSnapshot(viewerId = null)

    override fun snapshotFor(playerId: String): JSONObject = buildSnapshot(viewerId = playerId)

    private fun buildSnapshot(viewerId: String?): JSONObject {
        val revealed = phase == "revealed"
        val arr = JSONArray()
        for ((pid, role) in roles) {
            val o = JSONObject()
                .put("id", pid)
                .put("name", names[pid] ?: "玩家")
                .put("seat", seats[pid] ?: 0)
            if (revealed) {
                o.put("role", role)
                o.put("word", if (role == "undercover") undercoverWord else civilianWord)
            }
            arr.put(o)
        }

        val snap = JSONObject()
            .put("phase", phase)
            .put("undercoverCount", undercoverCount)
            .put("players", arr)
            .put("finished", finished)

        if (viewerId != null && roles.containsKey(viewerId)) {
            val myRole = roles[viewerId]!!
            val myWord = if (myRole == "undercover") undercoverWord else civilianWord
            snap.put("myWord", myWord)
            // Identity only after reveal; during secret only the word is shown.
            if (revealed) {
                snap.put("myRole", myRole)
            }
        }

        if (revealed) {
            snap.put("civilianWord", civilianWord)
            snap.put("undercoverWord", undercoverWord)
        }

        return snap
    }

    override fun isFinished(): Boolean = finished

    override fun reset() {
        hostId = null
        undercoverCount = 1
        pairId = null
        civilianWord = ""
        undercoverWord = ""
        phase = "secret"
        finished = false
        started = false
        roles.clear()
        names.clear()
        seats.clear()
    }
}
