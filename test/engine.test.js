const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadStyles, runScript } = require('./helpers');

const { NEUTRAL_STYLE, PRESETS } = loadStyles();
const audioKeys = ['pitch', 'bass', 'muffle', 'warmth', 'wobble', 'chorus', 'vinyl', 'rain', 'water', 'reverb', 'spin'];

class AudioParam {
  constructor(value = 0) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
}

class AudioNode {
  constructor(context, options = {}) {
    this.outputs = [];
    this.buffer = options.buffer;
    this.loop = options.loop;
    this.loopStart = options.loopStart;
    this.loopEnd = options.loopEnd;
    for (const [name, value] of Object.entries({
      gain: options.gain ?? 1, frequency: options.frequency ?? 0,
      Q: options.Q ?? 0, delayTime: options.delayTime ?? 0,
      positionX: 0, positionY: 0, positionZ: 0,
    })) this[name] = new AudioParam(value);
    context.nodes.push(this);
  }
  connect(node) { this.outputs.push(node); return node; }
  disconnect() { this.outputs = []; }
  start(when, offset) { this.offset = offset; }
  stop() {}
  setPeriodicWave() {}
}

class AnalyserNode extends AudioNode {
  constructor(context, options) { super(context, options); this.frequencyBinCount = 512; }
  getByteFrequencyData(array) { array.fill(0); }
}

function createEngineHarness() {
  const ambienceBuffer = (seconds) => {
    const data = Float32Array.from({ length: seconds * 8000 }, (_, i) => i);
    return { duration: seconds, sampleRate: 8000, length: data.length, numberOfChannels: 1, getChannelData: () => data };
  };
  const ambienceBuffers = { rain: ambienceBuffer(41), water: ambienceBuffer(43) };
  const ambienceLoads = { rain: 0, water: 0 };
  const context = {
    nodes: [], currentTime: 0, sampleRate: 8000, destination: {},
    async decodeAudioData(bytes) {
      assert.equal(bytes.byteLength, 3);
      return new Uint8Array(bytes)[0] === 1 ? ambienceBuffers.rain : ambienceBuffers.water;
    },
    createBuffer(channels, length) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData(channel) { return data[channel]; } };
    },
    createPeriodicWave() { return {}; },
  };
  const constructors = Object.fromEntries([
    'GainNode', 'BiquadFilterNode', 'WaveShaperNode', 'ConvolverNode',
    'DynamicsCompressorNode', 'OscillatorNode', 'DelayNode',
    'ChannelMergerNode', 'AudioBufferSourceNode', 'PannerNode',
  ].map((name) => [name, AudioNode]));
  const sandbox = vm.createContext({
    ...constructors, AnalyserNode,
    setTimeout(callback) { callback(); return 1; }, clearTimeout() {},
  });
  runScript(sandbox, 'engine.js');
  const engine = sandbox.auracoreEngine.createEngine(context, async (kind) => {
    ambienceLoads[kind]++;
    return new Uint8Array([kind === 'rain' ? 1 : 2, 2, 3]).buffer;
  });
  const outputs = context.nodes.filter((node) => node.outputs.includes(context.destination));
  assert.equal(outputs.length, 2);
  return {
    engine,
    context,
    bypass: outputs.find((node) => node.gain.value === 1),
    processed: outputs.find((node) => node.gain.value === 0),
    ambienceBuffers,
    ambienceLoads,
  };
}

test('ambientes usam as gravações em loop e carregam cada áudio uma vez', async () => {
  const { engine, context, ambienceBuffers, ambienceLoads } = createEngineHarness();
  for (const [presetId, kind, expectedGain] of [['rainy', 'rain', 1.44], ['underwater', 'water', 0.68]]) {
    const style = PRESETS.find(({ id }) => id === presetId).style;
    engine.set(style);
    await new Promise(setImmediate);
    const source = context.nodes.find((node) => node.buffer === ambienceBuffers[kind]);
    assert.ok(source);
    assert.equal(source.loop, true);
    assert.ok(Math.abs(source.outputs[0].outputs[0].gain.value - expectedGain) < 1e-10, presetId);
    const playbackGate = source.outputs[0].outputs[0].outputs[0];
    assert.equal(playbackGate.gain.value, 0);
    engine.setPlaying(true);
    assert.equal(playbackGate.gain.value, 1);
    engine.setPlaying(false);
    assert.equal(playbackGate.gain.value, 0);
    engine.set(NEUTRAL_STYLE);
    engine.set(style);
    assert.equal(ambienceLoads[kind], 1);
  }
});

test('vinil também passa pelo controle de reprodução', () => {
  const { engine, context } = createEngineHarness();
  engine.set(PRESETS.find(({ id }) => id === 'lofi').style);
  const source = context.nodes.find((node) => node.loop === true);
  const lowpass = source.outputs[0].outputs[0];
  assert.equal(lowpass.frequency.value, 3500);
  const output = lowpass.outputs[0].outputs[0];
  assert.ok(Math.abs(output.gain.value - 0.00158) < 1e-10);
  const playbackGate = output.outputs[0];
  assert.equal(playbackGate.gain.value, 0);
  engine.setPlaying(true);
  assert.equal(playbackGate.gain.value, 1);
  engine.setPlaying(false);
  assert.equal(playbackGate.gain.value, 0);
});

test('cada estilo ativa só o caminho processado e o neutro restaura o caminho direto', () => {
  const { engine, bypass, processed } = createEngineHarness();
  for (const preset of PRESETS) {
    engine.set(preset.style);
    const active = audioKeys.some((key) => preset.style[key]);
    assert.equal(bypass.gain.value, active ? 0 : 1, preset.id);
    assert.equal(processed.gain.value, active ? 1 : 0, preset.id);
    assert.ok(engine.input.outputs.includes(bypass), preset.id);
    engine.set(NEUTRAL_STYLE);
    assert.equal(bypass.gain.value, 1, preset.id);
    assert.equal(processed.gain.value, 0, preset.id);
  }
});

test('trocas repetidas de efeitos não acumulam saídas audíveis', () => {
  const { engine, bypass, processed } = createEngineHarness();
  const lofi = PRESETS.find(({ id }) => id === 'lofi').style;
  const eightD = PRESETS.find(({ id }) => id === '8d').style;
  for (let count = 0; count < 3; count++) {
    engine.set(lofi);
    engine.set(eightD);
    engine.set(NEUTRAL_STYLE);
    assert.equal(bypass.gain.value, 1);
    assert.equal(processed.gain.value, 0);
    assert.equal(engine.input.outputs.filter((node) => node === bypass).length, 1);
  }
});

test('audioLevels retorna nível de graves e 16 bandas de frequência', () => {
  const { engine } = createEngineHarness();
  const levels = engine.audioLevels();
  assert.equal(typeof levels.level, 'number');
  assert.equal(Array.isArray(levels.bands), true);
  assert.equal(levels.bands.length, 16);
});

test('loop ambiente toca só o miolo e emenda o início na sobra final', async () => {
  const { engine, context, ambienceBuffers } = createEngineHarness();
  engine.set(PRESETS.find(({ id }) => id === 'underwater').style);
  await new Promise(setImmediate);
  const buffer = ambienceBuffers.water;
  const source = context.nodes.find((node) => node.buffer === buffer);
  assert.equal(source.loopStart, 0.05);
  assert.equal(source.loopEnd, 43 - 0.05);
  assert.equal(source.offset, 0.05);
  // Amostras valem o próprio índice: o primeiro ponto do miolo vira a amostra logo após o fim do miolo,
  // e a mistura chega ao valor original ao fim dos 10 ms.
  const data = buffer.getChannelData(0);
  const pad = 400;
  const end = buffer.length - pad;
  assert.equal(data[pad], end);
  assert.ok(Math.abs(data[pad + 40] - ((pad + 40) * 0.5 + (end + 40) * 0.5)) < 1);
  assert.equal(data[pad + 80], pad + 80);
});
