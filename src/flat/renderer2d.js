// The flat renderer (v4): the illustrated look, drawn in two dimensions.
//
// v3 printed its pictures from a 3D renderer: real geometry, lit by nothing,
// each pixel matched to an ink, and the lines found afterwards by looking for
// where one colour or one depth met another. This draws the same pictures with
// none of that. The plant and every thing in the world are outlines, each in
// one ink chosen once when it is made; the lines are strokes; depth is only
// which thing is laid down over which. A canvas and its 2D context are all it
// needs — no WebGL, no shaders to compile, nothing for a graphics driver to
// choke on — and the rest of the game cannot tell it from the 3D one: it
// answers the same questions about the camera, the same way.

import { PLACES, groundAt } from '../gl/scene.js';
import { linear } from '../gl/toon.js';
import { buildFlatPlant } from './plant2d.js';
import { batch, draw, drawPlantLive, silhouette, patternAlpha } from './paint.js';
import { css, atNight, overprint, mix, LINE } from './ink.js';
import { World, LINE_PX, HEAVY_PX } from './world2d.js';
import { Moving } from './moving2d.js';
import { boundsOf } from './shapes.js';

// The 3D camera's lens, kept so that every framing rule agrees (renderer3d.js).
const FOV = 0.30;
const EYE_FLOOR = 90;
const LOOK_FLOOR = -300;
const CAM_X_DAMP = 0.4;

/**
 * Most pixels to draw, whatever the display claims. Flat fills are cheap, so
 * this can be more than the 3D renderer allowed, and a print wants its lines
 * crisp; but it is still a browser game for ordinary machines.
 */
const MAX_RENDER_PIXELS = 1920 * 1200 * 1.6;

/**
 * How much may be kept, in screens' worth of pixels, of the things that stand
 * in front of something moving (see layerOf). A forest needs the most: its
 * trunks run the height of the screen, with deer and birds behind them.
 */
const LAYER_BUDGET = 3;

/** Where the drawn sun hangs, as a direction (SUN_SPOT in renderer3d.js). */
const SUN_SPOT = (() => {
  const l = Math.hypot(0.42, 0.20, -1.0);
  return [0.42 / l, 0.20 / l, -1.0 / l];
})();

/** A four-pointed sparkle at unit size: |x||y| < 0.04 and |x| + |y| < 1. */
const SPARKLE = (() => {
  const pts = [];
  for (let q = 0; q < 4; q++) {
    const rot = (x, y) => (q === 0 ? [x, y] : q === 1 ? [-y, x] : q === 2 ? [-x, -y] : [y, -x]);
    // from the tip on the +x arm, round the hyperbola to the tip on the +y arm
    pts.push(rot(1, 0));
    for (let k = 0; k <= 10; k++) {
      const x = 0.958 - (0.958 - 0.0417) * (k / 10) ** 0.5;
      pts.push(rot(x, 0.04 / x));
    }
  }
  return pts;
})();

export class Renderer2D {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('This browser could not open a 2D canvas.');
    this.gpuName = 'Canvas 2D';
    this.renderScale = 1;
    this.w = 0;
    this.h = 0;
    this.pw = 0;
    this.ph = 0;
    this.dpr = 1;
    this.worldKind = 0;
    this.nightness = 0;
    this.world = null;
    this.moving = null;
    this.plantKey = null;
    this.line = css(LINE);
    this.resize();
  }

  resize() {
    const cw = this.opts.width ?? (this.canvas.clientWidth || 800);
    const ch = this.opts.height ?? (this.canvas.clientHeight || 600);
    const want = Math.min(2, this.opts.dpr ?? ((typeof window !== 'undefined' && window.devicePixelRatio) || 1));
    const capped = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, cw * ch));
    const dpr = Math.max(0.5, Math.min(want, Math.max(1, capped)) * (this.renderScale ?? 1));
    const w = Math.max(1, Math.round(cw * dpr));
    const h = Math.max(1, Math.round(ch * dpr));
    if (w === this.pw && h === this.ph) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.dpr = dpr;
    this.w = cw;
    this.h = ch;
    this.pw = w;
    this.ph = h;
  }

  invalidate() { this.plantKey = null; this.settledKey = null; }

  /** The camera y that puts `worldY` at `frac` of the way down the frame. */
  camYToPlaceAt(worldY, frac, zoom) {
    return worldY - (0.5 - frac) * (this.h / Math.max(0.05, zoom));
  }

  camYToCentre(worldCentreY) { return worldCentreY; }

  /** The cam.x that puts a given world x in the middle (the eye takes 0.4 of it). */
  camXToCentre(worldX) { return worldX / CAM_X_DAMP; }

  get eyeFloor() { return EYE_FLOOR; }

  /**
   * Where the eye is, for a given framing — the 3D lens's own numbers, so the
   * world stands where it stood: one world unit is one CSS pixel at zoom 1 in
   * the plant's plane, the eye is held above the ground, and a framing lower
   * than that looks down at it rather than going under.
   */
  lens(cam) {
    const F = (this.h / 2) / Math.tan(FOV / 2);
    const zoom = Math.max(0.05, cam.zoom);
    const dist = F / zoom;
    const place = this.world ? this.world.place : PLACES[(this.worldKind ?? 0) % PLACES.length];
    const ex = cam.x * CAM_X_DAMP;
    const ey = Math.max(cam.y, EYE_FLOOR, groundAt(ex, dist, place) + 60);
    const lookY = Math.max(cam.y, LOOK_FLOOR);
    return { F, zoom, dist, ex, ey, lookY, tilt: (ey - lookY) * zoom };
  }

  /** World point (in the plant's plane) to screen pixels, for the history inspector. */
  project(cam, x, y) {
    const l = this.lens(cam);
    return { x: this.w / 2 + (x - l.ex) * l.zoom, y: this.h / 2 - (y - l.lookY) * l.zoom };
  }

  setWorld(kind, nightness) {
    this.worldKind = kind;
    this.nightness = nightness;
  }

  adapt(time) {
    const dt = this.lastTime === undefined ? 0 : time - this.lastTime;
    this.lastTime = time;
    if (!(dt > 2 && dt < 250) || this.fixedScale) return;
    this.frameMs = this.frameMs === undefined ? dt : this.frameMs * 0.94 + dt * 0.06;
    this.sinceScale = (this.sinceScale || 0) + dt;
    if (this.sinceScale < 2000) return;
    const scale = this.renderScale ?? 1;
    let next = scale;
    if (this.frameMs > 26 && scale > 0.6) {
      next = Math.max(0.6, scale - 0.15);
      this.scaleCeiling = Math.max(0.6, scale - 0.05);
    } else if (this.frameMs < 17.5 && scale < (this.scaleCeiling ?? 1)) {
      next = Math.min(this.scaleCeiling ?? 1, scale + 0.1);
    }
    if (next !== scale) {
      this.renderScale = next;
      this.sinceScale = 0;
    }
  }

  /** The view a frame is drawn through: the lens, and how to put things on the screen with it. */
  view(cam, time) {
    const l = this.lens(cam);
    const { w: W, h: H, dpr } = this;
    const { F, dist, ex, ey, tilt } = l;
    return {
      ...l, W, H, dpr, time, line: this.line,
      // where the canvas being drawn into starts, in device pixels: 0 for the
      // screen, and the corner of the plant's box for the plant's own layer
      ox: 0,
      oy: 0,
      /** How many pixels a world unit is, at depth z (0 is the plant's plane). */
      s: (z) => (z >= dist - 40 ? 0 : F / (dist - z)),
      X: (x, s) => W / 2 + (x - ex) * s,
      Y: (y, s) => H / 2 - (y - ey) * s - tilt,
      at(ctx, z) {
        const s = this.s(z);
        ctx.setTransform(s * dpr, 0, 0, -s * dpr,
          (W / 2 - ex * s) * dpr - this.ox, (H / 2 + ey * s - tilt) * dpr - this.oy);
        return s;
      },
      screen(ctx) { ctx.setTransform(dpr, 0, 0, dpr, -this.ox, -this.oy); },
      sees(it, s) {
        const x0 = this.X(it.x0, s);
        const x1 = this.X(it.x1, s);
        const y0 = this.Y(it.y1, s);
        const y1 = this.Y(it.y0, s);
        return x1 > -4 && x0 < W + 4 && y1 > -4 && y0 < H + 4;
      },
    };
  }

  ensureWorld() {
    const kind = this.worldKind ?? 0;
    if (!this.world || this.world.kind !== kind) {
      this.world = new World(kind);
      this.moving = new Moving(this.world);
    }
    this.world.setNight(this.nightness ?? 0);
  }

  /**
   * The plant's shapes, in order and grouped by ink. The settled part is kept
   * between frames; while a section grows in, only that section is made again,
   * and the two are put back into one order so they join as if made together.
   */
  ensurePlant(plant, reveal) {
    const growKey = reveal ? reveal.step + ':' + reveal.progress.toFixed(3) : '';
    const settledKey = plant.sections.length + ':' + (reveal ? reveal.step : '-');
    if (this.settledKey !== settledKey) {
      this.settledKey = settledKey;
      this.settled = buildFlatPlant(plant, reveal, reveal ? 'settled' : 'all');
      this.plantKey = null;
    }
    const key = settledKey + '|' + growKey;
    if (this.plantKey === key) return;
    this.plantKey = key;
    if (reveal) {
      // made again every frame until it has arrived: drawn straight from the
      // shapes, the growing ones after any settled one at the same depth
      const growing = buildFlatPlant(plant, reveal, 'growing');
      for (const s of growing) s.i += 1e6;
      this.plantLive = mergeByDepth(this.settled, growing);
      this.plantBounds = boundsOf(this.plantLive);
      return;
    }
    this.plantLive = null;
    this.plantBatches = batch(this.settled, { patterns: true });
    this.plantOutline = silhouette(this.settled);
    this.plantBounds = boundsOf(this.settled);
  }

  plantColour(ink, over) {
    const n = Math.round((this.nightness ?? 0) * 64) / 64;
    if (this.plantNight !== n) { this.plantNight = n; this.plantColours = new Map(); }
    const key = ink.hex + '|' + over;
    let c = this.plantColours.get(key);
    if (!c) {
      c = css(atNight(overprint(ink.rgb, over), n, false));
      this.plantColours.set(key, c);
    }
    return c;
  }

  render(plant, cam, time, sections) {
    // `reveal` is the fifth argument, as for the 3D renderer
    const reveal = arguments[4] || null;
    this.adapt(time);
    this.resize();
    this.ensureWorld();
    this.ensurePlant(plant, reveal);
    const ctx = this.ctx;
    const v = this.view(cam, time);
    const moving = this.moving.at(time * 0.001, plant, v);

    // While nothing is happening — the player reading a question, the camera
    // at rest — the whole picture holds still but for the birds, the fish and
    // the rest of what moves. So it is drawn once without them and kept, and
    // each frame after that is the copy laid down, and only what moves drawn
    // over it: a fraction of the work, for most of the time the game is open.
    if (this.fixedScale && !reveal) {
      if (!this.stillFits(v)) this.makeStill(v);
      if (this.still) {
        this.composite(ctx, v, moving);
        return;
      }
    } else this.stillView = null;
    this.drawScene(ctx, v, moving);
  }

  /** Everything, furthest first, with whatever moves in among it. */
  drawScene(ctx, v, moving) {
    this.drawSky(ctx, v);
    const items = this.world.items;
    let k = 0;
    let m = 0;
    const upTo = (z) => {
      while (k < items.length && items[k].z < z) {
        while (m < moving.length && moving[m].z < items[k].z) moving[m++].draw(ctx, v);
        if (!items[k].sky) items[k].draw(ctx, v);
        k++;
      }
      while (m < moving.length && moving[m].z < z) moving[m++].draw(ctx, v);
    };
    upTo(0);
    this.drawPlant(ctx, v);
    upTo(Infinity);
  }

  /** Is the kept picture still the picture? Sub-pixel drift of the settling camera is allowed. */
  stillFits(v) {
    const s = this.stillView;
    if (!s || !this.still || s.key !== this.sceneKey()) return false;
    return Math.abs(v.zoom - s.zoom) < s.zoom * 1e-4
      && Math.abs((v.ex - s.ex) * v.zoom) < 0.25 && Math.abs((v.lookY - s.lookY) * v.zoom) < 0.25
      && Math.abs(v.ey - s.ey) * v.zoom < 0.25 && Math.abs(v.tilt - s.tilt) < 0.25;
  }

  sceneKey() {
    return [this.pw, this.ph, this.worldKind, this.world.night, this.plantKey].join('|');
  }

  makeStill(v) {
    if (!this.still || this.still.width !== this.pw || this.still.height !== this.ph) {
      try {
        this.still = this.opts.makeCanvas ? this.opts.makeCanvas(this.pw, this.ph)
          : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(this.pw, this.ph)
            : Object.assign(document.createElement('canvas'), { width: this.pw, height: this.ph });
      } catch {
        this.still = null;     // no second canvas to be had: draw everything every frame
        return;
      }
    }
    this.drawScene(this.still.getContext('2d', { alpha: false }), v, []);
    this.stillView = { key: this.sceneKey(), ex: v.ex, ey: v.ey, lookY: v.lookY, tilt: v.tilt, zoom: v.zoom };
    this.layers = null;
    this.makePlantLayer(v);
  }

  /**
   * A thing that holds still, on a clear layer of its own the size of its box,
   * made the first time something moves behind it: a trunk a deer walks
   * behind is then laid down over the deer as a copy rather than drawn again.
   * The ground and the ranges are not kept this way — they span the screen,
   * and are quick to draw again from the outlines they keep — and there is a
   * limit on how much is kept, past which things are simply drawn again.
   */
  layerOf(it, v) {
    if (it.kind === 'ground' || it.kind === 'range' || it.kind === 'cave' || !it.box) return null;
    if (!this.layers) { this.layers = new Map(); this.layerPixels = 0; }
    if (this.layers.has(it)) return this.layers.get(it);
    const d = this.dpr;
    const b = it.box;
    const x0 = Math.max(0, Math.floor(b[0] * d));
    const y0 = Math.max(0, Math.floor(b[1] * d));
    const x1 = Math.min(this.pw, Math.ceil(b[2] * d));
    const y1 = Math.min(this.ph, Math.ceil(b[3] * d));
    const area = (x1 - x0) * (y1 - y0);
    let layer = null;
    if (x1 > x0 && y1 > y0 && this.layerPixels + area <= this.pw * this.ph * LAYER_BUDGET) {
      try {
        const c = this.opts.makeCanvas ? this.opts.makeCanvas(x1 - x0, y1 - y0)
          : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(x1 - x0, y1 - y0)
            : Object.assign(document.createElement('canvas'), { width: x1 - x0, height: y1 - y0 });
        it.draw(c.getContext('2d'), { ...v, ox: x0, oy: y0 });
        layer = { canvas: c, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        this.layerPixels += area;
      } catch {
        layer = null;
      }
    }
    // (out of room, it is drawn again each time instead, which is only slower)
    this.layers.set(it, layer);
    return layer;
  }

  /**
   * The plant on its own, on a clear layer the size of its box. Things move
   * behind it all the time — fish circling it, birds crossing it — and laying
   * this down over them is a copy, where drawing the plant again was every
   * shape it has.
   */
  makePlantLayer(v) {
    this.plantLayer = null;
    const b = this.plantBox;
    if (!b) return;
    const d = this.dpr;
    const x0 = Math.max(0, Math.floor(b[0] * d));
    const y0 = Math.max(0, Math.floor(b[1] * d));
    const x1 = Math.min(this.pw, Math.ceil(b[2] * d));
    const y1 = Math.min(this.ph, Math.ceil(b[3] * d));
    if (x1 <= x0 || y1 <= y0) return;
    let layer = this.plantCanvas;
    try {
      if (!layer || layer.width < x1 - x0 || layer.height < y1 - y0) {
        const w = x1 - x0;
        const h = y1 - y0;
        layer = this.opts.makeCanvas ? this.opts.makeCanvas(w, h)
          : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h)
            : Object.assign(document.createElement('canvas'), { width: w, height: h });
        this.plantCanvas = layer;
      }
    } catch {
      return;
    }
    const lc = layer.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(0, 0, layer.width, layer.height);
    const box = this.plantBox;
    this.drawPlant(lc, { ...v, ox: x0, oy: y0 });
    this.plantBox = box;
    this.plantLayer = { canvas: layer, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * The kept picture, and what moves drawn over it. A moving thing is often
   * behind something that holds still — a deer behind a trunk, a fish behind
   * the reef — so whatever stands in front of it is laid down again, clipped
   * to the box the moving thing was drawn in: the order the full picture has.
   */
  composite(ctx, v, moving) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.still, 0, 0);
    const items = this.world.items;
    for (const m of moving) {
      m.draw(ctx, v);
      if (!m.box) continue;
      // a flock or a school is many small things: each has a box of its own
      const boxes = m.boxes || [m.box];
      const hit = new Set();
      const front = items.filter((it) => {
        if (it.sky || it.z <= m.z || !it.box || !overlaps(it.box, m.box)) return false;
        let any = false;
        boxes.forEach((b, k) => { if (overlaps(it.box, b) && reaches(it, b, v)) { hit.add(k); any = true; } });
        return any;
      });
      let plant = false;
      if (m.z < 0 && this.plantBox) {
        boxes.forEach((b, k) => { if (overlaps(this.plantBox, b)) { hit.add(k); plant = true; } });
      }
      if (!front.length && !plant) continue;
      ctx.save();
      // on whole device pixels: a clip edge part way across a pixel lets each
      // thing laid down over it through by a part, and those parts add up to
      // a pale square traced round every moving thing
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      const d = this.dpr;
      for (const k of hit) {
        const b = boxes[k];
        const x0 = Math.floor(b[0] * d);
        const y0 = Math.floor(b[1] * d);
        ctx.rect(x0, y0, Math.ceil(b[2] * d) - x0, Math.ceil(b[3] * d) - y0);
      }
      ctx.clip();
      const layPlant = () => {
        const l = this.plantLayer;
        if (!l) { this.drawPlant(ctx, v); return; }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(l.canvas, 0, 0, l.w, l.h, l.x, l.y, l.w, l.h);
      };
      let plantDone = !plant;
      for (const it of front) {
        if (!plantDone && it.z > 0) { layPlant(); plantDone = true; }
        const l = this.layerOf(it, v);
        if (l) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(l.canvas, 0, 0, l.w, l.h, l.x, l.y, l.w, l.h);
        } else it.draw(ctx, v);
      }
      if (!plantDone) layPlant();
      ctx.restore();
    }
  }

  drawSky(ctx, v) {
    const w = this.world;
    const t = w.toon;
    const n = this.nightness ?? 0;
    const [day, dusk, night] = t.sky.map(linear);
    const sky = n < 0.45 ? mix(day, dusk, n / 0.45) : mix(dusk, night, Math.min(1, (n - 0.45) / 0.4));
    v.screen(ctx);
    ctx.fillStyle = css(sky);
    ctx.fillRect(0, 0, v.W, v.H);
    for (const it of w.items) if (it.sky) it.draw(ctx, v);
    const place = w.place;
    const horizon = v.H / 2 - v.tilt;
    if (place.underwater !== undefined || place.cave) return;
    // below the horizon, beyond any land that is built: the far land, one ink
    ctx.fillStyle = w.colour(w.farInk);
    ctx.fillRect(0, horizon + 0.02 * v.F, v.W, v.H);

    // Sparkles by day and stars by night: four-pointed, scattered by direction,
    // so they hold still however the camera moves.
    const cell = v.F / 38;
    const want = 0.06 + (0.22 - 0.06) * n;
    const top = horizon - 0.02 * v.F;
    const star = css([0.98, 0.95, 0.86]);
    ctx.beginPath();
    const sparkles = ctx;
    const i0 = Math.floor(-v.W / 2 / cell) - 1;
    const i1 = Math.ceil(v.W / 2 / cell) + 1;
    for (let j = 0; j * cell < top + cell; j++) {
      for (let i = i0; i <= i1; i++) {
        const hx = i + 7.3;
        const hy = j + 7.3;
        if (hash(hx, hy) >= want) continue;
        const fx = (hash(i * 1.7, j * 1.7) - 0.5) * 0.4;
        const fy = (hash(i * 2.3, j * 2.3) - 0.5) * 0.4;
        const k = (0.14 + hash(i * 3.1, j * 3.1) * 0.12) * cell;
        const cx = v.W / 2 + (i + 0.5 + fx) * cell;
        const cy = horizon - (j + 0.5 + fy) * cell;
        if (cy > top || cy < -k || cx < -k || cx > v.W + k) continue;
        sparkles.moveTo(cx + SPARKLE[0][0] * k, cy - SPARKLE[0][1] * k);
        for (const [sx, sy] of SPARKLE) sparkles.lineTo(cx + sx * k, cy - sy * k);
        sparkles.closePath();
      }
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = v.line;
    ctx.lineWidth = LINE_PX * 1.4;
    ctx.stroke();
    ctx.fillStyle = star;
    ctx.fill();

    // the sun: a disc with rays round it and a face on it by day, the moon by night
    const sx = v.W / 2 + v.F * (SUN_SPOT[0] / -SUN_SPOT[2]);
    const sy = horizon - v.F * (SUN_SPOT[1] / -SUN_SPOT[2]);
    const r = v.F * 0.05;
    if (sx + r * 2.2 < 0 || sx - r * 2.2 > v.W || sy + r * 2.2 < 0 || sy - r * 2.2 > top) return;
    const disc = n < 0.55 ? linear('#ffd24a') : mix(linear('#ffd24a'), [0.93, 0.90, 0.80], smoothstep(0.4, 0.8, n));
    ctx.lineWidth = LINE_PX * 2;
    ctx.strokeStyle = v.line;
    if (n < 0.55) {
      ctx.beginPath();
      const rays = ctx;
      for (let q = 0; q < 12; q++) {
        const a = (q / 12) * Math.PI * 2 + Math.PI / 12;
        const wd = 0.06 / 1.65;
        const p = (d, side) => [sx + Math.cos(a + side * wd) * d, sy - Math.sin(a + side * wd) * d];
        const [ax, ay] = p(r * 1.3, -1);
        rays.moveTo(ax, ay);
        rays.lineTo(...p(r * 2.0, -1));
        rays.lineTo(...p(r * 2.0, 1));
        rays.lineTo(...p(r * 1.3, 1));
        rays.closePath();
      }
      ctx.stroke();
      ctx.fillStyle = css(disc);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = css(disc);
    ctx.fill();
    if (n < 0.55) {
      ctx.fillStyle = v.line;
      for (const e of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx + e * 0.34 * r, sy - 0.16 * r, 0.11 * r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(sx, sy - 0.12 * r, 0.46 * r, Math.PI * 0.2, Math.PI * 0.8);
      ctx.lineWidth = 0.12 * r;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  drawPlant(ctx, v) {
    const s = v.at(ctx, 0);
    // where it is on the screen, heavy line and all, for what moves behind it
    const b = this.plantBounds;
    const m = HEAVY_PX * 2;
    this.plantBox = b && b.x0 <= b.x1 ? [v.X(b.x0, s) - m, v.Y(b.y1, s) - m, v.X(b.x1, s) + m, v.Y(b.y0, s) + m] : null;
    const colour = (ink, over) => this.plantColour(ink, over);
    const marks = patternAlpha(s * this.dpr);
    if (this.plantLive) {
      drawPlantLive(ctx, this.plantLive, { heavy: HEAVY_PX / s, line: LINE_PX / s, lineColour: v.line, colour, marks });
      return;
    }
    // the plant is the subject, and drawn round with a heavier line than anything else
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = v.line;
    ctx.lineWidth = (HEAVY_PX * 2) / s;
    ctx.stroke(this.plantOutline);
    draw(ctx, this.plantBatches, { line: LINE_PX / s, lineColour: v.line, colour, marks });
  }

  /** One frame, as a PNG data URL (the canvas keeps what it last drew). */
  capture() {
    return Promise.resolve(this.canvas.toDataURL('image/png'));
  }
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The shaders' hash21. */
function hash(x, y) {
  const fr = (q) => q - Math.floor(q);
  let px = fr(x * 123.34);
  let py = fr(y * 456.21);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d;
  py += d;
  return fr(px * py);
}

/** Do two screen boxes [x0, y0, x1, y1] meet? */
function overlaps(a, b) {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/**
 * Does an item actually come over a box? A row of ground fills everything
 * below its edge, so it only does where that edge rises into the box.
 */
function reaches(it, b, v) {
  // a thing made of parts: whether any part of it is over the box
  if (it.covers) return it.covers(b, v);
  if (it.tops) {
    for (const [x, y] of it.tops) if (x >= b[0] - 30 && x <= b[2] + 30 && y < b[3]) return true;
    return false;
  }
  // and a range only where its crest does
  if (it.crest) {
    const { xs, ys } = it.crest;
    for (let i = 0; i < xs.length; i++) if (ys[i] !== null && xs[i] >= b[0] - 40 && xs[i] <= b[2] + 40 && ys[i] < b[3]) return true;
    return false;
  }
  return true;
}

/** Two lists, each already in drawing order, as one. */
function mergeByDepth(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && (a[i].z < b[j].z || (a[i].z === b[j].z && a[i].i <= b[j].i)))) out.push(a[i++]);
    else out.push(b[j++]);
  }
  return out;
}
