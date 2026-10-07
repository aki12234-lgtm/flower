// Rendering.
//
// One continuous vertical canvas. Point 0 sits at world (0,0) on the ground
// line; scrolling down walks back through the plant's history, and nothing is
// ever cleared or reset when the material or the scene changes.
//
// Each section is drawn once into its own offscreen canvas and then blitted.
// The raster materials (ASCII, halftone, dither, charcoal) are far too
// expensive to redraw every frame, and caching per section is also what makes
// the abrupt material joins free: the renderer never has to reconcile two
// neighbouring styles, it just blits them next to each other.

import { makeRng, clamp, lerp, smoothstep, noise2 } from './rng.js';
import { MATERIAL_BY_ID, MATERIALS, buildRibbon, makePalette, roundCorners, stemProfile,
         ribbonPath, nodeOutlines, bloomTransform, LIGHT } from './materials.js';
import { ENV_BY_ID, ENVIRONMENTS, buildBands, dominantEnv, mixHex, FADE } from './environment.js';

const CACHE_SCALE = 1.4;      // offscreen pixels per world unit
const MAX_CACHE_EDGE = 2200;  // beyond this a section is drawn straight to screen
const CACHE_BUDGET = 3;       // section re-renders allowed per frame

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.caches = new Map();
    this.dpr = 1;
    this.w = 1;
    this.h = 1;
    this.particles = [];
    this.flash = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Screen y at which the world y in `cam.y` is drawn.
   * Kept high on the screen: the newest growth sits here, so there has to be
   * headroom above it and clear space below for the prompt panel.
   */
  anchor() { return this.h * 0.40; }

  /** The camera y that puts `worldY` at `frac` of the way down the screen. */
  camYToPlaceAt(worldY, frac, zoom) {
    return worldY - (this.anchor() - frac * this.h) / zoom;
  }

  /** The camera y that centres `worldCentreY` on the screen. */
  camYToCentre(worldCentreY, zoom) {
    return this.camYToPlaceAt(worldCentreY, 0.5, zoom);
  }

  toScreen(cam, wx, wy) {
    return {
      x: this.w / 2 + (wx - cam.x) * cam.zoom,
      y: this.anchor() - (wy - cam.y) * cam.zoom,
    };
  }

  toWorld(cam, sx, sy) {
    return {
      x: (sx - this.w / 2) / cam.zoom + cam.x,
      y: (this.anchor() - sy) / cam.zoom + cam.y,
    };
  }

  invalidate(step) {
    if (step === undefined) this.caches.clear();
    else this.caches.delete(step);
  }

  // ------------------------------------------------------------ background --

  drawEnvironment(cam, sections, time) {
    const ctx = this.ctx;
    const bands = buildBands(sections);
    const topWorld = this.toWorld(cam, 0, 0).y;
    const botWorld = this.toWorld(cam, 0, this.h).y;

    ctx.fillStyle = '#0b0b0e';
    ctx.fillRect(0, 0, this.w, this.h);

    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      const env = ENV_BY_ID[b.id] || ENVIRONMENTS[0];
      const yTop = this.toScreen(cam, 0, b.top).y;
      const yBot = this.toScreen(cam, 0, b.bottom).y;
      const fadePx = FADE * cam.zoom;
      if (yTop > this.h + 4 || yBot < -fadePx - 4) continue;

      const drawTop = Math.max(-4, yTop);
      const drawBot = Math.min(this.h + 4, yBot + fadePx);
      if (drawBot <= drawTop) continue;

      ctx.fillStyle = this.bandGradient(env, yTop, yBot, i === 0 ? 0 : fadePx);
      ctx.fillRect(0, drawTop, this.w, drawBot - drawTop);
    }

    const env = dominantEnv(bands, botWorld, topWorld);
    this.drawGlow(env, time);
    this.drawHaze(env, cam);
    this.ambient(env, cam, time);
    this.drawGrain();
    return env;
  }

  /**
   * The scene's light source. Without one the sky is a gradient; with one there
   * is somewhere the light is coming from, which is also where the plant's own
   * shading says it comes from.
   */
  drawGlow(env, time) {
    const g = env.glow;
    if (!g) return;
    const ctx = this.ctx;
    const cx = g.x * this.w;
    const cy = g.y * this.h;
    const r = g.r * Math.max(this.w, this.h) * 0.62;
    const breathe = 1 + Math.sin(time * 0.00017) * 0.03;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * breathe);
    const [rr, gg, bb] = rgbOf(g.color);
    grad.addColorStop(0, `rgba(${rr},${gg},${bb},${g.strength})`);
    grad.addColorStop(0.35, `rgba(${rr},${gg},${bb},${g.strength * 0.34})`);
    grad.addColorStop(0.7, `rgba(${rr},${gg},${bb},${g.strength * 0.08})`);
    grad.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
  }

  /** Air thickens towards the ground: a band of light sitting on the horizon. */
  drawHaze(env, cam) {
    const ctx = this.ctx;
    const y = this.toScreen(cam, 0, 0).y;
    if (y < -this.h || y > this.h * 2) return;
    const reach = Math.max(120, this.h * 0.5);
    const grad = ctx.createLinearGradient(0, y - reach, 0, y);
    const [r, g, b] = rgbOf(env.light);
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},${env.dark ? 0.03 : 0.06})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - reach, this.w, reach);
  }

  /**
   * A dither pass over the background.
   * Large canvas gradients band badly on 8-bit displays, and the banding is the
   * single most artificial-looking thing about a full-screen sky. Overlaying
   * noise centred on mid-grey breaks the steps without shifting the colour.
   */
  drawGrain() {
    const ctx = this.ctx;
    if (!this.noiseTile) this.noiseTile = makeNoiseTile();
    if (!this.noisePattern) this.noisePattern = ctx.createPattern(this.noiseTile, 'repeat');
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.40;
    ctx.fillStyle = this.noisePattern;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
  }

  /** Drawn last of all, over the plant, to settle the edges of the frame. */
  drawVignette(env) {
    const ctx = this.ctx;
    const grad = ctx.createRadialGradient(
      this.w * 0.5, this.h * 0.45, Math.min(this.w, this.h) * 0.34,
      this.w * 0.5, this.h * 0.45, Math.max(this.w, this.h) * 0.78
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, env.dark ? 'rgba(0,0,0,0.22)' : 'rgba(24,18,10,0.10)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  /**
   * A band's sky ramp, in screen space, with an alpha fade along its lower edge
   * so one scene dissolves into the next over several turns while material
   * changes stay abrupt.
   */
  bandGradient(env, yTop, yBot, fadePx) {
    const ctx = this.ctx;
    const span = Math.max(1, yBot - yTop);
    const g = ctx.createLinearGradient(0, yTop, 0, yBot + fadePx);
    const total = span + fadePx;
    const STOPS = 10;
    for (let i = 0; i <= STOPS; i++) {
      const t = i / STOPS;
      const yy = t * total;
      const colourT = clamp(yy / span, 0, 1);
      const alpha = fadePx > 0 ? 1 - smoothstep((yy - span) / fadePx) : 1;
      g.addColorStop(t, withAlpha(sampleRamp(env.sky, colourT), alpha));
    }
    return g;
  }

  // --------------------------------------------------------------- ambient --

  ambient(env, cam, time) {
    const ctx = this.ctx;
    const cfg = env.particles || { kind: 'none', rate: 0 };
    const want = Math.round(cfg.rate * 55);

    while (this.particles.length < want) this.particles.push(newParticle(this.w, this.h));
    while (this.particles.length > want) this.particles.pop();

    const wind = Math.sin(time * 0.00021) * 0.6 + Math.sin(time * 0.00071) * 0.4;
    this.wind = wind;

    ctx.save();
    for (const p of this.particles) {
      stepParticle(p, cfg.kind, wind, this.w, this.h);
      drawParticle(ctx, p, cfg.kind, env);
    }
    ctx.restore();

    if (env.veil) {
      ctx.fillStyle = withAlpha(sampleRamp(env.sky, 0.4), env.veil);
      ctx.fillRect(0, 0, this.w, this.h);
    }

    if (env.flash) {
      this.flash *= 0.88;
      if (this.flash < 0.01 && Math.random() < 0.004) this.flash = 0.55;
      if (this.flash > 0.01) {
        ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.5})`;
        ctx.fillRect(0, 0, this.w, this.h);
      }
    }
  }

  // ----------------------------------------------------------------- plant --

  drawGround(cam, env) {
    const ctx = this.ctx;
    const y = this.toScreen(cam, 0, 0).y;
    if (y < -60 || y > this.h + 400) return;

    const depth = Math.max(200, (this.h - y) + 40);
    const g = ctx.createLinearGradient(0, y, 0, y + depth);
    g.addColorStop(0, 'rgba(62,51,39,0.95)');
    g.addColorStop(0.10, 'rgba(46,37,28,0.97)');
    g.addColorStop(0.42, 'rgba(29,23,17,0.99)');
    g.addColorStop(1, 'rgba(12,10,8,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, this.w, this.h - y + 10);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, this.w, this.h - y + 10);
    ctx.clip();

    // grit, thinning with depth
    for (let i = 0; i < 420; i++) {
      const n = noise2(i * 1.7, i * 0.31, 21);
      const px = n * this.w * 1.6 % this.w;
      const d = Math.pow(noise2(i * 0.13, i * 2.9, 7), 1.8);
      const py = y + d * depth;
      const a = 0.16 * (1 - d);
      ctx.fillStyle = i % 3 ? `rgba(150,128,96,${a})` : `rgba(20,15,10,${a * 1.6})`;
      ctx.fillRect(px, py, 1.4, 1.4);
    }

    // the surface itself: a lit lip on the light side of the break
    ctx.beginPath();
    for (let x = 0; x <= this.w; x += 6) {
      const n = Math.sin(x * 0.09) * 1.4 + Math.sin(x * 0.031) * 2.2 + Math.sin(x * 0.007) * 3.2;
      if (x === 0) ctx.moveTo(x, y + n); else ctx.lineTo(x, y + n);
    }
    const lip = ctx.createLinearGradient(0, y - 6, 0, y + 8);
    const [r, gg, b] = rgbOf(env?.light || '#f3e6cf');
    lip.addColorStop(0, `rgba(${r},${gg},${b},0.5)`);
    lip.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    ctx.strokeStyle = lip;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * @param {object} opts { growingStep, growProgress, time, selected }
   */
  drawPlant(cam, engine, opts = {}) {
    const ctx = this.ctx;
    let budget = CACHE_BUDGET;
    const sway = Math.sin(opts.time * 0.0004) * 1.3 + Math.sin(opts.time * 0.0011) * 0.7;

    for (const section of engine.plant.sections) {
      const b = section.bounds;
      const tl = this.toScreen(cam, b.minX, b.maxY);
      const br = this.toScreen(cam, b.maxX, b.minY);
      if (br.y < -80 || tl.y > this.h + 80 || br.x < -80 || tl.x > this.w + 80) continue;

      const growing = section.step === opts.growingStep;
      const progress = growing ? opts.growProgress : 1;

      // A little sway on growth well clear of the ground, so the organism is
      // never completely still. Kept small: the joins between cached sections
      // would shear if it were not.
      const drift = b.minY > 260 ? sway * Math.min(1, (b.minY - 260) / 900) : 0;

      if (growing || !this.blitCached(ctx, cam, section, drift, budget > 0)) {
        ctx.save();
        ctx.translate(tl.x + drift, tl.y);
        // World space is y-up; the canvas is y-down. The negative y scale is
        // what reconciles them, and it is also why the ASCII material has to
        // flip back before it draws a glyph.
        ctx.scale(cam.zoom, -cam.zoom);
        ctx.translate(-b.minX, -b.maxY);
        drawSectionInto(ctx, section, progress);
        ctx.restore();
        if (section.dirty && !growing) budget--;
      }

      if (opts.selected === section.step) this.outline(cam, section, drift);
    }
  }

  outline(cam, section, drift) {
    const ctx = this.ctx;
    const b = section.bounds;
    const tl = this.toScreen(cam, b.minX, b.maxY);
    const br = this.toScreen(cam, b.maxX, b.minY);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,246,224,0.65)';
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.x + drift - 6, tl.y - 6, br.x - tl.x + 12, br.y - tl.y + 12);
    ctx.restore();
  }

  blitCached(ctx, cam, section, drift, mayBuild) {
    let cache = this.caches.get(section.step);
    if ((!cache || section.dirty) && mayBuild) {
      cache = this.buildCache(section);
      if (cache) { this.caches.set(section.step, cache); section.dirty = false; }
    }
    if (!cache) return false;
    const tl = this.toScreen(cam, cache.minX, cache.maxY);
    const w = (cache.maxX - cache.minX) * cam.zoom;
    const h = (cache.maxY - cache.minY) * cam.zoom;
    ctx.drawImage(cache.canvas, tl.x + drift, tl.y, w, h);
    return true;
  }

  buildCache(section) {
    const b = section.bounds;
    const wWorld = b.maxX - b.minX;
    const hWorld = b.maxY - b.minY;
    let scale = CACHE_SCALE;
    const longest = Math.max(wWorld, hWorld) * scale;
    if (longest > MAX_CACHE_EDGE) scale *= MAX_CACHE_EDGE / longest;
    const pw = Math.max(1, Math.ceil(wWorld * scale));
    const ph = Math.max(1, Math.ceil(hWorld * scale));
    if (pw * ph > 6.5e6) return null; // absurdly large section: draw it live

    const c = document.createElement('canvas');
    c.width = pw;
    c.height = ph;
    const cx = c.getContext('2d');
    cx.scale(scale, -scale); // world is y-up, the canvas is y-down
    cx.translate(-b.minX, -b.maxY);
    drawSectionInto(cx, section, 1);
    return { canvas: c, minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY };
  }

  /** Topmost section whose bounds contain the point, for the history inspector. */
  sectionAtPoint(cam, engine, sx, sy) {
    const w = this.toWorld(cam, sx, sy);
    let best = null;
    for (const s of engine.plant.sections) {
      if (!s.promptId) continue;
      const b = s.bounds;
      if (w.x < b.minX - 8 || w.x > b.maxX + 8 || w.y < b.minY - 8 || w.y > b.maxY + 8) continue;
      if (!best || s.step > best.step) best = s;
    }
    return best;
  }
}

// ------------------------------------------------------------------ section --

/** Truncate a segment's points to the growth animation's current micro-step. */
function revealPoints(points, progress, steps) {
  if (progress >= 1) return points;
  const kMax = progress * steps;
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.k <= kMax) { out.push(p); continue; }
    const prev = points[i - 1];
    if (!prev) break;
    const span = p.k - prev.k;
    const f = span > 0 ? clamp((kMax - prev.k) / span, 0, 1) : 0;
    if (f > 0.02) {
      out.push({ x: lerp(prev.x, p.x, f), y: lerp(prev.y, p.y, f), w: lerp(prev.w, p.w, f), k: kMax });
    }
    break;
  }
  return out;
}

export function drawSectionInto(ctx, section, progress = 1) {
  const mat = MATERIAL_BY_ID[section.materialId] || MATERIALS[0];
  const env = ENV_BY_ID[section.envId] || ENVIRONMENTS[0];
  // Seeded per section, so a re-render is pixel-identical to the last one.
  const rng = makeRng(1013 + section.step * 7919);
  const P = makePalette(mat, rng, section.vitality ?? 1, env, section.baseHue ?? null);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const kMax = progress * section.steps;
  const ribbons = [];
  for (const seg of section.segments) {
    const pts = revealPoints(seg.points, progress, section.steps);
    if (pts.length < 2) continue;
    const prof = mat.graphic ? { points: pts, nodes: [] }
      : stemProfile(roundCorners(pts), 44 + (section.step % 4) * 7, 0.24);
    ribbons.push({ seg, pts, rib: buildRibbon(prof.points), nodeAt: prof.nodes });
  }

  // Cast shadow onto the backdrop, before anything else.
  //
  // This does more for believability than any amount of surface texture: a
  // shape with no shadow is floating in front of a colour, and a shape with one
  // is an object standing in a room. It is drawn per section, so a member only
  // shadows the ground behind it rather than the rest of the plant — real
  // inter-object shadows would mean giving up the per-section cache.
  if (!mat.graphic) {
    ctx.save();
    ctx.translate(-LIGHT.x * 7, -LIGHT.y * 7);
    ctx.filter = 'blur(4.5px)';
    ctx.fillStyle = 'rgba(20,16,10,0.19)';
    for (const { rib } of ribbons) { ribbonPath(ctx, rib); ctx.fill(); }
    for (const n of section.nodes) {
      if (n.k > kMax) continue;
      ctx.save();
      bloomTransform(ctx, n);
      for (const part of nodeOutlines(n.kind, n.size, makeRng(n.seed))) {
        ctx.beginPath();
        ctx.moveTo(part.points[0].x, part.points[0].y);
        for (const q of part.points) ctx.lineTo(q.x, q.y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  for (const { seg, pts, rib, nodeAt } of ribbons) {
    ctx.save();
    ctx.globalAlpha = 1;
    mat.stem(ctx, rib, seg, P, rng, nodeAt);
    ctx.restore();
    if (seg.broken && progress >= 1) drawBreak(ctx, pts[pts.length - 1], P, rng);
  }

  for (const n of section.nodes) {
    if (n.k > kMax) continue;
    ctx.save();
    mat.node(ctx, n, P, rng);
    ctx.restore();
  }
}

/** A snapped end, for growth that failed structurally. */
function drawBreak(ctx, p, P, rng) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.strokeStyle = P.deep;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * p.w * 0.7, Math.sin(a) * p.w * 0.7);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- particles --

function newParticle(w, h) {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: 0, vy: 0,
    r: Math.random(),
    seed: Math.random(),
    life: Math.random(),
  };
}

function stepParticle(p, kind, wind, w, h) {
  switch (kind) {
    case 'rain':
      p.x += wind * 3.4 + 1.2;
      p.y += 9 + p.r * 7;
      break;
    case 'mist':
      p.x += wind * 0.5 + Math.sin(p.seed * 40 + p.y * 0.01) * 0.25;
      p.y -= 0.12 + p.r * 0.15;
      break;
    case 'dust':
      p.x += wind * 1.1 + 0.35;
      p.y += Math.sin(p.seed * 30 + p.x * 0.01) * 0.25;
      break;
    case 'pollen':
      p.x += wind * 0.9;
      p.y -= 0.25 + p.r * 0.4;
      break;
    case 'motes':
      p.x += wind * 0.35;
      p.y -= 0.18 + p.r * 0.3;
      break;
    case 'stars':
      p.life += 0.008;
      break;
    default:
      break;
  }
  if (p.x < -20) p.x = w + 20;
  if (p.x > w + 20) p.x = -20;
  if (p.y < -20) { p.y = h + 20; p.x = Math.random() * w; }
  if (p.y > h + 20) { p.y = -20; p.x = Math.random() * w; }
}

function drawParticle(ctx, p, kind, env) {
  switch (kind) {
    case 'rain':
      ctx.strokeStyle = `rgba(210,225,240,${0.18 + p.r * 0.25})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 2, p.y - 11 - p.r * 8);
      ctx.stroke();
      break;
    case 'mist':
      ctx.fillStyle = `rgba(226,226,222,${0.035 + p.r * 0.05})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 26 + p.r * 60, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'dust':
      ctx.fillStyle = `rgba(232,214,180,${0.14 + p.r * 0.22})`;
      ctx.fillRect(p.x, p.y, 1.3, 1.3);
      break;
    case 'pollen':
      ctx.fillStyle = `rgba(255,246,214,${0.20 + p.r * 0.3})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.8 + p.r * 1.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'motes':
      ctx.fillStyle = `rgba(200,232,228,${0.12 + p.r * 0.22})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.7 + p.r * 1.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'stars': {
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(p.life + p.seed * 9));
      ctx.fillStyle = `rgba(236,240,255,${(0.25 + p.r * 0.6) * tw})`;
      const s = 0.7 + p.r * 1.4;
      ctx.fillRect(p.x, p.y, s, s);
      break;
    }
    default:
      break;
  }
}

// ------------------------------------------------------------------ colour --

function sampleRamp(stops, t) {
  const x = clamp(t, 0, 1);
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      const f = p1 === p0 ? 0 : (x - p0) / (p1 - p0);
      return mixHex(c0, c1, f);
    }
  }
  return stops[stops.length - 1][1];
}

function withAlpha(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${clamp(a, 0, 1)})`;
}

function rgbOf(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 64px of mid-grey noise, built once and tiled. */
function makeNoiseTile() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 64);
  // deterministic, so the grain does not crawl between renders
  let s = 0x9e3779b9;
  const rand = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (rand() - 0.5) * 40;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
