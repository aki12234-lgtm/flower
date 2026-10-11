// The world, flat.
//
// The illustrated look built every place as real geometry — ground running to
// the horizon, ranges thirty thousand units off, trees, rocks and cloud — and
// printed it from a camera. Seen through that camera, each thing is a shape at
// some distance, and the only use the distance has is how large the shape is,
// where it sits and what it covers. So here each thing is a flat drawing stood
// at its own distance, scaled and placed by the same lens, and the whole lot is
// laid down furthest first — painter's order instead of a depth buffer.
//
// Nothing in this file is lit. A face turned from the upper left gets a second
// pass of its own ink, as it did in print; everything else is one flat ink.

import { makeRng, clamp, clamp01, lerp, noise2 } from '../rng.js';
import { PLACES, groundAt, TOON_GROUND, TRUNK_INKS, NEAR_Z } from '../gl/scene.js';
import { linear } from '../gl/toon.js';
import { inkSet, inkFor, atNight, overprint, css, mix, LINE } from './ink.js';
import { Shapes, boundsOf } from './shapes.js';
import { batch, draw, SHADE_OVER, hash21 } from './paint.js';

/** A line's width, and the plant's heavier one, in CSS pixels. */
export const LINE_PX = 1.7;
export const HEAVY_PX = 3.1;

const FAR_RING_Z = -70000;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Leaf clumps, as the 3D world lumps them (scene.js, lumps). */
const lumps = (rad, seed) => (px, py, pz) => {
  const k = 2.4 / rad;
  return ((noise2(px * k + pz * k * 0.6 + seed, py * k, 55) - 0.5) * 0.40
    + (noise2(px * k * 2.7 - pz * k * 1.9, py * k * 2.7 + seed, 91) - 0.5) * 0.18) * rad;
};

/**
 * A place, ready to draw: everything in it that holds still, furthest first,
 * and the inks it is printed in.
 */
export class World {
  constructor(kind) {
    this.kind = kind;
    this.place = PLACES[((kind % PLACES.length) + PLACES.length) % PLACES.length];
    const t = this.place.toon;
    this.toon = t;
    this.set = inkSet(t.inks);
    this.tint = t.tint || null;
    this.pick = (rgb) => inkFor(rgb, this.set, false, this.tint);
    this.groundInk = { rgb: linear(t.ground) };
    this.farInk = { rgb: linear(t.far || t.ground) };
    this.poolInk = { rgb: linear(t.pool || t.ground) };
    this.items = [];
    this.colours = new Map();
    this.night = -1;
    build(this);
    this.items.sort((a, b) => a.z - b.z);
  }

  /** CSS for an ink, with `over` of a second pass on it, at this time of night. */
  colour(ink, over = 0) {
    const key = ink.rgb.join(',') + '|' + over;
    let c = this.colours.get(key);
    if (!c) {
      c = css(atNight(overprint(ink.rgb, over), this.night, true));
      this.colours.set(key, c);
    }
    return c;
  }

  setNight(n) {
    // in steps fine enough not to be seen, and coarse enough to cache by
    const q = Math.round(n * 64) / 64;
    if (q !== this.night) { this.night = q; this.colours.clear(); }
  }
}

// ---------------------------------------------------------------- the build --

function build(w) {
  const p = w.place;
  w.items.push(...groundRows(w));
  if (p.ridges) p.ridges.forEach((rd, li) => w.items.push(ridgeItem(w, rd, li)));
  if (p.clouds) w.items.push(...cloudItems(w));
  if (p.cave) w.items.push(...caveItems(w));
  if (p.forest) w.items.push(...forestItems(w));
  if (p.underwater !== undefined) w.items.push(ceilingItem(w));
  const tg = TOON_GROUND[p.id];
  if (tg) {
    // (a tuft's own colour never shows: a stroke that thin is all line)
    if (tg.tufts) w.items.push(...tuftItems(w, tg.tufts, tg.tall || 1));
    if (tg.flowers) w.items.push(...meadowItems(w, tg.flowers));
  }
  w.items.push(moundItem(w));
  w.items.push(...scatterItems(w));
}

/**
 * Where an item with world bounds lands on the screen at scale s, line and all.
 * Every item leaves one of these behind when it draws (its `box`), so that while
 * the picture holds still, what stands in front of a moving thing can be laid
 * down again over just that thing.
 */
function boxOf(it, v, s) {
  const m = LINE_PX * 2;
  return [v.X(it.x0, s) - m, v.Y(it.y1, s) - m, v.X(it.x1, s) + m, v.Y(it.y0, s) + m];
}

/** A drawing made of shapes, stood at depth z. */
function shapesItem(w, shapes, z, opts = {}) {
  const list = shapes.sorted();
  if (!list.length) return null;
  const b = boundsOf(list);
  // each part's own box, for telling whether something moving behind the
  // whole is behind any of it: a tree's box is mostly the air between its
  // trunk and its crowns
  const parts = list.map((sh) => boundsOf([sh]));
  return {
    z, ...b, kind: opts.kind || 'thing', batches: batch(list, { shade: true }),
    covers(box, v) {
      const s = v.s(this.z);
      if (!s) return false;
      const m = LINE_PX * 2;
      for (const p of parts) {
        if (v.X(p.x1, s) + m > box[0] && v.X(p.x0, s) - m < box[2]
          && v.Y(p.y0, s) + m > box[1] && v.Y(p.y1, s) - m < box[3]) return true;
      }
      return false;
    },
    draw(ctx, v) {
      this.box = null;
      const s = v.s(this.z);
      if (!s) return;
      if (!v.sees(this, s)) return;
      // too small to be anything but a speck: leave it out
      if ((this.x1 - this.x0) * s < 0.6 && (this.y1 - this.y0) * s < 0.6) return;
      this.box = boxOf(this, v, s);
      v.at(ctx, this.z);
      draw(ctx, this.batches, {
        line: opts.noLine ? 0 : LINE_PX / s, lineColour: v.line,
        colour: (ink, over) => w.colour(ink, over),
      });
    },
  };
}

// ---------------------------------------------------------------- the ground --
//
// The land, as rows across it at a range of distances, laid down furthest
// first, each filling everything below its own edge. A row's edge only gets a
// line where it stands higher on the screen than the row behind it — where the
// land hides more land, which is where the print drew one.

const ROWS = [-70000, -55000, -44000, -36000, -30000, -25000, -21000, -18000, -15500, -13200,
  -11200, -9500, -8000, -6700, -5600, -4700, -3900, -3200, -2600, -2100, -1650, -1250, -900,
  -600, -350, -120, 120, 400, 750, 1150, 1600, 2150, 2800, 3600, 5000, 7000, 10000, 15000, 22000, 34000];

function groundRows(w) {
  const p = w.place;
  const zs = ROWS.slice();
  if (p.water !== undefined) {
    // the waterline wants rows close together, or the shore comes out in steps
    for (let z = p.water - 1600; z <= p.water + 900; z += 120) zs.push(z);
  }
  if (p.cave) {
    // the pool of light round the plant's foot
    for (let z = -1100; z <= 600; z += 100) zs.push(z);
  }
  zs.sort((a, b) => a - b);
  const items = [];
  for (let k = 0; k < zs.length; k++) {
    items.push(groundRow(w, zs[k], k ? zs[k - 1] : null));
  }
  return items;
}

/** What the ground is at (x, z): its height and the ink it is printed in. */
function groundSample(w, x, z) {
  const p = w.place;
  const y = groundAt(x, z, p);
  if (p.water !== undefined && z < p.water + 900 && y < -14) {
    // the sea: shallow and pale near the sand, deep further out, foam where it breaks
    const depth = -14 - y;
    const surfy = clamp01(1 - depth / 30) * (0.5 + noise2(x * 0.006, z * 0.006, 9) * 0.9);
    const deep = clamp01(-z / 12000);
    const col = [lerp(0.09, 0.03, deep) + surfy * 0.7, lerp(0.30, 0.14, deep) + surfy * 0.7,
      lerp(0.40, 0.26, deep) + surfy * 0.7];
    return { y: -14, ink: w.pick(col), sea: true };
  }
  if (p.cave && Math.hypot(x, z + 250) < 760 + (noise2(x / 260, z / 260, 0) - 0.5) * 180) {
    return { y, ink: w.poolInk };
  }
  return { y, ink: w.groundInk };
}

function groundRow(w, z, behind) {
  const N = 56;
  // the row's edge on the screen, worked out once per view (as for a range)
  let memo = null;
  const edge = (v, s) => {
    const back = behind !== null ? v.s(behind) : 0;
    const key = `${s}|${back}|${v.ex}|${v.ey}|${v.tilt}|${v.W}|${v.H}`;
    if (memo && memo.key === key) return memo;
    const tops = [];
    const inks = [];
    const lines = [];
    for (let i = 0; i <= N; i++) {
      const sx = (i / N) * (v.W + 40) - 20;
      const x = v.ex + (sx - v.W / 2) / s;
      const g = groundSample(w, x, z);
      const sy = v.Y(g.y, s);
      tops.push([sx, sy]);
      inks.push(g.ink);
      if (back && !g.sea) {
        // a line only where this row hides a real stretch of the land behind
        // it, not wherever it is a pixel higher: the print drew one where the
        // depth broke, and the ground mostly runs on unbroken
        const xb = v.ex + (sx - v.W / 2) / back;
        const yb = v.Y(groundSample(w, xb, behind).y, back);
        lines.push(sy < yb - 4);
      } else lines.push(false);
    }
    memo = { key, tops, inks, lines };
    return memo;
  };
  return {
    z, kind: 'ground',
    draw(ctx, v) {
      const s = v.s(z);
      if (!s) return;
      const { tops, inks, lines } = edge(v, s);
      // nothing of this row is on the screen
      this.box = null;
      if (tops.every(([, y]) => y > v.H + 2)) return;
      this.tops = tops;
      this.box = [-20, Math.min(...tops.map((q) => q[1])) - LINE_PX, v.W + 20, v.H + 4];
      v.screen(ctx);
      const bottom = v.H + 4;
      // one polygon per run of one ink, each down to the bottom of the frame
      let start = 0;
      for (let i = 1; i <= N + 1; i++) {
        if (i <= N && inks[i] === inks[start]) continue;
        const end = Math.min(N, i);
        ctx.beginPath();
        ctx.moveTo(tops[start][0], bottom);
        for (let k = start; k <= end; k++) ctx.lineTo(tops[k][0], tops[k][1]);
        ctx.lineTo(tops[end][0], bottom);
        ctx.closePath();
        ctx.fillStyle = w.colour(inks[start]);
        ctx.fill();
        if (start > 0) {
          // where the sand meets the sea, or the floor the light
          ctx.beginPath();
          ctx.moveTo(tops[start][0], tops[start][1]);
          ctx.lineTo(tops[start][0], tops[start][1] + 3);
          ctx.strokeStyle = v.line;
          ctx.lineWidth = LINE_PX;
          ctx.stroke();
        }
        start = i;
      }
      // Lines along the edge where this row hides land behind it — a stretch of
      // it, not a fleck: three samples or more, so a crest reads as one stroke.
      ctx.beginPath();
      for (let i = 0; i <= N;) {
        if (!lines[i]) { i++; continue; }
        let j = i;
        while (j + 1 <= N && lines[j + 1]) j++;
        if (j - i >= 2) {
          ctx.moveTo(tops[Math.max(0, i - 1)][0], tops[Math.max(0, i - 1)][1]);
          for (let k = i; k <= Math.min(N, j + 1); k++) ctx.lineTo(tops[k][0], tops[k][1]);
        }
        i = j + 1;
      }
      ctx.strokeStyle = v.line;
      ctx.lineWidth = LINE_PX;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      // and where ink meets ink along the edge (the shore, the pool), a line too
      ctx.beginPath();
      for (let i = 1; i <= N; i++) {
        if (inks[i] !== inks[i - 1]) {
          const a = tops[i - 1];
          const b = tops[i];
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
        }
      }
      ctx.stroke();
    },
  };
}

// ---------------------------------------------------------------- the ranges --

function ridgeItem(w, rd, li) {
  const p = w.place;
  const exact = (x) => {
    const n1 = noise2(x / rd.scale + li * 7.1, li * 3.3, 71 + li);
    const n2 = noise2(x / (rd.scale * 0.33) + li * 1.9, li + 0.5, 13 + li);
    let shape;
    if (rd.shape === 'sharp') shape = (1 - Math.abs(n1 * 2 - 1)) ** 1.4 * 0.8 + n2 * 0.35;
    else if (rd.shape === 'mesa') shape = smooth(0.40, 0.56, n1) * 0.9 + n2 * 0.06;
    else shape = n1 * 0.75 + n2 * 0.3;
    let h = rd.height * (0.2 + shape);
    if (rd.side) h *= smooth(1500, 4500, rd.side * x);
    if (rd.islands) h = h * 1.6 - rd.height * 0.75;
    return h;
  };
  const base = rd.ink ? linear(rd.ink) : rd.colour;
  const ink = w.pick(base);
  const snow = rd.snow ? w.pick([0.78, 0.80, 0.84]) : null;
  const strata = rd.shape === 'mesa' ? w.pick(base.map((k) => k * 0.86)) : null;
  const sea = p.water !== undefined;
  const half = Math.abs(rd.z) * 1.2 + 10000;
  // The crest as the 3D range had it: a hundred and forty facets across, so
  // the peaks are the same peaks with the same flat faces, not a finer copy.
  const step = (half * 2) / 140;
  const crest = (x) => {
    const j = Math.floor((x + half) / step);
    const x0 = -half + j * step;
    const a = exact(x0);
    return a + (exact(x0 + step) - a) * ((x - x0) / step);
  };
  const L = [-0.8, 0.45, 0.4];
  const Ll = Math.hypot(...L);
  // Everything about the range on the screen, worked out once per view: its
  // crest, its foot, how far down each face the shade comes, and where the
  // snow lies. While the picture holds still it is drawn again over whatever
  // moves behind it, and that should cost the drawing, not the working out.
  let memo = null;
  const shape = (v) => {
    const s = v.s(rd.z);
    if (!s) return null;
    const key = `${s}|${v.ex}|${v.ey}|${v.tilt}|${v.W}|${v.H}`;
    if (memo && memo.key === key) return memo;
    const N = 120;
    const xs = [];
    const ys = [];
    for (let i = 0; i <= N; i++) {
      const sx = (i / N) * (v.W + 80) - 40;
      const x = v.ex + (sx - v.W / 2) / s;
      xs.push(sx);
      if (Math.abs(x) > half) { ys.push(null); continue; }
      let h = crest(x);
      // out at sea, only what stands clear of the water: a headland that has
      // run down to nothing is sea, not a strip of rock along the horizon
      if (sea && h < 6) { ys.push(null); continue; }
      if (sea) h = Math.max(h, -14);
      ys.push(v.Y(h, s));
    }
    const foot = sea ? v.Y(-14, s) : v.H + 4;
    memo = { key, s, xs, ys, foot, first: -1, last: -1, low: [], caps: [] };
    if (ys.every((y) => y === null || y >= foot - 0.5)) return memo;
    for (let i = 0; i <= N; i++) {
      if (ys[i] === null) continue;
      if (memo.first < 0) memo.first = i;
      memo.last = i;
    }
    // The faces turned from the upper left. The 3D range was a surface from
    // its foot up to its crest, steepening as it went, and a face is in shade
    // where its slope across, at that height, turns it from the light: so the
    // shade comes down from a crest that falls away to the right, as far as
    // the face stays steep enough to keep it.
    const ROWS = [1, 0.9, 0.78, 0.64, 0.5, 0.36, 0.22];
    const lift = (u) => Math.sin(u * Math.PI / 2) ** 1.4;
    const dlift = (u) => 1.4 * Math.sin(u * Math.PI / 2) ** 0.4 * Math.cos(u * Math.PI / 2) * Math.PI / 2;
    const facet = (i) => {
      const x = v.ex + (xs[i] - v.W / 2) / s;
      const x0 = -half + Math.floor((x + half) / step) * step;
      return { x, hx: (exact(x0 + step) - exact(x0)) / step };
    };
    for (let i = memo.first; i <= memo.last; i++) {
      memo.low[i] = null;
      if (ys[i] === null) continue;
      const { hx } = facet(i);
      const h = (v.H / 2 - v.tilt - ys[i]) / s + v.ey;
      for (const u of ROWS) {
        const n = [-hx * lift(u), 1, (h + 400) * dlift(u) / Math.max(1, rd.depth)];
        const lit = (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / (Math.hypot(...n) * Ll);
        if (lit >= 0.3) break;
        memo.low[i] = v.Y(-400 + (h + 400) * lift(u), s);
      }
    }
    // Snow above four fifths of its height — except on a face too steep to
    // hold it, so the snow line breaks where the rock is sheer.
    if (snow && snow !== ink) {
      const lineY = rd.height * 0.81;
      let from = -1;
      for (let i = memo.first; i <= memo.last + 1; i++) {
        let on = false;
        if (i <= memo.last && ys[i] !== null) {
          const { x, hx } = facet(i);
          on = crest(x) > lineY && Math.abs(hx) < 1.6;
        }
        if (on && from < 0) from = i;
        if (!on && from >= 0) { memo.caps.push([from, i, v.Y(lineY, s)]); from = -1; }
      }
    }
    return memo;
  };

  return {
    z: rd.z, kind: 'range',
    draw(ctx, v) {
      this.box = null;
      const g = shape(v);
      if (!g || g.first < 0) return;
      const { s, xs, ys, foot, first, last, low } = g;
      this.crest = g;
      this.box = [-40, Math.min(...ys.filter((y) => y !== null)) - LINE_PX, v.W + 40, foot + LINE_PX];
      v.screen(ctx);
      // one outline per stretch of range, down to its foot
      ctx.beginPath();
      for (let i = first; i <= last; i++) {
        if (ys[i] === null) continue;
        if (i === 0 || ys[i - 1] === null) ctx.moveTo(xs[i], foot);
        ctx.lineTo(xs[i], ys[i]);
        if (i === last || ys[i + 1] === null) { ctx.lineTo(xs[i], foot); ctx.closePath(); }
      }
      ctx.fillStyle = w.colour(ink);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.beginPath();
      let run = -1;
      for (let i = first; i <= last + 1; i++) {
        const on = i <= last && low[i] !== null && low[i] !== undefined;
        if (on && run < 0) run = i;
        if (!on && run >= 0) {
          ctx.moveTo(xs[run], ys[run]);
          for (let k = run + 1; k < i; k++) ctx.lineTo(xs[k], ys[k]);
          for (let k = i - 1; k >= run; k--) ctx.lineTo(xs[k], low[k]);
          ctx.closePath();
          run = -1;
        }
      }
      ctx.fillStyle = w.colour(ink, SHADE_OVER);
      ctx.fill();
      // mesas are laid down in beds
      if (strata && strata !== ink) {
        ctx.fillStyle = w.colour(strata);
        for (let y = Math.floor(-400 / 565) * 565; y < rd.height * 1.3; y += 565) {
          const y0 = v.Y(y + 380, s);
          const y1 = v.Y(y + 565, s);
          ctx.fillRect(-10, y1, v.W + 20, Math.max(0, y0 - y1));
        }
      }
      if (g.caps.length) {
        ctx.beginPath();
        for (const [from, to, y] of g.caps) {
          ctx.moveTo(xs[from], y);
          for (let k = from; k < to; k++) ctx.lineTo(xs[k], Math.min(ys[k], y));
          ctx.lineTo(xs[to - 1], y);
          ctx.closePath();
        }
        ctx.lineJoin = 'round';
        ctx.strokeStyle = v.line;
        ctx.lineWidth = LINE_PX * 2;
        ctx.stroke();
        ctx.fillStyle = w.colour(snow);
        ctx.fill();
      }
      ctx.restore();
      // the crest against whatever is behind it
      ctx.beginPath();
      let open = false;
      for (let i = first; i <= last; i++) {
        if (ys[i] === null || ys[i] >= foot - 0.5) { open = false; continue; }
        if (!open) { ctx.moveTo(xs[i], ys[i]); open = true; } else ctx.lineTo(xs[i], ys[i]);
      }
      ctx.strokeStyle = v.line;
      ctx.lineWidth = LINE_PX;
      ctx.lineJoin = 'round';
      ctx.stroke();
    },
  };
}

// ----------------------------------------------------------------- the cloud --

function cloudItems(w) {
  const p = w.place;
  const rng = makeRng(4711);
  const out = [];
  const banks = Math.round(30 * p.clouds);
  for (let b = 0; b < banks; b++) {
    const high = b % 3 !== 0;
    const cz = high ? -2600 - rng.range(0, 20000) : -26000 - rng.range(0, 92000);
    const away = -cz;
    const y = high ? 2200 + rng.range(0, 16000) : away * rng.range(0.045, 0.15);
    const cx = rng.range(-1, 1) * away * (high ? 0.8 : 1.5);
    const scale = high ? 260 + rng.range(0, 900) : away * rng.range(0.008, 0.019);
    const reach = scale * rng.range(2.4, 4.0);
    const sh = new Shapes(w.pick, true);
    for (let i = 0; i < 24; i++) {
      const t = rng.range(-0.5, 0.5);
      const dome = Math.cos(t * Math.PI) ** 0.7;
      const big = rng.range(0, 1) ** 2.1;
      const r = scale * (0.22 + big * 0.6) * (0.5 + dome * 0.7);
      const lx = cx + t * reach + rng.range(-scale * 0.12, scale * 0.12);
      const ly = y + dome * scale * rng.range(-0.05, 0.5) + r * 0.35;
      const lz = rng.range(-scale * 0.14, scale * 0.14);
      sh.disc(lx, ly, r, [1, 1, 1], 0, lz);
    }
    const item = shapesItem(w, sh, cz, { kind: 'cloud' });
    if (item) out.push(item);
  }
  return out;
}

// --------------------------------------------------------- things on the land --

function scatterItems(w) {
  const p = w.place;
  const rng = makeRng(2027);
  const out = [];
  const props = p.props;
  const stoneCol = [0.36, 0.34, 0.31];
  const put = (x, z, r, what) => {
    const y = groundAt(x, z, p);
    if (p.water !== undefined && z < p.water && y < -30) return;
    const sh = new Shapes(w.pick, true);
    let ink = null;
    if (what === 'stone') {
      const wd = r * rng.range(1.1, 1.9);
      if (clamp01((noise2(x * 0.00016, z * 0.00016, 91) - 0.34) * 3.4) > 0.5) {
        const tall = 0.34 + rng.range(0, 0.3);
        shard(sh, x, y + wd * tall * 0.7, wd, (i) => rng.range(-0.55, 0.75) - (i === 3 ? 0.4 : 0)
          - (i === 2 ? 1 - tall * 2.4 : 0), [0.34, 0.32, 0.30]);
      } else {
        sh.lump(x, y + r * 0.16, z, wd, stoneCol, (px, py) => (noise2(px * 0.05, z * 0.05, 8) - 0.5) * wd * 0.45
          - Math.max(0, py - y) * 0.55);
      }
    } else if (what === 'bush' || what === 'scrub') {
      const lobes = what === 'scrub' ? 2 : 3 + Math.floor(rng.range(0, 3));
      const wd = r * (what === 'scrub' ? 0.8 : 1.4);
      const parts = [];
      for (let k = 0; k < lobes; k++) {
        const a = (k / lobes) * Math.PI * 2 + rng.range(0, 1);
        const rad = wd * rng.range(0.42, 0.72);
        const bx = x + Math.cos(a) * wd * rng.range(0.1, 0.55);
        const by = y + rad * rng.range(0.55, 0.95);
        const bz = Math.sin(a) * wd * rng.range(0.1, 0.55);
        parts.push([bx, by, bz, rad]);
      }
      for (const [bx, by, bz, rad] of parts) {
        if (what === 'scrub') sh.lump(bx, by, z + bz, rad, [0.34, 0.33, 0.17], null, bz);
        else sh.lump(bx, by, z + bz, rad, [0.18, 0.36, 0.10], lumps(rad, bx * 0.01), bz);
      }
    } else if (what === 'tuft') {
      ink = true;
      for (let k = 0; k < 4; k++) {
        const a = rng.range(0, Math.PI * 2);
        const h = r * rng.range(1.2, 2.4);
        sh.band([
          { x, y, r: r * 0.10 },
          { x: x + Math.cos(a) * r * 0.3, y: y + h * 0.6, r: r * 0.06 },
          { x: x + Math.cos(a) * r * 0.9, y: y + h, r: r * 0.01 },
        ], () => [0.26, 0.44, 0.14], 0, Math.sin(a));
      }
    } else if (what === 'coral') {
      coral(sh, x, y, r, rng);
    } else if (what === 'weed') {
      for (let k = 0; k < 4; k++) {
        const a = rng.range(0, Math.PI * 2);
        const h = r * rng.range(4, 9);
        const sway = rng.range(0.3, 0.8);
        sh.band([
          { x, y, r: r * 0.12 },
          { x: x + Math.cos(a) * h * sway * 0.3, y: y + h * 0.55, r: r * 0.09 },
          { x: x + Math.cos(a) * h * sway, y: y + h, r: r * 0.03 },
        ], () => [0.20, 0.36, 0.20], 0, Math.sin(a));
      }
    } else if (what === 'mushroom') {
      const n = 3 + Math.floor(rng.range(0, 5));
      const pale = rng.range(0, 1) < 0.4;
      const cap = pale ? [0.72, 0.66, 0.52] : [0.52, 0.20, 0.13];
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, Math.PI * 2);
        const d = r * rng.range(0.2, 1.5);
        const mx = x + Math.cos(a) * d;
        const mz = Math.sin(a) * d;
        const my = groundAt(mx, z + mz, p);
        const h = r * rng.range(0.5, 1.1);
        const wide = h * rng.range(0.5, 0.85);
        sh.band([{ x: mx, y: my - h * 0.1, r: wide * 0.22 }, { x: mx, y: my + h, r: wide * 0.17 }],
          () => [0.80, 0.76, 0.66], 0, mz);
        // the cap: a dome, flat underneath
        const dome = [];
        for (let q = 0; q <= 12; q++) {
          const t = (q / 12) * Math.PI;
          dome.push({ x: mx + Math.cos(t) * wide, y: my + h + Math.sin(t) * wide * 0.35 });
        }
        const s = sh.poly(dome, cap, 0, mz + 0.01);
        s.faceShade = false;
      }
    } else if (what === 'moss') {
      for (let k = 0; k < 3; k++) {
        const a = rng.range(0, Math.PI * 2);
        const d = r * rng.range(0, 0.7);
        const rad = r * rng.range(0.5, 0.9);
        const mx = x + Math.cos(a) * d;
        // a low cushion: half a lump, squashed
        const pts = [];
        for (let q = 0; q <= 12; q++) {
          const t = (q / 12) * Math.PI;
          pts.push({ x: mx + Math.cos(t) * rad, y: y + Math.sin(t) * rad * 0.42 });
        }
        sh.poly(pts, [0.16, 0.34, 0.11], 0, Math.sin(a) * d);
      }
    } else if (what === 'log') {
      const len = r * rng.range(4, 9);
      const a = rng.range(0, Math.PI);
      const path = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4 - 0.5;
        path.push({ x: x + Math.cos(a) * len * t, y: y + r * 0.5 + Math.sin(t * 2.2) * r * 0.12,
          r: r * 0.5 * (1 - Math.abs(t) * 0.35) });
      }
      sh.band(path, (i) => (i % 2 ? [0.20, 0.16, 0.12] : [0.17, 0.26, 0.12]), 0, 0);
    } else if (what === 'sapling' || what === 'tree') {
      const tree = what === 'tree';
      const h = r * (tree ? rng.range(5, 9) : rng.range(3, 6));
      const lean = tree ? rng.range(-0.1, 0.1) : rng.range(-0.2, 0.2);
      const path = [];
      for (let k = 0; k <= (tree ? 5 : 4); k++) {
        const t = k / (tree ? 5 : 4);
        path.push({ x: x + lean * h * t * t, y: y + h * t,
          r: tree ? r * 0.16 * (1 - t * 0.55) : r * 0.09 * (1 - t * 0.6) });
      }
      sh.band(path, () => (tree ? [0.20, 0.16, 0.11] : [0.22, 0.18, 0.12]), 0, 0);
      if (tree) {
        const crown = r * rng.range(1.1, 1.9);
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2;
          const cx = x + lean * h + Math.cos(a) * crown * 0.5;
          const rad = crown * rng.range(0.55, 0.85);
          const cy = y + h + crown * rng.range(0.1, 0.5);
          sh.lump(cx, cy, z + Math.sin(a) * crown * 0.5, rad, [0.14, 0.32, 0.09], lumps(rad, cx * 0.01),
            1 + Math.sin(a));
        }
      } else {
        for (let k = 0; k < 3; k++) {
          const a = rng.range(0, Math.PI * 2);
          const rad = r * rng.range(0.4, 0.8);
          const cx = x + lean * h + Math.cos(a) * rad * 0.8;
          sh.lump(cx, y + h - rng.range(0, r), z + Math.sin(a) * rad * 0.8, rad, [0.17, 0.38, 0.10],
            lumps(rad, cx * 0.01), 1 + Math.sin(a));
        }
      }
    } else if (what === 'fern') {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + rng.range(0, 1.2);
        const reach = r * rng.range(1.6, 2.8);
        const lift = r * rng.range(0.8, 1.5);
        const path = [];
        for (let q = 0; q <= 4; q++) {
          const t = q / 4;
          path.push({ x: x + Math.cos(a) * reach * t, y: y + lift * Math.sin(t * 2.2) * 0.9, r: r * 0.16 * (1 - t * 0.7) });
        }
        sh.band(path, () => [0.16, 0.30, 0.11], 0, Math.sin(a));
      }
    } else if (what === 'cactus') {
      const h = r * rng.range(5, 9);
      const green = [0.10 + rng.range(-0.01, 0.02), 0.20 + rng.range(-0.02, 0.02), 0.08];
      const trunk = [];
      for (let k = 0; k <= 5; k++) {
        const t = k / 5;
        trunk.push({ x, y: y - r * 0.3 + h * t, r: r * 0.42 * (1 - t * 0.15) });
      }
      sh.band(trunk, () => green, 0, 0);
      sh.disc(x, y + h * 0.97 - r * 0.3, r * 0.36, green, 0, 0);
      const arms = Math.floor(rng.range(0, 3.2));
      for (let k = 0; k < arms; k++) {
        const a = rng.range(0, Math.PI * 2);
        const at = y + h * rng.range(0.35, 0.6);
        const reach = r * rng.range(1.1, 1.8);
        const up = h * rng.range(0.2, 0.35);
        const ax = Math.cos(a);
        const back = Math.sin(a) < 0 ? -0.01 : 0.01;
        sh.band([
          { x, y: at, r: r * 0.3 },
          { x: x + ax * reach * 0.7, y: at + reach * 0.15, r: r * 0.3 },
          { x: x + ax * reach, y: at + reach * 0.5, r: r * 0.29 },
          { x: x + ax * reach, y: at + up, r: r * 0.27 },
        ], () => green, 0, back);
        sh.disc(x + ax * reach, at + up, r * 0.26, green, 0, back);
      }
    } else if (what === 'driftwood') {
      const len = r * rng.range(3, 6);
      const a = rng.range(0, Math.PI);
      const path = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4 - 0.5;
        path.push({ x: x + Math.cos(a) * len * t, y: y + r * 0.3 + Math.sin(t * 3) * r * 0.2,
          r: r * 0.22 * (1 - Math.abs(t) * 0.5) });
      }
      sh.band(path, () => [0.44, 0.40, 0.34], 0, 0);
    } else if (what === 'stalagmite') {
      const h = r * rng.range(2.5, 6);
      const path = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        path.push({ x, y: y + h * t, r: Math.max(0.3, r * 0.5 * (1 - t) ** 1.3) });
      }
      sh.band(path, () => [0.33, 0.30, 0.27], 0, 0);
    }
    if (ink) for (const s of sh.list) s.mark = true;
    const item = shapesItem(w, sh, z, { kind: 'prop' });
    if (item) out.push(item);
  };

  const clearing = (x, z) => Math.abs(x) < 260 + Math.max(0, -z) * 0.065;
  const sparse = 0.5;
  for (let i = 0; i < Math.round(16 * p.density); i++) {
    const z = rng.range(-600, 450);
    const x = (rng.range(0, 1) < 0.5 ? -1 : 1) * (380 + rng.range(0, 1) ** 1.3 * 2100);
    put(x, z, 9 + rng.range(0, 22), props[Math.floor(rng.range(0, props.length))]);
  }
  const low = (what) => (what === 'tree' || what === 'cactus' || what === 'sapling' || what === 'bush' ? 'stone' : what);
  for (let i = 0; i < Math.round(40 * p.density * sparse); i++) {
    const z = 120 + rng.range(0, 1) ** 1.3 * 2100;
    const reach = 60 + (2900 - z) * 0.26;
    const x = (rng.range(0, 1) < 0.5 ? -1 : 1) * (40 + rng.range(0, 1) * reach);
    put(x, z, 3 + rng.range(0, 7), low(props[Math.floor(rng.range(0, props.length))]));
  }
  const count = Math.round(150 * p.density * sparse);
  for (let i = 0; i < count; i++) {
    const z = -700 - rng.range(0, 3400);
    const x = rng.range(-1, 1) * 2400;
    if (Math.abs(x) < 300 && z > -1100) continue;
    if (clearing(x, z) && rng.range(0, 1) < 0.85) continue;
    put(x, z, 9 + rng.range(0, 22), props[Math.floor(rng.range(0, props.length))]);
  }
  for (let i = 0; i < count; i++) {
    const z = -900 - rng.range(0, 7000);
    const away = Math.abs(z / -11000);
    const x = rng.range(-1, 1) * (1800 + away * 11000);
    if (Math.abs(x) < 320 && z > -900) continue;
    if (clearing(x, z) && rng.range(0, 1) < 0.85) continue;
    put(x, z, (7 + rng.range(0, 13)) * (1 + away * 6.0), props[Math.floor(rng.range(0, props.length))]);
  }
  // the little things are ink marks, not shapes with a line round them
  for (const it of out) {
    if (it.batches.every((b) => b.shapes.every((s) => s.mark))) it.marks = true;
  }
  return out.map((it) => (it.marks ? markItem(w, it) : it));
}

/** A tuft or the like: too thin to be anything but a stroke of the pen. */
function markItem(w, it) {
  return {
    ...it,
    draw(ctx, v) {
      this.box = null;
      const s = v.s(this.z);
      if (!s || !v.sees(this, s)) return;
      this.box = boxOf(this, v, s);
      v.at(ctx, this.z);
      ctx.strokeStyle = v.line;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = LINE_PX / s;
      for (const b of this.batches) ctx.stroke(b.path);
    },
  };
}

/**
 * An angular lump, scene.js's shard: six poles pushed in or out, eight flat
 * faces, and each face that looks this way printed lit or in shade by its own
 * normal — which is the whole difference between a stone and a crag.
 */
function shard(sh, cx, cy, r, jitter, col) {
  const poles = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((v, i) => {
    const k = r * (1 + jitter(i));
    return [v[0] * k, v[1] * k, v[2] * k];
  });
  const faces = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  const L = [-0.8, 0.45, 0.4];
  const Ll = Math.hypot(...L);
  const front = [];
  for (const f of faces) {
    const [a, b, c] = f.map((i) => poles[i]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const vv = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * vv[2] - u[2] * vv[1], u[2] * vv[0] - u[0] * vv[2], u[0] * vv[1] - u[1] * vv[0]];
    const nl = Math.hypot(...n) || 1;
    n = n.map((k) => k / nl);
    if (n[2] <= 0) continue;
    const lit = (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / Ll;
    front.push({ pts: [a, b, c], z: (a[2] + b[2] + c[2]) / 3, dark: lit < 0.3 });
  }
  front.sort((p, q) => p.z - q.z);
  for (const f of front) {
    const s = sh.poly(f.pts.map((q) => ({ x: cx + q[0], y: cy + q[1] })), col, 0, f.z * 1e-4);
    s.faceShade = f.dark;
    s.shade = f.dark;
  }
}

/** Coral, as scene.js grows it: branching, brain or fan. */
function coral(sh, x, y, r, rng) {
  const kind = rng.range(0, 1);
  if (kind < 0.4) {
    const col = [0.66, 0.30, 0.34];
    const grow = (px, py, rad, dir, depth) => {
      const len = rad * rng.range(3, 5);
      const nx = px + Math.cos(dir) * len * 0.5;
      const ny = py + len;
      sh.band([{ x: px, y: py, r: rad }, { x: nx, y: ny, r: rad * 0.6 }], () => col, 0, Math.sin(dir) * 0.01);
      if (depth > 0) {
        grow(nx, ny, rad * 0.62, dir + rng.range(0.4, 1.1), depth - 1);
        grow(nx, ny, rad * 0.62, dir - rng.range(0.4, 1.1), depth - 1);
      }
    };
    grow(x, y, r * 0.3, rng.range(0, 6.28), 2);
  } else if (kind < 0.72) {
    const col = [0.72, 0.58, 0.30];
    for (let k = 0; k < 4; k++) {
      const a = rng.range(0, 6.28);
      const d = r * rng.range(0, 0.5);
      const rad = r * rng.range(0.5, 0.8);
      sh.lump(x + Math.cos(a) * d, y + r * 0.3, Math.sin(a) * d, rad, col,
        (px, py, pz) => (noise2(px * 0.14, pz * 0.14, 41) - 0.5) * r * 0.5, Math.sin(a) * d);
    }
  } else {
    const col = [0.58, 0.26, 0.42];
    const a = rng.range(0, 3.14);
    for (let k = 0; k < 5; k++) {
      const t = (k / 4 - 0.5) * 1.6;
      const h = r * rng.range(2, 3.4) * (1 - Math.abs(t) * 0.5);
      sh.band([
        { x: x + Math.cos(a) * t * r, y, r: r * 0.10 },
        { x: x + Math.cos(a) * t * r * 1.5, y: y + h, r: r * 0.04 },
      ], () => col, 0, Math.sin(a) * t);
    }
  }
}

// --------------------------------------------------------------- the forest --

function forestItems(w) {
  const p = w.place;
  const rng = makeRng(3301);
  const out = [];
  const tree = (x, y, z, r, h) => {
    const sh = new Shapes(w.pick, true);
    const lean = rng.range(-0.05, 0.05);
    const trunk = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      trunk.push({ x: x + lean * h * t * t + noise2(t * 3, x, 6) * r * 0.5, y: y - r * 0.6 + h * t,
        r: r * (1 - t * 0.62) * (1 + (1 - t) * (1 - t) * 0.55) });
    }
    const bark = TRUNK_INKS[Math.abs(Math.floor(x * 0.013 + z * 0.0071)) % TRUNK_INKS.length];
    sh.band(trunk, () => bark, 0, 0);
    const limbs = 3 + Math.floor(rng.range(0, 3));
    for (let k = 0; k < limbs; k++) {
      const t = 0.45 + (k / limbs) * 0.5;
      const a = rng.range(0, Math.PI * 2);
      const reach = h * rng.range(0.10, 0.22);
      const bx = x + lean * h * t * t;
      const by = y + h * t;
      const arm = [];
      for (let q = 0; q <= 3; q++) {
        const u = q / 3;
        arm.push({ x: bx + Math.cos(a) * reach * u, y: by + reach * (u * 0.5 + u * u * 0.4), r: r * 0.30 * (1 - u * 0.7) });
      }
      const front = Math.sin(a);
      sh.band(arm, () => bark, 0, front * 0.5);
      const tip = [bx + Math.cos(a) * reach, by + reach * 0.9];
      for (let q = 0; q < 2; q++) {
        const rad = reach * rng.range(0.34, 0.58);
        const lx = tip[0] + rng.range(-rad, rad) * 0.7;
        const ly = tip[1] + rng.range(-rad * 0.4, rad * 0.8);
        const lz = front * reach + rng.range(-rad, rad) * 0.7;
        const colour = [0.11 + rng.range(-0.02, 0.03), 0.30 + rng.range(-0.03, 0.05), 0.07];
        sh.lump(lx, ly, z + lz, rad, colour, lumps(rad, lx * 0.01), 1 + lz / Math.max(1, reach));
      }
    }
    const item = shapesItem(w, sh, z, { kind: 'tree' });
    if (item) out.push(item);
  };
  for (let i = 0; i < 140; i++) {
    const away = 5000 + rng.range(0, 1) ** 1.5 * 30000;
    const z = 3000 - away;
    const spread = away * rng.range(0.07, 0.40);
    const x = (rng.range(0, 1) < 0.5 ? -1 : 1) * spread;
    if (Math.abs(x) < 300 + away * 0.07 && rng.range(0, 1) < 0.8) continue;
    const y = groundAt(x, z, p);
    const r = away * rng.range(0.0035, 0.010);
    tree(x, y, z, r, r * rng.range(26, 44));
  }
  return out;
}

// ---------------------------------------------------------------- the cave --
//
// A tunnel is drawn as slices of itself, one behind another: each slice is the
// rock between one cross-section and the next, cut into pieces round the arch,
// every piece one ink. Laid down furthest first, a nearer slice covers all but
// the opening of the one behind it, which is how a tunnel looks. Lines go where
// neighbouring pieces differ in ink — the beds in the rock.

function caveItems(w) {
  const p = w.place;
  const rng = makeRng(5150);
  const OPEN = -2600;
  const shut = (z) => clamp01((z + 30000) / 9000);
  const halfW = (z) => (1100 + noise2(z * 0.00022, 0, 3) * 520) * shut(z);
  const roof = (z) => (3100 + noise2(z * 0.00031, 9, 4) * 700) * shut(z);
  const COLS = 46;
  const L = [-0.8, 0.45, 0.4];
  const Ll = Math.hypot(...L);
  const ring = (z) => {
    const wd = halfW(z);
    const h = roof(z);
    const pts = [];
    for (let j = 0; j <= COLS; j++) {
      const a = (j / COLS) * Math.PI;
      const bed = Math.sin(a * 5.0 + noise2(z * 0.0004, 0, 11) * 6.0) * 55;
      const fracture = (noise2(Math.cos(a) * 700, z * 0.0009, 7) - 0.5) * 150;
      const coarse = (noise2(Math.cos(a) * 220, z * 0.00028, 19) - 0.5) * 380;
      const ripple = bed + fracture + coarse;
      const x = -Math.cos(a) * (wd + ripple);
      const y = Math.sin(a) * (h + ripple * 0.6) - 300;
      const strata = Math.sin(y * 0.0042 + noise2(z * 0.0003, 0, 27) * 4.0) * 0.5 + 0.5;
      const streak = clamp01(1 - Math.abs(z - OPEN) / 6000) * clamp01(Math.sin(a) * 1.4);
      const v = 0.62 + noise2(x * 0.0016, z * 0.0016, 21) * 0.55 + strata * 0.34;
      const wet = streak * 0.5;
      const col = [p.ground[0] * v * (1 - wet * 0.4), p.ground[1] * v * (1 - wet * 0.3), p.ground[2] * v * (1 - wet * 0.1)];
      const lit = (Math.cos(a) * L[0] - Math.sin(a) * L[1]) / Ll;
      pts.push({ x, y, ink: w.pick(col), dark: lit < 0.3, a });
    }
    return pts;
  };
  const zs = [];
  for (let z = -34000; z < 32000;) {
    zs.push(z);
    z += z < -6000 ? 1500 : z < 0 ? 600 : 400;
  }
  const rings = zs.map((z) => ({ z, pts: ring(z) }));
  const items = [];
  for (let i = 1; i < rings.length; i++) {
    const far = rings[i - 1];
    const near = rings[i];
    items.push({
      z: near.z + 0.5, kind: 'cave',
      draw(ctx, v) {
        const sn = v.s(near.z);
        const sf = v.s(far.z);
        if (!sn || !sf) return;
        v.screen(ctx);
        // the roof is open over the plant: no rock there
        const open = (j) => near.z > OPEN && near.z < 3000 && far.pts[j].a > 1.19 && far.pts[j].a < Math.PI - 1.19;
        const fx = far.pts.map((q) => v.X(q.x, sf));
        const fy = far.pts.map((q) => v.Y(q.y, sf));
        const nx = near.pts.map((q) => v.X(q.x, sn));
        const ny = near.pts.map((q) => v.Y(q.y, sn));
        // the pieces, gathered by the colour they print in: one fill for each
        const groups = new Map();
        for (let j = 0; j < COLS; j++) {
          if (open(j)) continue;
          const key = w.colour(near.pts[j].ink, near.pts[j].dark ? SHADE_OVER : 0);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(j);
        }
        for (const [colour, list] of groups) {
          ctx.beginPath();
          for (const j of list) {
            ctx.moveTo(fx[j], fy[j]);
            ctx.lineTo(fx[j + 1], fy[j + 1]);
            ctx.lineTo(nx[j + 1], ny[j + 1]);
            ctx.lineTo(nx[j], ny[j]);
            ctx.closePath();
          }
          ctx.fillStyle = colour;
          ctx.fill();
          // a hairline of the same colour, so this slice closes up on the next
          ctx.strokeStyle = colour;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        // lines between pieces of different inks — the beds in the rock — and
        // the edge of the break in the roof, against the dark above it
        ctx.beginPath();
        const roofOpen = near.z > OPEN && near.z < 3000;
        for (let j = 0; j < COLS; j++) {
          if (open(j)) continue;
          const ink = near.pts[j].ink;
          if (j + 1 < COLS && !open(j + 1) && near.pts[j + 1].ink !== ink) { ctx.moveTo(fx[j + 1], fy[j + 1]); ctx.lineTo(nx[j + 1], ny[j + 1]); }
          if (far.pts[j].ink !== ink) { ctx.moveTo(fx[j], fy[j]); ctx.lineTo(fx[j + 1], fy[j + 1]); }
          if (roofOpen && ((j + 1 < COLS && open(j + 1)) || (j > 0 && open(j - 1)))) {
            ctx.moveTo(nx[j], ny[j]);
            ctx.lineTo(nx[j + 1], ny[j + 1]);
          }
        }
        ctx.strokeStyle = v.line;
        ctx.lineWidth = LINE_PX;
        ctx.lineCap = 'round';
        ctx.stroke();
      },
    });
  }

  // what hangs from the roof, and what has fallen from it
  for (let i = 0; i < 90; i++) {
    const z = OPEN - rng.range(0, 24000);
    const wd = halfW(z);
    if (wd < 200) continue;
    const x = rng.range(-1, 1) * wd * 0.8;
    const top = Math.sin(Math.acos(clamp(-x / wd, -1, 1))) * roof(z) - 300;
    const roll = rng.range(0, 1);
    const sh = new Shapes(w.pick, true);
    if (roll < 0.5) {
      const drop = rng.range(240, 1100);
      const r = drop * rng.range(0.10, 0.18);
      const path = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        path.push({ x, y: top - drop * t, r: Math.max(1, r * (1 - t * 0.88)) });
      }
      sh.band(path, () => [0.20, 0.175, 0.155], 0, 0);
    } else if (roll < 0.78) {
      const drop = rng.range(700, 2400);
      const r = rng.range(14, 34);
      sh.band([{ x, y: top, r }, { x: x + rng.range(-40, 40), y: top - drop, r: r * 0.55 }],
        () => [0.30, 0.27, 0.24], 0, 0);
    } else {
      const floorY = groundAt(x, z, p);
      const span = top - floorY;
      if (span < 400) continue;
      const r = rng.range(70, 220);
      const path = [];
      for (let k = 0; k <= 5; k++) {
        const t = k / 5;
        path.push({ x: x + Math.sin(t * 3.1) * r * 0.3, y: top - span * t, r: r * (0.55 + Math.abs(t - 0.5) * 0.9) });
      }
      sh.band(path, () => [0.23, 0.20, 0.175], 0, 0);
    }
    const it = shapesItem(w, sh, z, { kind: 'cave' });
    if (it) items.push(it);
  }
  for (let i = 0; i < 40; i++) {
    const z = OPEN - rng.range(0, 20000);
    const wd = halfW(z);
    if (wd < 200) continue;
    const x = rng.range(-1, 1) * wd * 0.85;
    if (Math.abs(x) < 260 && z > -1200) continue;
    const y = groundAt(x, z, p);
    const r = rng.range(60, 260);
    const sh = new Shapes(w.pick, true);
    sh.lump(x, y + r * 0.2, z, r, [0.19, 0.17, 0.15],
      (px, py, pz) => (noise2(px * 0.02, pz * 0.02, 8) - 0.5) * r * 0.55 - Math.max(0, py - y) * 0.5);
    const it = shapesItem(w, sh, z, { kind: 'cave' });
    if (it) items.push(it);
  }
  return items;
}

// ------------------------------------------------------------- under the sea --

const SURFACE_LIGHT = linear('#6fb3f7');
const SURFACE_GLINT = linear('#fbf2dd');

/** The underside of the sea, a ceiling of light, with the bright of it in cream. */
function ceilingItem(w) {
  const p = w.place;
  const y0 = p.underwater;
  const waveAt = (x, z) => Math.sin(x * 0.0035 + z * 0.0021) * 46 + Math.sin(x * 0.0012 - z * 0.0029) * 62
    + (noise2(x * 0.0018, z * 0.0018, 23) - 0.5) * 70;
  const light = w.pick(SURFACE_LIGHT);
  const glint = w.pick(SURFACE_GLINT);
  // The bright places on it, where the sun comes straight through: patches the
  // size of the noise that made them, laid on the plane where they lie.
  const C = 1100;
  const patches = [];
  for (let z = NEAR_Z; z > -60000; z -= C) {
    for (let x = -48000; x < 48000; x += C) {
      const cx = x + (noise2(x * 0.01, z * 0.01, 3) - 0.5) * C * 0.6;
      const cz = z + (noise2(z * 0.01, x * 0.01, 4) - 0.5) * C * 0.6;
      const g = clamp01(noise2(cx * 0.0009, cz * 0.0009, 31) * 1.6 - 0.3);
      if (g > 0.8) patches.push({ x: cx, z: cz, r: C * (0.25 + (g - 0.8) * 2.2) });
    }
  }
  return {
    z: -60000, kind: 'surface',
    // drawn with the sky, before everything: it is the sky, down here
    sky: true,
    draw(ctx, v) {
      v.screen(ctx);
      const far = v.s(-60000);
      if (!far) return;
      const above = y0 > v.ey;
      const N = 48;
      // Seen from below, the surface fills everything from its far edge up —
      // to its near edge, when the camera has pulled back past that.
      const nearS = v.s(NEAR_Z);
      const edgeAt = (z, s) => {
        const out = [];
        for (let i = 0; i <= N; i++) {
          const sx = (i / N) * (v.W + 40) - 20;
          out.push([sx, v.Y(y0 + waveAt(v.ex + (sx - v.W / 2) / s, z), s)]);
        }
        return out;
      };
      const farEdge = edgeAt(-60000, far);
      const nearEdge = nearS ? edgeAt(NEAR_Z, nearS).reverse()
        : [[v.W + 20, above ? -4 : v.H + 4], [-20, above ? -4 : v.H + 4]];
      ctx.beginPath();
      for (const [x, y] of farEdge.concat(nearEdge)) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fillStyle = w.colour(light);
      ctx.fill();
      ctx.strokeStyle = v.line;
      ctx.lineWidth = LINE_PX;
      ctx.stroke();
      ctx.beginPath();
      const bright = ctx;
      for (const p of patches) {
        const s = v.s(p.z);
        if (!s) continue;
        const cx = v.X(p.x, s);
        const rx = p.r * s;
        if (cx < -rx || cx > v.W + rx) continue;
        const yy = y0 + waveAt(p.x, p.z);
        const ya = v.s(p.z + p.r);
        const yb = v.s(p.z - p.r);
        const top = ya ? v.Y(yy, ya) : -1e4;
        const bot = v.Y(yy, yb);
        const cy = (top + bot) / 2;
        const ry = Math.abs(bot - top) / 2;
        if (cy + ry < -2 || cy - ry > v.H + 2 || ry < 0.4) continue;
        bright.moveTo(cx + rx, cy);
        bright.ellipse(cx, cy, rx, Math.min(ry, v.H), 0, 0, Math.PI * 2);
        bright.closePath();
      }
      ctx.lineWidth = LINE_PX * 2;
      ctx.stroke();
      ctx.fillStyle = w.colour(glint);
      ctx.fill();
    },
  };
}

// ---------------------------------------------------------- the drawn ground --
//
// An illustration says "grass" with a few strokes and "meadow" with flowers
// dotted over flat green. Tufts are strokes of the pen; the flowers are flat
// five-petalled heads on short stems. There are hundreds of each, so they are
// gathered by distance into a few items, each drawn in a handful of strokes.

/** Widen a screen box [x0, y0, x1, y1] to take in another. */
function grow(box, x0, y0, x1, y1) {
  if (x0 < box[0]) box[0] = x0;
  if (y0 < box[1]) box[1] = y0;
  if (x1 > box[2]) box[2] = x1;
  if (y1 > box[3]) box[3] = y1;
}

/** An item of many small things covers a box only where one of their own boxes does. */
function partsCover(box) {
  return (this.parts || []).some((p) => p[0] < box[2] && box[0] < p[2] && p[1] < box[3] && box[1] < p[3]);
}

function bucketed(list, n) {
  list.sort((a, b) => a.z - b.z);
  const out = [];
  const per = Math.max(1, Math.ceil(list.length / n));
  for (let i = 0; i < list.length; i += per) out.push(list.slice(i, i + per));
  return out;
}

function tuftItems(w, count, tall) {
  const p = w.place;
  const rng = makeRng(8181);
  const tufts = [];
  for (let i = 0; i < count; i++) {
    const t = rng.range(0, 1) ** 1.5;
    const z = 2600 - t * 9000;
    const away = 2900 - z;
    const x = rng.range(-1, 1) * (away * 0.32 + 200);
    if (Math.hypot(x, z) < 160) continue;
    if (p.water !== undefined && z < p.water) continue;
    const y = groundAt(x, z, p);
    const h = (10 + away * 0.004) * rng.range(0.7, 1.3) * tall;
    const blades = 3 + Math.floor(rng.range(0, 2.5));
    const leans = [];
    for (let b = 0; b < blades; b++) leans.push((b / (blades - 1) - 0.5) * 1.3 + rng.range(-0.15, 0.15));
    tufts.push({ x, y, z, h, leans });
  }
  return bucketed(tufts, 14).map((group) => ({
    z: group[group.length - 1].z, kind: 'tufts', covers: partsCover,
    draw(ctx, v) {
      v.screen(ctx);
      ctx.beginPath();
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      const parts = [];
      for (const t of group) {
        const s = v.s(t.z);
        if (!s) continue;
        const bx = v.X(t.x, s);
        const by = v.Y(t.y, s);
        const hp = t.h * s;
        if (bx < -hp || bx > v.W + hp || by < -hp || by > v.H + hp) continue;
        grow(box, bx - hp, by - hp, bx + hp, by + LINE_PX);
        parts.push([bx - hp, by - hp, bx + hp, by + LINE_PX]);
        for (const lean of t.leans) {
          ctx.moveTo(bx, by);
          ctx.quadraticCurveTo(bx + Math.sin(lean) * hp * 0.45, by - Math.cos(lean) * hp * 0.55,
            bx + Math.sin(lean) * hp * 0.95, by - Math.cos(lean) * hp * 0.95);
        }
      }
      this.box = box[0] < box[2] ? box : null;
      this.parts = parts;
      // the line swallows a blade this thin whole: what is left is the ink mark
      ctx.strokeStyle = v.line;
      ctx.lineWidth = LINE_PX;
      ctx.lineCap = 'round';
      ctx.stroke();
    },
  }));
}

const FLOWER_PETALS = ['#ff6fa6', '#ffd93b', '#3b5fe6', '#fbf7ee', '#ff8a3d', '#f0452b', '#b9a3f0'].map(linear);
const FLOWER_EYES = ['#ffd93b', '#fbf7ee', '#ff8a3d'].map(linear);
/** A five-petalled flower facing the viewer, at unit size. */
const FLOWER = (() => {
  const pts = [];
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    const r = 0.55 + 0.45 * Math.abs(Math.cos(a * 2.5));
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
})();

function meadowItems(w, count) {
  const p = w.place;
  const rng = makeRng(8282);
  const flowers = [];
  for (let i = 0; i < count; i++) {
    const t = rng.range(0, 1) ** 1.4;
    const z = 2400 - t * 8500;
    const away = 2900 - z;
    const x = rng.range(-1, 1) * (away * 0.32 + 200);
    if (Math.hypot(x, z) < 200) continue;
    const g = groundAt(x, z, p);
    const s = (6 + away * 0.0026) * rng.range(0.8, 1.35);
    const top = g + s * rng.range(1.2, 2.2);
    const pc = FLOWER_PETALS[Math.floor(rng.range(0, FLOWER_PETALS.length))];
    let ec = FLOWER_EYES[Math.floor(rng.range(0, FLOWER_EYES.length))];
    if (ec === pc) ec = FLOWER_EYES[0] === pc ? FLOWER_EYES[1] : FLOWER_EYES[0];
    flowers.push({ x, z, g, s, top, petal: w.pick(pc), eye: w.pick(ec) });
  }
  return bucketed(flowers, 12).map((group) => ({
    z: group[group.length - 1].z, kind: 'meadow', covers: partsCover,
    draw(ctx, v) {
      v.screen(ctx);
      // where each flower is on the screen this frame
      const seen = [];
      for (const f of group) {
        const s = v.s(f.z);
        if (!s) continue;
        const x = v.X(f.x, s);
        const y0 = v.Y(f.g, s);
        const y1 = v.Y(f.top, s);
        const r = f.s * s;
        if (x < -r * 2 || x > v.W + r * 2 || y1 < -r * 2 || y0 > v.H + r * 2) continue;
        seen.push({ f, x, y0, y1, r });
      }
      this.box = null;
      if (!seen.length) return;
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      this.parts = seen.map((q) => [q.x - q.r - LINE_PX * 2, q.y1 - q.r - LINE_PX * 2, q.x + q.r + LINE_PX * 2, q.y0 + LINE_PX]);
      for (const p of this.parts) grow(box, ...p);
      this.box = box;
      const head = (q) => {
        ctx.moveTo(q.x + FLOWER[0][0] * q.r, q.y1 - FLOWER[0][1] * q.r);
        for (const [fx, fy] of FLOWER) ctx.lineTo(q.x + fx * q.r, q.y1 - fy * q.r);
        ctx.closePath();
      };
      const eye = (q) => {
        ctx.moveTo(q.x + q.r * 0.3, q.y1);
        ctx.arc(q.x, q.y1, q.r * 0.3, 0, Math.PI * 2);
        ctx.closePath();
      };
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = v.line;
      // the stems, then a line round every head at once, then the heads by colour
      ctx.beginPath();
      for (const q of seen) { ctx.moveTo(q.x, q.y0); ctx.lineTo(q.x, q.y1); }
      ctx.lineWidth = LINE_PX;
      ctx.stroke();
      const open = seen.filter((q) => q.r >= 0.7);
      ctx.beginPath();
      for (const q of open) head(q);
      ctx.lineWidth = LINE_PX * 2;
      ctx.stroke();
      for (const ink of new Set(open.map((q) => q.f.petal))) {
        ctx.beginPath();
        for (const q of open) if (q.f.petal === ink) head(q);
        ctx.fillStyle = w.colour(ink);
        ctx.fill();
      }
      ctx.lineWidth = LINE_PX * 0.8;
      for (const ink of new Set(open.map((q) => q.f.eye))) {
        ctx.beginPath();
        for (const q of open) if (q.f.eye === ink) eye(q);
        ctx.stroke();
        ctx.fillStyle = w.colour(ink);
        ctx.fill();
      }
    },
  }));
}

/** A little heaped earth where the stem comes out of the ground. */
function moundItem(w) {
  const p = w.place;
  const rng = makeRng(7742);
  const y0 = groundAt(0, 0, p);
  const sh = new Shapes(() => w.groundInk, false);
  for (let i = 0; i < 7; i++) {
    const a = i === 0 ? 0 : rng.range(0, Math.PI * 2);
    const d = i === 0 ? 0 : rng.range(18, 62);
    const r = i === 0 ? 78 : rng.range(24, 46);
    sh.lump(Math.cos(a) * d, y0 - r * 0.52, Math.sin(a) * d, r, [0, 0, 0],
      (px, py, pz) => (noise2(px * 0.06, pz * 0.06, 15) - 0.5) * r * 0.4, Math.sin(a) * d);
  }
  const it = shapesItem(w, sh, 1, { kind: 'mound' });
  return it;
}

export { hash21, mix };
