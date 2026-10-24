const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadStyles, runScript } = require('./helpers');

const { PRESETS } = loadStyles();

function canvas(width = 380, height = 156, trace = []) {
  const context = new Proxy({}, {
    get(target, key) {
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (key === 'measureText') return () => ({ width: 10 });
      return target[key] ?? ((...args) => {
        if (['arc', 'ellipse', 'fillRect'].includes(key)) trace.push({ method: key, args });
        if (['arc', 'ellipse', 'fillRect', 'strokeRect', 'moveTo', 'lineTo', 'bezierCurveTo'].includes(key)) {
          assert.ok(args.every((value) => typeof value === 'number' && Number.isFinite(value)), `${String(key)} recebeu coordenadas inválidas`);
        }
      });
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  return { clientWidth: width, clientHeight: height, getContext() { return context; } };
}

test('cada cena desenha em popup e estúdio com coordenadas válidas', () => {
  const frames = [];
  const document = { documentElement: { style: { setProperty() {} } } };
  const sandbox = vm.createContext({
    document, devicePixelRatio: 1, performance: { now: () => 0 },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {},
  });
  runScript(sandbox, 'scenes.js');
  for (const [width, height] of [[380, 156], [560, 768]]) {
    const stage = sandbox.createStage(canvas(width, height), canvas(width, height), {
      offsetLeft: 100, offsetTop: 40, offsetWidth: 180, offsetHeight: 180,
    }, () => {});
    stage.setLevel(0.6, Array(16).fill(0.5));
    for (const id of [...PRESETS.map((preset) => preset.id), 'custom']) {
      assert.doesNotThrow(() => stage.setTheme(id), id);
      assert.doesNotThrow(() => frames.at(-1)(1000), id);
    }
  }
});

test('variantes 8D percorrem trajetórias visuais distintas', () => {
  const sandbox = vm.createContext({ Math });
  runScript(sandbox, 'scenes.js');
  const positions = [0, 1, 2].map((orbit) => {
    const arcs = [];
    const back = canvas(380, 156, arcs).getContext('2d');
    const front = canvas(380, 156, arcs).getContext('2d');
    sandbox.orbit(['#4d7cff', '#9b5cff', '#22e4ff'])({ back, front }, {
      t: 1, dt: 0.016, w: 380, h: 156, cx: 190, cy: 78,
      level: 0.5, bands: Array(16).fill(0.5), style: { orbit, spin: 45 },
    });
    return arcs.filter(({ method }) => method === 'arc').at(-1).args[0];
  });
  assert.equal(new Set(positions.map((position) => position.toFixed(3))).size, 3);
});

test('sol vaporwave fica centralizado no palco', () => {
  const trace = [];
  const sandbox = vm.createContext({ Math });
  runScript(sandbox, 'scenes.js');
  const back = canvas(380, 156, trace).getContext('2d');
  sandbox.vaporwave(['#ff71ce', '#b967ff', '#01cdfe'])({ back }, {
    t: 0, dt: 0.016, w: 380, h: 156, cx: 190, cy: 78,
    level: 0.5, bands: Array(16).fill(0.5), activity: 0.5,
  });
  assert.equal(trace.find(({ method }) => method === 'arc').args[0], 190);
});

test('slowed emite ecos nos graves e deixa os anéis desaparecerem', () => {
  const trace = [];
  const sandbox = vm.createContext({ Math });
  runScript(sandbox, 'scenes.js');
  const back = canvas(380, 156, trace).getContext('2d');
  const scene = sandbox.echoChamber(['#9676b6', '#52607d', '#c8c3dc']);
  const frame = { t: 0, dt: 0.016, w: 380, h: 156, bands: Array(16).fill(0), level: 0 };

  scene({ back }, frame);
  assert.equal(trace.filter(({ method }) => method === 'ellipse').length, 5);

  trace.length = 0;
  scene({ back }, { ...frame, t: 0.1, bands: Array(16).fill(0.8), level: 0.8 });
  assert.equal(trace.filter(({ method }) => method === 'ellipse').length, 6);

  trace.length = 0;
  scene({ back }, { ...frame, t: 3.1 });
  assert.equal(trace.filter(({ method }) => method === 'ellipse').length, 5);
});

test('banheiro da balada e lo-fi mostram barras ligadas às bandas em toda a largura', () => {
  const sandbox = vm.createContext({ Math });
  runScript(sandbox, 'scenes.js');
  const bands = Array.from({ length: 16 }, (_, index) => index < 8 ? 0.2 : 0.9);
  const frame = { t: 1, dt: 0.016, w: 380, h: 156, cx: 190, cy: 78, level: 0.5, bands, activity: 0.9 };

  for (const [scene, inset] of [[sandbox.lofi, 0], [sandbox.partyBathroom, 0.04]]) {
    const trace = [];
    scene(['#f2b880', '#c98b6b', '#8fb8a8'])({ back: canvas(380, 156, trace).getContext('2d') }, frame);
    const bars = trace
      .filter(({ method, args }) => method === 'fillRect' && args[1] < frame.h * 0.64 && args[2] < 20)
      .map(({ args }) => args);
    assert.ok(bars.length >= 20);
    assert.ok(Math.min(...bars.map(([x]) => x)) >= frame.w * inset);
    assert.ok(Math.max(...bars.map(([x, , width]) => x + width)) <= frame.w * (1 - inset));
    assert.ok(Math.max(...bars.map(([, , , height]) => height)) - Math.min(...bars.map(([, , , height]) => height)) > frame.h * 0.1);
  }
});

test('estádio vazio mostra o espectro até o lado direito do palco', () => {
  const trace = [];
  const sandbox = vm.createContext({ Math });
  runScript(sandbox, 'scenes.js');
  const back = canvas(380, 156, trace).getContext('2d');
  sandbox.emptyArena(['#4cc9f0', '#7209b7', '#f72585'])({ back }, {
    t: 1, dt: 0.016, w: 380, h: 156, cx: 190, cy: 78, level: 0,
    bands: Array.from({ length: 16 }, (_, index) => index === 15 ? 0.64 : 0),
  });
  const bars = trace.filter(({ method, args }) => method === 'fillRect' && args[0] > 340 && args[2] < 20);
  assert.ok(bars.length > 0);
  assert.ok(Math.max(...bars.map(({ args }) => args[0] + args[2])) > 370);
});

test('banda média anima o equalizador mesmo com nível de grave zero', () => {
  const frames = [];
  const trace = [];
  const sandbox = vm.createContext({
    document: { documentElement: { style: { setProperty() {} } } },
    devicePixelRatio: 1, performance: { now: () => 0 },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {},
  });
  runScript(sandbox, 'scenes.js');
  const stage = sandbox.createStage(canvas(380, 156, trace), canvas(), {}, () => {});
  stage.setTheme('nightcore');
  stage.setLevel(0, Array.from({ length: 16 }, (_, index) => index === 5 ? 0.6 : 0));
  frames.at(-1)(1000);
  assert.ok(trace.some(({ method, args }) => method === 'fillRect' && args[2] < 20 && args[3] > 5));
});

test('bass e phonk não balançam o botão da extensão', () => {
  const frames = [];
  const shakes = [];
  const sandbox = vm.createContext({
    document: { documentElement: { style: { setProperty() {} } } },
    devicePixelRatio: 1, performance: { now: () => 0 },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {},
  });
  runScript(sandbox, 'scenes.js');
  const stage = sandbox.createStage(canvas(), canvas(), {}, (amount) => shakes.push(amount));
  for (const id of ['bass', 'phonk']) {
    stage.setTheme(id);
    stage.setLevel(0.8, Array(16).fill(0.8));
    frames.at(-1)(1000);
  }
  assert.ok(shakes.every((amount) => amount === 0));
});

test('movimento reduzido redesenha ao reativar o palco', () => {
  const trace = [];
  const sandbox = vm.createContext({
    document: { documentElement: { style: { setProperty() {} } } },
    devicePixelRatio: 1, performance: { now: () => 0 },
    matchMedia: () => ({ matches: true }),
    requestAnimationFrame() { throw new Error('animação contínua em movimento reduzido'); },
    cancelAnimationFrame() {},
  });
  runScript(sandbox, 'scenes.js');
  const stage = sandbox.createStage(canvas(380, 156, trace), canvas(), {}, () => {});
  stage.setTheme('aura');
  stage.setActive(false);
  const before = trace.length;
  stage.setActive(true);
  assert.ok(trace.length > before);
});

test('desativar a animação pausa o loop e ativar retoma', () => {
  let cancelled = false;
  let requested = 0;
  const document = { documentElement: { style: { setProperty() {} } } };
  const sandbox = vm.createContext({
    document, devicePixelRatio: 1, performance: { now: () => 0 },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame() { requested++; return requested; },
    cancelAnimationFrame() { cancelled = true; },
  });
  runScript(sandbox, 'scenes.js');
  const stage = sandbox.createStage(canvas(), canvas(), {
    offsetLeft: 0, offsetTop: 0, offsetWidth: 100, offsetHeight: 100,
  }, () => {});
  stage.setTheme('slowed');
  stage.setActive(false);
  assert.equal(cancelled, true);
  cancelled = false;
  const before = requested;
  stage.setActive(true);
  assert.ok(requested > before);
});

test('áudio pausado ou nulo zera pulso e bandas sem oscilação sintética', () => {
  const frames = [];
  const document = { documentElement: { style: { setProperty() {} } } };
  const trace = [];
  const sandbox = vm.createContext({
    document, devicePixelRatio: 1, performance: { now: () => 0 },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {},
  });
  runScript(sandbox, 'scenes.js');
  const stage = sandbox.createStage(canvas(380, 156, trace), canvas(), {
    offsetLeft: 0, offsetTop: 0, offsetWidth: 100, offsetHeight: 100,
  }, () => {});
  stage.setTheme('nightcore');
  stage.setLevel(0.5, Array(16).fill(0.5));
  frames.at(-1)(500);
  assert.ok(trace.some(({ method, args }) => method === 'fillRect' && args[2] < 20 && args[3] > 5));
  trace.length = 0;
  stage.setLevel(null, null);
  frames.at(-1)(1000);
  assert.equal(trace.some(({ method, args }) => method === 'fillRect' && args[2] < 20 && args[3] > 5), false);
});

test('receita salva seleciona o tema customizado', () => {
  const properties = new Map();
  const sandbox = vm.createContext({
    document: { documentElement: { style: { setProperty(name, value) { properties.set(name, value); } } } },
    devicePixelRatio: 1, performance: { now: () => 0 },
    matchMedia: () => ({ matches: true }),
    requestAnimationFrame() {}, cancelAnimationFrame() {},
  });
  runScript(sandbox, 'scenes.js');
  const stage = sandbox.createStage(canvas(), canvas(), {}, () => {});
  stage.setTheme('custom-7');
  assert.equal(properties.get('--bg'), '#08121c');
});
