---
name: huddle-add-game
description: Guides adding a new Huddle LAN game via Kotlin GamePlugin, GameCatalog registration, www/games/<game-id>/ web UI, and shared WS room protocol. Use when adding a new game, implementing GamePlugin, registering GameDef, wiring game frontend, or asking how to extend the game framework.
---

# Huddle：添加新游戏

在改代码前先读本 skill 与 [reference.md](reference.md)。权威状态永远在 Host Runtime；客户端只渲染与发操作。

## 边界（必须遵守）

- Host 原生层：选游戏、本地服务、邀请、设置、WebView。**不要**做游戏画面、输入或规则。
- 房主 WebView 与客人浏览器加载**同一套**网页 UI。
- 网页资源：`android-host/app/src/main/assets/www/`；随 APK 内置发布；**禁止**运行时依赖外网 CDN。
- 新游戏三件套：`GamePlugin` + `GameCatalog` + `www/games/<game-id>/`。
- 共享大厅（`app.js` / Shell）**不要**硬编码某一游戏的人数、棋盘或术语；用 `minPlayers` / `maxPlayers` 与 `ntf_room`。
- UI 分层：Shell = 连接/座位/准备/开始；游戏专属 DOM/CSS/JS 只放 `games/<id>/`。
- 视觉与交互规范另读 `huddle-ui-design` skill。

## 工作流

```
Task Progress:
- [ ] 1. 定 game-id、min/max 人数、payload 形状
- [ ] 2. 实现 Kotlin GamePlugin
- [ ] 3. 注册 GameCatalog
- [ ] 4. 写 www/games/<id>/ 前端并挂到 Shell（按 gameId，勿写死 gomoku）
- [ ] 5. 联调：进房自动入备战席 → 准备 → 开始 → action → 终局 → 再来一局 → 断线重连追帧
- [ ] 6. 按 huddle-release 打 APK
```

### 1. 定契约

| 项 | 说明 |
| --- | --- |
| `id` | 稳定字符串，如 `gomoku`；与目录名一致 |
| `minPlayers` / `maxPlayers` | 写入 `GameDef`；开局校验 |
| `action.payload` | 客户端与 `onAction` 约定（如 `{x,y}`） |
| `snapshot()` 字段 | 足以完整重绘与断线恢复；勿依赖客户端本地权威状态 |

### 2. Kotlin 插件

路径：`android-host/app/src/main/java/com/huddle/host/runtime/plugins/<Name>Plugin.kt`

实现 `GamePlugin`（见 [reference.md](reference.md)#gameplugin）：

1. `onStart(players)`：`players` 已按 seat `0..n-1` 排序；校验人数；初始化；可返回 `system` 开局文案。
2. `onAction(playerId, payload)`：校验回合/合法性；更新权威状态；终局时 `PluginResult.Ok(finished = true, system = "…")`。
3. `snapshot()`：纯数据 JSON（Room 会加 `type=ntf_game`、`gameId`、`ts`）。
4. `isFinished()` / `reset()`：与 Room `ENDED` / `rematch` 配合。

参考：`runtime/plugins/GomokuPlugin.kt`。

**不要**在插件里发 WebSocket；只返回 `PluginResult`，由 `Room` 广播。

### 3. 注册目录

编辑 `android-host/app/src/main/java/com/huddle/host/data/GameCatalog.kt`：

```kotlin
GameDef(
    id = "<game-id>",
    title = "…",
    subtitle = "…",
    playersLabel = "…",
    minPlayers = N,
    maxPlayers = M,
    available = true,
    factory = { YourPlugin() }
)
```

`available = false` 仅用于首页「即将推出」占位。

Host 开房：`HostServer` → `GameCatalog.requireAvailable(selectedGameId)` → `Room(factory, min, max)`。

### 4. 网页游戏模块

目录：`android-host/app/src/main/assets/www/games/<game-id>/`

建议暴露：

```js
window.HuddleGames = window.HuddleGames || {};
window.HuddleGames["<game-id>"] = {
  mount(root, { onAction, myId }),  // 或 createBoard 等价物
  render(gameSnapshot, ctx),
  describe(game, players, myId, spectator), // 可选，供 banner
};
```

Shell（`app.js` / `index.html`）按当前房间 `gameId` **动态加载**对应脚本与样式。  
**禁止**继续把新游戏硬编码成 `HuddleGomoku` only；若现状仍写死 gomoku，加新游戏时一并解耦。

客户端发操作：

```js
HuddleWS.send({
  type: "action",
  clientActionId: "…",
  payload: { /* 与插件约定 */ },
});
```

处理：`ntf_game` 全量渲染；`actionAck` 失败则回滚乐观 UI；进房/重连用服务端推的快照追帧。

### 5. 房间侧公用能力（不要重做）

这些由 `Room` + Shell 提供，游戏插件**只关心 PLAYING 内规则**：

- 身份：`deviceKey`（deviceId / IP），访客 / 玩家，`joinGame` / `leaveGame`
- 准备 / 房主 `start` / `rematch`
- `ntf_room`（含 `me` / `isMe`）、心跳与离线
- 访客上限、销毁房间（原生返回确认）

### 6. 发布

| 改动范围 | 发布 |
| --- | --- |
| 仅 `www/**` | APK：抬高 `versionCode` / `versionName`（APK 升级时 `WwwStore` 自动刷新磁盘 www） |
| 含 `*.kt` / Catalog / Gradle | APK：抬高 `versionCode` / `versionName` |

Huddle 不再使用 OTA 热更新，所有改动都打 APK。细则见项目 rule `huddle-release.mdc`。

## 验收清单

- [ ] 首页可选中且能开房
- [ ] 全员进房自动入备战席（超出人数进观战席）；备战席玩家可准备 / 观战，观战席玩家可入席；准备后房主可 `start`
- [ ] 人数不足 / 未准备时 `start` 有明确 `error`
- [ ] 落子/操作经 Host 校验；非法有 `actionAck` 或 `error`
- [ ] 终局有 `ntf_game` + 合适 `ntf_system`；房主 `rematch` 后**所有人**棋盘/状态清空
- [ ] 刷新网页：名字/颜色/角色可恢复；对局中能追帧
- [ ] 无外网 CDN；大厅无游戏专属硬编码

## 交付说明

完成任务时向用户说明：

1. 新增的 `game-id` 与人数配置  
2. 改动的 Kotlin / www 文件  
3. `action.payload` 与 `snapshot` 字段契约  
4. 本次 APK 版本号

## References

- 协议与 API 细节：[reference.md](reference.md)
- UI：skill `huddle-ui-design`
- 产品边界：`.cursor/rules/huddle-product-boundaries.mdc`
- 参考实现：`GomokuPlugin.kt` + `www/games/gomoku/`
