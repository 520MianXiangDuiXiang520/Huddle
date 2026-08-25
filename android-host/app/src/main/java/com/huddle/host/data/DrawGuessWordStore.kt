package com.huddle.host.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class DrawGuessWord(
    val id: String,
    val word: String,
    val used: Boolean
)

object DrawGuessWordStore {
    private const val PREFS = "huddle_draw_guess"
    private const val KEY_WORDS = "words"
    private const val KEY_SEEDED = "seeded"

    private val seedWords = listOf(
        "苹果", "香蕉", "西瓜", "葡萄", "草莓",
        "猫咪", "小狗", "兔子", "大象", "企鹅",
        "月亮", "太阳", "彩虹", "雨伞", "雪人",
        "铅笔", "书包", "眼镜", "手表", "钥匙",
        "足球", "篮球", "滑板", "风筝", "积木",
        "火车", "飞机", "自行车", "轮船", "火箭",
        "蛋糕", "披萨", "饺子", "冰淇淋", "汉堡",
        "吉他", "钢琴", "喇叭", "耳机", "相机",
        "城堡", "桥梁", "灯塔", "火山", "沙漠"
    )

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun ensureSeeded(context: Context) {
        val p = prefs(context)
        if (p.getBoolean(KEY_SEEDED, false)) return
        if (p.contains(KEY_WORDS) && !p.getString(KEY_WORDS, null).isNullOrBlank()) {
            p.edit().putBoolean(KEY_SEEDED, true).apply()
            return
        }
        val arr = JSONArray()
        for (word in seedWords) {
            arr.put(wordJson(UUID.randomUUID().toString(), word, used = false))
        }
        p.edit()
            .putString(KEY_WORDS, arr.toString())
            .putBoolean(KEY_SEEDED, true)
            .apply()
    }

    fun list(context: Context): List<DrawGuessWord> {
        ensureSeeded(context)
        val raw = prefs(context).getString(KEY_WORDS, "[]") ?: "[]"
        val arr = try {
            JSONArray(raw)
        } catch (_: Exception) {
            JSONArray()
        }
        val out = ArrayList<DrawGuessWord>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val word = o.optString("word").trim()
            if (word.isEmpty()) continue
            out.add(
                DrawGuessWord(
                    id = o.optString("id").ifBlank { UUID.randomUUID().toString() },
                    word = word,
                    used = o.optBoolean("used", false)
                )
            )
        }
        return out
    }

    fun unusedCount(context: Context): Int = list(context).count { !it.used }

    fun add(context: Context, word: String): DrawGuessWord? {
        val w = word.trim()
        if (w.isEmpty()) return null
        val entry = DrawGuessWord(
            id = UUID.randomUUID().toString(),
            word = w,
            used = false
        )
        val words = list(context).toMutableList()
        words.add(entry)
        save(context, words)
        return entry
    }

    fun remove(context: Context, id: String) {
        save(context, list(context).filter { it.id != id })
    }

    fun setUsed(context: Context, id: String, used: Boolean) {
        val words = list(context).map {
            if (it.id == id) it.copy(used = used) else it
        }
        save(context, words)
    }

    fun reuse(context: Context, id: String) = setUsed(context, id, used = false)

    fun reuseAll(context: Context) {
        save(context, list(context).map { it.copy(used = false) })
    }

    /** Pick a random unused word. Does not mark it used. */
    fun pickUnused(context: Context): DrawGuessWord? {
        val unused = list(context).filter { !it.used }
        if (unused.isEmpty()) return null
        return unused.random()
    }

    fun markUsed(context: Context, id: String) = setUsed(context, id, used = true)

    private fun save(context: Context, words: List<DrawGuessWord>) {
        val arr = JSONArray()
        for (w in words) {
            arr.put(wordJson(w.id, w.word, w.used))
        }
        prefs(context).edit()
            .putString(KEY_WORDS, arr.toString())
            .putBoolean(KEY_SEEDED, true)
            .apply()
    }

    private fun wordJson(id: String, word: String, used: Boolean) =
        JSONObject()
            .put("id", id)
            .put("word", word)
            .put("used", used)
}
