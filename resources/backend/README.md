# VoiceSlate Local Backend

This folder contains the local-first account backend used by the desktop build.

## Stack

- [better-auth](https://github.com/better-auth/better-auth)
- [stripe](https://github.com/stripe/stripe-node)
- Node built-in `sqlite`

## What it serves

- `POST/GET /api/auth/*`
- `GET /api/auth/desktop-oauth`
- `GET /auth/callback`
- `GET /api/subscription/status`
- `POST /api/checkout/create`
- `POST /api/subscription/portal`
- `POST /api/backup/upload`
- `GET /api/backup/download`
- `POST /api/sync/snapshot`
- `GET /api/sync/snapshot`
- `GET /api/scenes`
- `POST /api/proxy/llm`
- `POST /api/proxy/stt`

## Default local address

- `http://127.0.0.1:8788`

## Production note

The desktop app can run this backend locally for single-machine registration and account state.

For a real commercial multi-device product, you should deploy the same backend to your own server and point the desktop app to your public API base URL.

Android builds should call the hosted backend for managed STT/LLM and sync. Do not bundle maintainer API keys into the APK.

Managed STT uses an OpenAI-compatible multipart transcription endpoint:

```env
CLOUD_STT_BASE_URL=https://api.openai.com/v1
CLOUD_STT_TRANSCRIPTION_PATH=/audio/transcriptions
CLOUD_STT_API_KEY=...
```

## Local smoke test

```powershell
cd C:\Users\Admin\Documents\New project\opentypeless
npm run backend:start
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8788/health
```

## Packaging note

The release packaging flow now bundles:

- `backend/server.mjs`
- `backend/node_modules`
- `tools/node-runtime/node.exe`

That lets the desktop app auto-start the local backend on another Windows machine without separately installing Node.
