const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createI18n, loadStyles, runScript } = require('./helpers');

const { PRESETS } = loadStyles();

class Element {
  constructor() {
    this.children = [];
    this.listeners = new Map();
    this.style = { properties: {}, setProperty(name, value) { this.properties[name] = value; } };
    this.classList = {
      classes: new Set(),
      toggle(name, value) {
        if (value === undefined) {
          if (this.classes.has(name)) this.classes.delete(name);
          else this.classes.add(name);
        } else if (value) this.classes.add(name);
        else this.classes.delete(name);
      },
      add(name) { this.classes.add(name); },
      remove(name) { this.classes.delete(name); },
      contains(name) { return this.classes.has(name); },
    };
    this.dataset = {};
    this.value = '';
    this.hidden = false;
  }
  // Como no DOM, o texto de um elemento inclui o dos filhos.
  get textContent() { return this.text ?? this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this.text = value; this.children = []; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  click() { this.listeners.get('click')?.({ stopPropagation() {}, preventDefault() {} }); }
  dispatch(type, fields = {}) { this.listeners.get(type)?.({ button: 0, pointerId: 1, clientX: 100, preventDefault() {}, ...fields }); }
  getBoundingClientRect() { return { left: 0, width: 200 }; }
  setPointerCapture() {}
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
}

function createPopupHarness(initial = {}, { effects = 'ok', failCapture = false, updateUrl, target = 4, withoutScripts = false, tabUrl = 'https://www.youtube.com/watch?v=abc123xyz', tabTitle = 'Música de Teste', trackTitle = 'Música Tocando', uiLanguage = 'pt-BR', metadata = {}, tabCapture = true } = {}) {
  const elements = new Map();
  // Elementos do popup.html com data-i18n*, para a tradução da página ter onde escrever.
  const translatable = [...readFileSync(join(__dirname, '..', 'popup.html'), 'utf8').matchAll(/<[a-z0-9]+\b[^>]*data-i18n[^>]*>/g)].map(([tag]) => {
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const element = id ? (elements.get(id) ?? new Element()) : new Element();
    if (id) elements.set(id, element);
    for (const [, name, value] of tag.matchAll(/data-(i18n[a-z-]*)="([^"]+)"/g)) {
      element.dataset[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
    return element;
  });
  const document = {
    body: new Element(), documentElement: new Element(),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    querySelectorAll(selector) { return selector.includes('data-i18n') ? translatable : []; },
    createElement() { return new Element(); },
  };
  const writes = [];
  const createdTabs = [];
  const copied = [];
  const sent = [];
  const streamRequests = [];
  const injections = [];
  let injected = !withoutScripts;
  const storage = { ...initial };
  let playing = true;
  const tabUpdatedListeners = [];
  const tabActivatedListeners = [];
  const runtimeMessageListeners = [];
  const chrome = {
    i18n: createI18n(uiLanguage),
    storage: { local: {
      get(defaults, callback) { callback({ ...defaults, ...storage }); },
      set(changes) { Object.assign(storage, changes); writes.push({ ...changes }); },
    } },
    tabs: {
      async query() { return [{ id: 4, title: tabTitle, url: tabUrl }]; },
      async sendMessage(tabId, message) {
        if (!injected) throw new Error('Receiving end does not exist.');
        if (message?.type === 'toggle-playback') playing = !playing;
        return { playing, effects, title: trackTitle, url: tabUrl, time: 30, ...metadata };
      },
      connect() { return { onMessage: { addListener() {} }, disconnect() {} }; },
      create(options) { createdTabs.push(options); },
      onUpdated: { addListener(fn) { tabUpdatedListeners.push(fn); } },
      onActivated: { addListener(fn) { tabActivatedListeners.push(fn); } },
    },
    runtime: {
      id: 'loja123',
      onMessage: { addListener(fn) { runtimeMessageListeners.push(fn); } },
      getManifest() {
        return {
          version: '9.9.9',
          content_scripts: [{ js: ['engine.js', 'page.js'], world: 'MAIN' }, { js: ['styles.js', 'content.js'] }],
          ...(updateUrl ? { update_url: updateUrl } : {}),
        };
      },
      async sendMessage(message) {
        sent.push(message);
        if (message.type === 'capture-list') return [];
        if (message.type === 'get-target') return target;
        if (message.type === 'set-target') return true;
        if (message.type === 'capture-start') return failCapture ? { error: 'aba sem áudio' } : true;
        return null;
      },
    },
    scripting: {
      async executeScript(options) { injections.push(options); injected = true; },
    },
    tabCapture: tabCapture ? {
      async getMediaStreamId({ targetTabId }) { streamRequests.push(targetTabId); return `stream-${targetTabId}`; },
    } : undefined,
  };
  const navigator = {
    clipboard: {
      async writeText(value) { copied.push(value); },
    },
  };
  const context = vm.createContext({
    document, chrome, navigator, URL, URLSearchParams, setTimeout, clearTimeout,
  });
  runScript(context, 'styles.js');
  runScript(context, 'popup.js');
  return {
    context, document, elements, translatable, writes, createdTabs, copied, storage, sent, streamRequests, injections,
    get: (id) => document.getElementById(id),
    dispatchTabUpdated: (tabId, changeInfo, tab) => {
      for (const fn of tabUpdatedListeners) fn(tabId, changeInfo, tab);
    },
    dispatchRuntimeMessage: (message, sender) => {
      for (const fn of runtimeMessageListeners) fn(message, sender);
    },
  };
}

test('bandas ativas mantêm a cena em reprodução sem grave', () => {
  const popup = createPopupHarness();
  const update = vm.runInContext('pulse()', popup.context);
  update({ level: 0, bands: [0, 0, 0, 0, 0.3, ...Array(11).fill(0)] });
  assert.equal(popup.get('stage').classList.contains('playing'), true);
  update({ level: null, bands: null });
  assert.equal(popup.get('stage').classList.contains('playing'), false);
});

test('estilo salvo usa a arte personalizada', async () => {
  const popup = createPopupHarness({ styleId: 'custom-7', customStyles: [{ id: 'custom-7', name: 'Meu som' }] });
  await flush();
  assert.equal(popup.get('character-art').src, 'artwork/custom.webp');
  assert.equal(popup.get('stage').dataset.style, 'custom');
});

const flush = () => new Promise(setImmediate);

test('grade do popup renderiza 16 botões (15 estilos + personalizado)', async () => {
  const popup = createPopupHarness();
  await flush();
  const buttons = popup.get('presets').children;
  assert.equal(buttons.length, 16);
  assert.equal(buttons[15].textContent, 'personalizado');
  assert.equal(buttons[15].dataset.style, 'custom');
});

test('selecionar um preset no popup grava a receita e ativa a extensão', async () => {
  const popup = createPopupHarness();
  await flush();
  const buttons = popup.get('presets').children;
  buttons.find((btn) => btn.textContent === 'lo-fi').click();
  assert.equal(popup.writes.at(-1).styleId, 'lofi');
  assert.equal(popup.writes.at(-1).enabled, true);
  assert.equal(popup.writes.at(-1).style.speed, 0.9);

  const labels = popup.get('variants').children[0].children[1].children;
  assert.deepEqual(labels.map((btn) => btn.textContent), ['-1', '0', '1']);
  assert.deepEqual(labels.map((btn) => btn['aria-label']), ['suave', 'padrão', 'intenso']);
  labels.find((btn) => btn.textContent === '1').click();
  assert.equal(popup.writes.at(-1).style.speed, 0.86);
  assert.equal(popup.writes.at(-1).variantChoices.lofi, 'strong');
});

test('fader volta ao encaixe anterior se solto até metade do caminho', async () => {
  const popup = createPopupHarness();
  await flush();
  popup.get('presets').children.find((btn) => btn.textContent === 'lo-fi').click();
  const fader = popup.get('variants').children[0].children[0];
  const writes = popup.writes.length;
  fader.dispatch('pointerdown');
  fader.dispatch('pointermove', { clientX: 150 });
  fader.dispatch('pointerup', { clientX: 150 });
  assert.equal(popup.writes.length, writes);
  assert.equal(fader.style.properties['--fader-position'], '50%');
  assert.equal(fader['aria-valuetext'], 'padrão');

  fader.dispatch('pointerdown');
  fader.dispatch('pointermove', { clientX: 170 });
  fader.dispatch('pointerup', { clientX: 170 });
  assert.equal(popup.writes.at(-1).variantChoices.lofi, 'strong');
  assert.equal(fader.style.properties['--fader-position'], '100%');

  const changed = popup.writes.length;
  fader.dispatch('pointerdown', { clientX: 200 });
  fader.dispatch('pointermove', { clientX: 150 });
  fader.dispatch('pointerup', { clientX: 150 });
  assert.equal(popup.writes.length, changed);
  assert.equal(fader.style.properties['--fader-position'], '100%');
});

test('fader aceita teclado e usa símbolos para os trajetos 8D', async () => {
  const popup = createPopupHarness();
  await flush();
  popup.get('presets').children.find((btn) => btn.textContent === 'lo-fi').click();
  const fader = popup.get('variants').children[0].children[0];
  assert.equal(popup.get('variant-label').textContent, '');
  assert.equal(fader['aria-label'], 'Intensidade');
  fader.dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(popup.writes.at(-1).variantChoices.lofi, 'soft');
  assert.equal(fader['aria-valuetext'], 'suave');

  popup.get('presets').children.find((btn) => btn.textContent === '8D').click();
  assert.equal(popup.get('variant-label').textContent, 'trajeto');
  const orbitLabels = popup.get('variants').children[0].children[1].children;
  assert.deepEqual(orbitLabels.map((btn) => btn.textContent), ['◯', '✳', '∞']);
  assert.equal(popup.get('variants').children[0].children[0]['aria-label'], 'Trajeto 8D');
  assert.equal(popup.get('variants').children[0].children[0].dataset.index, '1');
  assert.equal(popup.writes.at(-1).style.orbit, 2);
  orbitLabels.find((btn) => btn['aria-label'] === 'oito').click();
  assert.equal(popup.writes.at(-1).variantChoices['8d'], 'eight');
});

test('todos os 15 presets do popup podem ser selecionados', async () => {
  const popup = createPopupHarness();
  await flush();
  const buttons = popup.get('presets').children;
  for (const preset of PRESETS) {
    const btn = buttons.find((b) => b.textContent === preset.name);
    assert.ok(btn, `botão ${preset.name} existe`);
    btn.click();
    assert.equal(popup.writes.at(-1).styleId, preset.id);
    assert.equal(popup.writes.at(-1).enabled, true);
  }
});

test('cada botão de estilo tem a tipografia do seu estilo no popup.css', async () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'popup.css'), 'utf8');
  const popup = createPopupHarness();
  await flush();
  for (const preset of PRESETS) {
    const button = popup.get('presets').children.find((b) => b.textContent === preset.name);
    assert.equal(button.dataset.style, preset.id);
    assert.ok(css.includes(`.preset-btn[data-style="${preset.id}"]`), `falta tipografia para ${preset.id}`);
  }
});

test('toda fonte declarada no popup.css existe e vem com a licença', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const css = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');
  const files = [...css.matchAll(/url\('(fonts\/[^']+\.woff2)'\)/g)].map(([, file]) => file);
  assert.ok(files.length >= 14);
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} existe`);
    const license = path.join(root, 'fonts', 'licenses', `${path.basename(file, '.woff2')}-OFL.txt`);
    assert.ok(fs.existsSync(license), `licença de ${file}`);
  }
});

test('personalizado tira a grade de cena e abre os parâmetros; voltar devolve a grade', async () => {
  const popup = createPopupHarness();
  await flush();
  assert.equal(popup.get('popup-main').dataset.view, 'styles');
  assert.equal(popup.get('panel-custom').inert, true);

  popup.get('presets').children.find((b) => b.textContent === 'personalizado').click();
  assert.equal(popup.get('popup-main').dataset.view, 'custom');
  assert.equal(popup.get('panel-custom').inert, false);
  assert.equal(popup.get('panel-styles').inert, true);

  popup.get('custom-back').click();
  assert.equal(popup.get('popup-main').dataset.view, 'styles');
  assert.equal(popup.get('panel-styles').inert, false);
});

test('mexer num parâmetro parte do estilo atual e vira personalizado', async () => {
  const popup = createPopupHarness({ enabled: false, styleId: 'slowed', style: PRESETS[0].style });
  await flush();
  const reverb = popup.get('controls').children.find((row) => row.children[0].textContent === 'reverb');
  const input = reverb.children[2];
  input.value = '70';
  input.listeners.get('input')();
  const write = popup.writes.at(-1);
  assert.equal(write.styleId, 'custom');
  assert.equal(write.enabled, true);
  assert.equal(write.style.reverb, 70);
  assert.equal(write.style.speed, PRESETS[0].style.speed, 'mantém o resto do slowed');
  assert.equal(reverb.children[1].textContent, '70%');
  const customButton = popup.get('presets').children.find((b) => b.textContent === 'personalizado');
  assert.ok(customButton.className.includes('active'));
});

test('controles de personalizado usam knobs rotativos e faders de DJ com suporte a teclado e reset', async () => {
  const popup = createPopupHarness({ enabled: false, styleId: 'slowed', style: PRESETS[0].style });
  await flush();
  const speedRow = popup.get('controls').children.find((row) => row.children[0].textContent === 'velocidade');
  assert.equal(speedRow.className, 'control control-fader');
  const speedWidget = speedRow.children[3];
  assert.equal(speedWidget.className, 'dj-fader-wrap');

  const bassRow = popup.get('controls').children.find((row) => row.children[0].textContent === 'graves');
  assert.equal(bassRow.className, 'control control-knob');
  const bassWidget = bassRow.children[3];
  assert.equal(bassWidget.className, 'dj-knob-wrap');

  bassWidget.listeners.get('keydown')({ key: 'ArrowUp', preventDefault() {} });
  assert.equal(popup.writes.at(-1).style.bass, 1);

  bassWidget.listeners.get('dblclick')();
  assert.equal(popup.writes.at(-1).style.bass, 0);
});

test('salvar cria estilo próprio, que pode ser escolhido e apagado', async () => {
  const popup = createPopupHarness({ enabled: true, styleId: 'custom', style: { ...PRESETS[0].style, reverb: 70 } });
  await flush();
  popup.get('style-name').value = '  meu quarto  ';
  popup.get('save-form').listeners.get('submit')({ preventDefault() {} });
  const saved = popup.storage.customStyles;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'meu quarto');
  assert.equal(saved[0].style.reverb, 70);
  assert.equal(popup.storage.styleId, saved[0].id);
  assert.equal(popup.get('mine-area').hidden, false);

  const chip = popup.get('mine').children[0];
  chip.children[0].listeners.get('click')({ stopPropagation() {} });
  assert.equal(popup.storage.customStyles.length, 0);
  assert.equal(popup.storage.styleId, 'custom');
  assert.equal(popup.get('mine-area').hidden, true);
});

test('nome vazio não salva estilo', async () => {
  const popup = createPopupHarness();
  await flush();
  popup.get('style-name').value = '   ';
  popup.get('save-form').listeners.get('submit')({ preventDefault() {} });
  assert.equal(popup.storage.customStyles, undefined);
});

test('efeitos e trajeto do 8D gravam no storage', async () => {
  const popup = createPopupHarness();
  await flush();
  popup.get('tape-stop').checked = true;
  popup.get('tape-stop').listeners.get('change')();
  assert.equal(popup.storage.tapeStop, true);

  popup.get('fade').children.find((b) => b.textContent === '6 s').click();
  assert.equal(popup.storage.fade, 6);

  popup.get('orbit').children.find((b) => b.textContent === 'oito').click();
  assert.equal(popup.storage.style.orbit, 1);
  assert.ok(popup.storage.style.spin > 0);
  popup.get('orbit').children.find((b) => b.textContent === 'desligado').click();
  assert.equal(popup.storage.style.spin, 0);
});

test('fade de 6 segundos e tape stop aparecem ativados por padrão', async () => {
  const popup = createPopupHarness();
  await flush();
  assert.equal(popup.get('tape-stop').checked, true);
  assert.match(popup.get('fade').children.find((b) => b.textContent === '6 s').className, /active/);
});

test('sobre abre pelo cabeçalho e mostra a versão', async () => {
  const popup = createPopupHarness();
  await flush();
  popup.get('about-btn').click();
  assert.equal(popup.get('popup-main').dataset.view, 'about');
  assert.equal(popup.get('stage')['aria-label'], 'auracore');
  assert.equal(popup.get('about-version').textContent, 'versão 9.9.9');
  popup.get('about-back').click();
  assert.equal(popup.get('popup-main').dataset.view, 'styles');
  assert.equal(popup.get('stage')['aria-label'], 'Cena do estilo atual');
});

test('painéis mostram arte própria e restauram o estilo selecionado', async () => {
  const popup = createPopupHarness({ styleId: 'slowed' });
  await flush();
  const art = popup.get('character-art');
  assert.equal(art.src, 'artwork/slowed.webp');
  art.onload();

  popup.get('presets').children.find((button) => button.textContent === 'personalizado').click();
  assert.equal(art.src, 'artwork/custom.webp');
  assert.equal(popup.get('stage').dataset.view, 'custom');
  assert.equal(popup.storage.styleId, 'slowed');

  popup.get('custom-back').click();
  assert.equal(art.src, 'artwork/slowed.webp');
  art.onload();
  popup.get('about-btn').click();
  assert.equal(popup.get('stage').dataset.view, 'about');
  assert.equal(art.hidden, true);
  assert.equal(popup.storage.styleId, 'slowed');

  popup.get('about-back').click();
  assert.equal(art.src, 'artwork/slowed.webp');
  assert.equal(art.hidden, false);
});

test('em site com áudio protegido, ligar captura a aba e desligar encerra a captura', async () => {
  const popup = createPopupHarness({ enabled: false }, { effects: 'blocked' });
  await flush();
  popup.get('presets').children.find((b) => b.textContent === 'lo-fi').click();
  await flush();
  assert.deepEqual(popup.streamRequests, [4]);
  assert.deepEqual(popup.sent.filter((m) => m.type === 'capture-start').map((m) => [m.streamId, m.tabId]), [['stream-4', 4]]);

  popup.get('presets').children.find((b) => b.textContent === 'phonk').click();
  await flush();
  assert.equal(popup.streamRequests.length, 1, 'troca de estilo reaproveita a captura');

  popup.get('orb').click();
  await flush();
  assert.deepEqual(popup.sent.filter((m) => m.type === 'capture-stop').map((m) => m.tabId), [4]);
});

test('em site sem proteção, ligar não captura a aba', async () => {
  const popup = createPopupHarness({ enabled: false });
  await flush();
  popup.get('orb').click();
  await flush();
  assert.deepEqual(popup.streamRequests, []);
});

test('falha na captura avisa no popup', async () => {
  const popup = createPopupHarness({ enabled: false }, { effects: 'blocked', failCapture: true });
  await flush();
  popup.get('orb').click();
  await flush();
  assert.match(popup.get('share-toast').textContent, /aba sem áudio/);
});

test('compartilhar copia o convite com a página da loja de onde a extensão veio', async () => {
  const chrome = createPopupHarness({}, { updateUrl: 'https://clients2.google.com/service/update2/crx' });
  await flush();
  chrome.get('share-btn').click();
  await flush();
  assert.match(chrome.copied[0], /https:\/\/chromewebstore\.google\.com\/detail\/loja123$/);
  assert.equal(chrome.get('share-toast').textContent, 'Convite copiado!');

  const edge = createPopupHarness({}, { updateUrl: 'https://edge.microsoft.com/extensionwebstorebase/v1/crx' });
  await flush();
  edge.get('share-btn').click();
  await flush();
  assert.match(edge.copied[0], /https:\/\/microsoftedge\.microsoft\.com\/addons\/detail\/loja123$/);
});

test('sem loja (carregada sem compactação), o convite aponta o repositório', async () => {
  const popup = createPopupHarness();
  await flush();
  popup.get('share-btn').click();
  await flush();
  assert.match(popup.copied[0], /https:\/\/github\.com\/lucaswotta\/auracore$/);
});

test('estrela abre o repositório e coração abre o painel de apoio', async () => {
  const popup = createPopupHarness();
  await flush();
  popup.get('github-btn').click();
  assert.equal(popup.createdTabs.at(-1).url, 'https://github.com/lucaswotta/auracore');
  popup.get('support-btn').click();
  assert.equal(popup.get('popup-main').dataset.view, 'support');
  assert.equal(popup.get('stage')['aria-label'], 'auracore');
  assert.equal(popup.get('character-art').hidden, true);
  popup.get('sponsors-open').click();
  assert.equal(popup.createdTabs.at(-1).url, 'https://github.com/sponsors/lucaswotta');
  popup.get('support-back').click();
  assert.equal(popup.get('popup-main').dataset.view, 'styles');
});

test('Chrome em português do Brasil mostra o Pix e copia o código', async () => {
  const popup = createPopupHarness();
  await flush();
  assert.equal(popup.get('pix-copy').hidden, false);
  assert.equal(popup.get('pix-copy').textContent, 'copiar Pix');
  assert.equal(popup.get('support-qr').src, 'support/pix-qr.svg');
  popup.get('pix-copy').click();
  await flush();
  assert.match(popup.copied.at(-1), /^000201.*br\.gov\.bcb\.pix.*6304[0-9A-F]{4}$/);
  assert.equal(popup.get('share-toast').textContent, 'Código Pix copiado!');
});

test('outros idiomas mostram só o GitHub Sponsors', async () => {
  for (const uiLanguage of ['en-US', 'es', 'pt-PT']) {
    const popup = createPopupHarness({}, { uiLanguage });
    await flush();
    assert.equal(popup.get('pix-copy').hidden, true, uiLanguage);
    assert.equal(popup.get('support-qr').src, 'support/sponsors-qr.svg', uiLanguage);
  }
});

test('botão de liga/desliga no popup alterna enabled no storage', async () => {
  const popup = createPopupHarness({ enabled: false });
  await flush();
  assert.equal(popup.get('orb-icon').src, 'icons/icon-off.svg');
  popup.get('orb').click();
  assert.equal(popup.writes.at(-1).enabled, true);
  assert.equal(popup.get('orb-icon').src, 'icons/icon.svg');
  popup.get('orb').click();
  assert.equal(popup.writes.at(-1).enabled, false);
});

test('título da faixa aparece acima do serviço sem repetir Spotify', async () => {
  const popup = createPopupHarness({}, {
    tabUrl: 'https://open.spotify.com/track/123',
    tabTitle: 'Sorry - Justin Bieber - Spotify',
    trackTitle: 'Sorry - Justin Bieber - Spotify',
  });
  await flush();
  assert.equal(popup.get('target-label').textContent, 'Sorry - Justin Bieber');
  assert.equal(popup.get('track-subtitle').textContent, 'Spotify');
});

test('troca de faixa atualiza o palco imediatamente sem manter música antiga', async () => {
  const popup = createPopupHarness({}, {
    tabUrl: 'https://open.spotify.com/playlist/123',
    tabTitle: 'What Do You Mean? - Justin Bieber - Spotify',
    trackTitle: 'What Do You Mean? - Justin Bieber - Spotify',
  });
  await flush();
  assert.equal(popup.get('target-label').textContent, 'What Do You Mean? - Justin Bieber');

  // A música passa para outra faixa no Spotify (atualização da aba)
  popup.dispatchTabUpdated(4, { title: 'Heat Waves - Glass Animals - Spotify' });
  assert.equal(popup.get('target-label').textContent, 'Heat Waves - Glass Animals');
  assert.equal(popup.get('track-subtitle').textContent, 'Spotify');

  // Notificação via content script observando mutação no SPA
  popup.dispatchRuntimeMessage({
    type: 'auracore:title-changed',
    title: 'Let Me Love You • DJ Snake, Justin Bieber',
  });
  assert.equal(popup.get('target-label').textContent, 'Let Me Love You • DJ Snake, Justin Bieber');
});

test('título e origem longos correm em loop, cada um na sua medida', async () => {
  const popup = createPopupHarness({}, { trackTitle: 'Uma música com um título longo para testar a leitura completa' });
  popup.get('track-viewport').clientWidth = 140;
  popup.get('source-viewport').clientWidth = 140;
  popup.get('target-label').scrollWidth = 320;
  popup.get('track-subtitle').scrollWidth = 200;
  await flush();
  assert.ok(popup.get('target-label').classList.classes.has('marquee'));
  // Loop contínuo: anda o texto mais o respiro de 48 px até a cópia ocupar o lugar dele, a 32 px/s.
  assert.equal(popup.get('target-label').style.properties['--marquee-distance'], '-368px');
  assert.equal(popup.get('target-label').style.properties['--marquee-duration'], '11.50s');
  assert.equal(popup.get('target-label').dataset.loop, popup.get('target-label').textContent);
  assert.ok(popup.get('track-subtitle').classList.classes.has('marquee'));
  assert.equal(popup.get('track-subtitle').style.properties['--marquee-distance'], '-248px');
});

test('título percorre a janela quando alcança a personagem', async () => {
  const popup = createPopupHarness({}, { trackTitle: 'Título que entra na área da personagem' });
  const viewport = popup.get('track-viewport');
  const title = popup.get('target-label');
  const character = popup.get('character-art');
  viewport.clientWidth = 320;
  viewport.getBoundingClientRect = () => ({ left: 16, width: 320 });
  title.scrollWidth = 180;
  character.hidden = false;
  character.getBoundingClientRect = () => ({ left: 150, width: 180 });
  await flush();
  assert.ok(title.classList.classes.has('marquee'));
  // Cabe na largura do palco, mas não nos 122 px antes da arte (150 - 16 - 12): corre por trás dela.
  assert.equal(title.style.properties['--marquee-distance'], '-228px');
});

test('renderiza arte do personagem ao selecionar estilo', async () => {
  const popup = createPopupHarness();
  await flush();
  assert.equal(popup.get('character-art').src, 'artwork/slowed.webp');

  const buttons = popup.get('presets').children;
  buttons.find((btn) => btn.textContent === 'phonk').click();
  assert.equal(popup.get('character-art').src, 'artwork/phonk.webp');
});

test('clicar no preset ativo desativa a extensão', async () => {
  const popup = createPopupHarness({ enabled: true, styleId: 'slowed' });
  await flush();
  const buttons = popup.get('presets').children;
  const slowedBtn = buttons.find((btn) => btn.textContent === 'slowed + reverb');
  slowedBtn.click();
  assert.equal(popup.writes.at(-1).enabled, false);
});

test('ligado em outra aba, o popup mostra desligado aqui e não mexe na aba alvo', async () => {
  const popup = createPopupHarness({ enabled: true, styleId: 'lofi' }, { target: 9 });
  await flush();
  assert.equal(popup.get('orb')['aria-pressed'], 'false');
  assert.equal(popup.get('track-subtitle').textContent, 'YouTube · ativo em outra aba');
  const lofi = popup.get('presets').children.find((b) => b.textContent === 'lo-fi');
  assert.equal(lofi.className.includes('active'), false);
});

test('ligar numa aba nova move o alvo para ela antes de gravar o estilo', async () => {
  const popup = createPopupHarness({ enabled: true, styleId: 'lofi' }, { target: 9 });
  await flush();
  const writesBefore = popup.writes.length;
  popup.get('presets').children.find((b) => b.textContent === 'lo-fi').click();
  assert.equal(popup.writes.length, writesBefore, 'storage espera o alvo mudar');
  await flush();
  assert.deepEqual(popup.sent.filter((m) => m.type === 'set-target').map((m) => m.tabId), [4]);
  assert.equal(popup.writes.at(-1).enabled, true);
  assert.equal(popup.get('orb')['aria-pressed'], 'true');
});

test('aba aberta antes da extensão recebe os content scripts ao abrir o popup', async () => {
  const popup = createPopupHarness({}, { withoutScripts: true });
  await flush();
  assert.deepEqual(popup.injections.map(({ files, world }) => [files.join(), world]), [['engine.js,page.js', 'MAIN'], ['styles.js,content.js', 'ISOLATED']]);
  assert.equal(popup.injections[0].target.allFrames, true);
});

test('aba que já tem os content scripts não recebe injeção', async () => {
  const popup = createPopupHarness();
  await flush();
  assert.equal(popup.injections.length, 0);
});

test('popup segue o idioma do Chrome em textos fixos e gerados', async () => {
  const cases = {
    'en-US': { custom: 'custom', bathroom: 'bathroom at a party', about: 'about', version: 'version 9.9.9', lang: 'en-US' },
    'es-419': { custom: 'personalizado', bathroom: 'baño de la fiesta', about: 'acerca de', version: 'versión 9.9.9', lang: 'es-419' },
    'pt-BR': { custom: 'personalizado', bathroom: 'banheiro da balada', about: 'sobre', version: 'versão 9.9.9', lang: 'pt-BR' },
  };
  for (const [uiLanguage, expected] of Object.entries(cases)) {
    const popup = createPopupHarness({}, { uiLanguage });
    await flush();
    const names = popup.get('presets').children.map((button) => button.textContent);
    assert.ok(names.includes(expected.bathroom), uiLanguage);
    assert.equal(names.at(-1), expected.custom, uiLanguage);
    assert.equal(popup.get('about-title').textContent, expected.about, uiLanguage);
    assert.equal(popup.get('about-version').textContent, expected.version, uiLanguage);
    assert.equal(popup.document.documentElement.lang, expected.lang, uiLanguage);
    assert.ok(popup.translatable.every((element) => !element.dataset.i18n || element.textContent), uiLanguage);
    assert.ok(popup.get('share-btn').title, uiLanguage);
  }
});

test('nome que não cabe no botão corre dentro dele sem mudar tamanho nem fonte', () => {
  const popup = createPopupHarness();
  const measure = (scrollWidth, scrollHeight) => {
    const button = new Element();
    Object.assign(button, { clientWidth: 84, clientHeight: 42 });
    const label = new Element();
    Object.assign(label, { parentElement: button, scrollWidth, scrollHeight, textContent: 'nome' });
    return label;
  };
  const fits = measure(70, 24);
  const tooTall = measure(78, 52);
  const tooWide = measure(120, 15);
  popup.context.getComputedStyle = () => ({ paddingLeft: '3px', paddingRight: '3px', paddingTop: '6px', paddingBottom: '6px' });
  popup.document.querySelectorAll = (selector) => (selector === '.preset-label' ? [fits, tooTall, tooWide] : []);
  vm.runInContext('fitPresetLabels()', popup.context);
  assert.equal(fits.classList.contains('marquee'), false);
  assert.equal(tooTall.classList.contains('marquee'), true);
  assert.equal(tooWide.classList.contains('marquee'), true);
  assert.equal(tooWide.style.properties['--marquee-distance'], '-42px');
});

test('palco mostra faixa e artista da Media Session, ou o título da aba sem ela', async () => {
  const withSession = createPopupHarness({}, {
    tabUrl: 'https://music.youtube.com/watch?v=1', trackTitle: "Gettin' Jiggy Wit It - YouTube Music",
    metadata: { track: "Gettin' Jiggy Wit It", artist: 'Will Smith' },
  });
  await flush();
  assert.equal(withSession.get('target-label').textContent, "Gettin' Jiggy Wit It • Will Smith");

  const withoutArtist = createPopupHarness({}, { metadata: { track: 'Faixa sem artista', artist: '' } });
  await flush();
  assert.equal(withoutArtist.get('target-label').textContent, 'Faixa sem artista');

  const withoutSession = createPopupHarness({}, { trackTitle: 'Clima - YouTube' });
  await flush();
  assert.equal(withoutSession.get('target-label').textContent, 'Clima');
});

test('título que cabe antes da personagem fica parado', async () => {
  const popup = createPopupHarness({}, { trackTitle: 'Curto' });
  const viewport = popup.get('track-viewport');
  viewport.clientWidth = 320;
  viewport.getBoundingClientRect = () => ({ left: 16, width: 320 });
  popup.get('target-label').scrollWidth = 100;
  popup.get('character-art').getBoundingClientRect = () => ({ left: 150, width: 180 });
  await flush();
  assert.equal(popup.get('target-label').classList.classes.has('marquee'), false);
});

test('sem captura de aba, site protegido avisa que só velocidade e tom mudam', async () => {
  const popup = createPopupHarness({ enabled: false }, { effects: 'blocked', tabCapture: false });
  await flush();
  popup.get('presets').children.find((button) => button.textContent === 'lo-fi').click();
  await flush();
  await flush();
  assert.equal(popup.streamRequests.length, 0);
  assert.equal(popup.sent.some((message) => message.type === 'capture-start'), false);
  assert.match(popup.get('share-toast').textContent, /só a velocidade e o tom/);
});
