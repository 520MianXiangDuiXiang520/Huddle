package com.huddle.host.runtime.plugins

import android.content.Context
import com.huddle.host.data.DrawGuessWordStore
import com.huddle.host.runtime.GamePlugin
import com.huddle.host.runtime.Player
import com.huddle.host.runtime.PluginResult
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Draw & guess MVP: one random drawer, private word, stroke sync, free-text guess.
 * Correct guess or drawer skip ends the round.
 */
class DrawGuessPlugin(
    private val appContext: Context
) : GamePlugin {
    override val id: String = "draw_guess"

    private var started: Boolean = false
    private var finished: Boolean = false
    private var phase: String = "drawing" // drawing | ended
    private var secretWord: String = ""
    private var drawerId: String? = null
    private var winnerId: String? = null
    private var skipped: Boolean = false

    private val names = linkedMapOf<String, String>()
    private val strokes = mutableListOf<JSONObject>()
    private val guesses = mutableListOf<JSONObject>()

    override fun onStart(players: List<Player>, hostId: String): PluginResult {
        reset()
        if (players.size < 3) {
            return PluginResult.Err("你画我猜至少需要 3 人入座")
        }
        if (players.size > 8) {
            return PluginResult.Err("你画我猜最多 8 人")
        }
        val picked = DrawGuessWordStore.pickUnused(appContext)
            ?: return PluginResult.Err("词库没有可用词语，请先在配置里添加或重新加入")

        secretWord = picked.word
        drawerId = players.random().id
        for (p in players) {
            names[p.id] = p.name
        }
        DrawGuessWordStore.markUsed(appContext, picked.id)
        phase = "drawing"
        finished = false
        started = true

        val drawerName = names[drawerId] ?: "玩家"
        return PluginResult.Ok(
            system = "开局 · ${drawerName} 来画 · 其他人猜词"
        )
    }

    override fun onAction(playerId: String, payload: JSONObject): PluginResult {
        if (!started) return PluginResult.Err("对局未开始")
        if (finished || phase == "ended") return PluginResult.Err("本局已结束")
        if (!names.containsKey(playerId)) return PluginResult.Err("只有入座玩家可以操作")

        return when (payload.optString("op", "")) {
            "stroke" -> handleStroke(playerId, payload)
            "clear" -> handleClear(playerId)
            "undo" -> handleUndo(playerId)
            "guess" -> handleGuess(playerId, payload)
            "skip" -> handleSkip(playerId)
            else -> PluginResult.Err("未知操作")
        }
    }

    private fun handleStroke(playerId: String, payload: JSONObject): PluginResult {
        if (playerId != drawerId) return PluginResult.Err("只有画家可以画")
        val pointsIn = payload.optJSONArray("points")
            ?: return PluginResult.Err("笔迹无效")
        if (pointsIn.length() == 0) return PluginResult.Err("笔迹无效")
        if (pointsIn.length() > MAX_POINTS_PER_STROKE) {
            return PluginResult.Err("单段笔迹过长")
        }
        val points = JSONArray()
        for (i in 0 until pointsIn.length()) {
            val p = pointsIn.optJSONObject(i) ?: continue
            val x = p.optDouble("x", Double.NaN)
            val y = p.optDouble("y", Double.NaN)
            if (x.isNaN() || y.isNaN()) continue
            points.put(
                JSONObject()
                    .put("x", x.coerceIn(0.0, 1.0))
                    .put("y", y.coerceIn(0.0, 1.0))
            )
        }
        if (points.length() == 0) return PluginResult.Err("笔迹无效")
        if (strokes.size >= MAX_STROKES) return PluginResult.Err("笔迹过多，请清屏")

        val color = sanitizeColor(payload.optString("color", "#1a1a1a"))
        val width = payload.optDouble("width", 0.012).coerceIn(0.004, 0.06)
        strokes.add(
            JSONObject()
                .put("color", color)
                .put("width", width)
                .put("points", points)
        )
        return PluginResult.Ok()
    }

    private fun handleClear(playerId: String): PluginResult {
        if (playerId != drawerId) return PluginResult.Err("只有画家可以清屏")
        strokes.clear()
        return PluginResult.Ok(system = "画布已清空")
    }

    private fun handleUndo(playerId: String): PluginResult {
        if (playerId != drawerId) return PluginResult.Err("只有画家可以撤销")
        if (strokes.isEmpty()) return PluginResult.Err("没有可撤销的笔迹")
        strokes.removeAt(strokes.lastIndex)
        return PluginResult.Ok()
    }

    private fun handleGuess(playerId: String, payload: JSONObject): PluginResult {
        if (playerId == drawerId) return PluginResult.Err("画家不能猜词")
        val text = payload.optString("text", "").trim()
        if (text.isEmpty()) return PluginResult.Err("请输入猜测")
        if (text.length > MAX_GUESS_LEN) return PluginResult.Err("猜测过长")

        val correct = normalize(text) == normalize(secretWord)
        guesses.add(
            JSONObject()
                .put("playerId", playerId)
                .put("name", names[playerId] ?: "玩家")
                .put("text", text)
                .put("correct", correct)
        )
        if (guesses.size > MAX_GUESSES) {
            guesses.removeAt(0)
        }

        if (!correct) {
            return PluginResult.Ok()
        }

        winnerId = playerId
        skipped = false
        phase = "ended"
        finished = true
        val winnerName = names[playerId] ?: "玩家"
        return PluginResult.Ok(
            finished = true,
            system = "$winnerName 猜对了 · 答案是「$secretWord」"
        )
    }

    private fun handleSkip(playerId: String): PluginResult {
        if (playerId != drawerId) return PluginResult.Err("只有画家可以跳过")
        winnerId = null
        skipped = true
        phase = "ended"
        finished = true
        return PluginResult.Ok(
            finished = true,
            system = "画家跳过 · 答案是「$secretWord」"
        )
    }

    override fun snapshot(): JSONObject = buildSnapshot(viewerId = null)

    override fun snapshotFor(playerId: String): JSONObject = buildSnapshot(viewerId = playerId)

    private fun buildSnapshot(viewerId: String?): JSONObject {
        val strokeArr = JSONArray()
        for (s in strokes) strokeArr.put(s)

        val guessArr = JSONArray()
        for (g in guesses) {
            val copy = JSONObject(g.toString())
            // Hide wrong-guess text? Plan says show wrong guesses plainly.
            guessArr.put(copy)
        }

        val ended = phase == "ended"
        val snap = JSONObject()
            .put("phase", phase)
            .put("drawerId", drawerId ?: JSONObject.NULL)
            .put("drawerName", names[drawerId] ?: "")
            .put("strokes", strokeArr)
            .put("guesses", guessArr)
            .put("finished", finished)
            .put("skipped", skipped)

        if (ended) {
            snap.put("word", secretWord)
            if (winnerId != null) {
                snap.put("winnerId", winnerId)
                snap.put("winnerName", names[winnerId] ?: "")
            } else {
                snap.put("winnerId", JSONObject.NULL)
                snap.put("winnerName", JSONObject.NULL)
            }
        }

        if (!ended && viewerId != null && viewerId == drawerId) {
            snap.put("secretWord", secretWord)
        }

        return snap
    }

    override fun isFinished(): Boolean = finished

    override fun reset() {
        started = false
        finished = false
        phase = "drawing"
        secretWord = ""
        drawerId = null
        winnerId = null
        skipped = false
        names.clear()
        strokes.clear()
        guesses.clear()
    }

    companion object {
        private const val MAX_POINTS_PER_STROKE = 64
        private const val MAX_STROKES = 400
        private const val MAX_GUESS_LEN = 32
        private const val MAX_GUESSES = 80

        private fun normalize(s: String): String =
            s.trim().lowercase(Locale.ROOT).replace("\\s+".toRegex(), "")

        private fun sanitizeColor(raw: String): String {
            val c = raw.trim()
            if (c.matches(Regex("^#[0-9a-fA-F]{6}$"))) return c.lowercase(Locale.ROOT)
            return "#1a1a1a"
        }
    }
}
