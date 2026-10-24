const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadStyles } = require('./helpers');

test('cada estilo tem arte WebP com transparência para o popup', () => {
  const { PRESETS } = loadStyles();
  for (const id of [...PRESETS.map((preset) => preset.id), 'custom']) {
    const image = readFileSync(join(__dirname, '..', 'artwork', `${id}.webp`));
    assert.equal(image.toString('ascii', 0, 4), 'RIFF', id);
    assert.equal(image.toString('ascii', 8, 12), 'WEBP', id);
    assert.equal(image.toString('ascii', 12, 16), 'VP8X', id);
    assert.ok(image[20] & 0x10, `${id} perdeu o canal alfa`);
    assert.equal(image.readUIntLE(24, 3) + 1, 640, id);
    assert.equal(image.readUIntLE(27, 3) + 1, 800, id);
  }
});

test('código Pix do popup tem CRC válido e o QR acompanha o pacote', () => {
  const source = readFileSync(join(__dirname, '..', 'popup.js'), 'utf8');
  const code = source.match(/const PIX_CODE = '([^']+)'/)[1];
  let crc = 0xffff;
  for (const byte of Buffer.from(code.slice(0, -4))) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  assert.equal(code.slice(-4), crc.toString(16).toUpperCase().padStart(4, '0'));
  assert.match(readFileSync(join(__dirname, '..', 'support', 'pix-qr.svg'), 'utf8'), /^<svg /);
});
