# VoiceSlate 运行时稳定性合同

更新日期：2026-05-21

这份合同用于约束后续所有 VoiceSlate 修改。任何功能优化、打包、发布、AI 接手、外部 AI 改代码，都必须先读本合同。目标不是“多写文档”，而是防止已经修好的链路被后续改动破坏。

## 0. 总原则

MUST：

- 每次改动前先判断改动属于哪一层：热键/胶囊、录音、STT、纠错、LLM、输出、打包、发布。
- 每次只改必要层，不跨层顺手重构。
- 保持 `AltRight / toggle / keyboard / cloud-opus` 作为当前稳定默认组合。
- 修改后必须跑相关测试，并把新问题变成回归测试或明确日志。
- 如果历史记录已经有文字，优先判断输出窗口/热键/目标 app，不要重新按 API 或麦克风问题处理。

MUST NOT：

- 不得因为一个局部问题重置 provider、代理、Clash、热键、打包目录或用户配置。
- 不得删除或绕过当前本地 backend `8788` 统一入口。
- 不得把用户 API Key、token、secret 写入源码、文档、GitHub release、默认 settings 或安装包。
- 不得用“应该可以”代替实际运行验证。

## 1. 运行时基线合同

当前稳定基线：

- App：`%LOCALAPPDATA%\VoiceSlate\voiceslate.exe`
- Launcher：`%LOCALAPPDATA%\VoiceSlate\launch-voiceslate-local.vbs`
- Settings：`%APPDATA%\com.voiceslate.app\settings.json`
- STT provider：`cloud-opus`
- LLM base：`http://127.0.0.1:8788/v1`
- Hotkey：`AltRight`
- Hotkey mode：`toggle`
- Output mode：`keyboard`
- Capsule：必须常驻，`capsule_auto_hide=false`
- Backend health：`http://127.0.0.1:8788/health`
- Local command STT health：`http://127.0.0.1:8178/health`，仅作为短命令加速路线，不得阻塞普通听写。

MUST：

- 发布前确认安装版 exe hash 与构建产物 hash 一致。
- 发布前确认桌面安装包默认 `stt_api_key` 和 `llm_api_key` 为空。
- 发布前确认 `8788` 正常监听；`8178` 如果因本地 Whisper/运行库崩溃不可用，launcher 必须记录日志并继续启动主程序。
- `8178` 是可选短命令预检服务，启动等待不得超过数秒，不能拖慢开机后主程序可用时间。

MUST NOT：

- 不得让桌面快捷方式直接指向裸 `voiceslate.exe`，必须通过 launcher 启动 sidecar。
- 不得让 Windows 开机启动项指向裸 `voiceslate.exe`，必须指向 `wscript.exe "...\\launch-voiceslate-local.vbs"`。
- 不得让本地短命令服务 `8178` 的失败阻塞云端长听写 backend `8788`。
- 不得保留多个会被用户误点的旧安装包、旧快捷方式或旧 exe。

## 2. STT Provider 合同

MUST：

- 普通长听写默认走 `cloud-opus`。
- `cloud-opus` 通过本地 backend `8788` 进入 provider registry。
- `local-command` 只用于短命令预检。
- `local-whisper`、火山、OpenAI、Groq、GLM、SiliconFlow 等 provider 必须保留为可切换/可对比后端。
- STT timing 必须记录 `request_id / provider / upstream_provider / audio_seconds / codec / command_precheck_ms / encode_ms / upstream_ms / parse_ms / latency_ms / ok / error`。

MUST NOT：

- 不得把主程序重新改回直接调用某一家 provider。
- 不得因为某次云端失败就永久切换默认 provider。
- 不得把 `speech was recorded` 全部归因到 API Key 或麦克风。

## 3. 短命令合同

短命令包括：

- `截图`
- `翻译`
- `提问`
- `提示词`

MUST：

- 短命令必须先走本地 tiny command route。
- “截图”必须在 Rust pipeline 中作为 quick action 拦截，直接打开系统截图工具。
- 只有短、命令式、意图明确的语音才触发命令。
- 长句包含命令词时必须按普通听写处理。

MUST NOT：

- 不得依赖 LLM 润色或模糊意图判断来决定是否截图。
- 不得让“我刚才说的是截图这两个字”触发截图。
- 不得让“这句话里包含 screenshot 这个词”触发截图。

必备回归：

- `截图` -> 触发截图
- `截图。` -> 触发截图
- `screenshot` -> 触发截图
- `我刚才说的是截图这两个字` -> 不触发
- `这句话里包含 screenshot 这个词` -> 不触发

## 4. 编号换行与润色合同

MUST：

- LLM polish 必须保留“说出来像编号”的结构。
- `一...二...三...四...`、`第一/第二`、`一是/二是`、`首先/然后/最后` 都必须视为枚举意图。
- 每个编号项必须单独一行。
- Rust prompt 和 backend compact polish prompt 必须同时保留该规则。

MUST NOT：

- 不得把“一……二……三……”压成同一段。
- 不得为了速度删除编号换行示例。
- 不得把编号改成散文段落。

示例合同：

输入：

```text
一先检查云端连接二确认热键有没有响应三再看当前窗口有没有输入
```

输出：

```text
1. 先检查云端连接
2. 确认热键有没有响应
3. 再看当前窗口有没有输入
```

## 5. 纠错合同

MUST：

- 纠错顺序固定为：STT raw text -> accepted correction map -> LLM polish -> output。
- 用户手动修改历史记录后，只能生成 pending suggestion。
- 只有用户确认后，才写入 `stt_corrections`。
- 纠错适合稳定短词：名字、品牌、项目名、专有词。

MUST NOT：

- 不得自动学习所有用户编辑。
- 不得把长句整句加入全局纠错。
- 不得让纠错在 disabled 时生效。

## 6. 热键合同

MUST：

- Windows 默认热键保持 `AltRight`。
- `AltRight` 必须保留低层 hook 和 fallback 注册。
- `F8` 可作为兜底热键，但不得替代用户习惯的右 Alt。
- 设置页录制快捷键时暂停热键，退出、取消、失败、手动开始录音前必须恢复热键。

MUST NOT：

- 不得因为冲突直接改掉右 Alt。
- 不得让热键录制状态把全局热键永久暂停。

## 7. 胶囊与目标窗口合同

MUST：

- 胶囊必须常驻桌面，不得自动隐藏。
- 启动时必须 show capsule，并设为 always-on-top。
- 必须维护上一个非 VoiceSlate 外部窗口。
- 输出前必须恢复录音开始前的目标窗口。
- `keyboard` 输出模式下，短文本可以模拟键盘输入；长文本或多行文本必须自动改用临时剪贴板粘贴，并在粘贴后恢复用户原剪贴板。
- `msedgewebview2.exe + VoiceSlate Capsule` 必须识别为 VoiceSlate 自身窗口。
- `Code.exe + VoiceSlate-src` 这类外部编辑器窗口不得被误判为 VoiceSlate 自身。

MUST NOT：

- 不得把胶囊窗口当成输出目标。
- 不得用窗口标题“包含 VoiceSlate”这种宽泛规则排除外部窗口。
- 不得让长文本继续依赖逐字键盘模拟；Windows 输入缓冲、输入法和焦点抖动会导致文字丢失或打到错误窗口。
- 不得删除 app detector 相关回归测试。

## 8. “speech was recorded” 合同

MUST：

- 先查 history 是否有文字。
- 如果 history 有文字，说明 STT 已成功，优先查输出阶段。
- 如果 `duration_ms` 只有 1000ms 左右，查热键停止/录音中断。
- 如果 `duration_ms` 正常但 `peak/rms/non_silent_ratio` 很低，查麦克风设备、系统音量、驱动、降噪。
- 如果 audio stats 健康但 provider error，才查请求/provider。

MUST NOT：

- 不得在没有音频统计和 timing 日志前盲目修改 provider。
- 不得把“历史有文字但当前窗口没有输入”归因到 STT。

## 9. 打包与发布合同

MUST：

- 打包前跑：

```powershell
npm run build
npm test
cargo check --manifest-path src-tauri\Cargo.toml
cargo test --manifest-path src-tauri\Cargo.toml
node --check resources\backend\server.mjs
```

- 重新编译 release exe 后，必须替换 `%LOCALAPPDATA%\VoiceSlate\voiceslate.exe`。
- 修改 backend 后，必须同步复制到 `%LOCALAPPDATA%\VoiceSlate\resources\backend`。
- 修改 local STT server 后，必须同步复制到 `%LOCALAPPDATA%\VoiceSlate\local-stt\local_stt_server.py`。
- 重新生成桌面安装包：`%USERPROFILE%\Desktop\VoiceSlate-Local-STT-Setup.exe`。
- 发布前确认安装包默认 settings 中 API Key 长度为 0。

MUST NOT：

- 不得只改源码不重打安装包。
- 不得只重打安装包不验证本机安装版。
- 不得上传含用户本地 settings、数据库、历史记录、API Key 的产物。

## 10. 最小人工验收合同

每次发布前至少人工验收：

- 右 Alt 开始/停止录音。
- 说“截图”打开系统截图工具。
- 说“我刚才说的是截图这两个字”不触发截图。
- 说“一……二……三……”输出为编号换行。
- 10 秒普通中文听写能输入当前窗口。
- 历史记录与当前窗口输出一致。
- 胶囊一直可见。
- 重启 VoiceSlate 后 `8788` 和 `8178` 自动可用。
- 桌面安装包存在且时间为最新。

## 11. 变更入口

相关文档：

- `docs/VOICE_STABILITY_AUDIT_zh.md`
- `docs/STABLE_DESKTOP_BUILD.md`

相关代码热点：

- `src-tauri/src/pipeline.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/app_detector/mod.rs`
- `src-tauri/src/llm/prompt.rs`
- `resources/backend/server.mjs`
- `scripts/local_stt_server.py`
- `scripts/launch-voiceslate-local.ps1`

任何改这些文件的任务，都必须回看本合同。
