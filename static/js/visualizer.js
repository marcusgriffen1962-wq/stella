/**
 * Stella AI - Audio Visualizer
 * Renders glowing waveforms and frequency bars on an HTML5 Canvas
 */

class AudioVisualizer {
  constructor(canvasId, overlayId) {
    this.canvas = document.getElementById(canvasId);
    this.overlay = document.getElementById(overlayId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.audioContext = null;
    this.analyser = null;
    this.dataArray = null;
    this.animationId = null;
    this.isActive = false;
    this.mode = 'idle'; // 'mic', 'speaker', 'idle'
    this.simulatedTime = 0;

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * (window.devicePixelRatio || 1);
    this.canvas.height = rect.height * (window.devicePixelRatio || 1);
  }

  initAudioContext() {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
      }
    }
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  connectMediaStream(stream) {
    this.initAudioContext();
    if (!this.audioContext) return;

    try {
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.8;
      const source = this.audioContext.createMediaStreamSource(stream);
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
      this.mode = 'mic';
      this.start();
    } catch (e) {
      console.warn('Failed to connect media stream to visualizer:', e);
      this.startSimulated('mic');
    }
  }

  connectAudioElement(audioElement) {
    this.startSimulated('speaker');
  }

  startSimulated(mode = 'speaker') {
    this.mode = mode;
    this.start();
  }

  start() {
    this.isActive = true;
    if (this.overlay) this.overlay.classList.add('active');
    if (!this.animationId) {
      this.draw();
    }
  }

  stop() {
    this.isActive = false;
    if (this.overlay) this.overlay.classList.remove('active');
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.mode = 'idle';
  }

  draw() {
    if (!this.isActive || !this.ctx || !this.canvas) return;

    this.animationId = requestAnimationFrame(() => this.draw());
    const width = this.canvas.width;
    const height = this.canvas.height;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, width, height);

    let values = [];
    if (this.analyser && this.dataArray) {
      this.analyser.getByteFrequencyData(this.dataArray);
      values = Array.from(this.dataArray);
    } else {
      // Harmonic simulated wave if analyser is not attached directly
      this.simulatedTime += 0.08;
      const points = 32;
      for (let i = 0; i < points; i++) {
        const freq = Math.sin(this.simulatedTime + i * 0.3) * 0.5 + 0.5;
        const noise = Math.sin(this.simulatedTime * 1.5 + i * 0.7) * 0.3;
        values.push(Math.max(10, Math.floor((freq + noise) * 180)));
      }
    }

    const bars = 28;
    const step = Math.floor(values.length / bars) || 1;
    const barWidth = Math.max(3, (width / bars) * 0.45);
    const spacing = (width - bars * barWidth) / (bars + 1);

    const isCyan = this.mode === 'mic';
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    if (isCyan) {
      gradient.addColorStop(0, 'rgba(6, 182, 212, 0.2)');
      gradient.addColorStop(0.5, 'rgba(6, 182, 212, 0.8)');
      gradient.addColorStop(1, 'rgba(56, 189, 248, 1)');
    } else {
      gradient.addColorStop(0, 'rgba(99, 102, 241, 0.2)');
      gradient.addColorStop(0.5, 'rgba(139, 92, 246, 0.85)');
      gradient.addColorStop(1, 'rgba(236, 72, 153, 1)');
    }

    ctx.fillStyle = gradient;
    ctx.shadowBlur = 12;
    ctx.shadowColor = isCyan ? 'rgba(6, 182, 212, 0.6)' : 'rgba(139, 92, 246, 0.6)';

    for (let i = 0; i < bars; i++) {
      const val = values[i * step] || 10;
      const normalized = Math.min(1, Math.max(0.08, val / 255));
      const barHeight = normalized * (height * 0.85);
      const x = spacing + i * (barWidth + spacing);
      const y = (height - barHeight) / 2;

      // Rounded bar
      const radius = barWidth / 2;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, radius);
      ctx.fill();
    }
  }
}

window.AudioVisualizer = AudioVisualizer;
