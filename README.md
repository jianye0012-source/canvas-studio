# 画布工作台 · Windows 整合版

将无限画布与 CozyClay 动态白模导演台整合为 Windows 10/11 x64 便携工作台。解压到机械盘，双击启动器，一键打开浏览器工作区；不需要软件账号，也不需要安装 Node、Go 或 Docker。

[下载 Windows 整合包](https://github.com/jianye0012-source/canvas-studio/releases/latest) · [构建说明](docs/desktop-build.md) · [使用说明](launcher/使用说明.txt)

## 功能

- 无限画布、生图、视频、提示词、素材库、历史记录及导出。
- CozyClay 可编辑白模、已有骨骼角色的动作与运镜，截图和 MP4 回传画布。
- 多渠道模型配置：接口与密钥分别保存，白模、文字、图片和视频分别选择渠道及模型。
- 首页选择 Edge、Chrome、Firefox 或指定浏览器主程序，使用独立资料、缓存和下载目录。
- 项目、素材及任务记录保存到本机；API Key 在 Windows 使用系统加密保存。
- 从本仓库的 GitHub Releases 检查、下载、校验及安装更新，也支持离线导入完整 ZIP。
- 文件夹 FOR 循环，逐文件运行相连工作流，保存独立结果并支持暂停后继续。
- 文字模型 AI 生成与 Skill 选择，启动器内管理、导入和导出自己的 Skill。
- 本项目独立的画布 MCP 与导演台 MCP，支持通用 stdio／HTTP 客户端；视频附件在本机解码抽帧。

在线 AI 需要自行配置支持 OpenAI 兼容接口的服务与额度。白模导演需要工具调用能力，参考图需要视觉输入。软件仅监听本机地址。

## 使用

1. 从 Releases 下载并完整解压到机械盘，不要在压缩软件内运行。
2. 打开 `画布工作台启动器.exe`，在首页选择浏览器。
3. 在“模型配置”添加渠道和模型，保存各功能的默认选择。
4. 点击“一键启动工作台”。更新与修复位于“检查与修复”。

数据默认保存在整合包的 `data/`。更新保留数据目录与定位设置；跨电脑或 Windows 用户后需要重新输入模型密钥。不要公开上传自己的数据目录。

## 开发与发布

构建入口是 `node launcher/scripts/package.mjs`，依赖安装、机械盘路径与测试方法见[构建说明](docs/desktop-build.md)。仓库提供 Windows 发行包构建工作流，发布文件包含对应源码 ZIP 和 SHA-256 校验值。普通使用者不需要开发环境。

当前已在 Linux 完成启动器、浏览器工作区、渠道及更新流程联调。Windows 实机启动、浏览器兼容、系统密钥加密与更新应用仍需验收。

## 来源与许可

本项目基于 [tigerowo/infinite-canvas](https://github.com/tigerowo/infinite-canvas) 与 [NomaDamas/CozyClay](https://github.com/NomaDamas/CozyClay) 改造整合，并非两者的官方发行版。原作者版权和许可保留。

整合修改按 AGPL-3.0 分发，见 [LICENSE](LICENSE)。第三方模型、素材及依赖沿用各自许可，详见 [开源说明](launcher/SOURCE-NOTICE.txt) 与 [CozyClay 许可](integrations/cozyclay/LICENSING.md)。
