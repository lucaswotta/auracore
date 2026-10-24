// Ponte entre o storage e o popup da extensão e o page.js, que aplica tudo no mundo da página.
let enabled = false;
let style = { ...NEUTRAL_STYLE };
let fade = 6;
let tapeStop = true;
let captured = false;
let storageReady = false;
// Só a aba onde o auracore foi ligado aplica o estilo; as demais tocam o som original. Até o service
// worker responder, a aba se considera fora, para nunca alterar por engano o áudio de outra aba.
let isTarget = false;
const ambienceFiles = { rain: 'rain.webm', water: 'underwater.webm' };
const ambienceLoads = new Map();

document.addEventListener('auracore:ambience-request', (event) => {
  const kind = event.detail;
  if (!enabled || !isTarget || captured || !style[kind] || !ambienceFiles[kind] || ambienceLoads.has(kind)) return;
  const load = fetch(chrome.runtime.getURL(`audio/${ambienceFiles[kind]}`))
    .then((response) => {
      if (!response.ok) throw new Error(`Áudio ambiente: HTTP ${response.status}`);
      return response.blob();
    })
    .then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }))
    .then((encoded) => document.dispatchEvent(new CustomEvent('auracore:ambience', { detail: JSON.stringify({ kind, encoded }) })))
    .catch((error) => {
      ambienceLoads.delete(kind);
      document.dispatchEvent(new CustomEvent('auracore:ambience-error', { detail: JSON.stringify({ kind, message: error.message }) }));
    });
  ambienceLoads.set(kind, load);
});

// Capturada, a aba passa os efeitos de áudio pelo offscreen, mas a velocidade só existe no elemento
// da página; sem ela, slowed, sped up e nightcore sairiam sem mudar o andamento.
function pageStyle() {
  if (!captured) return style;
  return { ...NEUTRAL_STYLE, speed: style.speed, linkPitch: style.linkPitch };
}

function sendToPage() {
  if (!storageReady) return;
  const on = enabled && isTarget;
  const detail = JSON.stringify({
    style: on ? pageStyle() : NEUTRAL_STYLE,
    fade: on ? fade : 0,
    tapeStop: on && tapeStop,
    captured,
  });
  document.dispatchEvent(new CustomEvent('auracore:settings', { detail }));
  if (on && captured) relayPlayback(askPage('playback'));
}

function relayPlayback(playing) {
  if (enabled && isTarget && captured) {
    chrome.runtime.sendMessage({ target: 'background', type: 'playback', playing: Boolean(playing) });
  }
}

// Só o popup aberto (porta do medidor conectada) usa o título; sem ele, cada troca de título em
// qualquer aba acordaria o service worker à toa.
let meterPorts = 0;
let lastReportedTitle = '';
function notifyTitleChange(playing) {
  if (window !== window.top || meterPorts === 0) return;
  const currentTitle = document.title;
  if (!currentTitle || currentTitle === lastReportedTitle) return;
  lastReportedTitle = currentTitle;
  chrome.runtime?.sendMessage?.({
    type: 'auracore:title-changed',
    title: currentTitle,
    url: location.href,
    playing: typeof playing === 'boolean' ? playing : undefined,
  }).catch?.(() => {});
}

document.addEventListener('auracore:playback', (event) => {
  const isPlaying = JSON.parse(event.detail);
  relayPlayback(isPlaying);
  notifyTitleChange(isPlaying);
});

if (window === window.top && typeof MutationObserver !== 'undefined') {
  const checkMutation = () => notifyTitleChange();
  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(checkMutation).observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
  if (document.documentElement) {
    new MutationObserver(checkMutation).observe(document.documentElement, {
      childList: true,
    });
  }
}

// dispatchEvent é síncrono e o page.js responde dentro do próprio listener, então a resposta já
// chegou quando a chamada retorna.
function askPage(type) {
  let answer = null;
  const listen = (event) => { answer = JSON.parse(event.detail); };
  document.addEventListener(`auracore:${type}`, listen);
  document.dispatchEvent(new CustomEvent(`auracore:${type}-request`));
  document.removeEventListener(`auracore:${type}`, listen);
  return answer;
}

document.addEventListener('auracore:ready', () => {
  if (storageReady) sendToPage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'auracore:capture') {
    captured = Boolean(message.captured);
    sendToPage();
    return;
  }
  if (message.type === 'auracore:target') {
    isTarget = Boolean(message.target);
    sendToPage();
    return;
  }
  if (message.type === 'toggle-playback') {
    document.dispatchEvent(new CustomEvent('auracore:toggle-playback'));
    sendResponse({ ...askPage('status'), title: document.title, url: location.href });
    return;
  }
  if (window !== window.top || message.type !== 'status') return;
  sendResponse({ ...askPage('status'), title: document.title, url: location.href });
});

// Cada pergunta acorda o service worker, e o content script roda em todo frame de toda página. Com o
// auracore desligado nenhuma aba precisa da resposta; ao ligar, a pergunta é feita uma vez e depois o
// service worker avisa as mudanças de alvo e de captura.
let askedBackground = false;
function askBackground() {
  if (askedBackground) return;
  askedBackground = true;
  chrome.runtime.sendMessage?.({ target: 'background', type: 'is-captured' }, (response) => {
    if (typeof response === 'boolean' && response !== captured) {
      captured = response;
      sendToPage();
    }
  });
  chrome.runtime.sendMessage?.({ target: 'background', type: 'is-target' }, (response) => {
    if (typeof response === 'boolean' && response !== isTarget) {
      isTarget = response;
      sendToPage();
    }
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'auracore-meter') return;
  meterPorts++;
  lastReportedTitle = '';
  const timer = setInterval(() => port.postMessage(askPage('level')), 50);
  port.onDisconnect.addListener(() => {
    clearInterval(timer);
    meterPorts--;
    document.dispatchEvent(new CustomEvent('auracore:meter-off'));
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.enabled) enabled = changes.enabled.newValue;
  if (enabled) askBackground();
  if (changes.style) style = { ...NEUTRAL_STYLE, ...changes.style.newValue };
  if (changes.fade) fade = changes.fade.newValue;
  if (changes.tapeStop) tapeStop = changes.tapeStop.newValue;
  storageReady = true;
  if (changes.enabled || changes.style || changes.fade || changes.tapeStop) sendToPage();
});

const sharedInHash = window === window.top && new URLSearchParams(location.hash.slice(1)).get(SHARE_KEY);
const sharedInQuery = window === window.top && new URLSearchParams(location.search).get(SHARE_KEY);
const shared = sharedInHash || sharedInQuery;
if (shared) {
  const { style: sharedStyle, name } = decodeStyle(shared);
  if (sharedInHash) history.replaceState(history.state, '', location.href.split('#')[0]);
  else {
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete(SHARE_KEY);
    history.replaceState(history.state, '', cleanUrl.href);
  }
  // Quem abre o link escolheu ouvir nesta aba: ela vira a alvo antes de o estilo ser ligado.
  chrome.runtime.sendMessage({ target: 'background', type: 'claim-target' }, () => {
    chrome.storage.local.set({ enabled: true, style: sharedStyle, styleId: 'shared', sharedName: name });
  });
}

chrome.storage.local.get({ enabled: false, style: NEUTRAL_STYLE, fade: 6, tapeStop: true }, (stored) => {
  enabled = stored.enabled;
  style = { ...NEUTRAL_STYLE, ...stored.style };
  fade = stored.fade;
  tapeStop = stored.tapeStop;
  storageReady = true;
  if (enabled) askBackground();
  sendToPage();
});
