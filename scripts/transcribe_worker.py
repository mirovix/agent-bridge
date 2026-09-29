"""Local speech-to-text worker for Agent Bridge (audio never leaves the PC).

Reads JSON lines {"id", "path", "lang"} on stdin, writes {"id", "text"} or {"id", "error"}.
"lang" is an ISO 639-1 code; empty, missing or unknown to Whisper means auto-detect.
"""
import json
import os
import sys

from faster_whisper import WhisperModel

try:
    from faster_whisper.tokenizer import _LANGUAGE_CODES as KNOWN_LANGS
except ImportError:  # older/newer faster-whisper: let Whisper validate the code itself
    KNOWN_LANGS = None

MODEL = os.environ.get("AGENT_BRIDGE_WHISPER_MODEL", "small")
ROOT = os.environ.get("AGENT_BRIDGE_WHISPER_DIR", os.path.expanduser("~/.agent-bridge/whisper-models"))


DEVICE = os.environ.get("AGENT_BRIDGE_WHISPER_DEVICE", "cpu")


def load():
    # CUDA needs cuDNN 9 installed; CPU int8 is fast enough for short dictation.
    if DEVICE == "cuda":
        return WhisperModel(MODEL, device="cuda", compute_type="float16", download_root=ROOT)
    return WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=min(8, os.cpu_count() or 4), download_root=ROOT)


model = load()
print(json.dumps({"ready": True, "model": MODEL, "device": model.model.device}), flush=True)

for line in sys.stdin:
    try:
        req = json.loads(line)
    except ValueError:
        continue
    try:
        lang = req.get("lang") or None
        if lang and KNOWN_LANGS is not None and lang not in KNOWN_LANGS:
            lang = None  # a valid ISO code Whisper has no model for: auto-detect
        segments, _ = model.transcribe(req["path"], language=lang, vad_filter=True, beam_size=5)
        text = " ".join(s.text.strip() for s in segments).strip()
        print(json.dumps({"id": req.get("id"), "text": text}), flush=True)
    except Exception as e:  # report and keep serving
        print(json.dumps({"id": req.get("id"), "error": str(e)[:300]}), flush=True)
