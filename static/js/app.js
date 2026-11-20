/**
 * Stella AI - Main Application Coordinator
 * Connects UI, Voice Engine, Visualizer, LM Studio API, and Kokoro TTS
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Application State
  const state = {
    messages: [],
    models: [],
    currentModel: localStorage.getItem('stella_model') || '',
    currentVoice: localStorage.getItem('stella_voice') || 'af_heart',
    voiceSpeed: parseFloat(localStorage.getItem('stella_speed') || '1.0'),
    autoSpeak: localStorage.getItem('stella_auto_speak') !== 'false',
    autoSendSpeech: localStorage.getItem('stella_auto_send') !== 'false',
    webSearch: localStorage.getItem('stella_web_search') === 'true',
    serverUrl: localStorage.getItem('stella_server_url') || 'http://127.0.0.1:1234/v1',
    temperature: parseFloat(localStorage.getItem('stella_temp') || '0.7'),
    systemPrompt: localStorage.getItem('stella_sys_prompt') || (
      "You are Stella, a brilliant, warm, and highly capable AI voice assistant. " +
      "You speak naturally and clearly. Keep spoken replies concise and engaging, " +
      "while providing in-depth explanations and well-formatted code when asked."
    ),
    isGenerating: false,
    abortController: null
  };

  // DOM Elements
  const headerModelSelect = document.getElementById('headerModelSelect');
  const modalModelSelect = document.getElementById('modalModelSelect');
  const btnRefreshModels = document.getElementById('btnRefreshModels');
  const serverStatusDot = document.getElementById('serverStatusDot');
  const serverStatusText = document.getElementById('serverStatusText');
  const btnVoiceToggle = document.getElementById('btnVoiceToggle');
  const voiceStatusLabel = document.getElementById('voiceStatusLabel');
  const btnNewChat = document.getElementById('btnNewChat');
  const btnOpenSettings = document.getElementById('btnOpenSettings');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const settingsModal = document.getElementById('settingsModal');

  const chatViewport = document.getElementById('chatViewport');
  const welcomeHero = document.getElementById('welcomeHero');
  const messageList = document.getElementById('messageList');
  const statusBanner = document.getElementById('statusBanner');
  const statusBannerText = document.getElementById('statusBannerText');

  const transcriptPreview = document.getElementById('transcriptPreview');
  const transcriptText = document.getElementById('transcriptText');
  const micStatusIcon = document.getElementById('micStatusIcon');
  const micLiveMeter = document.getElementById('micLiveMeter');
  const chatInput = document.getElementById('chatInput');
  const btnMic = document.getElementById('btnMic');
  const btnSend = document.getElementById('btnSend');
  const btnStop = document.getElementById('btnStop');
  const btnWebSearchToggle = document.getElementById('btnWebSearchToggle');
  const webSearchToggleLabel = document.getElementById('webSearchToggleLabel');

  // Settings DOM
  const settingServerUrl = document.getElementById('settingServerUrl');
  const btnTestServer = document.getElementById('btnTestServer');
  const settingTemperature = document.getElementById('settingTemperature');
  const tempValue = document.getElementById('tempValue');
  const settingMicDevice = document.getElementById('settingMicDevice');
  const btnRefreshMics = document.getElementById('btnRefreshMics');
  const btnTestMic = document.getElementById('btnTestMic');
  const micTestBarFill = document.getElementById('micTestBarFill');
  const micTestStatus = document.getElementById('micTestStatus');
  const settingVoiceSelect = document.getElementById('settingVoiceSelect');
  const btnPreviewVoice = document.getElementById('btnPreviewVoice');
  const settingVoiceSpeed = document.getElementById('settingVoiceSpeed');
  const speedValue = document.getElementById('speedValue');
  const settingAutoSpeak = document.getElementById('settingAutoSpeak');
  const settingAutoSendSpeech = document.getElementById('settingAutoSendSpeech');
  const settingSystemPrompt = document.getElementById('settingSystemPrompt');
  const toastContainer = document.getElementById('toastContainer');

  let isTestingMic = false;

  // Initialize Markdown parser
  if (window.marked) {
    marked.setOptions({
      breaks: true,
      highlight: function(code, lang) {
        if (window.hljs && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang }).value;
          } catch (e) {}
        }
        return code;
      }
    });
  }

  // Toast Helper
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // Audio Visualizer
  const visualizer = new AudioVisualizer('audioVisualizerCanvas', 'visualizerOverlay');

  // Voice Engine with PCM Recording & Local Whisper STT
  const voiceEngine = new VoiceEngine({
    visualizer,
    onTranscript: (text) => {
      transcriptText.textContent = text;
      transcriptPreview.classList.add('active');
    },
    onVolume: (rms) => {
      const percentage = Math.min(100, Math.max(2, Math.round(rms * 700)));
      if (micLiveMeter) {
        micLiveMeter.style.width = percentage + '%';
      }
      if (isTestingMic && micTestBarFill) {
        micTestBarFill.style.width = percentage + '%';
        if (rms > 0.012) {
          micTestStatus.textContent = '🟢 Mic is receiving clear audio!';
          micTestStatus.style.color = 'var(--success)';
        }
      }
    },
    onStatusChange: (status) => {
      if (status === 'listening') {
        btnMic.classList.add('listening');
        transcriptText.textContent = 'Listening to your microphone... (speak now)';
        if (micStatusIcon) micStatusIcon.textContent = '🎙️';
        transcriptPreview.classList.add('active');
      } else if (status === 'transcribing') {
        transcriptText.textContent = 'Transcribing your voice with Whisper...';
        if (micStatusIcon) micStatusIcon.textContent = '⚡';
        transcriptPreview.classList.add('active');
      } else {
        btnMic.classList.remove('listening');
        transcriptPreview.classList.remove('active');
        if (micLiveMeter) micLiveMeter.style.width = '0%';
      }
    },
    onSpeechFinal: (text) => {
      if (text && text.trim()) {
        chatInput.value = text;
        showToast(`Heard: "${text}"`, 'info');
        sendMessage();
      }
    },
    onSpeakingStart: () => {
      btnStop.style.display = 'flex';
      btnVoiceToggle.classList.add('voice-active');
    },
    onSpeakingEnd: () => {
      document.querySelectorAll('.btn-msg-action.speaking').forEach(b => b.classList.remove('speaking'));
      if (!state.isGenerating) {
        btnStop.style.display = 'none';
      }
    }
  });

  voiceEngine.autoSendSpeech = state.autoSendSpeech;

  // Initialize UI Values
  function syncUIFromState() {
    settingServerUrl.value = state.serverUrl;
    settingTemperature.value = state.temperature;
    tempValue.textContent = state.temperature;
    settingVoiceSpeed.value = state.voiceSpeed;
    speedValue.textContent = `${state.voiceSpeed.toFixed(1)}x`;
    settingAutoSpeak.checked = state.autoSpeak;
    settingAutoSendSpeech.checked = state.autoSendSpeech;
    settingSystemPrompt.value = state.systemPrompt;

    btnVoiceToggle.classList.toggle('voice-active', state.autoSpeak);
    voiceStatusLabel.textContent = `Kokoro: ${state.currentVoice}`;

    btnWebSearchToggle.classList.toggle('active', state.webSearch);
    webSearchToggleLabel.textContent = state.webSearch ? 'Search: ON' : 'Search: OFF';
  }

  syncUIFromState();

  // Load Models from LM Studio
  async function loadModels() {
    serverStatusText.textContent = 'Connecting...';
    serverStatusDot.className = 'status-dot';

    try {
      const data = await API.getModels(state.serverUrl);
      const modelList = data.data || [];
      state.models = modelList;

      headerModelSelect.innerHTML = '';
      modalModelSelect.innerHTML = '';

      if (modelList.length === 0) {
        const opt = new Option('No models loaded in LM Studio', '');
        headerModelSelect.add(opt);
        modalModelSelect.add(opt.cloneNode(true));
        serverStatusDot.className = 'status-dot online';
        serverStatusText.textContent = 'LM Studio (No models)';
        return;
      }

      modelList.forEach((m) => {
        const id = m.id;
        const opt1 = new Option(id, id);
        const opt2 = new Option(id, id);
        headerModelSelect.add(opt1);
        modalModelSelect.add(opt2);
      });

      // Select active model
      if (!state.currentModel || !modelList.some(m => m.id === state.currentModel)) {
        state.currentModel = modelList[0].id;
        localStorage.setItem('stella_model', state.currentModel);
      }

      headerModelSelect.value = state.currentModel;
      modalModelSelect.value = state.currentModel;

      serverStatusDot.className = 'status-dot online';
      serverStatusText.textContent = `LM Studio: ${modelList.length} model(s)`;
    } catch (err) {
      console.warn('Could not load models from LM Studio:', err);
      serverStatusDot.className = 'status-dot offline';
      serverStatusText.textContent = 'LM Studio Offline';

      headerModelSelect.innerHTML = '<option value="">LM Studio Offline</option>';
      modalModelSelect.innerHTML = '<option value="">LM Studio Offline</option>';
    }
  }

  // Load Kokoro Voices
  async function loadVoices() {
    try {
      const data = await API.getVoices();
      settingVoiceSelect.innerHTML = '';

      const categories = data.categories || {};
      for (const [catName, voiceList] of Object.entries(categories)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = catName;
        voiceList.forEach(v => {
          const opt = new Option(`${v.name} (${v.id})`, v.id);
          optgroup.appendChild(opt);
        });
        settingVoiceSelect.appendChild(optgroup);
      }

      // Check if currentVoice is selected
      if (state.currentVoice) {
        settingVoiceSelect.value = state.currentVoice;
      }
    } catch (err) {
      console.warn('Could not load Kokoro voices:', err);
    }
  }

  // Model Selection Handlers
  headerModelSelect.addEventListener('change', (e) => {
    state.currentModel = e.target.value;
    modalModelSelect.value = state.currentModel;
    localStorage.setItem('stella_model', state.currentModel);
    showToast(`Active model: ${state.currentModel}`, 'success');
  });

  modalModelSelect.addEventListener('change', (e) => {
    state.currentModel = e.target.value;
    headerModelSelect.value = state.currentModel;
    localStorage.setItem('stella_model', state.currentModel);
  });

  btnRefreshModels.addEventListener('click', async () => {
    btnRefreshModels.style.transform = 'rotate(360deg)';
    btnRefreshModels.style.transition = 'transform 0.6s ease';
    await loadModels();
    setTimeout(() => {
      btnRefreshModels.style.transform = 'none';
      btnRefreshModels.style.transition = 'none';
    }, 600);
    showToast('Refreshed models from LM Studio');
  });

  // Web Search Toggle Handler
  btnWebSearchToggle.addEventListener('click', () => {
    state.webSearch = !state.webSearch;
    localStorage.setItem('stella_web_search', state.webSearch);
    btnWebSearchToggle.classList.toggle('active', state.webSearch);
    webSearchToggleLabel.textContent = state.webSearch ? 'Search: ON' : 'Search: OFF';
    showToast(state.webSearch ? 'Web Search Enabled 🌐' : 'Web Search Disabled', 'info');
  });

  // Auto-speak Toggle in Header
  btnVoiceToggle.addEventListener('click', () => {
    state.autoSpeak = !state.autoSpeak;
    localStorage.setItem('stella_auto_speak', state.autoSpeak);
    btnVoiceToggle.classList.toggle('voice-active', state.autoSpeak);
    settingAutoSpeak.checked = state.autoSpeak;
    showToast(state.autoSpeak ? 'Auto-Speak Enabled (Kokoro)' : 'Auto-Speak Muted', 'info');
  });

  // Microphone Button Handler
  btnMic.addEventListener('click', async () => {
    if (voiceEngine.isListening) {
      voiceEngine.stopListening();
      btnMic.classList.remove('listening');
      transcriptPreview.classList.remove('active');
    } else {
      btnMic.classList.add('listening');
      transcriptText.textContent = 'Listening to your microphone...';
      transcriptPreview.classList.add('active');
      await voiceEngine.startListening();
    }
  });

  // Stop Button (Stops stream and speech)
  btnStop.addEventListener('click', () => {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
    voiceEngine.stopSpeaking();
    state.isGenerating = false;
    btnStop.style.display = 'none';
    statusBanner.style.display = 'none';
    showToast('Stopped generation & speech');
  });

  // Textarea auto-resize
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
    btnSend.disabled = !chatInput.value.trim();
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!btnSend.disabled && !state.isGenerating) {
        sendMessage();
      }
    }
  });

  btnSend.addEventListener('click', () => {
    if (!state.isGenerating && chatInput.value.trim()) {
      sendMessage();
    }
  });

  // Suggestion Cards click
  document.querySelectorAll('.suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt;
      if (prompt) {
        chatInput.value = prompt;
        sendMessage();
      }
    });
  });

  // Settings Modal Events
  btnOpenSettings.addEventListener('click', () => {
    settingsModal.classList.add('open');
  });

  btnCloseSettings.addEventListener('click', () => {
    settingsModal.classList.remove('open');
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.remove('open');
    }
  });

  btnTestServer.addEventListener('click', async () => {
    state.serverUrl = settingServerUrl.value.trim();
    localStorage.setItem('stella_server_url', state.serverUrl);
    await loadModels();
    showToast('LM Studio settings updated');
  });

  settingTemperature.addEventListener('input', (e) => {
    state.temperature = parseFloat(e.target.value);
    tempValue.textContent = state.temperature;
    localStorage.setItem('stella_temp', state.temperature);
  });

  settingVoiceSpeed.addEventListener('input', (e) => {
    state.voiceSpeed = parseFloat(e.target.value);
    speedValue.textContent = `${state.voiceSpeed.toFixed(1)}x`;
    localStorage.setItem('stella_speed', state.voiceSpeed);
  });

  settingVoiceSelect.addEventListener('change', (e) => {
    state.currentVoice = e.target.value;
    voiceStatusLabel.textContent = `Kokoro: ${state.currentVoice}`;
    localStorage.setItem('stella_voice', state.currentVoice);
  });

  btnPreviewVoice.addEventListener('click', async () => {
    btnPreviewVoice.disabled = true;
    btnPreviewVoice.textContent = '🔊 Playing...';
    try {
      const blob = await API.getVoicePreview(state.currentVoice, state.voiceSpeed);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        btnPreviewVoice.disabled = false;
        btnPreviewVoice.textContent = '🔊 Sample';
      };
      await audio.play();
    } catch (e) {
      showToast('Voice preview failed: ' + e.message, 'error');
      btnPreviewVoice.disabled = false;
      btnPreviewVoice.textContent = '🔊 Sample';
    }
  });

  settingAutoSpeak.addEventListener('change', (e) => {
    state.autoSpeak = e.target.checked;
    localStorage.setItem('stella_auto_speak', state.autoSpeak);
    btnVoiceToggle.classList.toggle('voice-active', state.autoSpeak);
  });

  settingAutoSendSpeech.addEventListener('change', (e) => {
    state.autoSendSpeech = e.target.checked;
    voiceEngine.autoSendSpeech = state.autoSendSpeech;
    localStorage.setItem('stella_auto_send', state.autoSendSpeech);
  });

  // Load and populate microphone devices
  async function loadAudioDevices() {
    if (!settingMicDevice) return;
    try {
      const devices = await voiceEngine.getAudioInputDevices();
      settingMicDevice.innerHTML = '<option value="">Default System Microphone</option>';
      devices.forEach((d, idx) => {
        const label = d.label || `Microphone ${idx + 1}`;
        const opt = new Option(label, d.deviceId);
        settingMicDevice.add(opt);
      });
      const savedMic = localStorage.getItem('stella_mic_device');
      if (savedMic && devices.some(d => d.deviceId === savedMic)) {
        settingMicDevice.value = savedMic;
        voiceEngine.selectedDeviceId = savedMic;
      }
    } catch (e) {
      console.warn('Could not enumerate audio devices:', e);
    }
  }

  settingMicDevice.addEventListener('change', (e) => {
    const devId = e.target.value;
    voiceEngine.setDevice(devId);
    showToast('Switched microphone device', 'success');
  });

  btnRefreshMics.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    await loadAudioDevices();
    showToast('Scanned microphone devices', 'info');
  });

  btnTestMic.addEventListener('click', async () => {
    if (isTestingMic) return;
    isTestingMic = true;
    btnTestMic.disabled = true;
    btnTestMic.textContent = 'Testing...';
    micTestStatus.textContent = 'Listening to microphone... speak now';
    micTestStatus.style.color = 'var(--accent-cyan)';

    await voiceEngine.startListening();

    setTimeout(async () => {
      await voiceEngine.stopListening(false);
      isTestingMic = false;
      btnTestMic.disabled = false;
      btnTestMic.textContent = 'Test Mic';
      micTestBarFill.style.width = '0%';
      if (micTestStatus.style.color === 'var(--success)') {
        micTestStatus.textContent = '✓ Microphone is verified and picking up audio!';
      } else {
        micTestStatus.textContent = 'No audio detected. Check your mic volume or switch device above.';
        micTestStatus.style.color = 'var(--warning)';
      }
    }, 4500);
  });

  settingSystemPrompt.addEventListener('change', (e) => {
    state.systemPrompt = e.target.value;
    localStorage.setItem('stella_sys_prompt', state.systemPrompt);
  });

  // New Chat
  btnNewChat.addEventListener('click', () => {
    if (state.isGenerating) {
      btnStop.click();
    }
    state.messages = [];
    messageList.innerHTML = '';
    welcomeHero.style.display = 'flex';
    chatInput.value = '';
    chatInput.style.height = 'auto';
    btnSend.disabled = true;
    showToast('Started new conversation');
  });

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // Escape closes modal or stops voice
    if (e.key === 'Escape') {
      if (settingsModal.classList.contains('open')) {
        settingsModal.classList.remove('open');
      } else if (voiceEngine.isSpeaking || state.isGenerating) {
        btnStop.click();
      }
    }
  });

  // Send Message Flow
  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || state.isGenerating) return;

    // Immediately flag isGenerating to prevent race conditions
    state.isGenerating = true;

    // Stop any ongoing speech before starting a new turn
    voiceEngine.stopSpeaking();

    // Hide welcome hero
    welcomeHero.style.display = 'none';

    // Append user message
    const userMsg = { role: 'user', content: text };
    state.messages.push(userMsg);
    renderMessage(userMsg);

    chatInput.value = '';
    chatInput.style.height = 'auto';
    btnSend.disabled = true;

    // Show status banner
    statusBanner.style.display = 'flex';
    statusBannerText.textContent = state.webSearch ? 'Searching web & preparing response...' : 'Stella is thinking...';
    btnStop.style.display = 'flex';

    // Assistant message placeholder
    const assistantMsg = { role: 'assistant', content: '', sources: [] };
    const { bubbleEl, contentEl, sourcesContainer, speakBtn } = createAssistantMessageElement();

    state.abortController = new AbortController();

    let accumulatedContent = '';
    let hasCompleted = false;

    const finishResponse = () => {
      if (hasCompleted) return;
      hasCompleted = true;

      statusBanner.style.display = 'none';
      state.isGenerating = false;
      state.abortController = null;
      state.messages.push(assistantMsg);

      // Auto-speak if enabled
      if (state.autoSpeak && accumulatedContent.trim()) {
        speakBtn.classList.add('speaking');
        voiceEngine.speak(accumulatedContent, state.currentVoice, state.voiceSpeed).then(() => {
          speakBtn.classList.remove('speaking');
        });
      } else {
        btnStop.style.display = 'none';
      }
    };

    await API.streamChat({
      messages: state.messages,
      model: state.currentModel,
      webSearch: state.webSearch,
      systemPrompt: state.systemPrompt,
      temperature: state.temperature,
      serverUrl: state.serverUrl,
      signal: state.abortController.signal,
      onSources: (sources) => {
        assistantMsg.sources = sources;
        renderSources(sourcesContainer, sources);
        statusBannerText.textContent = 'Synthesizing verified web information...';
      },
      onDelta: (chunk) => {
        statusBanner.style.display = 'none';
        accumulatedContent += chunk;
        assistantMsg.content = accumulatedContent;
        if (window.marked) {
          contentEl.innerHTML = marked.parse(accumulatedContent);
        } else {
          contentEl.textContent = accumulatedContent;
        }
        chatViewport.scrollTop = chatViewport.scrollHeight;
      },
      onError: (err) => {
        statusBanner.style.display = 'none';
        state.isGenerating = false;
        state.abortController = null;
        btnStop.style.display = 'none';
        showToast(err, 'error');
        contentEl.innerHTML += `<div style="color:var(--danger); margin-top:8px;">⚠️ ${err}</div>`;
      },
      onDone: () => {
        finishResponse();
      }
    });
  }

  // Render User Message
  function renderMessage(msg) {
    const row = document.createElement('div');
    row.className = `message-row ${msg.role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = msg.role === 'user' ? '👤' : '✨';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = msg.content;

    row.appendChild(avatar);
    row.appendChild(bubble);
    messageList.appendChild(row);
    chatViewport.scrollTop = chatViewport.scrollHeight;
  }

  // Create Assistant Message with live elements
  function createAssistantMessageElement() {
    const row = document.createElement('div');
    row.className = 'message-row assistant';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '✨';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const sourcesContainer = document.createElement('div');
    sourcesContainer.className = 'search-sources-bar';
    sourcesContainer.style.display = 'none';

    const contentEl = document.createElement('div');
    contentEl.className = 'markdown-content';

    const footer = document.createElement('div');
    footer.className = 'message-footer';

    const speakBtn = document.createElement('button');
    speakBtn.className = 'btn-msg-action';
    speakBtn.innerHTML = '<span>🔊</span> <span>Speak</span>';
    speakBtn.title = 'Speak using Kokoro TTS';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-msg-action';
    copyBtn.innerHTML = '<span>📋</span> <span>Copy</span>';
    copyBtn.title = 'Copy message';

    speakBtn.addEventListener('click', () => {
      if (voiceEngine.isSpeaking && speakBtn.classList.contains('speaking')) {
        voiceEngine.stopSpeaking();
        speakBtn.classList.remove('speaking');
        return;
      }
      document.querySelectorAll('.btn-msg-action.speaking').forEach(b => b.classList.remove('speaking'));
      speakBtn.classList.add('speaking');
      voiceEngine.speak(contentEl.innerText, state.currentVoice, state.voiceSpeed).then(() => {
        speakBtn.classList.remove('speaking');
      });
    });

    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(contentEl.innerText);
      copyBtn.innerHTML = '<span>✓</span> <span>Copied</span>';
      setTimeout(() => {
        copyBtn.innerHTML = '<span>📋</span> <span>Copy</span>';
      }, 2000);
    });

    footer.appendChild(speakBtn);
    footer.appendChild(copyBtn);

    bubble.appendChild(sourcesContainer);
    bubble.appendChild(contentEl);
    bubble.appendChild(footer);

    row.appendChild(avatar);
    row.appendChild(bubble);
    messageList.appendChild(row);

    return { row, bubbleEl: bubble, contentEl, sourcesContainer, speakBtn };
  }

  // Render Web Sources
  function renderSources(container, sources) {
    if (!sources || sources.length === 0) return;

    container.style.display = 'block';
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'search-sources-header';
    header.innerHTML = `
      <span>🌐 Web Sources (${sources.length})</span>
      <span style="font-size:0.75rem;">▼ Click to expand</span>
    `;

    const list = document.createElement('div');
    list.className = 'search-sources-list';

    sources.forEach((s, idx) => {
      const item = document.createElement('a');
      item.className = 'search-source-item';
      item.href = s.href;
      item.target = '_blank';
      item.rel = 'noopener noreferrer';

      item.innerHTML = `
        <div class="source-title">[${idx + 1}] ${escapeHtml(s.title || 'Source')}</div>
        <div class="source-snippet">${escapeHtml(s.body || '')}</div>
      `;
      list.appendChild(item);
    });

    header.addEventListener('click', () => {
      container.classList.toggle('expanded');
    });

    container.appendChild(header);
    container.appendChild(list);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize data
  await loadModels();
  await loadVoices();
  await loadAudioDevices();
});
