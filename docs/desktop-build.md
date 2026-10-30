# Windows 便携整合包

发行文件位于 `outputs/画布工作台-Windows-x64-1.2.0.zip`。完整解压到机械盘后双击启动器，不需要另外安装开发环境。界面与故障处理参见 `launcher/使用说明.txt`。

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

发行版 tag 使用 `v<launcher/package.json 的 version>`，同时上传 `画布工作台-Windows-x64-<version>.zip` 与同名 `.sha256`。框架核对版本、来源、大小、GitHub 文件摘要、SHA-256 和解压后的全部文件清单，再允许重启安装；已校验的待安装更新保存在数据目录，关闭后可恢复。

仓库的 `Build Windows release` 工作流支持手动运行，也在版本 tag 推送后构建并发布。发布前同步更新 `launcher/package.json`、锁文件、根目录 `VERSION` 和变更记录。下载页为 <https://github.com/jianye0012-source/canvas-studio/releases>。真实 Windows 重启替换流程仍需实机验收。

首页浏览器选择支持 Edge、Chrome、Firefox，以及指定 Chromium 或 Firefox 主程序；启动和打开时自动保存选择。切换常用浏览器会清除旧的自定义路径，专用资料、缓存和下载仍放在数据目录。指定其他 Chromium 程序时按其路径区分资料目录。
