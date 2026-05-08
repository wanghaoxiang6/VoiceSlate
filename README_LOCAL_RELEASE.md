# VoiceSlate Public Release Notes

This repository is a modified, local-first edition published under the working name `VoiceSlate`.

## Attribution

VoiceSlate is based on the original OpenTypeless project:

- Upstream repository: https://github.com/tover0314-w/opentypeless
- Upstream license: MIT

The original license is retained in this repository as required by the MIT License.

## What Changed In This Fork

- Defaults to BYOK instead of hosted Pro flows
- Adds Volcengine STT providers
- Adds local correction history
- Adds local usage stats and API cost estimates
- Adds Windows-specific hotkey, capsule, focus, and output fixes

## Before Publishing Your Own GitHub Repo

- Keep `LICENSE`
- Keep `NOTICE`
- Update repository/homepage links after creating your new GitHub repository
- Prefer your own project name, icon, screenshots, and release notes
- Double-check that no local config, database, or log files are staged

## Sensitive Data

Do not commit:

- local app settings
- local databases
- API keys
- exported logs containing credentials

Typical runtime data lives outside the repository under application data folders.
