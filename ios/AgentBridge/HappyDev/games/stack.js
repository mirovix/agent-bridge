// Stack Overflow — stack lines of code: whatever hangs over gets cut off.
(function () {
  const { ui } = HD;
  const W = 360;
  const H = 600;
  const ROW = 26; // row height
  const BASE_Y = 520; // where the first row sits
  const GUTTER = 34; // line-number gutter
  const MIN_X = GUTTER + 4;
  const MAX_X = W - 8;

  // Per-level parameters: [Junior, Senior, 10x Dev]
  // perfect = pixel tolerance for a perfect drop; grow = how much a row widens after 3 perfects
  const LEVELS = [
    { speed: 130, ramp: 3, maxSpeed: 330, perfect: 8, grow: 14, width: 220 },
    { speed: 170, ramp: 4.5, maxSpeed: 430, perfect: 5, grow: 10, width: 200 },
    { speed: 220, ramp: 6, maxSpeed: 540, perfect: 3, grow: 6, width: 180 }
  ];

  const CODE = [
    'const app = express();', 'if (!user) return null;', 'for (let i = 0; i < n; i++)', 'await db.connect();',
    'res.send(200);', 'let cache = new Map();', 'try { deploy(); }', 'catch (e) { log(e); }', 'export default App;',
    'import React from "react";', 'while (queue.length) {', 'x = x ?? fallback;', 'return fib(n-1) + fib(n-2);',
    'git commit -m "wip"', 'SELECT * FROM users;', 'def main(): pass', 'fn main() { }', 'println!("ok");',
    'npm run build', 'console.log(stack);', 'throw new Error();', '} // end', 'yield* gen();', 'Promise.all(jobs);'
  ];

  let L, state, rows, moving, falling, cam, combo, overAt, record, popups, dir, t;

  function reset() {
    L = HD.pick(LEVELS);
    state = 'ready';
    const x = (W + GUTTER - L.width) / 2;
    rows = [{ x, w: L.width, text: 'function main() {', color: '#569cd6' }];
    falling = [];
    popups = [];
    combo = 0;
    cam = 0;
    overAt = 0;
    record = false;
    dir = 1;
    t = 0;
    spawn();
  }

  const score = () => rows.length - 1;
  const rowY = i => BASE_Y - i * ROW;

  function spawn() {
    const top = rows[rows.length - 1];
    const i = rows.length;
    // Junior: always from the left; other levels alternate left and right.
    dir = HD.level() === 0 || i % 2 ? 1 : -1;
    moving = {
      x: dir > 0 ? MIN_X - top.w * 0.4 : MAX_X - top.w * 0.6,
      w: top.w,
      v: dir * Math.min(L.speed + score() * L.ramp, L.maxSpeed),
      text: '  '.repeat(1 + (i % 3)) + ui.pick(CODE),
      color: ui.PALETTE[i % ui.PALETTE.length]
    };
  }

  function press() {
    if (state === 'ready') { state = 'play'; return; }
    if (state === 'over') {
      if (performance.now() - overAt > 450) reset();
      return;
    }
    drop();
  }

  function drop() {
    const top = rows[rows.length - 1];
    const m = moving;
    const y = rowY(rows.length);
    let x = m.x, w = m.w;
    const diff = x - top.x;

    if (Math.abs(diff) <= L.perfect) {
      // Perfect drop: nothing is cut.
      x = top.x;
      combo++;
      let text = 'Perfect!';
      if (combo >= 3) {
        const grow = Math.min(L.grow, MAX_X - MIN_X - w);
        w += grow;
        x = Math.max(MIN_X, x - grow / 2);
        if (grow > 0) text = `Perfect! x${combo} +${Math.round(grow)}px`;
      }
      popups.push({ text, x: x + w / 2, y: y - 10, life: 1, c: '#ffd43b' });
    } else {
      combo = 0;
      const left = Math.max(x, top.x), right = Math.min(x + w, top.x + top.w);
      if (right <= left) {
        // Missed completely: the row falls and the stack "overflows".
        falling.push({ x, y, w, text: m.text, color: m.color, vy: 0, vx: m.v * 0.3, rot: 0 });
        return gameOver();
      }
      // The overhanging piece falls off.
      const cutX = x < left ? x : right;
      const cutW = w - (right - left);
      falling.push({ x: cutX, y, w: cutW, text: '', color: m.color, vy: 0, vx: (x < left ? -1 : 1) * 60, rot: 0 });
      x = left;
      w = right - left;
    }
    rows.push({ x, w, text: m.text, color: m.color });
    spawn();
  }

  function gameOver() {
    state = 'over';
    overAt = performance.now();
    record = HD.submitScore('stack', score());
  }

  function update(dt) {
    t += dt;
    for (const f of falling) {
      f.vy += 1400 * dt;
      f.y += f.vy * dt;
      f.x += f.vx * dt;
      f.rot += f.vx * 0.004 * dt;
    }
    falling = falling.filter(f => f.y - cam < H + 100);
    for (const p of popups) { p.y -= 30 * dt; p.life -= dt; }
    popups = popups.filter(p => p.life > 0);

    // The camera rises to keep the top of the stack in view.
    const target = Math.min(0, rowY(rows.length) - 240);
    cam += (target - cam) * Math.min(1, dt * 5);

    if (state !== 'play') return;
    const m = moving;
    m.x += m.v * dt;
    if (m.x + m.w > MAX_X + m.w * 0.5 && m.v > 0) m.v = -m.v;
    if (m.x < MIN_X - m.w * 0.5 && m.v < 0) m.v = -m.v;
  }

  // ---------- Drawing ----------

  function draw(ctx) {
    ctx.fillStyle = '#12141f';
    ctx.fillRect(0, 0, W, H);

    // Tab bar at the top
    ctx.fillStyle = '#181a26';
    ctx.fillRect(0, 0, W, 34);
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(0, 0, 140, 34);
    ctx.fillStyle = '#d4d4d4';
    ctx.font = '12px monospace';
    ctx.fillText('● stack.js', 14, 22);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 34, W, H - 34);
    ctx.clip();
    ctx.translate(0, -cam);

    // Line-number gutter
    ctx.fillStyle = '#161826';
    ctx.fillRect(0, cam, GUTTER, H);
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    const first = Math.max(0, Math.floor((BASE_Y - (cam + H)) / ROW));
    const lastRow = Math.ceil((BASE_Y - cam) / ROW) + 1;
    for (let i = first; i <= lastRow; i++) {
      const y = rowY(i);
      ctx.fillStyle = i === rows.length ? '#d4d4d4' : '#4a4f63';
      ctx.fillText(String(i + 1), GUTTER - 6, y + 17);
    }
    ctx.textAlign = 'left';

    // Foundation
    ctx.fillStyle = '#1b1e2c';
    ctx.fillRect(GUTTER, BASE_Y + ROW, W - GUTTER, 400);

    // Rows never cover the line-number gutter.
    ctx.save();
    ctx.beginPath();
    ctx.rect(GUTTER, cam, W - GUTTER, H);
    ctx.clip();
    rows.forEach((r, i) => drawRow(ctx, r.x, rowY(i), r.w, r.text, r.color, 1));
    if (state !== 'over') {
      // Dashed guide under the moving row
      const top = rows[rows.length - 1];
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(top.x + 0.5, rowY(rows.length) + 0.5, top.w - 1, ROW - 1);
      ctx.setLineDash([]);
      const m = moving;
      drawRow(ctx, m.x, rowY(rows.length), m.w, m.text, m.color, 1);
      // blinking cursor
      if (Math.floor(t * 2) % 2) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(m.x + m.w + 3, rowY(rows.length) + 4, 2, ROW - 8);
      }
    }
    ctx.restore();
    for (const f of falling) {
      ctx.save();
      ctx.translate(f.x + f.w / 2, f.y + ROW / 2);
      ctx.rotate(f.rot);
      drawRow(ctx, -f.w / 2, -ROW / 2, f.w, f.text, f.color, 0.7);
      ctx.restore();
    }
    for (const p of popups) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.c;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(p.text, Math.max(90, Math.min(W - 90, p.x)), p.y);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    drawHud(ctx);
  }

  function drawRow(ctx, x, y, w, text, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, ROW - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, y + ROW - 5, w, 3);
    if (text) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 2, y, w - 4, ROW);
      ctx.clip();
      ctx.fillStyle = '#12141f';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(text, x + 6, y + 17);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawHud(ctx) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#9a9fb0';
    ctx.font = '12px monospace';
    ctx.fillText(`best ${HD.best('stack')}`, W - 12, 22);
    ctx.textAlign = 'left';
    if (state === 'play') ui.bigScore(ctx, String(score()), W / 2 + GUTTER / 2, 90);

    if (state === 'ready') {
      ui.card(ctx, 30, 110, W - 60, 190);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd43b';
      ctx.font = 'bold 28px monospace';
      ctx.fillText('Stack Overflow', W / 2, 150);
      ui.levelTag(ctx, W / 2, 172);
      ctx.fillStyle = '#d4d4d4';
      ctx.font = '13px monospace';
      ctx.fillText('Stack the lines of code:', W / 2, 202);
      ctx.fillText('whatever hangs over gets cut off.', W / 2, 220);
      ctx.fillText('3 perfect drops = a wider row', W / 2, 244);
      ctx.fillStyle = '#9cdcfe';
      ctx.fillText('SPACE / click: drop the row', W / 2, 276);
      ctx.textAlign = 'left';
    }
    if (state === 'over') {
      ui.overCard(ctx, W, H, {
        title: 'Stack Overflow!', color: '#f48771', score: score(), best: HD.best('stack'), record,
        subtitle: `Exception at line ${rows.length + 1}`
      });
    }
  }

  HD.register({
    id: 'stack',
    name: 'Stack Overflow',
    tagline: 'Stack lines of code ☰',
    color: '#ffd43b',
    W, H,
    reset,
    update,
    draw,
    press,
    release() {},
    playing: () => state === 'play',
    icon(ctx, x, y) {
      const cols = ['#569cd6', '#4ec9b0', '#c586c0', '#dcdcaa'];
      cols.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(x - 22 + (i % 2) * 6 - i * 2, y + 18 - i * 12, 40 - i * 4, 10);
      });
    }
  });

  reset();
})();
