// Sites com DRM (Spotify, Amazon Music) devolvem silêncio ao Web Audio dentro da página. Para eles,
// o áudio da aba é capturado já decodificado e passa pelo motor num documento offscreen. Este
// service worker cria esse documento e repassa a ele as mudanças de estilo, porque documentos
// offscreen só têm acesso a chrome.runtime. No Firefox não há captura de aba nem offscreen, e o
// background é uma página de eventos que já recebe o styles.js pelo manifest.
if (typeof importScripts === 'function') importScripts('styles.js');

const OFFSCREEN_URL = 'offscreen.html';
let captureQueue = Promise.resolve();

async function hasOffscreen() {
  if (!chrome.offscreen || !chrome.runtime.getContexts) return false;
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Aplicar os efeitos ao áudio capturado de abas com áudio protegido.',
  });
}

// O Chrome permite um documento offscreen; início e fim precisam esperar um pelo outro.
function queueCapture(work) {
  const operation = captureQueue.then(work);
  captureQueue = operation.catch(() => {});
  return operation;
}

async function currentStyle() {
  const { enabled, style } = await chrome.storage.local.get({ enabled: false, style: NEUTRAL_STYLE });
  return enabled ? { ...NEUTRAL_STYLE, ...style } : NEUTRAL_STYLE;
}

const toOffscreen = (message) => chrome.runtime.sendMessage({ target: 'offscreen', ...message });

async function notifyTabCapture(tabId, captured) {
  if (!tabId || !chrome.tabs?.sendMessage) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'auracore:capture', captured });
  } catch {}
}

// Uma aba por vez: o estilo vale só na aba onde o usuário ligou o auracore pelo popup, para não
// alterar uma videoaula ou chamada aberta em outra aba. O id fica no storage da sessão porque ids de
// aba não valem depois de reiniciar o navegador.
let targetQueue = Promise.resolve();

async function targetTab() {
  const { targetTab: tabId } = await chrome.storage.session.get({ targetTab: null });
  return tabId;
}

async function notifyTarget(tabId, isTarget) {
  if (!chrome.tabs?.sendMessage) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'auracore:target', target: isTarget });
  } catch {}
}

function setTarget(tabId) {
  const operation = targetQueue.then(async () => {
    const previous = await targetTab();
    if (previous === tabId) return;
    await chrome.storage.session.set({ targetTab: tabId });
    if (previous !== null) {
      await notifyTarget(previous, false);
      await handle({ type: 'capture-stop', tabId: previous });
    }
    if (tabId !== null) await notifyTarget(tabId, true);
  });
  targetQueue = operation.catch(() => {});
  return operation;
}

async function handle(message, sender) {
  if (message.type === 'set-target') {
    await setTarget(message.tabId);
    return true;
  }
  if (message.type === 'claim-target') {
    if (!sender?.tab?.id) return false;
    await setTarget(sender.tab.id);
    return true;
  }
  if (message.type === 'get-target') {
    await targetQueue;
    return targetTab();
  }
  if (message.type === 'is-target') {
    await targetQueue;
    return Boolean(sender?.tab?.id) && sender.tab.id === await targetTab();
  }
  if (message.type === 'capture-start') {
    return queueCapture(async () => {
      const style = await currentStyle();
      await ensureOffscreen();
      const started = await toOffscreen({ type: 'start', streamId: message.streamId, tabId: message.tabId, style });
      if (started?.error && (await toOffscreen({ type: 'list' })).length === 0) await chrome.offscreen.closeDocument();
      if (!started?.error) await notifyTabCapture(message.tabId, true);
      return started;
    });
  }
  if (message.type === 'capture-stop') {
    return queueCapture(async () => {
      if (!(await hasOffscreen())) return null;
      await toOffscreen({ type: 'stop', tabId: message.tabId });
      await notifyTabCapture(message.tabId, false);
      const remaining = await toOffscreen({ type: 'list' });
      if (remaining.length === 0) await chrome.offscreen.closeDocument();
      return true;
    });
  }
  if (message.type === 'capture-ended') {
    return queueCapture(async () => {
      if (!(await hasOffscreen())) return null;
      const active = await toOffscreen({ type: 'list' });
      if (active.includes(message.tabId)) return false;
      await notifyTabCapture(message.tabId, false);
      if (await targetTab() === message.tabId) await chrome.storage.local.set({ enabled: false });
      if (active.length === 0) await chrome.offscreen.closeDocument();
      return true;
    });
  }
  if (message.type === 'capture-list') {
    await captureQueue;
    return (await hasOffscreen()) ? toOffscreen({ type: 'list' }) : [];
  }
  if (message.type === 'is-captured') {
    await captureQueue;
    if (!(await hasOffscreen())) return false;
    const tabId = sender?.tab?.id;
    if (!tabId) return false;
    const active = await toOffscreen({ type: 'list' });
    return active.includes(tabId);
  }
  if (message.type === 'playback') {
    const tabId = sender?.tab?.id;
    if (!tabId || tabId !== await targetTab() || !(await hasOffscreen())) return false;
    return toOffscreen({ type: 'playback', tabId, frameId: sender.frameId ?? 0, playing: Boolean(message.playing) });
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'background') return;
  handle(message, sender).then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});

// Alterna o botão entre fundo cromado (ativo) e logo colorido (desligado), sem texto de velocidade.
async function updateIcon() {
  const { enabled } = await chrome.storage.local.get({ enabled: false });
  if (chrome.action.setBadgeText) await chrome.action.setBadgeText({ text: '' });
  const prefix = enabled ? 'icons/icon' : 'icons/icon-off';
  if (chrome.action.setIcon) {
    await chrome.action.setIcon({
      path: {
        16: `${prefix}16.png`,
        32: `${prefix}32.png`,
        48: `${prefix}48.png`,
        128: `${prefix}128.png`,
      },
    });
  }
}

chrome.runtime.onStartup.addListener(updateIcon);
chrome.runtime.onInstalled.addListener(updateIcon);

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !(changes.enabled || changes.style)) return;
  updateIcon();
  if (!(await hasOffscreen())) return;
  // O documento pode fechar entre a checagem e o envio (última captura encerrada); aí não há
  // estilo a aplicar.
  toOffscreen({ type: 'style', style: await currentStyle() }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  handle({ type: 'capture-stop', tabId }).catch(() => {});
  // Na fila, para não apagar um alvo novo escolhido enquanto a aba fechava.
  targetQueue = targetQueue.then(async () => {
    if (await targetTab() === tabId) await chrome.storage.session.set({ targetTab: null });
  }).catch(() => {});
});
