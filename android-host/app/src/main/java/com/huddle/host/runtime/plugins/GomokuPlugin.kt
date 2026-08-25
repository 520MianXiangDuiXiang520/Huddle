package com.huddle.host.runtime.plugins

import com.huddle.host.runtime.GamePlugin
import com.huddle.host.runtime.Player
import com.huddle.host.runtime.PluginResult
import org.json.JSONArray
import org.json.JSONObject

/**
 * Authoritative 15x15 Gomoku. Board cells: 0 empty, 1 black, 2 white.
 */
class GomokuPlugin : GamePlugin {
    override val id: String = "gomoku"

    private val size = 15
    private var board: Array<IntArray> = Array(size) { IntArray(size) }
    private var blackId: String? = null
    private var whiteId: String? = null
    private var blackName: String = "黑方"
    private var whiteName: String = "白方"
    private var currentStone: Int = 1
    private var winnerId: String? = null
    private var winnerName: String? = null
    private var draw: Boolean = false
    private var moveCount: Int = 0
    private var started: Boolean = false
    private var lastMove: IntArray? = null

    override fun onStart(players: List<Player>, hostId: String): PluginResult {
        if (players.size < 2) {
            return PluginResult.Err("五子棋需要 2 名玩家")
        }
        reset()
        blackId = players[0].id
        whiteId = players[1].id
        blackName = players[0].name
        whiteName = players[1].name
        started = true
        return PluginResult.Ok(
            system = "开局 · $blackName 执黑 vs $whiteName 执白 · 黑先"
        )
    }

    override fun onAction(playerId: String, payload: JSONObject): PluginResult {
        if (!started) return PluginResult.Err("对局未开始")
        if (winnerId != null || draw) return PluginResult.Err("对局已结束")

        val expected = if (currentStone == 1) blackId else whiteId
        if (playerId != expected) {
            return PluginResult.Err("还没轮到你")
        }

        if (!payload.has("x") || !payload.has("y")) {
            return PluginResult.Err("缺少坐标")
        }
        val x = payload.getInt("x")
        val y = payload.getInt("y")
        if (x !in 0 until size || y !in 0 until size) {
            return PluginResult.Err("坐标越界")
        }
        if (board[y][x] != 0) {
            return PluginResult.Err("此处已有棋子")
        }

        board[y][x] = currentStone
        lastMove = intArrayOf(x, y)
        moveCount++

        val moverName = if (currentStone == 1) blackName else whiteName
        if (checkWin(x, y, currentStone)) {
            winnerId = playerId
            winnerName = moverName
            return PluginResult.Ok(
                finished = true,
                system = "🏆 $moverName 五子连珠，胜出！"
            )
        }
        if (moveCount >= size * size) {
            draw = true
            return PluginResult.Ok(
                finished = true,
                system = "满盘和棋 · $blackName 与 $whiteName 战平"
            )
        }

        currentStone = if (currentStone == 1) 2 else 1
        return PluginResult.Ok()
    }

    override fun snapshot(): JSONObject {
        val rows = JSONArray()
        for (y in 0 until size) {
            val row = JSONArray()
            for (x in 0 until size) {
                row.put(board[y][x])
            }
            rows.put(row)
        }
        return JSONObject()
            .put("board", rows)
            .put("size", size)
            .put("blackId", blackId)
            .put("whiteId", whiteId)
            .put("blackName", blackName)
            .put("whiteName", whiteName)
            .put("currentStone", currentStone)
            .put("currentPlayerId", if (currentStone == 1) blackId else whiteId)
            .put("winnerId", winnerId)
            .put("winnerName", winnerName)
            .put("draw", draw)
            .put("moveCount", moveCount)
            .put("lastMove", lastMove?.let { JSONArray().put(it[0]).put(it[1]) } ?: JSONObject.NULL)
    }

    override fun isFinished(): Boolean = winnerId != null || draw

    override fun reset() {
        board = Array(size) { IntArray(size) }
        blackId = null
        whiteId = null
        blackName = "黑方"
        whiteName = "白方"
        currentStone = 1
        winnerId = null
        winnerName = null
        draw = false
        moveCount = 0
        started = false
        lastMove = null
    }

    private fun checkWin(x: Int, y: Int, stone: Int): Boolean {
        val dirs = arrayOf(
            intArrayOf(1, 0),
            intArrayOf(0, 1),
            intArrayOf(1, 1),
            intArrayOf(1, -1)
        )
        for (d in dirs) {
            val count = 1 +
                countDir(x, y, d[0], d[1], stone) +
                countDir(x, y, -d[0], -d[1], stone)
            if (count >= 5) return true
        }
        return false
    }

    private fun countDir(x: Int, y: Int, dx: Int, dy: Int, stone: Int): Int {
        var cx = x + dx
        var cy = y + dy
        var n = 0
        while (cx in 0 until size && cy in 0 until size && board[cy][cx] == stone) {
            n++
            cx += dx
            cy += dy
        }
        return n
    }
}
