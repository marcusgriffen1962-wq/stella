/**
 * Stella AI - API Layer
 * Handles communication with local backend, LM Studio proxy, Kokoro TTS, and Web Search
 */

const API = {
  baseUrl: window.location.origin,

  /**
   * Check LM Studio and Kokoro health status
   */
  async checkHealth(serverUrl) {
    const url = new URL('/api/health', this.baseUrl);
    if (serverUrl) url.searchParams.set('server_url', serverUrl);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Health check failed: ${res.statusText}`);
    return await res.json();
  },

  /**
   * Fetch available models from LM Studio
   */
  async getModels(serverUrl) {
    const url = new URL('/api/models', this.baseUrl);
    if (serverUrl) url.searchParams.set('server_url', serverUrl);
    const res = await fetch(url.toString());
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to fetch models');
    }
    return await res.json();
  },

  /**
   * Fetch available Kokoro TTS voices
   */
  async getVoices() {
    const res = await fetch(`${this.baseUrl}/api/tts/voices`);
    if (!res.ok) throw new Error('Failed to load Kokoro voices');
    return await res.json();
  },

  /**
   * Synthesize text to speech using Kokoro
   * Returns a Blob (audio/wav)
   */
  async synthesizeSpeech(text, voice = 'af_heart', speed = 1.0, signal = null) {
    const res = await fetch(`${this.baseUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, speed }),
      signal
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'TTS synthesis failed');
    }
    return await res.blob();
  },

  /**
   * Transcribe recorded microphone audio using local Whisper model
   */
  async transcribeAudio(audioBlob) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'mic_recording.wav');
    const res = await fetch(`${this.baseUrl}/api/transcribe`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Whisper transcription failed');
    }
    return await res.json();
  },

  /**
   * Fetch a quick voice sample
   */
  async getVoicePreview(voice = 'af_heart', speed = 1.0) {
    const url = new URL('/api/tts/preview', this.baseUrl);
    url.searchParams.set('voice', voice);
    url.searchParams.set('speed', speed);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('Voice sample failed');
    return await res.blob();
  },

  /**
   * Execute real-time web search
   */
  async searchWeb(query, maxResults = 5) {
    const res = await fetch(`${this.baseUrl}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, max_results: maxResults })
    });
    if (!res.ok) throw new Error('Search failed');
    return await res.json();
  },

  /**
   * Stream chat completion with SSE
   */
  async streamChat({
    messages,
    model,
    webSearch,
    systemPrompt,
    temperature,
    serverUrl,
    onDelta,
    onSources,
    onError,
    onDone,
    signal
  }) {
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          model,
          web_search: webSearch,
          system_prompt: systemPrompt,
          temperature,
          server_url: serverUrl,
          stream: true
        }),
        signal
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        onError(err.detail || `Server error (${res.status})`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let doneFired = false;
      const fireDone = () => {
        if (!doneFired) {
          doneFired = true;
          if (onDone) onDone();
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep partial line in buffer

        let currentEvent = 'message';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            currentEvent = 'message';
            continue;
          }

          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7).trim();
          } else if (trimmed.startsWith('data: ')) {
            const rawData = trimmed.slice(6);
            try {
              const data = JSON.parse(rawData);
              if (currentEvent === 'search_results') {
                if (onSources) onSources(data.sources || []);
              } else if (currentEvent === 'delta') {
                if (onDelta) onDelta(data.content || '');
              } else if (currentEvent === 'error') {
                if (onError) onError(data.error || 'Stream error');
              } else if (currentEvent === 'done') {
                fireDone();
              }
            } catch (e) {
              console.warn('Failed to parse SSE data:', rawData);
            }
          }
        }
      }

      fireDone();
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Stream aborted by user');
      } else {
        onError(err.message || 'Stream connection failed');
      }
    }
  }
};

window.API = API;
