const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { Events, loadStyles, runScript } = require('./helpers');

const { NEUTRAL_STYLE } = loadStyles();

function createContentHarness(initial = {}, url = 'https://music.example/track/1', { target = true } = {}) {
  const document = new Events();
  const messages = [];
  const originalDispatch = document.dispatchEvent.bind(document);
  document.dispatchEvent = (event) => {
    if (event.type === 'auracore:settings') messages.push(JSON.parse(event.detail));
    return originalDispatch(event);
  };
  let onStorageChange;
  let onRuntimeMessage;
  let onConnect;
  const writes = [];
  const sent = [];
  const replaced = [];
  const window = {};
  window.top = window;
  const chrome = {
    runtime: {
      onMessage: { addListener(callback) { onRuntimeMessage = callback; } },
      onConnect: { addListener(callback) { onConnect = callback; } },
      sendMessage(message, callback) {
        sent.push(message);
        if (message.type === 'is-target') callback(target);
        if (message.type === 'claim-target') callback(true);
        return Promise.resolve();
      },
    },
    storage: {
      local: {
        get(defaults, callback) { callback({ ...defaults, ...initial }); },
        set(changes) { writes.push(changes); },
      },
      onChanged: { addListener(callback) { onStorageChange = callback; } },
    },
  };
  const location = new URL(url);
  const context = vm.createContext({
    chrome, document, window, location, history: { replaceState(state, title, value) { replaced.push(value); }, state: null },
    URL, URLSearchParams, NEUTRAL_STYLE,
    SHARE_KEY: 'auracore', decodeStyle() { return { style: { ...NEUTRAL_STYLE, bass: 6 }, name: 'teste' }; },
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    setInterval: () => 0, clearInterval() {},
  });
  runScript(context, 'content.js');
  return {
    document, messages, writes, replaced, sent,
    change(changes) { onStorageChange(changes, 'local'); },
    receiveMessage(message) { onRuntimeMessage(message, {}, () => {}); },
    connectMeter() {
      let disconnect;
      onConnect({ name: 'auracore-meter', postMessage() {}, onDisconnect: { addListener(callback) { disconnect = callback; } } });
      return () => disconnect();
    },
  };
}

test('desligar limpa fade e tape stop sem apagar o estilo salvo', () => {
  const content = createContentHarness({
    enabled: true, style: { ...NEUTRAL_STYLE, reverb: 35 }, fade: 6, tapeStop: true,
  });
  assert.equal(content.messages.at(-1).style.reverb, 35);
  assert.equal(content.messages.at(-1).fade, 6);
  assert.equal(content.messages.at(-1).tapeStop, true);
  content.change({ enabled: { newValue: false } });
  assert.equal(content.messages.at(-1).style.reverb, 0);
  assert.equal(content.messages.at(-1).fade, 0);
  assert.equal(content.messages.at(-1).tapeStop, false);
  content.change({ enabled: { newValue: true } });
  assert.equal(content.messages.at(-1).style.reverb, 35);
  assert.equal(content.messages.at(-1).fade, 6);
  assert.equal(content.messages.at(-1).tapeStop, true);
});

test('fade de 6 segundos e tape stop vêm ativados por padrão', () => {
  const content = createContentHarness({ enabled: true });
  assert.equal(content.messages.at(-1).fade, 6);
  assert.equal(content.messages.at(-1).tapeStop, true);
});

test('trocar de estilo em storage envia a receita completa à página', () => {
  const content = createContentHarness();
  content.change({ enabled: { newValue: true }, style: { newValue: { speed: 1.3, bass: 3 } } });
  assert.equal(content.messages.at(-1).style.speed, 1.3);
  assert.equal(content.messages.at(-1).style.bass, 3);
  assert.equal(content.messages.at(-1).style.reverb, 0);
});

test('abrir link compartilhado com rota em hash aplica estilo e preserva a rota', () => {
  const content = createContentHarness({}, 'https://music.example/?auracore=bass%3D6%26n%3Dteste#/track/123');
  assert.equal(content.writes[0].style.bass, 6);
  assert.equal(content.writes[0].enabled, true);
  const cleaned = new URL(content.replaced[0]);
  assert.equal(cleaned.hash, '#/track/123');
  assert.equal(cleaned.searchParams.has('auracore'), false);
});

test('links antigos com estilo no fragmento continuam funcionando', () => {
  const content = createContentHarness({}, 'https://music.example/track/1#auracore=bass%3D6%26n%3Dteste');
  assert.equal(content.writes[0].style.bass, 6);
  assert.equal(content.replaced[0], 'https://music.example/track/1');
});

test('notificação de captura ativa envia estilo neutro para a página e marca captured', () => {
  const content = createContentHarness({
    enabled: true, style: { ...NEUTRAL_STYLE, reverb: 35, speed: 1.3 },
  });
  assert.equal(content.messages.at(-1).style.reverb, 35);
  assert.equal(content.messages.at(-1).captured, false);

  content.receiveMessage({ type: 'auracore:capture', captured: true });
  assert.equal(content.messages.at(-1).style.reverb, 0);
  assert.equal(content.messages.at(-1).style.speed, 1.3);
  assert.equal(content.messages.at(-1).captured, true);

  content.receiveMessage({ type: 'auracore:capture', captured: false });
  assert.equal(content.messages.at(-1).style.reverb, 35);
  assert.equal(content.messages.at(-1).captured, false);
});

test('captura encaminha reprodução e pausa da página ao motor', () => {
  const content = createContentHarness({ enabled: true, style: { ...NEUTRAL_STYLE, water: 68 } });
  content.receiveMessage({ type: 'auracore:capture', captured: true });
  content.document.dispatchEvent({ type: 'auracore:playback', detail: 'true' });
  content.document.dispatchEvent({ type: 'auracore:playback', detail: 'false' });
  assert.deepEqual(content.sent.filter(({ type }) => type === 'playback').map(({ playing }) => playing), [false, true, false]);
});

test('aba que não é a alvo toca o som original mesmo com o auracore ligado', () => {
  const content = createContentHarness({
    enabled: true, style: { ...NEUTRAL_STYLE, speed: 0.9, vinyl: 35 }, fade: 6, tapeStop: true,
  }, 'https://videoaula.example/aula/1', { target: false });
  const settings = content.messages.at(-1);
  assert.equal(settings.style.speed, 1);
  assert.equal(settings.style.vinyl, 0);
  assert.equal(settings.fade, 0);
  assert.equal(settings.tapeStop, false);

  content.change({ style: { newValue: { ...NEUTRAL_STYLE, reverb: 60 } } });
  assert.equal(content.messages.at(-1).style.reverb, 0, 'troca de estilo em outra aba não chega aqui');

  content.receiveMessage({ type: 'auracore:target', target: true });
  assert.equal(content.messages.at(-1).style.reverb, 60);
  content.receiveMessage({ type: 'auracore:target', target: false });
  assert.equal(content.messages.at(-1).style.reverb, 0);
});

test('abrir link compartilhado torna a aba alvo antes de ligar o estilo', () => {
  const content = createContentHarness({}, 'https://music.example/track/1#auracore=bass%3D6%26n%3Dteste', { target: false });
  const claim = content.sent.findIndex(({ type }) => type === 'claim-target');
  assert.ok(claim >= 0);
  assert.equal(content.writes[0].enabled, true);
});

test('aba carregada com o auracore desligado não acorda o service worker', () => {
  const content = createContentHarness({ enabled: false });
  assert.deepEqual(content.sent, []);
  content.change({ enabled: { newValue: true } });
  content.change({ enabled: { newValue: false } });
  content.change({ enabled: { newValue: true } });
  assert.deepEqual(content.sent.map((message) => message.type).sort(), ['is-captured', 'is-target']);
  assert.equal(content.messages.at(-1).style.speed, NEUTRAL_STYLE.speed);
});

test('título da aba só é enviado com o popup aberto', () => {
  const content = createContentHarness({ enabled: true });
  content.document.title = 'Faixa 1';
  content.document.dispatchEvent({ type: 'auracore:playback', detail: 'true' });
  assert.equal(content.sent.some((message) => message.type === 'auracore:title-changed'), false);
  const disconnect = content.connectMeter();
  content.document.dispatchEvent({ type: 'auracore:playback', detail: 'true' });
  assert.equal(content.sent.filter((message) => message.type === 'auracore:title-changed').length, 1);
  disconnect();
  content.document.title = 'Faixa 2';
  content.document.dispatchEvent({ type: 'auracore:playback', detail: 'true' });
  assert.equal(content.sent.filter((message) => message.type === 'auracore:title-changed').length, 1);
});
