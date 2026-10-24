const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadStyles, runScript } = require('./helpers');

const { NEUTRAL_STYLE } = loadStyles();

test('alterna ícone entre ativo e inativo sem texto de velocidade no badge', async () => {
  const background = createBackgroundHarness();
  await background.change({ enabled: true });
  assert.match(background.icons.at(-1).path[16], /icon16\.png$/);
  assert.equal(background.badgeTexts.at(-1).text, '');

  await background.change({ enabled: false });
  assert.match(background.icons.at(-1).path[16], /icon-off16\.png$/);
  assert.equal(background.badgeTexts.at(-1).text, '');
});

function createBackgroundHarness({ failStart = false } = {}) {
  const storage = { enabled: true, style: { ...NEUTRAL_STYLE, reverb: 35 } };
  const captures = new Set();
  const messages = [];
  let offscreen = false;
  let creating = false;
  let createCalls = 0;
  let onMessage;
  let onStorageChange;
  let onTabRemoved;
  const icons = [];
  const badgeTexts = [];
  const session = {};
  const tabMessages = [];
  const chrome = {
    runtime: {
      onMessage: { addListener(callback) { onMessage = callback; } },
      onStartup: { addListener() {} }, onInstalled: { addListener() {} },
      async getContexts() { return offscreen ? [{}] : []; },
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'start') {
          if (failStart) return { error: 'O contexto de áudio não iniciou.' };
          captures.add(message.tabId);
          return { state: 'running' };
        }
        if (message.type === 'stop') { captures.delete(message.tabId); return true; }
        if (message.type === 'list') return [...captures];
        return undefined;
      },
    },
    offscreen: {
      async createDocument() {
        createCalls++;
        if (creating) throw new Error('offscreen document already being created');
        creating = true;
        await Promise.resolve();
        offscreen = true;
        creating = false;
      },
      async closeDocument() { offscreen = false; },
    },
    storage: {
      local: {
        async get() { return { ...storage }; },
        async set(changes) { Object.assign(storage, changes); },
      },
      session: {
        async get(defaults) { return { ...defaults, ...session }; },
        async set(changes) { Object.assign(session, changes); },
      },
      onChanged: { addListener(callback) { onStorageChange = callback; } },
    },
    action: {
      async setBadgeBackgroundColor() {},
      async setBadgeText(options) { badgeTexts.push(options); },
      async setIcon(options) { icons.push(options); },
    },
    tabs: {
      onRemoved: { addListener(callback) { onTabRemoved = callback; } },
      async sendMessage(tabId, message) { tabMessages.push([tabId, message]); },
    },
  };
  let context;
  context = vm.createContext({ chrome, importScripts(filename) { runScript(context, filename); } });
  runScript(context, 'background.js');
  function send(type, fields = {}, sender = {}) {
    return new Promise((resolve) => onMessage({ target: 'background', type, ...fields }, sender, resolve));
  }
  return {
    storage, messages, send, icons, badgeTexts, session, tabMessages,
    endCapture(tabId) { captures.delete(tabId); },
    get createCalls() { return createCalls; },
    get offscreen() { return offscreen; },
    async change(changes) { Object.assign(storage, changes); await onStorageChange(Object.fromEntries(Object.entries(changes).map(([key, newValue]) => [key, { newValue }])), 'local'); },
    remove(tabId) { onTabRemoved(tabId); },
  };
}

test('captura recebe estilo ativo e desligar envia estilo neutro', async () => {
  const background = createBackgroundHarness();
  const started = await background.send('capture-start', { tabId: 4, streamId: 'stream-4' });
  assert.equal(started.state, 'running');
  assert.equal(background.messages.find(({ type }) => type === 'start').style.reverb, 35);
  await background.change({ enabled: false });
  assert.equal(background.messages.at(-1).style.reverb, 0);
  assert.deepEqual([...await background.send('capture-list')], [4]);
  await background.send('capture-stop', { tabId: 4 });
  assert.deepEqual([...await background.send('capture-list')], []);
});

test('duas capturas simultâneas criam um único documento offscreen', async () => {
  const background = createBackgroundHarness();
  const [first, second] = await Promise.all([
    background.send('capture-start', { tabId: 4, streamId: 'stream-4' }),
    background.send('capture-start', { tabId: 5, streamId: 'stream-5' }),
  ]);
  assert.equal(first.state, 'running');
  assert.equal(second.state, 'running');
  assert.equal(background.createCalls, 1);
});

test('fechar uma aba durante a captura não deixa uma sessão órfã', async () => {
  const background = createBackgroundHarness();
  const starting = background.send('capture-start', { tabId: 4, streamId: 'stream-4' });
  background.remove(4);
  await starting;
  assert.deepEqual([...await background.send('capture-list')], []);
});

test('parar uma aba e iniciar outra preserva a segunda captura', async () => {
  const background = createBackgroundHarness();
  await background.send('capture-start', { tabId: 4, streamId: 'stream-4' });
  const stopping = background.send('capture-stop', { tabId: 4 });
  const starting = background.send('capture-start', { tabId: 5, streamId: 'stream-5' });
  await Promise.all([stopping, starting]);
  assert.deepEqual([...await background.send('capture-list')], [5]);
});

test('falha ao iniciar libera o documento offscreen vazio', async () => {
  const background = createBackgroundHarness({ failStart: true });
  const response = await background.send('capture-start', { tabId: 4, streamId: 'stream-4' });
  assert.match(response.error, /áudio/);
  assert.equal(background.offscreen, false);
});

test('fim externo da última captura restaura a página e fecha o offscreen', async () => {
  const background = createBackgroundHarness();
  await background.send('set-target', { tabId: 4 });
  await background.send('capture-start', { tabId: 4, streamId: 'stream-4' });
  background.endCapture(4);
  assert.equal(await background.send('capture-ended', { tabId: 4 }), true);
  assert.equal(background.tabMessages.at(-1)[0], 4);
  assert.equal(background.tabMessages.at(-1)[1].type, 'auracore:capture');
  assert.equal(background.tabMessages.at(-1)[1].captured, false);
  assert.equal(background.storage.enabled, false);
  assert.equal(background.offscreen, false);
});

test('fim antigo não desativa captura nova da mesma aba', async () => {
  const background = createBackgroundHarness();
  await background.send('capture-start', { tabId: 4, streamId: 'new' });
  assert.equal(await background.send('capture-ended', { tabId: 4 }), false);
  assert.deepEqual([...await background.send('capture-list')], [4]);
  assert.equal(background.tabMessages.at(-1)[1].captured, true);
  assert.equal(background.storage.enabled, true);
});

test('só a aba alvo recebe o estilo; trocar de alvo avisa as duas abas', async () => {
  const background = createBackgroundHarness();
  await background.send('set-target', { tabId: 4 });
  assert.equal(await background.send('is-target', {}, { tab: { id: 4 } }), true);
  assert.equal(await background.send('is-target', {}, { tab: { id: 7 } }), false);

  await background.send('set-target', { tabId: 7 });
  assert.equal(await background.send('get-target'), 7);
  const targets = background.tabMessages.filter(([, message]) => message.type === 'auracore:target');
  assert.deepEqual(targets.map(([tabId, message]) => [tabId, message.target]), [[4, true], [4, false], [7, true]]);
});

test('trocar de alvo encerra a captura da aba anterior', async () => {
  const background = createBackgroundHarness();
  await background.send('set-target', { tabId: 4 });
  await background.send('capture-start', { tabId: 4, streamId: 'stream-4' });
  await background.send('set-target', { tabId: 7 });
  assert.deepEqual([...await background.send('capture-list')], []);
});

test('só a aba capturada encaminha reprodução com a origem do frame', async () => {
  const background = createBackgroundHarness();
  await background.send('set-target', { tabId: 4 });
  await background.send('capture-start', { tabId: 4, streamId: 'stream-4' });
  await background.send('playback', { playing: true }, { tab: { id: 4 }, frameId: 2 });
  assert.deepEqual({ ...background.messages.at(-1) }, { target: 'offscreen', type: 'playback', tabId: 4, frameId: 2, playing: true });
  await background.send('playback', { playing: true }, { tab: { id: 9 }, frameId: 0 });
  assert.equal(background.messages.at(-1).tabId, 4);
});

test('link compartilhado faz da aba que o abriu a alvo', async () => {
  const background = createBackgroundHarness();
  await background.send('claim-target', {}, { tab: { id: 12 } });
  assert.equal(await background.send('get-target'), 12);
});

test('fechar a aba alvo libera o alvo; fechar outra não mexe nele', async () => {
  const background = createBackgroundHarness();
  await background.send('set-target', { tabId: 4 });
  background.remove(9);
  assert.equal(await background.send('get-target'), 4);
  background.remove(4);
  assert.equal(await background.send('get-target'), null);
});
