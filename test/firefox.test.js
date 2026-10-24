const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const root = join(__dirname, '..');

test('manifest do Firefox usa página de eventos e não pede captura de aba', () => {
  const chrome = require(join(root, 'manifest.json'));
  const firefox = JSON.parse(execFileSync(process.execPath, [join(root, 'tools/firefox-manifest.mjs')], { encoding: 'utf8' }));
  assert.deepEqual(firefox.background, { scripts: ['styles.js', 'background.js'] });
  assert.deepEqual(firefox.permissions, chrome.permissions.filter((permission) => !['tabCapture', 'offscreen'].includes(permission)));
  assert.equal(firefox.minimum_chrome_version, undefined);
  assert.equal(firefox.browser_specific_settings.gecko.id, 'auracore@lucaswotta');
  assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, '128.0');
  assert.deepEqual(firefox.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] });
  assert.deepEqual(firefox.content_scripts, chrome.content_scripts);
  assert.equal(firefox.version, chrome.version);
});
