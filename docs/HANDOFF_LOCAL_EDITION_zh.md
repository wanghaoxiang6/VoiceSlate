# VoiceSlate 交接说明

最后更新：2026-05-08

## 1. 当前定位

这是一个基于 OpenTypeless 改造出来的本地优先版本，当前对外名称使用 `VoiceSlate`。

目标是：

- 保留熟悉的桌面语音输入使用方式
- 默认走 BYOK，不依赖官方 Pro / Cloud 才能使用核心能力
- 在 Windows 上尽量实现“开始录音 -> 识别 -> 润色 -> 直接写回目标应用”

## 2. 当前默认链路

1. 用户触发热键
2. 桌面端开始录音
3. 音频发送到火山引擎 STT
4. 识别文本发送到 DeepSeek 做润色
5. 结果通过剪贴板粘贴回目标输入框
6. 同时写入本地历史记录和统计数据

默认配置重点：

- `STT Provider`: `volcengine-flash`
- `LLM Provider`: `deepseek`
- `Hotkey`: `AltRight`
- `Fallback Hotkey`: `F8`
- `Hotkey Mode`: `toggle`
- `Output Mode`: `clipboard`
- `UI Language`: `zh`

## 3. 当前已经完成的定制

- BYOK 优先流程
- 火山引擎 STT 接入
- DeepSeek 友好的默认配置
- 本地历史纠错
- 总口述时间、字数、节约时间、平均口速统计
- 本月 API 用量与费用估算
- Windows 下的焦点恢复、胶囊显示、目标窗口输出修复
- `CodeX` 等代码窗口的输出适配

## 4. 当前热键情况

- 主热键：`右 Alt`
- 备用热键：`F8`

说明：

- `F8` 目前是稳定兜底方案
- `右 Alt` 已做多层兼容，但在不同输入法、键盘驱动、系统环境下仍可能不稳定

## 5. 本地数据位置

- Windows 主程序：`%LOCALAPPDATA%\VoiceSlate\voiceslate.exe`
- Windows 启动脚本：`%LOCALAPPDATA%\VoiceSlate\launch-voiceslate-local.cmd`
- 本地配置：`%APPDATA%\com.voiceslate.app\settings.json`
- 本地数据库：`%APPDATA%\com.voiceslate.app\voiceslate.db`

说明：

- API Key 保存在本机配置里，不写死在源码中
- 历史记录、纠错结果、统计数据、词典都在本地数据库中

## 6. 当前公开发布注意事项

- 保留 `LICENSE`
- 保留 `NOTICE`
- 上传到你自己的 GitHub 仓库后，补上仓库地址
- 如果要长期公开维护，建议继续换成你自己的图标、截图和 release 文案

## 7. 已知问题

- `右 Alt` 仍可能因环境差异不稳定
- 识别速度和准确率主要仍受 STT 服务质量影响
- 中英混说场景下，英文专有词和人名仍可能识别错误
- 当前费用面板是本地估算，不等同于厂商最终账单

## 8. 建议的后续优先级

1. 继续打磨 `右 Alt` 稳定性，同时长期保留 `F8`
2. 把 API 费用估算做成可配置单价
3. 增强纠错反馈闭环，例如导出纠错样本、常错词统计
4. 优化自动分点和自动换行策略
5. 做更完整的个人品牌化替换，例如图标、截图、安装名
