// js/record.js
// Full evaluator with Interview / Presentation / Daily Conversation modes.
// - mirrored preview + mirrored frames for detection
// - beeps on direction, red border on look-away
// - wrist-on-chin => displays Nervous and speaks a friendly "Don't be nervous, friend!" (throttled)
// - speech recognition (interim suggestions no counting; final results increment filler counts accurately)
// - suggestion popup and virtual female agent (throttled, per-filler + global)
// - audio recording and report download
// - Interview: Q -> listen -> evaluate -> next
// - Presentation: script generation -> listen -> judge
// - Daily Conversation: interactive prompts with suggested answers and keyword-based judging

(() => {
  // ---------- DOM ----------
  const startVideoBtn = document.getElementById("startVideo");
  const startAudioBtn = document.getElementById("startAudio");
  const stopBtn = document.getElementById("stopRecording");
  const preview = document.getElementById("preview");
  const audioPlayback = document.getElementById("audioPlayback");
  const timerDisplay = document.getElementById("timerDisplay");
  const feedbackText = document.getElementById("feedbackText");
  const toneAnalysis = document.getElementById("toneAnalysis");
  const transcriptBox = document.getElementById("transcriptBox");
  const progressFill = document.getElementById("progressFill");
  const practiceCounter = document.getElementById("practiceCounter");
  const downloadReportBtn = document.getElementById("downloadReport");
  const practiceSelect = document.getElementById("practiceType");

  // New controls (optional, but recommended)
  const nextQuestionBtn = document.getElementById("nextQuestionBtn");
  const listeningIndicator = document.getElementById("listeningIndicator");

  if (listeningIndicator) listeningIndicator.style.display = "none";

  preview.style.transition = "box-shadow 160ms ease, border 160ms ease";
  preview.style.transform = "scaleX(-1)"; // mirror visually

  // ---------- State ----------
  let holistic = null;
  let running = false;
  let startTime = null;
  let timerInterval = null;
  let sessionCount = 0;
  let frameCounter = 0;

  // mirror canvas for feeding Mediapipe
  const MIRROR_WIDTH = 640;
  const MIRROR_HEIGHT = 480;
  const mirrorCanvas = document.createElement("canvas");
  mirrorCanvas.width = MIRROR_WIDTH;
  mirrorCanvas.height = MIRROR_HEIGHT;
  const mirrorCtx = mirrorCanvas.getContext("2d");

  // media & audio recording
  let cameraStream = null;
  let sessionAudioRecorder = null;
  let sessionAudioChunks = [];

  // speech recognition & filler tracking
  let recognition = null;
  const fillerList = ["and","so","ok","ah","hmm","um","uh","like","umm","uhm"];
  let fillerCounts = {};
  fillerList.forEach(w => fillerCounts[w] = 0);
  let cumulativeTranscript = "";

  // detection counters
  let fidgetCounter = 0;
  let eyeContactCounter = 0;
  let lookAwayCounter = 0;

  // head/eye/wrist state
  let lastDirection = null;
  let eyesOpen = true;
  let lastBeepAt = 0;

  // nervous detection speech throttle
  let lastNervousSpokenAt = 0;
  const NERVOUS_SPEECH_COOLDOWN = 6000; // ms

  // thresholds
  const UPDATE_FREQUENCY = 20;
  const YAW_THRESHOLD = 0.03;
  const PITCH_THRESHOLD = 0.025;
  const BLINK_RATIO_THRESHOLD = 0.18;
  const WRIST_CHIN_DISTANCE_THRESHOLD = 0.06;

  // Mediapipe indices
  const LEFT_IRIS_IDX = 468;
  const RIGHT_IRIS_IDX = 473;
  const LEFT_EYE_TOP = 159;
  const LEFT_EYE_BOTTOM = 145;
  const RIGHT_EYE_TOP = 386;
  const RIGHT_EYE_BOTTOM = 374;
  const LEFT_EYE_IDX = 33;
  const RIGHT_EYE_IDX = 263;
  const NOSE_TIP = 1;
  const CHIN_IDX = 152;

  // AudioCtx for beeps
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = AudioCtx ? new AudioCtx() : null;

  // ---------- Suggestion map ----------
  const suggestionMap = {
    "and": ["however", "additionally", "in terms of", "for example", "about", "moreover"],
    "so": ["therefore", "as a result", "consequently", "thus"],
    "like": ["such as", "for example", "for instance", "similar to"],
    "um": ["(pause)"],
    "uh": ["(pause)"],
    "umm": ["(pause)"],
    "uhm": ["(pause)"],
    "ah": ["(pause)"],
    "hmm": ["(pause)"],
    "ok": ["all right", "very well", "understood"]
  };

  // ---------- Suggestion UI ----------
  const suggestionContainerId = "fillerSuggestionBox";
  function ensureSuggestionContainer() {
    if (document.getElementById(suggestionContainerId)) return;
    const c = document.createElement("div");
    c.id = suggestionContainerId;
    c.style.position = "absolute";
    c.style.background = "#fff";
    c.style.border = "1px solid rgba(0,0,0,0.12)";
    c.style.boxShadow = "0 8px 22px rgba(0,0,0,0.14)";
    c.style.padding = "10px 12px";
    c.style.borderRadius = "8px";
    c.style.zIndex = 9999;
    c.style.maxWidth = "360px";
    c.style.fontFamily = "system-ui, Arial, sans-serif";
    c.style.display = "none";
    c.style.transition = "opacity 160ms ease";
    c.style.opacity = "0";
    document.body.appendChild(c);
  }

  function positionSuggestionContainer() {
    const c = document.getElementById(suggestionContainerId);
    if (!c) return;
    const rect = preview.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      c.style.left = Math.max(window.innerWidth - 380, 8) + "px";
      c.style.top = Math.max(window.innerHeight - 200, 8) + "px";
      return;
    }
    const desiredLeft = rect.right + 8;
    const desiredTop = rect.top + 8;
    if (desiredLeft + 360 > window.innerWidth) {
      c.style.left = Math.max(rect.left + rect.width - 360 - 8, 8) + "px";
      c.style.top = Math.max(rect.top + 8, 8) + "px";
    } else {
      c.style.left = Math.max(desiredLeft, 8) + "px";
      c.style.top = Math.max(desiredTop, 8) + "px";
    }
  }

  function showSuggestionFor(fillerWord) {
    ensureSuggestionContainer();
    const container = document.getElementById(suggestionContainerId);
    const rawSuggestions = suggestionMap[fillerWord] || [];
    const suggestions = rawSuggestions.map(s => (s||"").toString().trim()).filter(s => s.length > 0);
    container.innerHTML = "";
    // arrow
    const arrow = document.createElement("div");
    arrow.className = "sugg-arrow";
    arrow.style.position = "absolute";
    arrow.style.width = "0";
    arrow.style.height = "0";
    arrow.style.borderLeft = "6px solid transparent";
    arrow.style.borderRight = "6px solid transparent";
    arrow.style.borderTop = "8px solid #fff";
    arrow.style.left = "12px";
    arrow.style.top = "-8px";
    container.appendChild(arrow);

    const title = document.createElement("div");
    title.style.fontWeight = 700;
    title.style.marginBottom = "8px";
    title.textContent = `Instead of "${fillerWord}" try:`;
    container.appendChild(title);

    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexWrap = "wrap";
    list.style.gap = "8px";

    const finalSuggestions = suggestions.length ? suggestions : ["(pause)"];

    finalSuggestions.forEach(s => {
      const btn = document.createElement("button");
      btn.style.border = "1px solid rgba(0,0,0,0.08)";
      btn.style.padding = "6px 10px";
      btn.style.borderRadius = "6px";
      btn.style.background = "#fff";
      btn.style.cursor = "pointer";
      btn.style.minWidth = "90px";
      btn.style.textAlign = "center";
      btn.style.color = "#111";
      btn.style.fontSize = "13px";
      btn.style.lineHeight = "1.2";
      btn.style.textTransform = "none";
      btn.textContent = s;
      btn.onclick = () => {
        try {
          navigator.clipboard?.writeText(s).then(()=> showTempMessage(`Copied: "${s}"`)).catch(()=> showTempMessage(`Copied: "${s}"`));
        } catch (e) {
          showTempMessage(`Copied: "${s}"`);
        }
      };
      list.appendChild(btn);
    });

    container.appendChild(list);
    positionSuggestionContainer();
    container.style.display = "block";
    setTimeout(()=> { container.style.opacity = "1"; }, 10);
    if (container._hideTimeout) clearTimeout(container._hideTimeout);
    container._hideTimeout = setTimeout(() => {
      container.style.opacity = "0";
      setTimeout(()=> { container.style.display = "none"; }, 180);
    }, 6000);
  }

  function showTempMessage(msg, ttl=1200) {
    ensureSuggestionContainer();
    const container = document.getElementById(suggestionContainerId);
    if (!container) return;
    let toast = container.querySelector(".sugg-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "sugg-toast";
      toast.style.marginTop = "8px";
      toast.style.fontSize = "13px";
      toast.style.opacity = "0.95";
      container.appendChild(toast);
    }
    toast.textContent = msg;
    if (toast._hide) clearTimeout(toast._hide);
    toast._hide = setTimeout(() => { toast.textContent = ""; }, ttl);
  }

  // ---------- Utilities ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }

  function formatDuration(ms) {
    const total = Math.floor(ms / 1000);
    const mm = Math.floor(total / 60).toString().padStart(2, "0");
    const ss = (total % 60).toString().padStart(2, "0");
    return `${mm}:${ss}`;
  }

  // Beep generator
  function playBeep(freq = 880, dur = 90) {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
    const now = performance.now();
    if (now - lastBeepAt < 180) return; // throttle
    lastBeepAt = now;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    o.connect(g);
    g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.22, audioCtx.currentTime + 0.01);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur/1000);
    setTimeout(()=>{ try{o.stop();}catch(e){} }, dur+30);
  }

  // Timer
  function startTimer() {
    startTime = performance.now();
    timerInterval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      timerDisplay.textContent = `Duration: ${formatDuration(elapsed)}`;
    }, 250);
  }
  function stopTimer() {
    clearInterval(timerInterval);
    timerDisplay.textContent = `Duration: 00:00`;
  }

  // Feedback setter
  function setFeedback(mainText, extraHtml = "") {
    feedbackText.textContent = mainText;
    toneAnalysis.innerHTML = extraHtml;
  }

  // ---------- Speech Synthesis warm-up ----------
  (function warmUpVoices() {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.getVoices();
  })();

  // ---------- Virtual female agent (throttled) ----------
  const _lastSpokenFor = {}; // per-filler timestamp
  let _lastGlobalSpoken = 0; // global timestamp
  let _lastUtterText = "";   // prevent exact duplicate repeat

  function speakTextOnce(text, preferFemale=true) {
    try {
      if (!("speechSynthesis" in window)) return;
      if (!text || !text.trim()) return;
      const now = Date.now();
      if (text === _lastUtterText && now - _lastGlobalSpoken < 3000) return;
      _lastUtterText = text; _lastGlobalSpoken = now;
      const utter = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length) {
        let voice = null;
        if (preferFemale) voice = voices.find(v => /female|woman|samantha|zira|google/i.test(v.name)) || voices.find(v => /female/i.test(v.name));
        if (!voice) voice = voices.find(v => /en-?us|en-?gb|english/i.test(v.lang)) || voices[0];
        if (voice) utter.voice = voice;
      }
      utter.rate = 0.95; utter.pitch = 1.05;
      if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
      return utter;
    } catch (e) { console.warn("speakTextOnce err", e); }
  }

  // ---------- speakSuggestion (virtual agent quick tip) ----------
  const _spokenPerFiller = {};
  let _spokenGlobalAt = 0;
  let _lastUtter = "";
  function speakSuggestion(fillerWord) {
    try {
      if (!("speechSynthesis" in window)) return;
      const now = Date.now();
      const perFillerCooldown = 6000;
      const globalCooldown = 3000;
      const lastFor = _spokenPerFiller[fillerWord] || 0;
      if (now - lastFor < perFillerCooldown) return;
      if (now - _spokenGlobalAt < globalCooldown) return;
      const altList = suggestionMap[fillerWord] || [];
      const spokenAlts = altList.slice(0,2).join(", ");
      const utterText = spokenAlts ? `Tip: instead of ${fillerWord}, you can say ${spokenAlts}.` : `Try pausing instead of ${fillerWord}.`;
      if (utterText === _lastUtter) return;
      _lastUtter = utterText;
      _spokenPerFiller[fillerWord] = now; _spokenGlobalAt = now;
      const utt = new SpeechSynthesisUtterance(utterText);
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length) utt.voice = voices.find(v => /female|woman|samantha|zira|google/i.test(v.name)) || voices[0];
      utt.rate = 0.95; utt.pitch = 1.05;
      if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utt);
    } catch (e) { console.warn(e); }
  }

  // ---------- SpeechRecognition setup ----------
  // We'll use recognition to both count fillers and detect end-of-answer via a silence timer.
  let lastRecognitionResultAt = 0;
  let silenceTimer = null;
  const SHORT_SILENCE_MS = 60000; // 60s of silence => treat as finished answer
  const IDLE_PROMPT_MS = 20000; // 20s idle -> ask "Are you there?"
  let idlePromptTimer = null;
  let awaitingConfirmation = false; // when agent asked "Are you there?"
  const YES_WORDS = ["yes","yeah","yep","yup","i'm here","i am here","here"];

  let agentWaitingForAnswer = false;
  let currentAnswerBuffer = "";

  function setupSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      console.warn("SpeechRecognition not supported. Filler suggestions disabled.");
      recognition = null;
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      if (listeningIndicator) listeningIndicator.style.display = "inline";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const txt = (res[0].transcript || "").trim();
        lastRecognitionResultAt = Date.now();

        // awaiting confirmation from idle prompt (Are you there?)
        if (awaitingConfirmation) {
          if (res.isFinal) {
            const low = txt.toLowerCase();
            for (let w of YES_WORDS) {
              if (low.includes(w)) {
                awaitingConfirmation = false;
                clearIdlePrompt();
                speakTextOnce("Great — continuing.");
                // resume flow based on mode
                setTimeout(() => {
                  if (running && practiceSelect && practiceSelect.value === 'interview') agentAskQuestionAndListen();
                  else if (running && practiceSelect && practiceSelect.value === 'presentation') agentAskToStartPresentation();
                  else if (running && practiceSelect && practiceSelect.value === 'daily') agentAskDailyQuestionAndListen();
                }, 700);
                return;
              }
            }
          }
        }

        // if agent waiting for answer collect buffer
        if (agentWaitingForAnswer) {
          if (!res.isFinal) {
            currentAnswerBuffer = txt;
            resetSilenceTimer();
          } else {
            currentAnswerBuffer = (currentAnswerBuffer ? currentAnswerBuffer + " " : "") + txt;
            processFinalTranscriptForFillers(txt);
            transcriptBox.innerText = txt + "\n" + transcriptBox.innerText;
            transcriptBox.innerText = transcriptBox.innerText.split("\n").slice(0,30).join("\n");
            updateFillerUI();
            resetSilenceTimer();
          }
        } else {
          // not waiting — treat final results normally
          if (res.isFinal) {
            cumulativeTranscript += txt + " ";
            processFinalTranscriptForFillers(txt);
            transcriptBox.innerText = txt + "\n" + transcriptBox.innerText;
            transcriptBox.innerText = transcriptBox.innerText.split("\n").slice(0,30).join("\n");
            updateFillerUI();
          } else {
            processInterimTranscriptForSuggestions(txt);
          }
        }
      }

      if (listeningIndicator) {
        if (listeningIndicator._hide) clearTimeout(listeningIndicator._hide);
        listeningIndicator._hide = setTimeout(()=>{ listeningIndicator.style.display = "none"; }, 1200);
      }
    };

    recognition.onend = () => {
      if (running) {
        try { recognition.start(); } catch (e) {}
      }
    };
    recognition.onerror = (e) => {
      console.warn("SpeechRecognition error", e);
      if (listeningIndicator) listeningIndicator.style.display = "none";
    };
  }

  function startSpeechRecognition() {
    if (!recognition) setupSpeechRecognition();
    if (!recognition) return;
    try { recognition.start(); } catch (e) {}
  }
  function stopSpeechRecognition() {
    if (!recognition) return;
    try { recognition.onend = null; recognition.stop(); } catch (e) {}
    if (listeningIndicator) listeningIndicator.style.display = "none";
  }

  // silence/idle helpers
  function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (agentWaitingForAnswer) finishCurrentAnswer();
    }, SHORT_SILENCE_MS);
    resetIdlePromptTimer();
  }
  function resetIdlePromptTimer() {
    if (idlePromptTimer) clearTimeout(idlePromptTimer);
    idlePromptTimer = setTimeout(() => {
      if (agentWaitingForAnswer) {
        awaitingConfirmation = true;
        speakTextOnce("Are you there?");
        idlePromptTimer = setTimeout(() => {
          if (awaitingConfirmation) {
            awaitingConfirmation = false;
            speakTextOnce("I'll move on. When you're ready, you can answer again.");
            finishCurrentAnswer();
          }
        }, 15000);
      }
    }, IDLE_PROMPT_MS);
  }
  function clearIdlePrompt() {
    if (idlePromptTimer) { clearTimeout(idlePromptTimer); idlePromptTimer = null; }
    awaitingConfirmation = false;
  }

  // interim suggestion processor
  function processInterimTranscriptForSuggestions(text) {
    const words = (text || "").toLowerCase().split(/\W+/).filter(Boolean);
    const seen = new Set();
    for (let w of words) {
      if (fillerList.includes(w) && !seen.has(w)) {
        seen.add(w);
        try { showSuggestionFor(w); } catch (e) {}
      }
    }
  }

  // final transcription counting
  function processFinalTranscriptForFillers(text) {
    const words = (text || "").toLowerCase().split(/\W+/).filter(Boolean);
    for (let w of words) {
      if (fillerList.includes(w)) {
        fillerCounts[w] = (fillerCounts[w] || 0) + 1;
        try { showSuggestionFor(w); } catch (e) {}
        speakSuggestion(w);
      }
    }
  }

  function updateFillerUI() {
    const total = Object.values(fillerCounts).reduce((a,b)=>a+b,0);
    const parts = [`Fillers:${total}`, Object.entries(fillerCounts).map(([k,v])=>`${k}:${v}`).join(" · ")];
    const main = feedbackText.textContent.split("\n")[0] || "";
    setFeedback(main + "\n" + parts.join("\n"), toneAnalysis.innerHTML || "");
  }

  // ---------- Helpers for pose/face ----------
  function computeEyeOpenRatio(face) {
    if (!face || face.length <= Math.max(LEFT_EYE_TOP, RIGHT_EYE_BOTTOM)) return 1.0;
    const ltop = face[LEFT_EYE_TOP], lbot = face[LEFT_EYE_BOTTOM];
    const rtop = face[RIGHT_EYE_TOP], rbot = face[RIGHT_EYE_BOTTOM];
    const ldist = Math.hypot(ltop.x - lbot.x, ltop.y - lbot.y);
    const rdist = Math.hypot(rtop.x - rbot.x, rtop.y - rbot.y);
    const leftCenter = face[LEFT_EYE_IDX], rightCenter = face[RIGHT_EYE_IDX];
    const inter = Math.hypot(leftCenter.x - rightCenter.x, leftCenter.y - rightCenter.y);
    if (inter === 0) return 1.0;
    return (ldist + rdist) / (2 * inter);
  }

  function normDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function setPreviewRedBorder(on) {
    if (on) {
      preview.style.boxShadow = "0 0 0 4px rgba(255,0,0,0.95)";
      preview.style.border = "2px solid rgba(255,0,0,0.9)";
      preview.style.borderRadius = "6px";
    } else {
      preview.style.boxShadow = "";
      preview.style.border = "none";
      preview.style.borderRadius = "";
    }
  }

  // ---------- Frame evaluator ----------
  function evaluateFrame(results) {
    frameCounter++;
    const face = results.faceLandmarks || null;
    const leftHand = (results.leftHandLandmarks && results.leftHandLandmarks.length>0) ? results.leftHandLandmarks : null;
    const rightHand = (results.rightHandLandmarks && results.rightHandLandmarks.length>0) ? results.rightHandLandmarks : null;

    // iris center (eye contact)
    if (face && face.length > Math.max(LEFT_IRIS_IDX, RIGHT_IRIS_IDX)) {
      const li = face[LEFT_IRIS_IDX], ri = face[RIGHT_IRIS_IDX];
      const irisX = (li.x + ri.x) / 2;
      const dev = Math.abs(irisX - 0.5);
      const lookingAtCamera = (dev < 0.20);
      if (lookingAtCamera) eyeContactCounter++; else lookAwayCounter++;
    }

    // blink detection
    const eyeOpenRatio = computeEyeOpenRatio(face);
    eyesOpen = (eyeOpenRatio > BLINK_RATIO_THRESHOLD);

    // wrists (landmark 0 of hand is wrist)
    const leftWrist = leftHand ? leftHand[0] : null;
    const rightWrist = rightHand ? rightHand[0] : null;

    // head orientation (yaw/pitch)
    let yaw = null, pitch = null;
    if (face && face.length > CHIN_IDX) {
      const nose = face[NOSE_TIP], leftEye = face[LEFT_EYE_IDX], rightEye = face[RIGHT_EYE_IDX];
      if (nose && leftEye && rightEye) {
        yaw = nose.x - ((leftEye.x + rightEye.x)/2.0);
        pitch = nose.y - ((leftEye.y + rightEye.y)/2.0);
      }
    }

    // determine direction when eyes open
    let direction = 'center';
    if (typeof yaw === 'number' && typeof pitch === 'number' && eyesOpen) {
      if (yaw > YAW_THRESHOLD) direction = 'right';
      else if (yaw < -YAW_THRESHOLD) direction = 'left';
      else if (pitch > PITCH_THRESHOLD) direction = 'down';
      else if (pitch < -PITCH_THRESHOLD) direction = 'up';
      else direction = 'center';
    }

    // beep on direction transition (not during blink)
    if (direction !== lastDirection && eyesOpen) {
      const freqMap = { left: 600, right: 1200, up: 1600, down: 420, center: null };
      const freq = freqMap[direction];
      if (freq) playBeep(freq, 90);
    }
    lastDirection = direction;

    // red border on away directions while eyes open
    const showRed = (direction === 'left' || direction === 'right' || direction === 'up' || direction === 'down') && eyesOpen;
    setPreviewRedBorder(showRed);

    // wrist-on-chin detection for nervousness
    let nervous = false;
    if (face && face.length > CHIN_IDX) {
      const chin = face[CHIN_IDX];
      if (leftWrist && normDist(leftWrist, chin) < WRIST_CHIN_DISTANCE_THRESHOLD) nervous = true;
      if (rightWrist && normDist(rightWrist, chin) < WRIST_CHIN_DISTANCE_THRESHOLD) nervous = true;
    }

    // If nervous detected, speak friendly encouragement (throttled)
    if (nervous) {
      const now = Date.now();
      if (now - lastNervousSpokenAt > NERVOUS_SPEECH_COOLDOWN) {
        lastNervousSpokenAt = now;
        try {
          if ("speechSynthesis" in window) {
            const voices = window.speechSynthesis.getVoices();
            let voice = null;
            if (voices && voices.length) {
              voice = voices.find(v => /female|woman|samantha|zira|google uk english female/i.test(v.name))
                      || voices.find(v => /female/i.test(v.name))
                      || voices.find(v => /en-?us|en-?gb|english/i.test(v.lang))
                      || voices[0];
            }
            const utt = new SpeechSynthesisUtterance("Don't be nervous, friend. Breathe slowly and continue.");
            if (voice) utt.voice = voice;
            utt.rate = 0.95; utt.pitch = 1.05;
            if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utt);
          }
        } catch (e) {
          console.warn("nervous speak failed", e);
        }
      }
    }

    // Update UI periodically
    if (frameCounter % UPDATE_FREQUENCY === 0) {
      const totalFillers = Object.values(fillerCounts).reduce((a,b)=>a+b,0);
      const eyePct = Math.round(100 * (eyeContactCounter / Math.max(1, frameCounter)));
      const mainParts = [
        `${eyesOpen ? (eyePct > 30 ? "✅ Eyes: On-camera" : "❌ Eyes: Away") : "🙈 Eyes: Blink"}`,
        `Direction: ${direction}`,
        `Filler words: ${totalFillers}`,
      ];
      const toneHtml = `
        <div style="font-weight:600;margin-bottom:6px;">
          ${nervous ? '😰 Nervous (wrist-on-chin)' : '💪 Confident'}
        </div>
        <ul style="margin:6px 0;padding-left:18px;">
          <li>Estimated confidence: ${nervous ? 'Low' : 'High'}</li>
          <li>Fidgets (est): ${fidgetCounter}</li>
        </ul>
      `;
      setFeedback(mainParts.join(" · "), toneHtml);
      updateFillerUI();
      const prog = Math.min(100, sessionCount * 5 + Math.min(50, eyePct / 2));
      progressFill.style.width = prog + "%";
      practiceCounter.textContent = `Total Practice Sessions: ${sessionCount}`;
    }
  }

  // ---------- Interview Questions & suggested answers ----------
  const interviewQuestions = [
    "Hello! Let's start. Tell me about yourself and your background.",
    "Why are you interested in this role?",
    "Describe a challenging situation you faced and how you resolved it.",
    "What is your greatest strength and one area you want to improve?",
    "Where do you see yourself in five years?",
    "Tell me about a time you worked in a team and contributed to success."
  ];
  const suggestedAnswers = [
    "I am a software developer with experience focusing on front-end development. I enjoy creating user-friendly, accessible applications. In my last role I improved a key user flow by optimizing data fetches and simplifying the UI, which increased engagement. Outside work I contribute to open-source and study UX design.",
    "This role matches my passion for building products that help users. The company's mission aligns with my values and I want to grow technically while contributing to larger-scale engineering problems. I believe my background and eagerness to learn would help me add value.",
    "At my previous job a service timed out under load. I added monitoring, introduced caching and retry logic, and coordinated a rollout with the backend team, which reduced errors and improved experience. I learned the importance of observability and cross-team collaboration.",
    "My greatest strength is breaking down complex problems and delivering practical solutions under pressure. One area I'm improving is public speaking: I practice demos and short presentations to build clarity and confidence.",
    "In five years I'd like to be in a senior role where I lead projects and mentor others. I want to combine technical expertise with product thinking to deliver meaningful features and help teams operate effectively.",
    "We had a tight deadline where I improved testing and CI, suggested smoke tests, and helped automate part of the release. This reduced regressions and helped the team meet deadlines with fewer issues."
  ];

  // ---------- Daily conversation prompts & suggested answers ----------
  const dailyPrompts = [
    "Tell me about your day — what was the highlight?",
    "Describe a hobby you enjoy and why you like it.",
    "If you could travel anywhere next week, where would you go and why?",
    "Talk about a recent movie, show, or book you enjoyed.",
    "What is one small habit you find helps your productivity?"
  ];
  const dailySuggestedAnswers = [
    "Today I had a busy but rewarding day. The highlight was completing a project task that had been blocking my team. We celebrated a small win and I felt motivated heading into the evening.",
    "I enjoy painting as a hobby — it helps me relax and think creatively. I like experimenting with colors and textures; it's a calming way to express ideas outside of work.",
    "I'd travel to Kyoto because I love the mix of culture, gardens, and food. Walking temple grounds and trying local cuisine would be refreshing after a busy season.",
    "I recently enjoyed a movie that explored human relationships with humor and warmth. The character development was great and the soundtrack stuck with me afterward.",
    "A small habit that helps me is planning a two-item priority list each morning. It keeps my day focused and reduces decision fatigue while ensuring I get the most important tasks done."
  ];

  // ---------- Daily helper: keyword extraction ----------
  function extractKeywordsFrom(text, max=12) {
    if (!text) return [];
    const cleaned = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const freq = {};
    tokens.forEach(t => {
      if (t.length <= 2) return; // skip tiny words
      freq[t] = (freq[t] || 0) + 1;
    });
    const sorted = Object.keys(freq).sort((a,b) => freq[b]-freq[a]);
    return sorted.slice(0, max);
  }

  // ---------- Stammer detection ----------
  function detectStammerInText(text) {
    if (!text) return false;
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s\-]/g, " ");
    const tokens = normalized.split(/\s+/).filter(Boolean);
    for (let i = 0; i + 2 < tokens.length; i++) {
      if (tokens[i] === tokens[i+1] && tokens[i+1] === tokens[i+2]) return true;
    }
    if (/\b([a-z])(?:[\s\-]*\1){2,}\b/i.test(text)) return true;
    const shortWords = tokens.filter(w => w.length <= 2).length;
    if (tokens.length >= 6 && shortWords / tokens.length > 0.28) return true;
    return false;
  }

  // ---------- Suggested answer box ----------
  function ensureSuggestedAnswerBox() {
    if (document.getElementById("smarttalk_suggested")) return;
    const box = document.createElement("div");
    box.id = "smarttalk_suggested";
    box.style.position = "absolute";
    box.style.right = "18px";
    box.style.top = "60px";
    box.style.zIndex = 9998;
    box.style.background = "#fff";
    box.style.border = "1px solid rgba(0,0,0,0.08)";
    box.style.padding = "12px";
    box.style.borderRadius = "10px";
    box.style.boxShadow = "0 8px 20px rgba(0,0,0,0.08)";
    box.style.display = "none";
    box.style.maxWidth = "520px";
    box.style.fontFamily = "system-ui, Arial, sans-serif";
    box.style.lineHeight = "1.35";
    document.body.appendChild(box);
  }

  function showSuggestedAnswer(text) {
    ensureSuggestedAnswerBox();
    const box = document.getElementById("smarttalk_suggested");
    box.innerHTML = `<strong style="display:block;margin-bottom:8px">Suggested answer / script</strong><div style="font-size:14px;color:#0f172a;">${(text||"(no suggestion)")}</div>`;
    box.style.display = "block";
  }

  function hideSuggestedAnswer() {
    const b = document.getElementById("smarttalk_suggested");
    if (b) b.style.display = "none";
  }

  // ---------- Interview flow helpers ----------
  let interviewIndex = 0;
  let interviewActive = false;
  let presentationActive = false;
  let dailyActive = false;

  function pickNextInterviewQuestion() {
    if (interviewIndex >= interviewQuestions.length) interviewIndex = 0;
    return interviewQuestions[interviewIndex++];
  }

  function agentAskQuestionAndListen() {
    if (!running) return;
    agentWaitingForAnswer = true;
    currentAnswerBuffer = "";
    clearIdlePrompt();
    const idx = (interviewIndex >= interviewQuestions.length) ? 0 : (interviewIndex % interviewQuestions.length);
    const q = pickNextInterviewQuestion();
    const sug = (suggestedAnswers && suggestedAnswers[idx]) ? suggestedAnswers[idx] : "";
    showSuggestedAnswer(sug);
    speakTextOnce(q);
    startSpeechRecognition();
    setFeedback(`Agent: ${q}`, toneAnalysis.innerHTML || "");
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    resetIdlePromptTimer();
    if (listeningIndicator) listeningIndicator.style.display = "inline";
  }

  function finishInterviewAnswer() {
    if (!agentWaitingForAnswer) return;
    agentWaitingForAnswer = false;
    clearIdlePrompt();
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    if (listeningIndicator) listeningIndicator.style.display = "none";

    const answer = (currentAnswerBuffer || "").trim();
    if (answer) {
      cumulativeTranscript += answer + " ";
      transcriptBox.innerText = answer + "\n" + transcriptBox.innerText;
      transcriptBox.innerText = transcriptBox.innerText.split("\n").slice(0,30).join("\n");
    } else {
      speakTextOnce("I didn't catch your answer. Say 'Next question' or try again.");
    }

    const totalFillers = Object.values(fillerCounts).reduce((a,b)=>a+b,0);
    let feedbackUtter = "Nice answer.";
    if (totalFillers >= 3) feedbackUtter = "Good. Try to reduce filler words like 'and' or 'um' next time.";
    speakTextOnce(feedbackUtter);

    // popup suggestion for most recent filler
    const words = answer.toLowerCase().split(/\W+/).filter(Boolean);
    for (let i = words.length-1; i >= 0; --i) {
      const w = words[i];
      if (fillerList.includes(w)) { showSuggestionFor(w); break; }
    }

    setTimeout(() => {
      hideSuggestedAnswer();
      if (running && practiceSelect && practiceSelect.value === 'interview') {
        agentAskQuestionAndListen();
      }
    }, 1200);
  }

  // ---------- Presentation flow ----------
  function generatePresentationScript(topic) {
    const t = (topic && topic.trim()) ? topic.trim() : "My Topic";
    return `
Title: ${t}

Introduction:
Hello. Today I will speak about ${t}. I'll cover what it is, why it matters, and practical takeaways.

Body:
First, an overview: ${t} refers to ... (give definition). Next, discuss key aspects and examples. For instance, one example is ... which shows how ${t} affects decisions and outcomes.

Conclusion:
In summary, ${t} matters because it helps improve outcomes by focusing on clarity and iteration. Key takeaways: clarify purpose, test ideas, and iterate based on feedback.
`.trim();
  }

  function agentAskToStartPresentation() {
    agentWaitingForAnswer = true;
    currentAnswerBuffer = "";
    resetIdlePromptTimer();
    if (listeningIndicator) listeningIndicator.style.display = "inline";
    setFeedback("Agent: Listening to your presentation... (hold on)", toneAnalysis.innerHTML || "");
  }

  async function startPresentationFlow() {
    let topic = "";
    try { topic = prompt("Enter presentation topic (or leave blank):", ""); } catch (e) { topic = ""; }
    if (!topic) topic = "My Presentation Topic";
    const script = generatePresentationScript(topic);
    showSuggestedAnswer(script);
    speakTextOnce(`I have prepared a sample script for ${topic}. You may present in your own words. I'll listen and give feedback when you finish.`);
    setTimeout(() => {
      agentAskToStartPresentation();
      startSpeechRecognition();
      transcriptBox.innerText = `Presenting on: ${topic}\n` + transcriptBox.innerText;
    }, 1100);
  }

  function finishPresentation() {
    if (!agentWaitingForAnswer) return;
    agentWaitingForAnswer = false;
    clearIdlePrompt();
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    if (listeningIndicator) listeningIndicator.style.display = "none";

    const answer = (currentAnswerBuffer || "").trim();
    if (answer) {
      cumulativeTranscript += answer + " ";
      transcriptBox.innerText = answer + "\n" + transcriptBox.innerText;
      transcriptBox.innerText = transcriptBox.innerText.split("\n").slice(0,30).join("\n");
    } else {
      speakTextOnce("I didn't catch your presentation. Press Next question to continue or try again.");
    }

    // presentation evaluation heuristics
    const totalFillers = Object.values(fillerCounts).reduce((a,b)=>a+b,0);
    const wordCount = (answer.match(/\b\w+\b/g) || []).length;
    const durationSec = Math.max(1, Math.round((performance.now() - startTime) / 1000));
    const wpm = Math.round((wordCount / durationSec) * 60);
    const stammered = detectStammerInText(answer);

    let feedbackUtter = "";
    if (stammered) feedbackUtter += "I detected some stammering; try to slow down and pause. ";
    if (totalFillers >= 5) feedbackUtter += `You used ${totalFillers} filler words; work on pausing and clarity. `;
    if (wpm > 160) feedbackUtter += `You spoke fast (${wpm} wpm). Slow down for emphasis. `;
    if (!feedbackUtter) feedbackUtter = "Great presentation. Good content and structure — well done.";

    const analysisHtml = `
      <div style="font-weight:600;margin-bottom:6px;">Presentation Analysis</div>
      <ul style="margin:6px 0;padding-left:18px;">
        <li>Words: ${wordCount}</li>
        <li>Estimated WPM: ${wpm}</li>
        <li>Fillers: ${totalFillers}</li>
        <li>Stammer detected: ${stammered ? 'Yes' : 'No'}</li>
      </ul>
    `;
    setFeedback("Presentation complete. " + (feedbackUtter.split(".")[0] || ""), analysisHtml);
    speakTextOnce(feedbackUtter);
    hideSuggestedAnswer();
    setTimeout(() => {
      if (running && practiceSelect && practiceSelect.value === 'presentation') {
        speakTextOnce("If you want to present again press Next question or start speaking.");
      }
    }, 900);
  }

  // ---------- Daily Conversation flow ----------
  let dailyIndex = 0;
  function pickNextDailyPrompt() {
    if (dailyIndex >= dailyPrompts.length) dailyIndex = 0;
    return { prompt: dailyPrompts[dailyIndex], suggested: dailySuggestedAnswers[dailyIndex], idx: dailyIndex++ };
  }

  function agentAskDailyQuestionAndListen() {
    if (!running) return;
    agentWaitingForAnswer = true;
    currentAnswerBuffer = "";
    clearIdlePrompt();
    const { prompt, suggested, idx } = pickNextDailyPrompt();
    showSuggestedAnswer(suggested);
    speakTextOnce(prompt);
    startSpeechRecognition();
    setFeedback(`Agent: ${prompt}`, toneAnalysis.innerHTML || "");
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    resetIdlePromptTimer();
    if (listeningIndicator) listeningIndicator.style.display = "inline";
  }

  function finishDailyAnswer() {
    if (!agentWaitingForAnswer) return;
    agentWaitingForAnswer = false;
    clearIdlePrompt();
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    if (listeningIndicator) listeningIndicator.style.display = "none";

    const answer = (currentAnswerBuffer || "").trim();
    const lastSuggested = document.getElementById("smarttalk_suggested") ? document.getElementById("smarttalk_suggested").innerText : "";
    // extract keywords from suggested text (the suggested text is present in suggestedAnswers)
    const suggestedTextElem = (document.getElementById("smarttalk_suggested") && document.getElementById("smarttalk_suggested").querySelector("div")) ? document.getElementById("smarttalk_suggested").querySelector("div").innerText : "";
    const keywords = extractKeywordsFrom(suggestedTextElem, 8);
    const lowerAnswer = (answer || "").toLowerCase();

    // missing keywords
    const missing = keywords.filter(k => !lowerAnswer.includes(k.toLowerCase()));

    // stammer detection
    const stammered = detectStammerInText(answer);

    // filler count
    const totalFillers = Object.values(fillerCounts).reduce((a,b)=>a+b,0);

    // spoken feedback composition
    let feedbackParts = [];
    if (!answer) {
      speakTextOnce("I didn't hear an answer. Try again or press Next question.");
      setFeedback("No answer recorded.", "");
      return;
    } else {
      if (stammered) feedbackParts.push("I detected a bit of stammering — try to slow your pace and breathe.");
      if (missing.length > 0) feedbackParts.push(`You missed mentioning: ${missing.slice(0,5).join(", ")}.`);
      if (totalFillers >= 3) feedbackParts.push(`You used ${totalFillers} filler words; reduce fillers by pausing.`);
      if (feedbackParts.length === 0) feedbackParts.push("Nice answer — you covered the key points smoothly.");
    }

    // show UI analysis
    const analysisHtml = `
      <div style="font-weight:600;margin-bottom:6px;">Daily Conversation Analysis</div>
      <ul style="margin:6px 0;padding-left:18px;">
        <li>Missing suggested keywords: ${missing.length ? missing.join(", ") : "None"}</li>
        <li>Fillers: ${totalFillers}</li>
        <li>Stammer detected: ${stammered ? 'Yes' : 'No'}</li>
      </ul>
    `;
    setFeedback(feedbackParts.join(" "), analysisHtml);
    speakTextOnce(feedbackParts.join(" "));

    // store transcript & update UI
    cumulativeTranscript += answer + " ";
    transcriptBox.innerText = answer + "\n" + transcriptBox.innerText;
    transcriptBox.innerText = transcriptBox.innerText.split("\n").slice(0,30).join("\n");

    // after feedback, ask next daily prompt automatically after a brief pause
    setTimeout(() => {
      hideSuggestedAnswer();
      if (running && practiceSelect && practiceSelect.value === 'daily') {
        agentAskDailyQuestionAndListen();
      }
    }, 1200);
  }

  // called by idle or Next button
  function finishCurrentAnswer() {
    if (practiceSelect && practiceSelect.value === 'presentation') finishPresentation();
    else if (practiceSelect && practiceSelect.value === 'daily') finishDailyAnswer();
    else finishInterviewAnswer();
  }

  // ---------- Start/Stop evaluation & recording ----------
  async function startEvaluation() {
    if (running) return;
    running = true;

    // reset per-session fillerCounts
    fillerList.forEach(w => fillerCounts[w] = 0);

    if (audioCtx && audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch (e) {}
    }
    if (audioCtx) playBeep(1000, 110);

    // load MediaPipe
    try {
      if (typeof window.Holistic === 'undefined') {
        await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/holistic/holistic.js');
        await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');
      }
    } catch (err) {
      alert('Could not load MediaPipe. Check internet connection.');
      running = false;
      return;
    }

    holistic = new window.Holistic({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`
    });
    holistic.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      refineFaceLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    holistic.onResults((results) => { evaluateFrame(results); });

    // request camera + mic
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: MIRROR_WIDTH, height: MIRROR_HEIGHT }, audio: true });
    } catch (err) {
      alert('Camera/mic permission denied or not available.');
      running = false;
      return;
    }

    preview.srcObject = cameraStream;
    preview.play().catch(()=>{});

    // mirror preview frame onto offscreen canvas then send to holistic
    async function sendMirroredFrame() {
      try {
        mirrorCtx.save();
        mirrorCtx.scale(-1, 1);
        mirrorCtx.drawImage(preview, -MIRROR_WIDTH, 0, MIRROR_WIDTH, MIRROR_HEIGHT);
        mirrorCtx.restore();
        await holistic.send({ image: mirrorCanvas });
      } catch (e) {}
    }

    if (window.Camera && typeof window.Camera === 'function') {
      const cam = new window.Camera(preview, {
        onFrame: async () => { await sendMirroredFrame(); },
        width: MIRROR_WIDTH,
        height: MIRROR_HEIGHT
      });
      cam.start();
      holistic._cameraHelper = cam;
    } else {
      let stopped = false;
      const loop = async () => {
        if (!running || stopped) return;
        await sendMirroredFrame();
        requestAnimationFrame(loop);
      };
      loop();
      holistic._cameraHelper = { stop: () => { stopped = true; } };
    }

    // start audio recording from camera stream
    try {
      const audioTracks = cameraStream.getAudioTracks();
      if (audioTracks && audioTracks.length > 0) {
        const audioOnlyStream = new MediaStream(audioTracks);
        sessionAudioRecorder = new MediaRecorder(audioOnlyStream);
        sessionAudioChunks = [];
        sessionAudioRecorder.ondataavailable = (e) => { if (e.data.size > 0) sessionAudioChunks.push(e.data); };
        sessionAudioRecorder.onstop = () => {
          const blob = new Blob(sessionAudioChunks, { type: 'audio/webm' });
          audioPlayback.src = URL.createObjectURL(blob);
        };
        sessionAudioRecorder.start();
      } else {
        console.warn("No audio tracks found in cameraStream; session audio not recorded.");
      }
    } catch (e) {
      console.warn("Failed to start session audio recorder", e);
    }

    startSpeechRecognition();

    // UI updates
    stopBtn.disabled = false;
    startVideoBtn.disabled = true;
    startAudioBtn.disabled = true;
    startTimer();
    sessionCount += 1;
    frameCounter = 0; fidgetCounter = 0; eyeContactCounter = 0; lookAwayCounter = 0; lastDirection = null;
    startTime = performance.now();

    // mode-specific start
    if (practiceSelect && practiceSelect.value === 'interview') {
      interviewIndex = 0; interviewActive = true; presentationActive = false; dailyActive = false;
      setTimeout(() => { agentAskQuestionAndListen(); }, 700);
    } else if (practiceSelect && practiceSelect.value === 'presentation') {
      presentationActive = true; interviewActive = false; dailyActive = false;
      setTimeout(() => { startPresentationFlow(); }, 700);
    } else if (practiceSelect && practiceSelect.value === 'daily') {
      dailyActive = true; presentationActive = false; interviewActive = false;
      dailyIndex = 0;
      setTimeout(() => { agentAskDailyQuestionAndListen(); }, 700);
    } else {
      interviewActive = false; presentationActive = false; dailyActive = false;
    }
  }

  function stopEvaluation() {
    if (!running) return;
    running = false;

    interviewActive = false;
    presentationActive = false;
    dailyActive = false;
    agentWaitingForAnswer = false;
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    clearIdlePrompt();

    stopSpeechRecognition();

    if (sessionAudioRecorder && sessionAudioRecorder.state !== 'inactive') {
      sessionAudioRecorder.stop();
      try { (sessionAudioRecorder.stream.getTracks()||[]).forEach(t=>t.stop()); } catch(e){}
    }

    if (preview && preview.srcObject) {
      (preview.srcObject.getTracks() || []).forEach(t => t.stop());
      preview.srcObject = null;
    }
    try { if (holistic && holistic._cameraHelper && typeof holistic._cameraHelper.stop === 'function') holistic._cameraHelper.stop(); } catch(e){}

    setPreviewRedBorder(false);

    stopBtn.disabled = true;
    startVideoBtn.disabled = false;
    startAudioBtn.disabled = false;
    stopTimer();

    const totalFillers = Object.values(fillerCounts).reduce((a,b)=>a+b,0);
    const eyePct = Math.round(100 * (eyeContactCounter / Math.max(1, frameCounter)));
    const sessionObj = {
      id: `sess_${Date.now()}`,
      dateISO: new Date().toISOString(),
      durationMs: startTime ? Math.max(0, performance.now() - startTime) : 0,
      totalFillers: totalFillers,
      eyeContactPct: eyePct,
      sessionNumber: sessionCount,
      fillerBreakdown: { ...fillerCounts },
      frames: frameCounter,
      practiceType: (practiceSelect ? practiceSelect.value : 'unknown')
    };
    try {
      const key = 'smarttalk_sessions';
      const prev = JSON.parse(localStorage.getItem(key) || '[]');
      prev.push(sessionObj);
      localStorage.setItem(key, JSON.stringify(prev));
      // also dispatch a custom event so other pages can respond
      window.dispatchEvent(new Event('smarttalk_sessions_updated'));
    } catch (e) { console.warn("save fail", e); }

    // reset fillerCounts
    fillerList.forEach(w => fillerCounts[w] = 0);

    const finalText = `Session complete. Fillers:${totalFillers} · Eye contact:${eyePct}%`;
    setFeedback(finalText, `<div>Session #${sessionCount} (local)</div>`);
    hideSuggestedAnswer();
  }

  // ---------- Audio-only recording ----------
  let micRecorder = null;
  let micChunks = [];
  async function startAudioRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video:false });
      micRecorder = new MediaRecorder(stream);
      micChunks = [];
      micRecorder.ondataavailable = (e)=>{ if(e.data.size>0) micChunks.push(e.data); };
      micRecorder.onstop = ()=>{ const blob = new Blob(micChunks, { type: "audio/webm" }); audioPlayback.src = URL.createObjectURL(blob); };
      micRecorder.start();
      startAudioBtn.disabled = true;
      stopBtn.disabled = false;
      startTimer();
    } catch (e) {
      alert("Microphone access denied or not available.");
      console.error(e);
    }
  }
  function stopAudioRecording() {
    if (micRecorder && micRecorder.state !== 'inactive') {
      micRecorder.stop();
      (micRecorder.stream.getTracks()||[]).forEach(t=>t.stop());
    }
    startAudioBtn.disabled = false;
    stopTimer();
  }

  // ---------- Buttons ----------
  startVideoBtn.addEventListener("click", async () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch (e) {}
    }
    await startEvaluation();
  });

  startAudioBtn.addEventListener("click", async () => {
    await startAudioRecording();
  });

  stopBtn.addEventListener("click", () => {
    if (micRecorder && micRecorder.state !== 'inactive') stopAudioRecording();
    if (running) stopEvaluation();
  });

  // Next question manual override
  if (nextQuestionBtn) {
    nextQuestionBtn.addEventListener("click", () => {
      if (agentWaitingForAnswer) {
        finishCurrentAnswer();
      } else {
        if (running && practiceSelect && practiceSelect.value === 'interview') agentAskQuestionAndListen();
        else if (running && practiceSelect && practiceSelect.value === 'presentation') agentAskToStartPresentation();
        else if (running && practiceSelect && practiceSelect.value === 'daily') agentAskDailyQuestionAndListen();
      }
    });
  }

  // Download report
  downloadReportBtn.addEventListener("click", () => {
    const now = new Date();
    const report = [
      `SmartTalkAI - Local Session Report`,
      `Date: ${now.toLocaleString()}`,
      `Sessions: ${sessionCount}`,
      ``,
      `Filler counts: ${JSON.stringify(fillerCounts)}`,
      ``,
      `Transcript tail:`,
      cumulativeTranscript.slice(-2000)
    ].join("\n");
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smarttalk_report_${now.toISOString().replace(/[:.]/g,'-')}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  // Clean up on page close
  window.addEventListener("beforeunload", () => {
    if (preview && preview.srcObject) {
      (preview.srcObject.getTracks() || []).forEach(t => t.stop());
    }
    stopSpeechRecognition();
  });

  // Initialize speech recognition object
  setupSpeechRecognition();

  // initial UI state
  stopBtn.disabled = true;

  // Expose small helper for testing in console
  window.__smarttalk_internal = {
    fillerCounts,
    interviewAsk: agentAskQuestionAndListen,
    finishInterviewAnswer,
    startPresentationFlow,
    finishPresentation,
    agentAskDailyQuestionAndListen,
    finishDailyAnswer,
    showSuggestedAnswer
  };

})();
