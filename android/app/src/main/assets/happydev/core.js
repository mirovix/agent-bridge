// HappyDEV core: canvas, game loop, input, pause, menu, levels and high scores.
// Each game registers itself with HD.register({...}) from its own file.
(function () {
  const vscode = acquireVsCodeApi();
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const STEP = 1 / 120;
  const MENU_W = 440;
  const MENU_H = 640;

  // Difficulty levels, shared by every game.
  const LEVELS = [
    { id: 'junior', name: 'Junior', color: '#4ec9b0', hint: 'slower, with more room for mistakes' },
    { id: 'senior', name: 'Senior', color: '#dcdcaa', hint: 'the standard challenge' },
    { id: 'tenx', name: '10x Dev', color: '#f14c4c', hint: 'fast, tight and merciless' }
  ];

  const bests = JSON.parse(canvas.dataset.bests || '{}');
  const games = [];
  let current = null; // null = menu
  let selected = 0;
  let level = Math.max(0, LEVELS.findIndex(l => l.id === (canvas.dataset.level || 'senior')));
  // High scores saved before levels existed become Senior high scores.
  for (const k of Object.keys(bests)) {
    if (!k.includes(':') && !bests[`${k}:senior`]) bests[`${k}:senior`] = bests[k];
  }
  let paused = false;
  let scale = 1;

  const PALETTE = ['#c586c0', '#4ec9b0', '#569cd6', '#dcdcaa', '#ce9178', '#9cdcfe'];
  const SNIPPETS = [
    'if (bug) {', 'fix(bug);', 'return 42;', '} else {', 'console.log()', 'while (true)',
    'await coffee();', 'git push -f', 'let x = 0;', '// TODO', 'npm install', 'throw err;'
  ];

  const ui = {
    PALETTE,
    SNIPPETS,
    pick: arr => arr[(Math.random() * arr.length) | 0],

    card(c, x, y, w, h) {
      c.save();
      c.fillStyle = 'rgba(17, 19, 26, 0.88)';
      c.strokeStyle = '#3c4257';
      c.lineWidth = 2;
      c.beginPath();
      c.roundRect(x, y, w, h, 10);
      c.fill();
      c.stroke();
      c.restore();
    },

    // Game-over card, the same for every game.
    // Every helper saves and restores the context so it never leaks alignment or colors.
    overCard(c, W, H, { title, color, score, best, record, unit = '', subtitle }) {
      const w = Math.min(W - 30, 330);
      const h = 176 + (subtitle ? 20 : 0) + (record ? 26 : 0);
      const x = (W - w) / 2, y = (H - h) / 2 - 10;
      const lv = LEVELS[level];
      ui.card(c, x, y, w, h);
      c.save();
      c.textAlign = 'center';
      let ty = y + 40;
      c.fillStyle = color;
      c.font = 'bold 26px monospace';
      c.fillText(title, W / 2, ty);
      if (subtitle) {
        ty += 20;
        c.fillStyle = '#9a9fb0';
        c.font = '11px monospace';
        c.fillText(subtitle, W / 2, ty);
      }
      ty += 22;
      c.fillStyle = lv.color;
      c.font = '12px monospace';
      c.fillText(`level: ${lv.name}`, W / 2, ty);
      c.fillStyle = '#d4d4d4';
      c.font = '16px monospace';
      c.fillText(`Score: ${score}${unit}`, W / 2, (ty += 30));
      c.fillText(`Best:  ${best}${unit}`, W / 2, (ty += 24));
      if (record) {
        c.fillStyle = '#ffd43b';
        c.fillText('★ New high score! ★', W / 2, (ty += 26));
      }
      c.fillStyle = '#9cdcfe';
      c.font = '13px monospace';
      c.fillText('SPACE: retry   ·   M: menu', W / 2, y + h - 18);
      c.restore();
    },

    // Level label for the start screens.
    levelTag(c, x, y) {
      const lv = LEVELS[level];
      c.save();
      c.textAlign = 'center';
      c.fillStyle = lv.color;
      c.font = 'bold 13px monospace';
      c.fillText(`[ level: ${lv.name} ]`, x, y);
      c.restore();
    },

    // Bottom strip that looks like the VS Code status bar.
    statusBar(c, y, W, H, offset, left, right) {
      c.save();
      c.fillStyle = '#007acc';
      c.fillRect(0, y, W, H - y);
      c.fillStyle = '#0065a9';
      for (let x = -(offset % 24); x < W; x += 24) c.fillRect(x, y, 12, 6);
      c.fillStyle = '#ffffff';
      c.font = '12px monospace';
      const ty = y + Math.min(36, (H - y) / 2 + 8);
      c.fillText(left, 10, ty);
      c.textAlign = 'right';
      c.fillText(right, W - 10, ty);
      c.restore();
    },

    bigScore(c, text, x, y, align = 'center') {
      c.save();
      c.textAlign = align;
      c.font = 'bold 40px monospace';
      c.lineWidth = 5;
      c.strokeStyle = '#11131a';
      c.strokeText(text, x, y);
      c.fillStyle = '#ffffff';
      c.fillText(text, x, y);
      c.restore();
    }
  };

  window.HD = {
    ui,
    register(game) { games.push(game); },
    // 0 = Junior, 1 = Senior, 2 = 10x Dev
    level: () => level,
    // Picks the value for the current level: HD.pick([junior, senior, tenx])
    pick: arr => arr[level],
    best(id) { return bests[`${id}:${LEVELS[level].id}`] || 0; },
    // Returns true on a new high score.
    submitScore(id, score) {
      const key = `${id}:${LEVELS[level].id}`;
      if (score <= (bests[key] || 0)) return false;
      bests[key] = score;
      vscode.postMessage({ type: 'best', game: key, value: score });
      return true;
    }
  };

  // ---------- Menu ----------

  function startGame(i) {
    selected = i;
    current = games[i];
    paused = false;
    current.reset();
    vscode.postMessage({ type: 'last', game: current.id });
    resize();
  }

  function toMenu() {
    if (current) current.release();
    current = null;
    paused = false;
    resize();
  }

  function cardRect(i) {
    return { x: 24, y: 104 + i * 86, w: MENU_W - 48, h: 76 };
  }

  const LEVEL_Y = 104 + 5 * 86 + 18;

  function setLevel(i) {
    level = (i + LEVELS.length) % LEVELS.length;
    vscode.postMessage({ type: 'level', value: LEVELS[level].id });
  }

  function drawMenu() {
    const sky = ctx.createLinearGradient(0, 0, 0, MENU_H);
    sky.addColorStop(0, '#0f1320');
    sky.addColorStop(1, '#1b2136');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, MENU_W, MENU_H);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd43b';
    ctx.font = 'bold 32px monospace';
    ctx.fillText('HappyDEV', MENU_W / 2, 52);
    ctx.fillStyle = '#9cdcfe';
    ctx.font = '14px monospace';
    ctx.fillText(canvas.dataset.auto ? 'Claude is working… pick a game' : 'Pick a game', MENU_W / 2, 80);
    ctx.textAlign = 'left';

    games.forEach((g, i) => {
      const r = cardRect(i);
      const on = i === selected;
      ctx.fillStyle = on ? '#232a3f' : '#171b28';
      ctx.strokeStyle = on ? g.color : '#2a2f3d';
      ctx.lineWidth = on ? 3 : 2;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 12);
      ctx.fill();
      ctx.stroke();

      ctx.save();
      g.icon(ctx, r.x + 42, r.y + r.h / 2);
      ctx.restore();
      ctx.textAlign = 'left';

      ctx.fillStyle = on ? g.color : '#d4d4d4';
      ctx.font = 'bold 18px monospace';
      ctx.fillText(`${i + 1}. ${g.name}`, r.x + 86, r.y + 28);
      ctx.fillStyle = '#9a9fb0';
      ctx.font = '12px monospace';
      ctx.fillText(g.tagline, r.x + 86, r.y + 48);
      ctx.fillStyle = '#d4d4d4';
      ctx.fillText(`Best: ${HD.best(g.id)}${g.unit || ''}`, r.x + 86, r.y + 66);
    });

    // Level selector
    const lv = LEVELS[level];
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9a9fb0';
    ctx.font = '12px monospace';
    ctx.fillText('level', MENU_W / 2, LEVEL_Y);
    ctx.fillStyle = lv.color;
    ctx.font = 'bold 20px monospace';
    ctx.fillText(`◀  ${lv.name}  ▶`, MENU_W / 2, LEVEL_Y + 26);
    ctx.fillStyle = '#9a9fb0';
    ctx.font = '11px monospace';
    ctx.fillText(lv.hint, MENU_W / 2, LEVEL_Y + 44);

    ctx.fillStyle = '#d4d4d4';
    ctx.font = '13px monospace';
    ctx.fillText('↑ ↓ game  ·  ← → level  ·  SPACE play', MENU_W / 2, MENU_H - 18);
    ctx.textAlign = 'left';
  }

  function drawPause(W, H) {
    ui.card(ctx, W / 2 - 150, H / 2 - 55, 300, 100);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px monospace';
    ctx.fillText('PAUSED', W / 2, H / 2 - 12);
    ctx.font = '13px monospace';
    ctx.fillText('P or click: resume  ·  M: menu', W / 2, H / 2 + 18);
    ctx.textAlign = 'left';
  }

  // ---------- Input ----------

  const PRESS_KEYS = ['Space', 'ArrowUp', 'KeyW'];

  function press() {
    if (!current) return startGame(selected);
    if (paused) { paused = false; return; }
    current.press();
  }

  function release() {
    if (current) current.release();
  }

  window.addEventListener('keydown', e => {
    if (!current) {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') selected = (selected + games.length - 1) % games.length;
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') selected = (selected + 1) % games.length;
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') setLevel(level - 1);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') setLevel(level + 1);
      else if (e.code === 'Space' || e.code === 'Enter') startGame(selected);
      else if (/^Digit[1-9]$/.test(e.code) && games[+e.code[5] - 1]) startGame(+e.code[5] - 1);
      else return;
      e.preventDefault();
      return;
    }
    // A game can handle its own keys (e.g. the arrows in snake_case).
    if (current.key && !paused && current.key(e.code)) {
      e.preventDefault();
      return;
    }
    if (PRESS_KEYS.includes(e.code)) {
      e.preventDefault();
      if (!e.repeat) press();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      if (paused || current.playing()) paused = !paused;
    } else if (e.code === 'KeyR') {
      paused = false;
      current.reset();
    } else if (e.code === 'KeyM' || e.code === 'Backspace') {
      toMenu();
    }
  });
  window.addEventListener('keyup', e => {
    if (PRESS_KEYS.includes(e.code)) release();
  });

  function pointerDown(clientX, clientY) {
    canvas.focus();
    const bounds = canvas.getBoundingClientRect();
    const mx = (clientX - bounds.left) / scale, my = (clientY - bounds.top) / scale;
    if (!current) {
      const i = games.findIndex((g, i) => {
        const r = cardRect(i);
        return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
      });
      if (i >= 0) startGame(i);
      else if (my > LEVEL_Y - 10 && my < LEVEL_Y + 50) setLevel(level + (mx < MENU_W / 2 ? -1 : 1));
      return;
    }
    if (current.pointer && !paused) current.pointer(mx, my);
    press();
  }
  canvas.addEventListener('mousedown', e => {
    e.preventDefault();
    pointerDown(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', release);
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const touch = e.changedTouches[0];
    if (touch) pointerDown(touch.clientX, touch.clientY);
  }, { passive: false });
  canvas.addEventListener('touchend', e => { e.preventDefault(); release(); }, { passive: false });
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && current && current.playing()) paused = true;
  });
  window.addEventListener('message', e => {
    const m = e.data || {};
    if (m.type === 'bests') Object.keys(bests).forEach(k => delete bests[k]);
  });

  // ---------- Resize and loop ----------

  function resize() {
    const W = current ? current.W : MENU_W;
    const H = current ? current.H : MENU_H;
    scale = Math.min(window.innerWidth / W, window.innerHeight / H) * 0.96;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = W * scale + 'px';
    canvas.style.height = H * scale + 'px';
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    // Fixed time step: the game runs at the same speed at 60 Hz, 144 Hz, etc.
    acc += Math.min((now - last) / 1000, 0.1);
    last = now;
    while (acc >= STEP) {
      if (current && !paused) current.update(STEP);
      acc -= STEP;
    }
    if (current) {
      ctx.save();
      current.draw(ctx);
      ctx.restore();
      if (paused) drawPause(current.W, current.H);
    } else {
      drawMenu();
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('load', () => {
    const start = games.findIndex(g => g.id === canvas.dataset.start);
    const lastIdx = games.findIndex(g => g.id === canvas.dataset.last);
    selected = Math.max(0, lastIdx);
    if (start >= 0) startGame(start);
    resize();
    window.addEventListener('resize', resize);
    canvas.focus();
    requestAnimationFrame(frame);
  });
})();
