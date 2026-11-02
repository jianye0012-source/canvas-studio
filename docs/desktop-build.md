# Windows 便携整合包

发行文件位于 `outputs/CanvasStudio-Windows-x64-1.2.0.zip`。完整解压到机械盘后双击启动器，不需要另外安装开发环境。界面与故障处理参见 `launcher/使用说明.txt`。

## 组成

- `launcher/`：Electron 中文启动器、加密配置、进程管理、浏览器启动、本机网关、GitHub Releases 在线更新、离线发行包校验及更新。
- Go 服务：通过 `CANVAS_LOCAL_TOKEN` 启用本机模式，固定本地身份，SQLite 保存画布和任务，素材保存到数据目录。
- `web/`：画布前端，去掉登录、营销公告和主界面版本／GitHub 图标，模型配置与启动器共用。
- `integrations/cozyclay/`：固定上游源码及画布适配。完整项目文件带引擎及格式版本，保存场景、动作、镜头、模型及参考图。

网关只监听 `127.0.0.1`，通过启动器建立本机会话。Go 服务仅接收进程内部凭据；浏览器不接收真实模型 API Key。模型调用由本机网关读取加密配置后转发。CozyClay 的 HTTP 和 WebSocket 使用 `/cozy/` 路由。默认禁用上游自更新、遥测和额外动作模型下载。

模型设置支持多个独立渠道，每个渠道配置名称、接口、加密密钥、启用状态及带类型的模型列表。默认选择保存渠道编号与模型名，画布沿用原有渠道选择器。代理地址带渠道编号，任务查询保持原渠道；导演台的同名模型使用内部唯一编号转发，并向服务商还原真实模型名。上一版单渠道设置和密钥会在读取时保留为“默认渠道”。

## 从源码构建

可在 Linux x64 交叉构建，或在 Windows 上构建 Windows x64 整合包。开发机需要 Node.js 24.22.1、npm 及 Go 1.27.3；最终用户不需要这些工具。先核对实际挂载，所有缓存、中间文件和下载均置于机械盘的 `work/`。

```bash
mkdir -p work/tmp work/cache outputs
export TMPDIR="$PWD/work/tmp"
export npm_config_cache="$PWD/work/cache/npm"
export ELECTRON_CACHE="$PWD/work/cache/electron"
export GOPATH="$PWD/work/cache/go"
export GOCACHE="$PWD/work/cache/go-build"
npm ci --prefix web
npm ci --prefix integrations/cozyclay
npm ci --prefix integrations/cozyclay/mcp
npm ci --prefix launcher
node launcher/scripts/package.mjs
```

也可用 `GO_BINARY` 指定 Go 程序路径。脚本下载并校验 Node Windows 运行时，交叉编译 Go 服务，构建前端和导演台，加入 Windows 原生依赖，生成 Electron 程序、文件清单、对应源码 ZIP 和 SHA-256 文件。打包无需 Bun。

发行包不会携带用户 `data/` 或 `portable.json`。更新先在数据目录下解压、校验完整清单，再停止服务，由 Windows PowerShell 等待启动器退出后替换程序文件。用户数据保留；失败原因写入 `data/logs/update.log`。

切换数据目录是切换工作区，不复制原数据；跨 Windows 用户后原密钥无法解密时需重新填写。不创建用户数据的额外备份。

## 验证

```bash
npm test --prefix launcher
node launcher/test/launcher-models.cjs
node launcher/test/browser-launcher.cjs
node launcher/test/update-launcher.cjs
go test ./config ./middleware ./router ./service ./handler ./repository
web/node_modules/.bin/tsc --noEmit -p web/tsconfig.json
node integrations/cozyclay/test/motion3/verify-motion3-core.mjs
node integrations/cozyclay/test/verify-project.mjs
node integrations/cozyclay/test/verify-scene-assets.mjs
node launcher/scripts/prepare-bundle.mjs
node launcher/headless.cjs
# 在另一个终端运行：
node launcher/test/browser-smoke.cjs
node launcher/test/agent-transport.cjs
node launcher/test/multi-channel.cjs
```

联调数据位于 `work/smoke-data/`，可通过 `CANVAS_SMOKE_DATA_DIR` 指定，不进入发行包。浏览器测试使用系统 Chrome，验证动作编译、模型导入、截图／MP4 回传、新浏览器资料下的恢复和写入失败提示。接口传输测试使用本地 SSE 测试替身，验证连续两轮请求与会话路径，不代表真实付费 AI 服务的生成质量。在线 AI 需配置支持工具调用／视觉输入的服务。

Windows 10/11 实机启动、Windows 密钥加密、真实服务商调用和 Windows 更新应用流程须单独验收，Linux 联调不替代这些项目。

## GitHub 更新源与发布

更新源固定在 `launcher/update-source.json`，当前为 `jianye0012-source/canvas-studio`。启动器只读取本仓库的正式 GitHub Release，不拉取两个上游项目的新代码。可关闭启动时检查，也可随时手动检查。断网或 GitHub 限流不会阻止已有工作区运行。

发行版 tag 使用 `v<launcher/package.json 的 version>`，同时上传 `CanvasStudio-Windows-x64-<version>.zip` 与同名 `.sha256`。框架核对版本、来源、大小、GitHub 文件摘要、SHA-256 和解压后的全部文件清单，再允许重启安装；已校验的待安装更新保存在数据目录，关闭后可恢复。

仓库的 `Build Windows release` 工作流支持手动运行，也在版本 tag 推送后构建并发布。发布前同步更新 `launcher/package.json`、锁文件、根目录 `VERSION` 和变更记录。下载页为 <https://github.com/jianye0012-source/canvas-studio/releases>。真实 Windows 重启替换流程仍需实机验收。

首页浏览器选择支持 Edge、Chrome、Firefox，以及指定 Chromium 或 Firefox 主程序；启动和打开时自动保存选择。切换常用浏览器会清除旧的自定义路径，专用资料、缓存和下载仍放在数据目录。指定其他 Chromium 程序时按其路径区分资料目录。


## v1.3 MCP、循环与 Skill

画布 MCP 使用启动器同源 `/mcp/canvas`，导演台使用 `/mcp/director`，均要求本整合包专属本机 Bearer 凭据。浏览器通过同源会话读取连接配置；stdio 桥读取 `data/config/mcp-connection.json`，每次启动写入当前端口。两个工具名前缀分别为 `canvas_studio_`、`canvas_studio_director_`；与上游 3210 Agent 和配置目录分开。连接不依赖 Codex。画布桥在页面打开时连接，助手面板收起不影响工具执行；多个页面要求 workspace_id，导演台要求 workspace_handle。

目录授权通过 Electron 原生对话框，保存为本机不透明授权编号。扫描跳过符号链接并限制数量／层级；导入时重新检查真实路径、大小与修改时间。循环将模板按拓扑顺序复制，每文件保留独立输入和结果；每步一份结果，组／导演台／嵌套循环会拒绝。每次推进先同步保存项目，状态不明时停止自动提交。浏览器重开不自动触发付费生成。

Skill 使用原有本机用户 Skill API 与 SQLite，不另建浏览器私有库。启动器支持 CRUD、文本导入导出；文字节点、生成配置和 MCP generate_text 均可引用 Skill，实际请求前重新读取内容。Markdown 作为模型指令，不执行代码。

视频运行环境由 `launcher/scripts/media-runtime.mjs` 从固定发行资产下载并校验 SHA-256，随包提供 FFmpeg 及原发行者许可／构建说明；不会要求用户安装 FFmpeg。浏览器将视频流传到本机临时目录解码，限定协议、格式、并发和超时，结束即删除临时文件。视频原始字节不会自动发给 AI，只在用户发送时携带抽帧图。

新增验证脚本：`launcher/test/workspace-smoke.cjs`（需 headless 服务，CANVAS_SMOKE_FOLDER 指向含两个 UTF-8 文本的测试目录，work/video-fixture 放 H.264 8／10 位编码样例），`launcher/test/skills-launcher.cjs`（原生 Electron Skill 管理）。测试使用本地模型替身，不发起付费请求。
