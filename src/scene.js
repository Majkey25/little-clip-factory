import { CONFIG, makerRate, sellRate, worldFloor } from './game.js';

const WIDTH = 960;
const HEIGHT = 480;
const MACHINE_X = [2.4, 4.05, 5.5, 6.95];
const STEEL = { top: '#dde6ec', left: '#8d9faa', right: '#becbd4' };
const DARK = { top: '#435664', left: '#263843', right: '#344955' };
const COPPER = { top: '#e7ae71', left: '#a96b3e', right: '#c98750' };

/** Presentation only. The game model owns production, resources and saved state.
 * @param {HTMLCanvasElement} canvas
 */
export function createFactoryScene(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return { update() {}, dispose() {} };
  let state;
  let previous;
  let options = { motion: true, canPlay: true, lang: 'en' };
  let frame = 0;
  let lastFrame = 0;
  let phase = 0;
  let manualUntil = 0;
  let saleUntil = 0;
  let disposed = false;
  let contextLost = false;
  let inView = true;
  let cssWidth = WIDTH;
  let cssHeight = HEIGHT;
  let lastVisual = '';

  const iso = (x, y, z = 0) => [320 + (x - y) * 42, 75 + (x + y) * 22 - z * 58];
  const land = (x, y, z = 0) => [798 + (x - y) * 35, 130 + (x + y) * 18 - z * 45];

  function polygon(points, fill, stroke) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); }
  }

  function line(points, color, width = 2) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function ellipse(x, y, rx, ry, fill, stroke) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  function box(x, y, w, d, h, colors, project = iso, base = 0) {
    const a = project(x, y, h), b = project(x + w, y, h);
    const c = project(x + w, y + d, h), e = project(x, y + d, h);
    polygon([e, c, project(x + w, y + d, base), project(x, y + d, base)], colors.left);
    polygon([b, project(x + w, y, base), project(x + w, y + d, base), c], colors.right);
    polygon([a, b, c, e], colors.top);
  }

  function paperclip(x, y, size = 1, rotation = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(size, size);
    ctx.beginPath();
    ctx.moveTo(-5, 3);
    ctx.lineTo(8, 3);
    ctx.bezierCurveTo(17, 3, 17, -8, 8, -8);
    ctx.lineTo(-10, -8);
    ctx.bezierCurveTo(-22, -8, -22, 9, -10, 9);
    ctx.lineTo(10, 9);
    ctx.strokeStyle = '#eff7fa';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function label(value, x, y) {
    const scale = Math.min(cssWidth / WIDTH, cssHeight / HEIGHT);
    ctx.font = `600 ${Math.min(36, Math.max(24, 12 / scale))}px system-ui, sans-serif`;
    ctx.fillStyle = '#435965';
    ctx.textAlign = 'center';
    ctx.fillText(value, x, y);
  }

  function working(now) {
    const running = state.running && !state.ending;
    const harvesting = running && state.harvesters > 0 && state.world > worldFloor(state)
      && (state.policy !== 'protect' || state.wire < CONFIG.wireBuffer);
    const producing = running && makerRate(state) > 0 && (state.wire > 0 || harvesting);
    const selling = running && sellRate(state) > 0 && (state.inventory > 0 || producing);
    return { producing, harvesting, selling, manual: now < manualUntil, sale: now < saleUntil };
  }

  function visualSignature(now) {
    const work = working(now);
    return [Math.min(13, Math.ceil(state.wire / 25)), state.wire > 0,
      Math.min(10, Math.ceil(state.inventory)), Math.min(3, state.makers),
      state.phase >= 3 ? state.world : '', state.phase >= 3 ? state.policy : '',
      state.phase >= 3 ? Math.min(3, state.harvesters) : 0,
      state.upgrades.jigs, state.upgrades.autoSell, state.upgrades.recycling,
      work.producing, work.harvesting, work.selling, work.manual, work.sale,
      options.motion, options.canPlay, options.lang].join('|');
  }

  function floor() {
    box(0, 0, 9.6, 5, 0, { top: '#e7edf0', left: '#b4c2cc', right: '#cad6dd' }, iso, -.2);
    for (let x = 0; x <= 9; x++) line([iso(x, 0), iso(x, 5)], '#d1dce2', 1);
    for (let y = 0; y <= 5; y++) line([iso(0, y), iso(9.6, y)], '#d1dce2', 1);
    // Safety strips and a utility duct follow the actual factory floor.
    line([iso(.1, 4.9, .01), iso(9.5, 4.9, .01)], '#b68b45', 4);
    line([iso(.2, .2, .02), iso(9.4, .2, .02)], '#9baebc', 6);
    for (let i = 0; i < 10; i++) {
      line([iso(i + .1, 4.75, .03), iso(i + .35, 5, .03)], '#e2bc72', 5);
    }
  }

  function spool(moving) {
    const [x, y] = iso(.7, 2.7, .2);
    box(.05, 2.1, 1.3, 1.1, .28, DARK);
    polygon([[x - 30, y - 30], [x + 30, y - 30], [x + 30, y + 2], [x - 30, y + 2]], '#8196a4');
    const turns = Math.min(13, Math.ceil(state.wire / 25));
    for (let i = 0; i < turns; i++) {
      ellipse(x, y - 29 + i * 2.3, 26, 12, '#bd8350', '#ddb17e');
    }
    ellipse(x, y + 5, 39, 18, '#738b9c', '#405c6e');
    ellipse(x, y - 35, 39, 18, '#bfd0da', '#7c97a8');
    ellipse(x, y - 35, 14, 7, '#405764');
    const angle = moving ? phase * 2.2 : 0;
    line([[x, y - 35], [x + Math.cos(angle) * 30, y - 35 + Math.sin(angle) * 13]], '#829baa', 4);
  }

  function wireFeed(count, harvesting) {
    if (state.wire <= 0 && !harvesting) return;
    // The shared feed clears the rear roof edge, keeping every inlet visible.
    line([iso(.95, 2.6, .7), iso(.95, .85, 1.34), iso(MACHINE_X[count] + .6, .85, 1.34)], '#c18a51', 4);
    for (let i = 0; i <= count; i++) {
      line([iso(MACHINE_X[i] + .6, .85, 1.34), iso(MACHINE_X[i] + .6, 1.25, 1.34)], '#c18a51', 4);
    }
  }

  function machine(x, manual, active, animate) {
    const y = 1.25;
    const lift = active && animate ? Math.sin(phase * 7 + x) * .075 : 0;
    box(x, y, 1.25, 1.1, .36, DARK);
    box(x, y, .23, 1.1, 1.34, STEEL);
    box(x + 1.02, y, .23, 1.1, 1.34, STEEL);
    box(x, y, 1.25, 1.1, 1.34, { top: '#f0f4f6', left: '#9aadb9', right: '#bfccd4' });
    // Open front exposes the die, piston and the wire bend.
    polygon([iso(x + .22, y + 1.11, 1.15), iso(x + 1.03, y + 1.11, 1.15),
      iso(x + 1.03, y + 1.11, .38), iso(x + .22, y + 1.11, .38)], '#263d4a');
    line([iso(x + .62, y + 1.13, 1.13), iso(x + .62, y + 1.13, .82 + lift)], '#cbd7df', 8);
    line([iso(x + .35, y + 1.13, .76 + lift), iso(x + .9, y + 1.13, .76 + lift)], '#dfac72', 6);
    line([iso(x + .24, y + 1.14, .43), iso(x + 1, y + 1.14, .43)], '#8ea6b5', 7);
    box(x + .25, y + .25, .6, .48, 1.6, manual ? COPPER : DARK, iso, 1.34);
    const [lampX, lampY] = iso(x + 1.18, y + 1.11, 1.16);
    ellipse(lampX, lampY, 3.4, 3.4, active ? '#81e1c0' : '#718896');
    if (manual) {
      line([iso(x + .62, y + .5, 1.64), iso(x + .62, y - .1, 1.7)], '#495f6d', 5);
      const [handleX, handleY] = iso(x + .62, y - .1, 1.7);
      ellipse(handleX, handleY, 5, 4, '#c9854b');
    } else {
      for (let i = 0; i < 4; i++) line([iso(x + .25 + i * .16, y + .15, 1.35),
        iso(x + .25 + i * .16, y + .5, 1.35)], '#a8bbc7', 2);
    }
    if (state.upgrades.jigs) box(x + 1.26, y + .45, .17, .45, .75, COPPER);
    line([iso(x + .6, y + 1.1, .5), iso(x + .6, 3.2, .4)], '#a8bac6', 12);
    line([iso(x + .6, y + 1.1, .51), iso(x + .6, 3.2, .41)], '#435867', 7);
  }

  function conveyor(active, animate) {
    box(1.55, 3.15, 6.15, .7, .37, DARK);
    const start = 1.65, length = 5.95;
    for (let i = 0; i < 20; i++) {
      const x = start + ((i / 20 + (active && animate ? phase * .15 : 0)) % 1) * length;
      line([iso(x, 3.2, .385), iso(x, 3.8, .385)], '#68808f', 2);
    }
    line([iso(1.55, 3.15, .4), iso(7.7, 3.15, .4)], '#d1a068', 3);
    line([iso(1.55, 3.85, .4), iso(7.7, 3.85, .4)], '#e0b681', 3);
  }

  function clipsOnBelt(active, animate) {
    if (active) {
      for (let i = 0; i < 4; i++) {
        const x = 1.65 + ((i / 4 + (animate ? phase * .16 : 0)) % 1) * 5.95;
        const [px, py] = iso(x, 3.5, .42);
        paperclip(px, py, .65, .47);
      }
    }
  }

  function shipping(active, animate) {
    box(7.7, 3.05, .9, .9, .33, { top: '#92aaba', left: '#506c80', right: '#6f8da1' });
    polygon([iso(7.78, 3.13, .34), iso(8.52, 3.13, .34), iso(8.52, 3.87, .34), iso(7.78, 3.87, .34)], '#293e4b');
    const visibleStock = Math.min(10, Math.ceil(state.inventory));
    for (let i = 0; i < visibleStock; i++) {
      const [px, py] = iso(7.93 + (i % 3) * .15, 3.3 + Math.floor(i / 3) * .12, .36 + i * .008);
      paperclip(px, py, .46, -.4 + (i % 3) * .25);
    }
    if (state.upgrades.autoSell) {
      box(8.7, 1.4, .48, 1.8, .65, STEEL);
      const scan = iso(8.72, 2.5, .69);
      ellipse(scan[0], scan[1], 4, 3, active ? '#5ccaab' : '#6e8797');
      const offset = active && animate ? Math.sin(phase * 1.5) * .08 : 0;
      box(8.85 + offset, 3.2, .65, 1.1, .6, { top: '#91b8ce', left: '#51778d', right: '#6f94a9' });
      for (const y of [3.35, 4.1]) {
        const wheel = iso(9.5 + offset, y, .16);
        ellipse(wheel[0], wheel[1], 7, 9, '#273d4b');
      }
    }
  }

  function tree(x, y, alive) {
    const [px, py] = land(x, y, .14);
    line([[px, py], [px, py - (alive ? 31 : 5)]], '#8b7253', 4);
    if (!alive) { ellipse(px, py - 5, 4, 2.5, '#ad9a7b'); return; }
    for (let layer = 0; layer < 3; layer++) {
      const cy = py - 11 - layer * 9;
      const w = 15 - layer * 2;
      polygon([[px, cy - 19], [px - w, cy + 5], [px, cy + 10]], '#467965');
      polygon([[px, cy - 19], [px + w, cy + 5], [px, cy + 10]], '#629e78');
    }
  }

  function drone(x, y, active, animate, index) {
    const angle = active && animate ? phase * .85 + index * 2.1 : index * 2.1;
    const dx = active && animate ? Math.cos(angle) * 46 : index * 18 - 18;
    const dy = active && animate ? Math.sin(angle) * 17 : 0;
    x += dx; y += dy;
    ellipse(x, y + 44, 16, 5, '#bccac5');
    line([[x - 13, y - 4], [x + 13, y + 4]], '#3e5663', 3);
    line([[x + 13, y - 4], [x - 13, y + 4]], '#3e5663', 3);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const rx = x + sx * 15, ry = y + sy * 6;
      ellipse(rx, ry, 10, 4, '#d6e0e5', '#9cafb9');
      const spin = active && animate ? phase * 17 : 0;
      line([[rx - Math.cos(spin) * 8, ry - Math.sin(spin) * 3],
        [rx + Math.cos(spin) * 8, ry + Math.sin(spin) * 3]], '#5d7788', 2);
    }
    polygon([[x - 8, y - 5], [x + 8, y - 5], [x + 8, y + 7], [x - 8, y + 7]], '#506d7e');
    if (active) {
      line([[x, y + 7], [x, y + 16]], '#869ca8', 2);
      ellipse(x, y + 20, 8, 5, '#c99867');
    }
  }

  function resources(active, animate) {
    if (state.phase < 3) return;
    const preserved = state.world / 100;
    box(0, 0, 3.8, 3.8, .18, {
      top: preserved > .5 ? '#a9c0a7' : '#b9b9a4', left: '#87997d', right: '#97a68a',
    }, land);
    const cleared = (1 - preserved) * 3.7;
    if (cleared > .03) polygon([land(.1, .1, .19), land(cleared, .1, .19),
      land(cleared, 3.7, .19), land(.1, 3.7, .19)], '#bba78b');
    const positions = [[3, .45], [2.35, .75], [3.25, 1.45], [1.45, .35], [2.2, 1.9],
      [3.2, 2.5], [.75, 1], [1.2, 2.05], [2.2, 2.85], [.45, 2.4], [1, 3.15], [3.2, 3.3]];
    positions.forEach(([x, y], i) => tree(x, y, i < Math.ceil(preserved * positions.length)));
    box(.35, .25, .65, .75, .5, { top: '#ccd8da', left: '#58737b', right: '#769198' }, land);
    line([land(.55, .45, .56), land(.95, .8, .56)], '#c7a06d', 5);
    if (state.policy === 'protect') {
      const border = [land(.05, .05, .2), land(3.75, .05, .2), land(3.75, 3.75, .2), land(.05, 3.75, .2), land(.05, .05, .2)];
      line(border, '#538d73', 4);
      for (let i = 0; i < 5; i++) line([land(.05, i * .75, .2), land(.05, i * .75, .4)], '#52856c', 3);
    }
    const count = Math.min(3, state.harvesters);
    for (let i = 0; i < count; i++) drone(798, 155 + i * 12, active, animate, i);
  }

  function draw(now) {
    if (!state || disposed || contextLost || !inView || document.visibilityState === 'hidden') return;
    lastVisual = visualSignature(now);
    const scale = Math.min(canvas.width / WIDTH, canvas.height / HEIGHT);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#f1f5f6';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, (canvas.width - WIDTH * scale) / 2, (canvas.height - HEIGHT * scale) / 2);
    const glow = ctx.createRadialGradient(490, 200, 0, 490, 200, 480);
    glow.addColorStop(0, '#ffffff'); glow.addColorStop(1, '#e5edf0');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const work = working(now);
    const moving = options.motion && options.canPlay && document.visibilityState !== 'hidden';
    const makers = Math.min(3, state.makers);
    ellipse(408, 322, 310, 85, '#d8e2e6');
    resources(work.harvesting, moving);
    floor();
    spool(moving && (work.producing || work.manual));
    if (work.harvesting) {
      const start = land(.4, 2.8, .25), end = iso(MACHINE_X[makers] + .6, .85, 1.34);
      const t = moving ? (phase * .18) % 1 : .5;
      line([start, end], '#b4b9ae', 2);
      ellipse(start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t, 9, 4, '#c79059', '#f0ce9e');
    }
    conveyor(work.producing || work.manual, moving);
    machine(2.4, true, work.manual, moving);
    for (let i = 1; i <= makers; i++) machine(MACHINE_X[i], false, work.producing, moving);
    wireFeed(makers, work.harvesting);
    clipsOnBelt(work.producing || work.manual, moving);
    shipping(work.selling || work.sale, moving);
    if (state.upgrades.recycling) {
      box(1.3, 4.3, .65, .65, .55, { top: '#91bcb0', left: '#4e8172', right: '#6b9c8b' });
      line([iso(1.65, 4.7, .6), iso(.85, 3.3, .6), iso(.7, 2.7, .6)], '#5b907e', 4);
    }
    label(options.lang === 'cs' ? 'Drát' : 'Wire', 141, 128);
    label(options.lang === 'cs' ? 'Lis' : 'Press', 368, 40);
    label(options.lang === 'cs' ? 'Sponky' : 'Clips', 527, 454);
    if (state.phase >= 3) label(options.lang === 'cs' ? 'Zdroje' : 'Resources', 798, 302);
  }

  function animated(now) {
    if (!state || !options.motion || !options.canPlay || disposed || contextLost || !inView || document.visibilityState === 'hidden') return false;
    const work = working(now);
    return work.producing || work.harvesting || work.selling || work.manual || work.sale;
  }

  function tick(now) {
    frame = 0;
    if (!animated(now)) { draw(now); lastFrame = 0; return; }
    if (!lastFrame || now - lastFrame >= 1000 / 30) {
      const dt = lastFrame ? Math.min((now - lastFrame) / 1000, .1) : 0;
      phase += dt * state.speed;
      lastFrame = now;
      draw(now);
    }
    frame = requestAnimationFrame(tick);
  }

  function sync(now = performance.now()) {
    if (animated(now)) {
      if (!frame) { lastFrame = 0; frame = requestAnimationFrame(tick); }
    } else if (frame) {
      cancelAnimationFrame(frame); frame = 0; lastFrame = 0;
    }
  }

  function resize() {
    if (disposed) return;
    const bounds = canvas.getBoundingClientRect();
    cssWidth = Math.max(1, bounds.width || WIDTH);
    cssHeight = Math.max(1, bounds.height || HEIGHT);
    const dpr = Math.min(window.devicePixelRatio || 1, 2, 1600 / cssWidth);
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    draw(performance.now());
    sync();
  }

  function visibility() { sync(); draw(performance.now()); }
  function lost(event) { event.preventDefault(); contextLost = true; sync(); }
  function restored() { contextLost = false; resize(); }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);
  const viewportObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
    inView = entries.some((entry) => entry.isIntersecting);
    if (inView) draw(performance.now());
    sync();
  }) : null;
  viewportObserver?.observe(canvas);
  if (!observer) window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', visibility);
  canvas.addEventListener('contextlost', lost);
  canvas.addEventListener('contextrestored', restored);
  resize();

  return {
    /** @param {import('./game.js').GameState} next
     * @param {{motion?: boolean, canPlay?: boolean, lang?: 'en'|'cs', now?: number}} settings
     */
    update(next, settings = {}) {
      if (disposed) return;
      options = { motion: settings.motion ?? true, canPlay: settings.canPlay ?? true, lang: settings.lang ?? 'en' };
      const now = Number.isFinite(settings.now) ? settings.now : performance.now();
      // Same-time owner actions produce one clip; loading/resetting a save must not burst.
      if (previous?.canPlay && options.canPlay && next.time === previous.time && Math.abs(next.clips - previous.clips - 1) <= Number.EPSILON * Math.max(1, next.clips) * 2) manualUntil = now + 850;
      if (previous?.canPlay && options.canPlay && next.time === previous.time && next.inventory < previous.inventory && next.funds > previous.funds) saleUntil = now + 650;
      if (previous && (next.time < previous.time || next.clips < previous.clips || !options.canPlay)) manualUntil = saleUntil = 0;
      previous = { time: next.time, clips: next.clips, inventory: next.inventory, funds: next.funds, canPlay: options.canPlay };
      state = next;
      if (visualSignature(now) !== lastVisual && (!animated(now) || !frame)) draw(now);
      sync(now);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      viewportObserver?.disconnect();
      if (!observer) window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('contextlost', lost);
      canvas.removeEventListener('contextrestored', restored);
      state = previous = null;
    },
  };
}
