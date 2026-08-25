package com.huddle.host.runtime.plugins

import com.huddle.host.runtime.GamePlugin
import com.huddle.host.runtime.Player
import com.huddle.host.runtime.PluginResult
import org.json.JSONArray
import org.json.JSONObject

/**
 * 斗地主 MVP：3 人，54 张牌，叫分定地主，地主对抗两个农民。
 * 权威牌型校验在 Host；客户端只渲染与提交操作。
 */
class DoudizhuPlugin : GamePlugin {
    override val id: String = "doudizhu"

    private var hostId: String? = null
    private var started: Boolean = false
    private var finished: Boolean = false
    // bid | play | ended
    private var phase: String = "bid"

    private val seats = linkedMapOf<String, Int>()
    private val names = linkedMapOf<String, String>()
    private val hands = linkedMapOf<String, MutableList<Int>>()
    private var bottomCards: MutableList<Int> = mutableListOf()
    private var landlordId: String? = null
    private var bidValue: Int = 0
    private val bids = linkedMapOf<String, Int>()
    private var bidIndex: Int = 0
    private val seatOrder = mutableListOf<String>()

    private var lastPlay: JSONObject? = null
    private var lastPlayerId: String? = null
    private var currentTurnId: String? = null
    private var consecutivePasses: Int = 0

    private var winnerId: String? = null
    private var winnerSide: String? = null // landlord | peasant

    companion object {
        // card 0..51 = 13 ranks x 4 suits; rank = card/4 (0=3,1=4,...,11=A,12=2); 52=小王, 53=大王
        fun rankOf(card: Int): Int = when (card) {
            52 -> 13
            53 -> 14
            else -> card / 4
        }

        fun cardLabel(card: Int): String {
            if (card == 52) return "小王"
            if (card == 53) return "大王"
            val r = card / 4
            val rankStr = listOf("3","4","5","6","7","8","9","10","J","Q","K","A","2")[r]
            val suit = listOf("♠","♥","♦","♣")[card % 4]
            return suit + rankStr
        }
    }

    override fun onStart(players: List<Player>, hostId: String): PluginResult {
        if (players.size != 3) return PluginResult.Err("斗地主需要 3 人入座")
        reset()
        this.hostId = hostId
        for ((i, p) in players.withIndex()) {
            seats[p.id] = p.seat ?: i
            names[p.id] = p.name
            hands[p.id] = mutableListOf()
            seatOrder.add(p.id)
        }
        dealNewHand()
        started = true
        return PluginResult.Ok(system = "发牌完成 · 请按顺序叫分（1/2/3 或不叫）")
    }

    private fun dealNewHand() {
        val deck = (0..53).toMutableList()
        deck.shuffle()
        for (pid in seatOrder) hands[pid] = mutableListOf()
        for (i in deck.indices) {
            if (i < 51) {
                hands[seatOrder[i % 3]]!!.add(deck[i])
            } else {
                bottomCards.add(deck[i])
            }
        }
        for (pid in seatOrder) hands[pid]!!.sortWith(compareBy({ rankOf(it) }, { it }))
        bottomCards.sortWith(compareBy({ rankOf(it) }, { it }))
        phase = "bid"
        bids.clear()
        bidValue = 0
        landlordId = null
        lastPlay = null
        lastPlayerId = null
        consecutivePasses = 0
        bidIndex = 0
        currentTurnId = seatOrder[0]
    }

    override fun onAction(playerId: String, payload: JSONObject): PluginResult {
        if (!started) return PluginResult.Err("对局未开始")
        if (finished) return PluginResult.Err("本局已结束")
        if (!seats.containsKey(playerId)) return PluginResult.Err("只有入座玩家可以操作")
        return when (payload.optString("op", "")) {
            "bid" -> handleBid(playerId, payload)
            "play" -> handlePlay(playerId, payload)
            "pass" -> handlePass(playerId)
            else -> PluginResult.Err("未知操作")
        }
    }

    private fun handleBid(playerId: String, payload: JSONObject): PluginResult {
        if (phase != "bid") return PluginResult.Err("当前不是叫分阶段")
        if (playerId != currentTurnId) return PluginResult.Err("还没轮到你叫分")
        val v = payload.optInt("value", 0)
        if (v !in 0..3) return PluginResult.Err("叫分无效")
        if (v != 0 && v <= bidValue) return PluginResult.Err("必须高于当前最高分")
        bids[playerId] = v
        if (v == 3) {
            // 直接定地主
            return finishBid(playerId, v)
        }
        bidIndex += 1
        if (bidIndex >= seatOrder.size) {
            // 三人都叫过
            val winner = bids.entries.filter { it.value > 0 }.maxByOrNull { it.value }
            return if (winner == null) {
                dealNewHand()
                PluginResult.Ok(system = "无人叫地主 · 重新发牌")
            } else {
                finishBid(winner.key, winner.value)
            }
        }
        currentTurnId = seatOrder[bidIndex]
        return PluginResult.Ok()
    }

    private fun finishBid(winnerId: String, value: Int): PluginResult {
        landlordId = winnerId
        bidValue = value
        // 底牌给地主
        for (c in bottomCards) hands[winnerId]!!.add(c)
        hands[winnerId]!!.sortWith(compareBy({ rankOf(it) }, { it }))
        phase = "play"
        currentTurnId = winnerId
        consecutivePasses = 0
        lastPlay = null
        val name = names[winnerId] ?: "玩家"
        return PluginResult.Ok(system = "$name 叫地主 · $value 分 · 底牌已亮明，地主先出牌")
    }

    private fun handlePlay(playerId: String, payload: JSONObject): PluginResult {
        if (phase != "play") return PluginResult.Err("当前不是出牌阶段")
        if (playerId != currentTurnId) return PluginResult.Err("还没轮到你出牌")
        val cardsArr = payload.optJSONArray("cards")
        if (cardsArr == null || cardsArr.length() == 0) return PluginResult.Err("请选择要出的牌")
        val cards = mutableListOf<Int>()
        for (i in 0 until cardsArr.length()) {
            val c = cardsArr.optInt(i, -1)
            if (c !in 0..53) return PluginResult.Err("牌面无效")
            cards.add(c)
        }
        val hand = hands[playerId]!!
        for (c in cards) {
            if (!hand.contains(c)) return PluginResult.Err("你没有这些牌")
        }
        val combo = parseCombo(cards) ?: return PluginResult.Err("牌型不合法")
        // 首出或两人过后自由出牌
        val free = lastPlay == null
        if (!free) {
            val last = lastPlay!!
            if (!beats(combo, last)) return PluginResult.Err("压不过上家")
        }
        // 扣牌
        for (c in cards) hand.removeAt(hand.indexOf(c))
        lastPlay = comboToJson(playerId, cards, combo)
        lastPlayerId = playerId
        consecutivePasses = 0
        if (hand.isEmpty()) {
            winnerId = playerId
            winnerSide = if (playerId == landlordId) "landlord" else "peasant"
            phase = "ended"
            finished = true
            val name = names[playerId] ?: "玩家"
            val side = if (playerId == landlordId) "地主" else "农民"
            return PluginResult.Ok(finished = true, system = "$side $name 出完牌 · ${winnerSide}胜利")
        }
        currentTurnId = nextSeat(playerId)
        return PluginResult.Ok()
    }

    private fun handlePass(playerId: String): PluginResult {
        if (phase != "play") return PluginResult.Err("当前不是出牌阶段")
        if (playerId != currentTurnId) return PluginResult.Err("还没轮到你")
        if (lastPlay == null) return PluginResult.Err("首出不能不要")
        if (playerId == lastPlayerId) return PluginResult.Err("轮到你出牌")
        consecutivePasses += 1
        if (consecutivePasses >= 2) {
            // 两人都过，回到上家自由出牌
            currentTurnId = lastPlayerId
            lastPlay = null
            consecutivePasses = 0
        } else {
            currentTurnId = nextSeat(playerId)
        }
        return PluginResult.Ok()
    }

    private fun nextSeat(pid: String): String {
        val idx = seatOrder.indexOf(pid)
        return seatOrder[(idx + 1) % seatOrder.size]
    }

    private data class Combo(val type: String, val mainRank: Int, val length: Int)

    private fun parseCombo(cards: List<Int>): Combo? {
        val n = cards.size
        if (n == 0) return null
        val ranks = cards.map { rankOf(it) }.sorted()
        val counts = linkedMapOf<Int, Int>()
        for (r in ranks) counts[r] = (counts[r] ?: 0) + 1
        val groups = counts.values.sortedDescending()
        val minRank = ranks.first()
        val maxRank = ranks.last()

        // 火箭
        if (n == 2 && 52 in cards && 53 in cards) return Combo("rocket", 14, 2)
        // 炸弹
        if (n == 4 && groups == listOf(4)) return Combo("bomb", minRank, 4)
        // 单张
        if (n == 1) return Combo("single", minRank, 1)
        // 对子
        if (n == 2 && groups == listOf(2)) return Combo("pair", minRank, 2)
        // 三张
        if (n == 3 && groups == listOf(3)) return Combo("triple", minRank, 3)
        // 三带一
        if (n == 4 && groups == listOf(3, 1)) {
            val main = counts.entries.first { it.value == 3 }.key
            return Combo("triple_single", main, 4)
        }
        // 三带二
        if (n == 5 && groups == listOf(3, 2)) {
            val main = counts.entries.first { it.value == 3 }.key
            return Combo("triple_pair", main, 5)
        }
        // 顺子（5+ 单张，连续，不含 2/王）
        if (n >= 5 && groups.all { it == 1 } && isConsecutive(ranks) && maxRank <= 11) {
            return Combo("straight", minRank, n)
        }
        // 连对（3+ 对，连续，不含 2/王）
        if (n >= 6 && n % 2 == 0 && groups.all { it == 2 }) {
            val pr = counts.keys.sorted()
            if (isConsecutive(pr) && pr.last() <= 11) return Combo("pair_straight", pr.first(), n)
        }
        // 飞机不带（2+ 连续三张，不含 2/王）
        if (n >= 6 && n % 3 == 0 && groups.all { it == 3 }) {
            val tr = counts.keys.sorted()
            if (isConsecutive(tr) && tr.last() <= 11) return Combo("plane", tr.first(), n)
        }
        // 飞机带单：k 个连续三张 + k 个单张，n = 4k
        if (n >= 8 && n % 4 == 0) {
            val triples = counts.entries.filter { it.value == 3 }.map { it.key }.sorted()
            val singles = counts.entries.filter { it.value == 1 }.count()
            val k = n / 4
            if (triples.size == k && singles == k && isConsecutive(triples) && triples.last() <= 11) {
                return Combo("plane_single", triples.first(), n)
            }
        }
        // 飞机带对：k 个连续三张 + k 个对子，n = 5k
        if (n >= 10 && n % 5 == 0) {
            val triples = counts.entries.filter { it.value == 3 }.map { it.key }.sorted()
            val pairs = counts.entries.filter { it.value == 2 }.count()
            val k = n / 5
            if (triples.size == k && pairs == k && isConsecutive(triples) && triples.last() <= 11) {
                return Combo("plane_pair", triples.first(), n)
            }
        }
        // 四带二单
        if (n == 6 && groups == listOf(4, 1, 1)) {
            val main = counts.entries.first { it.value == 4 }.key
            return Combo("four_two_single", main, 6)
        }
        // 四带二对
        if (n == 8 && groups == listOf(4, 2, 2)) {
            val main = counts.entries.first { it.value == 4 }.key
            return Combo("four_two_pair", main, 8)
        }
        return null
    }

    private fun isConsecutive(ranks: List<Int>): Boolean {
        for (i in 1 until ranks.size) {
            if (ranks[i] != ranks[i - 1] + 1) return false
        }
        return true
    }

    private fun beats(cur: Combo, last: JSONObject): Boolean {
        val lastType = last.optString("type")
        val lastRank = last.optInt("mainRank")
        val lastLen = last.optInt("length")
        // 火箭最大
        if (cur.type == "rocket") return true
        if (lastType == "rocket") return false
        // 炸弹压一切非炸弹
        if (cur.type == "bomb" && lastType != "bomb") return true
        if (cur.type == "bomb" && lastType == "bomb") return cur.mainRank > lastRank
        if (lastType == "bomb") return false
        // 同型同长比主 rank
        if (cur.type == lastType && cur.length == lastLen) return cur.mainRank > lastRank
        return false
    }

    private fun comboToJson(playerId: String, cards: List<Int>, combo: Combo): JSONObject {
        val arr = JSONArray()
        for (c in cards.sortedBy { rankOf(it) }) arr.put(c)
        return JSONObject()
            .put("playerId", playerId)
            .put("cards", arr)
            .put("type", combo.type)
            .put("mainRank", combo.mainRank)
            .put("length", combo.length)
    }

    override fun snapshot(): JSONObject = buildSnapshot(viewerId = null)

    override fun snapshotFor(playerId: String): JSONObject = buildSnapshot(viewerId = playerId)

    private fun buildSnapshot(viewerId: String?): JSONObject {
        val arr = JSONArray()
        for (pid in seatOrder) {
            arr.put(
                JSONObject()
                    .put("id", pid)
                    .put("name", names[pid] ?: "玩家")
                    .put("seat", seats[pid] ?: 0)
                    .put("cardCount", hands[pid]?.size ?: 0)
                    .put("isLandlord", pid == landlordId)
            )
        }
        val snap = JSONObject()
            .put("phase", phase)
            .put("players", arr)
            .put("landlordId", landlordId ?: JSONObject.NULL)
            .put("bidValue", bidValue)
            .put("currentTurnId", currentTurnId ?: JSONObject.NULL)
            .put("lastPlay", lastPlay ?: JSONObject.NULL)
            .put("winnerId", winnerId ?: JSONObject.NULL)
            .put("winnerSide", winnerSide ?: JSONObject.NULL)
            .put("finished", finished)
        // 底牌：叫分阶段对所有人隐藏（房主可见以便亮明），出牌后公开
        if (phase == "play" || phase == "ended") {
            val bArr = JSONArray()
            for (c in bottomCards) bArr.put(c)
            snap.put("bottomCards", bArr)
        }
        // 叫分记录公开
        val bObj = JSONObject()
        for ((pid, v) in bids) bObj.put(pid, v)
        snap.put("bids", bObj)
        // 私有手牌
        if (viewerId != null && hands.containsKey(viewerId)) {
            val hArr = JSONArray()
            for (c in hands[viewerId]!!) hArr.put(c)
            snap.put("myHand", hArr)
        }
        return snap
    }

    override fun isFinished(): Boolean = finished

    override fun reset() {
        hostId = null
        started = false
        finished = false
        phase = "bid"
        seats.clear()
        names.clear()
        hands.clear()
        bottomCards.clear()
        landlordId = null
        bidValue = 0
        bids.clear()
        bidIndex = 0
        seatOrder.clear()
        lastPlay = null
        lastPlayerId = null
        currentTurnId = null
        consecutivePasses = 0
        winnerId = null
        winnerSide = null
    }
}
