from __future__ import annotations

import os
import re
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel
from opencc import OpenCC


HOST = os.environ.get("OPENTYPELESS_LOCAL_STT_HOST", "127.0.0.1")
PORT = int(os.environ.get("OPENTYPELESS_LOCAL_STT_PORT", "8178"))
MODEL_NAME = os.environ.get("OPENTYPELESS_LOCAL_STT_MODEL", "small")
MODEL_ROOT = Path(
    os.environ.get(
        "OPENTYPELESS_LOCAL_STT_MODELS",
        Path(__file__).resolve().parent / "models",
    )
)

model: WhisperModel | None = None
opencc = OpenCC("t2s")


def normalize_text(text: str) -> str:
    text = opencc.convert(text)
    text = re.sub(r"\s+([,.!?;:])", r"\1", text)
    text = re.sub(r"([\u4e00-\u9fff])\s+([\u4e00-\u9fff])", r"\1\2", text)
    return text.strip()


def build_prompt(language: str | None) -> str:
    if language == "en":
        return (
            "Transcribe the speech exactly in English. "
            "Keep names, places, and technical words accurate. "
            "Do not translate and do not rewrite."
        )
    if language == "zh":
        return (
            "请直接转写语音内容，中文统一输出为简体中文，"
            "英文单词、人名、地名和专有名词保持原样，不要翻译，不要润色。"
        )
    return (
        "This audio may contain Chinese and English. "
        "Transcribe exactly as spoken. "
        "Keep English words, names, and technical terms unchanged. "
        "Output any Chinese text in simplified Chinese. "
        "Do not translate and do not rewrite."
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    model = WhisperModel(
        MODEL_NAME,
        device="cpu",
        compute_type="int8",
        download_root=str(MODEL_ROOT),
    )
    yield
    model = None


app = FastAPI(title="VoiceSlate Local STT", lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "status": "ok" if model is not None else "loading",
        "model": MODEL_NAME,
        "host": HOST,
        "port": PORT,
    }


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model_name: str = Form(default=MODEL_NAME, alias="model"),
    language: str | None = Form(default=None),
    authorization: str | None = Header(default=None),
):
    del authorization

    if model is None:
        raise HTTPException(status_code=503, detail="Local Whisper model is still loading.")

    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        temp_path = Path(tmp.name)

    try:
        normalized_language = language if language and language != "multi" else None
        segments, info = model.transcribe(
            str(temp_path),
            language=normalized_language,
            vad_filter=True,
            beam_size=5,
            best_of=5,
            temperature=0.0,
            condition_on_previous_text=False,
            initial_prompt=build_prompt(normalized_language),
        )
        text = normalize_text(" ".join(segment.text.strip() for segment in segments))
        detected_language = getattr(info, "language", None)
        return {
            "text": text,
            "language": detected_language or normalized_language or "unknown",
            "model": model_name or MODEL_NAME,
        }
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
