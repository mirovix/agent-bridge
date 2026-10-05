// Sine Glide — a tiny "bit" slides over the hills of a sine wave.
// Hold on the way down to gain speed, let go on the way up to take off.
(function () {
  const { ui } = HD;
  const W = 640;
  const H = 360;
  const R = 10; // character radius
  const SX = 170; // character position on screen

  const G_GLIDE = 700;
  const G_DIVE = 2400;
  const MAX_SPEED = 1300;

  // Per-level parameters: [Junior, Senior, 10x Dev]
  // perfect = how well the landing must line up with the slope (1 = exactly)
  // hills = how fast the hills grow; bugs = chance of red bugs on the hilltops
  const LEVELS = [
    { time: 55, bonus: 3, perfect: 0.86, minVx: 110, hills: 1, bugs: 0 },
    { time: 40, bonus: 2, perfect: 0.9, minVx: 90, hills: 1, bugs: 0 },
    { time: 32, bonus: 1.5, perfect: 0.93, minVx: 75, hills: 1.3, bugs: 0.35 }
  ];
  let L = LEVELS[1];
  let START_TIME = L.time, BONUS = L.bonus, MIN_VX = L.minVx;

  const STRIPES = ['#c586c0', '#569cd6', '#4ec9b0', '#dcdcaa', '#ce9178'];

  let state, b, pts, camY, time, holding, overAt, record, trail, popups, air, lastHigh, bugs;

  const stars = [];
  for (let i = 0; i < 50; i++) stars.push({ x: Math.random() * W, y: Math.random() * 200, r: Math.random() * 1.2 + 0.3 });

  function reset() {
    L = HD.pick(LEVELS);
    START_TIME = L.time;
    BONUS = L.bonus;
    MIN_VX = L.minVx;
    bugs = [];
    state = 'ready';
    b = { x: 60, y: 200, vx: 180, vy: 0, ground: false };
    pts = [{ x: -200, y: 240 }, { x: 60, y: 240 }];
    lastHigh = false;
    camY = 0;
    time = START_TIME;
    overAt = 0;
    record = false;
    trail = [];
    popups = [];
    air = 0;
    extend();
    b.y = height(b.x) - R;
  }

  const score = () => Math.max(0, Math.floor((b.x - 60) / 25));

  // ---------- Terrain: high and low points joined by cosine curves ----------

  function extend() {
    while (pts[pts.length - 1].x < b.x + W * 2) {
      const last = pts[pts.length - 1];
      const k = Math.min(1.3, (last.x / 20000) * L.hills); // hills grow with distance
      lastHigh = !lastHigh;
      const dx = 420 + Math.random() * 180 + k * 220;
      const y = lastHigh ? 190 - Math.random() * 40 - k * 60 : 290 + Math.random() * 30 + k * 20;
      pts.push({ x: last.x + dx, y });
      // 10x Dev: a red bug on some hilltops, to fly over (touching it costs time).
      if (lastHigh && last.x > 1500 && Math.random() < L.bugs) bugs.push({ x: last.x + dx, hit: false });
    }
    while (bugs.length && bugs[0].x < b.x - W) bugs.shift();
    while (pts.length > 3 && pts[1].x < b.x - W) pts.shift();
  }

  function segment(x) {
    for (let i = 0; i < pts.length - 1; i++) {
      if (x < pts[i + 1].x) return i;
    }
    return pts.length - 2;
  }

  function height(x) {
    const i = segment(x);
    const a = pts[i], c = pts[i + 1];
    const t = Math.max(0, Math.min(1, (x - a.x) / (c.x - a.x)));
    return a.y + (c.y - a.y) * (1 - Math.cos(Math.PI * t)) / 2;
  }

  function slope(x) {
    const i = segment(x);
    const a = pts[i], c = pts[i + 1];
    const t = Math.max(0, Math.min(1, (x - a.x) / (c.x - a.x)));
    return (c.y - a.y) * Math.PI * Math.sin(Math.PI * t) / (2 * (c.x - a.x));
  }

  // ---------- Logic ----------

  function press() {
    holding = true;
    if (state === 'ready') state = 'play';
    else if (state === 'over' && performance.now() - overAt > 450) reset();
  }

  function update(dt) {
    for (const q of popups) { q.y -= 30 * dt; q.life -= dt; }
    popups = popups.filter(q => q.life > 0);
    if (state !== 'play') return;

    time -= dt;
    if (time <= 0) {
      time = 0;
      state = 'over';
      overAt = performance.now();
      holding = false;
      record = HD.submitScore('wings', score());
      return;
    }

    // Free integration; if we end up below the ground, "stick" to the slope.
    const g = holding ? G_DIVE : G_GLIDE;
    b.vy += g * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    const floor = height(b.x) - R;
    if (b.y >= floor) {
      const s = slope(b.x);
      const n = Math.sqrt(1 + s * s);
      const tx = 1 / n, ty = s / n;
      const v = Math.hypot(b.vx, b.vy);
      let dot = b.vx * tx + b.vy * ty;
      if (!b.ground && air > 0.45 && v > 0) {
        // Landing: if the trajectory follows the downhill slope it's "perfect".
        if (dot / v > L.perfect && ty > 0.1) {
          time += BONUS;
          popups.push({ text: `Perfect! +${BONUS}s`, x: SX, y: b.y - camY - 24, life: 1, c: '#ffd43b' });
          dot *= 1.08;
        } else if (dot / v < 0.6) {
          popups.push({ text: 'Ouch!', x: SX, y: b.y - camY - 24, life: 0.7, c: '#f48771' });
        }
      }
      b.y = floor;
      b.vx = dot * tx;
      b.vy = dot * ty;
      b.ground = true;
      air = 0;
    } else {
      b.ground = false;
      air += dt;
    }

    if (b.vx < MIN_VX) {
      b.vx = MIN_VX;
      if (b.ground) b.vy = MIN_VX * slope(b.x);
    }
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_SPEED) { b.vx *= MAX_SPEED / sp; b.vy *= MAX_SPEED / sp; }

    // The camera rises to follow high flights.
    const targetCam = Math.min(0, b.y - 70);
    camY += (targetCam - camY) * Math.min(1, dt * 6);

    for (const g of bugs) {
      if (!g.hit && Math.abs(g.x - b.x) < 16 && Math.abs(height(g.x) - 12 - b.y) < 20) {
        g.hit = true;
        time = Math.max(0, time - 3);
        b.vx *= 0.6;
        b.vy *= 0.6;
        popups.push({ text: 'Bug! -3s', x: SX, y: b.y - camY - 24, life: 1, c: '#f14c4c' });
      }
    }

    trail.push({ x: b.x, y: b.y });
    if (trail.length > 40) trail.shift();
    extend();
  }

  // ---------- Drawing ----------

  function draw(ctx) {
    const camX = b.x - SX;
    const dusk = 1 - time / START_TIME; // the sky darkens as the deadline approaches

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, mix('#233b6e', '#0b0d18', dusk));
    sky.addColorStop(1, mix('#6b4a8a', '#1b1430', dusk));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.15 + dusk * 0.5;
    for (const s of stars) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // The "deadline sun" sets as time runs out.
    const sunY = 60 + Math.min(1, dusk) * 260 - camY * 0.2;
    ctx.fillStyle = mix('#ffd43b', '#f14c4c', dusk);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(W - 90, sunY, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Distant hills (parallax)
    ctx.fillStyle = 'rgba(20, 24, 42, 0.6)';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const wx = x + camX * 0.25;
      ctx.lineTo(x, 230 - camY * 0.3 + Math.sin(wx / 90) * 22 + Math.sin(wx / 37) * 8);
    }
    ctx.lineTo(W, H);
    ctx.fill();

    drawTerrain(ctx, camX);

    for (const g of bugs) {
      const gx = g.x - camX, gy = height(g.x) - camY;
      if (gx < -20 || gx > W + 20) continue;
      ctx.fillStyle = g.hit ? '#5a2a2a' : '#f14c4c';
      ctx.beginPath();
      ctx.moveTo(gx - 11, gy);
      ctx.lineTo(gx, gy - 22);
      ctx.lineTo(gx + 11, gy);
      ctx.fill();
    }

    // Trail
    if (trail.length > 1) {
      ctx.lineCap = 'round';
      for (let i = 1; i < trail.length; i++) {
        ctx.strokeStyle = `rgba(197, 134, 192, ${(i / trail.length) * 0.5})`;
        ctx.lineWidth = (i / trail.length) * 8;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x - camX, trail[i - 1].y - camY);
        ctx.lineTo(trail[i].x - camX, trail[i].y - camY);
        ctx.stroke();
      }
    }

    const ang = Math.atan2(b.vy, b.vx);
    drawBit(ctx, SX, b.y - camY, ang, holding && state === 'play', b.ground);

    for (const q of popups) {
      ctx.globalAlpha = Math.min(1, q.life * 2);
      ctx.fillStyle = q.c;
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(q.text, q.x, q.y);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;

    drawHud(ctx);
  }

  // The hills are a curve with "highlighted" stripes that follow its profile.
  function drawTerrain(ctx, camX) {
    const surf = [];
    for (let x = -4; x <= W + 4; x += 4) surf.push(height(x + camX) - camY);

    ctx.fillStyle = '#1e1e2e';
    ctx.beginPath();
    ctx.moveTo(-4, H);
    surf.forEach((y, i) => ctx.lineTo(i * 4 - 4, y));
    ctx.lineTo(W + 4, H);
    ctx.fill();

    ctx.save();
    ctx.clip();
    STRIPES.forEach((c, k) => {
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 7;
      ctx.beginPath();
      surf.forEach((y, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, i * 4 - 4, y + 16 + k * 18));
      ctx.stroke();
    });
    ctx.restore();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#e8e8f0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    surf.forEach((y, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, i * 4 - 4, y));
    ctx.stroke();
  }

  // The "bit": purple ball with an eye and a small wing; it tucks in when diving.
  function drawBit(ctx, x, y, ang, diving, grounded) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const sq = diving ? 0.85 : 1;
    ctx.scale(1 / sq, sq);
    ctx.fillStyle = '#c586c0';
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e3b6df';
    ctx.beginPath();
    ctx.arc(-2, 3, R * 0.55, 0, Math.PI * 2);
    ctx.fill();
    if (!diving) {
      const flap = grounded ? 0 : Math.sin(performance.now() / 60) * 4;
      ctx.fillStyle = '#9a5b95';
      ctx.beginPath();
      ctx.ellipse(-3, -2 - flap, 7, 3.5, -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(4, -3, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1e1e2e';
    ctx.beginPath();
    ctx.arc(5, -3, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8c1a';
    ctx.beginPath();
    ctx.moveTo(R - 1, -1);
    ctx.lineTo(R + 5, 1);
    ctx.lineTo(R - 1, 3);
    ctx.fill();
    ctx.restore();
  }

  function drawHud(ctx) {
    if (state === 'play') {
      ui.bigScore(ctx, `${score()} m`, 20, 50, 'left');
      // Deadline bar
      const w = 200, x = (W - w) / 2, frac = Math.min(1, time / START_TIME);
      ctx.fillStyle = 'rgba(17, 19, 26, 0.7)';
      ctx.fillRect(x - 2, 18, w + 4, 16);
      ctx.fillStyle = time < 8 ? '#f14c4c' : '#dcdcaa';
      ctx.fillRect(x, 20, w * frac, 12);
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`deadline ${Math.ceil(time)}s`, W / 2, 50);
      ctx.textAlign = 'left';
    }

    if (state === 'ready') {
      ui.card(ctx, W / 2 - 250, 60, 500, 170);
      ctx.textAlign = 'center';
      ctx.font = 'bold 34px monospace';
      ctx.fillStyle = '#c586c0';
      ctx.fillText('Sine Glide', W / 2, 100);
      ui.levelTag(ctx, W / 2, 122);
      ctx.font = '14px monospace';
      ctx.fillStyle = '#d4d4d4';
      ctx.fillText('HOLD on the way down to speed up,', W / 2, 146);
      ctx.fillText('LET GO on the way up to take off.', W / 2, 164);
      ctx.fillText(L.bugs ? `Land on a downslope: +${BONUS}s · avoid the ▲ bugs on top` : `Land along the downslope: +${BONUS}s to the deadline!`, W / 2, 188);
      ctx.fillStyle = '#9cdcfe';
      const best = HD.best('wings');
      ctx.fillText(`SPACE / click to start${best ? `  ·  Best: ${best} m` : ''}`, W / 2, 212);
      ctx.textAlign = 'left';
    }

    if (state === 'over') {
      ui.overCard(ctx, W, H, {
        title: 'Deadline!', color: '#dcdcaa', score: score(), best: HD.best('wings'), record, unit: ' m'
      });
    }
  }

  function mix(a, c, t) {
    t = Math.max(0, Math.min(1, t));
    const pa = parseInt(a.slice(1), 16), pc = parseInt(c.slice(1), 16);
    const ch = s => Math.round(((pa >> s) & 255) * (1 - t) + ((pc >> s) & 255) * t);
    return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
  }

  HD.register({
    id: 'wings',
    name: 'Sine Glide',
    tagline: 'Glide over the hills ∿',
    color: '#c586c0',
    unit: ' m',
    W, H,
    reset,
    update,
    draw,
    press,
    release() { holding = false; },
    playing: () => state === 'play',
    icon(ctx, x, y) {
      ctx.strokeStyle = '#e8e8f0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = -28; i <= 28; i += 2) (i === -28 ? ctx.moveTo : ctx.lineTo).call(ctx, x + i, y + 16 + Math.sin(i / 9) * 8);
      ctx.stroke();
      drawBit(ctx, x - 4, y - 6, -0.4, false, true);
    }
  });

  reset();
})();
