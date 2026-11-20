/**
 * Stella AI - Voice Engine
 * Handles Local Microphone Audio Capture, Whisper STT, and Kokoro Neural TTS Playback
 */

class VoiceEngine {
  constructor({
    visualizer,
    onTranscript,
    onSpeechFinal,
    onSpeakingStart,
    onSpeakingEnd,
    onVolume,
    onStatusChange
  }) {
    this.visualizer = visualizer;
    this.onTranscript = onTranscript;
    this.onSpeechFinal = onSpeechFinal;
    this.onSpeakingStart = onSpeakingStart;
    this.onSpeakingEnd = onSpeakingEnd;
    this.onVolume = onVolume;
    this.onStatusChange = onStatusChange;

    // Recording & AudioContext state
    this.audioContext = null;
    this.micStream = null;
    this.processorNode = null;
    this.sourceNode = null;
    this.isListening = false;
    this.recordedBuffers = [];
    this.recordingLength = 0;
    this.selectedDeviceId = localStorage.getItem('stella_mic_device') || '';

    // VAD (Voice Activity Detection) state
    this.hasSpeechDetected = false;
    this.silenceTimer = null;
    this.silenceThreshold = 0.012; // RMS volume threshold
    this.silenceDurationMs = 1400; // Silence time before auto-send
    this.autoSendSpeech = true;
    this.recordingStartTime = 0;

    // TTS Audio Playback state
    this.currentAudio = null;
    this.isSpeaking = false;
    this.currentAudioUrl = null;
    this.speechGenerationId = 0;
    this.ttsAbortController = null;
  }

  /**
   * Enumerate available microphone devices
   */
  async getAudioInputDevices() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return [];
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audioinput');
    } catch (e) {
      console.warn('Could not list audio devices:', e);
      return [];
    }
  }

  setDevice(deviceId) {
    this.selectedDeviceId = deviceId;
    localStorage.setItem('stella_mic_device', deviceId);
    if (this.isListening) {
      // Re-initialize with new device
      this.stopListening(false);
      this.startListening();
    }
  }

  async toggleListening() {
    if (this.isListening) {
      await this.stopListening(true);
    } else {
      await this.startListening();
    }
  }

  /**
   * Start recording microphone audio directly via Web Audio API
   */
  async startListening() {
    if (this.isSpeaking) {
      this.stopSpeaking();
    }

    try {
      // Audio constraints with specific device if selected
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      };

      if (this.selectedDeviceId) {
        audioConstraints.deviceId = { exact: this.selectedDeviceId };
      }

      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

      // Create AudioContext at 16kHz for Whisper
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextClass({ sampleRate: 16000 });
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(this.micStream);
      
      // Connect to visualizer
      if (this.visualizer) {
        this.visualizer.connectMediaStream(this.micStream);
      }

      // ScriptProcessor for gathering PCM audio buffers
      const bufferSize = 4096;
      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      
      this.recordedBuffers = [];
      this.recordingLength = 0;
      this.hasSpeechDetected = false;
      this.recordingStartTime = Date.now();
      this.isListening = true;

      if (this.onStatusChange) {
        this.onStatusChange('listening');
      }

      this.processorNode.onaudioprocess = (e) => {
        if (!this.isListening) return;

        const inputData = e.inputBuffer.getChannelData(0);
        // Clone samples
        const samples = new Float32Array(inputData);
        this.recordedBuffers.push(samples);
        this.recordingLength += samples.length;

        // Calculate RMS Volume
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          sum += samples[i] * samples[i];
        }
        const rms = Math.sqrt(sum / samples.length);

        if (this.onVolume) {
          this.onVolume(rms);
        }

        // Voice Activity Detection
        if (rms > this.silenceThreshold) {
          this.hasSpeechDetected = true;
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        } else if (this.hasSpeechDetected && this.autoSendSpeech) {
          // User spoke and now there is silence
          if (!this.silenceTimer) {
            this.silenceTimer = setTimeout(() => {
              if (this.isListening && this.hasSpeechDetected) {
                console.log('Silence detected after speech, finalizing recording...');
                this.stopListening(true);
              }
            }, this.silenceDurationMs);
          }
        }
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);

    } catch (err) {
      console.error('Failed to access microphone:', err);
      this.isListening = false;
      if (err.name === 'NotAllowedError') {
        alert('Microphone access was denied. Please allow microphone permissions in your browser or application.');
      } else {
        alert(`Microphone error: ${err.message}. Please check your audio settings.`);
      }
      if (this.onStatusChange) {
        this.onStatusChange('idle');
      }
    }
  }

  /**
   * Stop recording and process with Whisper
   */
  async stopListening(processAudio = true) {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = null;

    if (!this.isListening) return;
    this.isListening = false;

    if (this.visualizer) {
      this.visualizer.stop();
    }

    // Cleanup audio nodes
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.audioContext) {
      try { await this.audioContext.close(); } catch (e) {}
      this.audioContext = null;
    }

    if (!processAudio || this.recordingLength === 0) {
      if (this.onStatusChange) this.onStatusChange('idle');
      return;
    }

    // Check minimum duration (~0.4s) to avoid empty clicks
    const elapsed = Date.now() - this.recordingStartTime;
    if (elapsed < 400 && !this.hasSpeechDetected) {
      if (this.onStatusChange) this.onStatusChange('idle');
      return;
    }

    // Encode recorded audio to 16kHz WAV
    if (this.onStatusChange) {
      this.onStatusChange('transcribing');
    }

    try {
      const mergedSamples = this.mergeBuffers(this.recordedBuffers, this.recordingLength);
      const wavBlob = this.encodeWAV(mergedSamples, 16000);

      const result = await window.API.transcribeAudio(wavBlob);
      const transcript = (result.text || '').trim();

      if (transcript && this.onSpeechFinal) {
        this.onSpeechFinal(transcript);
      } else if (!transcript) {
        console.log('No speech recognized in recording.');
      }
    } catch (err) {
      console.error('Transcription failed:', err);
      if (this.onStatusChange) {
        this.onStatusChange('error');
      }
    } finally {
      if (this.onStatusChange) {
        this.onStatusChange('idle');
      }
    }
  }

  /**
   * Merge Float32Array chunks into a single array
   */
  mergeBuffers(buffers, totalLength) {
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (let i = 0; i < buffers.length; i++) {
      result.set(buffers[i], offset);
      offset += buffers[i].length;
    }
    return result;
  }

  /**
   * Encode Float32 audio samples into standard 16-bit PCM WAV Blob
   */
  encodeWAV(samples, sampleRate = 16000) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    this.writeString(view, 8, 'WAVE');

    // "fmt " sub-chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true);  // AudioFormat (1 = PCM)
    view.setUint16(22, 1, true);  // NumChannels (1 = Mono)
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
    view.setUint16(32, 2, true);  // BlockAlign (NumChannels * BitsPerSample/8)
    view.setUint16(34, 16, true); // BitsPerSample (16 bits)

    // "data" sub-chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    // Write PCM samples
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /**
   * Speak text using Kokoro TTS
   */
  async speak(text, voice = 'af_heart', speed = 1.0) {
    if (!text || !text.trim()) return;

    // Immediately stop and cancel any previous speech synthesis or playback
    this.stopSpeaking();

    const genId = ++this.speechGenerationId;
    this.ttsAbortController = new AbortController();

    try {
      this.isSpeaking = true;
      if (this.onSpeakingStart) this.onSpeakingStart();

      if (this.visualizer) {
        this.visualizer.startSimulated('speaker');
      }

      const audioBlob = await window.API.synthesizeSpeech(
        text,
        voice,
        speed,
        this.ttsAbortController.signal
      );

      // Verify this generation has not been cancelled or superseded
      if (genId !== this.speechGenerationId || !this.isSpeaking) {
        return;
      }

      if (this.currentAudioUrl) {
        try { URL.revokeObjectURL(this.currentAudioUrl); } catch (e) {}
        this.currentAudioUrl = null;
      }

      this.currentAudioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(this.currentAudioUrl);
      this.currentAudio = audio;

      audio.onended = () => {
        if (genId === this.speechGenerationId) {
          this.cleanupSpeech();
        }
      };

      audio.onerror = (err) => {
        console.error('Audio playback error:', err);
        if (genId === this.speechGenerationId) {
          this.cleanupSpeech();
        }
      };

      await audio.play();
    } catch (err) {
      if (err.name === 'AbortError') {
        return;
      }
      console.error('TTS Playback failed:', err);
      if (genId === this.speechGenerationId) {
        this.cleanupSpeech();
      }
    }
  }

  stopSpeaking() {
    this.speechGenerationId++;

    if (this.ttsAbortController) {
      try {
        this.ttsAbortController.abort();
      } catch (e) {}
      this.ttsAbortController = null;
    }

    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio.src = '';
        this.currentAudio.load();
      } catch (e) {}
      this.currentAudio = null;
    }

    if (this.currentAudioUrl) {
      try {
        URL.revokeObjectURL(this.currentAudioUrl);
      } catch (e) {}
      this.currentAudioUrl = null;
    }

    this.cleanupSpeech();
  }

  cleanupSpeech() {
    this.isSpeaking = false;
    if (this.visualizer && !this.isListening) {
      this.visualizer.stop();
    }
    if (this.onSpeakingEnd) {
      this.onSpeakingEnd();
    }
  }
}

window.VoiceEngine = VoiceEngine;
