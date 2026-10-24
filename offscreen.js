// Recebe o áudio capturado de uma aba e o devolve aos alto-falantes passando pelo motor. Enquanto a
// aba está capturada, o Chrome não toca o som dela diretamente: só sai o que passa por aqui.
// A velocidade continua sendo aplicada no elemento da página, antes da captura.
const { createEngine } = globalThis.auracoreEngine;
const captures = new Map();

function stop(tabId) {
  const capture = captures.get(tabId);
  if (!capture) return;
  capture.stream.getTracks().forEach((track) => track.stop());
  capture.context.close();
  captures.delete(tabId);
}

async function start({ streamId, tabId, style }) {
  stop(tabId);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
  });
  let context;
  try {
    context = new AudioContext();
    const engine = createEngine(context, async (kind) => {
      const file = { rain: 'rain.webm', water: 'underwater.webm' }[kind];
      const response = await fetch(chrome.runtime.getURL(`audio/${file}`));
      if (!response.ok) throw new Error(`Áudio ambiente: HTTP ${response.status}`);
      return response.arrayBuffer();
    });
    context.createMediaStreamSource(stream).connect(engine.input);
    engine.set(style);
    if (context.state !== 'running') await context.resume();
    if (context.state !== 'running') throw new Error('O contexto de áudio não iniciou.');
    // O usuário pode encerrar a captura pelo indicador do próprio Chrome.
    stream.getAudioTracks()[0].addEventListener('ended', () => {
      if (captures.get(tabId)?.stream !== stream) return;
      stop(tabId);
      chrome.runtime.sendMessage({ target: 'background', type: 'capture-ended', tabId })
        .then((response) => { if (response?.error) console.error('Falha ao encerrar captura:', response.error); })
        .catch((error) => console.error('Falha ao encerrar captura:', error));
    });
    captures.set(tabId, { stream, context, engine, frames: new Map() });
    return { state: context.state };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    if (context) await context.close();
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;
  switch (message.type) {
    case 'start':
      start(message).then(sendResponse, (error) => sendResponse({ error: error.message }));
      return true;
    case 'stop':
      stop(message.tabId);
      sendResponse(true);
      return;
    case 'style':
      captures.forEach(({ engine }) => engine.set(message.style));
      return;
    case 'playback': {
      const capture = captures.get(message.tabId);
      if (capture) {
        capture.frames.set(message.frameId, message.playing);
        capture.engine.setPlaying([...capture.frames.values()].some(Boolean));
      }
      sendResponse(Boolean(capture));
      return;
    }
    case 'list':
      sendResponse([...captures.keys()]);
      return;
    case 'level': {
      const capture = captures.get(message.tabId);
      sendResponse(capture ? (capture.engine.audioLevels ? capture.engine.audioLevels() : capture.engine.bassLevel()) : null);
      return;
    }
  }
});
