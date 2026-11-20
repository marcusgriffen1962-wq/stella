import os
import io
import re
import json
import logging
from typing import List, Optional, Dict, Any
from pathlib import Path

import httpx
import soundfile as sf
import numpy as np
from fastapi import FastAPI, HTTPException, Request, Response, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("stella")

# Paths
BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models" / "kokoro"
STATIC_DIR = BASE_DIR / "static"
KOKORO_MODEL_PATH = MODELS_DIR / "kokoro-v1.0.onnx"
KOKORO_VOICES_PATH = MODELS_DIR / "voices-v1.0.bin"

# Default LM Studio settings
DEFAULT_LM_STUDIO_URL = os.getenv("LM_STUDIO_URL", "http://127.0.0.1:1234/v1")

app = FastAPI(title="Stella AI Chatbot", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Kokoro TTS Lazy Loader
_kokoro_instance = None

def get_kokoro():
    global _kokoro_instance
    if _kokoro_instance is None:
        if not KOKORO_MODEL_PATH.exists() or not KOKORO_VOICES_PATH.exists():
            raise RuntimeError(f"Kokoro model or voices file not found at {MODELS_DIR}")
        from kokoro_onnx import Kokoro
        logger.info("Initializing Kokoro TTS engine...")
        _kokoro_instance = Kokoro(str(KOKORO_MODEL_PATH), str(KOKORO_VOICES_PATH))
        logger.info("Kokoro TTS initialized successfully.")
    return _kokoro_instance

# Faster Whisper STT Lazy Loader
_whisper_instance = None

def get_whisper():
    global _whisper_instance
    if _whisper_instance is None:
        from faster_whisper import WhisperModel
        logger.info("Loading local Whisper model (base.en)...")
        _whisper_instance = WhisperModel("base.en", device="cpu", compute_type="int8")
        logger.info("Local Whisper model loaded successfully.")
    return _whisper_instance

# Pydantic Schemas
class SearchRequest(BaseModel):
    query: str
    max_results: int = 5

class TTSRequest(BaseModel):
    text: str
    voice: str = "af_heart"
    speed: float = 1.0

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    model: Optional[str] = None
    web_search: bool = False
    system_prompt: Optional[str] = None
    temperature: float = 0.7
    stream: bool = True
    server_url: Optional[str] = None

# Voice metadata helper
VOICE_CATEGORIES = {
    "American Female": [
        {"id": "af_heart", "name": "Heart (Default - Warm & Natural)"},
        {"id": "af_bella", "name": "Bella (Soft & Gentle)"},
        {"id": "af_sarah", "name": "Sarah (Clear & Professional)"},
        {"id": "af_nicole", "name": "Nicole (Crisp & Engaging)"},
        {"id": "af_sky", "name": "Sky (Bright & Friendly)"},
        {"id": "af_alloy", "name": "Alloy (Modern & Expressive)"},
        {"id": "af_aoede", "name": "Aoede (Melodic)"},
        {"id": "af_jessica", "name": "Jessica (Confident)"},
        {"id": "af_river", "name": "River (Calm & Soothing)"},
        {"id": "af_kore", "name": "Kore (Dynamic)"},
    ],
    "American Male": [
        {"id": "am_michael", "name": "Michael (Deep & Polished)"},
        {"id": "am_adam", "name": "Adam (Clear & Direct)"},
        {"id": "am_echo", "name": "Echo (Warm & Conversational)"},
        {"id": "am_eric", "name": "Eric (Approachable)"},
        {"id": "am_fenrir", "name": "Fenrir (Authoritative)"},
        {"id": "am_liam", "name": "Liam (Youthful & Energetic)"},
        {"id": "am_onyx", "name": "Onyx (Rich & Resonant)"},
        {"id": "am_puck", "name": "Puck (Playful)"},
    ],
    "British Female": [
        {"id": "bf_emma", "name": "Emma (Polished & Refined)"},
        {"id": "bf_alice", "name": "Alice (Articulate & Classic)"},
        {"id": "bf_isabella", "name": "Isabella (Expressive & Elegant)"},
        {"id": "bf_lily", "name": "Lily (Bright British Accent)"},
    ],
    "British Male": [
        {"id": "bm_george", "name": "George (Classic British RP)"},
        {"id": "bm_daniel", "name": "Daniel (Warm British)"},
        {"id": "bm_fable", "name": "Fable (Storyteller)"},
        {"id": "bm_lewis", "name": "Lewis (Crisp & Modern)"},
    ],
}

def clean_text_for_speech(text: str) -> str:
    """Clean markdown, links, and code blocks for smooth TTS pronunciation."""
    if not text:
        return ""
    # Remove code blocks with indication
    text = re.sub(r'```[\s\S]*?```', ' [code block omitted] ', text)
    # Remove inline code
    text = re.sub(r'`([^`]+)`', r'\1', text)
    # Replace markdown links with link text
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    # Remove headers, blockquotes, bullets
    text = re.sub(r'^[#*>\-\+\s]+', '', text, flags=re.MULTILINE)
    # Clean up double asterisks/italics
    text = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', text)
    # Strip URL addresses
    text = re.sub(r'https?://\S+', '', text)
    # Strip emojis that can cause weird phoneme issues
    text = re.sub(r'[^\w\s.,!?\'"\-:;()—–]', '', text)
    # Normalize whitespaces
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def execute_web_search(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    """Execute search via ddgs."""
    from ddgs import DDGS
    try:
        ddgs = DDGS()
        results = list(ddgs.text(query, max_results=max_results))
        formatted = []
        for r in results:
            formatted.append({
                "title": r.get("title", ""),
                "href": r.get("href", ""),
                "body": r.get("body", "")
            })
        return formatted
    except Exception as e:
        logger.error(f"Search failed for '{query}': {e}")
        return []

# Endpoints

@app.get("/api/health")
async def health(server_url: str = DEFAULT_LM_STUDIO_URL):
    """Check connectivity to LM Studio and local Kokoro models."""
    lm_online = False
    models_count = 0
    available_models = []
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{server_url.rstrip('/')}/models")
            if resp.status_code == 200:
                data = resp.json()
                available_models = [m.get("id") for m in data.get("data", [])]
                models_count = len(available_models)
                lm_online = True
    except Exception:
        lm_online = False

    kokoro_ready = KOKORO_MODEL_PATH.exists() and KOKORO_VOICES_PATH.exists()

    return {
        "status": "ok",
        "lm_studio": {
            "online": lm_online,
            "url": server_url,
            "models_count": models_count,
            "models": available_models
        },
        "kokoro": {
            "ready": kokoro_ready,
            "model_path": str(KOKORO_MODEL_PATH)
        }
    }

@app.get("/api/models")
async def list_models(server_url: str = DEFAULT_LM_STUDIO_URL):
    """Fetch all available models directly from LM Studio."""
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(f"{server_url.rstrip('/')}/models")
            if resp.status_code == 200:
                return resp.json()
            else:
                raise HTTPException(status_code=resp.status_code, detail="LM Studio returned an error")
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Could not connect to LM Studio at {server_url}. Is LM Studio running and the Local Server started?"
        )

@app.post("/api/search")
async def search_endpoint(req: SearchRequest):
    """Perform internet search and return snippets."""
    results = execute_web_search(req.query, req.max_results)
    return {"query": req.query, "results": results}

@app.get("/api/tts/voices")
async def get_voices():
    """Return categorized and raw available Kokoro voices."""
    try:
        kokoro = get_kokoro()
        raw_voices = kokoro.get_voices()
    except Exception as e:
        logger.warning(f"Failed to query Kokoro voices: {e}")
        raw_voices = []

    return {
        "categories": VOICE_CATEGORIES,
        "all_voices": raw_voices,
        "default": "af_heart"
    }

@app.post("/api/tts")
async def tts_synthesize(req: TTSRequest):
    """Synthesize speech using Kokoro TTS and return audio/wav."""
    cleaned = clean_text_for_speech(req.text)
    if not cleaned:
        raise HTTPException(status_code=400, detail="Text for speech cannot be empty")

    # Limit chunk size to avoid memory spikes
    if len(cleaned) > 2000:
        cleaned = cleaned[:2000] + "..."

    try:
        kokoro = get_kokoro()
        # Create audio samples
        samples, sample_rate = kokoro.create(cleaned, voice=req.voice, speed=req.speed)
        
        buffer = io.BytesIO()
        sf.write(buffer, samples, sample_rate, format="WAV")
        buffer.seek(0)
        
        return Response(content=buffer.read(), media_type="audio/wav")
    except Exception as e:
        logger.error(f"TTS synthesis failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {str(e)}")

@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """Transcribe recorded microphone WAV audio using local Whisper model."""
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Empty audio payload")

        buffer = io.BytesIO(content)
        audio_data, sample_rate = sf.read(buffer, dtype="float32")
        
        # If stereo, convert to mono
        if audio_data.ndim > 1:
            audio_data = np.mean(audio_data, axis=1)

        # If sample rate != 16000, resample using numpy linear interpolation
        if sample_rate != 16000:
            num_samples = int(len(audio_data) * 16000 / sample_rate)
            audio_data = np.interp(
                np.linspace(0, len(audio_data), num_samples, endpoint=False),
                np.arange(len(audio_data)),
                audio_data
            ).astype(np.float32)

        whisper = get_whisper()
        segments, info = whisper.transcribe(audio_data, beam_size=5, language="en")
        transcript = " ".join([seg.text for seg in segments]).strip()
        logger.info(f"Whisper transcription result: '{transcript}'")
        return {"text": transcript, "language": info.language}
    except Exception as e:
        logger.error(f"Transcription error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    """Chat completion proxy with optional web search injection and SSE streaming."""
    server_url = (req.server_url or DEFAULT_LM_STUDIO_URL).rstrip("/")
    
    # 1. Resolve model name if not provided
    model_name = req.model
    if not model_name:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                m_resp = await client.get(f"{server_url}/models")
                if m_resp.status_code == 200:
                    models_data = m_resp.json().get("data", [])
                    if models_data:
                        model_name = models_data[0].get("id")
        except Exception:
            pass
        if not model_name:
            model_name = "default"

    # 2. Extract latest user message for optional web search
    latest_user_message = ""
    for msg in reversed(req.messages):
        if msg.role == "user":
            latest_user_message = msg.content
            break

    search_sources = []
    search_context_block = ""
    
    # Check if web search should be performed
    if req.web_search and latest_user_message:
        logger.info(f"Performing web search for: '{latest_user_message}'")
        search_sources = execute_web_search(latest_user_message, max_results=4)
        if search_sources:
            search_context_block = "\n\n--- REAL-TIME INTERNET SEARCH RESULTS ---\n"
            for i, src in enumerate(search_sources, 1):
                search_context_block += f"[{i}] {src['title']}\nURL: {src['href']}\nSnippet: {src['body']}\n\n"
            search_context_block += "--- END SEARCH RESULTS ---\n"
            search_context_block += "Use the above verified internet search results when relevant to provide up-to-date and accurate information. Include source numbers like [1] or [2] when referencing them.\n"

    # 3. Construct message array
    final_messages = []
    
    system_content = req.system_prompt or (
        "You are Stella, a brilliant, warm, and highly capable AI voice assistant. "
        "You speak naturally and clearly. Keep spoken replies concise and engaging, "
        "while providing in-depth explanations and well-formatted code when asked."
    )
    
    if search_context_block:
        system_content += f"\n\n{search_context_block}"

    final_messages.append({"role": "system", "content": system_content})

    for m in req.messages:
        final_messages.append({"role": m.role, "content": m.content})

    payload = {
        "model": model_name,
        "messages": final_messages,
        "temperature": req.temperature,
        "stream": True
    }

    # 4. Stream response using SSE
    async def event_generator():
        # Send initial meta event with search sources if any
        if search_sources:
            yield f"event: search_results\ndata: {json.dumps({'sources': search_sources})}\n\n"
        
        sent_done = False
        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                async with client.stream(
                    "POST",
                    f"{server_url}/chat/completions",
                    json=payload,
                    headers={"Content-Type": "application/json"}
                ) as upstream:
                    if upstream.status_code != 200:
                        err_text = await upstream.aread()
                        logger.error(f"LM Studio stream error {upstream.status_code}: {err_text.decode('utf-8', errors='ignore')}")
                        yield f"event: error\ndata: {json.dumps({'error': f'LM Studio error ({upstream.status_code}): {err_text.decode()}'})}\n\n"
                        return

                    async for line in upstream.aiter_lines():
                        if not line:
                            continue
                        if line.startswith("data: "):
                            raw_data = line[6:].strip()
                            if raw_data == "[DONE]":
                                yield "event: done\ndata: {}\n\n"
                                sent_done = True
                                break
                            try:
                                parsed = json.loads(raw_data)
                                choices = parsed.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    content = delta.get("content", "")
                                    if content:
                                        yield f"event: delta\ndata: {json.dumps({'content': content})}\n\n"
                            except Exception:
                                pass
            except Exception as e:
                logger.error(f"Upstream stream failure: {e}")
                yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

        if not sent_done:
            yield "event: done\ndata: {}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

# Mount static frontend
STATIC_DIR.mkdir(parents=True, exist_ok=True)
(STATIC_DIR / "css").mkdir(parents=True, exist_ok=True)
(STATIC_DIR / "js").mkdir(parents=True, exist_ok=True)
(STATIC_DIR / "assets").mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
async def root():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": "Stella AI Chatbot backend is running."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=5050, reload=False, log_level="info")
