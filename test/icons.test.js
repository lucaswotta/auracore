const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('ícones ligado e desligado mantêm as estrelas na mesma geometria', () => {
  const icons = ['icon.svg', 'icon-off.svg'].map((name) => readFileSync(join(__dirname, '..', 'icons', name), 'utf8'));
  const geometry = icons.map((svg) => {
    const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
    const stars = svg.match(/<g fill="[^"]+" stroke="[^"]+" stroke-width="([^"]+)" stroke-linejoin="([^"]+)">([\s\S]*?)<\/g>/);
    assert.ok(viewBox && stars, 'ícone sem geometria das estrelas');
    return {
      viewBox,
      strokeWidth: stars[1],
      lineJoin: stars[2],
      paths: [...stars[3].matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]),
    };
  });
  assert.equal(geometry[0].paths.length, 2);
  assert.deepEqual(geometry[0], geometry[1]);
});
