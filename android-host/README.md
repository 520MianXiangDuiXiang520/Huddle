# Huddle Android Host

完整 Host App：**首页选游戏 / 更多（设置与关于）**，开房后房间内是局域网网页客户端。

房主在本机启动 HTTP + WebSocket 服务，App 内嵌 WebView 与客人系统浏览器共用同一套网页前端；所有权威游戏状态保存在房主手机，不依赖互联网。

## 功能

- **首页**：5 款游戏全部可用，点选后「开始房间」
  - 五子棋（2 人）
  - 谁是卧底（3–8 人）
  - 你画我猜（3–8 人）
  - 狼人杀（6–12 人）
  - 斗地主（3 人）
  - 可配置游戏带独立配置页：卧底（词库、卧底人数、人数范围）、你画我猜（词库）、狼人杀（角色配置）
- **房间**：二维码 / 可复制链接邀请；按连接顺序自动入备战席，溢出进观战席；准备就绪后由房主开局；对局状态经 WebSocket 权威同步，断线刷新可恢复席位与身份
- **更多**：主题（跟随系统 / 浅色 / 深色）、存储占用与清理、意见反馈（邮件）、隐私政策、支持开发者、更新日志

## 架构

| 模块 | 说明 |
|------|------|
| `server/` | `HostServer`（Ktor HTTP + WebSocket）、`HostForegroundService`（前台服务保活）、`WwwStore`（网页资源托管）、`HostRuntime`（全局运行态） |
| `runtime/` | `Room`（房间权威状态：入座 / 准备 / 开局 / 结算）、`GamePlugin` 插件接口（`onStart` / `onAction` / `snapshotFor` / `isFinished` / `reset`）、`EventBus`；`plugins/` 下 5 个游戏插件 |
| `data/` | `GameCatalog`（游戏目录）、`AppStorage`、词库 / 角色库（`UndercoverWordStore`、`DrawGuessWordStore`、`WerewolfRoleStore`，持久化在本机，用过的词条会标记） |
| `ui/` | `MainActivity` + `HomeFragment`（选游戏）、`RoomActivity`（WebView + 房间壳）、各游戏配置页、`MoreFragment` |

要点：

- 卧底、你画我猜、狼人杀通过 `snapshotFor` 按玩家分发私有快照（如秘密阶段的个人词语、狼人同伙列表、女巫当夜刀人目标），公开信息与私有信息隔离。
- 游戏 UI 全部由网页完成，原生壳不承载游戏界面或规则。

## 游戏

| 游戏 | 人数 | 玩法 | 配置页 |
|------|------|------|--------|
| 五子棋 | 2 | 经典双人对弈 | — |
| 谁是卧底 | 3–8 | 发放平民词 / 卧底词，线下讨论后房主揭晓 | 词库、卧底人数、人数范围 |
| 你画我猜 | 3–8 | 一人作画（笔画实时同步），其他人猜词，猜对或跳过结束本局 | 词库 |
| 狼人杀 | 6–12 | 狼人 / 预言家 / 女巫 / 守卫 / 猎人 / 村民，夜晚行动与白天投票交替，含胜利判定 | 角色配置 |
| 斗地主 | 3 | 54 张牌，叫分定地主，地主对抗两农民，出牌在 Host 校验 | — |

## 网页资源

网页前端位于 `app/src/main/assets/www/`（大厅 + 各游戏页面，游戏在 `www/games/{id}/`），随 APK 内置发布，无在线更新通道。APK 升级（`versionCode` 变化）时 `WwwStore` 会自动用内置资源刷新磁盘副本。

## 运行

Android Studio 打开本目录，或安装
`app/build/outputs/apk/debug/app-debug.apk`
