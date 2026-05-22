import { appendFileSync, mkdirSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { bearer } from "better-auth/plugins";
import { toNodeHandler } from "better-auth/node";
import Stripe from "stripe";

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const projectRoot = resolve(__dirname, "..");
const backendDataDir = resolve(
  process.env.VOICE_SLATE_BACKEND_DATA_DIR || join(projectRoot, "backend-data"),
);
mkdirSync(backendDataDir, { recursive: true });

const dbPath = resolve(
  process.env.VOICE_SLATE_BACKEND_DB_PATH || join(backendDataDir, "voiceslate-cloud.db"),
);
const secretPath = resolve(
  process.env.VOICE_SLATE_BACKEND_SECRET_PATH || join(backendDataDir, "better-auth-secret.txt"),
);
const host = process.env.VOICE_SLATE_BACKEND_HOST || "127.0.0.1";
const port = Number(process.env.VOICE_SLATE_BACKEND_PORT || "8788");
const baseUrl =
  process.env.VOICE_SLATE_BACKEND_URL || `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;

const FREE_PLAN = {
  sttSecondsLimit: 30 * 60,
  llmTokensLimit: 200_000,
};

const PRO_PLAN = {
  sttSecondsLimit: 10 * 60 * 60,
  llmTokensLimit: 2_000_000,
};

const SCENE_PACKS = [
  {
    id: "codex-engineer",
    name: "Codex Engineer",
    description: "Turn rough requirements into a code-first prompt for Codex.",
    category: "prompt",
    promptTemplate:
      "You are Codex. Rewrite the user's rough request into a concrete engineering task with constraints, validation steps, and expected output format.",
    dictionaryTerms: [
      { word: "refactor" },
      { word: "regression" },
      { word: "acceptance criteria" },
    ],
    isPro: false,
  },
  {
    id: "pm-brief",
    name: "PM Brief",
    description: "Organize a spoken idea into product goals, user value, and risks.",
    category: "prompt",
    promptTemplate:
      "Rewrite the user's rough product request into a PM-ready brief with goals, scope, edge cases, and rollout notes.",
    dictionaryTerms: [
      { word: "scope" },
      { word: "rollout" },
      { word: "success metric" },
    ],
    isPro: true,
  },
];

const VOLCENGINE_FLASH_ENDPOINT =
  "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
const VOLCENGINE_FLASH_RESOURCE_ID = "volc.bigasr.auc_turbo";
const VOLCENGINE_STANDARD_SUBMIT_ENDPOINT =
  "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit";
const VOLCENGINE_STANDARD_QUERY_ENDPOINT =
  "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query";
const VOLCENGINE_STANDARD_RESOURCE_ID = "volc.seedasr.auc";
const LOCAL_CLOUD_PROXY_URL = process.env.CLOUD_STT_HTTP_PROXY || process.env.HTTPS_PROXY || "http://127.0.0.1:7890";
const PINNED_DNS_CACHE_MS = 10 * 60 * 1000;
const pinnedDnsUntilByHost = new Map();

function appDataDir() {
  return (
    process.env.APPDATA ||
    (process.env.USERPROFILE ? join(process.env.USERPROFILE, "AppData", "Roaming") : "")
  );
}

function loadLocalDesktopConfig() {
  const candidates = [
    process.env.VOICE_SLATE_SETTINGS_PATH,
    appDataDir() ? join(appDataDir(), "com.voiceslate.app", "settings.json") : "",
    appDataDir() ? join(appDataDir(), "com.opentypeless.app", "settings.json") : "",
  ].filter(Boolean);

  for (const settingsPath of candidates) {
    try {
      if (!existsSync(settingsPath)) continue;
      const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
      if (parsed?.app_config) return parsed.app_config;
    } catch {
      // Ignore malformed legacy settings and continue to the next candidate.
    }
  }
  return {};
}

function loadManagedLlmSidecarConfig() {
  const candidates = [
    process.env.VOICE_SLATE_MANAGED_LLM_SETTINGS_PATH,
    appDataDir() ? join(appDataDir(), "com.voiceslate.app", "settings.json.managed-llm.json") : "",
    appDataDir() ? join(appDataDir(), "com.opentypeless.app", "settings.json.managed-llm.json") : "",
  ].filter(Boolean);

  for (const settingsPath of candidates) {
    try {
      if (!existsSync(settingsPath)) continue;
      return JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      // Ignore malformed sidecar settings.
    }
  }
  return {};
}

function isLocalBackendBaseUrl(value) {
  try {
    const parsed = new URL(value);
    return (
      ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) &&
      String(parsed.port || (parsed.protocol === "https:" ? "443" : "80")) === String(port)
    );
  } catch {
    return false;
  }
}

function defaultLlmBaseUrl(provider) {
  switch (String(provider || "").trim().toLowerCase()) {
    case "deepseek":
      return "https://api.deepseek.com/v1";
    case "openai":
      return "https://api.openai.com/v1";
    case "glm":
      return "https://open.bigmodel.cn/api/paas/v4";
    case "siliconflow":
      return "https://api.siliconflow.cn/v1";
    case "moonshot":
      return "https://api.moonshot.cn/v1";
    default:
      return "";
  }
}

function getManagedLlmConfig() {
  const local = loadLocalDesktopConfig();
  const sidecar = loadManagedLlmSidecarConfig();
  const localBase = local.llm_base_url?.trim() || "";
  const sidecarBase = sidecar.base_url?.trim() || "";
  const providerDefault = defaultLlmBaseUrl(local.llm_provider);
  return {
    apiKey:
      process.env.CLOUD_LLM_API_KEY?.trim() ||
      sidecar.api_key?.trim() ||
      local.llm_api_key?.trim() ||
      "",
    baseUrl:
      process.env.CLOUD_LLM_BASE_URL?.trim() ||
      sidecarBase ||
      (isLocalBackendBaseUrl(localBase) ? "" : localBase) ||
      providerDefault,
    model: process.env.CLOUD_LLM_MODEL?.trim() || sidecar.model?.trim() || local.llm_model?.trim() || "",
  };
}

function getManagedSttConfig() {
  const local = loadLocalDesktopConfig();
  return {
    provider: process.env.CLOUD_STT_PROVIDER?.trim() || local.stt_provider?.trim() || "",
    apiKey: process.env.CLOUD_STT_API_KEY?.trim() || local.stt_api_key?.trim() || "",
    baseUrl: process.env.CLOUD_STT_BASE_URL?.trim() || "",
    path: process.env.CLOUD_STT_TRANSCRIPTION_PATH?.trim() || "/audio/transcriptions",
  };
}

const STT_TIMING_LOG = resolve(backendDataDir, "stt-platform-timing.jsonl");

const DEFAULT_STT_PROVIDER_REGISTRY = {
  "local-command": {
    label: "Local command",
    type: "whisper",
    endpoint: "http://127.0.0.1:8178/v1/audio/transcriptions",
    model: "base",
    auth: "none",
    codec: "wav",
  },
  "local-whisper": {
    label: "Local Whisper",
    type: "whisper",
    endpoint: "http://127.0.0.1:8178/v1/audio/transcriptions",
    model: "base",
    auth: "none",
    codec: "wav",
  },
  "volcengine-flash": { label: "Volcengine Flash", type: "volcengine-flash", codec: "wav" },
  "volcengine-standard": {
    label: "Volcengine Standard",
    type: "volcengine-standard",
    codec: "wav",
  },
  "openai-whisper": {
    label: "OpenAI Whisper",
    type: "whisper",
    endpoint: "https://api.openai.com/v1/audio/transcriptions",
    model: "whisper-1",
    auth: "bearer",
    codec: "wav",
  },
  "groq-whisper": {
    label: "Groq Whisper",
    type: "whisper",
    endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
    model: "whisper-large-v3-turbo",
    auth: "bearer",
    codec: "wav",
  },
  "glm-asr": {
    label: "GLM-ASR",
    type: "whisper",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/audio/transcriptions",
    model: "glm-asr-2512",
    auth: "bearer",
    codec: "wav",
    extraFields: { stream: "false" },
  },
  siliconflow: {
    label: "SiliconFlow",
    type: "whisper",
    endpoint: "https://api.siliconflow.cn/v1/audio/transcriptions",
    model: "FunAudioLLM/SenseVoiceSmall",
    auth: "bearer",
    codec: "wav",
  },
};

function normalizeProviderId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function envKeyForProvider(providerId) {
  return providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function loadSttProviderRegistry() {
  const registry = { ...DEFAULT_STT_PROVIDER_REGISTRY };
  const raw = process.env.STT_PROVIDER_REGISTRY?.trim();
  if (raw) {
    try {
      Object.assign(registry, JSON.parse(raw));
    } catch (error) {
      console.warn("[stt-platform] Ignoring invalid STT_PROVIDER_REGISTRY:", error?.message || error);
    }
  }
  return registry;
}

function resolveRequestedSttProvider(url, formFields = {}) {
  const managed = getManagedSttConfig();
  const queryProvider = normalizeProviderId(url.searchParams.get("provider"));
  const formProvider = normalizeProviderId(formFields.provider);
  const envDefault = normalizeProviderId(process.env.STT_DEFAULT_PROVIDER);
  const managedProvider = normalizeProviderId(managed.provider);
  return queryProvider || formProvider || envDefault || managedProvider || "cloud-opus";
}

function resolveSttProvider(providerId, formFields = {}) {
  const registry = loadSttProviderRegistry();
  const managed = getManagedSttConfig();
  const local = loadLocalDesktopConfig();
  const normalized = normalizeProviderId(providerId || managed.provider || "cloud-opus");

  if (normalized === "cloud-opus") {
    const upstream =
      normalizeProviderId(formFields.upstream_provider) ||
      normalizeProviderId(process.env.CLOUD_STT_UPSTREAM_PROVIDER) ||
      normalizeProviderId(process.env.STT_CLOUD_UPSTREAM_PROVIDER) ||
      normalizeProviderId(process.env.CLOUD_STT_PROVIDER) ||
      "volcengine-flash";
    const resolved = resolveSttProvider(upstream === "cloud-opus" ? "volcengine-flash" : upstream, formFields);
    return {
      ...resolved,
      id: "cloud-opus",
      upstreamId: resolved.upstreamId || resolved.id,
      label: `Cloud Opus -> ${resolved.label || resolved.id}`,
      requestedCodec: "ogg_opus",
    };
  }

  const envBase = process.env.CLOUD_STT_BASE_URL?.trim();
  const envPath = process.env.CLOUD_STT_TRANSCRIPTION_PATH?.trim() || "/audio/transcriptions";
  if (envBase && normalizeProviderId(process.env.CLOUD_STT_PROVIDER) === normalized) {
    return {
      id: normalized,
      upstreamId: normalized,
      label: registry[normalized]?.label || normalized,
      type: "whisper",
      endpoint: `${envBase.replace(/\/$/, "")}${envPath}`,
      model: formFields.model || registry[normalized]?.model || "base",
      auth: normalized.startsWith("local-") || envBase.includes("127.0.0.1") ? "none" : "bearer",
      apiKey: process.env.CLOUD_STT_API_KEY?.trim() || local.stt_api_key?.trim() || "",
      codec: "wav",
      extraFields: registry[normalized]?.extraFields || {},
    };
  }

  const base = registry[normalized] || registry["local-whisper"];
  const providerKey = envKeyForProvider(normalized);
  return {
    id: normalized,
    upstreamId: normalized,
    ...base,
    model: formFields.model || base.model || "base",
    apiKey:
      process.env[`STT_${providerKey}_API_KEY`]?.trim() ||
      process.env.CLOUD_STT_API_KEY?.trim() ||
      local.stt_api_key?.trim() ||
      "",
    extraFields: base.extraFields || {},
  };
}

async function readMultipartPayload(req, raw) {
  const contentType = req.headers["content-type"];
  if (!contentType?.includes("multipart/form-data")) {
    return { audio: raw, fields: {}, filename: "audio.wav", mimeType: "audio/wav" };
  }

  const request = new Request("http://voiceslate.local/upload", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: raw,
  });
  const form = await request.formData();
  const fields = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") fields[key] = value;
  }
  const file = form.get("audio") || form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("No audio file found in multipart request");
  }
  return {
    audio: Buffer.from(await file.arrayBuffer()),
    fields,
    filename: file.name || "audio.wav",
    mimeType: file.type || "audio/wav",
  };
}

function wavDurationSeconds(audio) {
  if (!Buffer.isBuffer(audio) || audio.length < 44 || audio.subarray(0, 4).toString() !== "RIFF") {
    return null;
  }
  try {
    let channels = 0;
    let sampleRate = 0;
    let bitsPerSample = 0;
    let dataBytes = 0;
    let chunkOffset = 12;
    while (chunkOffset + 8 <= audio.length) {
      const chunkId = audio.subarray(chunkOffset, chunkOffset + 4).toString();
      const chunkSize = audio.readUInt32LE(chunkOffset + 4);
      const payloadOffset = chunkOffset + 8;
      if (chunkId === "fmt " && chunkSize >= 16 && payloadOffset + chunkSize <= audio.length) {
        channels = audio.readUInt16LE(payloadOffset + 2) || channels;
        sampleRate = audio.readUInt32LE(payloadOffset + 4) || sampleRate;
        bitsPerSample = audio.readUInt16LE(payloadOffset + 14) || bitsPerSample;
      }
      if (chunkId === "data") {
        dataBytes = chunkSize;
        break;
      }
      chunkOffset += 8 + chunkSize + (chunkSize % 2);
    }
    if (dataBytes && sampleRate && channels && bitsPerSample) {
      return Number((dataBytes / (sampleRate * channels * (bitsPerSample / 8))).toFixed(3));
    }
  } catch {
    return null;
  }
  return null;
}

function appendSttTiming(entry) {
  try {
    appendFileSync(STT_TIMING_LOG, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
  } catch {
    // Timing logs must never break transcription.
  }
}

function makeUnifiedSttResponse({ text, provider, requestId, audioSeconds, codec, latencyMs, error }) {
  return {
    text: text || "",
    provider,
    request_id: requestId,
    audio_seconds: audioSeconds,
    codec,
    latency_ms: latencyMs,
    error: error || null,
  };
}

function estimateSttCost(providerId, audioSeconds) {
  if (!audioSeconds || audioSeconds <= 0) return 0;
  if (providerId.startsWith("local")) return 0;
  return Number(((audioSeconds / 60) * 0.006).toFixed(6));
}

function buildWhisperForm({ audio, filename, mimeType, provider, fields, codec }) {
  const form = new FormData();
  const finalMime = codec === "ogg_opus" ? "audio/ogg" : mimeType || "audio/wav";
  const finalName = codec === "ogg_opus" ? filename.replace(/\.[^.]+$/, ".ogg") : filename || "audio.wav";
  form.set("file", new Blob([audio], { type: finalMime }), finalName);
  form.set("model", provider.model || fields.model || "base");
  if (fields.language && fields.language !== "multi") form.set("language", fields.language);
  for (const [key, value] of Object.entries(provider.extraFields || {})) {
    form.set(key, value);
  }
  return form;
}

function findLocalSttPython() {
  const candidates = [
    process.env.LOCAL_STT_PYTHON,
    process.env.PYTHON,
    resolve(__dirname, "..", "..", "local-stt", "venv", "Scripts", "python.exe"),
    resolve(projectRoot, "..", "local-stt", "venv", "Scripts", "python.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function removeTempFile(path) {
  try {
    if (path && existsSync(path)) unlinkSync(path);
  } catch {
    // Best effort cleanup only.
  }
}

async function encodeWavToOggOpus(audio) {
  const python = findLocalSttPython();
  const script = resolve(__dirname, "encode_opus.py");
  if (!python || !existsSync(script)) {
    return { audio, codec: "wav", encoded: false, note: "opus_encoder_unavailable" };
  }

  const stem = `stt-opus-${crypto.randomUUID()}`;
  const wavPath = resolve(backendDataDir, `${stem}.wav`);
  const oggPath = resolve(backendDataDir, `${stem}.ogg`);
  try {
    writeFileSync(wavPath, audio);
    await execFileAsync(python, [script, wavPath, oggPath], {
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    const encoded = readFileSync(oggPath);
    if (!encoded.length) throw new Error("Opus encoder produced an empty file");
    return { audio: encoded, codec: "ogg_opus", encoded: true };
  } catch (error) {
    console.warn("[stt-platform] Opus encode failed, falling back to WAV:", error?.message || error);
    return { audio, codec: "wav", encoded: false, note: "opus_encode_failed" };
  } finally {
    removeTempFile(wavPath);
    removeTempFile(oggPath);
  }
}

async function encodeAudioForProvider(audio, provider) {
  if (provider.requestedCodec !== "ogg_opus") {
    return { audio, codec: "wav", encoded: false };
  }
  return encodeWavToOggOpus(audio);
}

async function transcribeWhisperLike(provider, payload) {
  if (provider.auth !== "none" && !provider.apiKey) {
    throw new Error(`${provider.id} API key is not configured`);
  }
  const encodeStartedAt = performance.now();
  const encoded = await encodeAudioForProvider(payload.audio, provider);
  const encodeMs = Math.round(performance.now() - encodeStartedAt);
  const form = buildWhisperForm({
    audio: encoded.audio,
    filename: payload.filename,
    mimeType: payload.mimeType,
    provider,
    fields: payload.fields,
    codec: encoded.codec,
  });
  const headers = {};
  if (provider.auth !== "none") headers.Authorization = `Bearer ${provider.apiKey}`;
  const upstreamStartedAt = performance.now();
  const upstream = await fetch(provider.endpoint, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const upstreamMs = Math.round(performance.now() - upstreamStartedAt);
  const parseStartedAt = performance.now();
  const bodyText = await upstream.text();
  const data = JSON.parse(bodyText || "{}");
  const parseMs = Math.round(performance.now() - parseStartedAt);
  if (!upstream.ok) {
    const preview = bodyText.slice(0, 300).replace(/\s+/g, " ").trim();
    throw new Error(`${provider.id} failed (${upstream.status}): ${data?.error?.message || preview}`);
  }
  return {
    text: data.text || data.result?.text || "",
    codec: encoded.codec,
    timings: { encode_ms: encodeMs, upstream_ms: upstreamMs, parse_ms: parseMs },
  };
}

async function transcribeWithProvider(provider, payload) {
  let commandPrecheckMs = 0;
  if (
    process.env.STT_ENABLE_LOCAL_COMMAND_PRECHECK === "1" &&
    provider.id === "cloud-opus" &&
    payload.audioSeconds &&
    payload.audioSeconds <= 2.2
  ) {
    const commandStartedAt = performance.now();
    try {
      const commandProvider = resolveSttProvider("local-command", payload.fields);
      const commandResult = await transcribeWhisperLike(commandProvider, payload);
      commandPrecheckMs = Math.round(performance.now() - commandStartedAt);
      if (["screenshot", "translate", "ask", "prompt"].includes(commandResult.text.trim())) {
        return {
          text: commandResult.text.trim(),
          codec: commandResult.codec || "wav",
          timings: {
            command_precheck_ms: commandPrecheckMs,
            encode_ms: 0,
            upstream_ms: 0,
            parse_ms: 0,
          },
        };
      }
      console.log(
        `[stt-platform] local command precheck missed text="${commandResult.text.trim()}" latency_ms=${commandPrecheckMs}`,
      );
    } catch (error) {
      commandPrecheckMs = Math.round(performance.now() - commandStartedAt);
      console.warn("[stt-platform] local command precheck failed:", error?.message || error);
    }
  }

  if (provider.type === "volcengine-flash") {
    if (!provider.apiKey) throw new Error("volcengine-flash API key is not configured");
    const upstreamStartedAt = performance.now();
    const text = await transcribeWithVolcengineFlash(provider.apiKey, payload.audio);
    return {
      text,
      codec: "wav",
      timings: {
        command_precheck_ms: commandPrecheckMs,
        encode_ms: 0,
        upstream_ms: Math.round(performance.now() - upstreamStartedAt),
        parse_ms: 0,
      },
    };
  }
  if (provider.type === "volcengine-standard") {
    if (!provider.apiKey) throw new Error("volcengine-standard API key is not configured");
    const upstreamStartedAt = performance.now();
    const text = await transcribeWithVolcengineStandard(provider.apiKey, payload.audio);
    return {
      text,
      codec: "wav",
      timings: {
        command_precheck_ms: commandPrecheckMs,
        encode_ms: 0,
        upstream_ms: Math.round(performance.now() - upstreamStartedAt),
        parse_ms: 0,
      },
    };
  }
  const result = await transcribeWhisperLike(provider, payload);
  return {
    ...result,
    timings: {
      command_precheck_ms: commandPrecheckMs,
      ...(result.timings || {}),
    },
  };
}

async function readMultipartAudio(req, raw) {
  const contentType = req.headers["content-type"];
  if (!contentType?.includes("multipart/form-data")) {
    return raw;
  }

  const request = new Request("http://voiceslate.local/upload", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: raw,
  });
  const form = await request.formData();
  const file = form.get("audio") || form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("No audio file found in multipart request");
  }
  return Buffer.from(await file.arrayBuffer());
}

function extractVolcengineText(value) {
  const direct = value?.result?.text;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const utterances = value?.result?.utterances;
  if (!Array.isArray(utterances)) return "";
  return utterances
    .map((item) => (typeof item?.text === "string" ? item.text.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
}

function volcengineAuthHeaders(apiKey) {
  const trimmed = String(apiKey || "").trim();
  if (!trimmed) {
    throw new Error("Volcengine ASR key is empty");
  }

  const separator = trimmed.includes(":") ? ":" : trimmed.includes("|") ? "|" : "";
  if (!separator) {
    return { "X-Api-Key": trimmed };
  }

  const [appKey, accessKey] = trimmed.split(separator, 2).map((part) => part.trim());
  if (!appKey || !accessKey) {
    throw new Error("Volcengine ASR old-console credentials must be app_key:access_key");
  }
  return {
    "X-Api-App-Key": appKey,
    "X-Api-Access-Key": accessKey,
  };
}

function errorSummary(error) {
  return error?.cause?.code || error?.code || error?.message || String(error);
}

function parseCurlHeaders(rawHeaders) {
  const blocks = String(rawHeaders || "")
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter((block) => block.startsWith("HTTP/"));
  const last = blocks[blocks.length - 1] || "";
  const lines = last.split(/\r?\n/).filter(Boolean);
  const status = Number(lines[0]?.match(/HTTP\/\S+\s+(\d+)/)?.[1] || 0);
  const map = new Map();
  for (const line of lines.slice(1)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    map.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
  }
  return { status, map };
}

async function resolveHostsForCurl(url) {
  try {
    const parsed = new URL(url);
    const { stdout } = await execFileAsync("nslookup.exe", [parsed.hostname, "223.5.5.5"], {
      windowsHide: true,
      timeout: 8000,
      maxBuffer: 256 * 1024,
    });
    const ips = Array.from(stdout.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g))
      .map((match) => match[0])
      .filter((ip) => ip !== "223.5.5.5");
    const preferredIps =
      parsed.hostname === "openspeech.bytedance.com"
        ? [
            "117.187.26.251",
            "117.187.26.250",
            "117.187.26.249",
            "117.187.26.242",
            "117.187.26.243",
            "117.187.26.248",
            "117.135.224.214",
            "117.135.224.203",
          ]
        : [];
    return Array.from(new Set([...preferredIps, ...ips]))
      .filter(Boolean)
      .map((ip) => `${parsed.hostname}:${parsed.port || "443"}:${ip}`);
  } catch {
    return [];
  }
}

async function fetchViaCurl(url, options = {}, maxTimeSeconds = 60, proxyUrl = "") {
  const id = crypto.randomUUID();
  const bodyPath = join(backendDataDir, `cloud-proxy-body-${id}.json`);
  const headersPath = join(backendDataDir, `cloud-proxy-headers-${id}.txt`);
  const responsePath = join(backendDataDir, `cloud-proxy-response-${id}.json`);
  const body = options.body == null ? "" : String(options.body);
  writeFileSync(bodyPath, body);
  const resolveEntries = await resolveHostsForCurl(url);
  const attempts = proxyUrl ? [null] : (resolveEntries.length ? resolveEntries : [null]);
  let lastError = null;

  try {
    for (const resolveEntry of attempts) {
      const args = [
        "--silent",
        "--show-error",
        "--ssl-no-revoke",
        ...(proxyUrl ? ["--proxy", proxyUrl] : ["--noproxy", "*"]),
        "--connect-timeout",
        "3",
        "--max-time",
        String(maxTimeSeconds),
        "-X",
        options.method || "POST",
        "-D",
        headersPath,
        "-o",
        responsePath,
      ];
      if (resolveEntry) {
        args.push("--resolve", resolveEntry);
      }
      for (const [key, value] of Object.entries(options.headers || {})) {
        args.push("-H", `${key}: ${value}`);
      }
      args.push("--data-binary", `@${bodyPath}`, url);

      try {
        await execFileAsync("curl.exe", args, {
          windowsHide: true,
          timeout: (maxTimeSeconds + 8) * 1000,
          maxBuffer: 1024 * 1024,
        });
        const rawHeaders = existsSync(headersPath) ? readFileSync(headersPath, "utf8") : "";
        const textBody = existsSync(responsePath) ? readFileSync(responsePath, "utf8") : "";
        const parsed = parseCurlHeaders(rawHeaders);
        return {
          ok: parsed.status >= 200 && parsed.status < 300,
          status: parsed.status,
          headers: {
            get(name) {
              return parsed.map.get(String(name).toLowerCase()) || null;
            },
          },
          async json() {
            return JSON.parse(textBody || "{}");
          },
          async text() {
            return textBody;
          },
        };
      } catch (error) {
        lastError = error;
        if (resolveEntry) {
          console.warn(`[stt-platform] curl cloud request failed via ${resolveEntry}: ${errorSummary(error)}`);
        }
      }
    }
    throw lastError || new Error("curl cloud request failed");
  } finally {
    for (const path of [bodyPath, headersPath, responsePath]) {
      try {
        if (existsSync(path)) unlinkSync(path);
      } catch {
      }
    }
  }
}

async function fetchCloudJson(url, options = {}, directTimeoutMs = 10_000, proxyMaxTimeSeconds = 60) {
  const hostname = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  const pinnedUntil = hostname ? pinnedDnsUntilByHost.get(hostname) || 0 : 0;
  const shouldUsePinnedDnsFirst = pinnedUntil > Date.now();

  if (!shouldUsePinnedDnsFirst) {
    try {
      return await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(directTimeoutMs),
      });
    } catch (error) {
      if (hostname) {
        pinnedDnsUntilByHost.set(hostname, Date.now() + PINNED_DNS_CACHE_MS);
      }
      console.warn(
        `[stt-platform] direct cloud request failed (${errorSummary(error)}), retrying with pinned DNS`,
      );
    }
  }

  try {
    if (shouldUsePinnedDnsFirst) {
      console.log(`[stt-platform] using pinned DNS for ${hostname}`);
    }
    try {
      return await fetchViaCurl(url, options, proxyMaxTimeSeconds);
    } catch (firstCurlError) {
      console.warn(
        `[stt-platform] first direct curl cloud request failed (${errorSummary(firstCurlError)}), retrying direct once`,
      );
    }
    try {
      return await fetchViaCurl(url, options, proxyMaxTimeSeconds);
    } catch (curlError) {
      console.warn(
        `[stt-platform] direct curl cloud request failed (${errorSummary(curlError)}), retrying via ${LOCAL_CLOUD_PROXY_URL}`,
      );
      return fetchViaCurl(url, options, proxyMaxTimeSeconds, LOCAL_CLOUD_PROXY_URL);
    }
  } catch (error) {
    if (hostname) {
      pinnedDnsUntilByHost.delete(hostname);
    }
    throw error;
  }
}

async function transcribeWithVolcengineFlash(apiKey, wavData) {
  const body = {
    user: { uid: "voiceslate-android" },
    audio: {
      data: Buffer.from(wavData).toString("base64"),
      format: "wav",
    },
    request: {
      model_name: "bigmodel",
      enable_itn: true,
      enable_punc: true,
      enable_ddc: true,
    },
  };

  const upstream = await fetchCloudJson(VOLCENGINE_FLASH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...volcengineAuthHeaders(apiKey),
      "X-Api-Resource-Id": VOLCENGINE_FLASH_RESOURCE_ID,
      "X-Api-Request-Id": crypto.randomUUID(),
      "X-Api-Sequence": "-1",
    },
    body: JSON.stringify(body),
  }, 1_500, 60);

  const apiStatus = upstream.headers.get("X-Api-Status-Code") || "";
  const apiMessage = upstream.headers.get("X-Api-Message") || "";
  const data = await upstream.json().catch(() => null);
  if (!upstream.ok || (apiStatus && apiStatus !== "20000000")) {
    throw new Error(`Volcengine Flash ASR failed (${upstream.status}/${apiStatus}): ${apiMessage}`);
  }
  return extractVolcengineText(data);
}

async function transcribeWithVolcengineStandard(apiKey, wavData) {
  const requestId = crypto.randomUUID();
  const submitBody = {
    user: { uid: "voiceslate-android" },
    audio: {
      data: Buffer.from(wavData).toString("base64"),
      format: "wav",
    },
    request: {
      model_name: "bigmodel",
      enable_itn: true,
      enable_punc: true,
      enable_ddc: true,
      enable_speaker_info: false,
      enable_channel_split: false,
      show_utterances: false,
      vad_segment: false,
      sensitive_words_filter: "",
    },
  };

  const submit = await fetchCloudJson(VOLCENGINE_STANDARD_SUBMIT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...volcengineAuthHeaders(apiKey),
      "X-Api-Resource-Id": VOLCENGINE_STANDARD_RESOURCE_ID,
      "X-Api-Request-Id": requestId,
      "X-Api-Sequence": "-1",
    },
    body: JSON.stringify(submitBody),
  }, 1_500, 60);
  const submitStatus = submit.headers.get("X-Api-Status-Code") || "";
  const submitMessage = submit.headers.get("X-Api-Message") || "";
  const submitData = await submit.json().catch(() => null);
  if (!submit.ok || (submitStatus && submitStatus !== "20000000")) {
    throw new Error(`Volcengine Standard ASR submit failed (${submit.status}/${submitStatus}): ${submitMessage}`);
  }

  const taskId = submitData?.id || submitData?.task_id || requestId;
  for (let index = 0; index < 90; index += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    const query = await fetchCloudJson(VOLCENGINE_STANDARD_QUERY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...volcengineAuthHeaders(apiKey),
        "X-Api-Resource-Id": VOLCENGINE_STANDARD_RESOURCE_ID,
        "X-Api-Request-Id": requestId,
        "X-Api-Sequence": "-1",
      },
      body: JSON.stringify({ id: taskId }),
    }, 1_500, 30);
    const queryStatus = query.headers.get("X-Api-Status-Code") || "";
    if (!query.ok || (queryStatus && queryStatus !== "20000000")) {
      continue;
    }
    const queryData = await query.json().catch(() => null);
    const text = extractVolcengineText(queryData);
    if (text) return text;
  }
  return "";
}

function loadOrCreateSecret() {
  if (process.env.BETTER_AUTH_SECRET?.trim()) {
    return process.env.BETTER_AUTH_SECRET.trim();
  }

  if (existsSync(secretPath)) {
    const persisted = readFileSync(secretPath, "utf8").trim();
    if (persisted.length >= 32) {
      return persisted;
    }
  }

  const generated = Array.from(crypto.getRandomValues(new Uint8Array(48)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  writeFileSync(secretPath, generated, "utf8");
  return generated;
}

function normalizeOrigin(origin) {
  if (!origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    return origin;
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === "tauri://localhost") return true;
  if (origin === "http://tauri.localhost" || origin === "https://tauri.localhost") return true;
  try {
    const { protocol, hostname } = new URL(origin);
    if (!["http:", "https:"].includes(protocol)) return false;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "tauri.localhost";
  } catch {
    return false;
  }
}

function setCorsHeaders(req, res) {
  const requestOrigin = normalizeOrigin(req.headers.origin);
  const allowedOrigin = isAllowedOrigin(requestOrigin) ? requestOrigin : baseUrl;
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "set-auth-token, content-type, authorization",
  );
}

function sendJson(req, res, status, body) {
  setCorsHeaders(req, res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendHtml(req, res, status, html) {
  setCorsHeaders(req, res);
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function redirect(req, res, location, status = 302) {
  setCorsHeaders(req, res);
  res.statusCode = status;
  res.setHeader("Location", location);
  res.end();
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseCookies(cookieHeader = "") {
  const map = new Map();
  cookieHeader.split(";").forEach((entry) => {
    const [rawKey, ...rest] = entry.trim().split("=");
    if (!rawKey) return;
    map.set(rawKey, rest.join("="));
  });
  return map;
}

function nodeHeadersToWebHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(key, item));
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return key ? new Stripe(key) : null;
}

function ensureSupportTables(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS voiceslate_subscriptions (
      user_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'free',
      subscription_end TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      stt_seconds_used INTEGER NOT NULL DEFAULT 0,
      llm_tokens_used INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS voiceslate_backups (
      user_id TEXT PRIMARY KEY,
      history_json TEXT,
      dictionary_json TEXT,
      settings_json TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS voiceslate_sync_snapshots (
      user_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      snapshot_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function nowIso() {
  return new Date().toISOString();
}

function getPlanLimits(plan) {
  return plan === "pro" ? PRO_PLAN : FREE_PLAN;
}

function ensureSubscriptionRecord(db, userId) {
  const row = db
    .prepare(
      `SELECT user_id, plan, subscription_end, stripe_customer_id, stripe_subscription_id,
              stt_seconds_used, llm_tokens_used, updated_at
         FROM voiceslate_subscriptions
        WHERE user_id = ?`,
    )
    .get(userId);

  if (row) {
    return row;
  }

  const inserted = {
    user_id: userId,
    plan: "free",
    subscription_end: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stt_seconds_used: 0,
    llm_tokens_used: 0,
    updated_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO voiceslate_subscriptions
     (user_id, plan, subscription_end, stripe_customer_id, stripe_subscription_id, stt_seconds_used, llm_tokens_used, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    inserted.user_id,
    inserted.plan,
    inserted.subscription_end,
    inserted.stripe_customer_id,
    inserted.stripe_subscription_id,
    inserted.stt_seconds_used,
    inserted.llm_tokens_used,
    inserted.updated_at,
  );
  return inserted;
}

function serializeSubscription(row) {
  const limits = getPlanLimits(row.plan);
  return {
    plan: row.plan === "pro" ? "pro" : "free",
    subscriptionEnd: row.subscription_end || null,
    sttSecondsUsed: Number(row.stt_seconds_used || 0),
    sttSecondsLimit: limits.sttSecondsLimit,
    llmTokensUsed: Number(row.llm_tokens_used || 0),
    llmTokensLimit: limits.llmTokensLimit,
  };
}

function requireStripeConfig() {
  const stripe = getStripeClient();
  const priceId = process.env.STRIPE_PRO_PRICE_ID?.trim();
  if (!stripe || !priceId) {
    return null;
  }
  return { stripe, priceId };
}

function renderSetupRequiredPage(title, description) {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7fb; color: #182131; margin: 0; }
        .card { max-width: 560px; margin: 12vh auto; background: #fff; border-radius: 24px; padding: 32px; box-shadow: 0 18px 45px rgba(17, 24, 39, 0.08); }
        h1 { font-size: 28px; margin: 0 0 12px; }
        p { line-height: 1.6; color: #52607a; }
        code { background: #eef2ff; padding: 2px 6px; border-radius: 8px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>${title}</h1>
        <p>${description}</p>
        <p>Set <code>STRIPE_SECRET_KEY</code> and <code>STRIPE_PRO_PRICE_ID</code> on the backend when you're ready to accept real payments.</p>
      </div>
    </body>
  </html>`;
}

const db = new DatabaseSync(dbPath);
ensureSupportTables(db);

const auth = betterAuth({
  appName: "VoiceSlate",
  baseURL: baseUrl,
  secret: loadOrCreateSecret(),
  database: db,
  trustedOrigins: [
    "http://localhost:*",
    "http://127.0.0.1:*",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
  ],
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  },
  rateLimit: {
    enabled: false,
  },
  plugins: [bearer()],
});

const { runMigrations } = await getMigrations({
  ...auth.options,
  database: db,
});
await runMigrations();

const authHandler = toNodeHandler(auth);

async function resolveSession(req) {
  try {
    return await auth.api.getSession({
      headers: nodeHeadersToWebHeaders(req),
    });
  } catch {
    return null;
  }
}

async function handleDesktopOAuth(req, res, url) {
  const provider = url.searchParams.get("provider");
  const callbackURL = url.searchParams.get("callbackURL");
  if (!provider || !callbackURL) {
    sendJson(req, res, 400, { error: "provider and callbackURL are required" });
    return;
  }

  try {
    const response = await auth.api.signInSocial({
      body: {
        provider,
        callbackURL,
        disableRedirect: true,
      },
      headers: nodeHeadersToWebHeaders(req),
    });

    if (!response?.url) {
      sendJson(req, res, 502, { error: "OAuth provider did not return a redirect URL" });
      return;
    }

    redirect(req, res, response.url);
  } catch (error) {
    sendJson(req, res, 500, {
      error: error instanceof Error ? error.message : "Failed to start OAuth flow",
    });
  }
}

async function handleDesktopAuthCallback(req, res, url) {
  const cookieHeader = req.headers.cookie || "";
  const cookies = parseCookies(cookieHeader);
  const signedToken = url.searchParams.get("token") || cookies.get("better-auth.session_token");
  const state = url.searchParams.get("state") || "";

  if (!signedToken) {
    sendHtml(
      req,
      res,
      400,
      renderSetupRequiredPage(
        "Authentication incomplete",
        "VoiceSlate received the OAuth callback, but no session token was available yet. Please return to the app and try again.",
      ),
    );
    return;
  }

  const deepLink = `voiceslate://auth/callback?token=${encodeURIComponent(signedToken)}&state=${encodeURIComponent(state)}`;
  redirect(req, res, deepLink);
}

async function handleCheckoutSuccess(req, res) {
  redirect(req, res, "voiceslate://checkout/success");
}

async function handleSubscriptionStatus(req, res) {
  const session = await resolveSession(req);
  if (!session?.user?.id) {
    sendJson(req, res, 200, {
      plan: "free",
      subscriptionEnd: null,
      sttSecondsUsed: 0,
      sttSecondsLimit: FREE_PLAN.sttSecondsLimit,
      llmTokensUsed: 0,
      llmTokensLimit: FREE_PLAN.llmTokensLimit,
    });
    return;
  }

  const subscription = ensureSubscriptionRecord(db, session.user.id);
  sendJson(req, res, 200, serializeSubscription(subscription));
}

async function requireUser(req, res) {
  const session = await resolveSession(req);
  if (!session?.user?.id) {
    sendJson(req, res, 401, { error: "Authentication required" });
    return null;
  }
  return session;
}

async function handleCheckoutCreate(req, res) {
  const session = await requireUser(req, res);
  if (!session) return;

  const stripeConfig = requireStripeConfig();
  if (!stripeConfig) {
    sendJson(req, res, 200, {
      url: `${baseUrl}/billing/setup-required`,
    });
    return;
  }

  const record = ensureSubscriptionRecord(db, session.user.id);
  let customerId = record.stripe_customer_id;

  if (!customerId) {
    const customer = await stripeConfig.stripe.customers.create({
      email: session.user.email,
      name: session.user.name || undefined,
      metadata: {
        voiceslateUserId: session.user.id,
      },
    });
    customerId = customer.id;
    db.prepare(
      `UPDATE voiceslate_subscriptions
          SET stripe_customer_id = ?, updated_at = ?
        WHERE user_id = ?`,
    ).run(customerId, nowIso(), session.user.id);
  }

  const checkout = await stripeConfig.stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price: stripeConfig.priceId,
        quantity: 1,
      },
    ],
    success_url: `${baseUrl}/checkout/success`,
    cancel_url: `${baseUrl}/billing/cancelled`,
    metadata: {
      voiceslateUserId: session.user.id,
      origin: "desktop",
    },
  });

  sendJson(req, res, 200, { url: checkout.url });
}

async function handlePortalCreate(req, res) {
  const session = await requireUser(req, res);
  if (!session) return;

  const stripeConfig = requireStripeConfig();
  if (!stripeConfig) {
    sendJson(req, res, 200, {
      url: `${baseUrl}/billing/setup-required`,
    });
    return;
  }

  const record = ensureSubscriptionRecord(db, session.user.id);
  if (!record.stripe_customer_id) {
    sendJson(req, res, 400, { error: "No billing profile has been created yet" });
    return;
  }

  const portal = await stripeConfig.stripe.billingPortal.sessions.create({
    customer: record.stripe_customer_id,
    return_url: `${baseUrl}/checkout/success`,
  });

  sendJson(req, res, 200, { url: portal.url });
}

async function handleBackupUpload(req, res) {
  const session = await requireUser(req, res);
  if (!session) return;

  const body = await readJsonBody(req);
  db.prepare(
    `INSERT INTO voiceslate_backups (user_id, history_json, dictionary_json, settings_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       history_json = excluded.history_json,
       dictionary_json = excluded.dictionary_json,
       settings_json = excluded.settings_json,
       updated_at = excluded.updated_at`,
  ).run(
    session.user.id,
    body.history === undefined ? null : JSON.stringify(body.history),
    body.dictionary === undefined ? null : JSON.stringify(body.dictionary),
    body.settings === undefined ? null : JSON.stringify(body.settings),
    nowIso(),
  );

  sendJson(req, res, 200, { success: true });
}

async function handleBackupDownload(req, res) {
  const session = await requireUser(req, res);
  if (!session) return;

  const row = db
    .prepare(
      `SELECT history_json, dictionary_json, settings_json
         FROM voiceslate_backups
        WHERE user_id = ?`,
    )
    .get(session.user.id);

  sendJson(req, res, 200, {
    history: row?.history_json ? JSON.parse(row.history_json) : undefined,
    dictionary: row?.dictionary_json ? JSON.parse(row.dictionary_json) : undefined,
    settings: row?.settings_json ? JSON.parse(row.settings_json) : undefined,
  });
}

async function handleSyncSnapshotUpload(req, res) {
  const session = await requireUser(req, res);
  if (!session) return;

  const body = await readJsonBody(req);
  const version = Number(body.version || 1);
  db.prepare(
    `INSERT INTO voiceslate_sync_snapshots (user_id, version, snapshot_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       version = excluded.version,
       snapshot_json = excluded.snapshot_json,
       updated_at = excluded.updated_at`,
  ).run(session.user.id, version, JSON.stringify(body), nowIso());

  sendJson(req, res, 200, { success: true });
}

async function handleSyncSnapshotDownload(req, res) {
  const session = await requireUser(req, res);
  if (!session) return;

  const row = db
    .prepare(
      `SELECT version, snapshot_json, updated_at
         FROM voiceslate_sync_snapshots
        WHERE user_id = ?`,
    )
    .get(session.user.id);

  sendJson(req, res, 200, {
    version: row?.version || 1,
    updatedAt: row?.updated_at || null,
    snapshot: row?.snapshot_json ? JSON.parse(row.snapshot_json) : null,
  });
}

async function handleScenes(req, res) {
  sendJson(req, res, 200, SCENE_PACKS);
}

async function handleProxyLlm(req, res) {
  const { apiKey, baseUrl: base, model } = getManagedLlmConfig();
  if (!apiKey || !base || !model) {
    sendJson(req, res, 503, { error: "Managed LLM proxy is not configured" });
    return;
  }

  const body = await readJsonBody(req);
  const upstream = await fetchCloudJson(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: body.messages || [],
    }),
  }, 10_000, 120);

  const data = await upstream.json().catch(() => null);
  if (!upstream.ok || !data) {
    sendJson(req, res, upstream.status || 502, {
      error: data?.error?.message || "Managed LLM proxy request failed",
    });
    return;
  }

  sendJson(req, res, 200, {
    text: data.choices?.[0]?.message?.content || "",
  });
}

const POLISH_PROMPT_MARKER = "You are a voice-to-text assistant";
const POLISH_TRANSCRIPTION_MARKER = "<transcription>";

function isVoiceSlatePolishRequest(parsed) {
  return (
    parsed &&
    Array.isArray(parsed.messages) &&
    parsed.messages.some(
      (message) =>
        message?.role === "system" &&
        typeof message?.content === "string" &&
        message.content.includes(POLISH_PROMPT_MARKER),
    ) &&
    parsed.messages.some(
      (message) =>
        message?.role === "user" &&
        typeof message?.content === "string" &&
        message.content.includes(POLISH_TRANSCRIPTION_MARKER),
    )
  );
}

function buildCompactPolishSystemPrompt(originalPrompt, hasSelectedText) {
  const parts = [
    "You clean raw speech transcription into polished typed text.",
    "Add punctuation where natural pauses or clauses end.",
    "Remove filler words, false starts, and obvious repetitions.",
    "Preserve the user's language, meaning, names, technical terms, and mixed-language text exactly.",
    "If the speaker clearly enumerates items, format them as a numbered list with one item per line.",
    "Treat bare Chinese enumeration such as 一...二...三...四..., 第一/第二, 一是/二是, or 首先/然后/最后 as list intent; do not keep those items in one paragraph.",
    "Example: input '一先检查云端连接二确认热键有没有响应三再看当前窗口有没有输入' -> output '1. 先检查云端连接\\n2. 确认热键有没有响应\\n3. 再看当前窗口有没有输入'.",
    "Output only the final text.",
  ];

  if (originalPrompt.includes("Context: Email")) {
    parts.push("Context: Email. Use formal tone and complete sentences.");
  } else if (originalPrompt.includes("Context: Chat/IM")) {
    parts.push("Context: Chat. Keep it concise and natural. Avoid over-formatting.");
  } else if (originalPrompt.includes("Context: Document editor")) {
    parts.push("Context: Document. Use clear paragraph structure.");
  }

  const dictionaryMarker = 'Always use these exact spellings:';
  const dictionaryIndex = originalPrompt.indexOf(dictionaryMarker);
  if (dictionaryIndex >= 0) {
    const dictionaryBlock = originalPrompt
      .slice(dictionaryIndex + dictionaryMarker.length)
      .split("\n\n")[0]
      .trim();
    if (dictionaryBlock) {
      parts.push(`Use these exact spellings:\n${dictionaryBlock}`);
    }
  }

  if (hasSelectedText) {
    parts.push(
      "If a <selected_text> message is present, treat the transcription message as an instruction that should be applied to that selected text.",
    );
  }

  const translateMatch =
    originalPrompt.match(/translate the final result into ([^.]+)\./i) ||
    originalPrompt.match(/translate the entire result into ([^.]+)\./i);
  if (translateMatch?.[1]) {
    parts.push(`Translate the final result into ${translateMatch[1].trim()}.`);
  }

  return parts.join("\n");
}

function optimizeVoiceSlatePolishRequest(parsed) {
  if (!isVoiceSlatePolishRequest(parsed)) {
    return { body: parsed, emulateStream: false, bypassText: "" };
  }

  const optimized = structuredClone(parsed);
  const hasSelectedText = optimized.messages.some(
    (message) =>
      message?.role === "user" &&
      typeof message?.content === "string" &&
      message.content.includes("<selected_text>"),
  );
  const transcriptionMessage = optimized.messages.find(
    (message) =>
      message?.role === "user" &&
      typeof message?.content === "string" &&
      message.content.includes(POLISH_TRANSCRIPTION_MARKER),
  );
  const transcriptionMatch =
    transcriptionMessage?.content?.match(/<transcription>\s*([\s\S]*?)\s*<\/transcription>/i);
  const transcriptionText = transcriptionMatch?.[1]?.trim() || "";
  const compactTranscription = transcriptionText.replace(/\s+/g, "");
  const asksForTranslation = optimized.messages.some(
    (message) =>
      typeof message?.content === "string" &&
      /translate|翻译|target_lang|target language/i.test(message.content),
  );
  const shouldBypassPolish =
    !hasSelectedText &&
    !asksForTranslation &&
    compactTranscription.length > 0 &&
    compactTranscription.length <= 8 &&
    !/[。！？!?；;：:\n\r]/.test(transcriptionText);

  optimized.messages = optimized.messages.map((message) => {
    if (
      message?.role === "system" &&
      typeof message?.content === "string" &&
      message.content.includes(POLISH_PROMPT_MARKER)
    ) {
      return {
        ...message,
        content: buildCompactPolishSystemPrompt(message.content, hasSelectedText),
      };
    }
    return message;
  });

  const requestedMaxTokens = Number(optimized.max_tokens);
  let dynamicMaxTokens = hasSelectedText ? 1024 : 512;
  if (!hasSelectedText && transcriptionText) {
    dynamicMaxTokens = Math.max(
      128,
      Math.min(512, Math.ceil(transcriptionText.length * 1.2)),
    );
  }
  if (!Number.isFinite(requestedMaxTokens) || requestedMaxTokens <= 0) {
    optimized.max_tokens = dynamicMaxTokens;
  } else {
    optimized.max_tokens = Math.min(requestedMaxTokens, dynamicMaxTokens);
  }

  if (!Number.isFinite(Number(optimized.temperature))) {
    optimized.temperature = 0.2;
  } else {
    optimized.temperature = Math.min(Number(optimized.temperature), 0.2);
  }

  optimized.thinking = { type: "disabled" };
  if ("reasoning_effort" in optimized) {
    delete optimized.reasoning_effort;
  }

  const emulateStream = optimized.stream === true;
  optimized.stream = false;
  return {
    body: optimized,
    emulateStream,
    bypassText: shouldBypassPolish ? transcriptionText : "",
  };
}

function buildOpenAiCompatCompletion(content, model) {
  return {
    id: `voiceslate-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

function buildSseChunk({ id, model, content = "", finishReason = null }) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: content ? { content } : {},
        finish_reason: finishReason,
      },
    ],
  };
}

function sendOpenAiCompatSse(req, res, data, model) {
  const content =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.message?.reasoning_content ||
    "";
  const id = data?.id || `voiceslate-${Date.now()}`;
  const resolvedModel = data?.model || model;

  res.statusCode = 200;
  setCorsHeaders(req, res);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const chunks = [];
  if (content) {
    for (let index = 0; index < content.length; index += 160) {
      chunks.push(content.slice(index, index + 160));
    }
  }

  if (!chunks.length) {
    res.write(`data: ${JSON.stringify(buildSseChunk({ id, model: resolvedModel }))}\n\n`);
  } else {
    for (const chunk of chunks) {
      res.write(
        `data: ${JSON.stringify(buildSseChunk({ id, model: resolvedModel, content: chunk }))}\n\n`,
      );
    }
  }

  res.write(
    `data: ${JSON.stringify(
      buildSseChunk({ id, model: resolvedModel, finishReason: "stop" }),
    )}\n\n`,
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

async function proxyManagedLlmOpenAiCompat(req, res, pathname) {
  const { apiKey, baseUrl: base, model } = getManagedLlmConfig();
  if (!apiKey || !base || !model) {
    sendJson(req, res, 503, { error: "Managed LLM proxy is not configured" });
    return;
  }

  const upstreamUrl = `${base.replace(/\/$/, "")}${pathname}`;
  const method = req.method || "GET";
  const raw = method === "POST" ? await readRawBody(req) : undefined;
  const contentType = req.headers["content-type"] || "application/json";

  let body = raw;
  let emulateStream = false;
  let bypassText = "";
  if (method === "POST" && raw?.length) {
    try {
      const parsed = JSON.parse(raw.toString("utf8"));
      if (!parsed.model || parsed.model === "default") parsed.model = model;
      const optimized = optimizeVoiceSlatePolishRequest(parsed);
      emulateStream = optimized.emulateStream;
      bypassText = optimized.bypassText || "";
      body = Buffer.from(JSON.stringify(optimized.body), "utf8");
    } catch {
      body = raw;
    }
  }

  if (bypassText) {
    const data = buildOpenAiCompatCompletion(bypassText, model);
    if (emulateStream) {
      sendOpenAiCompatSse(req, res, data, model);
    } else {
      sendJson(req, res, 200, data);
    }
    return;
  }

  const upstream = await fetchCloudJson(upstreamUrl, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(method === "POST" ? { "Content-Type": contentType } : {}),
    },
    body,
  }, 1_500, 120);

  if (emulateStream) {
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok || !data) {
      sendJson(req, res, upstream.status || 502, {
        error: data?.error?.message || "Managed LLM proxy request failed",
      });
      return;
    }
    sendOpenAiCompatSse(req, res, data, model);
    return;
  }

  res.statusCode = upstream.status;
  setCorsHeaders(req, res);

  const responseContentType = upstream.headers.get("content-type");
  if (responseContentType) {
    res.setHeader("Content-Type", responseContentType);
  }
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) {
    res.setHeader("Cache-Control", cacheControl);
  }

  if (!upstream.body) {
    const textBody = await upstream.text().catch(() => "");
    res.end(textBody);
    return;
  }

  if (!upstream.body.getReader) {
    const textBody = await upstream.text().catch(() => "");
    res.end(textBody);
    return;
  }

  const reader = upstream.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

async function handleProxyStt(req, res) {
  const raw = await readRawBody(req);
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
  const startedAt = performance.now();
  try {
    const url = new URL(req.url || "/api/proxy/stt", baseUrl);
    const payload = await readMultipartPayload(req, raw);
    const providerId = resolveRequestedSttProvider(url, payload.fields);
    const provider = resolveSttProvider(providerId, payload.fields);
    const audioSeconds = wavDurationSeconds(payload.audio);
    payload.audioSeconds = audioSeconds;
    console.log(
      `[stt-platform] request_id=${requestId} provider=${provider.id} upstream=${provider.upstreamId || provider.id} bytes=${payload.audio.length} audio_s=${audioSeconds ?? "unknown"}`,
    );
    const result = await transcribeWithProvider(provider, payload);
    const latencyMs = Math.round(performance.now() - startedAt);
    const response = makeUnifiedSttResponse({
      text: result.text,
      provider: provider.id,
      requestId,
      audioSeconds,
      codec: result.codec || provider.codec || "wav",
      latencyMs,
    });
    appendSttTiming({
      request_id: requestId,
      provider: provider.id,
      upstream_provider: provider.upstreamId || provider.id,
      audio_seconds: audioSeconds,
      codec: response.codec,
      ...(result.timings || {}),
      latency_ms: latencyMs,
      total_ms: latencyMs,
      text_chars: response.text.length,
      ok: true,
      cost_estimate: estimateSttCost(provider.upstreamId || provider.id, audioSeconds),
    });
    console.log(
      `[stt-platform] ok request_id=${requestId} provider=${provider.id} codec=${response.codec} latency_ms=${latencyMs} text_len=${response.text.length}`,
    );
    sendJson(req, res, 200, response);
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const message = error instanceof Error ? error.message : "Managed STT proxy request failed";
    console.error(`[stt-platform] failed request_id=${requestId} latency_ms=${latencyMs}:`, error);
    appendSttTiming({
      request_id: requestId,
      latency_ms: latencyMs,
      ok: false,
      error: message,
    });
    sendJson(req, res, 502, {
      ...makeUnifiedSttResponse({
        text: "",
        provider: "unknown",
        requestId,
        audioSeconds: null,
        codec: "unknown",
        latencyMs,
        error: message,
      }),
    });
  }
}

async function handleSttProviders(req, res, url) {
  const registry = loadSttProviderRegistry();
  const providerId = normalizeProviderId(url.searchParams.get("provider"));
  if (providerId) {
    const resolved = resolveSttProvider(providerId);
    const effectiveCodec =
      resolved.type === "volcengine-flash" || resolved.type === "volcengine-standard"
        ? "wav"
        : resolved.requestedCodec || resolved.codec || "wav";
    sendJson(req, res, 200, {
      ok: true,
      provider: resolved.id,
      upstream_provider: resolved.upstreamId || resolved.id,
      label: resolved.label,
      type: resolved.type,
      codec: effectiveCodec,
      requested_codec: resolved.requestedCodec || resolved.codec || "wav",
      configured: resolved.auth === "none" || Boolean(resolved.apiKey),
    });
    return;
  }

  sendJson(req, res, 200, {
    ok: true,
    default_provider: process.env.STT_DEFAULT_PROVIDER || "cloud-opus",
    providers: Object.keys({ "cloud-opus": {}, ...registry }),
  });
}

async function handleSttBenchmark(req, res) {
  const raw = await readRawBody(req);
  const payload = await readMultipartPayload(req, raw);
  const requested = String(
    payload.fields.providers || process.env.STT_BENCHMARK_PROVIDERS || "local-whisper,cloud-opus",
  )
    .split(",")
    .map((item) => normalizeProviderId(item))
    .filter(Boolean);
  const audioSeconds = wavDurationSeconds(payload.audio);
  payload.audioSeconds = audioSeconds;
  const results = [];
  for (const providerId of requested) {
    const requestId = crypto.randomUUID();
    const startedAt = performance.now();
    try {
      const provider = resolveSttProvider(providerId, payload.fields);
      const result = await transcribeWithProvider(provider, payload);
      const latencyMs = Math.round(performance.now() - startedAt);
      const benchmarkResult = {
        ...makeUnifiedSttResponse({
          text: result.text,
          provider: provider.id,
          requestId,
          audioSeconds,
          codec: result.codec || provider.codec || "wav",
          latencyMs,
        }),
        upstream_provider: provider.upstreamId || provider.id,
        text_length: result.text.length,
        cost_estimate: estimateSttCost(provider.upstreamId || provider.id, audioSeconds),
      };
      results.push(benchmarkResult);
      appendSttTiming({
        request_id: requestId,
        benchmark: true,
        provider: provider.id,
        upstream_provider: provider.upstreamId || provider.id,
        audio_seconds: audioSeconds,
        codec: benchmarkResult.codec,
        ...(result.timings || {}),
        latency_ms: latencyMs,
        total_ms: latencyMs,
        text_chars: result.text.length,
        ok: true,
        cost_estimate: benchmarkResult.cost_estimate,
      });
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startedAt);
      const benchmarkResult = {
        ...makeUnifiedSttResponse({
          text: "",
          provider: providerId,
          requestId,
          audioSeconds,
          codec: "unknown",
          latencyMs,
          error: error instanceof Error ? error.message : "Benchmark provider failed",
        }),
        upstream_provider: providerId,
        text_length: 0,
        cost_estimate: 0,
      };
      results.push(benchmarkResult);
      appendSttTiming({
        request_id: requestId,
        benchmark: true,
        provider: providerId,
        upstream_provider: providerId,
        audio_seconds: audioSeconds,
        codec: "unknown",
        latency_ms: latencyMs,
        total_ms: latencyMs,
        text_chars: 0,
        ok: false,
        error: benchmarkResult.error,
      });
    }
  }
  sendJson(req, res, 200, { ok: true, audio_seconds: audioSeconds, results });
}

function routeNotFound(req, res) {
  sendJson(req, res, 404, { error: "Not found" });
}

const server = createServer(async (req, res) => {
  try {
    if (!req.url || !req.method) {
      routeNotFound(req, res);
      return;
    }

    if (req.method === "OPTIONS") {
      setCorsHeaders(req, res);
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url, baseUrl);
    const pathname = url.pathname;

    if (pathname === "/health") {
      sendJson(req, res, 200, { ok: true, baseUrl, dbPath });
      return;
    }

    if (pathname === "/billing/setup-required") {
      sendHtml(
        req,
        res,
        200,
        renderSetupRequiredPage(
          "Billing isn't configured yet",
          "The desktop app is ready for real checkout and customer portal flows, but this backend still needs Stripe credentials before it can sell Pro subscriptions.",
        ),
      );
      return;
    }

    if (pathname === "/billing/cancelled") {
      sendHtml(
        req,
        res,
        200,
        renderSetupRequiredPage(
          "Checkout cancelled",
          "No changes were made to the subscription. You can close this page and return to VoiceSlate.",
        ),
      );
      return;
    }

    if (pathname === "/api/auth/desktop-oauth" && req.method === "GET") {
      await handleDesktopOAuth(req, res, url);
      return;
    }

    if (pathname === "/auth/callback" && req.method === "GET") {
      await handleDesktopAuthCallback(req, res, url);
      return;
    }

    if (pathname === "/checkout/success" && req.method === "GET") {
      await handleCheckoutSuccess(req, res);
      return;
    }

    if (pathname === "/api/subscription/status" && req.method === "GET") {
      await handleSubscriptionStatus(req, res);
      return;
    }

    if (pathname === "/api/checkout/create" && req.method === "POST") {
      await handleCheckoutCreate(req, res);
      return;
    }

    if (pathname === "/api/subscription/portal" && req.method === "POST") {
      await handlePortalCreate(req, res);
      return;
    }

    if (pathname === "/api/backup/upload" && req.method === "POST") {
      await handleBackupUpload(req, res);
      return;
    }

    if (pathname === "/api/backup/download" && req.method === "GET") {
      await handleBackupDownload(req, res);
      return;
    }

    if (pathname === "/api/sync/snapshot" && req.method === "POST") {
      await handleSyncSnapshotUpload(req, res);
      return;
    }

    if (pathname === "/api/sync/snapshot" && req.method === "GET") {
      await handleSyncSnapshotDownload(req, res);
      return;
    }

    if (pathname === "/api/scenes" && req.method === "GET") {
      await handleScenes(req, res);
      return;
    }

    if (pathname === "/api/proxy/llm" && req.method === "POST") {
      await handleProxyLlm(req, res);
      return;
    }

    if (pathname === "/v1/models" && req.method === "GET") {
      await proxyManagedLlmOpenAiCompat(req, res, "/models");
      return;
    }

    if (pathname === "/v1/chat/completions" && req.method === "POST") {
      await proxyManagedLlmOpenAiCompat(req, res, "/chat/completions");
      return;
    }

    if (pathname === "/api/stt/providers" && req.method === "GET") {
      await handleSttProviders(req, res, url);
      return;
    }

    if (pathname === "/api/stt/benchmark" && req.method === "POST") {
      await handleSttBenchmark(req, res);
      return;
    }

    if (pathname === "/api/proxy/stt" && req.method === "POST") {
      await handleProxyStt(req, res);
      return;
    }

    if (pathname.startsWith("/api/auth/")) {
      setCorsHeaders(req, res);
      await authHandler(req, res);
      return;
    }

    routeNotFound(req, res);
  } catch (error) {
    console.error("[voiceslate-cloud] unhandled request error:", error);
    sendJson(req, res, 500, {
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

server.listen(port, host, () => {
  console.log(`[voiceslate-cloud] listening on ${baseUrl}`);
  console.log(`[voiceslate-cloud] database: ${dbPath}`);
});
