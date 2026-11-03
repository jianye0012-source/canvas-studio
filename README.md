# 画布工作台 · Windows 便携版

在一张无限画布上整理参考素材、生成文案和画面，再用 CozyClay 白模导演台预演场景、动作和运镜。适合把创意、分镜和成片素材放在同一个本机项目里。支持 Windows 10/11 x64，解压后由启动器一键打开浏览器工作区，无需软件账号或额外安装运行环境。

[下载 Windows 整合包](https://github.com/jianye0012-source/canvas-studio/releases/latest) · [使用说明](launcher/使用说明.txt) · [构建说明](docs/desktop-build.md) · [更新记录](CHANGELOG.md)

## 核心功能

- **无限画布与多渠道 AI**。用节点组织文本、图片、视频、音频和提示词。不同创作环节可以分别选择模型渠道和模型，Windows 系统加密保存各渠道的 API Key。
- **可编辑的白模预演**。用自然语言搭建和修改场景，也能手动编辑道具、骨骼角色动作、关键帧和镜头。截图与 MP4 可以回传画布和素材库。
- **按文件夹批量执行**。FOR 节点按文件顺序运行相连的工作流，保留每个文件的结果，支持暂停和继续。大文件导入可查看进度和取消。
- **Skill 与 MCP**。在启动器管理文字生成用的 Markdown Skill。画布与导演台各有独立 MCP 接口，支持通过 stdio 或 Streamable HTTP 接入兼容客户端。
- **本机保存与跨电脑迁移**。项目和素材保存在数据目录。画布库可导出包含素材、视频、完整白模场景及动作的 ZIP，另一台电脑导入后可继续编辑。
- **便携启动与更新**。可指定 Edge、Chrome、Firefox 或其他 Chromium 浏览器。启动器支持在线检查、断点续传、离线导入和历史版本回退。新版启动成功后再切换，失败可恢复原程序。

## 快速开始

1. 从发行页下载 Windows x64 ZIP，完整解压到机械盘。
2. 双击 `画布工作台启动器.exe`，选择浏览器，点击「一键启动工作台」。
3. 使用在线 AI 时，在「模型配置」添加 OpenAI 兼容的服务渠道和模型。白模 AI 需要工具调用能力，参考图需要模型支持视觉输入。
4. 在「检查与修复」检查更新。要把项目交给另一台电脑，从画布库导出 ZIP，在目标电脑的画布库导入，并重新填写模型密钥。

默认数据目录是整合包内的 `data/`，可在「存储设置」切换。Windows 构建机已验证升级、回退、中断恢复和跨数据目录的项目迁移。[验收记录](https://github.com/jianye0012-source/canvas-studio/actions/runs/41580616796)

## 来源与许可

本项目由 Infinite Canvas 和 CozyClay 整合改造，保留原作者版权及许可。 [Infinite Canvas](https://github.com/tigerowo/infinite-canvas) · [CozyClay](https://github.com/NomaDamas/CozyClay)

整合版按 AGPL-3.0 分发，发行包含对应源码和第三方许可。 [项目许可](LICENSE) · [开源说明](launcher/SOURCE-NOTICE.txt) · [CozyClay 许可](integrations/cozyclay/LICENSING.md)
