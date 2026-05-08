# VoiceSlate

VoiceSlate is a local-first desktop voice input app built with Tauri and React. It captures speech, sends audio to a speech-to-text provider, optionally polishes the transcript with an LLM, and pastes the result back into the active app.

This repository is a modified open-source fork based on [OpenTypeless](https://github.com/tover0314-w/opentypeless). Attribution and license details are kept in [NOTICE](NOTICE) and [LICENSE](LICENSE).

## What This Edition Focuses On

- BYOK-first workflow for speech recognition and LLM polish
- Volcengine STT integration with fast and high-accuracy modes
- DeepSeek-friendly default polish setup
- Windows-focused hotkey, capsule, focus, and output fixes
- Local correction history
- Frontend usage stats and monthly API cost estimates

## Current Behavior

- Primary workflow: record -> transcribe -> polish -> paste back into the active app
- Default output mode: clipboard paste
- Supported local data: settings, history, dictionary, corrections, and usage stats
- Default public-safe cloud base URL: `https://example.invalid`

## Recommended Public Release Checklist

- Keep `LICENSE`
- Keep `NOTICE`
- Replace the placeholder repository URL in `src/lib/constants.ts` after publishing
- Review app icons and screenshots if you want distinct long-term branding
- Do not commit local settings, databases, logs, or API keys

## Development

```bash
npm install
npm run test
npm run build
npm run tauri build
```

## Important Notes

- Some legacy cloud/account UI remains in the codebase for compatibility, but this edition is intended to be usable without hosted services.
- `Right Alt` may still vary across Windows setups. `F8` is kept as a stable fallback hotkey.
- The public-facing docs for this fork are this README, [README_LOCAL_RELEASE.md](README_LOCAL_RELEASE.md), and [docs/HANDOFF_LOCAL_EDITION_zh.md](docs/HANDOFF_LOCAL_EDITION_zh.md).

## License

MIT. See [LICENSE](LICENSE).
