const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function runScript(context, filename) {
  vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context, { filename });
}

// Simula chrome.i18n com os messages.json reais: idioma da interface, queda para o default_locale
// "en" e placeholders $NOME$ ligados a $1, $2.
function createI18n(uiLanguage = 'pt-BR') {
  const read = (locale) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, '_locales', locale, 'messages.json'), 'utf8'));
    } catch {
      return {};
    }
  };
  const locale = uiLanguage.replace('-', '_');
  const chain = [read(locale), read(locale.split('_')[0]), read('en')];
  return {
    getUILanguage: () => uiLanguage,
    getMessage(key, substitutions = []) {
      if (key === '@@ui_locale') return locale;
      const entry = chain.map((messages) => messages[key]).find(Boolean);
      if (!entry) return '';
      const values = [].concat(substitutions);
      return entry.message.replace(/\$([a-z0-9_]+)\$/gi, (match, name) => {
        const content = entry.placeholders?.[name.toLowerCase()]?.content ?? match;
        return content.replace(/\$(\d)/g, (_, index) => values[index - 1] ?? '');
      });
    },
  };
}

function loadStyles(uiLanguage) {
  const context = vm.createContext({ URLSearchParams, chrome: { i18n: createI18n(uiLanguage) } });
  runScript(context, 'styles.js');
  return vm.runInContext('({ NEUTRAL_STYLE, PRESETS, STYLE_LIMITS, presetVariants, encodeStyle, decodeStyle })', context);
}

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) {
    event.target ??= this;
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return true;
  }
}

class FakeMedia extends Events {
  constructor(options = {}) {
    super();
    Object.assign(this, {
      playbackRate: 1,
      preservesPitch: true,
      volume: 1,
      duration: 180,
      currentTime: 0,
      paused: true,
      ended: false,
      readyState: 4,
      muted: false,
      srcObject: null,
      mediaKeys: null,
      currentSrc: 'blob:https://music.example/track',
      crossOrigin: null,
    }, options);
  }
  play() {
    this.paused = false;
    this.dispatchEvent({ type: 'play' });
    this.dispatchEvent({ type: 'playing' });
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent({ type: 'pause' });
  }
}
const nativePlay = FakeMedia.prototype.play;
const nativePause = FakeMedia.prototype.pause;

class Clock {
  now = 0;
  nextId = 1;
  timers = new Map();
  setTimeout(callback, delay) {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + delay, callback });
    return id;
  }
  clearTimeout(id) { this.timers.delete(id); }
  advance(ms) {
    const end = this.now + ms;
    while (true) {
      const next = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      this.now = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.now = end;
  }
}

function createPageHarness({ clock } = {}) {
  FakeMedia.prototype.play = nativePlay;
  FakeMedia.prototype.pause = nativePause;
  const media = [];
  const document = new Events();
  document.hidden = false;
  document.querySelectorAll = () => media;
  const window = new Events();
  const navigator = { mediaSession: { metadata: null } };
  const contexts = [];
  const engines = [];
  class FakeAudioContext {
    constructor() { this.state = 'running'; this.sources = []; contexts.push(this); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createMediaElementSource(element) {
      const source = { element, connect(input) { this.input = input; } };
      this.sources.push(source);
      return source;
    }
  }
  const context = vm.createContext({
    document, window, navigator, HTMLMediaElement: FakeMedia, AudioContext: FakeAudioContext,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    URL, WeakRef, atob,
    setTimeout: clock ? clock.setTimeout.bind(clock) : setTimeout,
    clearTimeout: clock ? clock.clearTimeout.bind(clock) : clearTimeout,
    performance: clock ? { now: () => clock.now } : performance,
    location: { href: 'https://music.example/player', origin: 'https://music.example' },
    auracoreEngine: { createEngine(audioContext, loadAmbience) {
      const engine = { context: audioContext, input: {}, styles: [], playing: [], loadAmbience, set(style) { this.styles.push({ ...style }); }, setPlaying(value) { this.playing.push(value); }, bassLevel() { return 0.4; } };
      engines.push(engine);
      return engine;
    } },
  });
  runScript(context, 'page.js');
  function settings(style, options = {}) {
    document.dispatchEvent(new context.CustomEvent('auracore:settings', {
      detail: JSON.stringify({
        style,
        fade: options.fade ?? 0,
        tapeStop: options.tapeStop ?? false,
        captured: options.captured ?? false,
      }),
    }));
  }
  return { context, document, window, navigator, media, contexts, engines, settings };
}

module.exports = { Clock, Events, FakeMedia, createI18n, createPageHarness, loadStyles, runScript };
