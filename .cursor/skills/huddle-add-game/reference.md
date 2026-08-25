# Huddle 新游戏 — API 与协议参考

## GamePlugin

路径：`android-host/app/src/main/java/com/huddle/host/runtime/GamePlugin.kt`

```kotlin
sealed class PluginResult {
    data class Ok(
        val broadcastGame: Boolean = true,  // 是否立刻广播 snapshot → ntf_game
        val finished: Boolean = false,      // true → Room 进入 ENDED
        val system: String? = null          // → ntf_system
    ) : PluginResult()
    data class Err(val message: String) : PluginResult()  // → actionAck 失败或 start error
}

interface GamePlugin {
    val id: String
    fun onStart(players: List<Player>): PluginResult
    fun onAction(playerId: String, payload: JSONObject): PluginResult
    fun snapshot(): JSONObject
    fun isFinished(): Boolean
    fun reset()
}
```

`Room` 在 `Ok.finished || isFinished()` 时置 `ENDED` 并再广播 room + game。

### Player（入座参与者）

路径：`runtime/Player.kt`

| 字段 | 含义 |
| --- | --- |
| `id` | 玩家 UUID |
| `deviceKey` | `d:<deviceId>` 或 `ip:…` |
| `name` / `color` | 首次进房由服务端分配，刷新保留 |
| `role` | `PLAYER` / `VISITOR` |
| `seat` | `null`（观战席）或 `0..maxPlayers-1`（备战席） |
| `ready` / `connected` / `lastHeartbeat` | 大厅与心跳 |

`onStart` 收到的列表：仅备战席（`PLAYER`）且按 seat 顺序排列的 `Player`。进房时 Room 会按连接顺序自动把玩家放入备战席，超出 `maxPlayers` 的进入观战席（`VISITOR`）。

### RoomPhase

`LOBBY` → `PLAYING` → `ENDED`；线上：`lobby` / `playing` / `ended`。

### GameCatalog

路径：`data/GameCatalog.kt`

```kotlin
data class GameDef(
    val id: String,
    val title: String,
    val subtitle: String,
    val playersLabel: String,
    val minPlayers: Int,
    val maxPlayers: Int,
    val available: Boolean,
    val factory: () -> GamePlugin
)
```

`HostServer`：`Room(bus, game.factory, game.minPlayers, game.maxPlayers, …)`。

---

## WebSocket 协议（游戏相关）

传输：`www/ws.js` → `window.HuddleWS`。处理：`runtime/Room.kt`。

### Client → Host

| type | 典型载荷 | 阶段 | 说明 |
| --- | --- | --- | --- |
| `joinGame` | `{}` | LOBBY | 观战席玩家入备战席（占最小空位；满员时返回 error） |
| `leaveGame` | `{}` | LOBBY | 备战席玩家退到观战席 |
| `ready` | `{ ready?: boolean }` | LOBBY | 需已入座 |
| `start` | `{}` | LOBBY | 仅房主；人数 ∈ [min,max] 且全员 ready+connected |
| `rematch` | `{}` | ENDED/PLAYING | 仅房主；`plugin.reset()`，广播空 `ntf_game` |
| `action` | `{ clientActionId, payload }` | PLAYING | 仅已入座玩家；进 `onAction` |
| `heartbeat` | `{ ts }` | 任意 | 维持 connected |
| `sync` | `{}` | 任意 | 再推 room + game 快照 |
| `joinRoom` / `leaveRoom` / `destroyRoom` | — | 房间级 | 非玩法逻辑 |

### Host → Client

| type | 要点 |
| --- | --- |
| `welcome` | `playerId`, `isHost`, `minPlayers`, `maxPlayers` |
| `ntf_room` | **按人下发**；含 `me`、`players[].isMe`、`phase`、`gameId`、`hostId`、席位与准备 |
| `ntf_game` | 插件 `snapshot()` + `type`/`gameId`/`ts`；空局：`empty: true`, `gameId: null` |
| `ntf_system` | 开局/终局等文案 |
| `actionAck` | `clientActionId`, `ok`, 可选 `text` |
| `error` | `text` |
| `serverHeartbeat` | 客户端 3s 无则显示「链接已关闭」 |

进房 / 重连：`greet` → `welcome` + `ntf_room` + `ntf_game`（追帧）。

---

## 前端模块约定

| 路径 | 职责 |
| --- | --- |
| `www/index.html` | Shell 骨架；按 gameId 引入游戏资源 |
| `www/app.js` | 连接、备战席 / 观战席、准备、开始、通用 toast/胜利层 |
| `www/ws.js` | deviceId、心跳、`HuddleWS` |
| `www/style.css` | Shell 样式 |
| `www/games/<id>/*` | 游戏画布、专属样式、payload 构造与 snapshot 渲染 |

五子棋参考 API（历史形态，新游戏应挂到 `HuddleGames[id]`）：

```js
window.HuddleGomoku = {
  createBoard(root, { onPlay }),  // → { render, setPending, clearPending }
  describe(game, players, myId, spectator)
};
```

Gomoku `snapshot` 字段示例：`board`, `size`, `blackId`/`whiteId`, `blackName`/`whiteName`, `currentStone`, `currentPlayerId`, `winnerId`, `winnerName`, `draw`, `moveCount`, `lastMove`。

---

## 关键源文件

| 用途 | 路径 |
| --- | --- |
| 插件接口 | `.../runtime/GamePlugin.kt` |
| 房间编排 | `.../runtime/Room.kt` |
| 目录 | `.../data/GameCatalog.kt` |
| 开服 | `.../server/HostServer.kt` |
| 选游戏 | `.../ui/HomeFragment.kt`、`HostRuntime.selectedGameId` |
| 参考插件 | `.../runtime/plugins/GomokuPlugin.kt` |
| 参考前端 | `.../assets/www/games/gomoku/` |

---

## 反模式

- 在 Android Activity/Fragment 里画棋盘或判胜负
- 为房主单独做一套游戏页
- 在大厅硬编码「五子棋需要两人」类文案（应用 `minPlayers`）
- 客户端本地当权威，断线后不吃 `ntf_game` 快照
- 游戏 JS 拉外网字体/脚本 CDN
- `rematch` 后不广播空 `ntf_game`（会导致只清房主棋盘）
