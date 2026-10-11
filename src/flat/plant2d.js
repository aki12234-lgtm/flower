// The plant as flat shapes.
//
// The 3D builder (scene.js, buildPlant) makes every part of the plant out of
// four things: tubes, spheres, curved blades and flat sheets. The illustrated
// look then presses the whole organism into its own plane and prints it from
// the front, so what reaches the screen is only ever their outlines: a tube is
// a band, a sphere is a disc, a blade is the shape it makes seen face on.
//
// So this builds those outlines directly, from the same growth, with the same
// colours, sizes and placements as buildPlant — step for step, kind for kind —
// and never makes a mesh at all. Each shape carries the ink it prints in, the
// pattern its material is printed with, and how far forward it sits, which
// is all the order it is drawn in has to know.

import { makeRng, clamp, clamp01, noise2 } from '../rng.js';
import { nodeOutlines, stemProfile, roundCorners } from '../materials.js';
import {
  MAT_ID, STEM_DRAWN, PART_CLEAR, PIGMENT, hslToRgb, reliefFor, stemColour, flowerHueFor,
  bloomColour, eyeColour,
} from '../gl/scene.js';
import { inkFor, PLANT_SET } from './ink.js';
import { Shapes, norm, cross, rot } from './shapes.js';

/**
 * Which pattern a part is printed with: its material's own, and for a drawn
 * idiom the pattern nearest to it (the same mapping as the scene shader's).
 */
function patternOf(matId) {
  if (matId < 40) return matId;
  return (matId === 42 || matId === 46) ? 11 : matId === 43 ? 6 : matId === 44 ? 9
    : matId === 45 ? 3 : matId === 47 ? 15 : 2;
}

/** How far forward each kind of part sits within a head, so a flower reads as one. */
const ROLE_Z = { stalk: 0.001, part: 0.002, cup: 0.003, eye: 0.004 };

/**
 * Carry a part clear of the stem it grows from — buildPlant's carryClear, on
 * outlines: wherever the head comes nearer the joint than PART_CLEAR of its
 * size, the whole part moves out along its own direction and a stalk carries
 * it there.
 */
function carryClear(shapes, p) {
  const su = Math.sin(p.n.angle);
  const cu = Math.cos(p.n.angle);
  let umin = Infinity;
  for (const [vx, vy] of shapes.outlineSince(p.from)) {
    const x = vx - p.n.x;
    const y = vy - p.n.y;
    const u = x * su + y * cu;
    if (Math.abs(x * cu - y * su) > p.stalkR * 2.2 || u < -0.02 * p.n.size) umin = Math.min(umin, u);
  }
  const clear = p.n.size * PART_CLEAR;
  if (!(umin < clear)) return;
  const shift = clear - umin;
  shapes.shiftSince(p.from, su * shift, cu * shift);
  shapes.band([
    { x: p.n.x, y: p.n.y, r: p.stalkR * 1.3 },
    { x: p.n.x + su * shift, y: p.n.y + cu * shift, r: p.stalkR * 1.3 },
  ], () => p.rgb, p.pat, ROLE_Z.stalk);
}

/**
 * Every shape of the plant, in the order to draw them.
 *
 * `which`, as for buildPlant: 'all', 'settled' (every section but the one
 * growing) or 'growing' (that one alone, as far as it has got).
 */
export function buildFlatPlant(plant, reveal = null, which = 'all') {
  const shapes = new Shapes((rgb) => inkFor(rgb, PLANT_SET, true));
  const flowerHue = flowerHueFor(plant);
  const live = new Map((plant.tips || []).filter((t) => t.alive !== false).map((t) => [t.id, t]));

  for (const section of plant.sections) {
    const growing = reveal && section.step === reveal.step;
    if (which === 'settled' && growing) continue;
    if (which === 'growing' && !growing) continue;
    const kMax = growing ? reveal.progress * section.steps : Infinity;
    if (growing && reveal.progress <= 0) continue;
    const matId = MAT_ID[section.materialId] || 1;
    const pat = patternOf(matId);
    const rng = makeRng(1013 + section.step * 7919);
    const col = stemColour(section, rng);
    const rgb = hslToRgb(col.h, col.s, col.l);
    const salt = section.step * 3.7;
    // a drawn idiom is a picture, and a picture has a clean edge
    const relief = matId >= 40 ? null : reliefFor(section.materialId, salt);
    const pig = PIGMENT[section.materialId] || PIGMENT.botanical;

    // ---- stems ----
    for (const seg of section.segments) {
      const pts = growing ? seg.points.filter((p) => p.k <= kMax) : seg.points;
      if (pts.length < 2) continue;
      const prof = stemProfile(roundCorners(pts, 0.55), 44 + (section.step % 4) * 7, 0.24);
      const segZ = (seg.depth || 0) * 4;
      const p0 = prof.points[0];
      const isBranch = seg.depth > 0;
      const nodeAt = prof.points.map((_, i) => {
        let best = Infinity;
        for (const n of prof.nodes) best = Math.min(best, Math.abs(i - n));
        return Math.exp(-(best * best) / 2.2);
      });
      const path = prof.points.map((p, i) => {
        const d = Math.hypot(p.x - p0.x, p.y - p0.y);
        const flare = isBranch ? 1 + 0.85 * Math.exp(-d / 13) : 1;
        return { x: p.x, y: p.y, r: p.w * 0.5 * STEM_DRAWN * flare * (1 + nodeAt[i] * 0.22) };
      });
      shapes.band(path, (i, p) => {
        const nd = nodeAt[i];
        const along = noise2(p.x * 0.010 + salt, p.y * 0.010, 53) - 0.5;
        const k = 1 + along * 0.20 - nd * 0.14;
        return [Math.min(1, rgb[0] * k + nd * 0.10), rgb[1] * k * (1 - nd * 0.16), rgb[2] * k * (1 - nd * 0.10)];
      }, pat, segZ, relief);
      if (isBranch) shapes.disc(p0.x, p0.y, path[0].r * 1.06, rgb, pat, segZ, relief);
      for (const e of [path[0], path[path.length - 1]]) shapes.disc(e.x, e.y, e.r, rgb, pat, segZ, relief);

      // the bud on the growing tip: stem coloured below, flower coloured above
      const tipNow = live.get(seg.tipId);
      const end = pts[pts.length - 1];
      if (tipNow && (growing || Math.hypot(end.x - tipNow.x, end.y - tipNow.y) < 0.5)) {
        const e = path[path.length - 1];
        const q = path[Math.max(0, path.length - 2)];
        let d = [e.x - q.x, e.y - q.y];
        const dl = Math.hypot(d[0], d[1]) || 1;
        d = [d[0] / dl, d[1] / dl];
        const B = bloomColour(col, { seed: seg.id * 7919, kind: 'bud' }, flowerHue, pig);
        B.s = Math.max(B.s, 75);
        B.l = clamp(B.l, 50, 68);
        const petal = hslToRgb(B.h, B.s, B.l);
        const r0 = Math.max(e.r, 1.2);
        const len = Math.max(r0 * 7, 14);
        const bud = [];
        for (let i = 0; i <= 10; i++) {
          const t = i / 10;
          bud.push({
            x: e.x + d[0] * t * len, y: e.y + d[1] * t * len,
            r: r0 * (0.9 + Math.sin(Math.pow(t, 0.75) * Math.PI) * 1.25) * (1 - t * 0.55),
          });
        }
        shapes.band(bud, (i) => (i < 5 ? rgb : petal), pat, segZ);
      }
    }

    // ---- blooms ----
    let pendingPart = null;
    const carry = () => { if (pendingPart) carryClear(shapes, pendingPart); pendingPart = null; };
    for (const node of section.nodes) {
      carry();
      const OPEN_OVER = 2.2;
      const open = growing ? clamp01((kMax - Math.max(0, node.k - OPEN_OVER)) / OPEN_OVER) : 1;
      if (open <= 0) continue;
      const swell = open * open * (3 - 2 * open);
      const n = swell < 1 ? { ...node, size: node.size * swell } : node;
      buildNode(shapes, n, { col, rgb, pat, flowerHue, pig, matId, setPending: (p) => { pendingPart = p; } });
    }
    carry();
  }
  return shapes.sorted();
}

/** One head: a flower, a fruit or a leaf, kind by kind as buildPlant builds it. */
function buildNode(shapes, n, ctx) {
  const { col, rgb, pat, flowerHue, pig } = ctx;
  const B = bloomColour(col, n, flowerHue, pig);
  // printed, a flower keeps its hue but is one of the loud inks
  B.s = Math.max(B.s, 75);
  B.l = clamp(B.l, 50, 68);
  const brgb = hslToRgb(B.h, B.s, B.l);
  const eye = eyeColour(B.h);
  const parts = nodeOutlines(n.kind, n.size, makeRng(n.seed));
  // Flowers and leaves are clean: their material is carried by the stalk.
  const plain = 2;
  const leafBase = [brgb[0] * 0.72, brgb[1] * 0.80, brgb[2] * 0.66];
  const petalBase = [
    Math.min(1, brgb[0] * 0.70 + 0.34), Math.min(1, brgb[1] * 0.74 + 0.32), Math.min(1, brgb[2] * 0.62 + 0.18),
  ];
  const zs = ROLE_Z.stalk;
  const zp = ROLE_Z.part;
  const zc = ROLE_Z.cup;
  const ze = ROLE_Z.eye;

  const tilt = ((n.seed >> 3) % 1000) / 1000;
  const face = rot([0, 0, 1], [1, 0, 0], -0.10 - tilt * 0.18);
  const stemDir = [Math.sin(n.angle), Math.cos(n.angle), 0];
  const sideDir = [-stemDir[1], stemDir[0], 0];
  const stalkR = n.size * 0.034;
  ctx.setPending({ from: shapes.count, n, rgb, pat, stalkR });

  const along = (from, d, k) => [from[0] + d[0] * k, from[1] + d[1] * k, from[2] + d[2] * k];
  const petiole = (frac) => {
    const tip = along([n.x, n.y, 0], stemDir, n.size * frac);
    shapes.band([{ x: n.x, y: n.y, r: stalkR * 1.3 }, { x: tip[0], y: tip[1], r: stalkR }], () => rgb, pat, zs);
    return tip;
  };
  const calyx = (at) => shapes.disc(at[0], at[1], n.size * 0.085, rgb, pat, zc);
  const veins = (from, len, halfWidth) => {
    for (let i = 0; i < 5; i++) {
      const t = 0.18 + (i / 5) * 0.66;
      const at = along(from, stemDir, t * len);
      const reach = halfWidth * (0.92 - t * 0.55);
      for (const sd of [-1, 1]) {
        const dir = norm([(stemDir[0] + sd * sideDir[0]) * 0.7071, (stemDir[1] + sd * sideDir[1]) * 0.7071, 0]);
        shapes.band([
          { x: at[0], y: at[1], r: n.size * 0.016 },
          { x: at[0] + dir[0] * reach, y: at[1] + dir[1] * reach, r: n.size * 0.005 },
        ], () => [brgb[0] * 0.88, brgb[1] * 0.92, brgb[2] * 0.84], plain, zp + 0.0002);
      }
    }
  };
  const midrib = (from, len, wide) => {
    const path = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const p = along(from, stemDir, t * len);
      path.push({ x: p[0], y: p[1], r: wide * (1 - t * 0.85) });
    }
    shapes.band(path, () => [brgb[0] * 0.86, brgb[1] * 0.88, brgb[2] * 0.84], plain, zp + 0.0001);
  };
  const sphereOn = (from, at, r, colour, z) => shapes.disc(at[0], at[1], r, colour, plain, z);

  switch (n.kind) {
    case 'globe': {
      const hub = along([n.x, n.y, 0], stemDir, n.size * 0.55);
      shapes.band([{ x: n.x, y: n.y, r: stalkR * 1.3 }, { x: hub[0], y: hub[1], r: stalkR }], () => rgb, pat, zs);
      const at = (b) => [n.x + sideDir[0] * b.x + stemDir[0] * b.y, n.y + sideDir[1] * b.x + stemDir[1] * b.y];
      for (const part of parts) {
        if (!part.sphere) continue;
        const [bx, by] = at(part.sphere);
        shapes.band([{ x: hub[0], y: hub[1], r: stalkR * 0.8 }, { x: bx, y: by, r: stalkR * 0.6 }], () => rgb, pat, zs);
      }
      // the back of the cluster first, as the outlines are ordered
      for (const part of parts) {
        if (!part.sphere) continue;
        const [sx, sy] = at(part.sphere);
        shapes.disc(sx, sy, part.sphere.r, brgb, plain, zp + part.sphere.depth * 0.0001);
      }
      return;
    }

    case 'spike': {
      const bare = petiole(0.55);
      calyx(bare);
      const len = n.size * 2.3;
      const path = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const p = along(bare, stemDir, t * len);
        path.push({ x: p[0], y: p[1], r: Math.sin(Math.pow(t, 0.55) * Math.PI) * n.size * 0.185 + n.size * 0.025 });
      }
      shapes.band(path, () => brgb, plain, zp, (u, ang) => Math.sin(ang * 7 + u * 1.4) * n.size * 0.022);
      return;
    }

    case 'bell': {
      const low = sideDir[1] <= 0 ? 1 : -1;
      const hang = norm([stemDir[0] * 0.55 + sideDir[0] * low * 0.84, stemDir[1] * 0.55 + sideDir[1] * low * 0.84, 0]);
      const neck = petiole(0.42);
      calyx(neck);
      const len = n.size * 1.15;
      const path = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const p = along(neck, hang, t * len);
        path.push({ x: p[0], y: p[1], r: n.size * (0.07 + Math.pow(t, 1.7) * 0.34) });
      }
      shapes.band(path, () => brgb, plain, zp);
      return;
    }

    case 'leaf': {
      const base = petiole(0.30);
      shapes.blade({
        origin: base, dir: stemDir, side: sideDir, len: n.size * 2.0, width: n.size * 0.52,
        cup: 0.20, sweep: 0.26, tipTaper: 0.45, albedo: brgb, baseAlbedo: leafBase, ripple: 0.28,
      }, plain, zp);
      midrib(base, n.size * 1.9, n.size * 0.030);
      veins(base, n.size * 1.9, n.size * 0.50);
      return;
    }

    case 'needle':
    case 'star':
    case 'umbel': {
      const arms = n.kind === 'star' ? 8 : 6;
      const long = n.kind === 'needle' ? 1.15 : n.kind === 'star' ? 1.05 : 0.85;
      const wide = n.kind === 'needle' ? 0.15 : n.kind === 'star' ? 0.26 : 0.055;
      for (let i = 0; i < arms; i++) {
        let dir = rot(stemDir, face, (i / 8) * Math.PI * 2);
        if (n.kind === 'needle') dir = norm([dir[0] * 0.55 + stemDir[0] * 0.85, dir[1] * 0.55 + stemDir[1] * 0.85, dir[2] * 0.55]);
        const len = n.size * long * (0.82 + ((n.seed >> (i % 10)) % 5) * 0.07);
        shapes.blade({
          origin: [n.x, n.y, 0], dir, side: cross(face, dir), len, width: n.size * wide, cup: 0.5,
          sweep: n.kind === 'umbel' ? 0.05 : 0.16, tipTaper: n.kind === 'star' ? 0.25 : 0.12,
          albedo: brgb, ripple: 0.1,
        }, plain, zp + dir[2] * 0.0001);
        if (n.kind === 'umbel') {
          const tipP = along([n.x, n.y, 0], dir, len);
          for (let f = 0; f < 6; f++) {
            const fa = (f / 6) * Math.PI * 2;
            shapes.disc(tipP[0] + Math.cos(fa) * n.size * 0.11, tipP[1] + Math.sin(fa) * n.size * 0.08,
              n.size * 0.13, brgb, plain, zc);
          }
        }
      }
      return;
    }

    case 'frond': {
      const len = n.size * 2.1;
      const rachis = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const p = along([n.x, n.y, 0], stemDir, t * len);
        rachis.push({ x: p[0], y: p[1], r: n.size * 0.055 * (1 - t * 0.6) });
      }
      shapes.band(rachis, () => brgb, pat, zs);
      for (let i = 0; i < 5; i++) {
        const t = 0.16 + (i / 5) * 0.78;
        const base = along([n.x, n.y, 0], stemDir, t * len);
        for (const sd of [-1, 1]) {
          const dir = norm([(stemDir[0] + sd * sideDir[0]) * 0.7071, (stemDir[1] + sd * sideDir[1]) * 0.7071, 0]);
          shapes.blade({
            origin: base, dir, side: cross(face, dir), len: n.size * (0.72 - t * 0.32), width: n.size * 0.17,
            cup: 0.4, sweep: 0.2, tipTaper: 0.45, albedo: brgb, ripple: 0.2,
          }, plain, zp);
        }
      }
      return;
    }

    case 'heart':
    case 'lobed':
    case 'strap': {
      const b = {
        heart: { len: 1.55, width: 0.60, cup: 0.16, sweep: 0.22, taper: 1.15, ripple: 0.20 },
        lobed: { len: 1.80, width: 0.44, cup: 0.20, sweep: 0.26, taper: 0.62, ripple: 0.80 },
        strap: { len: 2.90, width: 0.13, cup: 0.34, sweep: 0.38, taper: 0.30, ripple: 0.28 },
      }[n.kind];
      const base = petiole(n.kind === 'strap' ? 0.20 : 0.34);
      shapes.blade({
        origin: base, dir: stemDir, side: sideDir, len: n.size * b.len, width: n.size * b.width,
        cup: b.cup, sweep: b.sweep, tipTaper: b.taper, albedo: brgb, baseAlbedo: leafBase, ripple: b.ripple,
      }, plain, zp);
      if (n.kind !== 'strap') {
        midrib(base, n.size * b.len * 0.92, n.size * 0.028);
        veins(base, n.size * b.len * 0.92, n.size * b.width * 0.95);
      }
      return;
    }

    case 'trefoil': {
      const base = along([n.x, n.y, 0], stemDir, n.size * 0.55);
      shapes.band([{ x: n.x, y: n.y, r: n.size * 0.045 }, { x: base[0], y: base[1], r: n.size * 0.038 }],
        () => brgb, pat, zs);
      for (const sd of [-1, 0, 1]) {
        const dir = sd === 0 ? stemDir
          : norm([(stemDir[0] + sd * sideDir[0]) * 0.7071, (stemDir[1] + sd * sideDir[1]) * 0.7071, 0]);
        shapes.blade({
          origin: base, dir, side: cross(face, dir), len: n.size * (sd === 0 ? 0.95 : 0.82), width: n.size * 0.30,
          cup: 0.40, sweep: 0.24, tipTaper: 1.15, albedo: brgb, ripple: 0.20,
        }, plain, zp);
      }
      return;
    }

    case 'saw':
    case 'arrow': {
      const base = petiole(n.kind === 'arrow' ? 0.22 : 0.28);
      const body = parts.find((p) => p.role === 'body');
      if (body) {
        shapes.sheet({ pts: body.points, origin: base, dir: stemDir, side: sideDir, albedo: brgb }, plain, zp);
        if (n.kind === 'saw') midrib(base, n.size * 1.8, n.size * 0.026);
      }
      return;
    }

    case 'burr': {
      const stalk = petiole(0.30);
      calyx(stalk);
      const core = along(stalk, stemDir, n.size * 0.52);
      // the spines that point away go behind the ball, the rest in front of it
      const spines = [];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const t = ((i % 3) - 1) * 0.7;
        const dir = norm(rot(rot(stemDir, face, a), sideDir, t));
        const len = n.size * (0.30 + ((n.seed >> (i % 9)) % 5) * 0.045);
        spines.push({ dir, len });
      }
      const spine = (s) => shapes.band([
        { x: core[0] + s.dir[0] * n.size * 0.28, y: core[1] + s.dir[1] * n.size * 0.28, r: n.size * 0.045 },
        { x: core[0] + s.dir[0] * (n.size * 0.28 + s.len), y: core[1] + s.dir[1] * (n.size * 0.28 + s.len),
          r: n.size * 0.004 },
      ], () => brgb, plain, zp);
      for (const s of spines) if (s.dir[2] < 0) spine(s);
      shapes.disc(core[0], core[1], n.size * 0.34, brgb, plain, zp + 0.0001);
      for (const s of spines) if (s.dir[2] >= 0) spine(s);
      return;
    }

    case 'allium': {
      const stalk = petiole(0.40);
      calyx(stalk);
      const r = n.size * 0.46;
      const hub = along(stalk, stemDir, r);
      const golden = Math.PI * (3 - Math.sqrt(5));
      const florets = [];
      for (let i = 0; i < 30; i++) {
        const y = 1 - (i / 29) * 2;
        const rad = Math.sqrt(Math.max(0, 1 - y * y));
        const th = i * golden;
        florets.push([Math.cos(th) * rad, y, Math.sin(th) * rad]);
      }
      florets.sort((a, b) => a[2] - b[2]);
      for (const p of florets) {
        shapes.disc(hub[0] + p[0] * r, hub[1] + p[1] * r, n.size * 0.085, brgb, plain, zp + p[2] * 0.0001);
      }
      return;
    }

    case 'drumstick': {
      const stalk = petiole(1.25);
      calyx(stalk);
      shapes.disc(stalk[0], stalk[1], n.size * 0.26, brgb, plain, zp);
      return;
    }

    case 'cactus': {
      const len = n.size * 1.6;
      const ribs = 7;
      const path = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const p = along([n.x, n.y, 0], stemDir, t * len);
        path.push({ x: p[0], y: p[1], r: n.size * (0.20 + Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.14) });
      }
      shapes.band(path, () => brgb, plain, zp, (u, ang, p) => Math.cos(ang * ribs) * p.r * 0.16);
      const pale = [brgb[0] * 1.3 + 0.10, brgb[1] * 1.2 + 0.10, brgb[2] * 1.1 + 0.08];
      for (let k = 1; k <= 4; k++) {
        const t = k / 5;
        const at = along([n.x, n.y, 0], stemDir, t * len);
        const rr = n.size * (0.20 + Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.14);
        for (let i = 0; i < ribs; i++) {
          const dir = norm(rot(stemDir, face, (i / ribs) * Math.PI * 2));
          if (dir[2] < -0.2) continue;   // round the back of the column, out of sight
          const sp = n.size * 0.20;
          shapes.band([
            { x: at[0] + dir[0] * rr, y: at[1] + dir[1] * rr, r: n.size * 0.022 },
            { x: at[0] + dir[0] * (rr + sp), y: at[1] + dir[1] * (rr + sp), r: n.size * 0.003 },
          ], () => pale, plain, zc);
        }
      }
      return;
    }

    case 'button': {
      const stalk = petiole(0.34);
      calyx(stalk);
      const r = n.size * 0.52;
      const seat = along(stalk, face, r * 0.18);
      shapes.blade({
        origin: seat, dir: stemDir, side: sideDir, len: r * 1.9, width: r * 1.9, cup: 0.10, sweep: 0.0,
        tipTaper: 1.9, albedo: brgb, ripple: 0.06,
      }, plain, zp);
      const c = along(along(seat, face, r * 0.30), stemDir, r * 0.95);
      sphereOn(seat, c, r * 0.30, eye, ze);
      return;
    }

    case 'trumpet': {
      const stalk = petiole(0.30);
      calyx(stalk);
      const len = n.size * 1.2;
      const path = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const p = along(stalk, stemDir, t * len);
        path.push({ x: p[0], y: p[1], r: n.size * (0.05 + Math.pow(t, 1.6) * 0.42) });
      }
      shapes.band(path, () => brgb, plain, zp);
      return;
    }

    case 'pom': {
      const stalk = petiole(0.32);
      calyx(stalk);
      const hub = along(stalk, stemDir, n.size * 0.30);
      const rays = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        rays.push(norm(rot(rot(stemDir, face, a), sideDir, ((i % 4) - 1.5) * 0.55)));
      }
      rays.sort((a, b) => a[2] - b[2]);
      for (const dir of rays) {
        const len = n.size * 0.78;
        shapes.band([
          { x: hub[0], y: hub[1], r: n.size * 0.030 },
          { x: hub[0] + dir[0] * len, y: hub[1] + dir[1] * len, r: n.size * 0.012 },
        ], () => brgb, plain, zp + dir[2] * 0.0001);
      }
      shapes.disc(hub[0], hub[1], n.size * 0.10, brgb, plain, zc);
      return;
    }

    case 'fan': {
      shapes.blade({
        origin: petiole(0.46), dir: stemDir, side: sideDir, len: n.size * 1.45, width: n.size * 0.95,
        cup: 0.24, sweep: 0.16, tipTaper: 1.5, albedo: brgb, ripple: 0.26,
      }, plain, zp);
      return;
    }

    case 'pod': {
      const stalk = petiole(0.34);
      calyx(stalk);
      const len = n.size * 1.7;
      const path = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const p = along(stalk, stemDir, t * len);
        path.push({ x: p[0], y: p[1], r: Math.sin(Math.pow(t, 0.8) * Math.PI) * n.size * 0.30 + n.size * 0.02 });
      }
      shapes.band(path, () => brgb, plain, zp);
      return;
    }

    default:
      break;
  }

  // Petal-bearing heads: disc, cup, spider, lily, pansy. The hub is found
  // first and every petal placed from it, as buildPlant does.
  const petals = parts.filter((p) => p.role === 'petal' || p.role === 'body');
  const centroid = (pts) => {
    let ax = 0;
    let ay = 0;
    for (const q of pts) { ax += q.x; ay += q.y; }
    return [ax / pts.length, ay / pts.length];
  };
  const calyxPart = parts.find((p) => p.role === 'calyx');
  let hub = [0, 0];
  if (calyxPart) hub = centroid(calyxPart.points);
  else if (petals.length) {
    const cs = petals.map((p) => centroid(p.points));
    hub = [cs.reduce((a, c) => a + c[0], 0) / cs.length, cs.reduce((a, c) => a + c[1], 0) / cs.length];
  }
  const hubUp = Math.hypot(hub[0], hub[1]);
  const head = along([n.x, n.y, 0], stemDir, hubUp);
  if (hubUp > n.size * 0.12) {
    shapes.band([{ x: n.x, y: n.y, r: stalkR * 1.3 }, { x: head[0], y: head[1], r: stalkR }], () => rgb, pat, zs);
  }
  petals.forEach((p, i) => {
    const [pcx, pcy] = centroid(p.points);
    const cx = pcx - hub[0];
    const cy = pcy - hub[1];
    const reach = Math.hypot(cx, cy) || 1;
    const around = Math.atan2(cx, cy);
    let dir = rot(stemDir, face, around);
    dir = norm([dir[0] * 0.72 + face[0] * 0.68, dir[1] * 0.72 + face[1] * 0.68, dir[2] * 0.72 + face[2] * 0.68]);
    const sd = norm(cross(face, dir));
    shapes.blade({
      origin: along(head, face, n.size * 0.16), dir, side: sd,
      len: reach * 2.0, width: n.size * (0.30 + ((n.seed >> (i % 8)) % 7) * 0.030),
      cup: 0.16, sweep: 0.20 + (i % 3) * 0.06, tipTaper: 0.80, albedo: brgb, baseAlbedo: petalBase, ripple: 0.22,
    }, plain, zp + i * 0.00001);
  });
  // the receptacle the petals come out of, and the florets on it
  shapes.disc(head[0], head[1], n.size * (calyxPart ? 0.20 : 0.12), rgb, pat, zc);
  for (const f of parts.filter((q) => q.role === 'floret')) {
    const ox = f.sphere.x - hub[0];
    const oy = f.sphere.y - hub[1];
    shapes.disc(head[0] + sideDir[0] * ox + stemDir[0] * oy, head[1] + sideDir[1] * ox + stemDir[1] * oy,
      f.sphere.r * 1.1, eye, plain, ze);
  }
}
