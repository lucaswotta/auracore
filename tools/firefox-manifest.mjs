// Gera o manifest do Firefox a partir do manifest do Chrome. O Firefox roda o background como página
// de eventos (sem service worker nem importScripts) e não tem captura de aba nem documento offscreen;
// a versão 128 é a primeira com content scripts no mundo MAIN.
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
delete manifest.minimum_chrome_version;
manifest.background = { scripts: ['styles.js', 'background.js'] };
manifest.permissions = manifest.permissions.filter((permission) => !['tabCapture', 'offscreen'].includes(permission));
manifest.browser_specific_settings = {
  gecko: {
    id: 'auracore@lucaswotta',
    strict_min_version: '128.0',
    data_collection_permissions: { required: ['none'] },
  },
};
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
