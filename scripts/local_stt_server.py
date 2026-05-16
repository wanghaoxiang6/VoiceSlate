from __future__ import annotations

import difflib
import json
import os
import re
import tempfile
import time
import wave
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel
import numpy as np
from opencc import OpenCC


HOST = os.environ.get("OPENTYPELESS_LOCAL_STT_HOST", "127.0.0.1")
PORT = int(os.environ.get("OPENTYPELESS_LOCAL_STT_PORT", "8178"))
MODEL_NAME = os.environ.get("OPENTYPELESS_LOCAL_STT_MODEL", "small")
COMMAND_MODEL_NAME = os.environ.get("OPENTYPELESS_LOCAL_STT_COMMAND_MODEL", "tiny")
CPU_THREADS = int(
    os.environ.get(
        "OPENTYPELESS_LOCAL_STT_CPU_THREADS",
        str(min(8, max(4, os.cpu_count() or 4))),
    )
)
COMMAND_CPU_THREADS = int(
    os.environ.get(
        "OPENTYPELESS_LOCAL_STT_COMMAND_CPU_THREADS",
        str(min(6, max(2, (os.cpu_count() or 4) // 2))),
    )
)
DEFAULT_LANGUAGE = os.environ.get("OPENTYPELESS_LOCAL_STT_DEFAULT_LANGUAGE", "zh").strip().lower()
BATCH_SIZE = int(os.environ.get("OPENTYPELESS_LOCAL_STT_BATCH_SIZE", "8"))
NORMAL_BEAM_SIZE = int(os.environ.get("OPENTYPELESS_LOCAL_STT_NORMAL_BEAM_SIZE", "3"))
NORMAL_BEST_OF = int(os.environ.get("OPENTYPELESS_LOCAL_STT_NORMAL_BEST_OF", "3"))
SHORT_COMMAND_SECONDS = float(
    os.environ.get("OPENTYPELESS_LOCAL_STT_SHORT_COMMAND_SECONDS", "2.2")
)
SHORT_AUDIO_SECONDS = float(
    os.environ.get("OPENTYPELESS_LOCAL_STT_SHORT_AUDIO_SECONDS", "2.0")
)
MODEL_ROOT = Path(
    os.environ.get(
        "OPENTYPELESS_LOCAL_STT_MODELS",
        Path(__file__).resolve().parent / "models",
    )
)
TIMING_LOG_PATH = Path(
    os.environ.get(
        "OPENTYPELESS_LOCAL_STT_TIMING_LOG",
        Path(os.environ.get("APPDATA", Path(__file__).resolve().parent))
        / "com.voiceslate.app"
        / "logs"
        / "local-stt-timing.jsonl",
    )
)

model: WhisperModel | None = None
command_model: WhisperModel | None = None
opencc = OpenCC("t2s")

COMMAND_ALIASES = {
    "screenshot": {
        "\u622a\u56fe",
        "\u622a\u5c4f",
        "\u622a\u4e2a\u56fe",
        "\u622a\u4e2a\u5c4f",
        "screenshot",
        "screen shot",
        "capture screen",
    },
    "translate": {
        "\u7ffb\u8bd1",
        "\u7ffb\u4e00\u4e0b",
        "\u8bd1\u4e00\u4e0b",
        "translate",
    },
    "ask": {
        "\u63d0\u95ee",
        "\u95ee\u4e00\u4e0b",
        "\u95ee\u4e00\u95ee",
        "ask",
    },
    "prompt": {
        "\u63d0\u793a\u8bcd",
        "prompt",
    },
}


def normalize_text(text: str) -> str:
    text = opencc.convert(text)
    text = re.sub(r"\s+([,.!?;:])", r"\1", text)
    text = re.sub(r"([\u4e00-\u9fff])\s+([\u4e00-\u9fff])", r"\1\2", text)
    return text.strip()


def normalize_command_text(text: str) -> str:
    text = opencc.convert(text).lower().strip()
    text = re.sub(r"[\u3000\uff0c\u3002\uff01\uff1f,.!?;:]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(
        r"^(please|just|can you|could you|would you|help me|please help me|"
        r"\u8bf7|\u5e2e\u6211|\u9ebb\u70e6|\u73b0\u5728|\u7ed9\u6211)\s*",
        "",
        text,
    )
    text = re.sub(
        r"\s*(please|now|thanks|thank you|"
        r"\u4e00\u4e0b|\u5427|\u554a|\u5440|\u5462|\u561b)\s*$",
        "",
        text,
    )
    text = re.sub(r"\s+", " ", text).strip()
    return text


def command_prompt() -> str:
    return (
        "\u622a\u56fe \u7ffb\u8bd1 \u63d0\u95ee \u63d0\u793a\u8bcd "
        "screenshot translate ask prompt"
    )


def best_command_match(text: str) -> str | None:
    normalized = normalize_command_text(text)
    if not normalized:
        return None

    compact = normalized.replace(" ", "")
    if len(compact) > 12 or len(normalized.split()) > 3:
        return None

    best_name: str | None = None
    best_score = 0.0

    for command_name, aliases in COMMAND_ALIASES.items():
        for alias in aliases:
            normalized_alias = normalize_command_text(alias)
            alias_compact = normalized_alias.replace(" ", "")
            if compact == alias_compact:
                return command_name
            score = max(
                difflib.SequenceMatcher(None, normalized, normalized_alias).ratio(),
                difflib.SequenceMatcher(None, compact, alias_compact).ratio(),
            )
            if score > best_score:
                best_name = command_name
                best_score = score

    if best_score >= 0.86:
        return best_name

    return None


def build_prompt(language: str | None) -> str:
    if language == "en":
        return (
            "Transcribe the speech exactly in English. "
            "Keep names, places, and technical words accurate. "
            "Do not translate and do not rewrite."
        )
    if language == "zh":
        return (
            "Transcribe the speech exactly. "
            "Output Chinese speech in Simplified Chinese. "
            "Keep English words, names, places, and technical terms unchanged. "
            "Do not translate and do not rewrite."
        )
    return (
        "This audio may contain Chinese and English. "
        "Transcribe exactly as spoken. "
        "Keep English words, names, and technical terms unchanged. "
        "Output any Chinese text in simplified Chinese. "
        "Do not translate and do not rewrite."
    )


def resolve_language(language: str | None) -> str | None:
    normalized = (language or "").strip().lower()
    if normalized and normalized != "multi":
        return normalized
    return None


def resolve_command_language(language: str | None) -> str | None:
    normalized = (language or "").strip().lower()
    if normalized and normalized != "multi":
        return normalized
    return DEFAULT_LANGUAGE or None


def transcribe_once(
    audio_path: str,
    *,
    target_model: WhisperModel,
    language: str | None,
    vad_filter: bool,
    beam_size: int,
    best_of: int,
    initial_prompt: str | None,
) -> tuple[str, str]:
    segments, info = target_model.transcribe(
        audio_path,
        language=language,
        vad_filter=vad_filter,
        beam_size=beam_size,
        best_of=best_of,
        temperature=0.0,
        condition_on_previous_text=False,
        initial_prompt=initial_prompt,
    )
    text = normalize_text(" ".join(segment.text.strip() for segment in segments))
    detected_language = getattr(info, "language", None) or language or "unknown"
    return text, detected_language


def warm_models() -> None:
    assert command_model is not None
    assert model is not None

    short_audio = np.zeros(16000, dtype="float32")
    long_audio = np.zeros(48000, dtype="float32")

    try:
        segments, _ = command_model.transcribe(
            short_audio,
            language="zh",
            vad_filter=False,
            beam_size=1,
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
            initial_prompt=command_prompt(),
        )
        list(segments)
    except Exception:
        pass

    try:
        segments, _ = model.transcribe(
            long_audio,
            language=None,
            vad_filter=False,
            beam_size=NORMAL_BEAM_SIZE,
            best_of=NORMAL_BEST_OF,
            temperature=0.0,
            condition_on_previous_text=False,
        )
        list(segments)
    except Exception:
        pass


def append_timing_log(payload: dict) -> None:
    try:
        TIMING_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with TIMING_LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    global command_model, model
    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    model = WhisperModel(
        MODEL_NAME,
        device="cpu",
        compute_type="int8",
        cpu_threads=CPU_THREADS,
        download_root=str(MODEL_ROOT),
    )
    command_model = WhisperModel(
        COMMAND_MODEL_NAME,
        device="cpu",
        compute_type="int8",
        cpu_threads=COMMAND_CPU_THREADS,
        download_root=str(MODEL_ROOT),
    )
    warm_models()
    yield
    command_model = None
    model = None


app = FastAPI(title="OpenTypeless Local STT", lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "status": "ok" if model is not None and command_model is not None else "loading",
        "model": MODEL_NAME,
        "command_model": COMMAND_MODEL_NAME,
        "host": HOST,
        "port": PORT,
        "device": "cpu",
        "compute_type": "int8",
        "cpu_threads": CPU_THREADS,
        "command_cpu_threads": COMMAND_CPU_THREADS,
        "batch_size": BATCH_SIZE,
        "normal_beam_size": NORMAL_BEAM_SIZE,
        "normal_best_of": NORMAL_BEST_OF,
        "default_language": DEFAULT_LANGUAGE or "auto",
        "short_command_seconds": SHORT_COMMAND_SECONDS,
        "short_audio_seconds": SHORT_AUDIO_SECONDS,
    }


def audio_duration_seconds(path: Path) -> float:
    try:
        with wave.open(str(path), "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            if rate > 0:
                return frames / float(rate)
    except Exception:
        return 0.0
    return 0.0


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model_name: str = Form(default=MODEL_NAME, alias="model"),
    language: str | None = Form(default=None),
    authorization: str | None = Header(default=None),
):
    del authorization

    if model is None or command_model is None:
        raise HTTPException(status_code=503, detail="Local Whisper model is still loading.")

    request_started = time.perf_counter()
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        temp_path = Path(tmp.name)

    try:
        normalized_language = resolve_language(language)
        command_language = resolve_command_language(language)
        duration_seconds = audio_duration_seconds(temp_path)
        is_short_command_window = 0 < duration_seconds <= SHORT_COMMAND_SECONDS
        is_short_audio = 0 < duration_seconds <= SHORT_AUDIO_SECONDS
        mode = "normal"
        result_text = ""
        result_language = normalized_language or "unknown"

        if is_short_command_window:
            command_candidate, _ = transcribe_once(
                str(temp_path),
                target_model=command_model,
                language=command_language,
                vad_filter=False,
                beam_size=1,
                best_of=1,
                initial_prompt=command_prompt(),
            )
            command_name = best_command_match(command_candidate)
            if command_name:
                mode = "command"
                result_text = command_name
                result_language = command_language or "unknown"
                return {
                    "text": result_text,
                    "language": result_language,
                    "model": model_name or MODEL_NAME,
                }

        text, detected_language = transcribe_once(
            str(temp_path),
            target_model=model,
            language=normalized_language,
            vad_filter=not is_short_audio,
            beam_size=NORMAL_BEAM_SIZE,
            best_of=NORMAL_BEST_OF,
            initial_prompt=None if is_short_audio else build_prompt(normalized_language),
        )
        result_text = text
        result_language = detected_language or normalized_language or "unknown"
        return {
            "text": result_text,
            "language": result_language,
            "model": model_name or MODEL_NAME,
        }
    finally:
        elapsed_ms = int((time.perf_counter() - request_started) * 1000)
        append_timing_log(
            {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "audio_s": round(duration_seconds, 3) if "duration_seconds" in locals() else None,
                "mode": mode if "mode" in locals() else "unknown",
                "request_language": language,
                "resolved_language": normalized_language if "normalized_language" in locals() else None,
                "result_language": result_language if "result_language" in locals() else None,
                "normal_beam_size": NORMAL_BEAM_SIZE,
                "normal_best_of": NORMAL_BEST_OF,
                "short_audio": is_short_audio if "is_short_audio" in locals() else None,
                "elapsed_ms": elapsed_ms,
                "text_chars": len(result_text) if "result_text" in locals() else None,
            }
        )
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
