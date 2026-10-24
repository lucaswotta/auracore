const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStyles } = require('./helpers');

const { NEUTRAL_STYLE, PRESETS, STYLE_LIMITS, presetVariants, encodeStyle, decodeStyle } = loadStyles();

test('todos os presets e variantes respeitam os limites', () => {
  for (const preset of PRESETS) {
    for (const variant of presetVariants(preset)) {
      for (const [key, [min, max]] of Object.entries(STYLE_LIMITS)) {
        assert.ok(variant.style[key] >= min && variant.style[key] <= max, `${preset.id}/${variant.id}: ${key}`);
      }
    }
  }
});

test('variantes de um preset não alteram as outras receitas', () => {
  const preset = PRESETS.find(({ id }) => id === 'lofi');
  const variants = presetVariants(preset);
  const original = variants[1].style.bass;
  variants[0].style.bass = 99;
  assert.equal(variants[1].style.bass, original);
  assert.equal(preset.style.bass, original);
});

test('lo-fi mantém a textura de vinil discreta em todas as intensidades', () => {
  const preset = PRESETS.find(({ id }) => id === 'lofi');
  assert.deepEqual(Array.from(presetVariants(preset), ({ style }) => style.vinyl), [6, 10, 14]);
});

test('na chuva soa ao ar livre, sem abafamento', () => {
  const preset = PRESETS.find(({ id }) => id === 'rainy');
  assert.equal(preset.name, 'na chuva');
  assert.equal(preset.style.muffle, 0);
  assert.equal(preset.style.warmth, 0);
  assert.equal(preset.style.rain, 72);
});

test('debaixo d\'água inclui o ambiente subaquático', () => {
  const preset = PRESETS.find(({ id }) => id === 'underwater');
  assert.equal(preset.style.water, 68);
  assert.equal(preset.style.rain, 0);
});

test('chuva e água mantêm a velocidade original em todas as intensidades', () => {
  for (const id of ['rainy', 'underwater']) {
    const preset = PRESETS.find((item) => item.id === id);
    for (const variant of presetVariants(preset)) {
      assert.equal(variant.style.speed, 1, `${id}/${variant.id}`);
    }
  }
});

test('chuva e água ficam mais audíveis conforme a intensidade', () => {
  for (const [id, kind, expected] of [
    ['rainy', 'rain', [43, 72, 100]],
    ['underwater', 'water', [41, 68, 95]],
  ]) {
    const preset = PRESETS.find((item) => item.id === id);
    assert.deepEqual(Array.from(presetVariants(preset), (variant) => variant.style[kind]), expected, id);
  }
});

test('compartilhamento preserva os parâmetros e limita valores externos', () => {
  for (const preset of PRESETS) {
    const code = encodeStyle(preset.style, preset.name);
    const decoded = decodeStyle(code);
    assert.deepEqual({ ...decoded.style }, { ...preset.style }, preset.id);
    assert.equal(decoded.name, preset.name);
  }
  const hostile = decodeStyle('speed=99&pitch=-99&orbit=999&bass=NaN');
  assert.equal(hostile.style.speed, 1.5);
  assert.equal(hostile.style.pitch, -12);
  assert.equal(hostile.style.orbit, 2);
  assert.equal(hostile.style.bass, NEUTRAL_STYLE.bass);
  assert.equal(decodeStyle(encodeStyle({ ...NEUTRAL_STYLE, linkPitch: false }, 'tom fixo')).style.linkPitch, false);
});
