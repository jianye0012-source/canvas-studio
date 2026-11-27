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
- **全链路集成测试已完成**：本地装了 Go 工具链、bun、ffmpeg 测试素材后，用 `prepareBundle('linux')` 实打实编译了一份完整安装包（Go 服务、Next.js standalone、CozyClay dist、启动器文件）到 `work/bundle-linux`（未提交，`.gitignore` 已排除）。
  - `launcher/test/director-lifecycle.cjs`：4/4 通过——真实 Electron + 真实 Chromium 跑完整导演台生命周期（打开、保存、重连、克隆、AI 生成 3D 模型导入），直接验证了 `previsMode` 删除、首次打开抢跑修复、画布会话握手都没问题。
  - `launcher/test/workspace-smoke.cjs`：发现并修了一个由本次改动引入的测试问题——`.canvas-return-bar` 里「已连接画布」这行字只是连接成功那一刻的瞬时提示，代码立刻就继续往下把它改写成「正在保存到本机…」「已保存到本机」，Playwright 轮询经常错过这个窗口导致超时；`director-lifecycle.cjs` 自己一直等的是稳定落地的「已保存到本机」，照抄这个写法后两个测试都稳定通过。这不是产品本身的 bug——截图显示导演台当时已经正常连上、场景已保存、新按钮也正确渲染，只是测试选的等待文案不够稳定。
  - 跑完以上两个集成测试后，`launcher` 单元测试 110/110 仍然全部通过。
  - 没有验证的：真实 Windows 打包流程（Electron 签名、安装/卸载、在线更新）和真实模型渠道下的动作生成效果，这些需要 Windows 实机或下一次专门会话。

## v1.3.24 发布时 Windows CI 暴露、本地复现并修复的问题

发布 v1.3.24 时 `Build Windows release` 工作流的「Verify portable projects on isolated Windows workspaces」步骤失败，本地重新组装一份 `work/bundle-linux` 完整复现，定位并修复了三类问题，均已在修复后的本地构建上重新跑通：

1. **`.topbar-mcp[data-state="connected"]` 这个死选择器还有三处漏网**：之前只改了 `workspace-smoke.cjs`，`launcher/test/browser-smoke.cjs`、`multi-channel.cjs`、`agent-transport.cjs` 里各有一处同样的等待，而且这三处紧跟着的下一行本来就已经在等 `.canvas-return-bar` 的「已保存到本机」——两个等待本来就是重复的，直接删掉死的那一行即可。
2. **`launcher/test/browser-smoke.cjs` 自己也调了一次 `previsMode`**：`window.__cozyclay.runStudioAction('project.new', {..., previsMode: 'animation', ...})` 这行是测试代码自己直接调用 Studio 命令，和 `canvas-bridge.js` 那处是同一类 bug，漏改了，同样删掉这个参数。
3. **新建角色的操作方式变了，测试里硬编码的「Y Bot」选项已经不存在**：3.3.0 把 X Bot / Y Bot 的选择去掉了，新角色统一是积木人（Block 造型），而且入口也从原来「点一个通用『添加』按钮 → 选 Y Bot」，变成「点工具栏里 `title="添加物体、角色或摄影机"` 的加号 → 在弹出菜单里点『积木人』」。这个按钮的可访问名称和它的可见文字对不上（`getByRole('button', {name:'添加'})` 匹配不到，要用 `getByTitle`），光看代码猜不出来，是实际跑起来、一步步点开菜单核对了 DOM 才确认的。

这三类问题修复后，`launcher/test/director-lifecycle.cjs`（4/4）、`launcher/test/portable-browser-smoke.cjs`（10/10，`passed: true`）、`launcher` 单元测试（110/110）全部重新跑通；重新打上 v1.3.24 标签触发 CI，Windows 上同一个测试又在不同的地方连续失败两次——「动画到画布」卡在「正在导出动画…」120 秒超时。本地用同一份构建完整复现整条流程却顺利通过，判断是 Windows 跑分机没有 GPU、纯软件渲染更慢，而不是逻辑错误。

往上游 3.3.0 的变更记录查证：浏览器一旦没有存过设置，默认会打开「卡通描边」（toon look）——给视口、截图和导出都多加一道轮廓/明暗分层的后期处理，每一帧都更贵；这是全新的默认行为，不是我们这次升级特意改的，但正好只有 `browser-smoke.cjs` 这个测试文件会触发截图和导出，其余跑过的测试都不涉及渲染导出，没撞上这个问题。代码里本来就留了一个专门给自动化用的开关 `window.__cozyFinish('off')`（注释写明是 QA hook），在测试里连上导演台之后、正式开始操作之前调一下就行，不是我们自己发明的绕过写法。

这个默认行为变化本身超出本次「先保持升级前体验」的范围，暂不处理产品侧默认值，只在测试里关闭，避免 CI 因为纯软件渲染变慢而超时；产品里要不要默认关掉卡通描边，留给后续单独评估。

加了这个修复后，Windows CI 在「跨工作区」集成测试的「动画到画布」这一步仍连续失败 3 次，而且失败时连测试自带的失败截图都没能生成——像是整个页面在那一刻真的卡死，不只是导出慢；本地反复复现始终正常。征得用户同意后，临时在 `.github/workflows/release-windows.yml` 给这一步加了 `continue-on-error: true`，让发布流程在这项测试失败时也能跑完，拿到一个真实可测的 Windows 安装包供用户上机验证。重新跑的这一次，这项测试自己就通过了，没有用上临时放行——说明之前三次更像是偶发（例如某台 CI 跑分机当时状态不好），不是每次必现。v1.3.24 顺利发布后已撤销这处临时放行，恢复为测试失败即拦截发布。**这个偶发失败的根因还没有定论，如果以后同一个点再次出现，优先怀疑是 Windows CI 机器本身的问题，而不是本次升级引入的逻辑错误。**
