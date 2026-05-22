# VoiceSlate Stable Desktop Build Notes

Last updated: 2026-05-21

## Stability Contract

Before changing VoiceSlate speech recognition, hotkeys, capsule behavior,
output routing, packaging, or GitHub releases, read and follow:

- `docs/VOICE_RUNTIME_CONTRACT_zh.md`
- `docs/VOICE_STABILITY_AUDIT_zh.md`

The contract is the source of truth for the current stable runtime:
`AltRight / toggle / keyboard / cloud-opus`.

## Default STT Routing

The stable desktop build uses `cloud-opus` as the default dictation provider.
Short voice commands still use the local `tiny` Whisper model through the
local command route.

The launcher must not silently switch normal dictation back to
`local-whisper` when the full local model is unavailable. If settings are
missing or invalid, the launcher falls back to `cloud-opus`.

## Short Commands

These phrases are handled as explicit short commands only when the utterance is
short and command-like:

- `截图`
- `翻译`
- `提问`
- `提示词`

Long dictation that merely contains these words should remain normal dictation.

## STT Corrections

Corrections are explicit and user-confirmed:

1. The user edits a history entry to the correct text.
2. VoiceSlate records a pending correction suggestion.
3. The user can accept or ignore that suggestion in Speech Recognition settings.
4. Accepted suggestions are saved into `stt_corrections`.

Correction order:

1. STT raw text
2. accepted correction map
3. LLM polish
4. output

Do not auto-learn all edits. Corrections should be reserved for stable repeated
terms such as names, product names, and domain-specific phrases.

## Runtime Components

Source-controlled pieces:

- Tauri desktop app source
- launcher scripts
- local STT server source
- local backend source
- self-extracting installer builder

Not source-controlled:

- packaged `voiceslate.exe`
- Python virtual environment
- Whisper model files
- bundled Node runtime
- local settings and user API keys
- generated desktop installer EXE

The generated installer is built from the current local runtime using:

```powershell
.\installer\build-voiceslate-local-installer.ps1
```

## Verification Checklist

- `npm test -- --run`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- local backend health: `http://127.0.0.1:8788/health`
- local command STT health: `http://127.0.0.1:8178/health` is optional and must not block `cloud-opus`
- provider registry returns `default_provider=cloud-opus`
- a 10+ second sample succeeds through `cloud-opus`
- release app writes `%APPDATA%\com.voiceslate.app\logs\voiceslate.log.YYYY-MM-DD`
