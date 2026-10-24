// Carregado no mundo da página antes do page.js. Tudo fica neste escopo e o page.js recolhe o
// resultado do globalThis, para não deixar nomes soltos no site.
globalThis.auracoreEngine = (() => {
  // Pitch shift por grãos de delay modulado (técnica do "Jungle" de Chris Wilson): só nós nativos,
  // porque AudioWorklet carregado de content script esbarra na CSP de sites como o YouTube.
  const GRAIN = 0.1;
  const FADE = GRAIN / 2;

  function createRampBuffer(context, rising) {
    const length = Math.round(GRAIN * context.sampleRate);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = rising ? i / length : (length - i) / length;
    return buffer;
  }

  // Duas vozes defasadas em meio grão: as curvas em raiz somam potência constante no cruzamento.
  function createFadeBuffer(context) {
    const length = Math.round(GRAIN * context.sampleRate);
    const fadeLength = Math.round(FADE * context.sampleRate);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = i < fadeLength ? Math.sqrt(i / fadeLength) : Math.sqrt(1 - (i - fadeLength) / (length - fadeLength));
    }
    return buffer;
  }

  function createPitchShifter(context) {
    const input = new GainNode(context);
    // As duas vozes carregam o mesmo sinal e somam em amplitude no cruzamento; 0.75 compensa o ganho.
    const output = new GainNode(context, { gain: 0.75 });
    const rising = createRampBuffer(context, true);
    const falling = createRampBuffer(context, false);
    const fade = createFadeBuffer(context);

    const voices = [0, GRAIN - FADE].map((offset) => {
      const delay = new DelayNode(context, { maxDelayTime: 1 });
      const depth = new GainNode(context, { gain: 0 });
      const downGain = new GainNode(context);
      const upGain = new GainNode(context, { gain: 0 });
      const mix = new GainNode(context, { gain: 0 });
      const downRamp = new AudioBufferSourceNode(context, { buffer: rising, loop: true });
      const upRamp = new AudioBufferSourceNode(context, { buffer: falling, loop: true });
      const fadeSource = new AudioBufferSourceNode(context, { buffer: fade, loop: true });

      downRamp.connect(downGain).connect(depth);
      upRamp.connect(upGain).connect(depth);
      depth.connect(delay.delayTime);
      fadeSource.connect(mix.gain);
      input.connect(delay).connect(mix).connect(output);

      const start = context.currentTime + 0.05 + offset;
      for (const source of [downRamp, upRamp, fadeSource]) source.start(start);
      return { depth, downGain, upGain };
    });

    function setSemitones(semitones) {
      const ratio = 2 ** (semitones / 12);
      const shiftUp = ratio > 1;
      // Atraso que cresce baixa o tom, que diminui sobe; a inclinação da rampa é |ratio - 1|.
      const maxDelay = GRAIN * Math.abs(ratio - 1);
      for (const voice of voices) {
        voice.downGain.gain.value = shiftUp ? 0 : 1;
        voice.upGain.gain.value = shiftUp ? 1 : 0;
        voice.depth.gain.setTargetAtTime(maxDelay, context.currentTime, 0.01);
      }
    }

    return { input, output, setSemitones };
  }

  const PRE_DELAY = 0.02;

  // Sala sintética: pré-delay separa a voz da cauda, a cauda cai 60 dB em `seconds` e um passa-baixa
  // que fecha de 8 kHz para 500 Hz faz os agudos morrerem antes dos graves: a cauda quente e escura
  // dos remixes slowed + reverb.
  // Ruído independente por canal deixa a cauda larga no estéreo.
  function createImpulse(context, seconds) {
    const rate = context.sampleRate;
    const offset = Math.round(PRE_DELAY * rate);
    const length = offset + Math.round(seconds * rate);
    const impulse = context.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      // Envelope por multiplicação e coeficiente do filtro a cada 64 amostras: o mesmo resultado sem
      // calcular potência e exponencial por amostra, o que travaria a página por dezenas de ms.
      const total = length - offset;
      const decayStep = 10 ** (-3 / total);
      let envelope = 1;
      let coefficient = 0;
      let filtered = 0;
      for (let i = 0; i < total; i++) {
        if (i % 64 === 0) coefficient = 1 - Math.exp((-2 * Math.PI * Math.max(500, 8000 * 0.02 ** (i / total))) / rate);
        filtered += coefficient * (Math.random() * 2 - 1 - filtered);
        data[offset + i] = filtered * envelope;
        envelope *= decayStep;
      }
    }
    return impulse;
  }

  // 8D binaural: a música vira uma fonte que orbita a cabeça e o HRTF do Chrome dá as pistas de
  // frente, lado, trás e altura. A posição é dirigida por osciladores dentro do grafo, então o
  // movimento segue fluido com a aba em segundo plano, onde os timers de JavaScript ficam lentos.
  // Cada termo é [múltiplo da velocidade base, amplitude, forma]; o ouvinte olha para -z.
  const ORBITS = [
    // círculo: volta completa no plano horizontal
    { x: [[1, 1, 'sin']], y: [[0.43, 0.35, 'sin']], z: [[1, -1, 'cos']] },
    // oito: frente, atrás à direita, frente, atrás à esquerda
    { x: [[1, 1, 'sin']], y: [[0.43, 0.35, 'sin']], z: [[2, -1, 'cos']] },
    // livre: trajetória 3D viva com razões áureas e prateadas incomensuráveis; o trajeto navega
    // suavemente em torno da cabeça em todas as dimensões sem jamais se repetir.
    {
      x: [[1, 0.65, 'sin'], [1.618, 0.25, 'cos'], [0.382, 0.15, 'sin']],
      y: [[0.618, 0.35, 'sin'], [1.414, 0.18, 'cos']],
      z: [[1, -0.65, 'cos'], [2.414, 0.25, 'sin'], [0.414, -0.15, 'cos']],
    },
  ];
  const ELEVATION = [[0.43, 0.35, 'sin']];
  // A velocidade oscila 30% para cima e para baixo a cada 20 s, para o giro não soar mecânico.
  const SPEED_SWAY = 0.3;
  const SWAY_FREQUENCY = 0.05;
  // O HRTF do Chrome sai 6 dB abaixo do som direto (medido com ruído); o ganho 2 empata os dois.
  const ORBIT_GAIN = 2;

  function createOrbit(context) {
    const panner = new PannerNode(context, { panningModel: 'HRTF', distanceModel: 'linear', rolloffFactor: 0 });
    const sway = new OscillatorNode(context, { frequency: SWAY_FREQUENCY });
    const cosine = context.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]));
    sway.start();
    let speed = 0.1;
    let voices = [];

    // Todos os osciladores partem juntos e recebem a mesma oscilação de velocidade, proporcional ao
    // seu múltiplo: assim as fases continuam travadas entre si e o desenho do trajeto se mantém.
    function setPath(path) {
      for (const voice of voices) {
        voice.oscillator.stop();
        voice.depth.disconnect();
        voice.amplitude.disconnect();
      }
      const start = context.currentTime + 0.02;
      const config = ORBITS[path] ?? ORBITS[0];
      const axes = { positionX: config.x, positionY: config.y ?? ELEVATION, positionZ: config.z };
      voices = Object.entries(axes).flatMap(([axis, terms]) => terms.map(([multiple, size, shape]) => {
        const oscillator = new OscillatorNode(context, { frequency: speed * multiple });
        if (shape === 'cos') oscillator.setPeriodicWave(cosine);
        const depth = new GainNode(context, { gain: speed * multiple * SPEED_SWAY });
        const amplitude = new GainNode(context, { gain: size });
        sway.connect(depth).connect(oscillator.frequency);
        oscillator.connect(amplitude).connect(panner[axis]);
        oscillator.start(start);
        return { oscillator, depth, amplitude, multiple };
      }));
    }

    function setSpeed(frequency) {
      speed = frequency;
      const now = context.currentTime;
      for (const { oscillator, depth, multiple } of voices) {
        oscillator.frequency.setTargetAtTime(frequency * multiple, now, 0.5);
        depth.gain.setTargetAtTime(frequency * multiple * SPEED_SWAY, now, 0.5);
      }
    }

    return { panner, setPath, setSpeed };
  }

  // Fita gasta: wow (0,6 Hz) e flutter (6,5 Hz) modulam um atraso curto e o tom oscila de leve.
  // No máximo, wow e flutter somados desviam ~27 cents (medido no teste de DSP).
  function createTape(context) {
    const delay = new DelayNode(context, { delayTime: 0.012, maxDelayTime: 0.05 });
    const wowDepth = new GainNode(context, { gain: 0 });
    const flutterDepth = new GainNode(context, { gain: 0 });
    for (const [frequency, depth] of [[0.6, wowDepth], [6.5, flutterDepth]]) {
      const oscillator = new OscillatorNode(context, { frequency });
      oscillator.connect(depth).connect(delay.delayTime);
      oscillator.start();
    }

    function setAmount(amount) {
      const now = context.currentTime;
      wowDepth.gain.setTargetAtTime(0.003 * amount, now, 0.1);
      flutterDepth.gain.setTargetAtTime(0.00012 * amount, now, 0.1);
    }

    return { input: delay, output: delay, setAmount };
  }

  // Saturação de fita: tanh(d·x)/d mantém o ganho dos sinais baixos e arredonda os picos, gerando os
  // harmônicos ímpares que dão o "calor".
  function saturationCurve(amount) {
    const drive = 1 + amount * 2;
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(drive * x) / drive;
    }
    return curve;
  }

  // Chorus: duas cópias com atraso de ~20 ms oscilando em fases opostas, uma em cada lado, somadas ao
  // som original; é o brilho ondulado e largo do vaporwave.
  function createChorus(context) {
    const input = new GainNode(context);
    const output = new GainNode(context, { gain: 0 });
    const merger = new ChannelMergerNode(context, { numberOfInputs: 2 });
    const lfo = new OscillatorNode(context, { frequency: 0.25 });
    for (const [channel, sign] of [[0, 1], [1, -1]]) {
      const delay = new DelayNode(context, { delayTime: 0.02, maxDelayTime: 0.05 });
      lfo.connect(new GainNode(context, { gain: 0.004 * sign })).connect(delay.delayTime);
      input.connect(delay).connect(merger, 0, channel);
    }
    lfo.start();
    merger.connect(output);

    function setAmount(amount) {
      output.gain.setTargetAtTime(amount * 0.7, context.currentTime, 0.05);
    }

    return { input, output, setAmount };
  }

  // Disco de vinil: chiado e estalos num loop de 4 s, filtrados acima de 500 Hz para não roncar. O
  // loop é normalizado e no máximo fica a -36 dBFS RMS, uns 20 dB abaixo de música masterizada;
  // o preset de lo-fi fica perto de -51 dBFS, só uma textura ao fundo. O volume segue o envelope da música, então o disco silencia
  // quando ela pausa.
  function createVinyl(context) {
    const rate = context.sampleRate;
    const buffer = context.createBuffer(2, rate * 4, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      // Chiado contínuo bem abaixo dos estalos: o que caracteriza o vinil são os estalos, e o chiado
      // alto vira "chuvisco" por cima da música.
      let hiss = 0;
      for (let i = 0; i < data.length; i++) {
        hiss += 0.5 * (Math.random() * 2 - 1 - hiss);
        data[i] = hiss * 0.002;
      }
      // Estalos (24 por segundo) e pops (0,6 por segundo) chegam em instantes sorteados pela
      // distribuição exponencial, sem sortear amostra por amostra.
      for (const [perSecond, pop] of [[24, false], [0.6, true]]) {
        for (let i = -Math.log(Math.random()) * (rate / perSecond); i < data.length; i += -Math.log(Math.random()) * (rate / perSecond)) {
          const start = Math.floor(i);
          const amplitude = pop ? 0.5 + Math.random() * 0.4 : 0.05 + 0.6 * Math.random() ** 3;
          const decay = pop ? 24 : 5;
          for (let k = 0; k < decay * 5 && start + k < data.length; k++) data[start + k] += amplitude * (Math.random() * 2 - 1) * Math.exp(-k / decay);
        }
      }
      let power = 0;
      for (let i = 0; i < data.length; i++) power += data[i] * data[i];
      power = Math.sqrt(power / data.length);
      for (let i = 0; i < data.length; i++) data[i] /= power;
    }
    const source = new AudioBufferSourceNode(context, { buffer, loop: true });
    const highpass = new BiquadFilterNode(context, { type: 'highpass', frequency: 500 });
    const lowpass = new BiquadFilterNode(context, { type: 'lowpass', frequency: 3500 });
    const gate = new GainNode(context, { gain: 0 });
    const output = new GainNode(context, { gain: 0 });
    source.connect(highpass).connect(lowpass).connect(gate).connect(output);
    source.start();

    // Envelope sem JavaScript: retifica, suaviza em 3 Hz e satura para virar um portão de 0 a 1,
    // o que segue funcionando com a aba em segundo plano.
    const rectifier = new WaveShaperNode(context, { curve: new Float32Array([1, 0, 1]) });
    const smoothing = new BiquadFilterNode(context, { type: 'lowpass', frequency: 3 });
    const opener = new WaveShaperNode(context, { curve: Float32Array.from({ length: 257 }, (_, i) => Math.tanh(Math.max(0, (i / 128 - 1) * 12))) });
    rectifier.connect(smoothing).connect(opener).connect(gate.gain);

    function setAmount(amount) {
      output.gain.setTargetAtTime(amount * 0.0158, context.currentTime, 0.05);
    }

    return { envelope: rectifier, output, setAmount };
  }

  // Os arquivos de ambiente trazem AMBIENCE_PAD segundos de sobra em cada ponta: o fim do loop antes do
  // início e o início depois do fim. O Opus erra nas bordas do arquivo e decodifica a mesma amostra com
  // erros diferentes em cada ponta, o que vira um estalo na volta em som liso como o da água. O loop
  // toca só o miolo, e os primeiros AMBIENCE_SEAM segundos dele se misturam à sobra final, que é a
  // continuação decodificada do fim.
  const AMBIENCE_PAD = 0.05;
  const AMBIENCE_SEAM = 0.01;

  function smoothLoopSeam(buffer) {
    const pad = Math.round(AMBIENCE_PAD * buffer.sampleRate);
    const seam = Math.round(AMBIENCE_SEAM * buffer.sampleRate);
    const end = buffer.length - pad;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < seam; i++) {
        const weight = i / seam;
        data[pad + i] = data[pad + i] * weight + data[end + i] * (1 - weight);
      }
    }
  }

  async function createAmbience(context, loadAudio, gain) {
    const buffer = await context.decodeAudioData(await loadAudio());
    smoothLoopSeam(buffer);
    const source = new AudioBufferSourceNode(context, {
      buffer, loop: true, loopStart: AMBIENCE_PAD, loopEnd: buffer.duration - AMBIENCE_PAD,
    });
    const gate = new GainNode(context, { gain: 0 });
    const output = new GainNode(context, { gain: 0 });
    source.connect(gate).connect(output);
    source.start(0, AMBIENCE_PAD);

    const rectifier = new WaveShaperNode(context, { curve: new Float32Array([1, 0, 1]) });
    const smoothing = new BiquadFilterNode(context, { type: 'lowpass', frequency: 0.7 });
    const opener = new WaveShaperNode(context, { curve: Float32Array.from({ length: 257 }, (_, i) => Math.tanh(Math.max(0, (i / 128 - 1) * 12))) });
    rectifier.connect(smoothing).connect(opener).connect(gate.gain);

    function setAmount(amount) {
      output.gain.setTargetAtTime(amount * gain, context.currentTime, 0.05);
    }

    return { envelope: rectifier, output, setAmount };
  }

  const BUTTERWORTH_Q = -3.01;
  // Ganho que anula a compensação automática do DynamicsCompressor com threshold -3 e ratio 20
  // (medido no teste de DSP: o neutro precisa sair em 0 dB).
  const LIMITER_TRIM = 0.822;
  // O WaveShaper só lê entradas entre -1 e 1; o sinal entra pela metade (ganho 0,5 no `trim`) e a
  // curva devolve o dobro, linear até 0,9 e saturando suave até no máximo 1,0.
  const CEILING_CURVE = Float32Array.from({ length: 4097 }, (_, i) => {
    const value = ((i / 4096) * 2 - 1) * 2;
    const size = Math.abs(value);
    return size < 0.9 ? value : Math.sign(value) * (0.9 + 0.1 * Math.tanh((size - 0.9) / 0.1));
  });

  function createEngine(context, loadAudio) {
    const input = new GainNode(context);
    // No Web Audio o Q de passa-alta e passa-baixa é em dB; -3,01 dB é a resposta Butterworth, que
    // fica 3 dB abaixo exatamente na frequência de corte.
    const subsonic = new BiquadFilterNode(context, { type: 'highpass', frequency: 25, Q: BUTTERWORTH_Q });
    const bass = new BiquadFilterNode(context, { type: 'lowshelf', frequency: 150, gain: 0 });
    const muffle = new BiquadFilterNode(context, { type: 'lowpass', frequency: context.sampleRate / 2, Q: BUTTERWORTH_Q });
    const warmth = new WaveShaperNode(context, { oversample: '2x' });
    const tone = new GainNode(context);
    const dry = new GainNode(context);
    const direct = new GainNode(context);
    const orbitOut = new GainNode(context, { gain: 0 });
    const reverb = new ConvolverNode(context);
    const wet = new GainNode(context, { gain: 0 });
    const master = new GainNode(context);
    const generated = new GainNode(context, { gain: 0 });
    const bypass = new GainNode(context, { gain: 1 });
    const processed = new GainNode(context, { gain: 0 });
    // Limitador de segurança: graves fortes e reverb somados passariam de 0 dBFS e o Chrome cortaria
    // o pico seco. O compressor segura o grosso acima de -3 dB; como ele não é um teto rígido, um
    // clipper suave depois garante o pico em 1,0. O compressor do Web Audio aplica ganho de
    // compensação automático, desfeito por `LIMITER_TRIM`.
    const limiter = new DynamicsCompressorNode(context, { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.25 });
    const trim = new GainNode(context, { gain: LIMITER_TRIM * 0.5 });
    const ceiling = new WaveShaperNode(context, { curve: CEILING_CURVE, oversample: '2x' });
    const chorus = createChorus(context);

    input.connect(subsonic);
    subsonic.connect(bass).connect(muffle).connect(warmth).connect(tone);
    warmth.connect(chorus.input);
    chorus.output.connect(tone);
    // O 8D move só o som direto; o reverb fica em volta, como nas versões 8D da internet. Sem 8D o
    // som direto não passa pelo HRTF, que coloriria o timbre mesmo parado na frente.
    tone.connect(dry).connect(direct).connect(master);
    orbitOut.connect(master);
    tone.connect(reverb).connect(wet).connect(master);
    generated.connect(master);
    master.connect(limiter).connect(trim).connect(ceiling).connect(processed).connect(context.destination);
    bypass.connect(context.destination);

    // O visualizador lê o espectro de frequências completo em 16 bandas logarítmicas
    // (de subgraves a 20 kHz) para alimentar os visualizadores do popup e estúdio com precisão.
    const analyser = new AnalyserNode(context, { fftSize: 1024, smoothingTimeConstant: 0.5 });
    processed.connect(analyser);
    bypass.connect(analyser);
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const nyquist = Math.max(1, context.sampleRate / 2);
    const bassBins = Math.max(1, Math.round((150 / nyquist) * bins.length));
    const BAND_FREQS = [25, 60, 120, 200, 320, 500, 800, 1200, 1800, 2600, 3800, 5500, 8000, 11000, 15000, 20000];
    const bandRanges = Array.from({ length: 16 }, (_, i) => {
      const startHz = BAND_FREQS[i] ?? 20;
      const endHz = BAND_FREQS[i + 1] ?? nyquist;
      const start = Math.min(bins.length - 1, Math.floor((startHz / nyquist) * bins.length));
      const end = Math.max(start + 1, Math.min(bins.length, Math.ceil((endHz / nyquist) * bins.length)));
      return [start, end];
    });
    const bandsBuffer = new Array(16);

    function audioLevels() {
      analyser.getByteFrequencyData(bins);
      let bassSum = 0;
      for (let i = 0; i < bassBins; i++) bassSum += bins[i];
      const level = bassSum / bassBins / 255;

      for (let b = 0; b < 16; b++) {
        const [start, end] = bandRanges[b];
        let sum = 0;
        for (let k = start; k < end; k++) sum += bins[k];
        bandsBuffer[b] = sum / (end - start) / 255;
      }
      return { level, bands: [...bandsBuffer] };
    }

    function bassLevel() {
      return audioLevels().level;
    }

    // Tom separado e fita entram no começo da cadeia só quando ligados: fora dela não somam
    // atraso nem colorem o som.
    const stages = { pitch: null, tape: null };
    let stageKey = null;

    function rewire(active) {
      const key = active.join();
      if (key === stageKey) return;
      stageKey = key;
      input.disconnect();
      Object.values(stages).forEach((stage) => stage?.output.disconnect());
      input.connect(bypass);
      let previous = input;
      for (const name of active) {
        previous.connect(stages[name].input);
        previous = stages[name].output;
      }
      previous.connect(subsonic);
      if (vinyl) input.connect(vinyl.envelope);
      Object.values(ambiences).forEach((ambience) => input.connect(ambience.envelope));
    }

    let roomSize = null;
    let impulseTimer;
    // O loop de vinil só é gerado quando ligado, fora da tarefa que aplica os filtros.
    let vinyl = null;
    let vinylAmount = 0;
    let vinylScheduled = false;
    const ambiences = {};
    const ambienceAmounts = { rain: 0, water: 0 };
    const ambienceScheduled = { rain: false, water: false };
    let orbit = null;
    let orbitPath = null;
    let warmthAmount = null;

    function set(style) {
      const now = context.currentTime;
      const glide = (param, value) => param.setTargetAtTime(value, now, 0.05);
      const active = ['pitch', 'bass', 'muffle', 'warmth', 'wobble', 'chorus', 'vinyl', 'rain', 'water', 'reverb', 'spin'].some((key) => style[key]);
      bypass.gain.setTargetAtTime(active ? 0 : 1, now, 0.005);
      processed.gain.setTargetAtTime(active ? 1 : 0, now, 0.005);

      if (style.pitch !== 0) stages.pitch ??= createPitchShifter(context);
      if (style.wobble > 0) stages.tape ??= createTape(context);
      rewire(['pitch', 'tape'].filter((name) => (name === 'pitch' ? style.pitch !== 0 : style.wobble > 0)));
      if (style.pitch !== 0) stages.pitch.setSemitones(style.pitch);
      if (style.wobble > 0) stages.tape.setAmount(style.wobble / 100);

      glide(bass.gain, style.bass);
      glide(muffle.frequency, Math.min(context.sampleRate / 2, 20000 * 0.02 ** (style.muffle / 100)));
      if (style.warmth !== warmthAmount) {
        warmthAmount = style.warmth;
        warmth.curve = style.warmth > 0 ? saturationCurve(style.warmth / 100) : null;
      }
      chorus.setAmount(style.chorus / 100);
      vinylAmount = style.vinyl / 100;
      if (vinylAmount > 0 && !vinyl && !vinylScheduled) {
        vinylScheduled = true;
        setTimeout(() => {
          vinyl = createVinyl(context);
          vinyl.output.connect(generated);
          input.connect(vinyl.envelope);
          vinyl.setAmount(vinylAmount);
        }, 0);
      }
      vinyl?.setAmount(vinylAmount);

      for (const kind of ['rain', 'water']) {
        ambienceAmounts[kind] = (style[kind] || 0) / 100;
        if (ambienceAmounts[kind] > 0 && !ambiences[kind] && !ambienceScheduled[kind]) {
          ambienceScheduled[kind] = true;
          createAmbience(context, () => loadAudio(kind), kind === 'rain' ? 2 : 1).then((loaded) => {
            ambiences[kind] = loaded;
            loaded.output.connect(generated);
            input.connect(loaded.envelope);
            loaded.setAmount(ambienceAmounts[kind]);
          }).catch((error) => {
            ambienceScheduled[kind] = false;
            console.error(`Não foi possível carregar o áudio ${kind}:`, error);
          });
        }
        ambiences[kind]?.setAmount(ambienceAmounts[kind]);
      }

      const mix = style.reverb / 100;
      glide(dry.gain, Math.cos((mix * Math.PI) / 2));
      glide(wet.gain, Math.sin((mix * Math.PI) / 2));
      if (mix > 0 && style.room !== roomSize) {
        roomSize = style.room;
        clearTimeout(impulseTimer);
        // Gerar o impulso custa alguns ms; espera o slider parar antes de refazer.
        impulseTimer = setTimeout(() => { reverb.buffer = createImpulse(context, 0.8 + (style.room / 100) * 1.8); }, reverb.buffer ? 200 : 0);
      }

      const spinning = style.spin > 0;
      if (spinning) {
        if (!orbit) {
          orbit = createOrbit(context);
          dry.connect(orbit.panner).connect(orbitOut);
        }
        const path = Math.round(style.orbit);
        if (path !== orbitPath) {
          orbit.setPath(path);
          orbitPath = path;
        }
        orbit.setSpeed(0.04 + (style.spin / 100) * 0.26);
      }
      glide(direct.gain, spinning ? 0 : 1);
      glide(orbitOut.gain, spinning ? ORBIT_GAIN : 0);
    }

    rewire([]);
    function setPlaying(playing) {
      generated.gain.setTargetAtTime(playing ? 1 : 0, context.currentTime, 0.01);
    }
    return { context, input, set, setPlaying, bassLevel, audioLevels };
  }

  return { createEngine };
})();
