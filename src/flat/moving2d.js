// Everything that moves — birds, fish, butterflies, deer, tumbleweed — flat.
//
// Where each one is, and how it moves, is scene.js's own (birdKind, fishKind,
// and the rest), seed for seed: a flock crossing the sky here is the same flock
// on the same course as in the 3D world. Only the drawing differs. Each creature
// is a few shapes made afresh every frame at its own distance; a flock or a
// school is one item, so the painter's order can put it behind a hill or in
// front of one.

import { makeRng, clamp01 } from '../rng.js';
import { groundAt } from '../gl/scene.js';
import { linear } from '../gl/toon.js';
import { Shapes } from './shapes.js';
import { drawLive } from './paint.js';
import { LINE_PX } from './world2d.js';

const smoothish = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };

/**
 * The screen box a thing was drawn in, left on the item as its `box`, so that while
 * the rest of the picture holds still, whatever stands in front of it can be
 * laid down again over just that box (see Renderer2D).
 */
function around(points, pad) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return x0 <= x1 ? [x0 - pad, y0 - pad, x1 + pad, y1 + pad] : null;
}

/** Turn a point in a creature's own frame (x along it, z across) to face `heading` about the vertical. */
function place(x, y, z, heading, size, lx, ly, lz) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return [x + (lx * c - lz * s) * size, y + ly * size, z + (lx * s + lz * c) * size];
}

export class Moving {
  constructor(world) {
    this.world = world;
    const p = world.place;
    this.kinds = [];
    if (p.clouds) this.kinds.push(birds(world));
    if (p.underwater !== undefined) this.kinds.push(fish(world), circling(world));
    if (p.dunes) this.kinds.push(tumbleweed(world));
    if (p.clouds && !p.cave) this.kinds.push(butterflies(world));
    if (p.creatures) this.kinds.push(deer(world));
  }

  /** What moves, where it is at time t (seconds), each as an item to draw, furthest first. */
  at(t, plant, v) {
    const visits = this.visitsFor(plant);
    const out = [];
    for (const k of this.kinds) k(out, t, visits, v);
    out.sort((a, b) => a.z - b.z);
    return out;
  }

  /** Where the plant's flowers are, for whatever comes to them. */
  visitsFor(plant) {
    const n = plant?.sections?.length ?? 0;
    if (this.visitKey !== n) {
      this.visitKey = n;
      const blooms = [];
      for (const sec of plant?.sections || []) {
        for (const nd of sec.nodes || []) if (nd.kind !== 'leaf') blooms.push([nd.x, nd.y, 0]);
      }
      this.visits = { blooms, top: plant?.bounds?.maxY ?? 300 };
    }
    return this.visits;
  }
}

// --------------------------------------------------------------------- birds --

/** A bird is a mark of the pen: a body and two wings, beating. */
function birds(world) {
  const rng = makeRng(6613);
  const flocks = [];
  for (let f = 0; f < 9; f++) {
    const away = 1500 + rng.range(0, 1) ** 1.3 * 16000;
    const heading = (rng.range(0, 1) < 0.5 ? 0 : Math.PI) + rng.range(-0.55, 0.55);
    const n = 3 + Math.floor(rng.range(0, 6));
    const list = [];
    for (let i = 0; i < n; i++) {
      list.push({ seed: rng.range(0, 1), rate: 1.5 + rng.range(0, 1), phase: rng.range(0, Math.PI * 2),
        slot: [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)] });
    }
    flocks.push({
      home: [rng.range(-1, 1) * away * 0.5, 500 + rng.range(0, 1) * (1800 + away * 0.22), -away],
      heading, speed: away * rng.range(0.018, 0.032) + 40, span: away * 1.2 + 5000,
      start: rng.range(0, 1), size: away * 0.0075, birds: list,
    });
  }
  const wing = (lz) => clamp01((Math.abs(lz) - 0.3) / 1.9) ** 1.3 * 1.5;
  return (out, t) => {
    for (const fl of flocks) {
      const dx = Math.cos(fl.heading);
      const dz = Math.sin(fl.heading);
      const along = ((fl.start * fl.span + t * fl.speed) % fl.span) - fl.span / 2;
      const cx = fl.home[0] + dx * along;
      const cy = fl.home[1] + Math.sin(t * 0.13 + fl.start * 9) * fl.size * 8;
      const cz = fl.home[2] + dz * along;
      const size = fl.size;
      const marks = fl.birds.map((b, i) => {
        const row = Math.ceil(i / 2);
        const side = i === 0 ? 0 : (i % 2 ? 1 : -1);
        const wx = Math.sin(t * 0.31 + b.seed * 40) * size * 1.6 + b.slot[0] * size * 1.5;
        const wy = Math.sin(t * 0.23 + b.seed * 17) * size * 1.3 + b.slot[1] * size * 1.8;
        const wz = Math.cos(t * 0.27 + b.seed * 29) * size * 1.6 + b.slot[2] * size * 1.5;
        const back = row * size * 5.5;
        const aside = side * row * size * 4.2;
        const gliding = smoothish(-0.2, 0.35, Math.sin(t * 0.37 + b.seed * 6.28));
        const stroke = Math.sin(t * Math.PI * 2 * b.rate + b.phase) * (1 - gliding * 0.85);
        const x = cx - dx * back - dz * aside + wx;
        const y = cy + wy - stroke * size * 0.25;
        const z = cz - dz * back + dx * aside + wz;
        const up = 0.12 + stroke * 0.5 + gliding * 0.1;
        const pts = [-2.2, -1.1, 0, 1.1, 2.2].map((lz) => place(x, y, z, fl.heading, size, 0, wing(lz) * up, lz));
        return { pts, x, y, z };
      });
      out.push({
        z: cz,
        draw(ctx, v) {
          const s = v.s(cz);
          if (!s) return;
          v.screen(ctx);
          this.box = null;
          const seen = [];
          for (const m of marks) {
            const px = m.pts.map((q) => [v.X(q[0], s), v.Y(q[1], s)]);
            const bx = px[2][0];
            const by = px[2][1];
            if (bx < -50 || bx > v.W + 50 || by < -50 || by > v.H + 50) continue;
            seen.push(px);
          }
          if (!seen.length) return;
          const pad = Math.max(LINE_PX, 0.5 * size * s) + size * s * 0.3;
          this.boxes = seen.map((px) => around(px, pad));
          this.box = around(seen.flat(), pad);
          ctx.beginPath();
          for (const px of seen) {
            ctx.moveTo(px[0][0], px[0][1]);
            ctx.quadraticCurveTo(px[1][0], px[1][1] - size * s * 0.25, px[2][0], px[2][1]);
            ctx.quadraticCurveTo(px[3][0], px[3][1] - size * s * 0.25, px[4][0], px[4][1]);
          }
          ctx.strokeStyle = v.line;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(LINE_PX, 0.32 * size * s);
          ctx.stroke();
          ctx.beginPath();
          const r = Math.max(0.8, 0.42 * size * s);
          for (const px of seen) {
            ctx.moveTo(px[2][0] + r, px[2][1]);
            ctx.arc(px[2][0], px[2][1], r, 0, Math.PI * 2);
          }
          ctx.fillStyle = v.line;
          ctx.fill();
        },
      });
    }
  };
}

// ---------------------------------------------------------------------- fish --

/** A fish seen from where the camera is: a spindle and a tail, as long as its heading shows it. */
function fishPath(path, v, s, x, y, heading, size, beat) {
  const along = Math.cos(heading);
  const half = Math.max(0.58, 1.48 * Math.abs(along) + 0.58 * Math.abs(Math.sin(heading))) * size * s;
  const tall = 0.58 * size * s;
  const cx = v.X(x, s);
  const cy = v.Y(y, s);
  const dir = along >= 0 ? 1 : -1;
  path.moveTo(cx + half, cy);
  path.ellipse(cx, cy, half, tall, 0, 0, Math.PI * 2);
  path.closePath();
  // the tail, behind it, beating
  const tx = cx - dir * (half + 0.3 * size * s) + Math.sin(heading) * beat * 0.3 * size * s;
  const tw = 0.55 * size * s * Math.max(0.35, Math.abs(along));
  path.moveTo(cx - dir * half * 0.8, cy);
  path.lineTo(tx - dir * tw * 0.6, cy - tall * 0.95);
  path.lineTo(tx - dir * tw * 0.2, cy);
  path.lineTo(tx - dir * tw * 0.6, cy + tall * 0.95);
  path.closePath();
}

function fishDrawer(world, ink, list, z) {
  return {
    z,
    draw(ctx, v) {
      this.box = null;
      const s = v.s(z);
      if (!s) return;
      v.screen(ctx);
      ctx.beginPath();
      const corners = [];
      const boxes = [];
      for (const f of list) {
        const sx = v.X(f.x, s);
        const sy = v.Y(f.y, s);
        const r = 3 * f.size * s;
        if (sx < -r || sx > v.W + r || sy < -r || sy > v.H + r) continue;
        corners.push([sx - r, sy - r], [sx + r, sy + r]);
        boxes.push([sx - r - LINE_PX * 2, sy - r - LINE_PX * 2, sx + r + LINE_PX * 2, sy + r + LINE_PX * 2]);
        fishPath(ctx, v, s, f.x, f.y, f.heading, f.size, f.beat);
      }
      if (!corners.length) return;
      this.box = around(corners, LINE_PX * 2);
      this.boxes = boxes;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = v.line;
      ctx.lineWidth = LINE_PX * 2;
      ctx.stroke();
      ctx.fillStyle = world.colour(ink);
      ctx.fill();
    },
  };
}

function fish(world) {
  const p = world.place;
  const rng = makeRng(9001);
  const COLOURS = [[0.70, 0.50, 0.14], [0.46, 0.52, 0.58], [0.66, 0.30, 0.16]];
  const schools = [];
  for (let s = 0; s < 12; s++) {
    const away = 700 + rng.range(0, 1) ** 1.4 * 12000;
    const n = 8 + Math.floor(rng.range(0, 10));
    const list = [];
    for (let i = 0; i < n; i++) {
      list.push({ seed: rng.range(0, 1), rate: 2.5 + rng.range(0, 2), phase: rng.range(0, Math.PI * 2),
        slot: [rng.range(-1, 1) * 16, rng.range(-1, 1) * 6, rng.range(-1, 1) * 12] });
    }
    schools.push({
      home: [rng.range(-1, 1) * away * 0.3, groundAt(0, -away, p) + 200 + rng.range(0, 1) * p.underwater * 0.8, -away],
      heading: (rng.range(0, 1) < 0.5 ? 0 : Math.PI) + rng.range(-0.6, 0.6),
      speed: away * 0.014 + 50, span: away * 1.7 + 5000, start: rng.range(0, 1),
      size: 16 + away * 0.0045, ink: world.pick(COLOURS[Math.floor(rng.range(0, 3))]), fish: list,
    });
  }
  return (out, t) => {
    for (const sc of schools) {
      const dx = Math.cos(sc.heading);
      const dz = Math.sin(sc.heading);
      const along = ((sc.start * sc.span + t * sc.speed) % sc.span) - sc.span / 2;
      const cx = sc.home[0] + dx * along;
      const cy = sc.home[1] + Math.sin(t * 0.21 + sc.start * 7) * sc.size * 6;
      const cz = sc.home[2] + dz * along;
      const list = sc.fish.map((f) => {
        const [sx, sy, sz] = f.slot;
        const lx = (sx + Math.sin(t * 0.5 + f.seed * 30) * 2.5) * sc.size;
        const lz = (sz + Math.cos(t * 0.43 + f.seed * 23) * 2.5) * sc.size;
        const beat = Math.sin(t * Math.PI * 2 * f.rate + f.phase);
        return { x: cx + lx * dx - lz * dz, y: cy + (sy + Math.sin(t * 0.37 + f.seed * 11) * 1.2) * sc.size,
          heading: sc.heading + beat * 0.06, size: sc.size, beat };
      });
      out.push(fishDrawer(world, sc.ink, list, cz));
    }
  };
}

/** Under water: a few fish that keep circling the plant, in front and behind. */
function circling(world) {
  const ink = world.pick([0.95, 0.72, 0.20]);
  const N = 9;
  return (out, t, visits) => {
    const top = visits ? visits.top : 300;
    const cy = Math.max(120, top * 0.55) + Math.sin(t * 0.2) * 80;
    for (let i = 0; i < N; i++) {
      const radius = 280 + (i % 3) * 30;
      const ang = t * 0.32 + i * 0.35;
      const beat = Math.sin(t * Math.PI * 2 * (3 + (i % 4) * 0.4) + i);
      out.push(fishDrawer(world, ink, [{
        x: Math.sin(ang) * radius, y: cy + (i - N / 2) * 9 + Math.sin(t + i) * 6,
        heading: -ang + Math.PI, size: 11, beat,
      }], Math.cos(ang) * radius));
    }
  };
}

// ---------------------------------------------------------------- tumbleweed --

/** Now and then a dry ball of twigs rolls across the dunes, bouncing, and is gone. */
function tumbleweed(world) {
  const p = world.place;
  const rng = makeRng(4040);
  const weeds = [];
  for (let i = 0; i < 6; i++) {
    const z = -500 - rng.range(0, 1) ** 1.3 * 5500;
    weeds.push({ z, size: 28 + (-z) * 0.009, speed: 170 + rng.range(0, 170), span: 8000 + (-z) * 1.3,
      start: rng.range(0, 1), rest: 1.5 + rng.range(0, 2.5), seed: rng.range(0, 1) });
  }
  // arcs of twig round a ball, every which way
  const r = makeRng(4141);
  const arcs = [];
  for (let a = 0; a < 16; a++) {
    const ax = [r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)];
    const al = Math.hypot(...ax) || 1;
    const u = ax.map((k) => k / al);
    const tmp = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const v1 = [u[1] * tmp[2] - u[2] * tmp[1], u[2] * tmp[0] - u[0] * tmp[2], u[0] * tmp[1] - u[1] * tmp[0]];
    const vl = Math.hypot(...v1) || 1;
    const e1 = v1.map((k) => k / vl);
    const e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
    const a0 = r.range(0, Math.PI * 2);
    const pts = [];
    for (let k = 0; k <= 4; k++) {
      const th = a0 + k * 0.55;
      const rr = 0.8 + r.range(-0.15, 0.15);
      pts.push([(e1[0] * Math.cos(th) + e2[0] * Math.sin(th)) * rr, (e1[1] * Math.cos(th) + e2[1] * Math.sin(th)) * rr]);
    }
    arcs.push(pts);
  }
  return (out, t) => {
    for (const w of weeds) {
      const cycle = w.span * (1 + w.rest);
      const x = ((w.start * cycle + t * w.speed) % cycle) - w.span / 2;
      const y = groundAt(x, w.z, p) + w.size * 0.85 + Math.abs(Math.sin(t * 2.4 + w.seed * 9)) * w.size * 0.7;
      const roll = -x / w.size;
      const c = Math.cos(roll);
      const sn = Math.sin(roll);
      out.push({
        z: w.z,
        draw(ctx, v) {
          this.box = null;
          const s = v.s(w.z);
          if (!s) return;
          const cx = v.X(x, s);
          const cy = v.Y(y, s);
          const rr = w.size * s;
          if (cx < -rr || cx > v.W + rr || cy < -rr || cy > v.H + rr) return;
          this.box = [cx - rr - LINE_PX, cy - rr - LINE_PX, cx + rr + LINE_PX, cy + rr + LINE_PX];
          v.screen(ctx);
          ctx.beginPath();
          for (const pts of arcs) {
            pts.forEach(([lx, ly], k) => {
              const px = cx + (lx * c - ly * sn) * rr;
              const py = cy - (lx * sn + ly * c) * rr;
              if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
            });
          }
          ctx.strokeStyle = v.line;
          ctx.lineWidth = Math.max(LINE_PX * 0.8, 0.09 * rr);
          ctx.lineCap = 'round';
          ctx.stroke();
        },
      });
    }
  };
}

// --------------------------------------------------------------- butterflies --

function butterflies(world) {
  const p = world.place;
  const COLOURS = [[1.0, 0.95, 0.55], [0.95, 0.95, 0.92], [1.0, 0.62, 0.20], [0.55, 0.70, 1.0],
    [1.0, 0.55, 0.75], [1.0, 0.95, 0.55]];
  const flies = COLOURS.map((colour, i) => ({
    seed: i * 0.37 + 0.11, ink: world.pick(colour), stay: 5.5 + (i % 4) * 1.3,
    side: i % 2 ? 1 : -1, depth: -700 + ((i * 0.618) % 1) * 1500,
  }));
  const h = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  const meadow = (f, n) => {
    const x = f.side * (320 + h(n, f.seed * 50) * 1500);
    const z = f.depth + (h(n + 0.5, f.seed * 70) - 0.5) * 500;
    return [x, groundAt(x, z, p) + 30 + h(n + 0.25, f.seed * 90) * 120, z];
  };
  const WINGS = [
    [[0.1, 0.05], [0.55, 0.55], [0.1, 0.9], [-0.15, 0.45]],
    [[-0.05, 0.05], [0.0, 0.5], [-0.45, 0.55], [-0.35, 0.15]],
  ];
  return (out, t, visits) => {
    const blooms = visits && visits.blooms.length ? visits.blooms : null;
    for (const f of flies) {
      const leg = t / f.stay + f.seed * 5;
      const n = Math.floor(leg);
      const pick = (k) => (blooms && h(k, f.seed * 30) < 0.33
        ? blooms[Math.floor(h(k + 0.75, f.seed) * blooms.length) % blooms.length]
        : meadow(f, k));
      const a = pick(n - 1);
      const b = pick(n);
      const go = smoothish(0, 0.25, leg - n);
      const r = 42;
      const x = a[0] + (b[0] - a[0]) * go + Math.sin(t * 1.3 + f.seed * 9) * r;
      const y = a[1] + (b[1] - a[1]) * go + r * 0.6 + Math.sin(t * 2.1 + f.seed * 3) * r * 0.5 + Math.sin(go * Math.PI) * 90;
      const z = a[2] + (b[2] - a[2]) * go + Math.cos(t * 1.1 + f.seed * 5) * r;
      const heading = Math.atan2(-Math.sin(t * 1.1 + f.seed * 5) * 1.1, Math.cos(t * 1.3 + f.seed * 9) * 1.3);
      const flap = 0.4 + Math.sin(t * Math.PI * 2 * 7 + f.seed * 20) * 0.8;
      const sh = new Shapes(() => f.ink);
      for (const side of [-1, 1]) {
        for (const poly of WINGS) {
          sh.poly(poly.map(([px, pz]) => {
            const q = place(x, y, z, heading, 24, px, Math.abs(pz) * flap, pz * side);
            return { x: q[0], y: q[1] };
          }), [1, 1, 1], 0, 0);
        }
      }
      const body = sh.list.length;
      const b0 = place(x, y, z, heading, 24, -0.35, 0, 0);
      const b1 = place(x, y, z, heading, 24, 0.35, 0, 0);
      sh.band([{ x: b0[0], y: b0[1], r: 1.2 }, { x: b1[0], y: b1[1], r: 1.0 }], () => [0, 0, 0], 0, 1);
      sh.list[body].ink = { rgb: [0.12, 0.10, 0.08], hex: 'body' };
      const list = sh.sorted();
      out.push({
        z,
        draw(ctx, v) {
          this.box = null;
          const s = v.s(z);
          if (!s) return;
          const sx = v.X(x, s);
          const sy = v.Y(y, s);
          if (sx < -60 || sx > v.W + 60 || sy < -60 || sy > v.H + 60) return;
          // a butterfly is twenty-four units across, its wings beating up from that
          const r = 30 * s + LINE_PX * 2;
          this.box = [sx - r, sy - r, sx + r, sy + r];
          v.at(ctx, z);
          drawLive(ctx, list, { line: (LINE_PX * 0.8) / s, lineColour: v.line, colour: (ink) => world.colour(ink) });
        },
      });
    }
  };
}

// ---------------------------------------------------------------------- deer --

/**
 * Deer in the wood, walking a stretch of ground and stopping to graze. Seen
 * from the side, which is how they walk past: a body, a neck that bends down to
 * the grass, a head, and four legs swinging.
 */
function deer(world) {
  const p = world.place;
  const rng = makeRng(8154);
  const herd = [];
  for (let i = 0; i < 6; i++) {
    const away = 3000 + rng.range(0, 8000);
    const side = i % 2 ? 1 : -1;
    const near = side * (260 + away * 0.045);
    const far = side * away * rng.range(0.13, 0.19);
    herd.push({ z: 2400 - away, x0: near, x1: far, size: away * 0.010,
      walk: 6 + rng.range(0, 6), graze: 4 + rng.range(0, 5), offset: rng.range(0, 40) });
  }
  const coat = world.pick(linear('#c8733a'));
  const pale = world.pick(linear('#fbf2dd'));
  const at = (d, t) => {
    const P = d.walk + d.graze;
    const tt = t + d.offset;
    const cyc = Math.floor(tt / P);
    const tm = tt - cyc * P;
    const walked = (cyc * d.walk + Math.min(tm, d.walk)) * d.size * 1.1;
    const L = Math.abs(d.x1 - d.x0) || 1;
    const dir = Math.sign(d.x1 - d.x0) || 1;
    const u = walked % (2 * L);
    const outward = u < L;
    const x = outward ? d.x0 + dir * u : d.x1 - dir * (u - L);
    const facing = outward ? dir : -dir;
    const walking = tm < d.walk ? smoothish(0, 0.6, tm) * (1 - smoothish(d.walk - 0.6, d.walk, tm)) : 0;
    const graze = tm >= d.walk ? smoothish(d.walk, d.walk + 1.2, tm) * (1 - smoothish(P - 1.2, P, tm)) : 0;
    const gait = walked / (d.size * 0.9);
    return { x, y: groundAt(x, d.z, p) + Math.abs(Math.cos(gait)) * d.size * 0.06 * walking,
      facing, walking, graze, gait };
  };
  const HIPS = [[0.75, 0.33, 0], [0.75, -0.33, Math.PI], [-0.8, 0.33, Math.PI], [-0.8, -0.33, 0]];
  return (out, t) => {
    for (const d of herd) {
      const a = at(d, t);
      const f = a.facing;
      const nod = -a.graze * 1.9 + Math.sin(a.gait * 2) * 0.06 * a.walking;
      const bend = (lx) => clamp01((lx - 0.9) / 1.0) * nod;
      const P = (lx, ly) => ({ x: a.x + f * lx * d.size, y: a.y + (ly + bend(lx)) * d.size });
      const sh = new Shapes((rgb) => (rgb === 'pale' ? pale : coat));
      const tube = (pts, z, col = 'coat') => sh.band(pts.map(([lx, ly, r]) => ({ ...P(lx, ly), r: r * d.size })),
        () => col, 0, z);
      // the far legs first, then the body, then the near legs over it
      const legs = HIPS.map(([hx, hz, ph]) => {
        const swing = Math.sin(a.gait + ph) * 0.5 * a.walking;
        const c = Math.cos(swing);
        const s = Math.sin(swing);
        const pts = [[0, 0, 0.15], [0, -1.0, 0.09], [0.04, -2.05, 0.07]].map(([lx, ly, r]) =>
          [hx + (lx * c - ly * s), 2.05 + (lx * s + ly * c), r]);
        return { pts, z: hz };
      });
      for (const l of legs) if (l.z < 0) tube(l.pts, -1);
      tube([[-1.25, 2.25, 0.30], [-0.8, 2.25, 0.62], [0.2, 2.3, 0.66], [0.95, 2.4, 0.55], [1.25, 2.55, 0.25]], 0);
      tube([[0.95, 2.55, 0.30], [1.55, 3.45, 0.22]], 0);
      tube([[1.45, 3.55, 0.28], [2.25, 3.25, 0.13]], 0);
      tube([[1.5, 3.75, 0.10], [1.35, 4.25, 0.02]], 0);
      tube([[-1.2, 2.45, 0.13], [-1.45, 2.75, 0.05]], 0.5, 'pale');
      for (const l of legs) if (l.z >= 0) tube(l.pts, 1);
      const list = sh.sorted();
      out.push({
        z: d.z,
        draw(ctx, v) {
          this.box = null;
          const s = v.s(d.z);
          if (!s) return;
          const sx = v.X(a.x, s);
          if (sx < -d.size * 5 * s || sx > v.W + d.size * 5 * s) return;
          // nose to tail and hoof to ear, whichever way it faces
          const reach = d.size * 2.7 * s + LINE_PX * 2;
          this.box = [sx - reach, v.Y(a.y + d.size * 4.5, s) - LINE_PX * 2, sx + reach, v.Y(a.y, s) + LINE_PX * 2];
          v.at(ctx, d.z);
          drawLive(ctx, list, { line: LINE_PX / s, lineColour: v.line, colour: (ink) => world.colour(ink) });
        },
      });
    }
  };
}
