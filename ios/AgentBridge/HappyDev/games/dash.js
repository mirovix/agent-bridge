// Deploy Dash — the terminal cube runs through a CI/CD pipeline.
// Stages: lint → test → build → deploy, each adding new mechanics:
// jump pads (npm i), debug orbs to hit mid-air, saws (race conditions),
// low corridors and "sudo" portals that flip gravity.
(function () {
  const { ui } = HD;
  const W = 640;
  const H = 360;
  const CEIL = 44; // below the title bar
  const GROUND = 316; // above the status bar
  const S = 30; // cube size
  const T = 30; // grid unit
  const PX = 150; // cube position on screen

  const GRAVITY = 2800;
  const JUMP = 860;
  const PAD = 1150;
  const ORB = 900;
  const MAX_V = 1100;

  const STAGES = [
    { name: 'lint', color: '#569cd6' },
    { name: 'test', color: '#4ec9b0' },
    { name: 'build', color: '#c586c0' },
    { name: 'deploy', color: '#ce9178' }
  ];
  const ERRORS = [
    'TypeError: undefined is not a function',
    'Segmentation fault (core dumped)',
    'NullPointerException at line 42',
    "SyntaxError: Unexpected token '}'",
    'npm ERR! code ELIFECYCLE',
    'error: failed to push some refs',
    'FATAL: out of memory',
    'Error: ENOENT: no such file',
    'panic: runtime error: index out of range',
    'exit code 137 (OOMKilled)'
  ];

  // Per-level parameters: [Junior, Senior, 10x Dev]
  // gap/gapRand are seconds of running between one track chunk and the next.
  const LEVELS = [
    { speed: 280, ramp: 10, gap: 0.8, gapRand: 0.4, perStage: 10, maxSpikes: 2 },
    { speed: 330, ramp: 14, gap: 0.62, gapRand: 0.35, perStage: 8, maxSpikes: 3 },
    { speed: 390, ramp: 16, gap: 0.5, gapRand: 0.25, perStage: 6, maxSpikes: 3 }
  ];

  // ---------- Simulation (no drawing: also used by the tests) ----------

  function newWorld(lv, rand = Math.random) {
    const w = {
      lv, rand, x: 0, obs: [], dead: false, cause: '',
      p: { y: GROUND - S, vy: 0, g: 1, ground: true },
      genX: 640, genG: 1, chunks: 0, stageAt: [0]
    };
    return w;
  }

  const stageIndex = (w, x) => {
    let i = 0;
    while (i + 1 < w.stageAt.length && w.stageAt[i + 1] <= x) i++;
    return i;
  };
  const speedAt = (w, x) => w.lv.speed + Math.min(stageIndex(w, x), 6) * w.lv.ramp;

  // "Local" coordinates: h = height above the surface you run on (floor or ceiling).
  function placer(w, x0) {
    const g = w.genG;
    const wy = h => (g > 0 ? GROUND - h : CEIL + h);
    return {
      block(x, wd, h0, h1) {
        const lines = [];
        for (let i = 0; i < 12; i++) lines.push({ w: 8 + w.rand() * Math.max(10, wd - 34), c: ui.pick(ui.PALETTE), ind: (w.rand() * 3) | 0 });
        w.obs.push({ k: 'block', x: x0 + x, w: wd, y: g > 0 ? GROUND - h1 : CEIL + h0, h: h1 - h0, lines });
      },
      spike(x, h = 0) { w.obs.push({ k: 'spike', x: x0 + x, w: T, y: wy(h), dir: -g }); },
      saw(x, h, r) { w.obs.push({ k: 'saw', x: x0 + x, y: wy(h), r }); },
      pad(x, h = 0) { w.obs.push({ k: 'pad', x: x0 + x, w: T, y: wy(h), dir: -g, used: false }); },
      orb(x, h) { w.obs.push({ k: 'orb', x: x0 + x, y: wy(h), r: 13, used: false }); },
      portal(x) { w.obs.push({ k: 'portal', x: x0 + x, grav: -g, used: false }); w.genG = -g; }
    };
  }

  const r = (w, n) => (w.rand() * n) | 0;

  // Each track chunk returns its own width.
  const CHUNKS = {
    spikes(w, P) {
      const n = 1 + r(w, w.lv.maxSpikes);
      for (let i = 0; i < n; i++) P.spike(i * T);
      return n * T;
    },
    step(w, P) {
      const wd = (3 + r(w, 3)) * T;
      const h = w.rand() < 0.5 ? T : 2 * T;
      P.block(0, wd, 0, h);
      if (wd >= 5 * T && w.rand() < 0.5) P.spike(Math.floor(wd / T / 2) * T, h);
      let extra = 0;
      if (w.rand() < 0.6) {
        const n = 1 + r(w, Math.min(2, w.lv.maxSpikes));
        for (let i = 0; i < n; i++) P.spike(wd + i * T);
        extra = n * T;
      }
      return wd + extra;
    },
    stairs(w, P) {
      P.block(0, 2 * T, 0, T);
      P.block(2 * T, 2 * T, 0, 2 * T);
      P.block(4 * T, 3 * T, 0, 3 * T);
      P.spike(7 * T);
      P.spike(8 * T);
      return 9 * T;
    },
    saws(w, P) {
      const n = 1 + r(w, 2);
      for (let i = 0; i < n; i++) P.saw(i * 5 * T + 26, 0, 26);
      return (n - 1) * 5 * T + 52;
    },
    pad(w, P) {
      P.pad(0);
      P.block(3 * T, T, 0, 4 * T);
      P.spike(3 * T, 4 * T);
      return 4 * T + 0.45 * speedAt(w, w.genX); // the super jump lands far away
    },
    platforms(w, P) {
      const n = 8;
      for (let i = 0; i < n; i++) P.spike(i * T);
      P.block(2 * T, 3 * T, 2 * T, 2 * T + 12);
      return n * T;
    },
    orbs(w, P) {
      const n = 7 + r(w, 3);
      for (let i = 0; i < n; i++) P.spike(i * T);
      P.orb(Math.round(n / 2) * T, 70);
      return n * T + 0.3 * speedAt(w, w.genX);
    },
    corridor(w, P) {
      // The entrance is far enough to land after jumping the first bug.
      const start = Math.max(6, Math.ceil((0.6 * speedAt(w, w.genX) + T) / T)) * T;
      P.spike(0);
      P.block(start, 5 * T, 100, 272);
      P.spike(start + 6 * T);
      return start + 7 * T + 0.35 * speedAt(w, w.genX); // you leave with a jump: leave room to land
    },
    flip(w, P) {
      P.portal(T);
      return 7 * T;
    }
  };

  // Which chunks appear in each pipeline stage (with their weights).
  const POOLS = [
    { spikes: 3, step: 2 },
    { spikes: 2, step: 2, stairs: 1, saws: 1, pad: 1 },
    { spikes: 1, step: 1, stairs: 1, saws: 1, pad: 1, platforms: 1, orbs: 1, corridor: 1 },
    { spikes: 1, step: 1, stairs: 1, saws: 1, pad: 1, platforms: 1, orbs: 1, corridor: 1, flip: 2 }
  ];

  function generate(w, untilX) {
    while (w.genX < untilX) {
      const stage = Math.floor(w.chunks / w.lv.perStage);
      if (stage >= w.stageAt.length) w.stageAt.push(w.genX);
      const pool = POOLS[Math.min(stage, POOLS.length - 1)];
      let name = pickWeighted(w, pool);
      // Always return to normal gravity before the stage changes.
      const lastOfStage = (w.chunks + 1) % w.lv.perStage === 0;
      if (lastOfStage && w.genG < 0) name = 'flip';
      else if (lastOfStage && name === 'flip') name = 'spikes';
      w.chunks++;
      const width = CHUNKS[name](w, placer(w, w.genX));
      w.genX += width + (w.lv.gap + w.rand() * w.lv.gapRand) * speedAt(w, w.genX);
    }
    w.obs.sort((a, b) => a.x - b.x);
  }

  function pickWeighted(w, pool) {
    const names = Object.keys(pool);
    let t = w.rand() * names.reduce((s, n) => s + pool[n], 0);
    for (const n of names) {
      t -= pool[n];
      if (t < 0) return n;
    }
    return names[0];
  }

  // One physics step. Returns events the renderer cares about.
  function step(w, dt, holding) {
    const p = w.p;
    const ev = {};
    const prevY = p.y;

    if (holding && p.ground) {
      p.vy = -p.g * JUMP;
      p.ground = false;
      ev.jump = true;
    }
    p.vy = Math.max(-MAX_V, Math.min(MAX_V, p.vy + p.g * GRAVITY * dt));
    p.y += p.vy * dt;
    w.x += speedAt(w, w.x) * dt;

    let ground = false;
    if (p.y + S >= GROUND) {
      p.y = GROUND - S;
      if (p.g > 0) ground = true;
      p.vy = 0;
    }
    if (p.y <= CEIL) {
      p.y = CEIL;
      if (p.g < 0) ground = true;
      p.vy = 0;
    }

    const x1 = w.x + PX, x2 = x1 + S;
    for (const o of w.obs) {
      if (o.x > x2 + 40) break;
      switch (o.k) {
        case 'block': {
          if (o.x >= x2 - 1 || o.x + o.w <= x1 + 1 || p.y + S <= o.y || p.y >= o.y + o.h) break;
          if (p.g > 0 && prevY + S <= o.y + 10 && p.vy >= 0) {
            p.y = o.y - S; p.vy = 0; ground = true;
          } else if (p.g < 0 && prevY >= o.y + o.h - 10 && p.vy <= 0) {
            p.y = o.y + o.h; p.vy = 0; ground = true;
          } else {
            return die(w, 'block');
          }
          break;
        }
        case 'spike': {
          const top = o.dir < 0 ? o.y - 18 : o.y;
          if (x2 - 4 > o.x + 9 && x1 + 4 < o.x + o.w - 9 && p.y + S - 3 > top && p.y + 3 < top + 18) return die(w, 'spike');
          break;
        }
        case 'saw': {
          const nx = Math.max(x1 + 3, Math.min(o.x, x2 - 3));
          const ny = Math.max(p.y + 3, Math.min(o.y, p.y + S - 3));
          if ((o.x - nx) ** 2 + (o.y - ny) ** 2 < (o.r * 0.85) ** 2) return die(w, 'saw');
          break;
        }
        case 'pad': {
          if (!o.used && x2 > o.x + 4 && x1 < o.x + o.w - 4 && Math.abs((o.dir < 0 ? p.y + S : p.y) - o.y) < 12) {
            o.used = true;
            p.vy = o.dir * PAD;
            ground = false;
            ev.pad = o;
          }
          break;
        }
        case 'orb': {
          const cx = x1 + S / 2, cy = p.y + S / 2;
          if (!o.used && holding && (cx - o.x) ** 2 + (cy - o.y) ** 2 < (o.r + 18) ** 2) {
            o.used = true;
            p.vy = -p.g * ORB;
            ground = false;
            ev.orb = o;
          }
          break;
        }
        case 'portal': {
          if (!o.used && x1 + S / 2 >= o.x) {
            o.used = true;
            p.g = o.grav;
            p.vy *= 0.4;
            ground = false;
            ev.portal = o;
          }
          break;
        }
      }
    }
    p.ground = ground;
    return ev;
  }

  function die(w, cause) {
    w.dead = true;
    w.cause = cause;
    return { dead: true };
  }

  function prune(w) {
    let i = 0;
    while (i < w.obs.length && w.obs[i].x + (w.obs[i].w || w.obs[i].r || 0) < w.x - 80) i++;
    if (i) w.obs.splice(0, i);
  }

  // ---------- Game state and effects ----------

  let state, world, holding, overAt, record, particles, flash, shake, rot, trail;
  let attempts = 0, banner, errorMsg, beat = 0, stageShown, stageColor;

  function reset() {
    state = 'ready';
    world = newWorld(LEVELS[HD.level()]);
    generate(world, W * 2);
    overAt = 0;
    record = false;
    particles = [];
    flash = 0;
    shake = 0;
    rot = 0;
    trail = [];
    banner = null;
    stageShown = 0;
    stageColor = STAGES[0].color;
    attempts++;
  }

  const score = () => Math.floor(world.x / T);

  function press() {
    holding = true;
    if (state === 'ready') state = 'play';
    else if (state === 'over' && performance.now() - overAt > 500) reset();
  }

  function update(dt) {
    beat += dt;
    if (flash > 0) flash -= dt;
    if (shake > 0) shake -= dt;
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    updateParticles(dt);
    if (state !== 'play') return;

    const p = world.p;
    const ev = step(world, dt, holding);
    if (ev.dead) return crash();
    if (ev.pad) burst(PX + S / 2, ev.pad.y, '#ffd43b', 10);
    if (ev.orb) burst(ev.orb.x - world.x, ev.orb.y, '#ffd43b', 12);
    if (ev.portal) { burst(PX + S / 2, p.y + S / 2, '#c586c0', 16); flash = 0.06; }

    // Spin in the air, then snap to the nearest side.
    if (!p.ground) rot += p.g * 5.4 * dt;
    else {
      const target = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
      rot += (target - rot) * Math.min(1, dt * 20);
      if (Math.random() < 0.6) {
        const sy = p.g > 0 ? p.y + S - 2 : p.y + 2;
        particles.push({ x: world.x + PX, y: sy, vx: -80 - Math.random() * 80, vy: -p.g * Math.random() * 70, life: 0.35, max: 0.35, c: currentStage().color, s: 4 });
      }
    }
    trail.push({ x: world.x + PX + S / 2, y: p.y + S / 2, rot });
    if (trail.length > 7) trail.shift();

    const si = stageIndex(world, world.x + PX);
    if (si !== stageShown) {
      const prev = stageLabel(stageShown), next = stageLabel(si);
      banner = { text: `✓ ${prev} passed`, sub: `→ ${next}`, t: 2 };
      stageShown = si;
    }
    stageColor = currentStage().color;

    generate(world, world.x + W * 2);
    prune(world);
  }

  const currentStage = () => STAGES[stageShown % STAGES.length];
  const stageLabel = i => STAGES[i % STAGES.length].name + (i >= STAGES.length ? ` v${Math.floor(i / STAGES.length) + 1}` : '');

  function crash() {
    state = 'over';
    overAt = performance.now();
    flash = 0.15;
    shake = 0.35;
    holding = false;
    errorMsg = ui.pick(ERRORS);
    burst(PX + S / 2, world.p.y + S / 2, null, 30);
    record = HD.submitScore('dash', score());
  }

  function burst(sx, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 260;
      particles.push({
        x: world.x + sx, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.8, max: 0.8,
        c: color || ui.pick(['#4ec9b0', '#9cdcfe', '#ffffff', '#f14c4c']), s: 3 + Math.random() * 4
      });
    }
  }

  function updateParticles(dt) {
    for (const q of particles) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy += 500 * dt;
      q.life -= dt;
    }
    particles = particles.filter(q => q.life > 0);
  }

  // ---------- Drawing ----------

  const bgCode = [];
  for (let i = 0; i < 18; i++) bgCode.push({ x: Math.random() * 1400, y: CEIL + 20 + i * 15, t: ui.pick(ui.SNIPPETS), d: 0.1 + Math.random() * 0.25 });

  function draw(ctx) {
    const pulse = 0.5 + 0.5 * Math.cos(beat * Math.PI * 2 * (128 / 60)); // a "beat" at 128 BPM
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 12 * shake, (Math.random() - 0.5) * 12 * shake);

    // Background
    const sky = ctx.createLinearGradient(0, CEIL, 0, GROUND);
    sky.addColorStop(0, '#0d0f1c');
    sky.addColorStop(1, shade(stageColor, 0.18 + pulse * 0.04));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    ctx.font = '12px monospace';
    for (const c of bgCode) {
      ctx.fillStyle = `rgba(156, 220, 254, ${0.05 + c.d * 0.12})`;
      const x = ((c.x - world.x * c.d) % 1400 + 1400) % 1400 - 200;
      ctx.fillText(c.t, x, c.y);
    }

    // Grid
    ctx.strokeStyle = hexA(stageColor, 0.07 + pulse * 0.05);
    ctx.lineWidth = 1;
    const off = (world.x * 0.5) % T;
    ctx.beginPath();
    for (let x = -off; x < W; x += T) { ctx.moveTo(x, CEIL); ctx.lineTo(x, GROUND); }
    for (let y = GROUND; y > CEIL; y -= T) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    ctx.save();
    ctx.translate(-world.x, 0);
    for (const o of world.obs) {
      if (o.x > world.x + W + 60) break;
      DRAW[o.k](ctx, o);
    }
    for (const q of particles) {
      ctx.globalAlpha = Math.max(0, q.life / q.max);
      ctx.fillStyle = q.c;
      ctx.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s);
    }
    ctx.globalAlpha = 1;
    if (state === 'ready' || world.x < 400) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = 'bold 22px monospace';
      ctx.fillText(`ATTEMPT ${attempts}`, 260, 290);
    }
    ctx.restore();

    // Floor and ceiling lines pulse with the beat
    ctx.fillStyle = stageColor;
    ctx.globalAlpha = 0.6 + pulse * 0.4;
    ctx.fillRect(0, GROUND - 2, W, 2);
    ctx.fillRect(0, CEIL, W, 2);
    ctx.globalAlpha = 1;

    drawTopBar(ctx);
    ui.statusBar(ctx, GROUND, W, H, world.x, `⎇ release   ▶ ${stageLabel(stageShown)}`, `${score()} m`);

    if (state !== 'over') {
      trail.forEach((t, i) => {
        ctx.globalAlpha = (i / trail.length) * 0.25;
        drawCube(ctx, t.x - world.x, t.y, t.rot, 1, stageColor);
      });
      ctx.globalAlpha = 1;
      drawCube(ctx, PX + S / 2, world.p.y + S / 2, rot, 1, '#4ec9b0');
    }

    if (banner) {
      const a = Math.min(1, banner.t * 2);
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#4ec9b0';
      ctx.font = 'bold 26px monospace';
      ctx.fillText(banner.text, W / 2, 120);
      ctx.fillStyle = '#d4d4d4';
      ctx.font = '16px monospace';
      ctx.fillText(banner.sub, W / 2, 146);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    drawHud(ctx);
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 4})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // Top bar: file name and pipeline progress.
  function drawTopBar(ctx) {
    ctx.fillStyle = '#181a26';
    ctx.fillRect(0, 0, W, CEIL);
    ctx.fillStyle = '#d4d4d4';
    ctx.font = '12px monospace';
    ctx.fillText('● deploy.yml', 12, 26);
    let x = 140;
    const cycle = Math.floor(stageShown / STAGES.length);
    STAGES.forEach((s, i) => {
      const idx = cycle * STAGES.length + i;
      const done = idx < stageShown, cur = idx === stageShown;
      const label = `${done ? '✓' : cur ? '▶' : '○'} ${s.name}`;
      ctx.fillStyle = done ? '#4ec9b0' : cur ? s.color : '#5a5f70';
      ctx.font = cur ? 'bold 12px monospace' : '12px monospace';
      ctx.fillText(label, x, 26);
      x += ctx.measureText(label).width + 10;
      if (i < STAGES.length - 1) {
        ctx.fillStyle = '#5a5f70';
        ctx.fillText('›', x - 6, 26);
        x += 8;
      }
    });
    ctx.fillStyle = '#9a9fb0';
    ctx.textAlign = 'right';
    ctx.fillText(`${score()} m  ·  best ${HD.best('dash')}`, W - 12, 26);
    ctx.textAlign = 'left';
  }

  function drawCube(ctx, cx, cy, r, k, color) {
    const s = S * k;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(r);
    ctx.fillStyle = color;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.strokeStyle = '#0b0d16';
    ctx.lineWidth = 2;
    ctx.strokeRect(-s / 2 + 1, -s / 2 + 1, s - 2, s - 2);
    ctx.fillStyle = '#0b0d16';
    ctx.fillRect(-s / 2 + 5 * k, -s / 2 + 5 * k, s - 10 * k, s - 10 * k);
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.round(12 * k)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.floor(beat * 2) % 2 ? '>_' : '> ', 0, 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  const DRAW = {
    spike(ctx, o) {
      const tip = o.y + o.dir * 30;
      ctx.fillStyle = 'rgba(241, 76, 76, 0.25)';
      tri(ctx, o.x - 3, o.y, o.x + o.w / 2, tip + o.dir * 4, o.x + o.w + 3);
      ctx.fillStyle = '#f14c4c';
      tri(ctx, o.x, o.y, o.x + o.w / 2, tip, o.x + o.w);
      ctx.fillStyle = '#7a1414';
      tri(ctx, o.x + 8, o.y, o.x + o.w / 2, o.y + o.dir * 16, o.x + o.w - 8);
    },
    block(ctx, o) {
      ctx.fillStyle = '#141624';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(o.x, o.y, o.w, o.h);
      ctx.clip();
      ctx.globalAlpha = 0.6;
      o.lines.forEach((l, i) => {
        const ly = o.y + 7 + i * 9;
        ctx.fillStyle = l.c;
        ctx.fillRect(o.x + 16 + l.ind * 6, ly, l.w, 3);
        ctx.fillStyle = '#3c4257';
        ctx.fillRect(o.x + 4, ly, 6, 3);
      });
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = stageColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
    },
    saw(ctx, o) {
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(beat * 8);
      ctx.fillStyle = '#f14c4c';
      ctx.beginPath();
      const teeth = 12;
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2;
        const rr = i % 2 ? o.r * 0.78 : o.r;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.fill();
      ctx.fillStyle = '#141624';
      ctx.beginPath();
      ctx.arc(0, 0, o.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f14c4c';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('race', 0, 0);
      ctx.restore();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    },
    pad(ctx, o) {
      ctx.fillStyle = o.used ? '#8a7a2a' : '#ffd43b';
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, o.y, o.w / 2, 7, 0, o.dir < 0 ? Math.PI : 0, o.dir < 0 ? 0 : Math.PI);
      ctx.fill();
      ctx.fillStyle = '#ffd43b';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('npm i', o.x + o.w / 2, o.y + (o.dir < 0 ? -12 : 20));
      ctx.textAlign = 'left';
    },
    orb(ctx, o) {
      const pr = o.r + Math.sin(beat * 10) * 2;
      ctx.strokeStyle = o.used ? '#6b6030' : '#ffd43b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(o.x, o.y, pr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = o.used ? '#6b6030' : '#ffd43b';
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      // Debugger "step over" icon
      ctx.fillStyle = '#9a9fb0';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('debug', o.x, o.y - o.r - 6);
      ctx.textAlign = 'left';
    },
    portal(ctx, o) {
      const col = o.grav < 0 ? '#c586c0' : '#4ec9b0';
      ctx.fillStyle = hexA(col, 0.18);
      ctx.fillRect(o.x - 12, CEIL, 24, GROUND - CEIL);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(o.x, (CEIL + GROUND) / 2, 12, (GROUND - CEIL) / 2 - 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('sudo', o.x, (CEIL + GROUND) / 2 - 8);
      ctx.fillText(o.grav < 0 ? '↑↑' : '↓↓', o.x, (CEIL + GROUND) / 2 + 10);
      ctx.textAlign = 'left';
    }
  };

  function tri(ctx, x1, y, xm, ym, x2) {
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(xm, ym);
    ctx.lineTo(x2, y);
    ctx.closePath();
    ctx.fill();
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const c = v => Math.round(v * k + 12 * (1 - k));
    return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
  }

  function drawHud(ctx) {
    if (state === 'ready') {
      ui.card(ctx, W / 2 - 260, 70, 520, 196);
      ctx.textAlign = 'center';
      ctx.font = 'bold 32px monospace';
      ctx.fillStyle = '#4ec9b0';
      ctx.fillText('Deploy Dash', W / 2, 110);
      ui.levelTag(ctx, W / 2, 132);
      ctx.font = '13px monospace';
      ctx.fillStyle = '#d4d4d4';
      ctx.fillText('Ship it to production: lint › test › build › deploy', W / 2, 160);
      ctx.fillStyle = '#9a9fb0';
      ctx.fillText('▲ bugs and ⚙ race conditions = crash  ·  climb the blocks', W / 2, 182);
      ctx.fillText('npm i = super jump  ·  ◎ debug: press mid-air  ·  sudo = flip ↕', W / 2, 202);
      ctx.fillStyle = '#9cdcfe';
      ctx.fillText('SPACE / click: jump (hold to keep jumping)', W / 2, 234);
      const best = HD.best('dash');
      ctx.fillText(best ? `Best: ${best} m  ·  P pause · M menu` : 'P pause · R restart · M menu', W / 2, 254);
      ctx.textAlign = 'left';
    }
    if (state === 'over') {
      ui.overCard(ctx, W, H, {
        title: 'Build Failed!', color: '#f14c4c', score: score(), best: HD.best('dash'), record, unit: ' m',
        subtitle: `✖ ${errorMsg}`
      });
    }
  }

  HD.register({
    id: 'dash',
    name: 'Deploy Dash',
    tagline: 'A CI pipeline obstacle run ▲',
    color: '#4ec9b0',
    unit: ' m',
    W, H,
    reset,
    update,
    draw,
    press,
    release() { holding = false; },
    playing: () => state === 'play',
    icon(ctx, x, y) {
      drawCube(ctx, x - 8, y - 4, 0.25, 1, '#4ec9b0');
      ctx.fillStyle = '#f14c4c';
      tri(ctx, x + 6, y + 24, x + 17, y + 2, x + 28);
    },
    // Access to the simulation for automated tests.
    _sim: { newWorld, generate, step, speedAt, LEVELS, CHUNKS, POOLS, placer, prune, S, T, PX, GROUND, CEIL }
  });

  stageColor = STAGES[0].color;
  reset();
  attempts = 0;
})();
