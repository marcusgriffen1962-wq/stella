# ✨ Stella AI — Voice Assistant & LM Studio Chatbot

Stella is a modern, high-performance voice-enabled AI chatbot that connects directly to your local **LM Studio** server, features neural text-to-speech powered by **Kokoro**, provides speech recognition via your microphone, and can search the live internet for up-to-date answers.

---

## 🚀 Key Features

1. **LM Studio Integration & Instant Model Switching**:
   - Dynamically loads and switches models from LM Studio (`http://127.0.0.1:1234/v1`).
   - Switch models on the fly directly from the top navigation bar or settings modal without reloading the page.
   - Real-time Server-Sent Events (SSE) streaming for instant response rendering.

2. **Microphone Voice Input (Speech-to-Text)**:
   - Talk to Stella using your microphone via the Web Speech API.
   - Dynamic sound visualizer with reactive frequency waveforms.
   - Push-to-talk or click-to-toggle listening.
   - Auto-send on speech silence (configurable in settings).

3. **Neural Voice Output (Kokoro TTS)**:
   - Ultra-fast, high quality local speech synthesis powered by the 82M Kokoro ONNX model.
   - 54 natural voices across American, British, and international accents (default: `af_heart`).
   - Voice preview sample button in settings.
   - Speech speed control (0.75x – 1.4x).
   - "Auto-speak replies" toggle and per-message replay buttons.

4. **Real-Time Live Web Search**:
   - Toggleable `🌐 Search: ON/OFF` button.
   - Real-time search snippets and source cards with links and citations.
   - Grounds model answers in verified live internet information.

5. **Desktop Shortcut & App Mode**:
   - Double-click the **Stella AI** icon on your Desktop to launch the app instantly in standalone App Mode.
   - Also available in your system applications menu.

---

## 📁 Project Structure

```
/home/marcus/Documents/stella/
├── launch.sh              # One-click launcher script
├── server.py              # FastAPI backend (LM Studio proxy, Kokoro TTS, Web search)
├── models/
│   └── kokoro/
│       ├── kokoro-v1.0.onnx # Kokoro neural TTS weights
│       └── voices-v1.0.bin  # 54 Kokoro voice profiles
├── static/
│   ├── index.html         # Modern web interface
│   ├── css/
│   │   ├── style.css      # Glassmorphic dark theme stylesheet
│   │   └── highlight-dark.min.css
│   ├── js/
│   │   ├── app.js         # Core application coordinator
│   │   ├── voice.js       # Voice engine (STT & TTS playback)
│   │   ├── visualizer.js  # Audio reactive canvas visualizer
│   │   ├── api.js         # Backend API client
│   │   ├── marked.min.js  # Markdown parser
│   │   └── highlight.min.js
│   └── assets/
│       ├── icon.png       # High-resolution Stella icon
│       └── icon.jpg
└── Stella.desktop         # Freedesktop application entry
```

---

## 🏃 Quick Start

### 1. Launch via Desktop Shortcut
Double-click the **Stella AI** shortcut on your Desktop:
`/home/marcus/Desktop/Stella.desktop`

### 2. Launch via Terminal
```bash
/home/marcus/Documents/stella/launch.sh
```

### 3. Open in Browser Directly
```
http://localhost:5050
```

---

## ⚙️ Configuration & Requirements

- **LM Studio**: Make sure LM Studio is open and the local server is started (port `1234`).
- **Microphone**: Allow microphone permissions in Google Chrome when prompted.
- **Port**: The application server runs on `http://127.0.0.1:5050`.
