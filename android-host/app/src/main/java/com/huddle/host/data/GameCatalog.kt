package com.huddle.host.data

import com.huddle.host.HuddleHostApp
import com.huddle.host.runtime.GamePlugin
import com.huddle.host.runtime.plugins.DoudizhuPlugin
import com.huddle.host.runtime.plugins.DrawGuessPlugin
import com.huddle.host.runtime.plugins.GomokuPlugin
import com.huddle.host.runtime.plugins.UndercoverPlugin
import com.huddle.host.runtime.plugins.WerewolfPlugin

data class GameDef(
    val id: String,
    val title: String,
    val subtitle: String,
    val playersLabel: String,
    val minPlayers: Int,
    val maxPlayers: Int,
    val available: Boolean,
    val hasConfig: Boolean = false,
    val factory: () -> GamePlugin
)

object GameCatalog {
    /** Available games first; coming-soon entries stay at the bottom. */
    val all: List<GameDef> = listOf(
        GameDef(
            id = "gomoku",
            title = "五子棋",
            subtitle = "经典双人对弈，适合快速开一局",
            playersLabel = "2 人",
            minPlayers = 2,
            maxPlayers = 2,
            available = true,
            factory = { GomokuPlugin() }
        ),
        GameDef(
            id = "undercover",
            title = "谁是卧底",
            subtitle = "自定义词库，发牌找卧底",
            playersLabel = "3–8 人",
            minPlayers = 3,
            maxPlayers = 8,
            available = true,
            hasConfig = true,
            factory = {
                UndercoverPlugin(HuddleHostApp.instance)
            }
        ),
        GameDef(
            id = "draw_guess",
            title = "你画我猜",
            subtitle = "一人作画，大家猜词",
            playersLabel = "3–8 人",
            minPlayers = 3,
            maxPlayers = 8,
            available = true,
            hasConfig = true,
            factory = {
                DrawGuessPlugin(HuddleHostApp.instance)
            }
        ),
        GameDef(
            id = "werewolf",
            title = "狼人杀",
            subtitle = "自定义角色配置，夜晚与白天交替",
            playersLabel = "6–12 人",
            minPlayers = 6,
            maxPlayers = 12,
            available = true,
            hasConfig = true,
            factory = {
                WerewolfPlugin(HuddleHostApp.instance)
            }
        ),
        GameDef(
            id = "doudizhu",
            title = "斗地主",
            subtitle = "三人对战，叫分定地主，地主对抗两农民",
            playersLabel = "3 人",
            minPlayers = 3,
            maxPlayers = 3,
            available = true,
            factory = { DoudizhuPlugin() }
        )
    )

    fun find(id: String): GameDef? = all.find { it.id == id }

    fun requireAvailable(id: String): GameDef {
        val g = find(id) ?: error("unknown game: $id")
        require(g.available) { "game not available: $id" }
        return g
    }

    /** Effective seat bounds (undercover/werewolf read host prefs). */
    fun resolvedMinPlayers(game: GameDef): Int =
        when (game.id) {
            "undercover" -> UndercoverWordStore.minPlayers(HuddleHostApp.instance)
            "werewolf" -> WerewolfRoleStore.minPlayers(HuddleHostApp.instance)
            else -> game.minPlayers
        }

    fun resolvedMaxPlayers(game: GameDef): Int =
        when (game.id) {
            "undercover" -> UndercoverWordStore.maxPlayers(HuddleHostApp.instance)
            "werewolf" -> WerewolfRoleStore.maxPlayers(HuddleHostApp.instance)
            else -> game.maxPlayers
        }

    fun resolvedPlayersLabel(game: GameDef): String =
        when (game.id) {
            "undercover" -> UndercoverWordStore.playersLabel(HuddleHostApp.instance)
            "werewolf" -> WerewolfRoleStore.playersLabel(HuddleHostApp.instance)
            else -> game.playersLabel
        }
}
