const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { loadStyles } = require('./helpers');

const root = join(__dirname, '..');
const read = (file) => readFileSync(join(root, file), 'utf8');
const locales = Object.fromEntries(readdirSync(join(root, '_locales')).map((locale) => [locale, JSON.parse(read(`_locales/${locale}/messages.json`))]));
// Pix só existe no Brasil; o popup só pede essas chaves com o Chrome em pt-BR.
const PIX_ONLY = ['support_pix_copy', 'support_pix_alt', 'toast_pix_copied', 'toast_pix_failed'];

test('inglês, espanhol e português do Brasil têm as mesmas chaves e placeholders', () => {
  assert.deepEqual(Object.keys(locales).sort(), ['en', 'es', 'pt_BR']);
  const shared = Object.keys(locales.en).sort();
  assert.deepEqual(Object.keys(locales.es).sort(), shared);
  assert.deepEqual(Object.keys(locales.pt_BR).filter((key) => !PIX_ONLY.includes(key)).sort(), shared);
  for (const key of PIX_ONLY) assert.ok(locales.pt_BR[key], key);
  for (const [locale, messages] of Object.entries(locales)) {
    for (const [key, { message, placeholders }] of Object.entries(messages)) {
      assert.ok(message.trim(), `${locale}/${key} vazio`);
      const used = [...message.matchAll(/\$([a-z0-9_]+)\$/gi)].map(([, name]) => name.toLowerCase()).sort();
      assert.deepEqual(used, Object.keys(placeholders ?? {}).sort(), `${locale}/${key}`);
    }
  }
});

test('toda chave usada no código e no HTML existe', () => {
  const used = new Set();
  for (const file of ['styles.js', 'popup.js', 'content.js', 'background.js']) {
    for (const [, key] of read(file).matchAll(/msg\('([a-z0-9_@]+)'/g)) used.add(key);
    for (const [, keys] of read(file).matchAll(/msg\(([^()]*\?[^()]*)\)/g)) {
      for (const [, key] of keys.matchAll(/'([a-z0-9]+_[a-z0-9_]+)'/g)) used.add(key);
    }
  }
  for (const [, key] of read('popup.html').matchAll(/data-i18n[a-z-]*="([^"]+)"/g)) used.add(key);
  for (const [, key] of read('manifest.json').matchAll(/__MSG_([a-z0-9_]+)__/g)) used.add(key);
  used.delete('@@ui_locale');
  assert.ok(used.size > 60);
  for (const key of used) {
    const messages = PIX_ONLY.includes(key) ? locales.pt_BR : locales.en;
    assert.ok(messages[key], `chave ausente: ${key}`);
  }
});

test('descrição cabe no limite da Chrome Web Store e nomes compartilhados no limite do link', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.default_locale, 'en');
  for (const [locale, messages] of Object.entries(locales)) {
    assert.ok(messages.ext_description.message.length <= 132, locale);
    const { PRESETS, presetVariants } = loadStyles(locale.replace('_', '-'));
    for (const preset of PRESETS) {
      for (const variant of presetVariants(preset)) {
        assert.ok(`${preset.name} · ${variant.name}`.length <= 40, `${locale}: ${preset.name} · ${variant.name}`);
      }
    }
  }
});
