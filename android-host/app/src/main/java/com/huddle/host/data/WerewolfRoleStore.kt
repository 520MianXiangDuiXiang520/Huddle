package com.huddle.host.data

import android.content.Context

/**
 * Persisted werewolf role composition + seat bounds. Villager count is derived
 * at deal time (players.size - sum(other roles)).
 */
object WerewolfRoleStore {
    private const val PREFS = "huddle_werewolf"
    private const val KEY_MIN_PLAYERS = "min_players"
    private const val KEY_MAX_PLAYERS = "max_players"
    private const val KEY_WEREWOLF = "werewolf"
    private const val KEY_SEER = "seer"
    private const val KEY_WITCH = "witch"
    private const val KEY_HUNTER = "hunter"
    private const val KEY_GUARD = "guard"

    const val ABS_MIN_PLAYERS = 6
    const val ABS_MAX_PLAYERS = 12

    /** Stable role ids, in display order. */
    val ROLE_IDS = listOf("werewolf", "seer", "witch", "hunter", "guard", "villager")

    val ROLE_TITLES = mapOf(
        "werewolf" to "狼人",
        "seer" to "预言家",
        "witch" to "女巫",
        "hunter" to "猎人",
        "guard" to "守卫",
        "villager" to "平民"
    )

    val ROLE_BLURB = mapOf(
        "werewolf" to "夜晚与同伴一起选择击杀目标",
        "seer" to "每晚查验一名玩家的阵营",
        "witch" to "拥有一瓶解药和一瓶毒药",
        "hunter" to "出局时可开枪带走一名玩家",
        "guard" to "每晚守护一名玩家免于被刀",
        "villager" to "没有夜晚技能，白天靠发言与投票找出狼人"
    )

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun minPlayers(context: Context): Int {
        val min = prefs(context).getInt(KEY_MIN_PLAYERS, ABS_MIN_PLAYERS)
            .coerceIn(ABS_MIN_PLAYERS, ABS_MAX_PLAYERS)
        val max = prefs(context).getInt(KEY_MAX_PLAYERS, ABS_MAX_PLAYERS)
            .coerceIn(ABS_MIN_PLAYERS, ABS_MAX_PLAYERS)
        return min.coerceAtMost(max)
    }

    fun maxPlayers(context: Context): Int {
        val min = prefs(context).getInt(KEY_MIN_PLAYERS, ABS_MIN_PLAYERS)
            .coerceIn(ABS_MIN_PLAYERS, ABS_MAX_PLAYERS)
        val max = prefs(context).getInt(KEY_MAX_PLAYERS, ABS_MAX_PLAYERS)
            .coerceIn(ABS_MIN_PLAYERS, ABS_MAX_PLAYERS)
        return max.coerceAtLeast(min)
    }

    fun setMinPlayers(context: Context, value: Int) {
        val max = maxPlayers(context)
        prefs(context).edit()
            .putInt(KEY_MIN_PLAYERS, value.coerceIn(ABS_MIN_PLAYERS, max))
            .apply()
    }

    fun setMaxPlayers(context: Context, value: Int) {
        val min = minPlayers(context)
        prefs(context).edit()
            .putInt(KEY_MAX_PLAYERS, value.coerceIn(min, ABS_MAX_PLAYERS))
            .apply()
    }

    fun playersLabel(context: Context): String {
        val min = minPlayers(context)
        val max = maxPlayers(context)
        return if (min == max) "$min 人" else "$min–$max 人"
    }

    fun werewolfCount(context: Context): Int =
        prefs(context).getInt(KEY_WEREWOLF, 2).coerceIn(1, 4)

    fun seerCount(context: Context): Int = prefs(context).getInt(KEY_SEER, 1).coerceIn(0, 2)
    fun witchCount(context: Context): Int = prefs(context).getInt(KEY_WITCH, 1).coerceIn(0, 2)
    fun hunterCount(context: Context): Int = prefs(context).getInt(KEY_HUNTER, 1).coerceIn(0, 2)
    fun guardCount(context: Context): Int = prefs(context).getInt(KEY_GUARD, 0).coerceIn(0, 2)

    fun setWerewolfCount(context: Context, v: Int) {
        prefs(context).edit().putInt(KEY_WEREWOLF, v.coerceIn(1, 4)).apply()
    }

    fun setSeerCount(context: Context, v: Int) {
        prefs(context).edit().putInt(KEY_SEER, v.coerceIn(0, 2)).apply()
    }

    fun setWitchCount(context: Context, v: Int) {
        prefs(context).edit().putInt(KEY_WITCH, v.coerceIn(0, 2)).apply()
    }

    fun setHunterCount(context: Context, v: Int) {
        prefs(context).edit().putInt(KEY_HUNTER, v.coerceIn(0, 2)).apply()
    }

    fun setGuardCount(context: Context, v: Int) {
        prefs(context).edit().putInt(KEY_GUARD, v.coerceIn(0, 2)).apply()
    }

    /** Non-villager role counts, in [ROLE_IDS] order minus villager. */
    fun specialCounts(context: Context): Map<String, Int> = mapOf(
        "werewolf" to werewolfCount(context),
        "seer" to seerCount(context),
        "witch" to witchCount(context),
        "hunter" to hunterCount(context),
        "guard" to guardCount(context)
    )

    /** Sum of configured non-villager roles. */
    fun specialTotal(context: Context): Int = specialCounts(context).values.sum()

    fun villagerFor(context: Context, playerCount: Int): Int =
        (playerCount - specialTotal(context)).coerceAtLeast(0)

    /** True when the configured composition is dealable for [playerCount]. */
    fun validate(context: Context, playerCount: Int): String? {
        val min = minPlayers(context)
        val max = maxPlayers(context)
        if (playerCount < min) return "狼人杀至少需要 $min 人入座"
        if (playerCount > max) return "狼人杀最多 $max 人"
        val special = specialTotal(context)
        if (special > playerCount) {
            return "角色配置共 $special 人，超过本局 $playerCount 人，请减少特殊角色"
        }
        val werewolves = werewolfCount(context)
        if (werewolves * 2 >= playerCount) {
            return "狼人数量过多，至少需要 ${werewolves + 1} 名好人才能开局"
        }
        return null
    }
}
