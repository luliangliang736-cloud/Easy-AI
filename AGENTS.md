<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 创意工具箱 / 材质库（自 Vibstar 迁移）

画布底部工具栏右侧有一个独立的"创意工具箱"胶囊，包含「风格迁移」（一键换材质）入口。
该功能整体从 Vibstar 项目迁移而来，详细说明见 `docs/材质库迁移说明.md`。

涉及文件（改动时请连带考虑）：

- `src/lib/materials.js` — 材质数据、配色方案、提示词拼装（纯数据 + 纯函数，无外部依赖）
- `src/components/MaterialPanel.jsx` — 材质库浮窗面板（收藏 / DIY 配色 / 组合探索 / DIY 材质 + AI 材质球缩略图）
- `src/components/Toolbar.jsx` — 胶囊 2「创意工具箱」入口
- `src/components/Canvas.jsx` — 面板挂载、点选校验（`handlePickMaterial`/`handlePickCombo`）、滚轮豁免（`[data-material-picker-root]` 内滚轮不缩放画布）
- `src/app/canvas/page.js` — `handleApplyMaterial`/`handleApplyCombo` 接生成管线；`displayLabel` 短标签
- `public/images/materials/*.png` — 官方材质球缩略图
- 云同步 key（`lovart-material-favorites` / `lovart-custom-palettes` / `lovart-combo-presets` / `lovart-custom-materials`）注册在
  `src/lib/server/cloudStateStore.js`、`src/lib/useCloudLocalStorageSync.js`（含空列表保护）、`src/app/canvas/page.js` 三处，增删 key 三处要同步改。

# 画布 Ctrl+Z 撤销删除（自 Vibstar 迁移）

`src/app/canvas/page.js` 中的 `canvasUndoActionsRef` 只记录"删除"动作（图片 / 文案 / 形状，上限 50 条），
Ctrl+Z / Cmd+Z 时把元素追加回对应历史栈，不调用历史栈自身的 undo（避免与拖拽等 push 操作耦合）。
恢复时必须调用 `undeleteCloudMarkers` 同步清掉本地 + 云端删除标记（`/api/cloud-state/undelete`），
否则恢复的内容会在下一次加载 / 云同步时被删除标记再次过滤掉。
切换 / 新建 / 删除画布、云端恢复重载（`loadCanvasStateFromStorage`）时都会清空撤销日志，防止跨画布误恢复。
