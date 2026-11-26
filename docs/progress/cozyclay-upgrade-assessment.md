---
title: 导演台（CozyClay）升级到 3.3.2 评估
description: 现有导演台与上游 3.3.2 的差异、风险和升级步骤
---

# 导演台（CozyClay）升级到 3.3.2 评估

## 现状

- 本地版本：上游 v3.2.1 之后第 5 个提交 `e107bf8f`（已含 #1003–#1011），再加画布工作台自己的改动。
- 上游最新：v3.3.2（2026-11-26），领先约 170 个提交。
- 许可：仍是 AGPL-3.0，无冲突。

## 本地改动分类

| 类别 | 数量 | 处理 |
|---|---|---|
| 上游提前搬来的功能（动作引擎、任务、补间、姿势关键帧等） | 约 60 个文件 | 直接用上游 3.3.2 |
| 画布对接（桥接、保存、3D 生成、模型渠道、中文提示、MCP） | 约 31 个文件 | 手工移植 |
| 本地修 bug | 4 处 | Draco 加载上游已独立修复；其余 3 处需移植 |

需重点合并的文件：

- 高冲突：`bin/agent/agent-runner.mjs`（自动续跑 vs 上游新的回合收尾逻辑）、`src/domains/scenes.js`（按引用保存 vs 上游重写的保存流程）。
- 中冲突：`agent-routes.mjs`、`App.jsx`、`AgentPanel.jsx`、`domains/objects.js`、`project.js`、`vite.config.js`、`mcp/package.json`。
- 其余为几行的小补丁，或本地独有文件原样带回。

## 必须处理的破坏点

1. **导演台 MCP**：已决定取消。升级时去掉 `/mcp/director`（`launcher/cozy-runtime.mjs`、`gateway.cjs`、`mcp-stdio.mjs`、画布「连接 Codex」页的导演台选项）和 `handle.mcpRuntime`；画布 MCP（`/mcp/canvas`）保留，需确认它不依赖 `zodToJsonSchema`。
2. **新建导演台失败**：`canvas-bridge.js` 调 `project.new` 时传了 `previsMode`，3.3.0 删了故事板后该参数会被拒绝。
3. **首次打开抢跑**：3.3.1 起首次打开会自动新建「Untitled Project」，`firstOpen()` 只排除 `?embed`/`?scene`，不排除 `?canvas`，会和画布下发的项目冲突，需补丁。
4. **模型渠道接入**：必须把 `provider-keys.mjs`、`openai-compatible-provider.mjs` 两处本地钩子移植到 pi 1.6.0 上；否则新动作工具找不到模型，旧动作动作又被隐藏，智能体完全无法做动作。
5. **回滚丢镜头**：3.3.x 保存的导演台项目，回滚到旧版打开会丢失镜头。启动器的官方回滚功能需要提示或先备份。

## 动作编写模型（3.3.0 核心新功能）

- 选模型顺序：CLIProxy → 登录账号里有 `claude-opus-5-5` → 当前对话的模型。
- 画布工作台走第 3 条：用户在导演台选的渠道模型就是动作编写模型（推理强度自动降为 off）。
- 启动器已有「白模导演」模型选项（`launcher/lib/config.cjs` 的 `directorModel`），动作编写默认用它；可再加一个可选的「动作模型」选项，映射到 `COZYCLAY_MOTION_MODEL`。
- 要求：渠道模型需支持图片输入；建议把输出上限从 8192 调高；启动器不要带上 `CLIPROXY_*` 环境变量。
- 风险：上游只用 `claude-opus-5-5` 实测过，其他模型只测过模拟服务器，国内模型效果需实测。
- 兜底：`COZYCLAY_MOTION_ENGINE=old` 可退回现在的动作引擎。

## 官方宿主接口

- 3.3.2 的 `COZYCLAY_DESKTOP`、`/__cozyclay/contract` 只在上游自带启动器里生效，画布工作台用自己的 `launcher/cozy-runtime.mjs`，用不上。
- 页面侧的 `window.cozyclayHost.projectFiles`（打开/保存）可以由网关注入，有机会替代 `scenes.js`、`project.js` 里的保存补丁；截图、视频、生图请求仍需自有桥接。建议作为第二阶段。

## 建议步骤

1. 新分支，`integrations/cozyclay` 换成上游 v3.3.2。
2. 带回本地独有文件，逐个移植画布对接改动（先 MCP、模型渠道、桥接三处破坏点）。
3. 启动器默认 `COZYCLAY_MOTION_ENGINE=old` 先保持现有体验跑通全部测试；再切到新动作编写模型，用常用渠道模型实测动作质量和耗时。
4. 处理回滚丢镜头提示。
5. 跑 `launcher/test` 全套与 CozyClay 自带测试、Windows 发布流程后发版。

## 实施记录（feat/cozyclay-3.3.2 分支）

在 `/tmp/cozy-up/up`（本地提交 `e107bf8f` 基础上的独立工作树）用 `git merge v3.3.2` 实际合并，而不是整段替换：

- 自动合并约 35 个文件；冲突 12 个，逐个手工解决（不是估算，是实际冲突列表）：
  `mcp/package.json`、`mcp/package-lock.json`、`src/source-offer.jsx`、`src/shell/TopBar.jsx`、`vite.config.js`、`src/scene-mesh.js`、`src/scene-mesh-cache.js`、`test/verify-scene-mesh.mjs`、`bin/agent/agent-routes.mjs`、`bin/agent/agent-runner.mjs`、`src/domains/scenes.js`，以及 `tools/run-tests.mjs`（本地测试注册表，直接相加无需取舍）。
- **踩过的坑**：`src/scene-mesh-cache.js` 最初用 `git checkout --ours` 整文件二选一解决冲突，结果把上游在这个文件里新增的、和冲突无关的 `loadedMeshScene` 导出一起丢了，`src/solid-shape.js` 引用它导致 `vite build` 直接报 `MISSING_EXPORT`。改用 `git merge-file` 对三个版本单独跑一次窄范围三方合并才修好（commit `c7f3751d`）。这提醒：**整文件 `--ours`/`--theirs` 只在确认本地改动等于冲突全部内容时才安全**，逐一核对过的文件见下。安全的有 `mcp/package.json`、`mcp/package-lock.json`、`src/scene-mesh.js`、`test/verify-scene-mesh.mjs`（本地从基线的改动与冲突块完全一致，上游改动也是整段替换，取 `--theirs`不丢东西）。
- `agent-runner.mjs` 的两个 `finishTurn` 定义（本地「续跑未完成步骤」+ 上游新的「收尾未完成工具调用」）手工合并成一个函数，新版先处理上游的收尾分支，再退回本地的续跑分支；**未完全确认** pi 1.6.0 的 `Agent` 是否仍把 `signal` 作为 `finishTurn` 的第二个参数传入（本地旧版这样假设），已用可选链兜底，不会崩，但续跑逻辑的 abort 识别在这点上没有 100% 验证，留给实测。
- 已落地的破坏点修复：`previsMode` 参数从 `canvas-bridge.js` 的 `project.new` 调用中删除；`guest-start.js` 的 `firstOpen()` 新增 `?canvas` 到排除列表；导演台 MCP 整条链路（`launcher/cozy-runtime.mjs`、`launcher/lib/gateway.cjs`、`launcher/mcp-stdio.mjs`、`canvas-bridge.js` 的「导演台 MCP」按钮、画布「连接 Codex」页、`mcp/studio-http.mjs` 的 `directorMcpSurface`）已删除，`launcher/test/workspace.test.cjs`、`launcher/test/workspace-smoke.cjs`、`docs/desktop-build.md` 同步更新。
- `COZYCLAY_MOTION_ENGINE=old` 已固定写入两处（必须一致）：`launcher/lib/runtime.cjs`（运行时，给 Node 智能体进程用）、`launcher/scripts/package.mjs`（打包时，给 `vite build` 烘焙进前端产物用，因为 `VITE_COZYCLAY_FIGURE` 是构建期常量，运行时改环境变量对已构建的前端无效）。
- 回滚提示：`launcher/lib/release-update.cjs` 选择回退版本时的提示文案追加了导演台镜头丢失的提醒。
- 新功能「发送参考图到导演台」：`src/domains/objects.js` 新增 `domain.importCutoutFile`（复用已有的 `importCutout`，与 `importMeshFile` 同一模式）；`canvas-bridge.js` 监听新的 `storyai:director-reference-image` postMessage，取图、转 `File`、调用 `importCutoutFile` 把参考图当照片卡立进场景；画布侧 `components/canvas-director.tsx` 在导演台悬浮层加了「发送参考图到导演台」按钮，弹出参考图库选择器。
  **范围内的取舍**：没有做「自动把文字提示词填进智能体对话框」——`AgentPanel.jsx` 的会话状态（`createAgentChatStore`）是面板组件内部 `useMemo` 创建的，没有向上提升到 `appContext`，要做到这点需要改动这个上游改动最多的文件之一，风险和收益不成比例。现在的效果是：参考图会出现在 3D 场景里，用户仍需自己在智能体里输入"照这张图摆姿势"之类的话。
- 测试：`node tools/run-tests.mjs`（680 个可运行文件）跑了两次，都只有同一个文件失败：`test/motion3/verify-motion3-repair.mjs`。单独跑该文件通过（exit 0，官方记录的基准耗时本来就要 339 秒）。查看失败日志确认是 `FAIL exit car, hips sunk: under 10 s — 27895 ms`——这是用例自己对真实墙钟时间的断言（10 秒内完成），不是数据或逻辑断言；在本沙盒 12 路并发下 11 个同样吃 CPU 的用例一起跑，把这条路径的真实耗时从几秒推到了 27.9 秒。判定为**与本次合并无关的环境资源争用偶发失败**，不是回归。
- 已完成：把合并后的工作树同步回 `integrations/cozyclay`（`rsync --delete`，排除 `node_modules`/`dist`），`launcher` 单元测试 110/110 全部通过（`node --test launcher/test/*.test.cjs`），`npm run build`（`COZYCLAY_MOTION_ENGINE=old`）在同步后的目录里重新跑通，并确认 `oldMotionEngine(process.env)` 和 `launchValue(process.env)` 确实解析为 `true`/`"block"`。
- 尚未做：跑 Go+launcher+web 全链路集成测试（`director-lifecycle.cjs`、`workspace-smoke.cjs` 需要先用 `prepareBundle('linux')` 构建一份完整的 `work/bundle-linux`——Go 服务、Next.js、Electron 全部编译，耗时和资源都明显超过本次会话规模，建议作为合并前的最后一步，在 Windows 发布流程或专门的下一次会话里做）、提交推送。
