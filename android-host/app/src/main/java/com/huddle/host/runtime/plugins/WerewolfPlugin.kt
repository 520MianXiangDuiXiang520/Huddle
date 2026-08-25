package com.huddle.host.runtime.plugins

import android.content.Context
import com.huddle.host.data.WerewolfRoleStore
import com.huddle.host.runtime.GamePlugin
import com.huddle.host.runtime.Player
import com.huddle.host.runtime.PluginResult
import org.json.JSONArray
import org.json.JSONObject

class WerewolfPlugin(private val appContext: Context) : GamePlugin {
    override val id: String = "werewolf"

    private var hostId: String? = null
    private var started: Boolean = false
    private var finished: Boolean = false
    // night | day_announce | day_vote | hunter_shot | ended
    private var phase: String = "night"
    private var round: Int = 0

    private val roles = linkedMapOf<String, String>()
    private val names = linkedMapOf<String, String>()
    private val seats = linkedMapOf<String, Int>()
    private val alive = mutableMapOf<String, Boolean>()
    private val deathReason = linkedMapOf<String, String>()

    // Night actions for current round
    private var wolfTarget: String? = null
    private val wolfVotes = linkedMapOf<String, String>() // werewolfId -> target
    private var seerTarget: String? = null
    private var seerChecks = mutableListOf<JSONObject>() // {target, name, result}
    private var witchHealUsed: Boolean = false
    private var witchPoisonUsed: Boolean = false
    private var witchHealTonight: Boolean = false
    private var witchPoisonTarget: String? = null
    private var witchActed: Boolean = false
    private var guardTarget: String? = null
    private var guardLastTarget: String? = null
    private var guardActed: Boolean = false

    // Day vote
    private val votes = linkedMapOf<String, String>() // voterId -> targetId

    // Hunter
    private var pendingHunterId: String? = null
    private var pendingHunterFromVote: Boolean = false
    private var deathsThisRound = mutableListOf<String>()

    private var winner: String? = null // "werewolf" | "villager"

    override fun onStart(players: List<Player>, hostId: String): PluginResult {
        val err = WerewolfRoleStore.validate(appContext, players.size)
        if (err != null) return PluginResult.Err(err)
        reset()
        this.hostId = hostId
        val specials = WerewolfRoleStore.specialCounts(appContext).toMutableMap()
        val villagerCount = players.size - specials.values.sum()
        val pool = ArrayList<String>()
        specials.forEach { (role, n) -> repeat(n) { pool.add(role) } }
        repeat(villagerCount) { pool.add("villager") }
        pool.shuffle()
        for ((i, p) in players.withIndex()) {
            val role = pool[i]
            roles[p.id] = role
            names[p.id] = p.name
            seats[p.id] = p.seat ?: i
            alive[p.id] = true
        }
        round = 1
        phase = "night"
        started = true
        finished = false
        val wc = specials["werewolf"] ?: 1
        return PluginResult.Ok(
            system = "天黑请闭眼 · 第 1 夜 · ${players.size} 人 · 狼人 $wc 名 · 各角色夜间操作后由房主「天亮」"
        )
    }

    override fun onAction(playerId: String, payload: JSONObject): PluginResult {
        if (!started) return PluginResult.Err("对局未开始")
        if (finished) return PluginResult.Err("本局已结束")
        if (!roles.containsKey(playerId) && playerId != hostId) {
            return PluginResult.Err("只有入座玩家可以操作")
        }
        return when (payload.optString("op", "")) {
            "night_action" -> handleNightAction(playerId, payload)
            "vote" -> handleVote(playerId, payload)
            "skip_vote" -> handleSkipVote(playerId)
            "dawn" -> handleDawn(playerId)
            "start_vote" -> handleStartVote(playerId)
            "resolve_vote" -> handleResolveVote(playerId)
            "shoot" -> handleShoot(playerId, payload)
            "skip_shot" -> handleSkipShot(playerId)
            else -> PluginResult.Err("未知操作")
        }
    }

    private fun isHost(playerId: String) = playerId == hostId

    private fun roleOf(playerId: String): String? = roles[playerId]

    private fun isAlive(playerId: String): Boolean = alive[playerId] == true

    private fun aliveWerewolves(): List<String> =
        roles.keys.filter { roles[it] == "werewolf" && isAlive(it) }

    private fun aliveGood(): List<String> =
        roles.keys.filter { roles[it] != "werewolf" && isAlive(it) }

    private fun checkWin(): String? {
        val wolves = aliveWerewolves().size
        val good = aliveGood().size
        return when {
            wolves == 0 -> "villager"
            wolves >= good -> "werewolf"
            else -> null
        }
    }

    private fun endGame(winnerSide: String): PluginResult {
        winner = winnerSide
        phase = "ended"
        finished = true
        val text = if (winnerSide == "werewolf") "狼人胜利 · 好人被屠" else "好人胜利 · 狼人出局"
        return PluginResult.Ok(finished = true, system = text)
    }

    private fun handleNightAction(playerId: String, payload: JSONObject): PluginResult {
        if (phase != "night") return PluginResult.Err("当前不是夜晚")
        if (!isAlive(playerId)) return PluginResult.Err("你已出局")
        val role = roleOf(playerId) ?: return PluginResult.Err("无角色")
        val target = payload.optString("target", "").ifBlank { null }
        return when (role) {
            "werewolf" -> {
                if (target != null && (!alive.containsKey(target) || !isAlive(target))) {
                    return PluginResult.Err("目标无效")
                }
                if (target != null && roles[target] == "werewolf") {
                    return PluginResult.Err("狼人不能刀同伴")
                }
                wolfVotes[playerId] = target ?: ""
                wolfTarget = target
                PluginResult.Ok()
            }
            "seer" -> {
                if (seerTarget != null) return PluginResult.Err("本夜已查验")
                if (target == null || !isAlive(target)) return PluginResult.Err("目标无效")
                if (target == playerId) return PluginResult.Err("不能查验自己")
                seerTarget = target
                val result = if (roles[target] == "werewolf") "evil" else "good"
                seerChecks.add(
                    JSONObject()
                        .put("target", target)
                        .put("name", names[target] ?: "玩家")
                        .put("result", result)
                )
                PluginResult.Ok()
            }
            "guard" -> {
                if (guardActed) return PluginResult.Err("本夜已守护")
                if (target == null || !isAlive(target)) return PluginResult.Err("目标无效")
                if (target == guardLastTarget) return PluginResult.Err("不能连续两晚守同一人")
                guardTarget = target
                guardActed = true
                PluginResult.Ok()
            }
            "witch" -> {
                if (witchActed) return PluginResult.Err("本夜已操作")
                val choice = payload.optString("choice", "")
                when (choice) {
                    "heal" -> {
                        if (witchHealUsed) return PluginResult.Err("解药已用过")
                        if (wolfTarget == null) return PluginResult.Err("今晚无人被刀")
                        witchHealTonight = true
                        witchHealUsed = true
                        witchActed = true
                    }
                    "poison" -> {
                        if (witchPoisonUsed) return PluginResult.Err("毒药已用过")
                        val pTarget = payload.optString("poisonTarget", "").ifBlank { null }
                        if (pTarget == null || !isAlive(pTarget)) return PluginResult.Err("毒杀目标无效")
                        if (pTarget == playerId) return PluginResult.Err("不能毒自己")
                        witchPoisonTarget = pTarget
                        witchPoisonUsed = true
                        witchActed = true
                    }
                    "pass" -> {
                        witchActed = true
                    }
                    else -> return PluginResult.Err("未知的女巫操作")
                }
                PluginResult.Ok()
            }
            else -> PluginResult.Err("你的角色夜晚无需操作")
        }
    }

    private fun handleDawn(playerId: String): PluginResult {
        if (!isHost(playerId)) return PluginResult.Err("只有房主可以天亮")
        if (phase != "night") return PluginResult.Err("当前不是夜晚")
        resolveNight()
        val w = checkWin()
        if (w != null) return endGame(w)
        if (pendingHunterId != null) {
            pendingHunterFromVote = false
            phase = "hunter_shot"
            val hName = names[pendingHunterId] ?: "猎人"
            return PluginResult.Ok(system = "天亮了 · $hName 是猎人，请选择是否开枪")
        }
        phase = "day_announce"
        val dn = deathsThisRound.joinToString("、") { this.names[it] ?: "玩家" }
        val text = if (deathsThisRound.isEmpty()) "天亮了 · 昨夜平安" else "天亮了 · 昨夜 $dn 出局"
        return PluginResult.Ok(system = text)
    }

    private fun resolveNight() {
        deathsThisRound.clear()
        val victim = wolfTarget
        if (victim != null) {
            val guarded = guardTarget == victim
            val healed = witchHealTonight
            // Classic rule: guard + heal on same target cancel out.
            val protectedFromWolves = guarded xor healed
            if (!protectedFromWolves) kill(victim, "wolves")
        }
        val poison = witchPoisonTarget
        if (poison != null && witchPoisonUsed) {
            kill(poison, "poison")
        }
        guardLastTarget = guardTarget
        resetNightActions()
    }

    private fun kill(playerId: String, reason: String) {
        if (!isAlive(playerId)) return
        alive[playerId] = false
        deathReason[playerId] = reason
        deathsThisRound.add(playerId)
        if (roles[playerId] == "hunter" && phase != "ended") {
            pendingHunterId = playerId
        }
    }

    private fun resetNightActions() {
        wolfTarget = null
        wolfVotes.clear()
        seerTarget = null
        witchHealTonight = false
        witchPoisonTarget = null
        witchActed = false
        guardTarget = null
        guardActed = false
    }

    private fun handleStartVote(playerId: String): PluginResult {
        if (!isHost(playerId)) return PluginResult.Err("只有房主可以发起投票")
        if (phase != "day_announce") return PluginResult.Err("当前不能发起投票")
        votes.clear()
        phase = "day_vote"
        return PluginResult.Ok(system = "进入白天投票 · 请选择放逐对象")
    }

    private fun handleVote(playerId: String, payload: JSONObject): PluginResult {
        if (phase != "day_vote") return PluginResult.Err("当前不是投票阶段")
        if (!isAlive(playerId)) return PluginResult.Err("你已出局")
        val target = payload.optString("target", "").ifBlank { null }
        if (target == null || !isAlive(target)) return PluginResult.Err("投票目标无效")
        if (target == playerId) return PluginResult.Err("不能投自己")
        votes[playerId] = target
        return PluginResult.Ok()
    }

    private fun handleSkipVote(playerId: String): PluginResult {
        if (phase != "day_vote") return PluginResult.Err("当前不是投票阶段")
        if (!isAlive(playerId)) return PluginResult.Err("你已出局")
        votes.remove(playerId)
        return PluginResult.Ok()
    }

    private fun handleResolveVote(playerId: String): PluginResult {
        if (!isHost(playerId)) return PluginResult.Err("只有房主可以结算投票")
        if (phase != "day_vote") return PluginResult.Err("当前不是投票阶段")
        val tally = mutableMapOf<String, Int>()
        votes.values.forEach { tally[it] = (tally[it] ?: 0) + 1 }
        val maxV = tally.values.maxOrNull() ?: 0
        val top = if (maxV > 0) tally.filter { it.value == maxV }.keys.toList() else emptyList()
        deathsThisRound.clear()
        if (top.size == 1) kill(top.first(), "vote")
        if (pendingHunterId != null) pendingHunterFromVote = true
        val w = checkWin()
        if (w != null) return endGame(w)
        if (pendingHunterId != null) {
            phase = "hunter_shot"
            val hName = names[pendingHunterId] ?: "猎人"
            return PluginResult.Ok(system = "$hName 被放逐，请选择是否开枪")
        }
        return nextNight()
    }

    private fun nextNight(): PluginResult {
        round += 1
        phase = "night"
        deathsThisRound.clear()
        return PluginResult.Ok(system = "天黑请闭眼 · 第 $round 夜")
    }

    private fun handleShoot(playerId: String, payload: JSONObject): PluginResult {
        if (phase != "hunter_shot") return PluginResult.Err("当前不是开枪阶段")
        if (playerId != pendingHunterId) return PluginResult.Err("只有该猎人可以开枪")
        val target = payload.optString("target", "").ifBlank { null }
        if (target == null || !isAlive(target)) return PluginResult.Err("开枪目标无效")
        val fromVote = pendingHunterFromVote
        kill(target, "hunter")
        pendingHunterId = null
        pendingHunterFromVote = false
        val w = checkWin()
        if (w != null) return endGame(w)
        return if (fromVote) nextNight() else {
            phase = "day_announce"
            val dn = deathsThisRound.joinToString("、") { this.names[it] ?: "玩家" }
            PluginResult.Ok(system = "猎人开枪 · $dn 出局")
        }
    }

    private fun handleSkipShot(playerId: String): PluginResult {
        if (phase != "hunter_shot") return PluginResult.Err("当前不是开枪阶段")
        if (playerId != pendingHunterId) return PluginResult.Err("只有该猎人可以操作")
        val fromVote = pendingHunterFromVote
        pendingHunterId = null
        pendingHunterFromVote = false
        val w = checkWin()
        if (w != null) return endGame(w)
        return if (fromVote) nextNight() else {
            phase = "day_announce"
            val dn = deathsThisRound.joinToString("、") { this.names[it] ?: "玩家" }
            PluginResult.Ok(
                system = if (dn.isEmpty()) "猎人未开枪 · 继续白天" else "猎人未开枪 · $dn 出局"
            )
        }
    }

    override fun snapshot(): JSONObject = buildSnapshot(viewerId = null)

    override fun snapshotFor(playerId: String): JSONObject = buildSnapshot(viewerId = playerId)

    private fun buildSnapshot(viewerId: String?): JSONObject {
        val arr = JSONArray()
        for ((pid, role) in roles) {
            arr.put(
                JSONObject()
                    .put("id", pid)
                    .put("name", names[pid] ?: "玩家")
                    .put("seat", seats[pid] ?: 0)
                    .put("alive", isAlive(pid))
                    .put("role", if (phase == "ended") role else JSONObject.NULL)
                    .put("deathReason", deathReason[pid] ?: JSONObject.NULL)
            )
        }

        val snap = JSONObject()
            .put("phase", phase)
            .put("round", round)
            .put("players", arr)
            .put("deathsThisRound", JSONArray(deathsThisRound))
            .put("winner", winner ?: JSONObject.NULL)
            .put("pendingHunterId", pendingHunterId ?: JSONObject.NULL)
            .put("finished", finished)

        val voteArr = JSONObject()
        for ((voter, target) in votes) voteArr.put(voter, target)
        snap.put("votes", voteArr)
        snap.put("nightReady", nightReadyJson())

        if (viewerId != null && roles.containsKey(viewerId)) {
            val role = roles[viewerId]!!
            snap.put("myRole", role)
            snap.put("myAlive", isAlive(viewerId))
            when (role) {
                "werewolf" -> {
                    val fellows = JSONArray()
                    roles.forEach { (pid, r) ->
                        if (r == "werewolf" && pid != viewerId) fellows.put(pid)
                    }
                    snap.put("fellowWerewolves", fellows)
                    snap.put("wolfTarget", wolfTarget ?: JSONObject.NULL)
                    snap.put("wolfActed", wolfVotes.containsKey(viewerId))
                }
                "seer" -> {
                    snap.put("seerChecks", JSONArray(seerChecks))
                    snap.put("seerActed", seerTarget != null)
                }
                "witch" -> {
                    snap.put("healUsed", witchHealUsed)
                    snap.put("poisonUsed", witchPoisonUsed)
                    snap.put("witchActed", witchActed)
                    snap.put("wolfVictimId", wolfTarget ?: JSONObject.NULL)
                }
                "guard" -> {
                    snap.put("guardActed", guardActed)
                    snap.put("guardLastTarget", guardLastTarget ?: JSONObject.NULL)
                }
            }
            if (phase == "day_vote") {
                snap.put("myVote", votes[viewerId] ?: JSONObject.NULL)
            }
        }
        return snap
    }

    private fun nightReadyJson(): JSONObject {
        val wolves = aliveWerewolves()
        val wolvesActed = wolves.isNotEmpty() && wolves.all { wolfVotes.containsKey(it) }
        val seerAlive = roles.any { it.value == "seer" && isAlive(it.key) }
        val seerActed = !seerAlive || seerTarget != null
        val witchAlive = roles.any { it.value == "witch" && isAlive(it.key) }
        val witchActedAll = !witchAlive || witchActed
        val guardAlive = roles.any { it.value == "guard" && isAlive(it.key) }
        val guardActedAll = !guardAlive || guardActed
        return JSONObject()
            .put("werewolf", wolvesActed)
            .put("seer", seerActed)
            .put("witch", witchActedAll)
            .put("guard", guardActedAll)
    }

    override fun isFinished(): Boolean = finished

    override fun reset() {
        hostId = null
        started = false
        finished = false
        phase = "night"
        round = 0
        roles.clear()
        names.clear()
        seats.clear()
        alive.clear()
        deathReason.clear()
        resetNightActions()
        votes.clear()
        pendingHunterId = null
        pendingHunterFromVote = false
        deathsThisRound.clear()
        seerChecks.clear()
        witchHealUsed = false
        witchPoisonUsed = false
        guardLastTarget = null
        winner = null
    }
}
