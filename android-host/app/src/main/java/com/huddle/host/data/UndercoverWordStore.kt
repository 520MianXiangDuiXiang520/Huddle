package com.huddle.host.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class UndercoverWordPair(
    val id: String,
    val civilian: String,
    val undercover: String,
    val used: Boolean
)

object UndercoverWordStore {
    private const val PREFS = "huddle_undercover"
    private const val KEY_PAIRS = "word_pairs"
    private const val KEY_COUNT = "undercover_count"
    private const val KEY_MIN_PLAYERS = "min_players"
    private const val KEY_MAX_PLAYERS = "max_players"
    private const val KEY_SEEDED = "seeded"

    const val ABS_MIN_PLAYERS = 3
    const val ABS_MAX_PLAYERS = 12

    private val seedPairs = listOf(
        "咖啡" to "奶茶",
        "月亮" to "太阳",
        "公交" to "地铁",
        "西瓜" to "哈密瓜",
        "铅笔" to "钢笔",
        "电梯" to "扶梯",
        "篮球" to "足球",
        "饺子" to "包子"
    )

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun ensureSeeded(context: Context) {
        val p = prefs(context)
        if (p.getBoolean(KEY_SEEDED, false)) return
        if (p.contains(KEY_PAIRS) && !p.getString(KEY_PAIRS, null).isNullOrBlank()) {
            p.edit().putBoolean(KEY_SEEDED, true).apply()
            return
        }
        val arr = JSONArray()
        for ((civilian, undercover) in seedPairs) {
            arr.put(pairJson(UUID.randomUUID().toString(), civilian, undercover, used = false))
        }
        p.edit()
            .putString(KEY_PAIRS, arr.toString())
            .putBoolean(KEY_SEEDED, true)
            .apply()
    }

    fun list(context: Context): List<UndercoverWordPair> {
        ensureSeeded(context)
        val raw = prefs(context).getString(KEY_PAIRS, "[]") ?: "[]"
        val arr = try {
            JSONArray(raw)
        } catch (_: Exception) {
            JSONArray()
        }
        val out = ArrayList<UndercoverWordPair>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val civilian = o.optString("civilian").trim()
            val undercover = o.optString("undercover").trim()
            if (civilian.isEmpty() || undercover.isEmpty()) continue
            out.add(
                UndercoverWordPair(
                    id = o.optString("id").ifBlank { UUID.randomUUID().toString() },
                    civilian = civilian,
                    undercover = undercover,
                    used = o.optBoolean("used", false)
                )
            )
        }
        return out
    }

    fun unusedCount(context: Context): Int = list(context).count { !it.used }

    fun undercoverCount(context: Context): Int {
        ensureSeeded(context)
        return prefs(context).getInt(KEY_COUNT, 1).coerceIn(1, 3)
    }

    fun setUndercoverCount(context: Context, count: Int) {
        prefs(context).edit().putInt(KEY_COUNT, count.coerceIn(1, 3)).apply()
    }

    fun minPlayers(context: Context): Int {
        ensureSeeded(context)
        val min = prefs(context).getInt(KEY_MIN_PLAYERS, ABS_MIN_PLAYERS)
            .coerceIn(ABS_MIN_PLAYERS, ABS_MAX_PLAYERS)
        val max = prefs(context).getInt(KEY_MAX_PLAYERS, 8)
            .coerceIn(ABS_MIN_PLAYERS, ABS_MAX_PLAYERS)
        return min.coerceAtMost(max)
    }

    fun maxPlayers(context: Context): Int {
        ensureSeeded(context)
        val min = prefs(context).getInt(KEY_MIN_PLAYERS, ABS_MIN_PLAYERS)
            .coerceIn(ABS_MIN_PLAYERS, ABS_MAX_PLAYERS)
        val max = prefs(context).getInt(KEY_MAX_PLAYERS, 8)
            .coerceIn(ABS_MIN_PLAYERS, ABS_MAX_PLAYERS)
        return max.coerceAtLeast(min)
    }

    fun setMinPlayers(context: Context, value: Int) {
        val max = maxPlayers(context)
        val min = value.coerceIn(ABS_MIN_PLAYERS, max)
        prefs(context).edit().putInt(KEY_MIN_PLAYERS, min).apply()
    }

    fun setMaxPlayers(context: Context, value: Int) {
        val min = minPlayers(context)
        val max = value.coerceIn(min, ABS_MAX_PLAYERS)
        prefs(context).edit().putInt(KEY_MAX_PLAYERS, max).apply()
    }

    fun playersLabel(context: Context): String {
        val min = minPlayers(context)
        val max = maxPlayers(context)
        return if (min == max) "$min 人" else "$min–$max 人"
    }

    fun add(context: Context, civilian: String, undercover: String): UndercoverWordPair? {
        val c = civilian.trim()
        val u = undercover.trim()
        if (c.isEmpty() || u.isEmpty()) return null
        if (c == u) return null
        val pair = UndercoverWordPair(
            id = UUID.randomUUID().toString(),
            civilian = c,
            undercover = u,
            used = false
        )
        val pairs = list(context).toMutableList()
        pairs.add(pair)
        save(context, pairs)
        return pair
    }

    fun remove(context: Context, id: String) {
        val pairs = list(context).filter { it.id != id }
        save(context, pairs)
    }

    fun setUsed(context: Context, id: String, used: Boolean) {
        val pairs = list(context).map {
            if (it.id == id) it.copy(used = used) else it
        }
        save(context, pairs)
    }

    fun reuse(context: Context, id: String) = setUsed(context, id, used = false)

    fun reuseAll(context: Context) {
        val pairs = list(context).map { it.copy(used = false) }
        save(context, pairs)
    }

    /** Pick a random unused pair. Does not mark it used. */
    fun pickUnused(context: Context): UndercoverWordPair? {
        val unused = list(context).filter { !it.used }
        if (unused.isEmpty()) return null
        return unused.random()
    }

    fun markUsed(context: Context, id: String) = setUsed(context, id, used = true)

    private fun save(context: Context, pairs: List<UndercoverWordPair>) {
        val arr = JSONArray()
        for (p in pairs) {
            arr.put(pairJson(p.id, p.civilian, p.undercover, p.used))
        }
        prefs(context).edit()
            .putString(KEY_PAIRS, arr.toString())
            .putBoolean(KEY_SEEDED, true)
            .apply()
    }

    private fun pairJson(id: String, civilian: String, undercover: String, used: Boolean) =
        JSONObject()
            .put("id", id)
            .put("civilian", civilian)
            .put("undercover", undercover)
            .put("used", used)
}
