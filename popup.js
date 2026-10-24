const $ = (id) => document.getElementById(id);
const REPO_URL = 'https://github.com/lucaswotta/auracore';
const KOFI_URL = 'https://ko-fi.com/lucaswotta';
const AMO_PAGE = 'https://addons.mozilla.org/firefox/addon/auracore/';
// BR Code estático da chave aleatória, gerado junto com support/pix-qr.svg. Pix só existe no Brasil,
// então o painel o mostra apenas com o Chrome em português do Brasil.
const PIX_CODE = '00020101021126580014br.gov.bcb.pix013616a5c103-0372-42a7-8b40-0d29c2a418f05204000053039865802BR5911LUCAS MOTTA6006BRASIL62070503***6304EAD4';
const PIX_LOCALE = /^pt-BR$/i.test(chrome.i18n?.getUILanguage?.() ?? '');
const STORE_PAGES = [
  { update: 'clients2.google.com', page: 'https://chromewebstore.google.com/detail/' },
  { update: 'edge.microsoft.com', page: 'https://microsoftedge.microsoft.com/addons/detail/' },
];
const DEFAULTS = {
  enabled: false,
  styleId: 'slowed',
  style: { ...NEUTRAL_STYLE, ...PRESETS[0].style },
  variantChoices: {},
  customStyles: [],
  fade: 6,
  tapeStop: true,
};

const percent = (value) => `${value}%`;
// Texto, title, aria-label e placeholder do HTML vêm das chaves em data-i18n*.
const I18N_ATTRIBUTES = { i18nTitle: 'title', i18nAriaLabel: 'aria-label', i18nPlaceholder: 'placeholder' };
function translatePage() {
  document.documentElement.lang = msg('@@ui_locale').replace('_', '-');
  for (const element of document.querySelectorAll?.('[data-i18n], [data-i18n-title], [data-i18n-aria-label], [data-i18n-placeholder]') ?? []) {
    if (element.dataset.i18n) element.textContent = msg(element.dataset.i18n);
    for (const [key, attribute] of Object.entries(I18N_ATTRIBUTES)) {
      if (element.dataset[key]) element.setAttribute(attribute, msg(element.dataset[key]));
    }
  }
}
translatePage();
const CONTROLS = [
  { key: 'speed', label: msg('control_speed'), type: 'fader', group: 'tempo', step: 0.01, format: (value) => `${Math.round(value * 100)}%` },
  { key: 'bass', label: msg('control_bass'), type: 'knob', group: 'eq', step: 1, format: (value) => `+${value} dB` },
  { key: 'muffle', label: msg('control_muffle'), type: 'knob', group: 'eq', step: 1, format: percent },
  { key: 'pitch', label: msg('control_pitch'), type: 'knob', group: 'eq', step: 1, format: (value) => `${value > 0 ? '+' : ''}${value} st` },
  { key: 'warmth', label: msg('control_warmth'), type: 'knob', group: 'fx', step: 1, format: percent },
  { key: 'wobble', label: msg('control_wobble'), type: 'knob', group: 'fx', step: 1, format: percent },
  { key: 'chorus', label: msg('control_chorus'), type: 'knob', group: 'fx', step: 1, format: percent },
  { key: 'vinyl', label: msg('control_vinyl'), type: 'knob', group: 'fx', step: 1, format: percent },
  { key: 'reverb', label: msg('control_reverb'), type: 'knob', group: 'fx', step: 1, format: percent },
  { key: 'room', label: msg('control_room'), type: 'knob', group: 'fx', step: 1, format: percent },
  { key: 'spin', label: msg('control_spin'), type: 'fader', group: 'ambience', step: 1, format: percent },
  { key: 'rain', label: msg('control_rain'), type: 'fader', group: 'ambience', step: 1, format: percent },
  { key: 'water', label: msg('control_water'), type: 'fader', group: 'ambience', step: 1, format: percent },
];
const FADES = [0, 3, 6, 10];
const VIEWS = ['styles', 'custom', 'about', 'support'];
// Painéis sem a personagem: o palco mostra o emblema ou o QR de apoio.
const PLAIN_VIEWS = ['about', 'support'];
const TRACK_SOURCES = [
  ['YouTube Music', ['music.youtube.com']],
  ['YouTube', ['youtube.com', 'youtu.be']],
  ['Spotify', ['spotify.com']],
  ['Apple Music', ['music.apple.com']],
  ['SoundCloud', ['soundcloud.com']],
  ['Amazon Music', ['music.amazon.', 'amazon.']],
  ['Deezer', ['deezer.com']],
  ['TIDAL', ['tidal.com']],
  ['Bandcamp', ['bandcamp.com']],
];
const TRACK_TITLE_SUFFIXES = ['YouTube Music', 'YouTube', 'Spotify', 'Apple Music', 'SoundCloud', 'Amazon Music', 'Deezer', 'TIDAL', 'Bandcamp'];

let state = { ...DEFAULTS };
let activeTab = null;
let activeTabStatus = null;
let captured = false;
let targetTab = null;
let tabEffects = null;
let captureSync = Promise.resolve();
let stopMeter = () => {};
let toastTimer = null;

function pulse() {
  let smoothed = 0;
  const smoothedBands = new Float32Array(16);
  return (data) => {
    const level = typeof data === 'object' && data !== null ? data.level : data;
    const bands = typeof data === 'object' && data !== null ? data.bands : null;
    const isPlaying = (typeof level === 'number' && !Number.isNaN(level) && level > 0.005)
      || (bands?.some((energy) => energy > 0.005) ?? false);
    $('stage')?.classList.toggle('playing', isPlaying);
    smoothed = isPlaying ? Math.max(level || 0, smoothed * 0.85) : 0;
    if (bands && isPlaying) {
      for (let i = 0; i < 16; i++) {
        smoothedBands[i] = Math.max(bands[i], smoothedBands[i] * 0.82);
      }
    } else {
      smoothedBands.fill(0);
    }
    stage?.setLevel(isPlaying ? smoothed : 0, isPlaying ? smoothedBands : null);
    document.documentElement.style.setProperty('--pulse', (1 + (isPlaying ? smoothed : 0) * 0.18).toFixed(3));
  };
}

function startMeter(tabId) {
  stopMeter();
  if (!tabId) return;
  let timer = null;
  let port = null;
  let pollTicks = 0;

  async function checkTabStatus() {
    if (document.hidden) return;
    try {
      const latest = await tabStatus(tabId);
      if (latest) {
        const titleChanged = (latest.title && latest.title !== activeTabStatus?.title)
          || latest.track !== activeTabStatus?.track || latest.artist !== activeTabStatus?.artist;
        const playingChanged = typeof latest.playing === 'boolean' && latest.playing !== activeTabStatus?.playing;
        activeTabStatus = { ...activeTabStatus, ...latest };
        if (latest.title && activeTab) activeTab.title = latest.title;
        if (titleChanged || playingChanged) {
          render();
          $('stage')?.classList.toggle('playing', Boolean(latest.playing));
        }
      }
    } catch {}
  }

  function resume() {
    if (document.hidden) return;
    const update = pulse();
    if (captured) {
      timer = setInterval(() => {
        pollTicks++;
        if (pollTicks % 20 === 0) checkTabStatus();
        chrome.runtime?.sendMessage?.({ target: 'offscreen', type: 'level', tabId }).then(update, () => update(null));
      }, 50);
      return;
    }
    if (chrome.tabs?.connect) {
      port = chrome.tabs.connect(tabId, { name: 'auracore-meter', frameId: 0 });
      port.onMessage?.addListener((data) => {
        pollTicks++;
        if (pollTicks % 20 === 0) checkTabStatus();
        update(data);
      });
    }
  }

  function pause() {
    if (timer) { clearInterval(timer); timer = null; }
    if (port) { port.disconnect(); port = null; }
  }

  function onVisibility() {
    if (document.hidden) pause();
    else resume();
  }

  document.addEventListener?.('visibilitychange', onVisibility);
  resume();

  stopMeter = () => {
    document.removeEventListener?.('visibilitychange', onVisibility);
    pause();
  };
}

let stage = null;
if (typeof createStage === 'function' && $('scene-back') && $('scene-front') && $('orb')) {
  stage = createStage($('scene-back'), $('scene-front'), $('orb'), (beat) => {
    if ($('orb')) $('orb').style.translate = beat ? `${(Math.random() - 0.5) * beat * 4}px ${(Math.random() - 0.5) * beat * 4}px` : '';
  });
}

// O popup mostra e controla a aba onde foi aberto: ligado aqui é ligado e com esta aba como alvo.
const onHere = () => state.enabled && activeTab?.id !== undefined && targetTab === activeTab.id;

function trackSource(url) {
  if (!url) return '';
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const [label] = TRACK_SOURCES.find(([, domains]) => domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`) || hostname.startsWith(domain))) ?? [];
    return label ?? hostname.split('.')[0].replace(/^./, (letter) => letter.toUpperCase());
  } catch {
    return '';
  }
}

// Com Media Session, mostra "faixa • artista" como o Spotify faz no título da aba; sem ela, usa o título
// da aba sem o nome do serviço.
function trackLabel() {
  const { track, artist } = activeTabStatus ?? {};
  if (track) return artist ? `${track} • ${artist}` : track;
  return cleanTrackTitle(activeTabStatus?.title || activeTab.title || msg('stage_active_tab'));
}

function cleanTrackTitle(title) {
  const suffixes = TRACK_TITLE_SUFFIXES.join('|');
  return title.replace(new RegExp(`\\s*(?:\\||•|·|—|-)\\s*(?:${suffixes})\\s*$`, 'i'), '').trim();
}

// Título e origem passam por trás da personagem. O texto que não cabe antes dela corre sem parar:
// sai pela esquerda e volta pela direita, com uma cópia logo atrás, até ser lido inteiro.
const TRACK_ART_GAP = 12;
const TRACK_LOOP_GAP = 48;
const TRACK_SPEED = 32;
function syncTrackMarquee() {
  const character = $('character-art');
  for (const [viewport, text] of [[$('track-viewport'), $('target-label')], [$('source-viewport'), $('track-subtitle')]]) {
    if (!viewport || !text) continue;
    // A cópia do loop só existe com a classe; sem ela a medida é a do texto sozinho.
    text.classList.remove('marquee');
    let readable = viewport.clientWidth || viewport.getBoundingClientRect().width;
    if (character && !character.hidden) {
      const characterRect = character.getBoundingClientRect();
      const characterLeft = characterRect.left - viewport.getBoundingClientRect().left - TRACK_ART_GAP;
      if (characterRect.width > 0 && characterLeft > 0) readable = Math.min(readable, characterLeft);
    }
    const textWidth = text.scrollWidth || text.getBoundingClientRect().width;
    const distance = textWidth + TRACK_LOOP_GAP;
    text.dataset.loop = text.textContent;
    text.style.setProperty('--marquee-distance', `${-distance}px`);
    text.style.setProperty('--marquee-duration', `${(distance / TRACK_SPEED).toFixed(2)}s`);
    text.classList.toggle('marquee', textWidth > readable + 1);
  }
}

// Botões de estilo têm tamanho e fonte fixos. Nome que não cabe no botão, nem quebrando linha,
// passa a correr dentro dele, como o título da música no palco.
function presetLabel(button, name) {
  const label = document.createElement('span');
  label.className = 'preset-label';
  label.textContent = name;
  button.title = name;
  button.append(label);
}

function fitPresetLabels() {
  for (const label of document.querySelectorAll?.('.preset-label') ?? []) {
    const button = label.parentElement;
    const box = getComputedStyle(button);
    const width = button.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight);
    const height = button.clientHeight - parseFloat(box.paddingTop) - parseFloat(box.paddingBottom);
    label.classList.remove('marquee');
    if (label.scrollWidth <= width + 1 && label.scrollHeight <= height + 1) continue;
    label.classList.add('marquee');
    label.style.setProperty('--marquee-distance', `${Math.min(0, width - label.scrollWidth)}px`);
  }
}

function renderVariantFader(preset, variants, currentId) {
  const host = $('variants');
  let wrapper = host.children[0];
  if (wrapper?.dataset.preset !== preset.id) {
    wrapper = document.createElement('div');
    wrapper.className = 'variant-fader';
    wrapper.dataset.preset = preset.id;

    const fader = document.createElement('div');
    fader.className = 'intensity-fader';
    fader.tabIndex = 0;
    fader.setAttribute('role', 'slider');
    fader.setAttribute('aria-label', msg(preset.id === '8d' ? 'variant_path_label' : 'variant_intensity_label'));
    fader.setAttribute('aria-valuemin', '0');
    fader.setAttribute('aria-valuemax', '2');
    fader.setAttribute('aria-orientation', 'horizontal');

    const groove = document.createElement('span');
    groove.className = 'fader-groove';
    const ticks = document.createElement('span');
    ticks.className = 'fader-ticks';
    for (let index = 0; index <= 8; index++) {
      const tick = document.createElement('span');
      tick.className = `fader-tick${index % 4 === 0 ? ' major' : ''}`;
      ticks.append(tick);
    }
    const thumb = document.createElement('span');
    thumb.className = 'fader-thumb';
    fader.append(groove, ticks, thumb);

    const labels = document.createElement('div');
    labels.className = 'fader-labels';
    for (const [index, variant] of variants.entries()) {
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'fader-label';
      const symbol = { circle: '◯', eight: '∞', free: '✳' }[variant.id];
      label.textContent = symbol ?? String(index - 1);
      label.classList.toggle('symbol', Boolean(symbol));
      label.classList.toggle('circle-symbol', variant.id === 'circle');
      label.setAttribute('aria-label', variant.name);
      label.addEventListener('click', () => pickVariant(preset, variant));
      labels.append(label);
    }
    wrapper.append(fader, labels);
    host.replaceChildren(wrapper);

    const position = (event) => {
      const bounds = fader.getBoundingClientRect();
      return Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    };
    let drag = null;
    fader.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag = { pointerId: event.pointerId, origin: Number(fader.dataset.index) };
      fader.classList.add('dragging');
      fader.setPointerCapture(event.pointerId);
      fader.style.setProperty('--fader-position', `${position(event) * 100}%`);
    });
    fader.addEventListener('pointermove', (event) => {
      if (drag?.pointerId === event.pointerId) fader.style.setProperty('--fader-position', `${position(event) * 100}%`);
    });
    const finish = (event, canceled = false) => {
      if (drag?.pointerId !== event.pointerId) return;
      const { origin } = drag;
      drag = null;
      fader.classList.remove('dragging');
      const raw = canceled ? origin : position(event) * 2;
      const selected = Math.abs(raw - origin) <= 0.5 ? origin : Math.round(raw);
      fader.style.setProperty('--fader-position', `${selected * 50}%`);
      if (selected !== origin) pickVariant(preset, variants[selected]);
    };
    fader.addEventListener('pointerup', (event) => finish(event));
    fader.addEventListener('pointercancel', (event) => finish(event, true));
    fader.addEventListener('lostpointercapture', (event) => finish(event, true));
    fader.addEventListener('keydown', (event) => {
      const current = Number(fader.dataset.index);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2
        : event.key === 'ArrowLeft' ? Math.max(0, current - 1)
          : event.key === 'ArrowRight' ? Math.min(2, current + 1) : current;
      if (next === current && !['Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      if (next !== current) pickVariant(preset, variants[next]);
    });
  }

  const index = Math.max(0, variants.findIndex(({ id }) => id === currentId));
  const fader = wrapper.children[0];
  fader.dataset.index = String(index);
  fader.setAttribute('aria-valuenow', String(index));
  fader.setAttribute('aria-valuetext', variants[index].name);
  if (!fader.classList.contains('dragging')) fader.style.setProperty('--fader-position', `${index * 50}%`);
  for (const [labelIndex, label] of [...wrapper.children[1].children].entries()) {
    label.classList.toggle('active', labelIndex === index);
  }
}

function render() {
  const { styleId } = state;
  const enabled = onHere();
  const isCustom = styleId === 'custom' || styleId.startsWith('custom-');

  if (stage) {
    stage.setTheme(styleId);
    stage.setStyle?.(state.style);
    stage.setActive?.(enabled);
  }
  if ($('stage')) $('stage').dataset.style = isCustom ? 'custom' : styleId;
  $('stage')?.classList.toggle('inactive', !enabled);

  if ($('orb')) {
    $('orb').setAttribute('aria-pressed', enabled ? 'true' : 'false');
    $('orb').classList.toggle('active', enabled);
  }
  if ($('orb-icon')) $('orb-icon').src = enabled ? 'icons/icon.svg' : 'icons/icon-off.svg';

  if ($('orb-speed')) {
    const speed = state.style.speed ?? 1;
    $('orb-speed').textContent = `${Math.round(speed * 100)}%`;
  }

  if ($('orb-label')) {
    $('orb-label').textContent = msg(enabled ? 'orb_on' : 'orb_off');
  }

  if ($('track-subtitle')) {
    const source = trackSource(activeTab?.url);
    const elsewhere = state.enabled && !enabled ? msg('stage_active_elsewhere') : '';
    $('track-subtitle').textContent = [source, elsewhere].filter(Boolean).join(' · ');
  }
  if ($('target-label') && activeTab) {
    const trackTitle = trackLabel() || msg('stage_playing_audio');
    $('target-label').textContent = trackTitle;
    $('target-label').title = trackTitle;
  }
  syncTrackMarquee();

  const activePreset = PRESETS.find(({ id }) => id === styleId);

  updateCharacterArt();

  const buttons = PRESETS.map((preset, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `preset-btn${preset.id === styleId && enabled ? ' active' : ''}`;
    presetLabel(btn, preset.name);
    btn.dataset.number = String(index + 1).padStart(2, '0');
    btn.dataset.style = preset.id;
    btn.style.setProperty('--order', index);
    btn.addEventListener('click', () => pickPreset(preset));
    return btn;
  });

  const customBtn = document.createElement('button');
  customBtn.type = 'button';
  customBtn.className = `preset-btn custom-preset-btn${isCustom && enabled ? ' active' : ''}`;
  presetLabel(customBtn, msg('style_custom'));
  customBtn.dataset.number = '16';
  customBtn.dataset.style = 'custom';
  customBtn.style.setProperty('--order', PRESETS.length);
  customBtn.addEventListener('click', () => showView('custom'));
  buttons.push(customBtn);

  if ($('presets')) $('presets').replaceChildren(...buttons);
  fitPresetLabels();

  const variants = activePreset ? presetVariants(activePreset) : [];
  if ($('variant-area')) $('variant-area').hidden = variants.length === 0;
  if ($('variants') && variants.length > 0) {
    const currentVariant = state.variantChoices[styleId] ?? (activePreset.id === '8d'
      ? (styleId === '8d' ? ORBIT_IDS[state.style.orbit] ?? 'free' : 'free')
      : 'normal');
    const hasIntensity = !activePreset.variants;
    $('variant-area').dataset.mode = 'fader';
    $('variant-label').textContent = hasIntensity ? '' : msg('variant_path');
    $('variants').className = 'variant-fader-host';
    renderVariantFader(activePreset, variants, currentVariant);
  }

  renderCustom();
}

function chip(text, active, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `chip${active ? ' active' : ''}`;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function createKnob(control, input, output, onChange) {
  const [min, max] = STYLE_LIMITS[control.key];
  const step = control.step || 1;
  const wrap = document.createElement('div');
  wrap.className = 'dj-knob-wrap';
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'slider');
  wrap.setAttribute('aria-label', control.label);
  wrap.setAttribute('aria-valuemin', String(min));
  wrap.setAttribute('aria-valuemax', String(max));

  const bezel = document.createElement('div');
  bezel.className = 'knob-bezel';

  const ring = document.createElement('div');
  ring.className = 'knob-ring';

  const ticks = document.createElement('div');
  ticks.className = 'knob-ticks';
  const tickAngles = [-135, -90, -45, 0, 45, 90, 135];
  for (const deg of tickAngles) {
    const tick = document.createElement('span');
    tick.className = `knob-tick${deg === 0 ? ' center' : Math.abs(deg) === 135 ? ' limit' : ''}`;
    tick.style.setProperty('--tick-deg', `${deg}deg`);
    ticks.append(tick);
  }

  const dial = document.createElement('div');
  dial.className = 'knob-dial';

  const cap = document.createElement('div');
  cap.className = 'knob-cap';

  const notch = document.createElement('div');
  notch.className = 'knob-notch';

  dial.append(cap, notch);
  bezel.append(ring, ticks, dial);
  wrap.append(bezel);

  function updateVisual(val) {
    const t = Math.max(0, Math.min(1, (val - min) / (max - min)));
    const angle = -135 + t * 270;
    dial.style.setProperty('--rot', `${angle}deg`);
    wrap.setAttribute('aria-valuenow', String(val));
    wrap.setAttribute('aria-valuetext', control.format(val));
  }

  let drag = null;
  wrap.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    wrap.focus?.();
    drag = { pointerId: event.pointerId, startY: event.clientY, startVal: Number(input.value) };
    wrap.classList.add('dragging');
    wrap.setPointerCapture?.(event.pointerId);
  });

  wrap.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaY = drag.startY - event.clientY;
    const change = (deltaY / 130) * (max - min);
    let nextVal = drag.startVal + change;
    nextVal = Math.round(nextVal / step) * step;
    nextVal = Math.max(min, Math.min(max, control.key === 'speed' ? Math.round(nextVal * 100) / 100 : Math.round(nextVal)));
    if (nextVal !== Number(input.value)) onChange(nextVal);
  });

  const endDrag = (event) => {
    if (drag?.pointerId === event.pointerId) {
      drag = null;
      wrap.classList.remove('dragging');
    }
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);
  wrap.addEventListener('lostpointercapture', endDrag);

  wrap.addEventListener('wheel', (event) => {
    event.preventDefault?.();
    const dir = -Math.sign(event.deltaY || 0);
    const delta = (max - min > 30 ? Math.max(step, 2) : step) * dir;
    let nextVal = Number(input.value) + delta;
    nextVal = Math.max(min, Math.min(max, control.key === 'speed' ? Math.round(nextVal * 100) / 100 : Math.round(nextVal)));
    if (nextVal !== Number(input.value)) onChange(nextVal);
  });

  wrap.addEventListener('dblclick', () => {
    const neutral = NEUTRAL_STYLE[control.key] ?? min;
    onChange(neutral);
  });

  wrap.addEventListener('keydown', (event) => {
    const current = Number(input.value);
    let next = current;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = Math.min(max, current + step);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = Math.max(min, current - step);
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    else return;
    event.preventDefault();
    if (control.key === 'speed') next = Math.round(next * 100) / 100;
    if (next !== current) onChange(next);
  });

  return { wrap, updateVisual };
}

function createFader(control, input, output, onChange) {
  const [min, max] = STYLE_LIMITS[control.key];
  const step = control.step || 1;
  const wrap = document.createElement('div');
  wrap.className = 'dj-fader-wrap';
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'slider');
  wrap.setAttribute('aria-label', control.label);
  wrap.setAttribute('aria-valuemin', String(min));
  wrap.setAttribute('aria-valuemax', String(max));
  wrap.setAttribute('aria-orientation', 'horizontal');

  const groove = document.createElement('span');
  groove.className = 'dj-fader-groove';

  const ticks = document.createElement('span');
  ticks.className = 'dj-fader-ticks';
  for (let index = 0; index <= 8; index++) {
    const tick = document.createElement('span');
    tick.className = `dj-fader-tick${index % 4 === 0 ? ' center' : ''}`;
    ticks.append(tick);
  }

  const thumb = document.createElement('span');
  thumb.className = 'dj-fader-thumb';

  wrap.append(groove, ticks, thumb);

  function posToValue(clientX) {
    const bounds = wrap.getBoundingClientRect?.() ?? { left: 0, width: 200 };
    const t = Math.max(0, Math.min(1, (clientX - bounds.left) / (bounds.width || 1)));
    const raw = min + t * (max - min);
    const stepped = Math.round(raw / step) * step;
    return Math.max(min, Math.min(max, control.key === 'speed' ? Math.round(stepped * 100) / 100 : Math.round(stepped)));
  }

  function updateVisual(val) {
    const t = Math.max(0, Math.min(1, (val - min) / (max - min)));
    wrap.style.setProperty('--fader-pos', `${t * 100}%`);
    wrap.setAttribute('aria-valuenow', String(val));
    wrap.setAttribute('aria-valuetext', control.format(val));
  }

  let drag = null;
  wrap.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    wrap.focus?.();
    drag = { pointerId: event.pointerId };
    wrap.classList.add('dragging');
    wrap.setPointerCapture?.(event.pointerId);
    const nextVal = posToValue(event.clientX);
    if (nextVal !== Number(input.value)) onChange(nextVal);
  });

  wrap.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextVal = posToValue(event.clientX);
    if (nextVal !== Number(input.value)) onChange(nextVal);
  });

  const endDrag = (event) => {
    if (drag?.pointerId === event.pointerId) {
      drag = null;
      wrap.classList.remove('dragging');
    }
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);
  wrap.addEventListener('lostpointercapture', endDrag);

  wrap.addEventListener('wheel', (event) => {
    event.preventDefault?.();
    const dir = -Math.sign(event.deltaY || 0);
    const delta = (max - min > 30 ? Math.max(step, 2) : step) * dir;
    let nextVal = Number(input.value) + delta;
    nextVal = Math.max(min, Math.min(max, control.key === 'speed' ? Math.round(nextVal * 100) / 100 : Math.round(nextVal)));
    if (nextVal !== Number(input.value)) onChange(nextVal);
  });

  wrap.addEventListener('dblclick', () => {
    const neutral = NEUTRAL_STYLE[control.key] ?? min;
    onChange(neutral);
  });

  wrap.addEventListener('keydown', (event) => {
    const current = Number(input.value);
    let next = current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(max, current + step);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(min, current - step);
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    else return;
    event.preventDefault();
    if (control.key === 'speed') next = Math.round(next * 100) / 100;
    if (next !== current) onChange(next);
  });

  return { wrap, updateVisual };
}

const sliders = CONTROLS.map((control) => {
  const row = document.createElement('div');
  row.className = `control control-${control.type}`;
  row.dataset.key = control.key;
  row.dataset.group = control.group;

  const name = document.createElement('span');
  name.className = 'control-name';
  name.textContent = control.label;

  const output = document.createElement('output');
  output.className = 'control-value';

  const input = document.createElement('input');
  const [min, max] = STYLE_LIMITS[control.key];
  Object.assign(input, { type: 'range', min, max, step: control.step, className: 'sr-only-range' });

  const onValueChange = (val) => {
    input.value = val;
    output.textContent = control.format(val);
    widget.updateVisual(val);
    editStyle({ [control.key]: val });
  };

  const widget = control.type === 'fader'
    ? createFader(control, input, output, onValueChange)
    : createKnob(control, input, output, onValueChange);

  input.addEventListener('input', () => {
    const val = Number(input.value);
    output.textContent = control.format(val);
    widget.updateVisual(val);
    editStyle({ [control.key]: val });
  });

  row.append(name, output, input, widget.wrap);
  $('controls')?.append(row);
  return { control, input, output, widget };
});

function renderCustom() {
  const { style, styleId, customStyles, fade, tapeStop } = state;
  for (const { control, input, output, widget } of sliders) {
    const val = style[control.key];
    input.value = val;
    output.textContent = control.format(val);
    widget?.updateVisual?.(val);
  }
  if ($('link-pitch')) $('link-pitch').checked = style.linkPitch;
  if ($('tape-stop')) $('tape-stop').checked = tapeStop;

  // "desligado" tira o 8D sem precisar achar o slider.
  $('orbit')?.replaceChildren(
    chip(msg('custom_orbit_off'), style.spin === 0, () => editStyle({ spin: 0 })),
    ...ORBIT_NAMES.map((name, orbit) => chip(name, style.spin > 0 && orbit === style.orbit, () => editStyle({ orbit, spin: style.spin || 45 }))),
  );
  $('fade')?.replaceChildren(...FADES.map((seconds) =>
    chip(seconds ? `${seconds} s` : msg('custom_fade_off'), seconds === fade, () => save({ fade: seconds }))));

  if ($('mine-area')) $('mine-area').hidden = customStyles.length === 0;
  $('mine')?.replaceChildren(...customStyles.map((custom) => {
    const button = chip(custom.name, custom.id === styleId, () => turnOnHere({ styleId: custom.id, style: { ...NEUTRAL_STYLE, ...custom.style } }));
    const remove = document.createElement('span');
    remove.className = 'chip-remove';
    remove.title = msg('custom_delete');
    remove.textContent = '×';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      save({ customStyles: customStyles.filter(({ id }) => id !== custom.id), styleId: styleId === custom.id ? 'custom' : styleId });
    });
    button.append(remove);
    return button;
  }));
}

function updateCharacterArt() {
  const img = $('character-art');
  if (!img) return;
  const view = $('popup-main')?.dataset.view;
  if (PLAIN_VIEWS.includes(view)) {
    img.hidden = true;
    syncTrackMarquee();
    return;
  }
  const styleId = view === 'custom' ? 'custom' : state.styleId;
  const artworkId = styleId === 'custom' || styleId.startsWith('custom-') ? 'custom' : styleId;
  const src = `artwork/${artworkId}.webp`;
  if (img.dataset.artwork === src) {
    img.hidden = false;
    syncTrackMarquee();
    return;
  }
  img.dataset.artwork = src;
  img.hidden = true;
  img.onload = () => {
    if (PLAIN_VIEWS.includes($('popup-main')?.dataset.view)) return;
    img.hidden = false;
    syncTrackMarquee();
  };
  img.onerror = () => {
    img.hidden = true;
    img.dataset.artwork = '';
  };
  img.src = src;
}

// A grade de estilos sai em cascata para a esquerda e o painel escolhido entra pela direita. Os
// painéis fora de vista ficam inertes para não receberem foco pelo teclado.
function showView(name) {
  if ($('popup-main')) $('popup-main').dataset.view = name;
  if ($('stage')) {
    $('stage').dataset.view = name;
    $('stage').setAttribute('aria-label', PLAIN_VIEWS.includes(name) ? 'auracore' : msg('stage_label'));
  }
  updateCharacterArt();
  for (const view of VIEWS) {
    const panel = $(`panel-${view}`);
    if (panel) panel.inert = view !== name;
  }
}

function editStyle(changes) {
  turnOnHere({ style: { ...state.style, ...changes }, styleId: 'custom' });
}

// Ligar pelo popup leva o auracore para esta aba e a anterior volta ao som original. O alvo muda
// antes do storage para a aba antiga não tocar, nem por um instante, o estilo novo.
async function turnOnHere(changes) {
  if (activeTab?.id !== undefined && targetTab !== activeTab.id) {
    targetTab = activeTab.id;
    await chrome.runtime?.sendMessage?.({ target: 'background', type: 'set-target', tabId: activeTab.id });
  }
  save({ enabled: true, ...changes });
}

function pickPreset(preset) {
  if (onHere() && state.styleId === preset.id) {
    save({ enabled: false });
    return;
  }
  const chosenVariant = state.variantChoices[preset.id] ?? (preset.id === '8d' ? 'free' : 'normal');
  const variant = presetVariants(preset).find(({ id }) => id === chosenVariant) ?? presetVariants(preset)[1] ?? { style: preset.style };
  turnOnHere({ styleId: preset.id, style: variant.style });
}

function pickVariant(preset, variant) {
  turnOnHere({
    styleId: preset.id,
    style: variant.style,
    variantChoices: { ...state.variantChoices, [preset.id]: variant.id },
  });
}

function save(changes) {
  state = { ...state, ...changes };
  render();
  chrome.storage?.local?.set?.(changes);
  captureSync = captureSync.then(syncCapture);
}

// Em sites com áudio protegido (Spotify, Amazon Music) o Web Audio da página só recebe silêncio, então
// os efeitos passam pela captura da aba. O Chrome só entrega a captura depois que o usuário abre o
// popup naquela aba; por isso ela começa e termina aqui, junto com o liga/desliga.
async function syncCapture() {
  if (!activeTab?.id || onHere() === captured || (!captured && tabEffects !== 'blocked')) return;
  // Sem captura de aba (Firefox), o site protegido fica só com velocidade e tom.
  if (!chrome.tabCapture) {
    if (onHere()) showToast(msg('toast_speed_only'));
    return;
  }
  try {
    if (captured) {
      await chrome.runtime.sendMessage({ target: 'background', type: 'capture-stop', tabId: activeTab.id });
      captured = false;
    } else {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: activeTab.id });
      const started = await chrome.runtime.sendMessage({ target: 'background', type: 'capture-start', streamId, tabId: activeTab.id });
      if (started?.error) throw new Error(started.error);
      captured = true;
    }
    startMeter(activeTab.id);
  } catch (error) {
    showToast(msg('toast_capture_failed', [error.message]));
  }
}

function showToast(text) {
  const toast = $('share-toast');
  if (!toast) return;
  toast.textContent = text;
  toast.hidden = false;
  toast.classList.add('visible');
  if (typeof clearTimeout === 'function') clearTimeout(toastTimer);
  if (typeof setTimeout === 'function') {
    toastTimer = setTimeout(() => {
      toast.classList.remove('visible');
      toast.hidden = true;
    }, 1600);
  }
}

// Instalada por uma loja, a extensão traz o update_url dela e o id é o da loja, então o convite já
// aponta a página certa. No Firefox o manifest não traz update_url e a página é a do addons.mozilla.org.
// Carregada sem compactação no Chrome não há página de loja e o convite vai ao repositório.
function installUrl() {
  if (chrome.runtime?.getURL?.('').startsWith('moz-extension:')) return AMO_PAGE;
  const updateUrl = chrome.runtime?.getManifest?.().update_url ?? '';
  const store = STORE_PAGES.find(({ update }) => updateUrl.includes(update));
  return store && chrome.runtime.id ? `${store.page}${chrome.runtime.id}` : REPO_URL;
}

async function shareInvite() {
  const invite = msg('toast_invite', [installUrl()]);
  try {
    await navigator.clipboard.writeText(invite);
    showToast(msg('toast_invite_copied'));
  } catch {
    showToast(msg('toast_invite_failed'));
  }
}

// Troca de faixa muda o título da aba; a Media Session é relida na hora para o artista não ficar
// com o da música anterior até a próxima consulta do medidor.
async function refreshTrack(tabId) {
  const latest = await askStatus(tabId);
  if (!latest || tabId !== activeTab?.id) return;
  activeTabStatus = { ...activeTabStatus, ...latest };
  render();
}

async function askStatus(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'status' });
  } catch {
    return null;
  }
}

// Abas abertas antes de a extensão ser instalada ou recarregada não têm os content scripts. Abrir o
// popup concede activeTab, então injeta aqui o que o manifest injetaria, sem exigir um F5 do usuário.
async function injectContentScripts(tabId) {
  if (!chrome.scripting?.executeScript) return;
  try {
    for (const { js, world } of chrome.runtime.getManifest().content_scripts) {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: js, world: world ?? 'ISOLATED' });
    }
  } catch {
    // Páginas internas do navegador e a loja de extensões não aceitam injeção.
  }
}

async function tabStatus(tabId) {
  if (!tabId || !chrome.tabs?.sendMessage) return null;
  const status = await askStatus(tabId);
  if (status) return status;
  await injectContentScripts(tabId);
  return askStatus(tabId);
}

chrome.storage?.local?.get?.(DEFAULTS, (stored) => {
  state = { ...DEFAULTS, ...stored };
  render();
});

document.fonts?.ready?.then?.(() => {
  syncTrackMarquee();
  fitPresetLabels();
});

chrome.tabs?.query?.({ active: true, currentWindow: true }).then(async ([tab]) => {
  if (!tab) return;
  activeTab = tab;
  const [status, activeCaptures, target] = await Promise.all([
    tabStatus(tab.id),
    chrome.runtime?.sendMessage?.({ target: 'background', type: 'capture-list' }).catch?.(() => []) ?? [],
    chrome.runtime?.sendMessage?.({ target: 'background', type: 'get-target' }).catch?.(() => null) ?? null,
  ]);
  captured = Array.isArray(activeCaptures) && activeCaptures.includes(tab.id);
  activeTabStatus = status;
  tabEffects = status?.effects ?? null;
  targetTab = target ?? null;
  render();
  $('stage')?.classList.toggle('playing', Boolean(status?.playing));
  startMeter(tab.id);
});

chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (tabId !== activeTab?.id) return;
  let changed = false;
  if (changeInfo.title && (!activeTab || changeInfo.title !== activeTab.title)) {
    if (activeTab) activeTab.title = changeInfo.title;
    if (activeTabStatus) activeTabStatus.title = changeInfo.title;
    changed = true;
    refreshTrack(tabId);
  }
  if (changeInfo.url && (!activeTab || changeInfo.url !== activeTab.url)) {
    if (activeTab) activeTab.url = changeInfo.url;
    changed = true;
  }
  if (changed) render();
});

chrome.tabs?.onActivated?.addListener(async ({ tabId }) => {
  const [tab] = await chrome.tabs?.query?.({ active: true, currentWindow: true }).catch(() => []) ?? [];
  if (!tab || tab.id !== tabId) return;
  activeTab = tab;
  activeTabStatus = await tabStatus(tab.id);
  render();
  startMeter(tab.id);
});

chrome.runtime?.onMessage?.addListener((message, sender) => {
  if (message?.type === 'auracore:title-changed') {
    const fromActive = sender?.tab ? sender.tab.id === activeTab?.id : true;
    if (fromActive && activeTab) {
      let changed = false;
      if (message.title && message.title !== activeTab.title) {
        activeTab.title = message.title;
        if (activeTabStatus) activeTabStatus.title = message.title;
        changed = true;
      }
      if (message.url && message.url !== activeTab.url) {
        activeTab.url = message.url;
        changed = true;
      }
      if (typeof message.playing === 'boolean' && activeTabStatus) {
        activeTabStatus.playing = message.playing;
        $('stage')?.classList.toggle('playing', message.playing);
      }
      if (changed) render();
    }
  }
});

$('orb')?.addEventListener?.('click', () => (onHere() ? save({ enabled: false }) : turnOnHere({})));
$('about-btn')?.addEventListener?.('click', () => showView('about'));
$('custom-back')?.addEventListener?.('click', () => showView('styles'));
$('about-back')?.addEventListener?.('click', () => showView('styles'));
$('support-btn')?.addEventListener?.('click', () => showView('support'));
$('support-back')?.addEventListener?.('click', () => showView('styles'));
$('kofi-open')?.addEventListener?.('click', () => chrome.tabs?.create?.({ url: KOFI_URL }));
$('pix-copy')?.addEventListener?.('click', async () => {
  try {
    await navigator.clipboard.writeText(PIX_CODE);
    showToast(msg('toast_pix_copied'));
  } catch {
    showToast(msg('toast_pix_failed'));
  }
});
// As chaves do Pix só existem em pt_BR.
if (PIX_LOCALE && $('pix-copy')) $('pix-copy').textContent = msg('support_pix_copy');
if ($('pix-copy')) $('pix-copy').hidden = !PIX_LOCALE;
if ($('support-qr')) {
  $('support-qr').src = PIX_LOCALE ? 'support/pix-qr.svg' : 'support/kofi-qr.svg';
  $('support-qr').alt = msg(PIX_LOCALE ? 'support_pix_alt' : 'support_kofi_alt');
}
$('link-pitch')?.addEventListener?.('change', () => editStyle({ linkPitch: $('link-pitch').checked }));
$('tape-stop')?.addEventListener?.('change', () => save({ tapeStop: $('tape-stop').checked }));
$('save-form')?.addEventListener?.('submit', (event) => {
  event.preventDefault();
  const name = $('style-name').value.trim();
  if (!name) return;
  const custom = { id: `custom-${Date.now()}`, name, style: { ...state.style } };
  $('style-name').value = '';
  turnOnHere({ customStyles: [...state.customStyles, custom], styleId: custom.id });
});
document.addEventListener?.('keydown', (event) => {
  if (event.key === 'Escape' && $('popup-main')?.dataset.view !== 'styles') {
    event.preventDefault();
    showView('styles');
  }
});
if ($('about-version')) $('about-version').textContent = msg('about_version', [chrome.runtime?.getManifest?.().version ?? '']);
showView('styles');
$('share-btn')?.addEventListener?.('click', shareInvite);
$('github-btn')?.addEventListener?.('click', (e) => {
  e?.preventDefault?.();
  chrome.tabs?.create?.({ url: REPO_URL });
});
