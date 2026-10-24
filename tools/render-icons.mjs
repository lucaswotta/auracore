import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

const chromeBin = process.env.CHROME_BIN ?? join(homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome');
const workDir = mkdtempSync(join(tmpdir(), 'render-icons-'));

const chrome = spawn(chromeBin, [
  '--headless=new',
  '--no-sandbox',
  '--remote-debugging-port=0',
  `--user-data-dir=${join(workDir, 'profile')}`,
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let wsUrl = '';
const stderrLines = [];

chrome.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  stderrLines.push(text);
  const match = text.match(/ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-zA-Z0-9-]+/);
  if (match) wsUrl = match[0];
});

async function main() {
  for (let i = 0; i < 40; i++) {
    if (wsUrl) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!wsUrl) throw new Error('Falha ao obter URL de depuração do Chrome:\n' + stderrLines.join(''));

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve) => ws.onopen = resolve);

  let idCounter = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = idCounter++;
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        ws.removeEventListener('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

  const sendSession = (method, params = {}) => new Promise((resolve, reject) => {
    const id = idCounter++;
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        ws.removeEventListener('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  await sendSession('Page.enable');

  const iconsDir = join(process.cwd(), 'icons');
  const iconSvg = readFileSync(join(iconsDir, 'icon.svg'), 'utf8');
  const iconOffSvg = readFileSync(join(iconsDir, 'icon-off.svg'), 'utf8');

  async function renderSvgToPng(svgString, size) {
    const b64Svg = Buffer.from(svgString).toString('base64');
    const dataUri = `data:image/svg+xml;base64,${b64Svg}`;

    const expression = `
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = ${size};
          canvas.height = ${size};
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, ${size}, ${size});
          resolve(canvas.toDataURL('image/png').split(',')[1]);
        };
        img.src = '${dataUri}';
      })
    `;

    const evalResult = await sendSession('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return Buffer.from(evalResult.result.value, 'base64');
  }

  const sizes = [16, 32, 48, 128];
  for (const size of sizes) {
    const activePng = await renderSvgToPng(iconSvg, size);
    writeFileSync(join(iconsDir, `icon${size}.png`), activePng);
    console.log(`Renderizado: icon${size}.png`);

    const offPng = await renderSvgToPng(iconOffSvg, size);
    writeFileSync(join(iconsDir, `icon-off${size}.png`), offPng);
    console.log(`Renderizado: icon-off${size}.png`);
  }

  ws.close();
  chrome.kill();
  try { rmSync(workDir, { recursive: true, force: true }); } catch {}
}

main().catch((err) => {
  console.error(err);
  chrome.kill();
  try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
