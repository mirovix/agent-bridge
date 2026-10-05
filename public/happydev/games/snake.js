// snake_case — a snake made of letters eats bugs (and coffee) without biting its own tail.
(function () {
  const { ui } = HD;
  const CELL = 18;
  const COLS = 20;
  const ROWS = 19;
  const TOP = 36;
  const W = COLS * CELL;
  const H = TOP + ROWS * CELL;
  const LETTERS = 'snake_case_';

  // Per-level parameters: [Junior, Senior, 10x Dev]
  // wrap = edges wrap around to the other side; legacy = "legacy code" blocks appear every N bugs
  const LEVELS = [
    { tick: 0.14, minTick: 0.09, speedup: 0.002, wrap: true, legacy: 0 },
    { tick: 0.11, minTick: 0.07, speedup: 0.0025, wrap: false, legacy: 0 },
    { tick: 0.085, minTick: 0.052, speedup: 0.003, wrap: false, legacy: 4 }
  ];

  const DIRS = {
    ArrowUp: [0, -1], KeyW: [0, -1],
    ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0],
    ArrowRight: [1, 0], KeyD: [1, 0]
  };

  let L, state, snake, dir, queue, food, coffee, walls, grow, score, eaten, acc, tick, overAt, record, popups, t, cause;

  function reset() {
    L = HD.pick(LEVELS);
    state = 'ready';
    snake = [{ x: 6, y: 16 }, { x: 5, y: 16 }, { x: 4, y: 16 }, { x: 3, y: 16 }];
    dir = [1, 0];
    queue = [];
    walls = [];
    grow = 0;
    score = 0;
    eaten = 0;
    acc = 0;
    tick = L.tick;
    overAt = 0;
    record = false;
    popups = [];
    coffee = null;
    t = 0;
    food = freeCell();
  }

  const occupied = (x, y) =>
    snake.some(s => s.x === x && s.y === y) || walls.some(w => w.x === x && w.y === y) ||
    (food && food.x === x && food.y === y) || (coffee && coffee.x === x && coffee.y === y);

  function freeCell() {
    for (let i = 0; i < 500; i++) {
      const x = (Math.random() * COLS) | 0, y = (Math.random() * ROWS) | 0;
      if (!occupied(x, y)) return { x, y };
    }
    return { x: 0, y: 0 };
  }

  // ---------- Input ----------

  function turn(d) {
    const last = queue.length ? queue[queue.length - 1] : dir;
    if ((d[0] === -last[0] && d[1] === -last[1]) || (d[0] === last[0] && d[1] === last[1])) return;
    if (queue.length < 3) queue.push(d);
  }

  function key(code) {
    const d = DIRS[code];
    if (!d) return false;
    if (state === 'ready') state = 'play';
    if (state === 'play') turn(d);
    return true;
  }

  // Click/tap: turn towards the point, relative to the head.
  function pointer(px, py) {
    if (state !== 'play') return;
    const h = snake[0];
    const dx = px - (h.x + 0.5) * CELL, dy = py - TOP - (h.y + 0.5) * CELL;
    const last = queue.length ? queue[queue.length - 1] : dir;
    if (last[0] !== 0) turn([0, dy < 0 ? -1 : 1]);
    else turn([dx < 0 ? -1 : 1, 0]);
  }

  function press() {
    if (state === 'ready') state = 'play';
    else if (state === 'over' && performance.now() - overAt > 450) reset();
  }

  // ---------- Logic ----------

  function update(dt) {
    t += dt;
    for (const p of popups) { p.y -= 25 * dt; p.life -= dt; }
    popups = popups.filter(p => p.life > 0);
    if (state !== 'play') return;

    if (coffee) {
      coffee.life -= dt;
      if (coffee.life <= 0) coffee = null;
    }
    acc += dt;
    while (acc >= tick && state === 'play') {
      acc -= tick;
      move();
    }
  }

  function move() {
    if (queue.length) dir = queue.shift();
    let x = snake[0].x + dir[0], y = snake[0].y + dir[1];
    if (L.wrap) {
      x = (x + COLS) % COLS;
      y = (y + ROWS) % ROWS;
    } else if (x < 0 || y < 0 || x >= COLS || y >= ROWS) {
      return die('Segfault: out of bounds');
    }
    // The tail moves away in the same step, so it doesn't count (unless the snake is growing).
    const body = grow > 0 ? snake : snake.slice(0, -1);
    if (body.some(s => s.x === x && s.y === y)) return die('Infinite recursion: you bit yourself');
    if (walls.some(w => w.x === x && w.y === y)) return die('Crashed into legacy code');

    snake.unshift({ x, y });
    if (grow > 0) grow--;
    else snake.pop();

    if (food.x === x && food.y === y) {
      score++;
      eaten++;
      grow++;
      tick = Math.max(L.minTick, tick - L.speedup);
      popups.push({ text: '+1 bug fixed', x: (x + 0.5) * CELL, y: TOP + y * CELL, life: 0.8, c: '#4ec9b0' });
      food = freeCell();
      if (!coffee && Math.random() < 0.18) coffee = { ...freeCell(), life: 6 };
      if (L.legacy && eaten % L.legacy === 0) addLegacy();
    }
    if (coffee && coffee.x === x && coffee.y === y) {
      score += 5;
      grow += 2;
      popups.push({ text: '☕ +5', x: (x + 0.5) * CELL, y: TOP + y * CELL, life: 1, c: '#ffd43b' });
      coffee = null;
    }
  }

  // A piece of "legacy code" (3 cells) away from the head.
  function addLegacy() {
    const h = snake[0];
    for (let i = 0; i < 100; i++) {
      const horiz = Math.random() < 0.5;
      const x = (Math.random() * (COLS - 3)) | 0, y = (Math.random() * (ROWS - 3)) | 0;
      const cells = [0, 1, 2].map(k => (horiz ? { x: x + k, y } : { x, y: y + k }));
      if (cells.every(c => !occupied(c.x, c.y) && Math.abs(c.x - h.x) + Math.abs(c.y - h.y) > 5)) {
        walls.push(...cells);
        return;
      }
    }
  }

  function die(msg) {
    state = 'over';
    cause = msg;
    overAt = performance.now();
    record = HD.submitScore('snake', score);
  }

  // ---------- Drawing ----------

  function draw(ctx) {
    ctx.fillStyle = '#12141f';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#181a26';
    ctx.fillRect(0, 0, W, TOP);
    ctx.fillStyle = '#d4d4d4';
    ctx.font = '12px monospace';
    ctx.fillText('● snake_case.py', 12, 23);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#9a9fb0';
    ctx.fillText(`${score} pt  ·  best ${HD.best('snake')}`, W - 12, 23);
    ctx.textAlign = 'left';

    // Dotted grid
    ctx.fillStyle = '#23263a';
    for (let x = 0; x < COLS; x++) {
      for (let y = 0; y < ROWS; y++) ctx.fillRect(x * CELL + CELL / 2 - 1, TOP + y * CELL + CELL / 2 - 1, 2, 2);
    }
    // Border: dashed if it wraps around, red if it's deadly
    ctx.strokeStyle = L.wrap ? 'rgba(78, 201, 176, 0.5)' : 'rgba(241, 76, 76, 0.7)';
    ctx.lineWidth = 2;
    if (L.wrap) ctx.setLineDash([6, 6]);
    ctx.strokeRect(1, TOP + 1, W - 2, ROWS * CELL - 2);
    ctx.setLineDash([]);

    for (const w of walls) {
      const x = w.x * CELL, y = TOP + w.y * CELL;
      ctx.fillStyle = '#3a3d4d';
      ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      ctx.fillStyle = '#6b6f80';
      ctx.font = '9px monospace';
      ctx.fillText('//', x + 3, y + 12);
    }

    drawBug(ctx, (food.x + 0.5) * CELL, TOP + (food.y + 0.5) * CELL, 1);
    if (coffee && (coffee.life > 1.5 || Math.floor(t * 8) % 2)) drawCoffee(ctx, (coffee.x + 0.5) * CELL, TOP + (coffee.y + 0.5) * CELL);

    const dead = state === 'over';
    for (let i = snake.length - 1; i >= 0; i--) {
      const s = snake[i];
      const x = s.x * CELL, y = TOP + s.y * CELL;
      const k = i / Math.max(1, snake.length - 1);
      ctx.fillStyle = dead ? (Math.floor(t * 6) % 2 ? '#f14c4c' : '#5a2a2a') : mix('#4ec9b0', '#569cd6', k);
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, CELL - 2, CELL - 2, i === 0 ? 6 : 4);
      ctx.fill();
      if (i > 0) {
        ctx.fillStyle = '#12141f';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        // Counted from the tail, so the word reads in the direction of travel.
        ctx.fillText(LETTERS[(snake.length - 1 - i) % LETTERS.length], x + CELL / 2, y + 13);
        ctx.textAlign = 'left';
      }
    }
    drawHead(ctx, snake[0]);

    for (const p of popups) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.c;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(p.text, Math.max(50, Math.min(W - 50, p.x)), p.y);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;

    drawHud(ctx);
  }

  function drawHead(ctx, h) {
    const cx = (h.x + 0.5) * CELL, cy = TOP + (h.y + 0.5) * CELL;
    const [dx, dy] = dir;
    const px = -dy, py = dx; // perpendicular
    ctx.fillStyle = '#ffffff';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + dx * 3 + px * s * 4, cy + dy * 3 + py * s * 4, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#12141f';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + dx * 4 + px * s * 4, cy + dy * 4 + py * s * 4, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBug(ctx, x, y, k) {
    ctx.strokeStyle = '#f14c4c';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const s of [-1, 1]) {
      for (const o of [-3, 0, 3]) {
        ctx.moveTo(x, y + o);
        ctx.lineTo(x + s * 7 * k, y + o + (o ? Math.sign(o) : 0) * 2);
      }
    }
    ctx.stroke();
    ctx.fillStyle = '#f14c4c';
    ctx.beginPath();
    ctx.ellipse(x, y + 1, 4.5 * k, 6 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7a1414';
    ctx.beginPath();
    ctx.arc(x, y - 5 * k, 3 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - 0.5, y - 4, 1, 10 * k);
  }

  function drawCoffee(ctx, x, y) {
    ctx.fillStyle = '#ffd43b';
    ctx.fillRect(x - 5, y - 3, 9, 9);
    ctx.strokeStyle = '#ffd43b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x + 5, y + 1.5, 2.5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.moveTo(x - 2, y - 5);
    ctx.quadraticCurveTo(x, y - 8, x - 1, y - 10);
    ctx.moveTo(x + 2, y - 5);
    ctx.quadraticCurveTo(x + 4, y - 8, x + 3, y - 10);
    ctx.stroke();
  }

  function drawHud(ctx) {
    if (state === 'ready') {
      ui.card(ctx, 25, 90, W - 50, 206);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#4ec9b0';
      ctx.font = 'bold 30px monospace';
      ctx.fillText('snake_case', W / 2, 130);
      ui.levelTag(ctx, W / 2, 152);
      ctx.fillStyle = '#d4d4d4';
      ctx.font = '13px monospace';
      ctx.fillText("Eat the bugs, don't bite your tail.", W / 2, 180);
      ctx.fillText('☕ coffee = +5 points (gone quickly!)', W / 2, 200);
      ctx.fillStyle = '#9a9fb0';
      ctx.fillText(L.wrap ? 'edges wrap around to the other side' : L.legacy ? 'deadly edges + // legacy code blocks' : 'the edges are deadly', W / 2, 222);
      ctx.fillStyle = '#9cdcfe';
      ctx.fillText('ARROWS / WASD or click: turn', W / 2, 252);
      ctx.fillText('press an arrow key to start', W / 2, 272);
      ctx.textAlign = 'left';
    }
    if (state === 'over') {
      ui.overCard(ctx, W, H, {
        title: 'Traceback!', color: '#f48771', score, best: HD.best('snake'), record, subtitle: cause
      });
    }
  }

  function mix(a, c, k) {
    const pa = parseInt(a.slice(1), 16), pc = parseInt(c.slice(1), 16);
    const ch = s => Math.round(((pa >> s) & 255) * (1 - k) + ((pc >> s) & 255) * k);
    return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
  }

  HD.register({
    id: 'snake',
    name: 'snake_case',
    tagline: 'A snake that eats bugs',
    color: '#4ec9b0',
    W, H,
    reset,
    update,
    draw,
    press,
    key,
    pointer,
    release() {},
    playing: () => state === 'play',
    icon(ctx, x, y) {
      ['#4ec9b0', '#4fb8bd', '#52a8c9', '#569cd6'].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.roundRect(x + 8 - i * 13, y - 6, 12, 12, 3);
        ctx.fill();
      });
      drawBug(ctx, x + 26, y, 0.8);
    }
  });

  reset();
})();
