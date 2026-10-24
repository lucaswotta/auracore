const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { Events, loadStyles, runScript } = require('./helpers');

const { NEUTRAL_STYLE } = loadStyles();

function createCaptureHarness({ suspended = false, resumes = true } = {}) {
  const streams = [];
  const contexts = [];
  const engines = [];
  const notifications = [];
  let listener;
  class Track extends Events {
    stop() { this.stopped = true; }
    end() { this.dispatchEvent({ type: 'ended' }); }
  }
  class AudioContext {
    constructor() { this.state = suspended ? 'suspended' : 'running'; this.sources = []; contexts.push(this); }
    createMediaStreamSource(stream) {
      const source = { stream, connect(input) { this.input = input; } };
      this.sources.push(source);
      return source;
    }
    close() { this.state = 'closed'; return Promise.resolve(); }
    resume() { if (resumes) this.state = 'running'; return Promise.resolve(); }
  }
  const chrome = { runtime: {
    onMessage: { addListener(callback) { listener = callback; } },
    async sendMessage(message) { notifications.push(message); },
  } };
  const navigator = { mediaDevices: { async getUserMedia() {
    const track = new Track();
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    streams.push(stream);
    return stream;
  } } };
  const context = vm.createContext({ chrome, navigator, AudioContext, auracoreEngine: { createEngine(audioContext) {
    const engine = { input: {}, styles: [], playing: [], set(style) { this.styles.push({ ...style }); }, setPlaying(value) { this.playing.push(value); }, bassLevel() { return 0.5; } };
    engines.push(engine);
    return engine;
  } } });
  runScript(context, 'offscreen.js');
  function send(type, fields = {}) {
    return new Promise((resolve) => {
      let answered = false;
      const async = listener({ target: 'offscreen', type, ...fields }, {}, (value) => {
        answered = true;
        resolve(value);
      });
      if (async !== true && !answered) resolve(undefined);
    });
  }
  return { send, streams, contexts, engines, notifications };
}

test('captura começa, troca de estilo, desliga e encerra com a aba', async () => {
  const capture = createCaptureHarness();
  const active = { ...NEUTRAL_STYLE, reverb: 35 };
  assert.equal((await capture.send('start', { tabId: 4, streamId: 'stream-4', style: active })).state, 'running');
  assert.deepEqual([...await capture.send('list')], [4]);
  assert.equal(capture.engines[0].styles.at(-1).reverb, 35);
  await capture.send('style', { style: NEUTRAL_STYLE });
  assert.equal(capture.engines[0].styles.at(-1).reverb, 0);
  assert.equal(await capture.send('level', { tabId: 4 }), 0.5);
  await capture.send('stop', { tabId: 4 });
  assert.deepEqual([...await capture.send('list')], []);
  assert.equal(capture.contexts[0].state, 'closed');
});

test('encerrar a captura pelo Chrome remove a aba da lista', async () => {
  const capture = createCaptureHarness();
  await capture.send('start', { tabId: 7, streamId: 'stream-7', style: NEUTRAL_STYLE });
  capture.streams[0].getTracks()[0].end();
  assert.deepEqual([...await capture.send('list')], []);
  assert.equal(capture.contexts[0].state, 'closed');
  assert.equal(capture.notifications.length, 1);
  assert.equal(capture.notifications[0].target, 'background');
  assert.equal(capture.notifications[0].type, 'capture-ended');
  assert.equal(capture.notifications[0].tabId, 7);
});

test('evento antigo não encerra uma captura substituta da mesma aba', async () => {
  const capture = createCaptureHarness();
  await capture.send('start', { tabId: 7, streamId: 'old', style: NEUTRAL_STYLE });
  await capture.send('start', { tabId: 7, streamId: 'new', style: NEUTRAL_STYLE });
  capture.streams[0].getAudioTracks()[0].end();
  assert.deepEqual([...await capture.send('list')], [7]);
  assert.deepEqual(capture.notifications, []);
});

test('captura libera sons contínuos só com mídia em reprodução', async () => {
  const capture = createCaptureHarness();
  await capture.send('start', { tabId: 7, streamId: 'stream-7', style: NEUTRAL_STYLE });
  await capture.send('playback', { tabId: 7, frameId: 0, playing: true });
  assert.equal(capture.engines[0].playing.at(-1), true);
  await capture.send('playback', { tabId: 7, frameId: 1, playing: false });
  assert.equal(capture.engines[0].playing.at(-1), true);
  await capture.send('playback', { tabId: 7, frameId: 0, playing: false });
  assert.equal(capture.engines[0].playing.at(-1), false);
});

test('captura só fica ativa quando o contexto de áudio está tocando', async () => {
  const capture = createCaptureHarness({ suspended: true, resumes: false });
  const response = await capture.send('start', { tabId: 8, streamId: 'stream-8', style: NEUTRAL_STYLE });
  assert.match(response.error, /áudio/);
  assert.deepEqual([...await capture.send('list')], []);
  assert.equal(capture.streams[0].getTracks()[0].stopped, true);
  assert.equal(capture.contexts[0].state, 'closed');
});

test('contexto inicialmente suspenso é retomado antes de marcar a captura ativa', async () => {
  const capture = createCaptureHarness({ suspended: true });
  const response = await capture.send('start', { tabId: 8, streamId: 'stream-8', style: NEUTRAL_STYLE });
  assert.equal(response.state, 'running');
  assert.deepEqual([...await capture.send('list')], [8]);
});
