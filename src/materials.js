// The material library.
//
// Materials receive geometry and know nothing about how it was grown. That is
// the whole trick: any material can render any shape, so a wool section and a
// wireframe section join into one continuous organism without either system
// having to agree with the other.
//
// Switching is abrupt on purpose. There is no morph between states — the new
// growth simply begins in a different substance. Reference: the hybrid
// botanical constructions of Jennifer Latour, where separate species and
// materials are physically joined into one body.

import { clamp, clamp01, lerp, noise2 } from './rng.js';

// ---------------------------------------------------------------- geometry --

/**
 * Offset a tapered polyline into left/right edges.
 *
 * Growth turns in hard 45 and 90 degree corners, so the offset has to be
 * mitred: simply pushing each point out along the averaged normal pinches an
 * elbow to 70% of the stem's width, and a right angle to half of it. The miter
 * length is the half-width divided by how much the joint normal agrees with the
 * incoming direction, clamped so a near-reversal cannot fire off to infinity.
 */
export function buildRibbon(points) {
  const n = points.length;
  const left = [];
  const right = [];
  const normals = [];

  const dirAt = (i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  };

  for (let i = 0; i < n; i++) {
    const p = points[i];
    const inDir = i === 0 ? dirAt(1) : dirAt(i);
    const outDir = i === n - 1 ? dirAt(n - 1) : dirAt(i + 1);

    // perpendiculars of the incoming and outgoing runs
    const pi = { x: -inDir.y, y: inDir.x };
    const po = { x: -outDir.y, y: outDir.x };
    let mx = pi.x + po.x;
    let my = pi.y + po.y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { mx = pi.x; my = pi.y; } else { mx /= ml; my /= ml; }

    const agree = Math.max(0.42, mx * pi.x + my * pi.y);
    const h = (p.w * 0.5) / agree;

    left.push({ x: p.x + mx * h, y: p.y + my * h });
    right.push({ x: p.x - mx * h, y: p.y - my * h });
    // Travel-based, not mitred: the texture passes want the run's own axis.
    normals.push({ x: pi.x, y: pi.y, tx: inDir.x, ty: inDir.y, ox: po.x, oy: po.y });
  }
  return { mid: points, left, right, normals };
}

/**
 * Fillet the corners.
 *
 * Growth turns in hard corners because that is the rule the organism is built
 * on, but no real stem bends to a knife edge — it makes a radius, and that
 * radius is roughly its own thickness. Rounding at draw time rather than in the
 * geometry keeps the simulation exactly as discrete as it was while the thing
 * on screen reads as material that has been bent.
 */
export function roundCorners(points, radiusScale = 1.0) {
  if (points.length < 3) return points;
  const unit = (a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l, l };
  };
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const d1 = unit(points[i - 1], p);
    const d2 = unit(p, points[i + 1]);
    // not a real corner: leave the point where it is
    if (d1.x * d2.x + d1.y * d2.y > 0.985) { out.push(p); continue; }

    const r = Math.min(p.w * radiusScale, d1.l * 0.44, d2.l * 0.44);
    const a = { x: p.x - d1.x * r, y: p.y - d1.y * r };
    const b = { x: p.x + d2.x * r, y: p.y + d2.y * r };
    const N = 5;
    for (let s = 0; s <= N; s++) {
      const t = s / N;
      const m1x = a.x + (p.x - a.x) * t;
      const m1y = a.y + (p.y - a.y) * t;
      const m2x = p.x + (b.x - p.x) * t;
      const m2y = p.y + (b.y - p.y) * t;
      out.push({
        ...p,
        x: m1x + (m2x - m1x) * t,
        y: m1y + (m2y - m1y) * t,
        fillet: true,
      });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Give the stem a profile.
 *
 * A tapered tube of even thickness is the reason the members read as drinking
 * straws. Real stems are articulated: they swell at a node where a leaf once
 * attached, pinch slightly just above it, and carry that rhythm the whole way
 * up. It is the single most recognisable thing about a stem and no amount of
 * shading substitutes for having it in the geometry.
 *
 * Returns the modulated points plus where the nodes landed, so the material can
 * draw a ring at each one.
 */
export function stemProfile(points, spacing = 46, amount = 0.26) {
  if (points.length < 2) return { points, nodes: [] };
  const out = [];
  const nodes = [];
  let arc = 0;
  let cycle = 0;
  let nextAt = spacing * (0.55 + noise2(0.5, spacing, 3) * 0.7);
  for (let i = 0; i < points.length; i++) {
    if (i > 0) arc += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    // Evenly spaced nodes read as bamboo or as plastic tubing. Real internodes
    // vary a lot along a stem, so each gap is drawn from its own length.
    while (arc >= nextAt) {
      cycle = nextAt;
      nextAt += spacing * (0.55 + noise2(nextAt * 0.031, spacing, 3) * 0.95);
    }
    const span = Math.max(1, nextAt - cycle);
    const phase = clamp01((arc - cycle) / span);
    // swell right at the node, pinch just past it
    const swell = Math.exp(-Math.pow((phase - 0.5) * 4.2, 2)) * amount
                - Math.exp(-Math.pow((phase - 0.78) * 6.5, 2)) * amount * 0.45;
    out.push({ ...points[i], w: points[i].w * (1 + swell) });
    if (i > 0) {
      const prevPhase = ((arc - Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)) % spacing) / spacing;
      if (prevPhase > 0.5 && phase <= 0.5) nodes.push(i);
      else if (prevPhase < 0.5 && phase >= 0.5) nodes.push(i);
    }
  }
  return { points: out, nodes };
}

/**
 * Split a ribbon into its straight runs.
 *
 * Every run is a flat quad with one axis, which is what makes real lighting
 * possible: a straight tube under a directional light has an exact shading
 * gradient across its width, and it differs for a vertical run and a diagonal
 * one. Shading a whole multi-cornered segment with a single gradient is what
 * made the earlier materials read as flat colour.
 */
export function runsOf(rib) {
  const pts = rib.mid;
  const runs = [];
  if (pts.length < 2) return runs;

  const dirOf = (i) => {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  };
  /** Mean direction over a span, so a bowed run gets one honest axis. */
  const spanDir = (i0, i1) => {
    let sx = 0;
    let sy = 0;
    for (let i = i0 + 1; i <= i1; i++) { const d = dirOf(i); sx += d.x; sy += d.y; }
    const l = Math.hypot(sx, sy) || 1;
    return { x: sx / l, y: sy / l };
  };

  // A run ends at a real corner. Members bow by a couple of degrees along their
  // length, and splitting on exact direction would make every single step its
  // own run — one gradient per step, which is banding, not shading.
  const CORNER = Math.cos(0.175); // ~10 degrees
  let start = 0;
  for (let i = 2; i < pts.length; i++) {
    const prev = dirOf(i - 1);
    const cur = dirOf(i);
    if (prev.x * cur.x + prev.y * cur.y < CORNER) {
      const d = spanDir(start, i - 1);
      runs.push({ i0: start, i1: i - 1, dir: d, nrm: { x: -d.y, y: d.x } });
      start = i - 1;
    }
  }
  const d = spanDir(start, pts.length - 1);
  runs.push({ i0: start, i1: pts.length - 1, dir: d, nrm: { x: -d.y, y: d.x } });
  return runs;
}

/** Trace the quad of one straight run. */
export function runPath(ctx, rib, run) {
  ctx.beginPath();
  ctx.moveTo(rib.left[run.i0].x, rib.left[run.i0].y);
  for (let i = run.i0 + 1; i <= run.i1; i++) ctx.lineTo(rib.left[i].x, rib.left[i].y);
  for (let i = run.i1; i >= run.i0; i--) ctx.lineTo(rib.right[i].x, rib.right[i].y);
  ctx.closePath();
}

export function ribbonPath(ctx, rib) {
  ctx.beginPath();
  ctx.moveTo(rib.left[0].x, rib.left[0].y);
  for (let i = 1; i < rib.left.length; i++) ctx.lineTo(rib.left[i].x, rib.left[i].y);
  for (let i = rib.right.length - 1; i >= 0; i--) ctx.lineTo(rib.right[i].x, rib.right[i].y);
  ctx.closePath();
}

export function centerPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

/** Walk the ribbon in grid cells, for the raster-flavoured materials. */
export function forEachCell(rib, size, cb) {
  const seen = new Set();
  const pts = rib.mid;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(segLen / (size * 0.6)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = lerp(a.x, b.x, t);
      const y = lerp(a.y, b.y, t);
      const w = lerp(a.w, b.w, t);
      const nrm = rib.normals[i];
      const across = Math.max(1, Math.ceil(w / (size * 0.7)));
      for (let u = -across; u <= across; u++) {
        const f = across === 0 ? 0 : u / across;
        const px = x + nrm.x * f * w * 0.5;
        const py = y + nrm.y * f * w * 0.5;
        const cx = Math.round(px / size);
        const cy = Math.round(py / size);
        const key = cx + ',' + cy;
        if (seen.has(key)) continue;
        seen.add(key);
        cb(cx * size, cy * size, Math.abs(f), w);
      }
    }
  }
}

// ---------------------------------------------------------------- lighting --

/**
 * One light for the whole organism, from the upper left and slightly towards
 * the viewer. Because it lives in world space, a run climbing to the right and
 * a run climbing to the left catch it differently — which is most of what makes
 * a material read as a solid object rather than a coloured shape.
 */
export const LIGHT = (() => {
  const v = { x: -0.44, y: 0.66, z: 0.61 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

const HALF = (() => {
  const v = { x: LIGHT.x, y: LIGHT.y, z: LIGHT.z + 1 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

const STOPS = 11;

/**
 * A gradient across one run, from the physics of a cylinder rather than from
 * hand-placed colour stops.
 *
 * `u` runs from +1 at the left edge to -1 at the right; the surface normal
 * there is the 2D cross-section normal scaled by u, with the remainder pointing
 * out of the screen. That gives real terminator placement, a specular band that
 * moves with the run's angle, and edges that fall off because they are turning
 * away rather than because a stop was put there.
 */
export function cylinderGradient(ctx, rib, run, P, opt = {}) {
  const ambient = opt.ambient ?? 0.30;
  const wrap = opt.wrap ?? 0.32;
  const spec = opt.spec ?? 0.30;
  const shininess = opt.shininess ?? 26;
  const translucency = opt.translucency ?? 0;
  const satFloor = opt.satFloor ?? 0.75;

  const i = Math.floor((run.i0 + run.i1) / 2);
  const a = rib.left[i];
  const b = rib.right[i];
  const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);

  const nl = run.nrm.x * LIGHT.x + run.nrm.y * LIGHT.y;
  const nh = run.nrm.x * HALF.x + run.nrm.y * HALF.y;

  for (let s = 0; s < STOPS; s++) {
    const t = s / (STOPS - 1);
    const u = 1 - 2 * t;
    const z = Math.sqrt(Math.max(0, 1 - u * u));

    // wrapped lambert, so the terminator is soft the way a waxy surface is
    const lambert = clamp01((u * nl + z * LIGHT.z + wrap) / (1 + wrap));
    const highlight = Math.pow(clamp01(u * nh + z * HALF.z), shininess) * spec;
    // light coming through from behind, brightest where the surface is thinnest
    const through = translucency * (1 - z) * clamp01(-(u * nl));

    const k = ambient + lambert * (1 - ambient) + through;
    const lightness = clamp(P.l * (0.16 + 1.62 * k) + highlight * 52, 3, 97);
    const sat = P.s * clamp(satFloor + (1 - satFloor) * (1 - k * 0.35) - highlight * 1.6, 0.05, 1.25);

    // Warm where the light lands, cool where only the sky reaches. Nothing in
    // the world is lit by one white lamp, and a surface whose shadow is just a
    // darker version of its highlight is the giveaway that it was filled rather
    // than lit.
    const hue = P.h + (k - 0.5) * 14 * (P.h > 40 && P.h < 200 ? 1 : -1);

    g.addColorStop(t, hsl(hue, sat, lightness));
  }
  return g;
}

/**
 * Push a ribbon's edges about with smooth noise.
 *
 * A mathematically exact silhouette is the single loudest signal that a shape
 * was drawn rather than photographed. Real stems are not straight-sided at any
 * magnification, and a few percent of irregularity along the edge does more for
 * believability than any amount of surface texture inside it.
 */
export function roughenRibbon(rib, amount, seed = 0) {
  if (amount <= 0) return rib;
  const left = [];
  const right = [];
  for (let i = 0; i < rib.left.length; i++) {
    const n = rib.normals[i];
    const w = rib.mid[i].w;
    const a = (noise2(i * 0.55, seed, 31) - 0.5) * 2;
    const b = (noise2(i * 0.55, seed + 77, 31) - 0.5) * 2;
    const fine = (noise2(i * 2.3, seed + 5, 13) - 0.5) * 0.8;
    left.push({
      x: rib.left[i].x + n.x * (a + fine) * w * amount,
      y: rib.left[i].y + n.y * (a + fine) * w * amount,
    });
    right.push({
      x: rib.right[i].x - n.x * (b - fine) * w * amount,
      y: rib.right[i].y - n.y * (b - fine) * w * amount,
    });
  }
  return { mid: rib.mid, left, right, normals: rib.normals };
}

/**
 * Variation along a run's length, laid over the cross-section shading.
 *
 * Shading that changes across the width but is constant along it is the other
 * half of the vector look: it says "gradient fill" rather than "object". This
 * modulates lightness down the axis, which also breaks up the specular so it
 * stops reading as a perfect stripe.
 */
export function alongRun(ctx, rib, run, P, strength, seed = 0) {
  if (strength <= 0) return;
  const a = rib.mid[run.i0];
  const b = rib.mid[run.i1];
  const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  const N = 7;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const v = noise2(t * 3.1 + run.i0 * 0.7, seed, 47) - 0.5;
    const light = v > 0;
    g.addColorStop(t, hsl(P.h, P.s * 0.7, light ? P.l * 1.5 : P.l * 0.42, Math.abs(v) * 2 * strength));
  }
  ctx.save();
  runPath(ctx, rib, run);
  ctx.clip();
  ctx.fillStyle = g;
  const bb = ribBounds(rib);
  ctx.fillRect(bb.minX - 4, bb.minY - 4, bb.maxX - bb.minX + 8, bb.maxY - bb.minY + 8);
  ctx.restore();
}

/**
 * The whole real-surface treatment, shared by every material that is meant to
 * be a substance rather than a graphic idiom.
 */
export function paintRealSurface(ctx, rib0, P, R, optics) {
  const rough = optics.rough ?? 0.06;
  const rib = roughenRibbon(rib0, rough, optics.seed ?? 3);

  for (const run of runsOf(rib)) {
    runPath(ctx, rib, run);
    ctx.fillStyle = cylinderGradient(ctx, rib, run, P, optics);
    ctx.fill();
    alongRun(ctx, rib, run, P, optics.variation ?? 0.16, optics.seed ?? 3);
  }

  // Mottling at the scale of the form, not of the pixel. Fine grain at stem
  // width is sub-pixel and reads as dirt; blotches the size of the member read
  // as the thing not being uniformly coloured.
  if (optics.mottle) {
    ctx.save();
    ribbonPath(ctx, rib);
    ctx.clip();
    const bb = ribBounds(rib);
    const n = Math.max(3, Math.round(rib.mid.length * 0.8));
    for (let i = 0; i < n; i++) {
      const p = rib.mid[Math.floor(R() * rib.mid.length)] || rib.mid[0];
      const r = p.w * (0.7 + R() * 1.5);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      const up = R() > 0.5;
      g.addColorStop(0, hsl(P.h + (up ? 6 : -6), P.s * 0.8, up ? P.l * 1.22 : P.l * 0.72, optics.mottle));
      g.addColorStop(1, hsl(P.h, P.s * 0.8, P.l, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Longitudinal ribs. Almost every stem has three to seven of them running its
  // length, and each catches the light according to where it sits around the
  // circumference — so they are drawn from the same lighting model as the body,
  // not as decorative stripes.
  if (optics.ribs) {
    ctx.save();
    ribbonPath(ctx, rib);
    ctx.clip();
    const n = optics.ribs;
    for (const run of runsOf(rib)) {
      const nl = run.nrm.x * LIGHT.x + run.nrm.y * LIGHT.y;
      for (let f = 0; f < n; f++) {
        const u = ((f + 0.5) / n) * 2 - 1;
        const z = Math.sqrt(Math.max(0, 1 - u * u));
        const k = clamp01(u * nl + z * LIGHT.z);
        ctx.beginPath();
        for (let i = run.i0; i <= run.i1; i++) {
          const p = rib.mid[i];
          const nr = rib.normals[i];
          ctx.lineTo(p.x + nr.x * u * p.w * 0.46, p.y + nr.y * u * p.w * 0.46);
        }
        // the groove beside each rib, then the lit crest of the rib itself
        ctx.strokeStyle = hsl(P.h, P.s * 0.9, clamp(P.l * (0.30 + k * 0.5), 3, 92), 0.22);
        ctx.lineWidth = Math.max(0.6, rib.mid[run.i0].w * 0.14);
        ctx.stroke();
        ctx.strokeStyle = hsl(P.h, P.s * 0.7, clamp(P.l * (0.6 + k * 1.5), 5, 96), 0.16);
        ctx.lineWidth = Math.max(0.4, rib.mid[run.i0].w * 0.06);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // The node itself: a darker collar where the swell meets the pinch, and a
  // small scar on one side where something used to be attached.
  if (optics.nodes && optics.nodeAt) {
    ctx.save();
    ribbonPath(ctx, rib);
    ctx.clip();
    for (const i of optics.nodeAt) {
      const p = rib.mid[i];
      if (!p) continue;
      const nr = rib.normals[i];
      ctx.beginPath();
      ctx.moveTo(p.x + nr.x * p.w * 0.62, p.y + nr.y * p.w * 0.62);
      ctx.lineTo(p.x - nr.x * p.w * 0.62, p.y - nr.y * p.w * 0.62);
      ctx.strokeStyle = hsl(P.h - 6, P.s * 1.05, P.l * 0.46, 0.5);
      ctx.lineWidth = Math.max(1.1, p.w * 0.20);
      ctx.stroke();
      ctx.strokeStyle = hsl(P.h, P.s * 0.6, clamp(P.l * 1.5, 6, 95), 0.3);
      ctx.lineWidth = Math.max(0.5, p.w * 0.08);
      ctx.beginPath();
      ctx.moveTo(p.x + nr.x * p.w * 0.6 + nr.tx * p.w * 0.16, p.y + nr.y * p.w * 0.6 + nr.ty * p.w * 0.16);
      ctx.lineTo(p.x - nr.x * p.w * 0.6 + nr.tx * p.w * 0.16, p.y - nr.y * p.w * 0.6 + nr.ty * p.w * 0.16);
      ctx.stroke();
    }
    ctx.restore();
  }

  // A feathered edge with a hint of occlusion in it. A hard vector cut against
  // the background is the last thing that gives the drawing away.
  if (optics.feather) {
    ribbonPath(ctx, rib);
    ctx.strokeStyle = hsl(P.h, P.s * 0.8, P.l * 0.55, 0.12);
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  return rib;
}

/** Darken where a run meets the one before it, the way a real joint occludes. */
export function shadeJoints(ctx, rib, P, strength = 0.30) {
  const runs = runsOf(rib);
  if (runs.length < 2) return;
  ctx.save();
  for (let r = 1; r < runs.length; r++) {
    const i = runs[r].i0;
    const p = rib.mid[i];
    const rad = p.w * 0.95;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
    g.addColorStop(0, hsl(P.h, P.s * 0.9, P.l * 0.34, strength));
    g.addColorStop(1, hsl(P.h, P.s * 0.9, P.l * 0.34, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Draw every straight run of a segment with the same treatment. */
export function eachRun(ctx, rib, fn) {
  for (const run of runsOf(rib)) fn(run);
}

// ----------------------------------------------------------------- palette --

const hsl = (h, s, l, a = 1) =>
  a >= 1 ? `hsl(${((h % 360) + 360) % 360} ${clamp(s, 0, 100)}% ${clamp(l, 0, 100)}%)`
         : `hsl(${((h % 360) + 360) % 360} ${clamp(s, 0, 100)}% ${clamp(l, 0, 100)}% / ${a})`;

function hueTowards(from, to, t) {
  let d = ((to - from + 540) % 360) - 180;
  return from + d * t;
}

/**
 * Build a section's palette. Vitality is folded in here rather than in the
 * renderers, so every material dries out in its own idiom automatically.
 */
export function makePalette(mat, rng, vitality, env, baseHue = null) {
  const wilt = clamp01(1 - vitality);
  let h0 = lerp(mat.hue[0], mat.hue[1], rng());
  const s0 = lerp(mat.sat[0], mat.sat[1], rng()) * 0.92;
  let l0 = lerp(mat.lum[0], mat.lum[1], rng());

  // Pull towards the organism's own hue *and* its own value. In the reference a
  // cactus pad joined to a green stem is still the same green — the join reads
  // as a change of substance, not as a change of colour block. Letting each
  // material keep its own lightness chopped the armature into pale and dark
  // segments, which is what made it look like assembled tubing rather than one
  // organism.
  if (baseHue !== null) {
    h0 = hueTowards(h0, baseHue, 0.68);
    const baseLum = 34 + ((Math.round(baseHue * 7.3) % 100) / 100) * 12;
    l0 = l0 * 0.42 + baseLum * 0.58;
  }

  const h = hueTowards(h0, 34, wilt * 0.6);
  const s = s0 * (1 - wilt * 0.58);
  const l = l0 * (1 - wilt * 0.26) + (env.dark ? -4 : 0);

  const nodeHue = hueTowards(h, mat.nodeHue ?? h + 18, 0.8);
  return {
    wilt,
    base: hsl(h, s, l),
    mid: hsl(h, s * 0.95, l * 0.78),
    dark: hsl(h, s * 0.9, l * 0.5),
    deep: hsl(h, s * 0.8, l * 0.3),
    light: hsl(h, s * 0.65, Math.min(95, l * 1.42)),
    glow: hsl(h, s * 0.5, Math.min(98, l * 1.7)),
    edge: hsl(h, s * 0.85, l * 0.34),
    node: hsl(nodeHue, s * (mat.nodeSat ?? 1), l * (mat.nodeLum ?? 1.06)),
    nodeDark: hsl(nodeHue, s * 0.9, l * 0.55),
    nodeLight: hsl(nodeHue, s * 0.6, Math.min(96, l * 1.5)),
    ink: env.dark ? 'hsl(40 12% 90%)' : 'hsl(30 18% 12%)',
    paper: env.dark ? 'hsl(220 14% 10%)' : 'hsl(42 22% 93%)',
    h, s, l,
  };
}

// ------------------------------------------------------------- node shapes --

/**
 * Bloom outlines in local space, growing along +y before rotation.
 *
 * These are flower heads, not leaves. There are only a handful of them on a
 * plant, mostly at the ends of members, so each one has to be worth looking at:
 * separate parts with roles, which the renderer shades individually.
 */
function circlePoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i <= 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

export function nodeOutlines(kind, size, rnd) {
  const parts = [];
  const rand = rnd || (() => 0.5);

  /** A petal: a rounded blade from the origin outwards, rotated by `a`. */
  const petal = (a, len, wide, role = 'petal', bend = 0) => {
    const pts = [];
    const N = 15;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const along = t * len;
      const across = Math.sin(t * Math.PI) * wide;
      pts.push({ x: across, y: along + bend * Math.sin(t * Math.PI) });
    }
    for (let i = N; i >= 0; i--) {
      const t = i / N;
      const along = t * len;
      const across = Math.sin(t * Math.PI) * wide;
      pts.push({ x: -across, y: along + bend * Math.sin(t * Math.PI) });
    }
    const c = Math.cos(a);
    const s = Math.sin(a);
    parts.push({ role, points: pts.map((q) => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c })) });
  };

  const blob = (cx, cy, rx, ry, role) => {
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }
    parts.push({ role, points: pts });
  };

  switch (kind) {
    // An anemone or daisy. Every petal is its own length, width, angle and
    // curl, one of them is usually stunted, and the ring is never evenly
    // spaced — a head with identical petals at identical angles is the exact
    // signature of a drawn asset rather than a grown thing.
    case 'disc': {
      // Five to seven rays, not six to eleven. A head with a dozen petals is a
      // texture; a head with six is a shape, and a shape is what the reference
      // puts on a bare frame.
      const n = 5 + Math.floor(rand() * 3);
      const cy = size * 0.95;
      const stunted = rand() < 0.45 ? Math.floor(rand() * n) : -1;
      const missing = rand() < 0.25 ? Math.floor(rand() * n) : -1;
      for (let i = 0; i < n; i++) {
        if (i === missing) continue;
        const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.55;
        const len = size * (0.60 + rand() * 0.52) * (i === stunted ? 0.55 : 1);
        const wid = size * (0.25 + rand() * 0.15);
        const curl = (rand() - 0.5) * 0.85;
        const pts = [];
        const N = 13;
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          pts.push({ x: Math.sin(t * Math.PI) * wid + curl * t * t * size * 0.3, y: t * len });
        }
        for (let k = N; k >= 0; k--) {
          const t = k / N;
          pts.push({ x: -Math.sin(t * Math.PI) * wid + curl * t * t * size * 0.3, y: t * len });
        }
        const c = Math.cos(a);
        const s = Math.sin(a);
        parts.push({
          role: 'petal',
          points: pts.map((q) => ({ x: q.x * c - q.y * s, y: cy + (q.x * s + q.y * c) })),
        });
      }
      // the receptacle: a green cup where the petals actually attach
      parts.push({ role: 'calyx', points: circlePoints(0, cy * 0.62, size * 0.26) });
      const FLORETS = 22;
      const golden = Math.PI * (3 - Math.sqrt(5));
      const heads = [];
      for (let f = 0; f < FLORETS; f++) {
        const rr = Math.sqrt(f / FLORETS) * size * 0.30;
        const aa = f * golden;
        heads.push({
          x: Math.cos(aa) * rr,
          y: cy + Math.sin(aa) * rr,
          r: size * (0.052 + 0.026 * (1 - rr / (size * 0.31))),
          depth: 0.25 + 0.5 * (rr / (size * 0.31)),
        });
      }
      for (const h of heads) parts.push({ role: 'floret', sphere: h, points: circlePoints(h.x, h.y, h.r) });
      break;
    }

    // a tulip or poppy: a few broad petals closing into a cup
    case 'cup': {
      const lean = (rand() - 0.5) * 0.4;
      const k = 3 + Math.floor(rand() * 2);
      for (let i = 0; i < k; i++) {
        const a = lean + (i - (k - 1) / 2) * (0.36 + rand() * 0.22);
        petal(a, size * (1.25 + rand() * 0.55), size * (0.28 + rand() * 0.16), 'petal',
              (rand() - 0.5) * size * 0.35);
      }
      blob((rand() - 0.5) * size * 0.1, size * 0.28, size * 0.20, size * 0.16, 'shade');
      parts.push({ role: 'calyx', points: circlePoints(0, size * 0.16, size * 0.22) });
      break;
    }

    // a foxglove or trumpet, hanging off its stem
    case 'bell': {
      const pts = [];
      const N = 14;
      const lean = (rand() - 0.5) * 0.5;
      const lipL = 0.55 + rand() * 0.24;
      const lipR = 0.55 + rand() * 0.24;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push({ x: size * (0.15 + Math.pow(t, 2.1) * lipR) + lean * t * t * size,
                   y: t * size * (1.4 + rand() * 0.08) });
      }
      for (let i = N; i >= 0; i--) {
        const t = i / N;
        pts.push({ x: -size * (0.15 + Math.pow(t, 2.1) * lipL) + lean * t * t * size,
                   y: t * size * 1.44 });
      }
      parts.push({ role: 'body', points: pts });
      blob(lean * size, size * 1.42, size * (lipL + lipR) * 0.5, size * 0.20, 'mouth');
      parts.push({ role: 'calyx', points: circlePoints(0, size * 0.14, size * 0.2) });
      break;
    }

    // A cluster of berries. Equal discs scattered at random read as bubblegum;
    // a real cluster is spheres of different sizes packed together, the ones at
    // the back partly hidden, each catching a single point of light. They are
    // emitted back-to-front so the painter's order does the occluding.
    // A few distinct fruits, not a bunch of grapes. Eleven to eighteen spheres
    // packed into one ball read as a single blobby mass — the least spare thing
    // on the plant, and nothing like the reference, which puts a small number of
    // clearly separate parts on a bare frame.
    case 'globe': {
      const cy = size * 1.0;
      const n = 4 + Math.floor(rand() * 4);
      const berries = [];
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const rad = Math.sqrt(rand());
        // depth: 1 at the front of the cluster, 0 at the back
        const depth = 1 - rad * 0.75 + (rand() - 0.5) * 0.3;
        berries.push({
          x: Math.cos(a) * rad * size * 0.92,
          y: cy + Math.sin(a) * rad * size * 0.82,
          r: size * (0.17 + 0.09 * depth + rand() * 0.05),
          depth,
        });
      }
      berries.sort((p, q) => p.depth - q.depth);
      for (const b of berries) {
        parts.push({ role: 'berry', sphere: b, points: circlePoints(b.x, b.y, b.r) });
      }
      break;
    }

    // a bulrush or grass head
    case 'spike': {
      const pts = [];
      const N = 16;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push({ x: size * 0.26 * Math.sin(Math.pow(t, 0.65) * Math.PI), y: t * size * 2.1 });
      }
      for (let i = N; i >= 0; i--) {
        const t = i / N;
        pts.push({ x: -size * 0.26 * Math.sin(Math.pow(t, 0.65) * Math.PI), y: t * size * 2.1 });
      }
      parts.push({ role: 'body', points: pts });
      break;
    }

    // An umbel: cow parsley, yarrow. Stalks radiate from one point and each
    // ends in a tiny floret, so the head reads as a flat plate of small parts
    // rather than as a single flower. Stalk bearings are held to the same 45
    // degree lattice the stems are built on.
    case 'umbel': {
      const arms = 4 + Math.floor(rand() * 2);
      const cy = size * 0.75;
      for (let i = 0; i < arms; i++) {
        const step = Math.round((i / arms) * 8) % 8;
        const a = (step / 8) * Math.PI * 2 + (rand() - 0.5) * 0.10;
        const len = size * (0.72 + rand() * 0.42);
        const ex = Math.sin(a) * len;
        const ey = cy + Math.cos(a) * len * 0.62;
        parts.push({ role: 'stalk', points: [{ x: 0, y: cy }, { x: ex, y: ey }] });
        for (let f = 0; f < 3; f++) {
          const fa = (f / 3) * Math.PI * 2;
          const fr = size * 0.10;
          parts.push({
            role: 'floret',
            sphere: { x: ex + Math.cos(fa) * fr, y: ey + Math.sin(fa) * fr, r: size * 0.075, depth: 0.6 },
            points: circlePoints(ex + Math.cos(fa) * fr, ey + Math.sin(fa) * fr, size * 0.075),
          });
        }
      }
      break;
    }

    // A star: narrow pointed petals lying flat, on the eighths of a turn.
    case 'star': {
      const n = rand() < 0.5 ? 5 : 6;
      const cy = size * 0.9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const len = size * (1.05 + rand() * 0.30);
        const pts = [];
        const N = 10;
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          pts.push({ x: Math.sin(t * Math.PI) * size * 0.13 * (1 - t * 0.55), y: t * len });
        }
        for (let k = N; k >= 0; k--) {
          const t = k / N;
          pts.push({ x: -Math.sin(t * Math.PI) * size * 0.13 * (1 - t * 0.55), y: t * len });
        }
        const c = Math.cos(a);
        const s = Math.sin(a);
        parts.push({
          role: 'petal',
          points: pts.map((q) => ({ x: q.x * c - q.y * s, y: cy + (q.x * s + q.y * c) })),
        });
      }
      parts.push({ role: 'calyx', points: circlePoints(0, cy, size * 0.18) });
      break;
    }

    // A seed pod: one closed capsule with a seam down it.
    case 'pod': {
      const len = size * (1.5 + rand() * 0.6);
      const wide = size * (0.28 + rand() * 0.12);
      const pts = [];
      const N = 16;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push({ x: Math.sin(t * Math.PI) * wide, y: t * len });
      }
      for (let i = N; i >= 0; i--) {
        const t = i / N;
        pts.push({ x: -Math.sin(t * Math.PI) * wide, y: t * len });
      }
      parts.push({ role: 'body', points: pts });
      parts.push({ role: 'seam', points: [{ x: 0, y: size * 0.06 }, { x: 0, y: len * 0.96 }] });
      break;
    }

    // A frond: leaflets paired along a rachis, each set at 45 degrees to it.
    case 'frond': {
      const len = size * (1.9 + rand() * 0.7);
      const pairs = 4 + Math.floor(rand() * 3);
      parts.push({ role: 'rachis', points: [{ x: 0, y: 0 }, { x: 0, y: len }] });
      for (let i = 0; i < pairs; i++) {
        const t = 0.18 + (i / pairs) * 0.76;
        const ll = size * (0.62 - t * 0.34) * (0.85 + rand() * 0.3);
        for (const side of [-1, 1]) {
          const pts = [];
          const N = 8;
          for (let k = 0; k <= N; k++) {
            const u = k / N;
            pts.push({ x: side * u * ll * 0.707, y: t * len + u * ll * 0.707 + Math.sin(u * Math.PI) * size * 0.09 });
          }
          for (let k = N; k >= 0; k--) {
            const u = k / N;
            pts.push({ x: side * u * ll * 0.707, y: t * len + u * ll * 0.707 - Math.sin(u * Math.PI) * size * 0.09 });
          }
          parts.push({ role: 'leaflet', points: pts });
        }
      }
      break;
    }

    // A tuft of needles, all from one point, on the eighths.
    case 'needle': {
      const n = 5 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const step = (Math.round((i / n) * 8) % 8) - 4;
        const a = (step / 8) * Math.PI * 2 * 0.5 + (rand() - 0.5) * 0.08;
        const len = size * (1.3 + rand() * 0.7);
        const c = Math.cos(a);
        const s = Math.sin(a);
        const w = size * 0.055;
        const pts = [
          { x: -w, y: 0 }, { x: w, y: 0 }, { x: 0, y: len },
        ];
        parts.push({
          role: 'needle',
          points: pts.map((q) => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c })),
        });
      }
      break;
    }

    // A fan: one wide blade with a notch out of the top, ginkgo-like.
    case 'fan': {
      const len = size * (1.15 + rand() * 0.4);
      const spread = 0.55 + rand() * 0.3;
      const pts = [];
      const N = 18;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const a = (t - 0.5) * spread * Math.PI;
        const rr = len * (1 - Math.pow(Math.abs(t - 0.5) * 2, 3) * 0.16);
        const notch = Math.abs(t - 0.5) < 0.07 ? 0.86 : 1;
        pts.push({ x: Math.sin(a) * rr * notch, y: Math.cos(a) * rr * notch });
      }
      pts.push({ x: 0, y: 0 });
      parts.push({ role: 'body', points: pts });
      break;
    }

    // A saw: a blade whose edge is cut into hard teeth. Everything else here
    // curves; this is the one that does not, and the teeth are straight lines
    // meeting at points rather than a wobble in an outline.
    case 'saw': {
      const len = size * (1.9 + rand() * 0.6);
      const wide = size * (0.30 + rand() * 0.10);
      const teeth = 6 + Math.floor(rand() * 4);
      const pts = [];
      const edge = (t) => {
        const body = Math.sin(Math.pow(t, 0.55) * Math.PI);
        // a sawtooth: rises slowly, drops straight back
        const saw = 0.72 + 0.28 * ((t * teeth) % 1);
        return body * saw;
      };
      const N = teeth * 4;
      for (let i = 0; i <= N; i++) { const t = i / N; pts.push({ x: edge(t) * wide, y: t * len }); }
      for (let i = N; i >= 0; i--) { const t = i / N; pts.push({ x: -edge(t) * wide, y: t * len }); }
      parts.push({ role: 'body', points: pts });
      break;
    }

    // Sagittate: the arrowhead-plant leaf. Two lobes point back down the stalk
    // and the apex is drawn out to a point, but every edge between those points
    // is a curve — a first version made it from eight straight segments and it
    // came out as the arrow off a road sign rather than as anything grown.
    case 'arrow': {
      const len = size * (1.7 + rand() * 0.5);
      const wide = size * (0.42 + rand() * 0.12);
      const lobe = size * (0.46 + rand() * 0.20);
      const waist = 0.30 + rand() * 0.08;   // where the blade narrows to the lobes
      const half = [];
      const N = 16;
      // up the side of the blade to the tip: widest low, hollowing towards the point
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const u = waist + (1 - waist) * t;
        const w = Math.sin(Math.pow(1 - t, 0.85) * Math.PI * 0.5) * wide * (1 - t * 0.06);
        half.push({ x: w, y: u * len });
      }
      // and back down the outside of the lobe, which is a curve of its own
      const L = 9;
      for (let i = 1; i <= L; i++) {
        const t = i / L;
        half.push({
          x: wide * (0.62 - 0.30 * t * t) * (1 - t * 0.55) + wide * 0.10,
          y: waist * len - t * lobe,
        });
      }
      const pts = [{ x: 0, y: len }];
      for (let i = half.length - 1; i >= 0; i--) pts.push(half[i]);
      pts.push({ x: 0, y: waist * len * 0.55 });     // the sinus between the lobes
      for (const p of half) pts.push({ x: -p.x, y: p.y });
      parts.push({ role: 'body', points: pts.reverse() });
      break;
    }

    // A spider: a flower of long narrow rays, nothing rounded anywhere.
    case 'spider': {
      const n = 6 + Math.floor(rand() * 3);
      const cy = size * 0.85;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.16;
        const len = size * (1.25 + rand() * 0.55);
        const w = size * 0.055;
        const pts = [
          { x: -w, y: 0 }, { x: w, y: 0 },
          { x: w * 0.35, y: len * 0.72 }, { x: 0, y: len }, { x: -w * 0.35, y: len * 0.72 },
        ];
        const c = Math.cos(a);
        const s2 = Math.sin(a);
        parts.push({
          role: 'petal',
          points: pts.map((q) => ({ x: q.x * c - q.y * s2, y: cy + (q.x * s2 + q.y * c) })),
        });
      }
      parts.push({ role: 'calyx', points: circlePoints(0, cy, size * 0.15) });
      break;
    }

    // A burr: a seed head covered in spines.
    case 'burr': {
      const cy = size * 0.85;
      parts.push({ role: 'body', points: circlePoints(0, cy, size * 0.42) });
      const n = 9 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const len = size * (0.34 + rand() * 0.20);
        const w = size * 0.05;
        const c = Math.cos(a);
        const s2 = Math.sin(a);
        const pts = [{ x: -w, y: size * 0.34 }, { x: w, y: size * 0.34 }, { x: 0, y: size * 0.34 + len }];
        parts.push({
          role: 'spine',
          points: pts.map((q) => ({ x: q.x * c - q.y * s2, y: cy + (q.x * s2 + q.y * c) })),
        });
      }
      break;
    }

    // A button: a plain disc with a contrasting centre. The simplest flower
    // there is — no petals to speak of, just a circle and the eye of it — and
    // the one the minimal references keep coming back to.
    case 'button': {
      const cy = size * 0.85;
      const r = size * (0.52 + rand() * 0.16);
      parts.push({ role: 'body', points: circlePoints(0, cy, r) });
      parts.push({ role: 'eye', points: circlePoints(0, cy, r * 0.34) });
      break;
    }

    // A trumpet: a funnel seen from the side, one clean flare and nothing else.
    case 'trumpet': {
      const len = size * (1.15 + rand() * 0.35);
      const mouth = size * (0.46 + rand() * 0.14);
      const pts = [];
      const N = 14;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push({ x: (0.10 + Math.pow(t, 1.6) * 0.90) * mouth, y: t * len });
      }
      for (let i = N; i >= 0; i--) {
        const t = i / N;
        pts.push({ x: -(0.10 + Math.pow(t, 1.6) * 0.90) * mouth, y: t * len });
      }
      parts.push({ role: 'body', points: pts });
      parts.push({ role: 'mouth', points: circlePoints(0, len, mouth * 0.92) });
      break;
    }

    // A pom: many equal rays from one point, all the same length. A dandelion
    // clock or an allium — repetition rather than arrangement.
    case 'pom': {
      const n = 14 + Math.floor(rand() * 7);
      const cy = size * 0.85;
      const len = size * (0.72 + rand() * 0.22);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const w = size * 0.035;
        const c = Math.cos(a);
        const s2 = Math.sin(a);
        const pts = [{ x: -w, y: 0 }, { x: w, y: 0 }, { x: 0, y: len }];
        parts.push({
          role: 'ray',
          points: pts.map((q) => ({ x: q.x * c - q.y * s2, y: cy + (q.x * s2 + q.y * c) })),
        });
      }
      parts.push({ role: 'calyx', points: circlePoints(0, cy, size * 0.12) });
      break;
    }

    // A lily: six pointed petals recurved back on themselves, on a short tube.
    case 'lily': {
      const cy = size * 0.75;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const len = size * (1.15 + rand() * 0.25);
        const pts = [];
        const N = 12;
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          pts.push({ x: Math.sin(Math.pow(t, 0.7) * Math.PI) * size * 0.20, y: t * len });
        }
        for (let k = N; k >= 0; k--) {
          const t = k / N;
          pts.push({ x: -Math.sin(Math.pow(t, 0.7) * Math.PI) * size * 0.20, y: t * len });
        }
        const c = Math.cos(a);
        const s2 = Math.sin(a);
        parts.push({
          role: 'petal',
          points: pts.map((q) => ({ x: q.x * c - q.y * s2, y: cy + (q.x * s2 + q.y * c) })),
        });
      }
      parts.push({ role: 'calyx', points: circlePoints(0, cy, size * 0.16) });
      break;
    }

    // A pansy: five broad rounded petals, overlapping, face on.
    case 'pansy': {
      const cy = size * 0.80;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const len = size * (0.72 + rand() * 0.16);
        const wide = size * 0.46;
        const pts = [];
        const N = 14;
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          pts.push({ x: Math.sin(Math.pow(t, 0.42) * Math.PI) * wide, y: t * len });
        }
        for (let k = N; k >= 0; k--) {
          const t = k / N;
          pts.push({ x: -Math.sin(Math.pow(t, 0.42) * Math.PI) * wide, y: t * len });
        }
        const c = Math.cos(a);
        const s2 = Math.sin(a);
        parts.push({
          role: 'petal',
          points: pts.map((q) => ({ x: q.x * c - q.y * s2, y: cy + (q.x * s2 + q.y * c) })),
        });
      }
      parts.push({ role: 'eye', points: circlePoints(0, cy, size * 0.13) });
      break;
    }

    // An allium: a globe made of many small florets rather than one surface.
    case 'allium': {
      const cy = size * 1.0;
      const r = size * 0.52;
      const n = 26;
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < n; i++) {
        const rr = Math.sqrt(i / n) * r;
        const aa = i * golden;
        parts.push({
          role: 'floret',
          sphere: { x: Math.cos(aa) * rr, y: cy + Math.sin(aa) * rr, r: size * 0.09, depth: 0.5 },
          points: circlePoints(Math.cos(aa) * rr, cy + Math.sin(aa) * rr, size * 0.09),
        });
      }
      break;
    }

    // A drumstick: one small sphere on a long bare stalk. Nothing else.
    case 'drumstick': {
      const cy = size * 1.35;
      parts.push({ role: 'body', points: circlePoints(0, cy, size * 0.30) });
      parts.push({ role: 'stalk', points: [{ x: 0, y: 0 }, { x: 0, y: cy }] });
      break;
    }

    // A cactus: a ribbed column with spines along the ridges.
    case 'cactus': {
      const len = size * (1.5 + rand() * 0.5);
      const wide = size * 0.34;
      const pts = [];
      const N = 16;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push({ x: wide * (0.75 + Math.sin(t * Math.PI) * 0.25), y: t * len });
      }
      for (let i = N; i >= 0; i--) {
        const t = i / N;
        pts.push({ x: -wide * (0.75 + Math.sin(t * Math.PI) * 0.25), y: t * len });
      }
      parts.push({ role: 'body', points: pts });
      break;
    }

    // A heart: a cordate blade, widest low down with a notched base.
    case 'heart': {
      const len = size * (1.25 + rand() * 0.45);
      const wide = size * (0.62 + rand() * 0.18);
      const pts = [];
      const N = 20;
      const lobe = (t) => Math.sin(Math.pow(t, 0.45) * Math.PI) * (1 - t * 0.12);
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push({ x: lobe(t) * wide, y: t * len });
      }
      // the notch where the two lobes meet the stalk
      pts.push({ x: 0, y: size * 0.20 });
      for (let i = N; i >= 0; i--) {
        const t = i / N;
        pts.push({ x: -lobe(t) * wide, y: t * len });
      }
      parts.push({ role: 'body', points: pts });
      break;
    }

    // A lobed blade, oak-like: the same outline stepped in and out.
    case 'lobed': {
      const len = size * (1.4 + rand() * 0.5);
      const wide = size * (0.46 + rand() * 0.16);
      const lobes = 3 + Math.floor(rand() * 2);
      const pts = [];
      const N = 26;
      const edge = (t) => Math.sin(Math.pow(t, 0.6) * Math.PI)
        * (0.72 + 0.28 * Math.cos(t * lobes * Math.PI * 2));
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push({ x: edge(t) * wide, y: t * len });
      }
      for (let i = N; i >= 0; i--) {
        const t = i / N;
        pts.push({ x: -edge(t) * wide, y: t * len });
      }
      parts.push({ role: 'body', points: pts });
      break;
    }

    // A strap: one long parallel-sided blade, the grass form.
    case 'strap': {
      const len = size * (2.3 + rand() * 0.9);
      const wide = size * (0.15 + rand() * 0.06);
      const pts = [];
      const N = 18;
      const w = (t) => (t < 0.08 ? t / 0.08 : 1) * (1 - Math.pow(t, 5.0)) * wide;
      for (let i = 0; i <= N; i++) { const t = i / N; pts.push({ x: w(t), y: t * len }); }
      for (let i = N; i >= 0; i--) { const t = i / N; pts.push({ x: -w(t), y: t * len }); }
      parts.push({ role: 'body', points: pts });
      break;
    }

    // A trefoil: three leaflets on one short stalk, at 45 degrees to it.
    case 'trefoil': {
      const stalk = size * 0.55;
      parts.push({ role: 'rachis', points: [{ x: 0, y: 0 }, { x: 0, y: stalk }] });
      for (const a of [-Math.PI / 4, 0, Math.PI / 4]) {
        const ll = size * (0.78 + rand() * 0.22) * (a === 0 ? 1.12 : 1);
        const pts = [];
        const N = 12;
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          pts.push({ x: Math.sin(Math.pow(t, 0.5) * Math.PI) * size * 0.26, y: t * ll });
        }
        for (let i = N; i >= 0; i--) {
          const t = i / N;
          pts.push({ x: -Math.sin(Math.pow(t, 0.5) * Math.PI) * size * 0.26, y: t * ll });
        }
        const c = Math.cos(a);
        const s2 = Math.sin(a);
        parts.push({
          role: 'leaflet',
          points: pts.map((q) => ({ x: q.x * c - q.y * s2, y: stalk + (q.x * s2 + q.y * c) })),
        });
      }
      break;
    }

    // one broad leaf with a midrib
    case 'leaf':
    default: {
      const pts = [];
      const N = 16;
      // the two halves of a blade are never the same width, and the midrib bends
      const wl = 0.36 + rand() * 0.2;
      const wr = 0.36 + rand() * 0.2;
      const bend = (rand() - 0.5) * 0.7;
      const len = size * (1.5 + rand() * 0.7);
      const bite = rand() < 0.35 ? 0.3 + rand() * 0.35 : -1; // a notch out of one edge
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const nip = bite > 0 && Math.abs(t - bite) < 0.09 ? 0.45 : 1;
        pts.push({ x: Math.sin(t * Math.PI) * size * wr * nip + bend * t * t * size, y: t * len });
      }
      for (let i = N; i >= 0; i--) {
        const t = i / N;
        pts.push({ x: -Math.sin(t * Math.PI) * size * wl + bend * t * t * size, y: t * len });
      }
      parts.push({ role: 'body', points: pts });
      const ribL = [];
      const ribR = [];
      for (let i = 0; i <= 8; i++) {
        const tt = (i / 8) * 0.92;
        const cxr = bend * tt * tt * size;
        const half = size * 0.022 * (1 - tt * 0.8);
        ribL.push({ x: cxr - half, y: tt * len });
        ribR.push({ x: cxr + half, y: tt * len });
      }
      parts.push({ role: 'rib', points: ribL.concat(ribR.reverse()) });
      break;
    }
  }

  // Slight asymmetry so nothing looks stamped, plus a smooth wobble along each
  // outline: no petal in the world has a curve you could have drawn with a
  // compass, and at bloom scale that is plainly visible.
  //
  // Except on the sharp kinds, where the corners *are* the shape. A wobble
  // rounds a sawtooth back into a wave and takes the barbs off an arrowhead,
  // which would leave the whole set curved again and nothing to tell apart.
  const crisp = kind === 'saw' || kind === 'arrow' || kind === 'spider' || kind === 'burr';
  const j = (rand() - 0.5) * (crisp ? 0.04 : 0.12);
  const wob = size * (crisp ? 0.004 : 0.05);
  const salt = Math.round(rand() * 500);
  return parts.map((p, pi) => ({
    role: p.role,
    sphere: p.sphere,
    points: p.sphere ? p.points : p.points.map((q, qi) => {
      const n = (noise2(qi * 0.55, pi * 7.3 + salt, 19) - 0.5) * 2;
      const r = Math.hypot(q.x, q.y) || 1;
      return {
        x: q.x * (1 + j) + (q.x / r) * n * wob,
        y: q.y * (1 - j * 0.5) + (q.y / r) * n * wob,
      };
    }),
  }));
}

function tracePoly(ctx, poly) {
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}

function pointInPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------- shared draw --

/**
 * Default node renderer, parameterised by the material's own idiom.
 * `style` picks how the outline is realised; the palette does the rest.
 */
/**
 * Each bloom is its own species.
 *
 * The hue departs a long way from the stem's, seeded from the node, so one
 * armature carries several unrelated flowers — which is the whole point of the
 * reference: separate species physically joined into one body. Saturation still
 * runs through the section's palette, so a wilting plant's blooms go with it.
 */
function bloomPalette(P, node) {
  const a = (node.seed % 997) / 997;
  const b = ((node.seed >> 9) % 811) / 811;
  return {
    h: P.h + (a - 0.5) * 210,
    s: clamp(P.s * (1.2 + b * 0.6), 6, 84),
    l: clamp(P.l * (1.2 + b * 0.35), 18, 80),
  };
}

const ROLE_TONE = {
  petal: { l: 1.0, s: 1.0 },
  body: { l: 0.96, s: 1.0 },
  floret: { l: 0.5, s: 0.75 },
  disc: { l: 0.42, s: 0.55 },   // the dark centre of an anemone
  mouth: { l: 0.55, s: 0.9 },   // inside the throat of a bell
  shade: { l: 0.6, s: 0.9 },
  rib: { l: 1.22, s: 0.55 },
  berry: { l: 1.0, s: 1.05 },
  calyx: { l: 0.72, s: 0.85 },
};

/**
 * One part of a bloom, shaded rather than filled.
 *
 * A flat colour inside a hard outline is what makes a flower head read as
 * clip art. A real petal is darker where it meets the centre and where it is
 * shaded by the ones in front, brighter towards its edge, and its outline is a
 * soft turn away from the light rather than a drawn line — so this fills along
 * the petal's own axis and feathers the boundary instead of stroking it.
 */
/**
 * A berry, as a sphere rather than a disc.
 *
 * Three things separate the two: a terminator that runs round the ball instead
 * of across a flat shape, a single small specular *point* offset towards the
 * light rather than a gradient, and a dark contact edge on the shaded side
 * where it meets whatever is behind it.
 */
function fillSphere(ctx, s, B, tone, lx, ly) {
  const lit = { x: s.x - lx * s.r * 0.45, y: s.y - ly * s.r * 0.45 };
  const base = clamp(B.l * tone.l * (0.62 + s.depth * 0.5), 5, 88);

  // contact shadow, just outside the shaded edge
  ctx.beginPath();
  ctx.arc(s.x + lx * s.r * 0.12, s.y + ly * s.r * 0.12, s.r * 1.06, 0, Math.PI * 2);
  ctx.fillStyle = hsl(B.h, B.s * 0.8, clamp(base * 0.34, 2, 60), 0.42);
  ctx.fill();

  const g = ctx.createRadialGradient(lit.x, lit.y, s.r * 0.06, s.x, s.y, s.r * 1.12);
  g.addColorStop(0, hsl(B.h - 4, B.s * tone.s * 0.9, clamp(base * 1.42, 8, 96)));
  g.addColorStop(0.42, hsl(B.h, B.s * tone.s, base));
  g.addColorStop(0.86, hsl(B.h + 6, B.s * tone.s * 1.05, clamp(base * 0.52, 3, 70)));
  // light bouncing back up off the neighbours
  g.addColorStop(1, hsl(B.h + 10, B.s * tone.s * 0.9, clamp(base * 0.78, 4, 80)));
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // the highlight: small, round, and not centred
  ctx.beginPath();
  ctx.arc(lit.x, lit.y, s.r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,255,255,${0.34 + s.depth * 0.3})`;
  ctx.fill();
}

function fillPart(ctx, poly, B, tone, k, cx, cy, veins = false, curve = false) {
  const len = Math.hypot(cx, cy) || 1;
  const ux = cx / len;
  const uy = cy / len;
  const reach = len * 1.9;

  const g = ctx.createLinearGradient(0, 0, ux * reach, uy * reach);
  const base = clamp(B.l * tone.l * k, 4, 94);
  g.addColorStop(0, hsl(B.h, B.s * tone.s * 1.06, clamp(base * 0.58, 3, 90)));
  g.addColorStop(0.42, hsl(B.h, B.s * tone.s, base));
  g.addColorStop(1, hsl(B.h + 5, B.s * tone.s * 0.86, clamp(base * 1.22, 5, 96)));

  tracePoly(ctx, poly);
  ctx.fillStyle = g;
  ctx.fill();

  // A petal is not a flat sheet. It curves along its own length like a shallow
  // trough, so one side of the midline catches the light and the other falls
  // away — shading that runs *across* the petal, on top of the shading that
  // runs along it. Filling with a single axial gradient is what left them
  // reading as cut paper however carefully they were coloured.
  if (curve) {
    const px = -uy;
    const py = ux;
    let half = 0;
    for (const q of poly) half = Math.max(half, Math.abs((q.x - cx) * px + (q.y - cy) * py));
    if (half > 0.6) {
      const nl = px * LIGHT.x + py * LIGHT.y;
      const cg = ctx.createLinearGradient(cx - px * half, cy - py * half, cx + px * half, cy + py * half);
      const N = 7;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const u = 1 - 2 * t;
        const z = Math.sqrt(Math.max(0, 1 - u * u));
        // surface normal rolls from one edge, through facing us, to the other
        const lit = clamp01(u * nl * 0.9 + z * LIGHT.z) - 0.5;
        cg.addColorStop(t, lit > 0
          ? `rgba(255,252,240,${lit * 0.44})`
          : `rgba(24,18,12,${-lit * 0.40})`);
      }
      ctx.save();
      tracePoly(ctx, poly);
      ctx.clip();
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.restore();
    }
  }

  // Veins. A petal or a blade with an unbroken surface reads as cut paper; the
  // ribbing is most of what says the thing grew.
  if (veins) {
    ctx.save();
    tracePoly(ctx, poly);
    ctx.clip();
    ctx.strokeStyle = hsl(B.h, B.s * 0.9, clamp(base * 0.62, 2, 82), 0.34);
    ctx.lineWidth = 0.55;
    for (let v = -2; v <= 2; v++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(
        ux * reach * 0.45 + uy * v * reach * 0.10,
        uy * reach * 0.45 - ux * v * reach * 0.10,
        ux * reach * 0.98 + uy * v * reach * 0.20,
        uy * reach * 0.98 - ux * v * reach * 0.20
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // feathered edge: a thin dark turn, then a wider soft one
  ctx.strokeStyle = hsl(B.h, B.s * 0.9, clamp(base * 0.48, 2, 80), 0.42);
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.strokeStyle = hsl(B.h, B.s * 0.75, clamp(base * 0.7, 2, 88), 0.16);
  ctx.lineWidth = 2.0;
  ctx.stroke();
}

/**
 * Place a bloom: where it is, which way it points, and how far it is tilted
 * away from the viewer.
 *
 * Exported because the cast shadow has to use exactly the same transform. It
 * did not, and the shadow was the flat un-foreshortened outline of a head that
 * was drawn foreshortened, so it read as a second detached object beside it.
 */
export function bloomTransform(ctx, node) {
  ctx.translate(node.x, node.y);
  ctx.rotate(-node.angle);
  const tilt = ((node.seed >> 3) % 1000) / 1000;
  const spin = (((node.seed >> 13) % 1000) / 1000) * Math.PI;
  // A blade is already a flat thing; squashing it as hard as a flower head
  // just makes it a stub.
  const floor = (node.kind === 'leaf' || node.kind === 'spike') ? 0.78 : 0.54;
  const squash = floor + Math.pow(1 - tilt, 1.4) * (1 - floor);
  ctx.rotate(spin);
  ctx.scale(1, squash);
  ctx.rotate(-spin);
}

function drawNodeAs(ctx, node, P, R, style, mat) {
  const parts = nodeOutlines(node.kind, node.size, R);
  const B = bloomPalette(P, node);

  // the light, expressed in the bloom's own rotated frame
  const ca = Math.cos(node.angle);
  const sa = Math.sin(node.angle);
  const lx = LIGHT.x * ca - LIGHT.y * sa;
  const ly = LIGHT.x * sa + LIGHT.y * ca;

  ctx.save();
  bloomTransform(ctx, node);

  for (const part of parts) {
    const poly = part.points;
    const tone = ROLE_TONE[part.role] || ROLE_TONE.petal;

    // how much this part faces the light, from where it sits on the head
    let cx = 0;
    let cy = 0;
    for (const q of poly) { cx += q.x; cy += q.y; }
    cx /= poly.length; cy /= poly.length;
    const len = Math.hypot(cx, cy) || 1;
    const facing = (cx / len) * lx + (cy / len) * ly;
    const k = 0.78 + facing * 0.34;

    // the receptacle belongs to the stem, so it keeps the stem's hue
    const C = part.role === 'calyx' ? { h: P.h, s: P.s, l: P.l } : B;
    const fill = hsl(C.h, C.s * tone.s, clamp(C.l * tone.l * k, 4, 94));

    switch (style) {
      case 'stroke':
        tracePoly(ctx, poly);
        ctx.strokeStyle = fill;
        ctx.lineWidth = mat.lineW ?? 0.9;
        ctx.stroke();
        break;
      case 'cells': {
        const size = mat.cell ?? 3.2;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const q of poly) {
          minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
          minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
        }
        for (let gx = Math.floor(minX / size); gx <= Math.ceil(maxX / size); gx++) {
          for (let gy = Math.floor(minY / size); gy <= Math.ceil(maxY / size); gy++) {
            const px = gx * size;
            const py = gy * size;
            if (!pointInPoly(poly, px, py)) continue;
            mat.cellNode(ctx, px, py, size, { ...P, node: fill, nodeLight: fill, nodeDark: fill }, R);
          }
        }
        break;
      }
      case 'texture':
        if (part.sphere) fillSphere(ctx, part.sphere, C, tone, lx, ly);
        else fillPart(ctx, poly, C, tone, k, cx, cy, false, part.role === 'petal' || part.role === 'body');
        if (!part.sphere) mat.nodeTexture?.(ctx, poly, { ...P, node: fill }, R);
        break;
      default:
        if (part.sphere) { fillSphere(ctx, part.sphere, C, tone, lx, ly); break; }
        // Petals overlap, and an overlapping petal darkens the one beneath it.
        // Without this a flower head is a flat rosette of coloured wedges.
        if (part.role === 'petal') {
          ctx.save();
          ctx.translate(-lx * node.size * 0.10, -ly * node.size * 0.10);
          tracePoly(ctx, poly);
          ctx.fillStyle = 'rgba(18,14,8,0.20)';
          ctx.filter = 'blur(1.6px)';
          ctx.fill();
          ctx.restore();
        }
        fillPart(ctx, poly, C, tone, k, cx, cy,
                 part.role === 'petal' || part.role === 'body',
                 part.role === 'petal' || part.role === 'body');
    }
  }
  ctx.restore();
}

/** Gradient across the ribbon's width, from one edge to the other. */
function acrossGradient(ctx, rib, stops) {
  const i = Math.floor(rib.mid.length / 2);
  const l = rib.left[i];
  const r = rib.right[i];
  const g = ctx.createLinearGradient(l.x, l.y, r.x, r.y);
  for (const [pos, col] of stops) g.addColorStop(pos, col);
  return g;
}

function grainOver(ctx, rib, P, R, amount, scale) {
  ctx.save();
  ribbonPath(ctx, rib);
  ctx.clip();
  const b = ribBounds(rib);
  const step = scale;
  for (let x = b.minX; x < b.maxX; x += step) {
    for (let y = b.minY; y < b.maxY; y += step) {
      const v = noise2(x * 0.12, y * 0.12, 7);
      if (v > 0.55) {
        ctx.fillStyle = v > 0.78 ? P.light : P.deep;
        ctx.globalAlpha = amount * (v - 0.5);
        ctx.fillRect(x, y, step, step);
      }
    }
  }
  ctx.restore();
}

/**
 * Draw one character the right way up.
 * The renderer draws the plant in a y-up frame, which means the canvas y axis
 * is negated; text drawn straight into that frame comes out mirrored.
 */
function glyph(ctx, ch, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, -1);
  ctx.fillText(ch, 0, 0);
  ctx.restore();
}

export function ribBounds(rib) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const arr of [rib.left, rib.right]) {
    for (const p of arr) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, maxX, minY, maxY };
}

// --------------------------------------------------------------- materials --

const base = {
  hue: [90, 130], sat: [30, 45], lum: [40, 55],
  nodeStyle: 'fill',
  node(ctx, n, P, R) { drawNodeAs(ctx, n, P, R, this.nodeStyle, this); },
};

export const MATERIALS = [
  {
    ...base, id: 'botanical', name: 'Botanical',
    hue: [78, 132], sat: [24, 40], lum: [26, 42], nodeHue: 100,
    affinity: (v) => 1.1 + v.stability * 0.9 + v.order * 0.4,
    stem(ctx, rib, seg, P, R, nodeAt) {
      // A stem is 4 to 10 pixels wide. Fibres, grain and thumbprints at that
      // scale are sub-pixel and read as dirt rather than as surface, which is
      // exactly what made the earlier "realistic" pass look wrong. The realism
      // lives in the blooms; the member itself just needs to be a clean, well
      // lit solid.
      const r = paintRealSurface(ctx, rib, P, R, {
        ambient: 0.26, wrap: 0.48, spec: 0.18, shininess: 14, translucency: 0.30,
        satFloor: 0.84, rough: 0.075, variation: 0.20, mottle: 0.13, seed: 3,
        ribs: 5, nodes: true, nodeAt,
      });
      shadeJoints(ctx, r, P, 0.16);
    },
    nodeTexture(ctx, poly, P, R) {
      ctx.save(); tracePoly(ctx, poly); ctx.clip();
      ctx.strokeStyle = P.nodeDark; ctx.globalAlpha = 0.35; ctx.lineWidth = 0.4;
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo((i / 6 - 0.5) * 40, 40);
        ctx.stroke();
      }
      ctx.restore();
    },
    nodeStyle: 'texture',
  },
  {
    ...base, id: 'simple3d', name: 'Simple 3D',
    hue: [80, 130], sat: [12, 24], lum: [30, 44], nodeHue: 110,
    affinity: (v) => 0.7 + v.order * 1.2 + v.stability * 0.5,
    stem(ctx, rib, seg, P) {
      // Same lighting, quantised into bands: a render with the shading steps
      // left visible rather than a different physical material.
      eachRun(ctx, rib, (run) => {
        runPath(ctx, rib, run);
        ctx.save();
        ctx.clip();
        const i = Math.floor((run.i0 + run.i1) / 2);
        const a = rib.left[i];
        const b = rib.right[i];
        const nl = run.nrm.x * LIGHT.x + run.nrm.y * LIGHT.y;
        const BANDS = 4;
        for (let s = 0; s < BANDS; s++) {
          const u = 1 - 2 * ((s + 0.5) / BANDS);
          const z = Math.sqrt(Math.max(0, 1 - u * u));
          const k = clamp01((u * nl + z * LIGHT.z + 0.2) / 1.2);
          ctx.fillStyle = hsl(P.h, P.s, clamp(P.l * (0.45 + 1.1 * k), 6, 94));
          const t0 = s / BANDS;
          const t1 = (s + 1) / BANDS;
          ctx.beginPath();
          ctx.moveTo(lerp(a.x, b.x, t0), lerp(a.y, b.y, t0));
          ctx.lineTo(lerp(a.x, b.x, t1), lerp(a.y, b.y, t1));
          const ex = run.dir.x * 4000;
          const ey = run.dir.y * 4000;
          ctx.lineTo(lerp(a.x, b.x, t1) + ex, lerp(a.y, b.y, t1) + ey);
          ctx.lineTo(lerp(a.x, b.x, t0) + ex, lerp(a.y, b.y, t0) + ey);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(lerp(a.x, b.x, t0), lerp(a.y, b.y, t0));
          ctx.lineTo(lerp(a.x, b.x, t1), lerp(a.y, b.y, t1));
          ctx.lineTo(lerp(a.x, b.x, t1) - ex, lerp(a.y, b.y, t1) - ey);
          ctx.lineTo(lerp(a.x, b.x, t0) - ex, lerp(a.y, b.y, t0) - ey);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      });
      shadeJoints(ctx, rib, P, 0.22);
    },
  },
  {
    ...base, id: 'clay', name: 'Clay',
    hue: [14, 34], sat: [26, 44], lum: [36, 50], nodeHue: 22,
    affinity: (v) => 0.8 + v.attachment * 1.0 + v.stability * 0.7 - v.intensity * 0.3,
    stem(ctx, rib, seg, P, R, nodeAt) {
      // Unfired clay: almost no specular, a wide soft terminator, and the
      // surface pushed about by hand.
      // Clay reads from its optics: a wide soft terminator, no highlight, and a
      // surface that has been worked, so the silhouette is the least regular of
      // any of these.
      const r = paintRealSurface(ctx, rib, P, R, {
        ambient: 0.40, wrap: 0.62, spec: 0.06, shininess: 5, translucency: 0.05,
        satFloor: 0.9, rough: 0.13, variation: 0.24, mottle: 0.16, seed: 11, nodes: true, nodeAt,
      });
      shadeJoints(ctx, r, P, 0.26);
    },
  },
  {
    ...base, id: 'wool', name: 'Wool',
    hue: [24, 44], sat: [14, 28], lum: [34, 46], nodeHue: 30,
    affinity: (v) => 0.6 + v.attachment * 1.4 + v.stability * 0.4 - v.order * 0.3,
    stem(ctx, rib, seg, P, R) {
      const pts = rib.mid;
      ctx.lineCap = 'round';

      // A shaded core underneath, so the yarn reads as a round body rather than
      // a flat tangle of lines.
      eachRun(ctx, rib, (run) => {
        runPath(ctx, rib, run);
        ctx.fillStyle = cylinderGradient(ctx, rib, run, P, {
          ambient: 0.44, wrap: 0.75, spec: 0.03, shininess: 4, satFloor: 0.9,
        });
        ctx.fill();
      });

      // Fuzz first, reaching past the silhouette. Wool has no clean edge, and
      // that halo is most of what distinguishes it from painted rope.
      for (let s = 0; s < 80; s++) {
        const i = 1 + Math.floor(R() * (pts.length - 1));
        const p = pts[i];
        const n = rib.normals[i];
        const side = R() < 0.5 ? 1 : -1;
        const base = p.w * 0.5 * side;
        const out = base + side * (0.10 + R() * 0.16) * p.w;
        ctx.beginPath();
        ctx.moveTo(p.x + n.x * base, p.y + n.y * base);
        ctx.lineTo(
          p.x + n.x * out + (R() - 0.5) * 1.1,
          p.y + n.y * out + (R() - 0.5) * 1.1
        );
        ctx.strokeStyle = R() > 0.5 ? P.light : P.mid;
        ctx.globalAlpha = 0.22 + R() * 0.22;
        ctx.lineWidth = 0.55;
        ctx.stroke();
      }

      // plied strands along the length
      for (let s = 0; s < 20; s++) {
        const off = R() - 0.5;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const nrm = rib.normals[i];
          const w = pts[i].w;
          const jitter = (noise2(i * 0.6, s * 3.1, 3) - 0.5) * w * 0.45;
          const x = pts[i].x + nrm.x * (off * w * 0.85 + jitter);
          const y = pts[i].y + nrm.y * (off * w * 0.85 + jitter);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = s % 4 === 0 ? P.light : s % 3 === 0 ? P.dark : P.base;
        ctx.globalAlpha = 0.42;
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    nodeStyle: 'texture',
    nodeTexture(ctx, poly, P, R) {
      ctx.save(); tracePoly(ctx, poly); ctx.clip();
      ctx.lineWidth = 0.7; ctx.globalAlpha = 0.6;
      for (let i = 0; i < 26; i++) {
        ctx.beginPath();
        const a = R() * Math.PI * 2;
        const x = (R() - 0.5) * 30, y = R() * 34;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5);
        ctx.strokeStyle = i % 3 ? P.nodeLight : P.nodeDark;
        ctx.stroke();
      }
      ctx.restore();
    },
  },
  {
    ...base, id: 'thread', name: 'Thread',
    hue: [52, 96], sat: [16, 30], lum: [26, 40], nodeHue: 70,
    affinity: (v, d) => 0.5 + v.attachment * 0.8 + d.tensionBond * 1.0,
    stem(ctx, rib, seg, P, R) {
      // Three filaments twisted around a shaded core. Five loose strands each
      // swinging the full half-width crossed each other constantly and read as a
      // scribbled net rather than as cord.
      paintRealSurface(ctx, rib, P, R, {
        ambient: 0.34, wrap: 0.55, spec: 0.10, shininess: 7,
        satFloor: 0.9, rough: 0.05, variation: 0.14, seed: 61,
      });
      const pts = rib.mid;
      ctx.lineCap = 'round';
      for (let s = 0; s < 3; s++) {
        const phase = (s / 3) * Math.PI * 2;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const nrm = rib.normals[i];
          const u = Math.sin(i * 0.9 + phase) * pts[i].w * 0.26;
          ctx.lineTo(pts[i].x + nrm.x * u, pts[i].y + nrm.y * u);
        }
        ctx.strokeStyle = s === 0 ? P.light : s === 1 ? P.base : P.dark;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = Math.max(0.8, pts[0].w * 0.20);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    nodeStyle: 'texture',
    nodeTexture(ctx, poly, P, R) {
      ctx.save(); tracePoly(ctx, poly); ctx.clip();
      ctx.lineWidth = 0.8; ctx.globalAlpha = 0.4; ctx.lineCap = 'round';
      for (let i = 0; i < 18; i++) {
        const y0 = (R() - 0.5) * 60;
        ctx.beginPath();
        ctx.moveTo(-40, y0); ctx.lineTo(40, y0 + (R() - 0.5) * 6);
        ctx.strokeStyle = i % 2 ? P.nodeLight : P.nodeDark;
        ctx.stroke();
      }
      ctx.restore();
    },
  },
  {
    ...base, id: 'embroidery', name: 'Embroidery',
    hue: [8, 36], sat: [20, 34], lum: [36, 50], nodeHue: 20,
    affinity: (v) => 0.5 + v.order * 1.0 + v.attachment * 0.7,
    stem(ctx, rib, seg, P, R) {
      // Satin stitch: short threads laid side by side across the form, packed
      // tight enough to cover it. The previous version spaced them by segment
      // rather than by distance, so it came out as a comb with gaps, and it
      // ignored the corners entirely.
      ctx.save();
      ribbonPath(ctx, rib);
      ctx.clip();
      const pts = rib.mid;
      ctx.lineCap = 'round';
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const span = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(2, Math.round(span / 2.1));
        for (let s = 0; s < steps; s++) {
          const t = (s + 0.5) / steps;
          const nrm = rib.normals[i];
          const w = lerp(a.w, b.w, t) * 0.62;
          const x = lerp(a.x, b.x, t);
          const y = lerp(a.y, b.y, t);
          // stitches sit at a slight angle to the run, the way satin stitch does
          const skew = 0.30 + (R() - 0.5) * 0.12;
          const dx = nrm.x + nrm.ty * skew;
          const dy = nrm.y - nrm.tx * skew;
          const l = Math.hypot(dx, dy) || 1;
          ctx.beginPath();
          ctx.moveTo(x - (dx / l) * w, y - (dy / l) * w);
          ctx.lineTo(x + (dx / l) * w, y + (dy / l) * w);
          const k = s % 3;
          ctx.strokeStyle = k === 0 ? P.light : k === 1 ? P.base : P.dark;
          ctx.lineWidth = 2.4;
          ctx.stroke();
        }
      }
      ctx.restore();
    },
    nodeStyle: 'texture',
    nodeTexture(ctx, poly, P, R) {
      ctx.save(); tracePoly(ctx, poly); ctx.clip();
      ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      for (let y = -4; y < 40; y += 2.4) {
        ctx.beginPath();
        ctx.moveTo(-20, y + (R() - 0.5)); ctx.lineTo(20, y + (R() - 0.5));
        ctx.strokeStyle = (y | 0) % 5 ? P.node : P.nodeLight;
        ctx.stroke();
      }
      ctx.restore();
    },
  },
  {
    ...base, id: 'paper', name: 'Cut paper',
    hue: [28, 46], sat: [10, 24], lum: [40, 52], nodeHue: 40,
    affinity: (v) => 0.7 + v.order * 0.8 + (1 - v.intensity) * 0.7,
    stem(ctx, rib0, seg, P, R) {
      // Flat stock, lit only by how each run faces the light, dropped onto a
      // surface below it. The cut edge carries a little deckle.
      const rib = roughenRibbon(rib0, 0.055, 71);
      ctx.save();
      ctx.translate(-LIGHT.x * 3.4, -LIGHT.y * 3.4);
      ribbonPath(ctx, rib);
      ctx.fillStyle = 'rgba(0,0,0,0.26)';
      ctx.filter = 'blur(1.6px)';
      ctx.fill();
      ctx.restore();

      eachRun(ctx, rib, (run) => {
        const facing = clamp01(0.5 + (run.nrm.x * LIGHT.x + run.nrm.y * LIGHT.y) * 0.95);
        runPath(ctx, rib, run);
        ctx.fillStyle = hsl(P.h, P.s, clamp(P.l * (0.62 + facing * 0.86), 8, 96));
        ctx.fill();
      });

      // The cut edge is what says paper; fibre speckle at this width did not.
      ribbonPath(ctx, rib);
      ctx.strokeStyle = hsl(P.h, P.s * 0.5, Math.min(97, P.l * 1.4), 0.8);
      ctx.lineWidth = 0.6;
      ctx.stroke();
    },
    nodeStyle: 'texture',
    nodeTexture(ctx, poly, P) {
      ctx.save();
      ctx.translate(1.2, -1.2);
      tracePoly(ctx, poly);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fill();
      ctx.restore();
      tracePoly(ctx, poly);
      ctx.fillStyle = P.node;
      ctx.fill();
    },
  },
  {
    ...base, id: 'glass', name: 'Glass',
    hue: [110, 160], sat: [12, 26], lum: [34, 48], nodeHue: 165,
    affinity: (v) => 0.4 + v.openness * 1.3 - v.attachment * 0.4,
    stem(ctx, rib0, seg, P, R) {
      // Glass reads by its edges: a thin dim body, both rims caught bright
      // where the surface turns away, and one hard specular line.
      const rib = roughenRibbon(rib0, 0.035, 57);
      eachRun(ctx, rib, (run) => {
        const i = Math.floor((run.i0 + run.i1) / 2);
        const a = rib.left[i];
        const b = rib.right[i];
        const nl = run.nrm.x * LIGHT.x + run.nrm.y * LIGHT.y;
        const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        for (let s = 0; s < STOPS; s++) {
          const t = s / (STOPS - 1);
          const u = 1 - 2 * t;
          const z = Math.sqrt(Math.max(0, 1 - u * u));
          // total internal reflection piles light up at the grazing edges
          const rim = Math.pow(1 - z, 2.4);
          const body = clamp01(u * nl + z * LIGHT.z);
          const k = 0.05 + rim * 1.5 + body * 0.34;
          g.addColorStop(t, hsl(P.h, P.s * (1 - rim * 0.5), clamp(P.l * (0.42 + k), 6, 98), 0.34 + rim * 0.64));
        }
        runPath(ctx, rib, run);
        ctx.fillStyle = g;
        ctx.fill();

        // the specular line, offset towards the light rather than centred
        const off = clamp(nl, -0.8, 0.8) * 0.34 + 0.5;
        const sx = lerp(a.x, b.x, clamp(off - 0.06, 0.04, 0.94));
        const sy = lerp(a.y, b.y, clamp(off - 0.06, 0.04, 0.94));
        const p0 = rib.mid[run.i0];
        const p1 = rib.mid[run.i1];
        ctx.save();
        runPath(ctx, rib, run);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(sx + (p0.x - rib.mid[run.i0].x), sy + (p0.y - rib.mid[run.i0].y));
        ctx.lineTo(sx + (p1.x - p0.x), sy + (p1.y - p0.y));
        ctx.strokeStyle = 'rgba(255,255,255,0.72)';
        ctx.lineWidth = Math.max(0.5, p0.w * 0.09);
        ctx.stroke();
        ctx.restore();
      });
      ribbonPath(ctx, rib);
      ctx.strokeStyle = hsl(P.h, P.s * 0.4, Math.min(96, P.l * 1.7), 0.85);
      ctx.lineWidth = 0.9;
      ctx.stroke();
    },
    nodeStyle: 'texture',
    nodeTexture(ctx, poly, P) {
      tracePoly(ctx, poly);
      ctx.globalAlpha = 0.45; ctx.fillStyle = P.nodeLight; ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = P.nodeLight; ctx.lineWidth = 0.8; ctx.stroke();
    },
  },
  {
    ...base, id: 'metal', name: 'Metal',
    hue: [28, 52], sat: [4, 14], lum: [38, 52], nodeHue: 40,
    affinity: (v) => 0.4 + v.order * 0.9 + v.stability * 0.8 - v.openness * 0.3,
    stem(ctx, rib, seg, P) {
      // Brushed metal: a tight specular that tracks the run's angle, a dark
      // body, and anisotropic streaks along the length.
      const rm = roughenRibbon(rib, 0.03, 41);
      eachRun(ctx, rm, (run) => {
        runPath(ctx, rm, run);
        ctx.fillStyle = cylinderGradient(ctx, rm, run, P, {
          ambient: 0.16, wrap: 0.05, spec: 0.95, shininess: 90, satFloor: 0.5,
        });
        ctx.fill();
        alongRun(ctx, rm, run, P, 0.26, 41);

        ctx.save();
        runPath(ctx, rm, run);
        ctx.clip();
        const a = rm.mid[run.i0];
        const b = rm.mid[run.i1];
        const w = (a.w + b.w) * 0.5;
        for (let f = 0; f < 14; f++) {
          const u = (noise2(f * 5.3, run.i0, 11) - 0.5) * 1.9;
          const ox = run.nrm.x * u * w * 0.5;
          const oy = run.nrm.y * u * w * 0.5;
          ctx.beginPath();
          ctx.moveTo(a.x + ox, a.y + oy);
          ctx.lineTo(b.x + ox, b.y + oy);
          ctx.strokeStyle = f % 3 ? P.glow : P.deep;
          ctx.globalAlpha = 0.13;
          ctx.lineWidth = 0.4;
          ctx.stroke();
        }
        ctx.restore();
      });
      ctx.globalAlpha = 1;
      ribbonPath(ctx, rm);
      ctx.strokeStyle = hsl(P.h, P.s, P.l * 0.3, 0.5);
      ctx.lineWidth = 0.7;
      ctx.stroke();
      shadeJoints(ctx, rm, P, 0.5);
    },
  },
  {
    ...base, id: 'wax', name: 'Wax',
    hue: [30, 48], sat: [22, 36], lum: [42, 54], nodeHue: 44,
    affinity: (v) => 0.5 + v.stability * 0.7 + (1 - v.expansion) * 0.7,
    stem(ctx, rib, seg, P, R) {
      // Wax is mostly subsurface: the shadow side glows because light is coming
      // through the body rather than off the surface.
      const rw = paintRealSurface(ctx, rib, P, R, {
        ambient: 0.46, wrap: 0.80, spec: 0.16, shininess: 8, translucency: 0.85,
        satFloor: 0.85, rough: 0.10, variation: 0.12, mottle: 0.10, seed: 23,
      });
      rib = rw;
      ctx.save();
      ribbonPath(ctx, rib);
      ctx.clip();
      // poured ridges, perpendicular to travel
      for (let i = 1; i < rib.mid.length; i += 2) {
        const p = rib.mid[i];
        const n = rib.normals[i];
        ctx.beginPath();
        ctx.moveTo(p.x + n.x * p.w * 0.6, p.y + n.y * p.w * 0.6);
        ctx.lineTo(p.x - n.x * p.w * 0.6, p.y - n.y * p.w * 0.6);
        ctx.strokeStyle = i % 4 ? P.glow : P.mid;
        ctx.globalAlpha = 0.16;
        ctx.lineWidth = p.w * 0.22;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    },
  },
  {
    ...base, id: 'mold', name: 'Mould',
    hue: [62, 106], sat: [8, 20], lum: [30, 44], nodeHue: 80,
    affinity: (v, d) => 0.3 + v.intensity * 0.8 + d.extremity * 0.9 - v.order * 0.4,
    stem(ctx, rib, seg, P, R) {
      ribbonPath(ctx, rib);
      ctx.fillStyle = P.dark;
      ctx.fill();
      const b = ribBounds(rib);
      ctx.save(); ribbonPath(ctx, rib); ctx.clip();
      for (let i = 0; i < 240; i++) {
        const x = lerp(b.minX, b.maxX, R());
        const y = lerp(b.minY, b.maxY, R());
        ctx.beginPath();
        ctx.arc(x, y, R() * 1.5 + 0.3, 0, Math.PI * 2);
        ctx.fillStyle = R() > 0.6 ? P.light : P.base;
        ctx.globalAlpha = 0.5;
        ctx.fill();
      }
      ctx.restore();
      // spore halo spilling past the edge
      ctx.globalAlpha = 0.22;
      for (let i = 0; i < 44; i++) {
        const t = R();
        const idx = Math.min(rib.mid.length - 1, Math.floor(t * rib.mid.length));
        const p = rib.mid[idx];
        const a = R() * Math.PI * 2;
        const r = p.w * (0.42 + R() * 0.34);
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, R() * 1.1 + 0.2, 0, Math.PI * 2);
        ctx.fillStyle = P.light;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    ...base, id: 'gouache', name: 'Gouache',
    hue: [126, 180], sat: [16, 30], lum: [36, 50], nodeHue: 150,
    affinity: (v) => 0.7 + v.openness * 0.6 + (1 - v.order) * 0.5,
    stem(ctx, rib, seg, P, R) {
      ctx.save();
      ctx.filter = 'blur(1.1px)';
      ribbonPath(ctx, rib);
      ctx.fillStyle = P.mid;
      ctx.fill();
      ctx.restore();
      ribbonPath(ctx, rib);
      ctx.fillStyle = P.base;
      ctx.fill();
      ctx.save(); ribbonPath(ctx, rib); ctx.clip();
      const b = ribBounds(rib);
      for (let i = 0; i < 40; i++) {
        ctx.beginPath();
        ctx.ellipse(lerp(b.minX, b.maxX, R()), lerp(b.minY, b.maxY, R()),
          R() * 4 + 1, R() * 3 + 1, R() * 3, 0, Math.PI * 2);
        ctx.fillStyle = R() > 0.5 ? P.light : P.dark;
        ctx.globalAlpha = 0.16;
        ctx.fill();
      }
      ctx.restore();
    },
  },
  {
    ...base, id: 'oil', name: 'Oil paint',
    hue: [38, 92], sat: [24, 42], lum: [28, 42], nodeHue: 60,
    affinity: (v) => 0.4 + v.intensity * 1.3 - v.order * 0.3,
    stem(ctx, rib, seg, P, R) {
      const pts = rib.mid;
      ctx.lineCap = 'round';
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < pts.length - 1; i++) {
          const nrm = rib.normals[i];
          const w = pts[i].w;
          const u = (pass - 1) * 0.32 + (R() - 0.5) * 0.2;
          ctx.beginPath();
          ctx.moveTo(pts[i].x + nrm.x * u * w, pts[i].y + nrm.y * u * w);
          ctx.lineTo(pts[i + 1].x + nrm.x * u * w, pts[i + 1].y + nrm.y * u * w);
          ctx.strokeStyle = pass === 0 ? P.dark : pass === 1 ? P.base : P.light;
          ctx.lineWidth = w * 0.46;
          ctx.globalAlpha = 0.9;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    ...base, id: 'watercolor', name: 'Watercolour',
    hue: [70, 120], sat: [16, 30], lum: [36, 48], nodeHue: 120,
    affinity: (v) => 0.6 + v.openness * 1.0 + (1 - v.intensity) * 0.5,
    stem(ctx, rib, seg, P, R) {
      for (let pass = 0; pass < 3; pass++) {
        ctx.save();
        ctx.globalAlpha = 0.26;
        ctx.filter = `blur(${1.4 - pass * 0.4}px)`;
        ctx.translate((R() - 0.5) * 2.2, (R() - 0.5) * 2.2);
        ribbonPath(ctx, rib);
        ctx.fillStyle = pass === 2 ? P.dark : P.base;
        ctx.fill();
        ctx.restore();
      }
      // Pigment settles at the edge of a drying wash, much darker than the
      // middle. Without this the whole thing is a flat pale shape.
      ctx.save();
      const rr = roughenRibbon(rib, 0.07, 83);
      ribbonPath(ctx, rr);
      ctx.strokeStyle = P.deep;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2.0;
      ctx.stroke();
      ctx.strokeStyle = P.dark;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    },
  },
  {
    ...base, id: 'charcoal', name: 'Charcoal',
    hue: [18, 42], sat: [3, 10], lum: [26, 38], nodeHue: 30,
    affinity: (v, d) => 0.4 + v.intensity * 0.8 + d.volatility * 0.8 - v.openness * 0.3,
    stem(ctx, rib, seg, P, R) {
      // Charcoal is a drawn mark: several overlapping strokes of varying weight
      // and darkness, heavier on one side, with the tooth of the paper showing
      // through. Filling the silhouette with grey speckle made it concrete.
      const pts = rib.mid;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let pass = 0; pass < 5; pass++) {
        const off = (pass - 2) * 0.22;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const nrm = rib.normals[i];
          const jitter = (noise2(i * 0.7, pass * 9.1, 29) - 0.5) * pts[i].w * 0.3;
          const u = off * pts[i].w + jitter;
          ctx.lineTo(pts[i].x + nrm.x * u, pts[i].y + nrm.y * u);
        }
        ctx.strokeStyle = pass < 2 ? P.deep : pass === 2 ? P.dark : P.mid;
        ctx.globalAlpha = 0.30 + (2 - Math.abs(pass - 2)) * 0.16;
        ctx.lineWidth = pts[0].w * (0.42 - Math.abs(pass - 2) * 0.06);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // tooth: light flecks lifted back out of the mark
      ctx.save();
      ribbonPath(ctx, rib);
      ctx.clip();
      const b = ribBounds(rib);
      for (let i = 0; i < 220; i++) {
        const x = lerp(b.minX, b.maxX, R());
        const y = lerp(b.minY, b.maxY, R());
        ctx.fillStyle = P.light;
        ctx.globalAlpha = 0.10 + R() * 0.18;
        ctx.fillRect(x, y, 1.2, 1.2);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    },
  },
  {
    ...base, id: 'vector', name: 'Vector', graphic: true,
    hue: [92, 140], sat: [26, 42], lum: [34, 48], nodeHue: 115,
    affinity: (v) => 0.5 + v.order * 1.4 - v.intensity * 0.4,
    stem(ctx, rib, seg, P) {
      ribbonPath(ctx, rib);
      ctx.fillStyle = P.base;
      ctx.fill();
      ctx.strokeStyle = P.deep;
      ctx.lineWidth = 1.2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    },
  },
  {
    ...base, id: 'lineart', name: 'Line', graphic: true,
    hue: [18, 42], sat: [0, 6], lum: [22, 32], nodeHue: 30,
    affinity: (v) => 0.4 + v.order * 0.9 + (1 - v.intensity) * 0.6,
    stem(ctx, rib, seg, P) {
      ribbonPath(ctx, rib);
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 0.9;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.save(); ribbonPath(ctx, rib); ctx.clip();
      centerPath(ctx, rib.mid);
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.restore();
    },
    nodeStyle: 'stroke', lineW: 0.9,
  },
  {
    ...base, id: 'grain', name: '2D grain', graphic: true,
    hue: [24, 56], sat: [16, 30], lum: [32, 46], nodeHue: 40,
    affinity: (v, d) => 0.6 + d.volatility * 0.7 + v.intensity * 0.4,
    stem(ctx, rib, seg, P, R) {
      ribbonPath(ctx, rib);
      ctx.fillStyle = P.base;
      ctx.fill();
      grainOver(ctx, rib, P, R, 0.9, 1.4);
    },
    nodeStyle: 'texture',
    nodeTexture(ctx, poly, P, R) {
      ctx.save(); tracePoly(ctx, poly); ctx.clip();
      for (let i = 0; i < 200; i++) {
        ctx.fillStyle = R() > 0.5 ? P.nodeLight : P.nodeDark;
        ctx.globalAlpha = 0.35;
        ctx.fillRect((R() - 0.5) * 40, R() * 42 - 4, 1.3, 1.3);
      }
      ctx.restore();
    },
  },
  {
    ...base, id: 'ascii', name: 'ASCII', graphic: true,
    hue: [82, 130], sat: [20, 38], lum: [36, 50], nodeHue: 105,
    cell: 4.4,
    affinity: (v, d) => 0.3 + v.order * 0.7 + d.extremity * 0.6 - v.attachment * 0.2,
    stem(ctx, rib, seg, P, R) {
      const ramp = '.:-=+*#%@';
      ctx.font = '4.6px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      forEachCell(rib, this.cell, (x, y, edge) => {
        const idx = Math.floor((1 - edge) * (ramp.length - 1));
        ctx.fillStyle = edge > 0.7 ? P.dark : P.base;
        glyph(ctx, ramp[idx], x, y);
      });
    },
    nodeStyle: 'cells',
    cellNode(ctx, x, y, size, P, R) {
      ctx.font = '4.6px ui-monospace, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = P.node;
      glyph(ctx, '*ox+.'[Math.floor(R() * 5)], x, y);
    },
  },
  {
    ...base, id: 'pixel', name: 'Pixel', graphic: true,
    hue: [92, 146], sat: [18, 32], lum: [36, 50], nodeHue: 118,
    cell: 3.6,
    affinity: (v) => 0.4 + v.order * 0.8 + v.expansion * 0.4,
    stem(ctx, rib, seg, P) {
      const s = this.cell;
      forEachCell(rib, s, (x, y, edge) => {
        ctx.fillStyle = edge > 0.72 ? P.dark : edge < 0.25 ? P.light : P.base;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      });
    },
    nodeStyle: 'cells',
    cellNode(ctx, x, y, size, P, R) {
      ctx.fillStyle = R() > 0.7 ? P.nodeLight : P.node;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    },
  },
  {
    ...base, id: 'halftone', name: 'Halftone', graphic: true,
    hue: [20, 48], sat: [12, 26], lum: [34, 48], nodeHue: 34,
    cell: 3.4,
    affinity: (v, d) => 0.35 + d.volatility * 0.6 + v.intensity * 0.5,
    stem(ctx, rib, seg, P) {
      const s = this.cell;
      forEachCell(rib, s, (x, y, edge) => {
        const r = (1 - edge * 0.85) * s * 0.62;
        if (r <= 0.15) return;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = P.base;
        ctx.fill();
      });
    },
    nodeStyle: 'cells',
    cellNode(ctx, x, y, size, P, R) {
      ctx.beginPath();
      ctx.arc(x, y, size * (0.2 + R() * 0.4), 0, Math.PI * 2);
      ctx.fillStyle = P.node;
      ctx.fill();
    },
  },
  {
    ...base, id: 'dither', name: 'Dither', graphic: true,
    hue: [176, 220], sat: [5, 14], lum: [34, 48], nodeHue: 198,
    cell: 2.4,
    affinity: (v, d) => 0.3 + d.reversal * 0.9 + v.order * 0.4,
    stem(ctx, rib, seg, P) {
      const bayer = [
        [0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5],
      ];
      const s = this.cell;
      forEachCell(rib, s, (x, y, edge) => {
        const gx = Math.abs(Math.round(x / s)) % 4;
        const gy = Math.abs(Math.round(y / s)) % 4;
        const level = (1 - edge) * 16;
        if (level <= bayer[gy][gx]) return;
        ctx.fillStyle = P.deep;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      });
    },
    nodeStyle: 'cells',
    cellNode(ctx, x, y, size, P, R) {
      if (R() < 0.45) return;
      ctx.fillStyle = P.nodeDark;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    },
  },
  {
    ...base, id: 'wireframe', name: 'Wireframe', graphic: true,
    hue: [118, 166], sat: [18, 32], lum: [42, 56], nodeHue: 140,
    affinity: (v) => 0.3 + v.order * 1.0 + v.openness * 0.5 - v.attachment * 0.3,
    stem(ctx, rib, seg, P) {
      ctx.strokeStyle = P.base;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      for (let i = 0; i < rib.left.length; i++) {
        if (i === 0) ctx.moveTo(rib.left[i].x, rib.left[i].y);
        else ctx.lineTo(rib.left[i].x, rib.left[i].y);
      }
      for (let i = 0; i < rib.right.length; i++) {
        if (i === 0) ctx.moveTo(rib.right[i].x, rib.right[i].y);
        else ctx.lineTo(rib.right[i].x, rib.right[i].y);
      }
      for (let i = 0; i < rib.left.length; i++) {
        ctx.moveTo(rib.left[i].x, rib.left[i].y);
        ctx.lineTo(rib.right[i].x, rib.right[i].y);
        if (i < rib.left.length - 1) {
          ctx.moveTo(rib.left[i].x, rib.left[i].y);
          ctx.lineTo(rib.right[i + 1].x, rib.right[i + 1].y);
        }
      }
      ctx.stroke();
    },
    nodeStyle: 'stroke', lineW: 0.6,
  },

  // --------------------------------------------------- further substances --
  // These carry no 2D drawing routine: the canvas renderer they would have been
  // for is retired, and the 3D path takes only the palette and the affinity.
  {
    ...base, id: 'porcelain', name: 'Porcelain',
    hue: [198, 216], sat: [3, 11], lum: [70, 84], nodeHue: 205,
    affinity: (v) => 0.5 + v.order * 1.1 + v.stability * 0.7,
  },
  {
    ...base, id: 'rust', name: 'Rust',
    hue: [12, 32], sat: [44, 68], lum: [28, 42], nodeHue: 22,
    affinity: (v) => 0.4 + v.intensity * 0.8 + (1 - v.stability) * 0.9,
  },
  {
    ...base, id: 'velvet', name: 'Velvet',
    hue: [326, 356], sat: [38, 60], lum: [16, 27], nodeHue: 340,
    affinity: (v) => 0.4 + v.attachment * 1.2 + v.intensity * 0.5,
  },
  {
    ...base, id: 'bone', name: 'Bone',
    hue: [36, 50], sat: [8, 19], lum: [64, 78], nodeHue: 42,
    affinity: (v) => 0.4 + (1 - v.expansion) * 0.9 + v.order * 0.6,
  },
  {
    ...base, id: 'resin', name: 'Resin',
    hue: [26, 46], sat: [48, 72], lum: [38, 54], nodeHue: 36,
    affinity: (v) => 0.4 + v.attachment * 1.0 + v.stability * 0.6,
  },
  {
    ...base, id: 'stone', name: 'Stone',
    hue: [28, 58], sat: [4, 13], lum: [38, 52], nodeHue: 44,
    affinity: (v) => 0.5 + v.stability * 1.1 + v.order * 0.5,
  },

  // ------------------------------------------- instrument readings --------
  // The organism seen through something that measures rather than looks: a
  // thermal camera, a radiograph, a depth pass, a contour survey. They are
  // graphic states like the other flat idioms, and just as occasional.
  {
    ...base, id: 'thermal', name: 'Thermal', graphic: true,
    hue: [10, 40], sat: [40, 70], lum: [40, 60], nodeHue: 20,
    affinity: (v) => 0.3 + v.intensity * 1.5,
  },
  {
    ...base, id: 'xray', name: 'Radiograph', graphic: true,
    hue: [200, 220], sat: [10, 25], lum: [45, 65], nodeHue: 210,
    affinity: (v) => 0.3 + v.openness * 1.3,
  },
  {
    ...base, id: 'depth', name: 'Depth', graphic: true,
    hue: [210, 235], sat: [15, 35], lum: [40, 60], nodeHue: 220,
    affinity: (v, d) => 0.3 + v.order * 0.9 + (d ? d.extremity * 0.5 : 0),
  },
  {
    ...base, id: 'contour', name: 'Contour', graphic: true,
    hue: [40, 70], sat: [10, 24], lum: [50, 66], nodeHue: 55,
    affinity: (v) => 0.3 + v.order * 1.1 + v.expansion * 0.5,
  },
  {
    ...base, id: 'blueprint', name: 'Blueprint', graphic: true,
    hue: [205, 225], sat: [30, 50], lum: [30, 45], nodeHue: 215,
    affinity: (v) => 0.3 + v.order * 1.3 + v.stability * 0.6,
  },
  {
    ...base, id: 'riso', name: 'Risograph', graphic: true,
    hue: [340, 20], sat: [40, 65], lum: [45, 62], nodeHue: 0,
    affinity: (v) => 0.3 + v.openness * 0.8 + v.intensity * 0.7,
  },

  // ------------------------------------------------------- flocked ---------
  {
    ...base, id: 'flock', name: 'Flock',
    hue: [86, 140], sat: [40, 66], lum: [42, 58], nodeHue: 110,
    affinity: (v) => 0.4 + v.attachment * 0.9 + v.openness * 0.5,
  },

  // ------------------------------------------------- further graphic states -
  {
    ...base, id: 'collage', name: 'Collage', graphic: true,
    hue: [20, 60], sat: [30, 60], lum: [45, 65], nodeHue: 40,
    affinity: (v, d) => 0.3 + v.openness * 0.8 + (d ? d.volatility * 0.8 : 0),
  },
  {
    ...base, id: 'smoke', name: 'Smoke', graphic: true,
    hue: [200, 240], sat: [4, 16], lum: [40, 60], nodeHue: 220,
    affinity: (v) => 0.3 + (1 - v.stability) * 1.1 + v.intensity * 0.4,
  },
  {
    ...base, id: 'stipple', name: 'Stipple', graphic: true,
    hue: [30, 50], sat: [6, 16], lum: [45, 60], nodeHue: 40,
    affinity: (v) => 0.3 + v.order * 0.9 + v.attachment * 0.5,
  },
  {
    ...base, id: 'blockprint', name: 'Block print', graphic: true,
    hue: [140, 175], sat: [45, 70], lum: [30, 46], nodeHue: 160,
    affinity: (v) => 0.3 + v.order * 0.8 + v.stability * 0.7,
  },
  {
    ...base, id: 'illumination', name: 'Illumination', graphic: true,
    hue: [35, 55], sat: [50, 75], lum: [42, 58], nodeHue: 45,
    affinity: (v) => 0.3 + v.attachment * 0.9 + v.order * 0.7,
  },
];

export const MATERIAL_BY_ID = Object.fromEntries(MATERIALS.map((m) => [m.id, m]));

// How many answers a substance has to last before it may change.
//
// At five, with a shallow ramp on top, a plant changed material about twice in
// a twenty-answer life and showed three of the thirty-five states. The switch is
// one of the things the piece is *for*, and almost nobody was seeing it — a
// state nobody meets may as well not exist.
const MIN_HOLD = 2;

/**
 * Choose the material for the next section.
 *
 * Reads the values as *substance and handling* — how the organism is made —
 * which is a different question from the one the environment system asks. The
 * hold counter keeps changes rare enough that they still register as events.
 */
export function chooseMaterial(rng, values, derived, ctx, shift = 0) {
  const held = ctx.matHold || 0;
  const current = ctx.materialId;
  if (held < MIN_HOLD) return current;

  // An answer that moves the values a long way is what changes the substance.
  //
  // This used to be almost entirely a function of how many turns had passed,
  // which made the switch feel like weather rather than like a consequence — a
  // player could not connect it to anything they had done. The size of the
  // shift this answer caused now carries most of the weight, with a much
  // smaller drift so a plant that is answered very evenly still moves
  // eventually rather than staying one substance forever.
  //
  // Measured rather than assumed: answering evenly shifts the six values by
  // about 0.11 in a turn, answering at the extremes about 0.19, and the two
  // distributions overlap heavily. The mapping is placed across that gap — a
  // shift of 0.06 counts for nothing and 0.24 counts for everything — because
  // spread over the whole range instead, both kinds of answer landed in the
  // middle and the material changed at nearly the same rate either way.
  const urge = clamp01((shift - 0.06) / 0.18) * 0.86
    + clamp01((held - MIN_HOLD) / 10) * 0.16
    + derived.volatility * 0.12;
  if (!rng.chance(urge)) return current;

  const recent = new Set((ctx.matRecent || []).slice(-4));
  const pool = MATERIALS.filter((m) => m.id !== current);
  return rng.weighted(pool, (m) => {
    const a = Math.max(0.05, m.affinity(values, derived));
    // The flat idioms are meant to be occasional collisions, not the default
    // state of the organism: eight of twenty-three materials being pictures
    // rather than substances made most plants read as construction drawings.
    // There are fourteen of them now, so the same weight would have halved how
    // often any *particular* one turned up and a blueprint would have been a
    // thing almost nobody saw. Raised just enough to hold each idiom at the
    // rate it had before, which puts pictures at about an eighth of switches
    // rather than a fourteenth.
    const kind = m.graphic ? 0.20 : 1;
    return a * kind * (recent.has(m.id) ? 0.2 : 1);
  }).id;
}
