# Voice Profile Slot 合同

## 目标

Voice Profile Slot 是 VoiceSlate 的旁路采集插槽，用来把稳定听写流程中产生的高质量语音样本交给独立声纹库项目处理。

它只负责投递任务，不负责声纹建模、情绪识别或声音克隆。

## 当前状态

- 默认关闭：`voice_profile_enabled=false`。
- 默认不启动任何新服务。
- 默认不保存任何录音副本。
- 默认不影响 `cloud-opus`、右 Alt 热键、截图命令、LLM 润色和输出。

## 运行边界

MUST：

- 只能在一次听写已经完成 STT、润色、输出和历史保存后，异步投递声纹样本任务。
- 只能把任务写入本地 inbox 目录。
- 任务必须包含音频副本、raw/final transcript、provider、目标 app、质量分数。
- 声纹向量和情绪识别只能标记为 `pending`，由独立项目后续处理。
- 短命令如“截图”不得进入声纹样本库。
- 空文本、STT 失败、过短、过静音、爆音或低质量音频不得进入 accepted 样本。

MUST NOT：

- 不得阻塞 VoiceSlate 当前 STT/LLM/输出链路。
- 不得在 VoiceSlate 主进程里加载 SpeechBrain、emotion2vec、pyannote、OpenVoice、XTTS 等模型。
- 不得在默认配置下写入音频。
- 不得上传音频。
- 不得因为声纹库失败而显示 VoiceSlate 录入失败。
- 不得改变当前稳定默认：`AltRight / toggle / keyboard / cloud-opus -> volcengine-flash`。

## Inbox 协议

启用后默认写入：

```text
%APPDATA%\com.voiceslate.app\voice-profile-slot\inbox\
  <uuid>.wav
  <uuid>.json
```

任务 JSON 包含：

- `source=voiceslate`
- `audio_path`
- `transcript`
- `raw_text`
- `duration_seconds`
- `quality`
- `stt_provider`
- `llm_provider`
- `app_name`
- `app_type`
- `speaker_embedding.status=pending`
- `emotion.status=pending`

## 接入策略

独立声纹库项目只能监听 inbox 或手动导入 inbox，不允许反向调用 VoiceSlate 主流程。

未来 UI 可以增加一个高级设置开关，但默认仍必须关闭。
