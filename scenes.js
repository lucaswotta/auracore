// Cenas animadas atrás das artes de cada estilo, com duas camadas de canvas.
const TAU = Math.PI * 2;
const random = (min, max) => min + Math.random() * (max - min);
const VISUAL_CENTER = 0.5;
const VISUAL_WIDTH = 1;

function alpha(hex, opacity) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${Math.max(0, Math.min(1, opacity))})`;
}

function sparkle(ctx, x, y, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.quadraticCurveTo(x, y, x + size, y);
  ctx.quadraticCurveTo(x, y, x, y + size);
  ctx.quadraticCurveTo(x, y, x - size, y);
  ctx.quadraticCurveTo(x, y, x, y - size);
  ctx.fill();
}

const visualBand = (frame, index) => Math.sqrt(Math.max(0, Math.min(1, frame.bands[index] ?? frame.level)));
const bandEnergy = (frame, ...indices) => indices.reduce((sum, index) => sum + visualBand(frame, index), 0) / indices.length;

function drawSpectrum(ctx, frame, colors, bottom, gain, glow, inset = 0) {
  const barCount = 24;
  const width = frame.w * (1 - inset * 2);
  const barWidth = width / barCount;
  ctx.save();
  ctx.shadowColor = colors[1];
  ctx.shadowBlur = glow;
  ctx.fillStyle = alpha(colors[0], 0.38);
  ctx.fillRect(frame.w * inset, frame.h * bottom, width, Math.max(1, frame.h * 0.008));
  for (let index = 0; index < barCount; index++) {
    const band = visualBand(frame, Math.floor(index / barCount * 16));
    if (band <= 0.005) continue;
    const height = Math.max(frame.h * 0.025, Math.sqrt(band) * frame.h * gain);
    const x = frame.w * inset + index * barWidth + barWidth * 0.16;
    const width = barWidth * 0.68;
    const grad = ctx.createLinearGradient(0, frame.h * bottom - height, 0, frame.h * bottom);
    grad.addColorStop(0, alpha(colors[0], 0.9));
    grad.addColorStop(0.65, alpha(colors[1], 0.82));
    grad.addColorStop(1, alpha(colors[2], 0.72));
    ctx.fillStyle = grad;
    ctx.fillRect(x, frame.h * bottom - height, width, height);
  }
  ctx.restore();
}

function echoChamber(colors) {
  const echoes = [];
  let previousBass = 0;
  let lastEcho = -1;
  return ({ back }, f) => {
    const centerX = f.w * 0.58;
    const centerY = f.h * 0.54;
    const bass = bandEnergy(f, 0, 1, 2);
    const mids = bandEnergy(f, 5, 6, 7);
    const highs = bandEnergy(f, 11, 12, 13);

    const voidGlow = back.createRadialGradient(centerX, centerY, 0, centerX, centerY, f.w * 0.55);
    voidGlow.addColorStop(0, alpha(colors[0], 0.12 + mids * 0.07));
    voidGlow.addColorStop(0.48, alpha(colors[1], 0.07));
    voidGlow.addColorStop(1, alpha(colors[1], 0));
    back.fillStyle = voidGlow;
    back.fillRect(0, 0, f.w, f.h);

    back.save();
    back.shadowColor = colors[0];
    back.shadowBlur = 8;
    for (let index = 4; index >= 0; index--) {
      const depth = index / 4;
      const drift = Math.sin(f.t * 0.38 - index * 0.5) * f.w * 0.006;
      back.strokeStyle = alpha(colors[index % 2], 0.1 + (1 - depth) * 0.12 + mids * 0.1);
      back.lineWidth = 0.8 + (1 - depth) * 0.8;
      back.beginPath();
      back.ellipse(centerX + drift, centerY, f.w * (0.15 + depth * 0.4), f.h * (0.34 + depth * 0.34), 0, 0, TAU);
      back.stroke();
    }
    back.restore();

    if (bass > 0.35 && bass > previousBass + 0.025 && f.t - lastEcho > 0.35) {
      echoes.push({ started: f.t, strength: bass });
      lastEcho = f.t;
    }
    previousBass = bass;

    for (let index = echoes.length - 1; index >= 0; index--) {
      const age = f.t - echoes[index].started;
      if (age > 2.8) {
        echoes.splice(index, 1);
        continue;
      }
      const spread = age / 2.8;
      back.strokeStyle = alpha(colors[2], (1 - spread) * echoes[index].strength * (0.28 + highs * 0.18));
      back.lineWidth = 1.6 - spread;
      back.beginPath();
      back.ellipse(centerX, centerY, f.w * (0.13 + spread * 0.45), f.h * (0.3 + spread * 0.4), 0, 0, TAU);
      back.stroke();
    }
  };
}

// 2. Sped Up: linhas de velocidade com visualizador de 16 bandas horizontais de espectro real
function speedLines(colors) {
  const lines = Array.from({ length: 42 }, () => ({
    x: Math.random(), y: Math.random() * 0.62, length: random(0.08, 0.32), speed: random(1.2, 2.4), color: colors[Math.floor(random(0, 3))], width: random(0.8, 2),
  }));
  return ({ back }, f) => {
    // 16 bandas de frequência horizontais
    const barHeight = f.h * 0.64 / 16;
    for (let i = 0; i < 16; i++) {
      const energy = visualBand(f, i);
      if (energy <= 0.005) continue;
      const len = energy * f.w;
      back.fillStyle = alpha(colors[i % 3], 0.08 + energy * 0.28);
      back.fillRect(0, i * barHeight + 1, len, Math.max(1, barHeight - 3));
    }

    back.lineCap = 'round';
    for (const line of lines) {
      line.x -= (line.speed + f.level) * f.dt;
      if (line.x + line.length < 0) {
        line.x = 1 + Math.random() * 0.2;
        line.y = Math.random() * 0.62;
      }
      const x = line.x * f.w;
      const y = line.y * f.h;
      const length = line.length * f.w;
      const grad = back.createLinearGradient(x, 0, x + length, 0);
      grad.addColorStop(0, alpha(line.color, 0.95));
      grad.addColorStop(1, alpha(line.color, 0));
      back.strokeStyle = grad;
      back.lineWidth = line.width;
      back.beginPath();
      back.moveTo(x, y);
      back.lineTo(x + length, y);
      back.stroke();
    }
  };
}

// 3. Nightcore: equalizador neon com barras verticais conectadas ao espectro real de frequências
function nightcore(colors) {
  const stars = Array.from({ length: 32 }, () => ({
    x: Math.random() * VISUAL_WIDTH, y: Math.random() * 0.65, size: random(1.5, 4), phase: random(0, TAU), speed: random(2, 5),
  }));
  return ({ back }, f) => {
    const halo = back.createRadialGradient(f.w * VISUAL_CENTER, f.h * 0.5, 10, f.w * VISUAL_CENTER, f.h * 0.5, f.w * 0.48);
    halo.addColorStop(0, alpha(colors[0], 0.28 + f.level * 0.16));
    halo.addColorStop(0.65, alpha(colors[1], 0.16));
    halo.addColorStop(1, alpha(colors[2], 0));
    back.fillStyle = halo;
    back.fillRect(0, 0, f.w, f.h);

    // 28 barras mapeadas nas bandas de áudio (graves na esquerda, agudos na direita)
    const barCount = 24;
    const barWidth = f.w / barCount;
    for (let index = 0; index < barCount; index++) {
      const bandIndex = Math.min(15, Math.floor((index / barCount) * 16));
      const energy = visualBand(f, bandIndex);
      if (energy <= 0.005) continue;
      const height = energy * f.h * 0.34;
      const grad = back.createLinearGradient(0, f.h * 0.64 - height, 0, f.h * 0.64);
      grad.addColorStop(0, alpha(colors[0], 0.9));
      grad.addColorStop(1, alpha(colors[1], 0.35));
      back.fillStyle = grad;
      back.fillRect(index * barWidth + 1, f.h * 0.64 - height, Math.max(2, barWidth - 2), height);
    }

    for (const star of stars) {
      const glow = (Math.sin(f.t * star.speed + star.phase) + 1) / 2;
      const highFreq = visualBand(f, 13);
      sparkle(back, star.x * f.w, star.y * f.h, star.size * (0.5 + glow * 0.5 + highFreq * 0.5), alpha(colors[2], 0.3 + glow * 0.6));
    }
  };
}

// 4. Daycore: sol quente com anéis radiais de pulso e pétalas
function daycore(colors) {
  const petals = Array.from({ length: 24 }, () => ({
    x: Math.random(), y: random(-0.2, 1), size: random(0.012, 0.025), fall: random(0.05, 0.12), drift: random(0, TAU), spin: random(0, TAU),
  }));
  return ({ back }, f) => {
    const sunRadius = f.h * (0.24 + f.level * 0.16);
    const sun = back.createRadialGradient(f.w * VISUAL_CENTER, f.h * 0.92, 5, f.w * VISUAL_CENTER, f.h * 0.92, f.w * 0.5);
    sun.addColorStop(0, alpha(colors[0], 0.9));
    sun.addColorStop(0.35, alpha(colors[1], 0.4 + f.level * 0.2));
    sun.addColorStop(1, alpha(colors[2], 0));
    back.fillStyle = sun;
    back.fillRect(0, 0, f.w, f.h);

    // Arcos de pulso musical mapeados por frequência
    for (let ring = 1; ring <= 3; ring++) {
      const band = visualBand(f, ring * 4);
      if (band <= 0.005) continue;
      const radius = sunRadius + ring * f.h * 0.16 + band * f.h * 0.12;
      back.strokeStyle = alpha(colors[0], (0.4 - ring * 0.1) * (0.4 + band * 0.6));
      back.lineWidth = 2;
      back.beginPath();
      back.arc(f.w * VISUAL_CENTER, f.h * 0.92, radius, Math.PI, TAU);
      back.stroke();
    }

    for (const petal of petals) {
      petal.y += petal.fall * f.dt;
      petal.x += Math.sin(f.t * 0.8 + petal.drift) * 0.025 * f.dt;
      petal.spin += f.dt;
      if (petal.y > 1.05) { petal.y = -0.05; petal.x = Math.random(); }
      back.save();
      back.translate(petal.x * f.w, petal.y * f.h);
      back.rotate(petal.spin);
      back.fillStyle = alpha(colors[0], 0.7);
      back.beginPath();
      back.ellipse(0, 0, petal.size * f.h, petal.size * f.h * 0.5, 0, 0, TAU);
      back.fill();
      back.restore();
    }
  };
}

// 5. Vaporwave: sol synthwave e grid 3D com montanhas de áudio formadas pelas frequências reais
function vaporwave(colors) {
  return ({ back }, f) => {
    const horizon = f.h * 0.62;
    const sunX = f.cx;
    const sunY = f.h * 0.48;
    const sunRadius = f.h * (0.34 + f.level * 0.1);
    const sun = back.createLinearGradient(0, sunY - sunRadius, 0, sunY + sunRadius);
    sun.addColorStop(0, colors[2]);
    sun.addColorStop(0.5, colors[0]);
    sun.addColorStop(1, colors[1]);
    back.save();
    back.beginPath();
    back.rect(0, 0, f.w, horizon);
    back.clip();
    back.fillStyle = sun;
    back.beginPath();
    back.arc(sunX, sunY, sunRadius, 0, TAU);
    back.fill();
    back.fillStyle = '#10061f';
    for (let i = 0; i < 7; i++) {
      const stripe = f.h * 0.06;
      const y = sunY + f.h * 0.06 + i * stripe + ((f.t * f.h * 0.03) % stripe);
      back.fillRect(sunX - sunRadius, y, sunRadius * 2, Math.max(1, f.h * (0.012 + i * 0.004)));
    }

    // Montanhas de áudio sintetizadas a partir das 16 bandas reais
    back.beginPath();
    back.moveTo(0, horizon);
    let hasAudioPeaks = false;
    for (let x = 0; x <= f.w; x += 8) {
      const bandIndex = Math.min(15, Math.floor((x / f.w) * 16));
      const energy = visualBand(f, bandIndex);
      const peak = energy > 0.005 ? energy * f.h * 0.35 : 0;
      if (peak > 0) hasAudioPeaks = true;
      back.lineTo(x, horizon - peak);
    }
    back.lineTo(f.w, horizon);
    back.closePath();
    if (hasAudioPeaks) {
      back.fillStyle = alpha(colors[1], 0.7);
      back.fill();
    }
    back.restore();

    // Grade em perspectiva synthwave
    back.fillStyle = '#10061f';
    back.fillRect(0, horizon, f.w, f.h - horizon);
    back.strokeStyle = alpha(colors[0], 0.5 + f.level * 0.35);
    back.lineWidth = 1;
    for (let i = -10; i <= 10; i++) {
      back.beginPath();
      back.moveTo(f.cx + i * f.w * 0.025, horizon);
      back.lineTo(f.cx + i * f.w * 0.17, f.h);
      back.stroke();
    }
    const scroll = (f.t * 0.8) % 1;
    for (let i = 0; i < 7; i++) {
      const depth = (i + scroll) / 7;
      const y = horizon + (f.h - horizon) * depth ** 2;
      back.beginPath();
      back.moveTo(0, y);
      back.lineTo(f.w, y);
      back.stroke();
    }
  };
}

// 6. 8D: visualizador orbital 3D livre e vivo com anéis de ressonância
function orbit(colors) {
  const trail = [];
  let previousPath = null;
  return ({ back, front }, f) => {
    // Anéis de ressonância baseados nos graves e médios
    for (let ring = 1; ring <= 2; ring++) {
      const band = visualBand(f, ring * 4);
      const pulseSize = f.h * (0.07 + ring * 0.07 + band * 0.04);
      back.strokeStyle = alpha(colors[0], (0.35 - ring * 0.12) * (0.5 + band * 0.5));
      back.lineWidth = 1.4;
      back.beginPath();
      back.arc(f.w * VISUAL_CENTER, f.h * 0.36, pulseSize, 0, TAU);
      back.stroke();
    }

    const t = f.t * (0.75 + (f.style?.spin ?? 45) / 130);
    const path = f.style?.orbit ?? 2;
    if (path !== previousPath) { trail.length = 0; previousPath = path; }
    const horizontal = path === 0 ? Math.sin(t)
      : path === 1 ? Math.sin(t * 2)
        : Math.sin(t) * 0.68 + Math.sin(t * 1.618) * 0.24 + Math.sin(t * 0.382) * 0.12;
    const depth = path === 0 ? Math.cos(t)
      : path === 1 ? Math.cos(t)
        : Math.cos(t) * 0.68 + Math.cos(t * 2.414) * 0.24 + Math.cos(t * 0.414) * 0.12;
    const vertical = path === 0 ? Math.sin(t) * 0.18
      : path === 1 ? Math.cos(t * 2) * 0.38
        : Math.sin(t * 0.618) * 0.35 + Math.cos(t * 1.414) * 0.18;

    const x = f.w * VISUAL_CENTER + f.w * 0.46 * horizontal;
    const y = f.cy + f.h * 0.28 * vertical;

    trail.push({ x, y, depth });
    if (trail.length > 16) trail.shift();

    trail.forEach((point, index) => {
      const layer = point.depth > 0 ? front : back;
      const ratio = (index + 1) / trail.length;
      const size = (2 + (point.depth + 1) * 2) * (0.7 + f.level * 0.4);
      layer.fillStyle = alpha(colors[2], ratio * (point.depth > 0 ? 0.62 : 0.3));
      layer.shadowColor = colors[2];
      layer.shadowBlur = point.depth > 0 ? 6 + f.level * 6 : 2;
      layer.beginPath();
      layer.arc(point.x, point.y, size * ratio, 0, TAU);
      layer.fill();
    });
    front.shadowBlur = 0;
    back.shadowBlur = 0;
  };
}

// 7. Bass: barras de subgrave reais e impacto no solo
function bassBars(colors) {
  const bars = Array.from({ length: 26 }, () => ({ height: 0, weight: random(0.6, 1) }));
  return ({ back }, f) => {
    const width = f.w / bars.length;
    bars.forEach((bar, index) => {
      // Foco nas 8 primeiras bandas (subgrave e bumbo real)
      const bandIndex = Math.min(15, Math.floor((index / bars.length) * 8));
      const energy = visualBand(f, bandIndex);
      const target = energy > 0.005 ? (energy * 1.35) * bar.weight * f.h * 0.42 : 0;
      bar.height += (target - bar.height) * Math.min(1, f.dt * 20);
      if (bar.height > 0.5) {
        const baseline = f.h * 0.6;
        const grad = back.createLinearGradient(0, baseline, 0, baseline - bar.height);
        grad.addColorStop(0, alpha(colors[0], 0.95));
        grad.addColorStop(0.7, alpha(colors[1], 0.8));
        grad.addColorStop(1, alpha(colors[2], 0.6));
        back.fillStyle = grad;
        back.fillRect(index * width + 1, baseline - bar.height, Math.max(1, width - 2), bar.height);
      }
    });
    const impact = bandEnergy(f, 0, 1, 2);
    back.fillStyle = alpha(colors[0], impact * 0.18);
    back.fillRect(0, 0, f.w * VISUAL_WIDTH, f.h * 0.6);
    back.strokeStyle = alpha(colors[0], impact * 0.8);
    back.lineWidth = 1 + impact * 4;
    back.beginPath();
    back.ellipse(f.w * VISUAL_CENTER, f.h * 0.6, f.w * (0.2 + impact * 0.3), f.h * (0.02 + impact * 0.04), 0, 0, TAU);
    back.stroke();
  };
}

// 8. Lo-Fi: visualizador de espectro com partículas suaves
function lofi(colors) {
  const motes = Array.from({ length: 24 }, () => ({
    x: Math.random() * VISUAL_WIDTH, y: Math.random() * 0.68, size: random(0.005, 0.014), drift: random(0, TAU),
  }));
  return ({ back }, f) => {
    drawSpectrum(back, f, colors, 0.64, 0.38, 3);

    for (const mote of motes) {
      mote.y -= 0.018 * f.dt;
      mote.x += Math.sin(f.t * 0.5 + mote.drift) * 0.01 * f.dt;
      if (mote.y < -0.02) mote.y = 0.68;
      back.fillStyle = alpha(colors[0], 0.45);
      back.beginPath();
      back.arc(mote.x * f.w, mote.y * f.h, mote.size * f.h, 0, TAU);
      back.fill();
    }
  };
}

// 9. Party Bathroom: holofotes difusos e pulso sob a porta no ritmo real
function partyBathroom(colors) {
  const lights = Array.from({ length: 6 }, (_, index) => ({
    color: colors[index % 3], x: random(0.05, 0.95), y: random(0.08, 0.62), phase: random(0, TAU), speed: random(0.3, 0.8),
  }));
  return ({ back }, f) => {
    back.save();
    back.filter = `blur(${Math.min(32, Math.max(8, f.h * 0.12))}px)`;
    for (const [index, light] of lights.entries()) {
      const band = visualBand(f, index * 2);
      const x = (light.x + Math.sin(f.t * light.speed + light.phase) * 0.11) * f.w;
      const y = (light.y + Math.cos(f.t * light.speed * 0.7 + light.phase) * 0.08) * f.h;
      back.fillStyle = alpha(light.color, 0.12 + band * 0.3);
      back.beginPath();
      back.arc(x, y, f.h * (0.12 + band * 0.13), 0, TAU);
      back.fill();
    }
    back.restore();

    const under = back.createRadialGradient(f.w * VISUAL_CENTER, f.h * 0.9, 4, f.w * VISUAL_CENTER, f.h * 0.9, f.w * 0.34);
    under.addColorStop(0, alpha(colors[0], 0.22 + f.level * 0.4));
    under.addColorStop(1, alpha(colors[0], 0));
    back.fillStyle = under;
    back.fillRect(0, f.h * 0.72, f.w, f.h * 0.28);
    drawSpectrum(back, f, colors, 0.64, 0.42, 10, 0.04);
  };
}

// 10. Sunday Night: skyline noturno com janelas equalizadoras reais
function sundayNight(colors) {
  const stars = Array.from({ length: 36 }, () => ({
    x: random(0.06, 0.58), y: random(0.1, 0.55), size: random(0.6, 1.8), phase: random(0, TAU),
  }));
  const buildings = [];
  for (let x = 0.04; x < 0.94; x += random(0.04, 0.07)) {
    const height = random(0.12, 0.3);
    const windows = [];
    for (let wy = 0.03; wy < height - 0.02; wy += 0.04) {
      for (let wx = 0.01; wx < 0.04; wx += 0.02) windows.push({ x: wx, y: wy });
    }
    buildings.push({ x, width: random(0.035, 0.06), height, windows });
  }
  return ({ back }, f) => {
    const windowBottom = f.h * 0.66;
    back.fillStyle = alpha(colors[0], 0.08);
    back.fillRect(f.w * 0.04, f.h * 0.08, f.w * 0.92, f.h * 0.58);
    for (const star of stars) {
      back.fillStyle = `rgba(255, 255, 255, ${0.3 + Math.sin(f.t * 1.5 + star.phase) * 0.25})`;
      back.fillRect(star.x * f.w, star.y * f.h, star.size, star.size);
    }
    for (const [index, building] of buildings.entries()) {
      const top = windowBottom - building.height * f.h;
      back.fillStyle = '#060814';
      back.fillRect(building.x * f.w, top, building.width * f.w, building.height * f.h);
      const band = visualBand(f, index % 16);
      const eqActive = band * building.windows.length * 1.2;
      for (const [wIndex, light] of building.windows.entries()) {
        const on = (wIndex + index) % 4 === 0 || wIndex < eqActive;
        if (on) {
          back.fillStyle = alpha(colors[2], 0.4 + band * 0.5);
          back.fillRect((building.x + light.x) * f.w, top + light.y * f.h, 2, 3);
        }
      }
    }
    back.strokeStyle = alpha(colors[1], 0.55);
    back.lineWidth = Math.max(2, f.w * 0.008);
    back.strokeRect(f.w * 0.04, f.h * 0.08, f.w * 0.92, f.h * 0.58);
    back.beginPath();
    back.moveTo(f.w * 0.35, f.h * 0.08);
    back.lineTo(f.w * 0.35, windowBottom);
    back.stroke();
    const warmth = back.createRadialGradient(f.w * VISUAL_CENTER, f.h * 0.7, 0, f.w * VISUAL_CENTER, f.h * 0.7, f.w * 0.32);
    warmth.addColorStop(0, alpha(colors[2], 0.16 + f.activity * 0.18));
    warmth.addColorStop(1, alpha(colors[2], 0));
    back.fillStyle = warmth;
    back.fillRect(0, 0, f.w, f.h);
  };
}

// 11. Underwater: bolhas flutuantes com pulsos de sonar e pressão aquática
function bubbles(colors) {
  const items = Array.from({ length: 32 }, () => ({
    x: Math.random(), y: Math.random(), radius: random(0.009, 0.025), speed: random(0.08, 0.23), wobble: random(0, TAU),
  }));
  return ({ back }, f) => {
    for (let index = 0; index < 6; index++) {
      back.strokeStyle = alpha(colors[index % 3], 0.12 + f.activity * 0.17);
      back.lineWidth = 1.5;
      back.beginPath();
      const phase = f.t * 0.5 + index;
      back.moveTo(f.w * (index * 0.19 - 0.12 + Math.sin(phase) * 0.04), 0);
      back.bezierCurveTo(f.w * (index * 0.19 + 0.02), f.h * 0.3, f.w * (index * 0.19 - 0.13), f.h * 0.58, f.w * (index * 0.19 + 0.04), f.h);
      back.stroke();
    }
    const sonarPhase = f.t % 6;
    if (sonarPhase < 2.2) {
      const radius = sonarPhase / 2.2 * f.w * 0.5;
      back.strokeStyle = alpha(colors[0], (1 - sonarPhase / 2.2) * (0.15 + f.activity * 0.22));
      back.beginPath();
      back.arc(f.w * VISUAL_CENTER, f.cy, radius, 0, TAU);
      back.stroke();
    }

    for (const [index, b] of items.entries()) {
      const band = visualBand(f, index % 16);
      b.y -= (b.speed + band * 0.1) * f.dt;
      b.wobble += 2.5 * f.dt;
      b.x += Math.sin(b.wobble) * 0.002 * f.dt;
      if (b.y < -0.05) { b.y = 1.05; b.x = Math.random(); }
      back.strokeStyle = alpha(colors[2], 0.45 + band * 0.35);
      back.lineWidth = 1.2;
      back.beginPath();
      back.arc(b.x * f.w, b.y * f.h, b.radius * f.h * (0.8 + band * 0.45), 0, TAU);
      back.stroke();
    }
  };
}

// 12. Empty Arena: feixes volumétricos de luz de estádio reagindo às frequências reais
function emptyArena(colors) {
  const dust = Array.from({ length: 30 }, () => ({
    x: Math.random(), y: Math.random(), speed: random(0.03, 0.09), size: random(1, 2.5),
  }));
  const bandPicks = [1, 7, 13];
  return ({ back }, f) => {
    for (let i = 0; i < 3; i++) {
      const band = visualBand(f, bandPicks[i]);
      if (band <= 0.005) continue;
      const angle = Math.sin(f.t * 1.6 + i * 2) * 0.55 + (i - 1) * 0.45;
      const sourceX = f.w * (0.1 + i * 0.4);
      const targetX = sourceX + Math.sin(angle) * f.w * 0.2;
      back.save();
      back.beginPath();
      back.moveTo(sourceX, 0);
      back.lineTo(targetX - f.w * (0.08 + band * 0.08), f.h);
      back.lineTo(targetX + f.w * (0.08 + band * 0.08), f.h);
      back.closePath();
      const grad = back.createLinearGradient(sourceX, 0, targetX, f.h);
      grad.addColorStop(0, alpha(colors[i % 3], 0.3 + band * 0.48));
      grad.addColorStop(1, alpha(colors[i % 3], 0));
      back.fillStyle = grad;
      back.fill();
      back.restore();
    }

    drawSpectrum(back, f, colors, 0.68, 0.34, 8);

    for (const d of dust) {
      d.y -= d.speed * f.dt;
      if (d.y < 0) d.y = 1;
      back.fillStyle = alpha(colors[0], 0.35 + f.level * 0.45);
      back.beginPath();
      back.arc(d.x * f.w, d.y * f.h, d.size, 0, TAU);
      back.fill();
    }
  };
}

// 13. Chuva ao ar livre: relâmpagos procedurais e névoa reagindo às bandas reais
function outdoorRain(colors) {
  const drops = Array.from({ length: 110 }, () => ({
    x: Math.random(), y: Math.random(), length: random(0.035, 0.13), speed: random(0.18, 0.55), opacity: random(0.12, 0.4),
  }));
  let nextLightning = random(4.5, 11.0);
  let flashLife = 0;
  let flashMax = 0.25;
  let boltPath = null;

  return ({ back, front }, f) => {
    nextLightning -= f.dt;
    if (nextLightning <= 0) {
      nextLightning = random(5.5, 13.5);
      flashLife = random(0.2, 0.32);
      flashMax = flashLife;
      if (Math.random() < 0.45) {
        let x = random(f.w * 0.2, f.w * 0.8);
        let y = 0;
        boltPath = [{ x, y }];
        while (y < f.h * 0.75) {
          x += random(-16, 16);
          y += random(12, 22);
          boltPath.push({ x, y });
        }
      } else {
        boltPath = null;
      }
    }

    if (flashLife > 0) {
      flashLife -= f.dt;
      const progress = flashLife / flashMax;
      const pulse = Math.sin(progress * Math.PI * 4) ** 2 * progress;
      back.fillStyle = alpha('#d6e5ff', pulse * 0.55);
      back.fillRect(0, 0, f.w, f.h);

      if (boltPath && boltPath.length > 1) {
        back.strokeStyle = alpha('#ffffff', pulse * 0.95);
        back.lineWidth = 1.8;
        back.beginPath();
        back.moveTo(boltPath[0].x, boltPath[0].y);
        for (let i = 1; i < boltPath.length; i++) back.lineTo(boltPath[i].x, boltPath[i].y);
        back.stroke();
      }
    }

    const mistLevel = visualBand(f, 2) * 0.22 + 0.05;
    const mist = back.createRadialGradient(f.w * 0.5, f.h * 0.9, 2, f.w * 0.5, f.h * 0.9, f.w * 0.65);
    mist.addColorStop(0, alpha(colors[0], mistLevel));
    mist.addColorStop(1, alpha(colors[0], 0));
    back.fillStyle = mist;
    back.fillRect(0, f.h * 0.4, f.w, f.h * 0.6);

    back.lineCap = 'round';
    for (const drop of drops) {
      drop.y += (drop.speed + f.level * 0.1) * f.dt;
      drop.x += Math.sin(f.t * 0.6 + drop.opacity * 20) * 0.008 * f.dt;
      if (drop.y > 1) {
        drop.y = -drop.length;
        drop.x = Math.random();
      }
      const layer = drop.opacity > 0.34 ? front : back;
      layer.strokeStyle = `rgba(200, 230, 255, ${drop.opacity})`;
      layer.lineWidth = drop.opacity > 0.34 ? 1.8 : 1.2;
      layer.beginPath();
      layer.moveTo(drop.x * f.w, drop.y * f.h);
      layer.lineTo((drop.x + drop.length * 0.05) * f.w, (drop.y - drop.length) * f.h);
      layer.stroke();
    }
  };
}

// 14. Ethereal: véus aurorais fluidos de luz celestial ondulando com frequências reais
function ethereal(colors) {
  const stars = Array.from({ length: 28 }, () => ({
    x: Math.random() * VISUAL_WIDTH, y: Math.random(), size: random(1, 2.5), phase: random(0, TAU),
  }));
  const bandPicks = [2, 8, 14];
  return ({ back }, f) => {
    for (let v = 0; v < 3; v++) {
      const band = visualBand(f, bandPicks[v]);
      if (band <= 0.005) continue;
      back.beginPath();
      const baseY = f.h * (0.18 + v * 0.18);
      back.moveTo(0, baseY);
      for (let x = 0; x <= f.w; x += 10) {
        const wave = Math.sin((x / f.w) * TAU * 1.4 + f.t * (0.5 + v * 0.18) + v * 2) * (band * f.h * 0.24);
        back.lineTo(x, baseY + wave);
      }
      back.lineTo(f.w, f.h);
      back.lineTo(0, f.h);
      back.closePath();
      const grad = back.createLinearGradient(0, baseY - 20, 0, f.h);
      grad.addColorStop(0, alpha(colors[v % 3], 0.1 + band * 0.25));
      grad.addColorStop(0.6, alpha(colors[(v + 1) % 3], 0.08));
      grad.addColorStop(1, alpha(colors[v % 3], 0));
      back.fillStyle = grad;
      back.fill();
    }

    for (const star of stars) {
      const glow = (Math.sin(f.t * 2 + star.phase) + 1) / 2;
      sparkle(back, star.x * f.w, star.y * f.h, star.size * (0.6 + glow * 0.6 + f.activity * 0.5), alpha(colors[2], 0.25 + glow * 0.55));
    }
  };
}

// 15. Phonk: picos cortantes neon que respondem diretamente a cada uma das 16 bandas
function phonk(colors) {
  const streaks = Array.from({ length: 24 }, () => ({
    x: Math.random(), y: Math.random() * 0.62, width: random(0.12, 0.35), speed: random(0.7, 1.7),
  }));
  return ({ back }, f) => {
    back.strokeStyle = alpha(colors[0], 0.16 + f.level * 0.38);
    back.lineWidth = 1.2;
    for (const s of streaks) {
      s.x -= (s.speed + f.level * 0.6) * f.dt;
      if (s.x + s.width < 0) { s.x = 1 + Math.random() * 0.2; s.y = Math.random() * 0.62; }
      back.beginPath();
      back.moveTo(s.x * f.w, s.y * f.h);
      back.lineTo((s.x + s.width) * f.w, s.y * f.h);
      back.stroke();
    }

    // Picos de frequências reais
    const peakCount = 18;
    const step = f.w * VISUAL_WIDTH / peakCount;
    let hasPhonkPeaks = false;
    back.beginPath();
    back.moveTo(0, f.h * 0.6);
    for (let i = 0; i <= peakCount; i++) {
      const bandIndex = Math.min(15, Math.floor((i / peakCount) * 16));
      const energy = visualBand(f, bandIndex);
      const height = energy > 0.005 ? energy * f.h * 0.32 : 0;
      if (height > 0) hasPhonkPeaks = true;
      back.lineTo(i * step, f.h * 0.6 - height);
    }
    back.lineTo(f.w * VISUAL_WIDTH, f.h * 0.6);
    back.closePath();
    if (hasPhonkPeaks) {
      const grad = back.createLinearGradient(0, f.h * 0.28, 0, f.h * 0.6);
      grad.addColorStop(0, alpha(colors[0], 0.88));
      grad.addColorStop(1, alpha(colors[1], 0.4));
      back.fillStyle = grad;
      back.fill();
    }
    const impact = bandEnergy(f, 0, 1, 2);
    back.fillStyle = alpha(colors[0], impact * 0.18);
    back.fillRect(0, f.h * 0.6, f.w * VISUAL_WIDTH, f.h * 0.05);
  };
}

// 16. Aura (padrão): anéis concêntricos de energia líquida
function aura(colors) {
  return ({ back }, f) => {
    for (let ring = 1; ring <= 3; ring++) {
      const band = visualBand(f, ring * 4);
      const radius = f.h * (0.05 + ring * 0.07 + Math.sin(f.t * 3 + ring) * 0.012 + band * 0.035);
      back.strokeStyle = alpha(colors[ring % 3], (0.4 - ring * 0.1) * (0.4 + band * 0.6));
      back.lineWidth = 2;
      back.beginPath();
      back.arc(f.w * VISUAL_CENTER, f.h * 0.33, radius, 0, TAU);
      back.stroke();
    }
  };
}

function custom(colors) {
  return ({ back }, f) => {
    const tall = f.h > f.w;
    const panelX = f.w * 0.04;
    const panelY = f.h * (tall ? 0.22 : 0.32);
    const panelW = f.w * 0.92;
    const panelH = f.h * (tall ? 0.11 : 0.2);
    back.fillStyle = alpha(colors[1], 0.12);
    back.fillRect(panelX, panelY, panelW, panelH);
    back.strokeStyle = alpha(colors[0], 0.55);
    back.lineWidth = 1;
    back.strokeRect(panelX, panelY, panelW, panelH);

    const barWidth = panelW / 18;
    for (let index = 0; index < 16; index++) {
      const band = visualBand(f, index);
      const height = (0.12 + band * 0.82) * panelH;
      back.fillStyle = alpha(colors[index % 3], 0.3 + band * 0.65);
      back.fillRect(panelX + barWidth * (index + 1), panelY + panelH - height, barWidth * 0.55, height);
    }

    const controls = [f.style?.bass ?? 0, f.style?.reverb ?? 0, f.style?.spin ?? 0];
    for (let index = 0; index < controls.length; index++) {
      const x = panelX + panelW * (0.16 + index * 0.3);
      const y = panelY - f.h * (tall ? 0.075 : 0.12);
      back.strokeStyle = alpha(colors[index], 0.55);
      back.beginPath();
      back.arc(x, y, f.h * 0.055, Math.PI * 0.75, Math.PI * (2.25 + controls[index] / 180));
      back.stroke();
      const band = visualBand(f, index * 5);
      sparkle(back, x, y, 1.5 + band * 3, alpha(colors[index], 0.45 + band * 0.45));
    }
  };
}

const THEMES = {
  aura: { colors: ['#ddf567', '#5bc8d0', '#eee7ae'], bg: '#191922', glow: '#293c43', scene: aura },
  slowed: { colors: ['#9676b6', '#52607d', '#c8c3dc'], bg: '#05050a', glow: '#17111f', scene: echoChamber },
  'sped-up': { colors: ['#ffd400', '#ff5e3a', '#ff2e88'], bg: '#120a05', glow: '#3a1f08', scene: speedLines },
  nightcore: { colors: ['#ff6ad5', '#c774e8', '#8ff3ff'], bg: '#120818', glow: '#3a1442', scene: nightcore },
  daycore: { colors: ['#ff9a5a', '#c2577a', '#6b4c9a'], bg: '#120a10', glow: '#3a1a1e', scene: daycore },
  vaporwave: { colors: ['#ff71ce', '#b967ff', '#01cdfe'], bg: '#10061f', glow: '#2d0f4a', scene: vaporwave },
  '8d': { colors: ['#4d7cff', '#9b5cff', '#22e4ff'], bg: '#050a14', glow: '#0f2140', scene: orbit },
  bass: { colors: ['#ff2e4d', '#ff7a00', '#ffd000'], bg: '#120406', glow: '#3d0a10', scene: bassBars },
  lofi: { colors: ['#f2b880', '#c98b6b', '#8fb8a8'], bg: '#14100c', glow: '#2e2219', scene: lofi },
  'party-bathroom': { colors: ['#ff2ea6', '#00e5ff', '#7cff4f'], bg: '#08060c', glow: '#1c0f24', scene: partyBathroom },
  'sunday-night': { colors: ['#7f9cf5', '#a78bfa', '#fcd9b8'], bg: '#0a0d1a', glow: '#18203d', scene: sundayNight },
  underwater: { colors: ['#00f0ff', '#0077b6', '#48cae4'], bg: '#020b14', glow: '#042a42', scene: bubbles },
  'empty-arena': { colors: ['#4cc9f0', '#7209b7', '#f72585'], bg: '#0a0814', glow: '#1d1238', scene: emptyArena },
  'rainy': { colors: ['#90c9ff', '#b4ddff', '#e7f4ff'], bg: '#090f1a', glow: '#172637', scene: outdoorRain },
  ethereal: { colors: ['#ffe5ec', '#bde0fe', '#ffd166'], bg: '#0e0d17', glow: '#28233d', scene: ethereal },
  phonk: { colors: ['#ff0054', '#9e0059', '#ff5400'], bg: '#120308', glow: '#3b0816', scene: phonk },
  custom: { colors: ['#7ce8ff', '#b6c8dd', '#f8fbff'], bg: '#08121c', glow: '#183445', scene: custom },
};

function createStage(backCanvas, frontCanvas, orb, onShake) {
  const layers = { back: backCanvas.getContext('2d'), front: frontCanvas.getContext('2d') };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let theme = null;
  let draw = null;
  let started = 0;
  let last = 0;
  let level = null;
  let bands = null;
  let smoothedLevel = 0;
  const smoothedBands = new Float32Array(16);
  let frameRequest = 0;
  let style = null;
  let active = true;

  function resize() {
    const ratio = Math.min(2, devicePixelRatio || 1);
    for (const canvas of [backCanvas, frontCanvas]) {
      canvas.width = canvas.clientWidth * ratio;
      canvas.height = canvas.clientHeight * ratio;
      canvas.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
    }
  }
  if (typeof window !== 'undefined') window.addEventListener('resize', resize);

  function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = Math.max(last, now);
    const t = Math.max(0, (now - started) / 1000);
    const w = backCanvas.clientWidth;
    const h = backCanvas.clientHeight;
    for (const ctx of Object.values(layers)) ctx.clearRect(0, 0, w, h);
    // Seguidor de envelope para animação 60 FPS com resposta rápida a ataques e queda suave
    const targetBeat = typeof level === 'number' && !Number.isNaN(level) ? Math.max(0, level) : 0;
    smoothedLevel += (targetBeat - smoothedLevel) * Math.min(1, dt * 22);

    if (bands) {
      for (let i = 0; i < 16; i++) {
        smoothedBands[i] += (bands[i] - smoothedBands[i]) * Math.min(1, dt * 22);
      }
    } else {
      for (let i = 0; i < 16; i++) {
        smoothedBands[i] += (0 - smoothedBands[i]) * Math.min(1, dt * 22);
      }
    }

    draw?.(layers, { t, dt, w, h, cx: w * 0.5, cy: h * 0.5, level: smoothedLevel, bands: smoothedBands, activity: Math.max(smoothedLevel, ...smoothedBands), style });
    if (THEMES[theme]?.shake && active && !reducedMotion) onShake(smoothedLevel);
    if (!reducedMotion && active) frameRequest = requestAnimationFrame(frame);
  }

  function onVisibility() {
    if (document.hidden || !active) {
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    } else if (!reducedMotion && draw && active) {
      last = performance.now();
      frameRequest = requestAnimationFrame(frame);
    }
  }
  if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', onVisibility);

  return {
    setTheme(id) {
      const nextTheme = THEMES[id] ? id : id?.startsWith('custom-') ? 'custom' : 'aura';
      if (nextTheme === theme) return;
      theme = nextTheme;
      const { colors, bg, glow, scene } = THEMES[theme];
      const root = document.documentElement.style;
      ['--hue-a', '--hue-b', '--hue-c'].forEach((name, index) => root.setProperty(name, colors[index]));
      root.setProperty('--bg', bg);
      root.setProperty('--glow', glow);
      onShake(0);
      resize();
      draw = scene ? scene(colors) : null;
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      if (active) {
        started = last = performance.now();
        frame(started);
      } else {
        const w = backCanvas.clientWidth;
        const h = backCanvas.clientHeight;
        for (const ctx of Object.values(layers)) ctx.clearRect(0, 0, w, h);
      }
    },
    setActive(value) {
      const next = Boolean(value);
      if (active === next) return;
      active = next;
      if (active) {
        if (reducedMotion && draw && !document.hidden) {
          started = last = performance.now();
          frame(started);
        } else if (draw && !document.hidden && !frameRequest) {
          started = last = performance.now();
          frameRequest = requestAnimationFrame(frame);
        }
      } else {
        cancelAnimationFrame(frameRequest);
        frameRequest = 0;
        onShake(0);
        const w = backCanvas.clientWidth;
        const h = backCanvas.clientHeight;
        for (const ctx of Object.values(layers)) ctx.clearRect(0, 0, w, h);
      }
    },
    setLevel(value, bandsData) {
      level = value;
      bands = bandsData ?? null;
    },
    setStyle(value) {
      style = value;
    },
  };
}
