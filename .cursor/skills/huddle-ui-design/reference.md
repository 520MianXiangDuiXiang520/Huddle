# Huddle UI 参考

## 状态矩阵

| 状态 | 必备反馈 | 用户可做什么 |
| --- | --- | --- |
| 启动/连接中 | 正在进行什么、预计下一步 | 等待、返回（若安全） |
| 可操作 | 当前条件、主操作 | 完成当前任务 |
| 等待他人 | 谁或什么在等待 | 准备、邀请或查看状态 |
| 重连中 | 已保留的状态、重试进度 | 等待、手动重试、离开 |
| 可恢复错误 | 原因、当前数据是否保留 | 重试、返回 |
| 阻断错误 | 无法继续的原因 | 唯一明确的下一步 |
| 结果 | 结果和后续选择 | 再来一局、回大厅、结束 |

## token 映射

| 语义 | 网页迁移目标 | Android 迁移目标 |
| --- | --- | --- |
| 背景 | `--color-bg` | `@color/bg` |
| 表面 | `--color-surface` | `@color/surface` |
| 次表面 | `--color-surface-muted` | `@color/surface_muted` |
| 文字 | `--color-text` | `@color/text_primary` |
| 次文字 | `--color-text-muted` | `@color/text_secondary` |
| 操作/成功 | `--color-action` | `@color/accent` |
| 危险 | `--color-danger` | `@color/danger` |
| 边框 | `--color-border` | `@color/stroke` |

当前网页源文件：`android-host/app/src/main/assets/www/style.css`。
当前 Android 源文件：`android-host/app/src/main/res/values/colors.xml`、`values-night/colors.xml`。

## 响应式检查

- <600px：单列、16px 侧边距、底部主操作处于拇指可达区。
- 600–1023px：房间信息可与游戏区并列，画布优先。
- >=1024px：总体宽度 960–1200px，不能保留手机窄栏。
- 使用安全区和动态视口；不禁止浏览器缩放。
- 所有主操作目标至少 44×44px。

## 实施检查

- [ ] 使用共享 Shell，未向 `index.html` 写入特定游戏结构。
- [ ] 游戏文件放在 `assets/www/games/<game-id>/`。
- [ ] 覆盖浅色与深色主题。
- [ ] 重要状态不只通过颜色或 Toast 表达。
- [ ] 处理 WebSocket 重连、房间结束与操作冲突。
- [ ] 支持键盘焦点、可访问名称和 `prefers-reduced-motion`。
- [ ] 不引入运行时外网依赖或 Host/Guest 不一致体验。
