# VoiceSlate 稳定性审计与防复发清单

更新日期：2026-05-21

正式约束见：`docs/VOICE_RUNTIME_CONTRACT_zh.md`。后续改语音识别、热键、胶囊、截图、纠错、润色、输出、打包和发布，都必须先按合同检查。

## 为什么会反复出新问题

这不是单个 API 错误，而是一条桌面语音输入链路：

热键/胶囊 -> 录音采集 -> 音频质量 -> STT provider -> 纠错 -> LLM 润色 -> 目标窗口聚焦 -> 键盘/剪贴板输出 -> 历史记录。

之前修一个点后又出现新问题，主要原因有四类：

1. 链路太长，一个成功的历史记录只证明 STT 成功，不代表已经输出到当前窗口。
2. 同时有多个运行时：GitHub 版本、桌面安装包、本地安装目录、打包资源和用户设置可能不同步。
3. Windows 前台窗口和全局热键本身不稳定，尤其是 Tauri 胶囊窗口、右 Alt、WebView 进程和被关闭的启动项。
4. 之前缺少分层日志和固定回归测试，导致每次只能从现象重新推断。

## 已处理并加固的问题

### 1. API/云端连接问题

现象：API 测试或真实识别出现 OpenSpeech handshake、EOF、超时。

已处理：

- 默认长听写走 `cloud-opus` 统一入口。
- 本地 backend `8788` 作为唯一 STT 入口，前端/Rust 不再散落 provider 请求格式。
- backend 增加直连失败缓存、curl fallback、DNS/IP fallback，避免每次都卡长超时。
- provider registry 保留 `local-whisper`、火山、OpenAI、Groq、GLM、SiliconFlow 等 provider，便于切换和对比。

防复发验证：

- `http://127.0.0.1:8788/health` 必须成功。
- `GET /api/stt/providers` 默认 provider 必须是 `cloud-opus`。
- `stt-platform-timing.jsonl` 必须记录 request_id、provider、upstream、latency、codec、ok/error。

### 2. “speech was recorded” 但无文字

现象：录音结束，历史可能有记录，UI 或当前窗口无输出。

已处理：

- 增加真实音频统计：duration、peak、rms、non_silent_ratio。
- 区分 `音频无效`、`接口失败`、`输出失败`，不再全部按 API 问题处理。
- 修复低音量自动增益、双声道人声抵消、麦克风设备漂移等问题。
- 短命令和普通听写分流，短命令不再走长听写润色判断。

防复发验证：

- 如果 `duration_ms` 正常且 STT timing `ok=true`，就不要再查麦克风/API，优先查输出窗口和热键状态。
- 如果 `duration_ms` 很短，查热键停止链路。
- 如果 `peak/rms/non_silent_ratio` 很低，查麦克风设备、降噪、驱动和系统输入音量。

### 3. Transcribing 时间过长

现象：短句或长句一直显示 Transcribing。

已处理：

- 长听写走云端强 STT，短命令先走本地 tiny 命令识别。
- 记录 `command_precheck_ms / encode_ms / upstream_ms / parse_ms / polish_ms / total_ms`。
- LLM 代理的坏 DNS/直连等待时间缩短。
- 极短普通文本增加 LLM polish bypass，避免一两个字也等大模型。

防复发验证：

- 10 秒口述 STT 目标 P95 小于 3.5 秒。
- 30 秒口述 STT 目标 P95 小于 7 秒。
- 如果 STT 快但总时间慢，查 LLM polish 和输出阶段，不再盲目改 STT。

### 4. 识别准确率和错词纠正

现象：专有名词、人名、固定短语反复识别错。

已处理：

- 增加显式 `stt_corrections`，顺序是：raw STT -> correction map -> LLM polish -> 输出。
- 用户在历史里手动改过的文本会生成 pending suggestion。
- 只有用户确认添加后才进入 correction map，不做无条件自动学习，避免越学越错。

防复发验证：

- 高频固定词可以加入纠错。
- 普通句子不要加入纠错，避免全局替换误伤。
- 已有 Rust 测试覆盖纠错顺序和开关行为。

### 5. 短语音命令误触发/不触发

现象：说“截图”不截图，或长句里包含“截图/prompt”误触发命令。

已处理：

- `截图 / 翻译 / 提问 / 提示词` 从普通听写拆出短命令路由。
- 只有短、命令式、意图明确时才触发。
- 长句包含这些词时仍按普通听写处理。
- `截图` 已在 Rust pipeline 中作为 quick action 拦截，识别为短命令后直接打开系统截图工具，不再进入普通文本输出或 LLM 润色。

防复发验证：

- “截图”应该触发截图。
- “我刚才说的是截图这两个字”不应该触发截图。
- 回归测试覆盖 `截图` / `screenshot` 会触发，长句包含截图词不会触发。

### 5.1 编号口述换行

现象：说“一……二……三……”时，输出仍在同一段，没有按编号换行。

已处理：

- Rust LLM prompt 明确把 `一...二...三...四...`、`第一/第二`、`一是/二是`、`首先/然后/最后` 都视为枚举。
- backend compact polish prompt 也加入同一规则，避免代理压缩 prompt 后丢掉编号换行要求。
- 增加示例：`一先检查云端连接二确认热键有没有响应三再看当前窗口有没有输入` 应输出为每项一行的编号列表。

防复发验证：

- Rust prompt 测试覆盖 bare Chinese counters 和编号示例。
- 后续如果再优化 prompt，必须保留“每个编号项单独一行”的硬规则。

### 6. 右 Alt 热键失效

现象：必须手动点胶囊才能录音，右 Alt 没反应。

已处理：

- 保留用户习惯的 `AltRight`。
- 增加 Windows 低层右 Alt hook 和 fallback 注册。
- 修复设置页进入快捷键录制后，未正常确认/取消导致热键永久暂停的问题。
- 手动点胶囊开始录音前，如果发现热键暂停，会自动恢复。

防复发验证：

- 配置必须保持 `hotkey=AltRight`、`hotkey_mode=toggle`。
- 改快捷键设置时退出设置页后，右 Alt 必须仍可用。

### 7. 历史记录有文字，但当前窗口没有输入

现象：识别成功并进入历史，但没有打进当前窗口。

已处理：

- 输出前恢复录音开始前的目标窗口。
- 维护上一个非 VoiceSlate 外部窗口缓存。
- 修复 Tauri 胶囊可能以 `msedgewebview2.exe` 出现，导致被当成目标窗口的问题。
- 新增回归测试：`msedgewebview2.exe + VoiceSlate Capsule` 必须识别为自身窗口；Code/Chrome 等外部窗口不能误判为自身。

防复发验证：

- 如果历史有文字但当前窗口没有输入，优先查 `Restoring target window before output` 日志。
- 如果目标 app 是 VoiceSlate/VoiceSlate Capsule，说明窗口检测回归。

### 8. 胶囊消失或找不到

现象：桌面小胶囊偶尔不见。

已处理：

- 默认关闭 `capsule_auto_hide`。
- 启动时强制 show 胶囊。
- 增加 3 秒可见性守护：如果胶囊不可见，自动 show 并保持 always-on-top。
- 单实例激活时也会重新显示胶囊。

防复发验证：

- 设置里不再保留“空闲时隐藏胶囊”的普通入口。
- 胶囊窗口必须常驻桌面。

### 9. 安装包/运行时漂移

现象：桌面快捷方式、GitHub 下载、本地安装目录不是同一版。

已处理：

- 桌面安装包重新生成。
- 本机安装版 exe 与 release 构建 exe hash 一致。
- 安装包默认配置会清空 STT/LLM API Key，避免泄露私钥。
- 旧的安装目录备份 exe 已清理。

防复发验证：

- 安装目录只保留一个 `voiceslate.exe`。
- 桌面只保留正确的 `VoiceSlate.lnk` 和当前 `VoiceSlate-Local-STT-Setup.exe`。
- 上传 GitHub 前必须重新核对安装包内默认 settings：API Key 长度为 0。

## 当前必须保持的运行时基线

- App：`C:\Users\wangh\AppData\Local\VoiceSlate\voiceslate.exe`
- Launcher：`C:\Users\wangh\AppData\Local\VoiceSlate\launch-voiceslate-local.vbs`
- Settings：`C:\Users\wangh\AppData\Roaming\com.voiceslate.app\settings.json`
- STT provider：`cloud-opus`
- Hotkey：`AltRight`
- Hotkey mode：`toggle`
- Output mode：`keyboard`
- Backend health：`http://127.0.0.1:8788/health`
- Local command STT health：`http://127.0.0.1:8178/health`

## 以后遇到问题的固定排查顺序

1. 确认运行版本：进程路径、exe hash、桌面快捷方式目标、安装包时间。
2. 确认配置：provider、hotkey、output_mode、API Key 是否存在但不打印内容。
3. 看历史记录：有文字说明 STT 成功，问题在输出或目标窗口。
4. 看 STT timing：ok/error、audio_seconds、latency、command_precheck_ms。
5. 看音频统计：duration、peak、rms、non_silent_ratio。
6. 看目标窗口日志：输出前是否恢复到正确 app。
7. 看 LLM timing：慢在 STT 还是 polish。
8. 最后才改代码；每次只改一个层，改完补测试或日志。

## 未来仍可能发生的风险和预防

### Windows/第三方软件风险

- 输入法、管理员权限窗口、远程桌面、游戏/安全软件可能拦截模拟键盘输入。
- 某些窗口不接受普通 SendInput。

预防：保留 clipboard 输出模式作为备用；输出失败时应显示明确错误，而不是只显示 recorded。

### 系统音频风险

- Windows 默认麦克风变化。
- 蓝牙耳机切换 profile。
- 驱动降噪导致长句后半段被压低。

预防：保留麦克风设备选择和健康检查；日志必须继续记录音频统计。

### 云端 provider 风险

- 火山/OpenAI/Groq 等 provider 限流、DNS 波动、模型返回空文本。

预防：provider registry 保留多 provider；replay benchmark 可用同一段音频对比，不要只凭一次体验换默认 provider。

### 纠错误伤风险

- 把普通句子加入纠错会造成全局替换错误。

预防：只把稳定短词、名字、品牌、项目名加入纠错；长句不进入 correction map。

### 打包漂移风险

- 源码已修但安装包没重打。
- 安装包重打了但 GitHub release 仍是旧版。

预防：发布前必须执行 release checklist，不允许只复制单个文件。

## 发布前回归清单

```powershell
npm run build
npm test
cargo check --manifest-path src-tauri\Cargo.toml
cargo test --manifest-path src-tauri\Cargo.toml
```

运行时检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8788/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8178/health
```

人工验收：

- 右 Alt 开始/停止录音。
- 说“截图”触发截图。
- 说“我刚才说的是截图这两个字”不触发截图。
- 10 秒普通中文输入进当前窗口。
- 历史记录、当前窗口输出一致。
- 胶囊一直可见。
- 重启电脑后后端和本地命令 STT 自动可用。
- 安装包默认 settings 不包含任何私钥。
