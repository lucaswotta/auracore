// Roda no mundo da própria página: só daqui se alcança mídia que nunca entra no DOM (Spotify,
// Deezer) e o motor de áudio consegue ligar nela. A configuração chega do content script por
// evento com o detalhe em JSON, porque objetos não atravessam a fronteira entre os mundos.
(() => {
  const { createEngine } = globalThis.auracoreEngine;
  delete globalThis.auracoreEngine;

  // Depois de atualizar a extensão, o page.js antigo segue vivo na aba e o popup injeta outro. A mídia
  // já ligada ao motor antigo não aceita um segundo createMediaElementSource: o play() da página
  // lançaria InvalidStateError. A instância antiga continua atendendo o content.js novo.
  const loaded = Symbol.for('auracore.page');
  if (globalThis[loaded]) return;
  Object.defineProperty(globalThis, loaded, { value: true });

  // O Chrome aceita até 0.0625 e ainda toca som em 0.07 (medido); é o fundo da freada do tape stop.
  const MIN_RATE = 0.07;
  const BRAKE_MS = 700;
  const SPIN_UP_MS = 400;

  let settings = null;
  let engine = null;
  let meterWanted = false;
  let waitingGesture = false;
  let playbackState = null;
  const ambienceBytes = new Map();
  const ambiencePending = new Map();
  const seen = new WeakSet();
  const refs = new Set();
  const originalRates = new WeakMap();
  const volumes = new WeakMap();
  const routed = new WeakSet();
  const ramps = new WeakMap();
  const nativePlay = HTMLMediaElement.prototype.play;
  const nativePause = HTMLMediaElement.prototype.pause;

  function loadAmbience(kind) {
    if (ambienceBytes.has(kind)) return Promise.resolve(ambienceBytes.get(kind).slice(0));
    return new Promise((resolve, reject) => {
      ambiencePending.set(kind, { resolve, reject });
      document.dispatchEvent(new CustomEvent('auracore:ambience-request', { detail: kind }));
    });
  }

  document.addEventListener('auracore:ambience', (event) => {
    const { kind, encoded } = JSON.parse(event.detail);
    const bytes = Uint8Array.from(atob(encoded), (letter) => letter.charCodeAt(0)).buffer;
    ambienceBytes.set(kind, bytes);
    ambiencePending.get(kind)?.resolve(bytes.slice(0));
    ambiencePending.delete(kind);
  });

  document.addEventListener('auracore:ambience-error', (event) => {
    const { kind, message } = JSON.parse(event.detail);
    ambiencePending.get(kind)?.reject(new Error(message));
    ambiencePending.delete(kind);
  });

  function live() {
    const media = [];
    for (const ref of refs) {
      const element = ref.deref();
      if (element) media.push(element);
      else refs.delete(ref);
    }
    return media;
  }

  function applySpeed(media, rateChanged = false) {
    if (!settings || ramps.has(media)) return;
    const { speed, linkPitch } = settings.style;
    if (speed !== 1) {
      if (!originalRates.has(media)) originalRates.set(media, { rate: media.playbackRate, preservesPitch: media.preservesPitch });
      else if (rateChanged && media.playbackRate !== speed) originalRates.get(media).rate = media.playbackRate;
      // Sem preservar o tom, a música desce de tom junto com a velocidade: é o som do "slowed".
      media.preservesPitch = !linkPitch;
      if (media.playbackRate !== speed) media.playbackRate = speed;
    } else if (originalRates.has(media)) {
      const original = originalRates.get(media);
      media.preservesPitch = original.preservesPitch;
      media.playbackRate = original.rate;
      originalRates.delete(media);
    }
  }

  function fadeGain(media) {
    const seconds = settings.fade;
    // Sons curtos (notificação, efeito de interface) e transmissões ao vivo ficam de fora.
    if (!seconds || !Number.isFinite(media.duration) || media.duration < seconds * 4) return 1;
    const rate = media.playbackRate || 1;
    const untilEnd = (media.duration - media.currentTime) / rate;
    return Math.max(0, Math.min(1, untilEnd / seconds));
  }

  // Mexe no volume do elemento, que vale até para áudio com DRM; o volume salvo pelos players não
  // muda com isso. O volume original fica guardado e volta quando o fade termina.
  function applyVolume(media) {
    if (!settings) return;
    const factor = fadeGain(media) ** 2;
    let state = volumes.get(media);
    if (factor >= 1 && !state) return;
    if (!state) {
      state = { base: media.volume, expected: media.volume };
      volumes.set(media, state);
    }
    state.expected = state.base * factor;
    media.volume = state.expected;
    if (factor >= 1) volumes.delete(media);
  }

  function followPageVolume(media) {
    const state = volumes.get(media);
    if (state && Math.abs(media.volume - state.expected) > 0.001) {
      state.base = media.volume;
      applyVolume(media);
    }
  }

  // Web Audio devolve silêncio para mídia com DRM ou de outra origem sem CORS; nesses casos ficam
  // só velocidade e volume, para não deixar a aba muda.
  function canRoute(media) {
    if (media.srcObject || media.mediaKeys || !media.currentSrc) return false;
    const url = new URL(media.currentSrc, location.href);
    return url.protocol === 'blob:' || url.protocol === 'data:' || url.origin === location.origin || media.crossOrigin !== null;
  }

  const engineRunning = () => engine?.context.state === 'running';
  const needsEngine = () => !settings?.captured && (meterWanted || Boolean(settings && ['pitch', 'bass', 'muffle', 'warmth', 'wobble', 'chorus', 'vinyl', 'rain', 'water', 'reverb', 'spin'].some((key) => settings.style[key])));
  const isMusicPlaying = () => live().some((media) => !media.paused && !media.ended && !media.muted && media.volume > 0 && media.readyState >= 3);

  function syncPlayback() {
    const playing = isMusicPlaying();
    if (playing === playbackState) return;
    playbackState = playing;
    engine?.setPlaying(playing);
    document.dispatchEvent(new CustomEvent('auracore:playback', { detail: JSON.stringify(playing) }));
  }

  function ensureEngine() {
    if (!engine && needsEngine() && live().some(canRoute)) {
      engine = createEngine(new AudioContext(), loadAmbience);
      if (settings) engine.set(settings.style);
      engine.setPlaying(isMusicPlaying());
    }
    return engine;
  }

  // Roteia a mídia antes de começar a tocar para evitar cortes e vazamento de áudio sem efeito.
  function route(media) {
    if (!engine || !needsEngine() || routed.has(media) || !canRoute(media)) return;
    engine.context.createMediaElementSource(media).connect(engine.input);
    routed.add(media);
  }

  // Sem gesto do usuário na página o AudioContext nasce suspenso; espera o próximo clique ou tecla.
  function waitForGesture() {
    if (waitingGesture) return;
    waitingGesture = true;
    const events = ['pointerdown', 'mousedown', 'keydown', 'touchstart'];
    const resume = () => {
      for (const event of events) {
        window.removeEventListener(event, resume, true);
        document.removeEventListener?.(event, resume, true);
      }
      waitingGesture = false;
      if (engine) engine.context.resume().then(updateEngine).catch(() => {});
    };
    for (const event of events) {
      window.addEventListener(event, resume, true);
      document.addEventListener?.(event, resume, true);
    }
  }

  async function updateEngine() {
    if (!engine && !needsEngine()) return;
    ensureEngine();
    if (engine && settings) engine.set(settings.style);
    live().forEach(route);
    if (engine && !engineRunning()) {
      await Promise.race([engine.context.resume(), new Promise((resolve) => setTimeout(resolve, 300))]);
      if (!engineRunning()) return waitForGesture();
    }
  }

  function rampRate(media, kind, from, to, ms, onEnd) {
    const restorePitch = media.preservesPitch;
    media.preservesPitch = false;
    const start = performance.now();
    const step = () => {
      const progress = Math.min(1, (performance.now() - start) / ms);
      media.playbackRate = Math.max(MIN_RATE, from + (to - from) * progress);
      if (progress < 1) {
        ramps.set(media, { kind, from, to, restorePitch, timer: setTimeout(step, 20) });
        return;
      }
      ramps.delete(media);
      media.preservesPitch = restorePitch;
      onEnd();
    };
    step();
  }

  function stopRamp(media) {
    const ramp = ramps.get(media);
    clearTimeout(ramp.timer);
    ramps.delete(media);
    media.preservesPitch = ramp.restorePitch;
    // Freada interrompida volta à velocidade de antes; arrancada interrompida vai direto ao alvo.
    media.playbackRate = ramp.kind === 'brake' ? ramp.from : ramp.to;
    applySpeed(media);
  }

  function track(media) {
    if (seen.has(media)) return;
    seen.add(media);
    refs.add(new WeakRef(media));
    const sync = () => {
      applySpeed(media);
      if (needsEngine()) {
        ensureEngine();
        if (engine && engine.context.state === 'suspended') engine.context.resume().catch(() => {});
        route(media);
      }
    };
    for (const type of ['play', 'loadedmetadata', 'canplay', 'playing']) {
      media.addEventListener(type, sync);
    }
    for (const type of ['play', 'playing', 'canplay', 'pause', 'ended', 'waiting', 'stalled', 'seeking', 'emptied', 'volumechange', 'timeupdate']) {
      media.addEventListener(type, syncPlayback);
    }
    media.addEventListener('ratechange', () => applySpeed(media, true));
    media.addEventListener('timeupdate', () => {
      applyVolume(media);
      if (needsEngine() && !routed.has(media)) sync();
    });
    media.addEventListener('volumechange', () => followPageVolume(media));
    sync();
    syncPlayback();
  }

  // Em aba em segundo plano os timers ficam limitados a 1 por segundo, então o tape stop só anima
  // com a aba visível; fora dela a pausa é imediata.
  const tapeStopOn = () => settings?.tapeStop && !document.hidden;

  HTMLMediaElement.prototype.play = function (...args) {
    track(this);
    if (needsEngine()) {
      ensureEngine();
      if (engine?.context.state === 'suspended') engine.context.resume().catch(() => {});
      if (engine) route(this);
    }
    const ramp = ramps.get(this);
    if (ramp?.kind === 'brake') stopRamp(this);
    const spinUp = tapeStopOn() && this.paused && this.currentTime > 1;
    const playing = nativePlay.apply(this, args);
    if (spinUp) {
      const target = this.playbackRate;
      rampRate(this, 'spin', target * 0.3, target, SPIN_UP_MS, () => applySpeed(this));
    }
    return playing;
  };

  HTMLMediaElement.prototype.pause = function (...args) {
    const ramp = ramps.get(this);
    if (ramp?.kind === 'brake') return;
    if (ramp) stopRamp(this);
    if (!tapeStopOn() || this.paused || !seen.has(this)) return nativePause.apply(this, args);
    const rate = this.playbackRate;
    rampRate(this, 'brake', rate, MIN_RATE, BRAKE_MS, () => {
      nativePause.apply(this, args);
      this.playbackRate = rate;
      applySpeed(this);
    });
  };

  // Mídia com autoplay no DOM toca sem chamar play(); esses eventos não sobem na árvore, então a
  // captura no document é o que alcança todos.
  for (const type of ['play', 'loadedmetadata', 'canplay', 'playing']) {
    document.addEventListener(type, (event) => {
      if (event.target instanceof HTMLMediaElement) track(event.target);
    }, true);
  }

  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLMediaElement) track(node);
          else if (node.querySelectorAll) node.querySelectorAll('video, audio').forEach(track);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // A faixa principal é a mais longa entre as que tocam com som: deixa de fora o vídeo mudo de
  // fundo (Canvas do Spotify) e prévias curtas da interface.
  function mainMedia() {
    const playing = live().filter((media) => !media.paused && !media.muted);
    return playing.sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
  }

  function reply(type, value) {
    document.dispatchEvent(new CustomEvent(`auracore:${type}`, { detail: JSON.stringify(value) }));
  }

  document.addEventListener('auracore:settings', (event) => {
    settings = JSON.parse(event.detail);
    document.querySelectorAll('video, audio').forEach(track);
    for (const media of live()) {
      applySpeed(media);
      applyVolume(media);
      if (needsEngine()) {
        ensureEngine();
        route(media);
      }
    }
    updateEngine();
    syncPlayback();
  });

  document.addEventListener('auracore:playback-request', () => reply('playback', isMusicPlaying()));
  document.addEventListener('auracore:toggle-playback', () => {
    const media = mainMedia();
    if (!media) return;
    if (media.paused) media.play().catch(() => {});
    else media.pause();
  });
  window.addEventListener('pagehide', () => {
    engine?.setPlaying(false);
    document.dispatchEvent(new CustomEvent('auracore:playback', { detail: 'false' }));
  });

  // Faixa e artista vêm da Media Session, a mesma do controle de mídia do navegador. O título da aba
  // nem sempre traz o artista (YouTube Music mostra só a faixa).
  document.addEventListener('auracore:status-request', () => {
    const media = mainMedia();
    const metadata = navigator.mediaSession?.metadata;
    reply('status', {
      track: metadata?.title ?? '',
      artist: metadata?.artist ?? '',
      media: live().length,
      playing: Boolean(media),
      effects: media ? (canRoute(media) ? 'ok' : 'blocked') : 'none',
      time: media?.currentTime ?? 0,
    });
  });

  // Sem leitura (null) o popup deixa a aura só respirando; mídia que o motor não alcança nem
  // chega a criar AudioContext.
  document.addEventListener('auracore:level-request', () => {
    const media = mainMedia();
    if (!meterWanted && media && canRoute(media)) {
      meterWanted = true;
      updateEngine();
    }
    reply('level', engineRunning() && routed.has(media) ? (engine.audioLevels ? engine.audioLevels() : engine.bassLevel()) : null);
  });

  document.addEventListener('auracore:meter-off', () => { meterWanted = false; });

  document.dispatchEvent(new CustomEvent('auracore:ready'));
})();
