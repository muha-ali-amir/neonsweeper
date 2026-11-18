/* ------------------------------------------------------------------ *
 *  NEONSWEEPER // procedural canvas textures
 * ------------------------------------------------------------------ */

import * as THREE from 'three';

export const PALETTE = {
  cyan: '#23f4ff',
  magenta: '#ff2bd6',
  yellow: '#ffd42a',
  green: '#57ff9a',
  red: '#ff3158',
  violet: '#9a6bff',
  white: '#eafcff',
};

function canvas(size, height = size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = height;
  return { c, ctx: c.getContext('2d') };
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function glowLine(ctx, pts, color, width, blur) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.restore();
}

function hiddenTexture() {
  const { c, ctx } = canvas(256);
  ctx.clearRect(0, 0, 256, 256);

  // outer frame
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.86)';
  ctx.shadowColor = 'rgba(255,255,255,0.75)';
  ctx.shadowBlur = 6;
  ctx.lineWidth = 4;
  roundRect(ctx, 12, 12, 232, 232, 20);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.34)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, 26, 26, 204, 204, 14);
  ctx.stroke();
  ctx.restore();

  // corner brackets
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 4;
  ctx.lineWidth = 5;
  const b = 34;
  const l = 22;
  [[b, b, 1, 1], [256 - b, b, -1, 1], [b, 256 - b, 1, -1], [256 - b, 256 - b, -1, -1]].forEach(([x, y, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(x + sx * l, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * l);
    ctx.stroke();
  });
  ctx.restore();

  // circuit traces
  const trace = (pts) => glowLine(ctx, pts, 'rgba(255,255,255,0.45)', 1.5, 3);
  trace([[128, 35], [128, 78], [88, 78], [88, 98]]);
  trace([[35, 128], [70, 128], [70, 160]]);
  trace([[221, 128], [190, 128], [190, 100]]);
  trace([[128, 221], [128, 184], [166, 184], [166, 160]]);

  // center hex
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.shadowColor = 'rgba(255,255,255,0.8)';
  ctx.shadowBlur = 5;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    const x = 128 + Math.cos(a) * 27;
    const y = 128 + Math.sin(a) * 27;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(128, 128, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // node dots
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  [[88, 98], [70, 160], [190, 100], [166, 160], [128, 78], [128, 184]].forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // scanline texture
  ctx.save();
  ctx.globalAlpha = 0.09;
  ctx.fillStyle = '#fff';
  for (let y = 18; y < 240; y += 8) ctx.fillRect(18, y, 220, 1);
  ctx.restore();

  return c;
}

function revealedTexture() {
  const { c, ctx } = canvas(256);
  ctx.clearRect(0, 0, 256, 256);

  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 2;
  roundRect(ctx, 16, 16, 224, 224, 16);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  for (const [x1, y1, x2, y2] of [
    [16, 80, 58, 80], [198, 176, 240, 176], [80, 16, 80, 42], [176, 214, 176, 240],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255,255,255,0.24)';
  ctx.beginPath();
  ctx.arc(128, 128, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = '#fff';
  for (let y = 20; y < 240; y += 6) ctx.fillRect(20, y, 216, 1);
  ctx.restore();

  return c;
}

function numberTexture(n, color) {
  const { c, ctx } = canvas(256);
  ctx.clearRect(0, 0, 256, 256);

  const gradient = ctx.createLinearGradient(0, 54, 0, 208);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.35, color);
  gradient.addColorStop(1, color);

  ctx.save();
  ctx.font = '900 164px Orbitron, "Rajdhani", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 34;
  ctx.fillStyle = gradient;
  ctx.fillText(String(n), 128, 138);
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.fillText(String(n), 128, 138);
  ctx.restore();

  // soft brackets under each digit
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(58, 214);
  ctx.lineTo(86, 226);
  ctx.lineTo(170, 226);
  ctx.lineTo(198, 214);
  ctx.stroke();
  ctx.restore();

  return c;
}

function flagTexture() {
  const { c, ctx } = canvas(256);
  ctx.clearRect(0, 0, 256, 256);

  // base hologram ring
  ctx.save();
  ctx.strokeStyle = 'rgba(35,244,255,0.7)';
  ctx.shadowColor = '#23f4ff';
  ctx.shadowBlur = 16;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(128, 216, 52, 14, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // pole
  glowLine(ctx, [[88, 58], [88, 214]], 'rgba(35,244,255,0.9)', 6, 16);

  // pennant
  ctx.save();
  const grad = ctx.createLinearGradient(94, 50, 208, 122);
  grad.addColorStop(0, 'rgba(255,43,214,0.92)');
  grad.addColorStop(1, 'rgba(255,43,214,0.12)');
  ctx.fillStyle = grad;
  ctx.shadowColor = '#ff2bd6';
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.moveTo(96, 48);
  ctx.lineTo(210, 84);
  ctx.lineTo(100, 126);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(35,244,255,0.95)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();

  // holo stripes
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#23f4ff';
  ctx.lineWidth = 2;
  for (let y = 62; y < 122; y += 12) {
    ctx.beginPath();
    ctx.moveTo(100, y);
    ctx.lineTo(190 - (y - 62) * 0.5, y + 12);
    ctx.stroke();
  }
  ctx.restore();

  // floating particles
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  [[218, 60, 2], [60, 180, 1.5], [214, 150, 1.2], [160, 36, 1.4]].forEach(([x, y, r]) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  });

  return c;
}

function wrongTexture() {
  const { c, ctx } = canvas(256);
  ctx.clearRect(0, 0, 256, 256);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,49,88,0.95)';
  ctx.shadowColor = '#ff3158';
  ctx.shadowBlur = 22;
  ctx.lineWidth = 17;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(70, 70);
  ctx.lineTo(186, 186);
  ctx.moveTo(186, 70);
  ctx.lineTo(70, 186);
  ctx.stroke();

  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(48, 92);
  ctx.lineTo(208, 92);
  ctx.moveTo(48, 164);
  ctx.lineTo(208, 164);
  ctx.stroke();
  ctx.restore();

  return c;
}

function targetTexture() {
  const { c, ctx } = canvas(256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 15;
  ctx.lineWidth = 5;
  const pad = 26;
  const len = 54;
  [
    [pad, pad, 1, 1], [256 - pad, pad, -1, 1],
    [pad, 256 - pad, 1, -1], [256 - pad, 256 - pad, -1, -1],
  ].forEach(([x, y, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(x + sx * len, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * len);
    ctx.stroke();
  });
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(128, 128, 20, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(128, 128, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return c;
}

function glowTexture() {
  const { c, ctx } = canvas(128);
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.16, 'rgba(255,255,255,0.72)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return c;
}

function scanTexture() {
  const { c, ctx } = canvas(64, 512);
  ctx.clearRect(0, 0, 64, 512);
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.06)');
  grad.addColorStop(0.49, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.5, 'rgba(255,255,255,1)');
  grad.addColorStop(0.515, 'rgba(255,255,255,0.4)');
  grad.addColorStop(0.56, 'rgba(255,255,255,0.02)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 512);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  for (let y = 24; y < 500; y += 32) ctx.fillRect(0, y, 64, 1);
  return c;
}

function gridTexture() {
  const { c, ctx } = canvas(256);
  ctx.fillStyle = '#04070f';
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = 'rgba(150,238,255,0.26)';
  ctx.shadowColor = 'rgba(80,220,255,0.6)';
  ctx.shadowBlur = 6;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 254, 254);

  ctx.strokeStyle = 'rgba(150,238,255,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.moveTo(0, 128);
  ctx.lineTo(256, 128);
  ctx.stroke();

  ctx.fillStyle = 'rgba(150,238,255,0.4)';
  [[0, 0], [256, 0], [0, 256], [256, 256]].forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // diagonal hatch
  ctx.strokeStyle = 'rgba(150,238,255,0.035)';
  for (let x = -256; x < 512; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 256, 256);
    ctx.stroke();
  }

  return c;
}

function windowTexture() {
  const { c, ctx } = canvas(256, 512);
  ctx.fillStyle = '#03060d';
  ctx.fillRect(0, 0, 256, 512);

  const cols = 9;
  const rows = 25;
  const padX = 18;
  const padY = 14;
  const cellW = (256 - padX * 2) / cols;
  const cellH = (512 - padY * 2) / rows;

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = padX + col * cellW + 3;
      const y = padY + r * cellH + 4;
      const w = cellW - 7;
      const h = cellH - 9;
      const luck = Math.random();
      if (luck < 0.13) {
        ctx.fillStyle = `rgba(180,245,255,${0.5 + Math.random() * 0.5})`;
        ctx.shadowColor = '#9ef6ff';
        ctx.shadowBlur = 7;
      } else if (luck < 0.2) {
        ctx.fillStyle = `rgba(255,120,230,${0.4 + Math.random() * 0.4})`;
        ctx.shadowColor = '#ff54d8';
        ctx.shadowBlur = 6;
      } else if (luck < 0.24) {
        ctx.fillStyle = `rgba(255,210,100,${0.35 + Math.random() * 0.4})`;
        ctx.shadowColor = '#ffd45e';
        ctx.shadowBlur = 5;
      } else {
        ctx.fillStyle = 'rgba(22,45,62,0.6)';
        ctx.shadowBlur = 0;
      }
      ctx.fillRect(x, y, w, h);
    }
  }

  // structural columns
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(5,9,16,0.95)';
  [10, 246].forEach((x) => ctx.fillRect(x, 0, 8, 512));

  // neon bands
  ctx.fillStyle = 'rgba(35,244,255,0.75)';
  ctx.shadowColor = '#23f4ff';
  ctx.shadowBlur = 15;
  ctx.fillRect(0, 66, 256, 3);
  ctx.fillStyle = 'rgba(255,43,214,0.55)';
  ctx.shadowColor = '#ff2bd6';
  ctx.fillRect(0, 360, 256, 2);

  return c;
}

function signTexture(text, color) {
  const { c, ctx } = canvas(512, 160);
  ctx.clearRect(0, 0, 512, 160);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(18, 18);
  ctx.lineTo(494, 18);
  ctx.lineTo(494, 142);
  ctx.lineTo(18, 142);
  ctx.closePath();
  ctx.stroke();

  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(32, 32);
  ctx.lineTo(480, 32);
  ctx.moveTo(32, 128);
  ctx.lineTo(480, 128);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.font = '700 58px Orbitron, "Rajdhani", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 28;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 84);
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = '#fff';
  ctx.shadowBlur = 10;
  ctx.fillText(text, 256, 84);
  ctx.restore();

  // broken scanlines
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  for (let y = 44; y < 126; y += 10) ctx.fillRect(24, y, 464, 2);
  ctx.restore();

  return c;
}

export function makeTexture(canvasEl, renderer, { repeat = null, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(canvasEl);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.needsUpdate = true;
  return tex;
}

export function buildTextures(renderer) {
  const numbers = {};
  const colors = ['', '#38f6ff', '#ff3bd4', '#ffe14d', '#72ff89', '#ff9d3d', '#b46bff', '#ff5c7a', '#f4f8ff'];
  for (let i = 1; i <= 8; i++) {
    numbers[i] = makeTexture(numberTexture(i, colors[i]), renderer);
  }
  return {
    hidden: makeTexture(hiddenTexture(), renderer),
    revealed: makeTexture(revealedTexture(), renderer),
    numbers,
    flag: makeTexture(flagTexture(), renderer),
    wrong: makeTexture(wrongTexture(), renderer),
    target: makeTexture(targetTexture(), renderer),
    glow: makeTexture(glowTexture(), renderer),
    scan: makeTexture(scanTexture(), renderer),
    grid: makeTexture(gridTexture(), renderer, { repeat: [1, 1] }),
    windows: makeTexture(windowTexture(), renderer),
    sign: (text, color) => makeTexture(signTexture(text, color), renderer),
  };
}

export { canvas, roundRect, glowLine };
