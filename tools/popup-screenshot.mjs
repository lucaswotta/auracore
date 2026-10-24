// Abre o popup da extensão num Chrome de teste e salva uma captura. Serve para revisar a interface
// sem depender do navegador do usuário, inclusive dentro do sandbox de agentes de código.
//
// Uso: node tools/popup-screenshot.mjs [--out arquivo.png] [--style "lo-fi"] [--variant intenso]
//                                      [--view custom|about|support] [--lang pt-BR] [--wait 1500]
//                                      [--demo-audio] [--layout] [--track "Faixa • Artista"]
//
// --layout imprime, em JSON, rolagem da página e do painel aberto e nomes de estilo que não couberam
// no botão.
//
// O Chrome estável ignora --load-extension; por isso o padrão é o Chrome for Testing do cache do
// Playwright. CHROME_BIN aponta outro binário.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({
  options: {
    out: { type: 'string', default: join(tmpdir(), 'auracore-popup.png') },
    style: { type: 'string' },
    variant: { type: 'string' },
    view: { type: 'string' },
    lang: { type: 'string' },
    wait: { type: 'string', default: '1500' },
    'demo-audio': { type: 'boolean', default: false },
    scroll: { type: 'string' },
    layout: { type: 'boolean', default: false },
    track: { type: 'string' },
  },
});

const extension = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chromeBin = process.env.CHROME_BIN ?? join(homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome');
if (!existsSync(chromeBin)) throw new Error(`Chrome de teste não encontrado em ${chromeBin}; defina CHROME_BIN.`);

// ID de extensão sem compactação: SHA-256 do caminho, 32 primeiros dígitos hex mapeados para a-p.
const extensionId = [...createHash('sha256').update(extension).digest('hex').slice(0, 32)]
  .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
  .join('');

// Perfil e configuração em pasta temporária: dentro de sandboxes o $HOME costuma ser somente
// leitura, e o Chrome trava tentando gravar relatórios de falha em ~/.config.
const workDir = mkdtempSync(join(tmpdir(), 'auracore-chrome-'));
const chrome = spawn(chromeBin, [
  '--headless=new',
  '--no-sandbox',
  `--user-data-dir=${join(workDir, 'profile')}`,
  `--load-extension=${extension}`,
  '--remote-debugging-port=0',
  ...(options.lang ? [`--lang=${options.lang}`] : []),
  'about:blank',
], { env: { ...process.env, XDG_CONFIG_HOME: join(workDir, 'config'), XDG_CACHE_HOME: join(workDir, 'cache') }, stdio: 'ignore' });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function devtoolsPort() {
  const file = join(workDir, 'profile', 'DevToolsActivePort');
  for (let attempt = 0; attempt < 80; attempt++) {
    if (existsSync(file)) return readFileSync(file, 'utf8').split('\n')[0];
    await sleep(250);
  }
  throw new Error('O Chrome não abriu a porta de depuração em 20 s.');
}

async function connect(port) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${extensionId}/popup.html`, { method: 'PUT' })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (message) => {
    const reply = JSON.parse(message.data);
    pending.get(reply.id)?.(reply);
  };
  return (method, params = {}) => new Promise((done, fail) => {
    const id = ++nextId;
    pending.set(id, (reply) => (reply.error ? fail(new Error(`${method}: ${reply.error.message}`)) : done(reply.result)));
    socket.send(JSON.stringify({ id, method, params }));
  });
}

try {
  const send = await connect(await devtoolsPort());
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  // O popup monta a grade depois de ler o storage; em máquina lenta isso passa de 800 ms.
  const clickByText = (selector, text) => evaluate(`(async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find((element) => element.textContent === ${JSON.stringify(text)} || element.getAttribute('aria-label') === ${JSON.stringify(text)});
      if (button) { button.click(); return button.dataset.style; }
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error('Não achei ' + ${JSON.stringify(text)} + ' em ${selector}');
  })()`);

  await send('Emulation.setDeviceMetricsOverride', { width: 380, height: 520, deviceScaleFactor: 2, mobile: false });
  await sleep(800);
  if (options.style) {
    const selectedStyle = await clickByText('#presets button', options.style);
    await evaluate(`(async () => {
      for (let attempt = 0; attempt < 50; attempt++) {
        if (document.querySelector('#stage')?.dataset.style === ${JSON.stringify(selectedStyle)}) return;
        await new Promise((done) => setTimeout(done, 100));
      }
      throw new Error('O estilo não foi selecionado');
    })()`);
  }
  if (options.variant) await clickByText('#variants button', options.variant);
  const viewButtons = { custom: '#presets [data-style="custom"]', about: '#about-btn', support: '#support-btn' };
  if (options.view) {
    if (!viewButtons[options.view]) throw new Error(`Painel desconhecido: ${options.view} (use custom, about ou support).`);
    await evaluate(`(async () => {
      for (let attempt = 0; attempt < 50; attempt++) {
        const btn = document.querySelector(${JSON.stringify(viewButtons[options.view])});
        if (btn) { btn.click(); return; }
        await new Promise((done) => setTimeout(done, 100));
      }
      throw new Error('Botão do painel não encontrado: ' + ${JSON.stringify(viewButtons[options.view])});
    })()`);
  }
  // Sem áudio de verdade no Chrome de teste, simula as 16 bandas para ver o visualizador em movimento.
  if (options['demo-audio']) await evaluate(`(() => {
    stage.setActive(true);
    document.querySelector('#stage')?.classList.remove('inactive');
    document.querySelector('#orb')?.classList.add('active');
    document.querySelector('#orb-icon').src = 'icons/icon.svg';
    setInterval(() => {
      stage.setActive(true);
      document.querySelector('#stage')?.classList.remove('inactive');
      document.querySelector('#orb')?.classList.add('active');
      const orbIcon = document.querySelector('#orb-icon');
      if (orbIcon && !orbIcon.src.endsWith('/icons/icon.svg')) orbIcon.src = 'icons/icon.svg';
      const time = performance.now() / 1000;
      const bands = Array.from({ length: 16 }, (_, index) => 0.15 + 0.55 * Math.max(0, Math.sin(time * 4 + index * 0.7)));
      stage.setLevel(bands[1], bands);
    }, 20);
  })()`);
  // Sem música no Chrome de teste, o palco mostra "aba ativa"; --track simula a faixa de um player.
  if (options.track) {
    const [track, artist = ''] = options.track.split(' • ');
    await evaluate(`activeTab = { id: 1, title: '', url: 'https://music.youtube.com/' };
      targetTab = 1;
      activeTabStatus = { track: ${JSON.stringify(track)}, artist: ${JSON.stringify(artist)}, playing: true };
      render();`);
    await sleep(200);
  }
  if (options.scroll) {
    await evaluate(`(() => {
      const panel = document.querySelector('#panel-custom') || document.querySelector('.panel-side');
      if (panel) panel.scrollTop = ${Number(options.scroll)};
    })()`);
    await sleep(200);
  }
  await sleep(Number(options.wait));
  if (options.layout) {
    console.log(JSON.stringify(await evaluate(`(() => {
      const page = document.scrollingElement;
      return {
        pageScroll: { x: page.scrollWidth > page.clientWidth, y: page.scrollHeight > page.clientHeight },
        marquee: [...document.querySelectorAll('.preset-label.marquee')].map((label) => label.textContent),
        panelScroll: [...document.querySelectorAll('.panel-side')].filter((panel) => !panel.inert && panel.scrollHeight > panel.clientHeight + 1).map((panel) => panel.id),
        buttons: [...new Set([...document.querySelectorAll('.preset-btn')].map((button) => button.offsetWidth + 'x' + button.offsetHeight))],
      };
    })()`)));
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(options.out, Buffer.from(data, 'base64'));
  console.log(options.out);
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(workDir, { recursive: true, force: true });
}
