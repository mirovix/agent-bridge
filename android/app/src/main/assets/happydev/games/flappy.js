// Flappy Code — the debugging rubber duck flies between blocks of code.
(function () {
  const { ui } = HD;
  const W = 360;
  const H = 600;
  const GROUND = 540;

  const GRAVITY = 1500;
  const FLAP = -430;
  const MAX_FALL = 620;
  const PIPE_W = 64;

  // Per-level parameters: [Junior, Senior, 10x Dev]
  // swing = how far the blocks move up and down (10x Dev: always; Senior: after 10 points)
  const LEVELS = [
    { gap: 180, spacing: 235, speed: 135, ramp: 1.5, swing: 0, swingFrom: 0 },
    { gap: 155, spacing: 215, speed: 150, ramp: 2, swing: 35, swingFrom: 10 },
    { gap: 138, spacing: 200, speed: 175, ramp: 2.5, swing: 55, swingFrom: 0 }
  ];
  let L = LEVELS[1];
  let GAP = L.gap;

  let state, duck, pipes, score, speed, overAt, flash, record;
  let groundX = 0;
  let bgX = 0;

  // Background: lines of "code" scrolling slowly (parallax).
  const bgLines = [];
  for (let i = 0; i < 26; i++) {
    bgLines.push({ y: 30 + i * 20, x: Math.random() * W * 2, text: ui.pick(ui.SNIPPETS) });
  }
  const stars = [];
  for (let i = 0; i < 40; i++) {
    stars.push({ x: Math.random() * W, y: Math.random() * GROUND, r: Math.random() * 1.3 + 0.3 });
  }

  function reset() {
    L = HD.pick(LEVELS);
    GAP = L.gap;
    state = 'ready';
    duck = { x: 95, y: 270, vy: 0, rot: 0, wing: 0 };
    pipes = [];
    score = 0;
    speed = L.speed;
    overAt = 0;
    flash = 0;
    record = false;
  }

  function makePipe(x) {
    const swing = score >= L.swingFrom ? L.swing : 0;
    const margin = 70 + swing;
    const gapY = margin + GAP / 2 + Math.random() * (GROUND - 2 * margin - GAP);
    const lines = [];
    for (let i = 0; i < 40; i++) {
      lines.push({
        indent: (Math.random() * 3) | 0,
        segs: [8 + Math.random() * 18, Math.random() < 0.6 ? 6 + Math.random() * 14 : 0],
        c1: ui.pick(ui.PALETTE),
        c2: ui.pick(ui.PALETTE)
      });
    }
    return { x, gapY, base: gapY, swing, phase: Math.random() * Math.PI * 2, lines, color: ui.pick(ui.PALETTE), passed: false };
  }

  function press() {
    if (state === 'ready') {
      state = 'play';
      pipes = [makePipe(W + 40)];
    }
    if (state === 'play') {
      duck.vy = FLAP;
      duck.wing = 1;
    } else if (state === 'over' && performance.now() - overAt > 450) {
      reset();
    }
  }

  // ---------- Logic ----------

  function update(dt) {
    groundX += speed * dt;
    bgX += speed * 0.25 * dt;
    if (flash > 0) flash -= dt;

    if (state === 'ready') {
      duck.y = 270 + Math.sin(performance.now() / 250) * 8;
      duck.wing = (duck.wing + dt * 4) % 1;
      return;
    }
    if (state === 'over') {
      // After a crash the duck falls to the ground.
      if (duck.y < GROUND - 14) {
        duck.vy = Math.min(duck.vy + GRAVITY * dt, MAX_FALL);
        duck.y = Math.min(duck.y + duck.vy * dt, GROUND - 14);
        duck.rot = Math.min(duck.rot + 6 * dt, Math.PI / 2);
      }
      return;
    }

    duck.vy = Math.min(duck.vy + GRAVITY * dt, MAX_FALL);
    duck.y += duck.vy * dt;
    duck.rot = Math.max(-0.45, Math.min(Math.PI / 2.2, duck.vy / 700));
    duck.wing = Math.max(0, duck.wing - dt * 3);
    if (duck.y < 12) { duck.y = 12; duck.vy = 0; }

    speed = L.speed + Math.min(score * L.ramp, 70);
    const t = performance.now() / 1000;
    for (const p of pipes) {
      p.x -= speed * dt;
      if (p.swing) p.gapY = p.base + Math.sin(t * 1.8 + p.phase) * p.swing;
      if (!p.passed && p.x + PIPE_W < duck.x) {
        p.passed = true;
        score++;
      }
    }
    if (pipes.length && pipes[0].x < -PIPE_W) pipes.shift();
    const last = pipes[pipes.length - 1];
    if (last && last.x < W - L.spacing) pipes.push(makePipe(last.x + L.spacing));

    if (duck.y + 13 >= GROUND || pipes.some(hitsPipe)) gameOver();
  }

  function hitsPipe(p) {
    const r = 12;
    const top = p.gapY - GAP / 2;
    const bottom = p.gapY + GAP / 2;
    return circleRect(duck.x, duck.y, r, p.x, -100, PIPE_W, top + 100) ||
           circleRect(duck.x, duck.y, r, p.x, bottom, PIPE_W, GROUND - bottom);
  }

  function circleRect(cx, cy, r, x, y, w, h) {
    const nx = Math.max(x, Math.min(cx, x + w));
    const ny = Math.max(y, Math.min(cy, y + h));
    return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
  }

  function gameOver() {
    state = 'over';
    overAt = performance.now();
    flash = 0.15;
    duck.vy = Math.min(duck.vy, 0);
    record = HD.submitScore('flappy', score);
  }

  // ---------- Drawing ----------

  function draw(ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, '#0f1320');
    sky.addColorStop(1, '#1b2136');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, GROUND);

    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.35;
    for (const s of stars) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#9cdcfe';
    ctx.font = '13px monospace';
    for (const l of bgLines) {
      const x = ((l.x - bgX) % (W + 160) + W + 160) % (W + 160) - 120;
      ctx.fillText(l.text, x, l.y);
    }
    ctx.globalAlpha = 1;

    for (const p of pipes) {
      drawBlock(ctx, p, 0, p.gapY - GAP / 2, '}');
      drawBlock(ctx, p, p.gapY + GAP / 2, GROUND, '{');
    }
    ui.statusBar(ctx, GROUND, W, H, groundX, '⎇ main   ⊗ 0  ⚠ 0', `Ln ${score + 1}, Col 1`);
    drawDuck(ctx, duck.x, duck.y, duck.rot, duck.wing, state === 'over');
    drawHud(ctx);

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 4})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // A "code block": dark panel with colored lines and a curly brace on the cap.
  function drawBlock(ctx, p, y1, y2, brace) {
    const x = p.x;
    const h = y2 - y1;
    if (h <= 0) return;

    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(x, y1, PIPE_W, h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y1, PIPE_W, h);
    ctx.clip();
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < p.lines.length; i++) {
      const ly = y1 + 8 + i * 11;
      if (ly > y2) break;
      const l = p.lines[i];
      const lx = x + 8 + l.indent * 6;
      ctx.fillStyle = l.c1;
      ctx.fillRect(lx, ly, l.segs[0], 4);
      if (l.segs[1]) {
        ctx.fillStyle = l.c2;
        ctx.fillRect(lx + l.segs[0] + 4, ly, l.segs[1], 4);
      }
    }
    ctx.restore();

    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y1 + 1, PIPE_W - 2, h - 2);

    const capH = 26;
    const capY = brace === '}' ? y2 - capH : y1;
    ctx.fillStyle = p.color;
    ctx.fillRect(x - 5, capY, PIPE_W + 10, capH);
    ctx.fillStyle = '#1e1e2e';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(brace, x + PIPE_W / 2, capY + capH / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // The rubber duck from rubber-duck debugging.
  function drawDuck(ctx, x, y, rot, wing, dead) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);

    ctx.fillStyle = '#ffd43b';
    ctx.beginPath();
    ctx.ellipse(-2, 3, 16, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(-22, -6);
    ctx.lineTo(-14, 6);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(8, -7, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f5b400';
    const wingLift = Math.sin(wing * Math.PI) * 8;
    ctx.beginPath();
    ctx.ellipse(-4, 4 - wingLift, 9, 5, -0.3 - wingLift / 20, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ff8c1a';
    ctx.beginPath();
    ctx.moveTo(15, -8);
    ctx.lineTo(24, -5);
    ctx.lineTo(15, -2);
    ctx.fill();

    ctx.fillStyle = '#1e1e2e';
    ctx.beginPath();
    ctx.arc(10, -9, 2.2, 0, Math.PI * 2);
    ctx.fill();
    if (dead) {
      ctx.strokeStyle = '#1e1e2e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(7.5, -11.5); ctx.lineTo(12.5, -6.5);
      ctx.moveTo(12.5, -11.5); ctx.lineTo(7.5, -6.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  const best = () => HD.best('flappy');

  function drawHud(ctx) {
    if (state === 'play') ui.bigScore(ctx, String(score), W / 2, 70);

    if (state === 'ready') {
      ui.card(ctx, 20, 100, W - 40, L.swing ? 140 : 116);
      ui.card(ctx, 20, 350, W - 40, best() ? 104 : 76);
      ctx.textAlign = 'center';
      ctx.font = 'bold 34px monospace';
      ctx.fillStyle = '#ffd43b';
      ctx.fillText('Flappy Code', W / 2, 140);
      ctx.font = '14px monospace';
      ctx.fillStyle = '#d4d4d4';
      ctx.fillText('Fly the duck between the blocks', W / 2, 172);
      ui.levelTag(ctx, W / 2, 200);
      if (L.swing) {
        ctx.fillStyle = '#9a9fb0';
        ctx.fillText(L.swingFrom ? `blocks start moving after ${L.swingFrom} pts!` : 'the blocks move up and down!', W / 2, 224);
        ctx.fillStyle = '#d4d4d4';
      }
      ctx.fillText('SPACE / ↑ / click  →  flap', W / 2, 382);
      ctx.fillText('P pause · R restart · M menu', W / 2, 408);
      if (best()) ctx.fillText(`Best: ${best()}`, W / 2, 436);
      ctx.textAlign = 'left';
    }

    if (state === 'over') {
      ui.overCard(ctx, W, H, {
        title: 'Uncaught Bug!', color: '#f48771', score, best: HD.best('flappy'), record
      });
    }
  }

  HD.register({
    id: 'flappy',
    name: 'Flappy Code',
    tagline: 'Flap between { } blocks',
    color: '#ffd43b',
    W, H,
    reset,
    update,
    draw,
    press,
    release() {},
    playing: () => state === 'play',
    icon(ctx, x, y) { drawDuck(ctx, x, y, -0.2, 0.5, false); }
  });

  reset();
})();
