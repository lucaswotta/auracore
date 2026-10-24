const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { Clock, FakeMedia, createPageHarness, loadStyles, runScript } = require('./helpers');

const { NEUTRAL_STYLE } = loadStyles();
const style = (changes) => ({ ...NEUTRAL_STYLE, ...changes });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('desligar restaura a velocidade anterior do player', () => {
  const page = createPageHarness();
  const track = new FakeMedia({ playbackRate: 1.5 });
  page.media.push(track);
  page.settings(style({ speed: 0.8 }));
  assert.equal(track.playbackRate, 0.8);
  page.settings(NEUTRAL_STYLE);
  assert.equal(track.playbackRate, 1.5);
});

test('mudança de velocidade feita pelo player durante o estilo é restaurada ao desligar', () => {
  const page = createPageHarness();
  const track = new FakeMedia({ playbackRate: 1.5 });
  page.media.push(track);
  page.settings(style({ speed: 0.8 }));
  track.playbackRate = 1.25;
  track.dispatchEvent({ type: 'ratechange' });
  assert.equal(track.playbackRate, 0.8);
  page.settings(NEUTRAL_STYLE);
  assert.equal(track.playbackRate, 1.25);
});

test('trocar de faixa aplica estilo e roteia cada mídia uma vez', async () => {
  const page = createPageHarness();
  const first = new FakeMedia();
  page.media.push(first);
  page.settings(style({ speed: 0.8, reverb: 35 }));
  await flush();
  await first.play();
  assert.equal(first.playbackRate, 0.8);
  assert.equal(page.contexts[0].sources.length, 1);

  first.pause();
  const second = new FakeMedia({ currentSrc: 'blob:https://music.example/next' });
  page.media.push(second);
  await second.play();
  assert.equal(second.playbackRate, 0.8);
  assert.equal(page.contexts[0].sources.length, 2);
  await second.play();
  assert.equal(page.contexts[0].sources.length, 2);
  page.settings(style({ speed: 1.2, bass: 12 }));
  assert.equal(first.playbackRate, 1.2);
  assert.equal(second.playbackRate, 1.2);
  assert.equal(page.engines.length, 1);
});

test('sons contínuos seguem reprodução, pausa e espera da mídia', async () => {
  const page = createPageHarness();
  const track = new FakeMedia();
  page.media.push(track);
  page.settings(style({ rain: 72 }));
  assert.equal(page.engines[0].playing.at(-1), false);
  await track.play();
  assert.equal(page.engines[0].playing.at(-1), true);
  track.readyState = 2;
  track.dispatchEvent({ type: 'waiting' });
  assert.equal(page.engines[0].playing.at(-1), false);
  track.readyState = 4;
  track.dispatchEvent({ type: 'playing' });
  assert.equal(page.engines[0].playing.at(-1), true);
  track.pause();
  assert.equal(page.engines[0].playing.at(-1), false);
  await track.play();
  track.ended = true;
  track.dispatchEvent({ type: 'ended' });
  assert.equal(page.engines[0].playing.at(-1), false);
});

test('mídia protegida ou sem CORS não é ligada ao Web Audio da página', async () => {
  for (const blocked of [
    { mediaKeys: {} },
    { currentSrc: 'https://other.example/track', crossOrigin: null },
    { srcObject: {} },
  ]) {
    const page = createPageHarness();
    const track = new FakeMedia(blocked);
    page.media.push(track);
    page.settings(style({ speed: 0.8, reverb: 35 }));
    await flush();
    await track.play();
    assert.equal(track.playbackRate, 0.8);
    assert.equal(page.contexts.length, 0);
    let status;
    page.document.addEventListener('auracore:status', (event) => { status = JSON.parse(event.detail); });
    page.document.dispatchEvent({ type: 'auracore:status-request' });
    assert.equal(status.effects, 'blocked');
  }
});

test('fade usa a posição da faixa e é removido ao desligar', () => {
  const page = createPageHarness();
  const track = new FakeMedia({ paused: false, currentTime: 3, volume: 0.7, duration: 180 });
  page.media.push(track);
  page.settings(NEUTRAL_STYLE, { fade: 6 });
  assert.equal(track.volume, 0.7);
  track.currentTime = 178;
  track.dispatchEvent({ type: 'timeupdate' });
  assert.ok(track.volume < 0.7);
  page.settings(NEUTRAL_STYLE);
  assert.equal(track.volume, 0.7);
});

test('recarregar a página recupera o estilo do storage e aplica à nova mídia', () => {
  const stored = { enabled: true, style: style({ speed: 0.75, bass: 4 }), fade: 0, tapeStop: false };
  function loadContent(page) {
    const window = {};
    window.top = window;
    const chrome = {
      runtime: { onMessage: { addListener() {} }, onConnect: { addListener() {} }, sendMessage(message, callback) { if (message.type === 'is-target') callback(true); } },
      storage: { onChanged: { addListener() {} }, local: { get(defaults, callback) { callback({ ...defaults, ...stored }); } } },
    };
    const context = vm.createContext({
      window, chrome, document: page.document, NEUTRAL_STYLE, URLSearchParams,
      SHARE_KEY: 'auracore', location: { hash: '' },
      CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    });
    runScript(context, 'content.js');
  }
  const firstPage = createPageHarness();
  const firstTrack = new FakeMedia();
  firstPage.media.push(firstTrack);
  loadContent(firstPage);
  assert.equal(firstTrack.playbackRate, 0.75);
  const newPage = createPageHarness();
  const newTrack = new FakeMedia();
  newPage.media.push(newTrack);
  loadContent(newPage);
  assert.equal(newTrack.playbackRate, 0.75);
});

test('recarregar com storage assíncrono aguarda resolução e carrega chuva em mídia tardia', async () => {
  const stored = { enabled: true, style: style({ speed: 0.85, rain: 45 }), fade: 0, tapeStop: false };
  let resolveStorage;
  const audioRequests = [];
  const page = createPageHarness();
  const window = {};
  window.top = window;
  const chrome = {
    runtime: { onMessage: { addListener() {} }, onConnect: { addListener() {} }, getURL: (path) => `chrome-extension://test/${path}`, sendMessage(message, callback) { if (message.type === 'is-target') callback(true); } },
    storage: {
      onChanged: { addListener() {} },
      local: {
        get(defaults, callback) {
          resolveStorage = () => callback({ ...defaults, ...stored });
        },
      },
    },
  };
  const context = vm.createContext({
    window, chrome, document: page.document, NEUTRAL_STYLE, URLSearchParams,
    SHARE_KEY: 'auracore', location: { hash: '' },
    fetch: async (url) => {
      audioRequests.push(url);
      return { ok: true, blob: async () => ({}) };
    },
    FileReader: class {
      readAsDataURL() { this.result = 'data:audio/mpeg;base64,AQID'; this.onload(); }
    },
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
  });
  runScript(context, 'content.js');

  // page.js dispara auracore:ready antes do storage responder
  page.document.dispatchEvent({ type: 'auracore:ready' });

  // Storage responde com a receita salva ativa
  resolveStorage();

  // Mídia criada tardiamente no DOM após o reload (ex: YouTube MSE / polymer)
  const lateTrack = new FakeMedia();
  page.media.push(lateTrack);
  page.document.dispatchEvent({ type: 'play', target: lateTrack });

  assert.equal(lateTrack.playbackRate, 0.85);
  assert.equal(page.engines.length, 1);
  assert.equal(page.engines[0].styles.at(-1).rain, 45);
  assert.equal(page.contexts[0].sources.length, 1);
  assert.equal(page.contexts[0].sources[0].element, lateTrack);
  assert.equal(audioRequests.length, 0);
  const loading = page.engines[0].loadAmbience('rain');
  await flush();
  const rainBytes = await loading;
  assert.deepEqual([...new Uint8Array(rainBytes)], [1, 2, 3]);
  assert.deepEqual(audioRequests, ['chrome-extension://test/audio/rain.webm']);
});

test('tape stop pausa após a rampa e retoma na velocidade escolhida', async () => {
  const clock = new Clock();
  const page = createPageHarness({ clock });
  const track = new FakeMedia({ currentTime: 30 });
  page.media.push(track);
  page.settings(style({ speed: 0.8 }), { tapeStop: true });
  await track.play();
  clock.advance(400);
  assert.equal(track.playbackRate, 0.8);
  track.pause();
  assert.equal(track.paused, false);
  clock.advance(700);
  assert.equal(track.paused, true);
  assert.equal(track.playbackRate, 0.8);
  await track.play();
  clock.advance(400);
  assert.equal(track.paused, false);
  assert.equal(track.playbackRate, 0.8);
});

test('play durante a freada cancela o pause pendente', async () => {
  const clock = new Clock();
  const page = createPageHarness({ clock });
  const track = new FakeMedia({ currentTime: 30, paused: false });
  page.media.push(track);
  page.settings(style({ speed: 0.8 }), { tapeStop: true });
  track.pause();
  clock.advance(200);
  await track.play();
  clock.advance(1000);
  assert.equal(track.paused, false);
  assert.equal(track.playbackRate, 0.8);
});

test('mídia pausada com estilo ativo é roteada antes do play para evitar corte no áudio', async () => {
  const page = createPageHarness();
  const track = new FakeMedia({ paused: true });
  page.media.push(track);
  page.settings(style({ speed: 0.8, reverb: 35 }));
  await flush();
  assert.equal(page.contexts[0].sources.length, 1);
  assert.equal(page.contexts[0].sources[0].element, track);
});

test('aba sob captura não roteia o áudio no Web Audio da página', async () => {
  const page = createPageHarness();
  const track = new FakeMedia({ paused: true });
  page.media.push(track);
  page.settings(style({ speed: 0.8, reverb: 35 }), { captured: true });
  await flush();
  await track.play();
  assert.equal(page.contexts.length, 0);
  assert.equal(track.playbackRate, 0.8);
});

test('page.js injetado de novo após atualizar a extensão não cria outro motor nem outra freada', async () => {
  const clock = new Clock();
  const page = createPageHarness({ clock });
  const track = new FakeMedia({ currentTime: 30 });
  page.media.push(track);
  page.settings(style({ speed: 0.8, reverb: 35 }), { tapeStop: true });
  await track.play();
  page.context.auracoreEngine = { createEngine: () => assert.fail('segunda instância criou motor') };
  runScript(page.context, 'page.js');
  assert.equal(page.context.auracoreEngine, undefined);
  page.settings(style({ speed: 0.8, reverb: 40 }), { tapeStop: true });
  await track.play();
  assert.equal(page.contexts.length, 1);
  assert.equal(page.contexts[0].sources.length, 1);
  track.pause();
  clock.advance(700);
  assert.equal(track.paused, true);
});

test('status traz faixa e artista da Media Session', () => {
  const page = createPageHarness();
  const answers = [];
  page.document.addEventListener('auracore:status', (event) => answers.push(JSON.parse(event.detail)));
  page.document.dispatchEvent(new page.context.CustomEvent('auracore:status-request'));
  page.navigator.mediaSession.metadata = { title: "Gettin' Jiggy Wit It", artist: 'Will Smith' };
  page.document.dispatchEvent(new page.context.CustomEvent('auracore:status-request'));
  assert.equal(answers[0].track, '');
  assert.equal(answers[0].artist, '');
  assert.equal(answers[1].track, "Gettin' Jiggy Wit It");
  assert.equal(answers[1].artist, 'Will Smith');
});
