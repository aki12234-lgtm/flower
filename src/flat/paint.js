// Laying shapes down as a print does.
//
// Shapes that share an ink are laid down together: every outline in the group
// is stroked first, twice the width of a line, and then every shape is filled
// on top. What survives of the strokes is a line exactly as wide as one, round
// the outside of the whole group and nowhere inside it — so parts printed in
// one ink run together the way they did when the line was found from the
// picture, and a new ink always starts with a line.
//
// The world's shade side, and the plant's material patterns, are second passes
// of the same ink, darker, laid over the first and never outlined.

export const fract = (x) => x - Math.floor(x);

/** The shaders' own hash and value noise, so patterns fall where they fell. */
export function hash21(x, y) {
  let px = fract(x * 123.34);
  let py = fract(y * 456.21);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d;
  py += d;
  return fract(px * py);
}
export function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash21(ix, iy);
  const b = hash21(ix + 1, iy);
  const c = hash21(ix, iy + 1);
  const d = hash21(ix + 1, iy + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

// ------------------------------------------------------------------ outlines --

/** Each point's normal across a band, from its neighbours. */
function bandFrame(pts) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    return { tx: tx / l, ty: ty / l, nx: -ty / l, ny: tx / l };
  });
}

function addPoly(path, pts) {
  // every outline anticlockwise (in world terms, y up), as an arc is, so
  // overlapping ones add up rather than cancel into a hole
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  const ordered = area > 0 ? pts : pts.slice().reverse();
  path.moveTo(ordered[0].x, ordered[0].y);
  for (let i = 1; i < ordered.length; i++) path.lineTo(ordered[i].x, ordered[i].y);
  path.closePath();
}

function bandOutline(s) {
  const f = s.frame || (s.frame = bandFrame(s.pts));
  const out = [];
  for (let i = 0; i < s.pts.length; i++) {
    const p = s.pts[i];
    out.push({ x: p.x + f[i].nx * p.l, y: p.y + f[i].ny * p.l });
  }
  for (let i = s.pts.length - 1; i >= 0; i--) {
    const p = s.pts[i];
    out.push({ x: p.x - f[i].nx * p.r, y: p.y - f[i].ny * p.r });
  }
  return out;
}

function discOutline(s) {
  const n = s.rim.length;
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    out.push({ x: s.x + Math.cos(a) * s.rim[k], y: s.y + Math.sin(a) * s.rim[k] });
  }
  return out;
}

/** Add one shape's outline to a path. */
export function addShape(path, s) {
  if (s.type === 'disc') {
    if (s.rim) addPoly(path, discOutline(s));
    else {
      path.moveTo(s.x + s.r, s.y);
      path.arc(s.x, s.y, s.r, 0, Math.PI * 2, false);
      path.closePath();
    }
  } else if (s.type === 'band') addPoly(path, s.outline || (s.outline = bandOutline(s)));
  else addPoly(path, s.pts);
}

// ----------------------------------------------------------------- shade side --
//
// The world is printed lit from the upper left, whatever the sun is doing, and
// a face turned from that gets a second, darker pass: in the shader, wherever
// the normal's agreement with that light fell under 0.3. On a sphere seen from
// the front that is a crescent; on a tube, a strip down the side turned away.

const LIGHT = (() => {
  const l = Math.hypot(-0.8, 0.45, 0.4);
  return [-0.8 / l, 0.45 / l, 0.4 / l];
})();
const LIT = 0.3;

/** Where the shade begins across one side of a tube, 0 at its middle to 1 at its edge (2: none). */
function shadeFrom(c) {
  const lit = (f) => c * f + LIGHT[2] * Math.sqrt(Math.max(0, 1 - f * f));
  if (lit(1) >= LIT) return 2;
  let a = 0;
  let b = 1;
  for (let k = 0; k < 18; k++) {
    const m = (a + b) / 2;
    if (lit(m) < LIT) b = m; else a = m;
  }
  return b;
}

/** The unit disc's shaded part, as one outline. */
const CRESCENT = (() => {
  const N = 48;
  const outer = [];
  const inner = [];
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * Math.PI * 2;
    const c = Math.cos(a) * LIGHT[0] + Math.sin(a) * LIGHT[1];
    const from = shadeFrom(c);
    if (from > 1) continue;
    outer.push([Math.cos(a), Math.sin(a)]);
    inner.push([Math.cos(a) * from, Math.sin(a) * from]);
  }
  return outer.concat(inner.reverse());
})();

/** Add the part of a shape turned from the light. */
export function addShade(path, s) {
  if (s.type === 'disc') {
    const r = s.r;
    addPoly(path, CRESCENT.map(([x, y]) => ({ x: s.x + x * r, y: s.y + y * r })));
  } else if (s.type === 'band') {
    const f = s.frame || (s.frame = bandFrame(s.pts));
    for (const side of [1, -1]) {
      const edge = [];
      const inner = [];
      let any = false;
      for (let i = 0; i < s.pts.length; i++) {
        const p = s.pts[i];
        const nx = f[i].nx * side;
        const ny = f[i].ny * side;
        const half = side > 0 ? p.l : p.r;
        let from = shadeFrom(nx * LIGHT[0] + ny * LIGHT[1]);
        if (from > 1) from = 1; else any = true;
        edge.push({ x: p.x + nx * half, y: p.y + ny * half });
        inner.push({ x: p.x + nx * half * from, y: p.y + ny * half * from });
      }
      if (any) addPoly(path, edge.concat(inner.reverse()));
    }
  } else if (s.faceShade) {
    addPoly(path, s.pts);
  }
}

// ------------------------------------------------------------------ patterns --
//
// A material, printed: a pattern laid over the ink — dots, hatching, rings,
// stripes, speckle, brushing, cross-hatch — measured along and around each stem
// in world units, seven to a cell, as the scene shader measured them.

const quad = (path, pts) => addPoly(path, pts);

/** Marks along a band, in its own terms: `along` the stem, `around` it from the front. */
function bandMarks(path, s, pid) {
  const pts = s.pts;
  const f = s.frame || (s.frame = bandFrame(pts));
  const u0 = pts[0].arc;
  const u1 = pts[pts.length - 1].arc;
  let R = 0;
  for (const p of pts) R += (p.l + p.r) * 0.5;
  R = Math.max(0.5, R / pts.length);
  const V = R * Math.PI * 0.5;
  // where on the band a point (along, around) falls
  let seg = 0;
  const at = (u, v) => {
    while (seg > 0 && pts[seg].arc > u) seg--;
    while (seg < pts.length - 2 && pts[seg + 1].arc < u) seg++;
    const a = pts[seg];
    const b = pts[seg + 1];
    const k = Math.min(1, Math.max(0, (u - a.arc) / Math.max(1e-6, b.arc - a.arc)));
    const across = R * Math.sin(Math.max(-1.5707, Math.min(1.5707, v / R)));
    const nx = f[seg].nx + (f[seg + 1].nx - f[seg].nx) * k;
    const ny = f[seg].ny + (f[seg + 1].ny - f[seg].ny) * k;
    return { x: a.x + (b.x - a.x) * k + nx * across, y: a.y + (b.y - a.y) * k + ny * across };
  };
  const strip = (ua, ub, va, vb) => {
    // a patch of the band's own surface, as an outline
    const n = 4;
    const out = [];
    for (let k = 0; k <= n; k++) out.push(at(ua + (ub - ua) * (k / n), va));
    for (let k = n; k >= 0; k--) out.push(at(ua + (ub - ua) * (k / n), vb));
    quad(path, out);
  };
  const across = (ua, ub) => {
    const n = 4;
    const out = [];
    for (let k = 0; k <= n; k++) out.push(at(ua, -V + (2 * V * k) / n));
    for (let k = n; k >= 0; k--) out.push(at(ub, -V + (2 * V * k) / n));
    quad(path, out);
  };
  const diagonals = (period, from, sign) => {
    // stripes where fract((along ± around) / period) >= from
    for (let m = Math.floor((u0 - V) / period) - 1; m <= Math.ceil((u1 + V) / period) + 1; m++) {
      const c0 = period * (m + from);
      const c1 = period * (m + 1);
      const out = [];
      const n = 6;
      for (let k = 0; k <= n; k++) { const v = -V + (2 * V * k) / n; out.push(at(c0 - sign * v, v)); }
      for (let k = n; k >= 0; k--) { const v = -V + (2 * V * k) / n; out.push(at(c1 - sign * v, v)); }
      const lo = Math.min(c0, c1) - V;
      const hi = Math.max(c0, c1) + V;
      if (hi < u0 || lo > u1) continue;
      quad(path, out);
    }
  };

  switch (pid) {
    case 3: case 10: {                                   // clay, wax: dots
      for (let j = Math.floor(-V / 7) - 1; j <= Math.ceil(V / 7); j++) {
        const v = 7 * (j + 0.5);
        if (Math.abs(v) > V) continue;
        const shift = 0.5 * (((j % 2) + 2) % 2);
        const squash = Math.cos(v / R);
        for (let k = Math.floor(u0 / 7) - 1; k <= Math.ceil(u1 / 7); k++) {
          const u = 7 * (k + 0.5 - shift);
          if (u < u0 || u > u1) continue;
          const c = at(u, v);
          const g = f[seg];
          path.moveTo(c.x + g.tx * 1.4, c.y + g.ty * 1.4);
          path.ellipse(c.x, c.y, 1.4, Math.max(0.2, 1.4 * squash), Math.atan2(g.ty, g.tx), 0, Math.PI * 2);
          path.closePath();
        }
      }
      break;
    }
    case 4: case 18: case 22:                            // wool, velvet, flock: hatch
      diagonals(3.5, 0.72, 1);
      break;
    case 5: case 19:                                     // thread, bone: rings
      for (let k = Math.floor(u0 / 7); k <= Math.ceil(u1 / 7); k++) {
        const a = Math.max(u0, 7 * (k + 0.62));
        const b = Math.min(u1, 7 * (k + 1));
        if (b > a) across(a, b);
      }
      break;
    case 6: {                                            // embroidery: crosses
      const c = 7 / 1.5;
      for (let j = Math.floor(-V / c) - 1; j <= Math.ceil(V / c); j++) {
        const v = c * (j + 0.5);
        if (Math.abs(v) > V - 0.4) continue;
        for (let k = Math.floor(u0 / c); k <= Math.ceil(u1 / c); k++) {
          const u = c * (k + 0.5);
          if (u < u0 || u > u1) continue;
          strip(u - c * 0.32, u + c * 0.32, v - c * 0.08, v + c * 0.08);
          strip(u - c * 0.08, u + c * 0.08, v - c * 0.32, v + c * 0.32);
        }
      }
      break;
    }
    case 9: case 16: {                                   // metal, porcelain: long stripes
      for (let k = Math.floor(-V / 5) - 1; k <= Math.ceil(V / 5); k++) {
        const a = Math.max(-V, 5 * (k + 0.7));
        const b = Math.min(V, 5 * (k + 1));
        if (b > a) strip(u0, u1, a, b);
      }
      break;
    }
    case 11: case 17: case 21: {                         // mould, rust, stone: speckle
      for (let j = Math.floor(-V / 2.5); j <= Math.ceil(V / 2.5); j++) {
        for (let k = Math.floor(u0 / 2.5); k <= Math.ceil(u1 / 2.5); k++) {
          if (hash21(k, j) < 0.78) continue;
          const v = j * 2.5;
          if (v < -V || v + 2.5 > V) continue;
          strip(Math.max(u0, k * 2.5), Math.min(u1, k * 2.5 + 2.5), v, v + 2.5);
        }
      }
      break;
    }
    case 12: case 13: case 14: {                         // paint: brushed bands
      const dv = 0.8;
      for (let v = -V; v < V; v += dv) {
        let run = null;
        for (let u = u0; u <= u1 + 1.5; u += 1.5) {
          const on = u <= u1 && vnoise(u / 8.75, (v + dv * 0.5) / (7 / 3)) >= 0.6;
          if (on && run === null) run = u;
          if (!on && run !== null) { strip(run, Math.min(u1, u), v, Math.min(V, v + dv)); run = null; }
        }
      }
      break;
    }
    case 7: case 15:                                     // paper, charcoal: cross-hatch
      diagonals(3.5, 0.8, 1);
      diagonals(3.5, 0.8, -1);
      break;
    default:
      break;
  }
}

/** Marks over a disc, laid square to the world. */
function discMarks(path, s, pid) {
  const r = s.rim ? Math.max(...s.rim) : s.r;
  const box = (x0, y0, x1, y1) => quad(path, [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
  const x0 = s.x - r;
  const x1 = s.x + r;
  const y0 = s.y - r;
  const y1 = s.y + r;
  switch (pid) {
    case 3: case 10:
      for (let j = Math.floor(y0 / 7); j <= Math.ceil(y1 / 7); j++) {
        const shift = 0.5 * (((j % 2) + 2) % 2);
        for (let k = Math.floor(x0 / 7) - 1; k <= Math.ceil(x1 / 7); k++) {
          const cx = 7 * (k + 0.5 - shift);
          const cy = 7 * (j + 0.5);
          path.moveTo(cx + 1.4, cy);
          path.arc(cx, cy, 1.4, 0, Math.PI * 2);
          path.closePath();
        }
      }
      break;
    case 5: case 19:
      for (let k = Math.floor(y0 / 7); k <= Math.ceil(y1 / 7); k++) box(x0, 7 * (k + 0.62), x1, 7 * (k + 1));
      break;
    case 9: case 16:
      for (let k = Math.floor(x0 / 5); k <= Math.ceil(x1 / 5); k++) box(5 * (k + 0.7), y0, 5 * (k + 1), y1);
      break;
    case 11: case 17: case 21:
      for (let j = Math.floor(y0 / 2.5); j <= Math.ceil(y1 / 2.5); j++) {
        for (let k = Math.floor(x0 / 2.5); k <= Math.ceil(x1 / 2.5); k++) {
          if (hash21(k, j) >= 0.78) box(k * 2.5, j * 2.5, k * 2.5 + 2.5, j * 2.5 + 2.5);
        }
      }
      break;
    case 4: case 18: case 22: case 7: case 15: case 6: case 12: case 13: case 14: {
      // the diagonal and the brushed ones read the same on a dot this small
      const from = pid === 4 || pid === 18 || pid === 22 ? 0.72 : 0.8;
      for (let m = Math.floor((x0 + y0) / 3.5) - 1; m <= Math.ceil((x1 + y1) / 3.5) + 1; m++) {
        const c0 = 3.5 * (m + from);
        const c1 = 3.5 * (m + 1);
        quad(path, [{ x: c0 - y0, y: y0 }, { x: c1 - y0, y: y0 }, { x: c1 - y1, y: y1 }, { x: c0 - y1, y: y1 }]);
      }
      break;
    }
    default:
      break;
  }
}

const PATTERNED = new Set([3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22]);

/**
 * How much of a pattern shows at this many device pixels per world unit: it
 * fades out before it gets too fine to draw, the way the shader faded it.
 */
export function patternAlpha(pxPerUnit) {
  const fine = (1.414 / Math.max(1e-4, pxPerUnit)) / 7;
  const t = Math.min(1, Math.max(0, (fine - 0.3) / 0.25));
  return 1 - t * t * (3 - 2 * t);
}

// ------------------------------------------------------------------- batches --

/**
 * Group shapes, already in drawing order, into runs of one ink, and make the
 * paths for each: the outline of the run, its shade, and its pattern marks.
 * None of it depends on the camera, so it is made once and drawn many times.
 */
export function batch(list, { shade = false, patterns = false } = {}) {
  const out = [];
  let cur = null;
  for (const s of list) {
    if (!cur || cur.ink !== s.ink || s.alone) {
      cur = { ink: s.ink, shapes: [], path: new Path2D() };
      out.push(cur);
    }
    cur.shapes.push(s);
    addShape(cur.path, s);
  }
  for (const b of out) {
    if (shade && b.shapes.some((s) => s.shade)) {
      // per shape, in order, so a nearer shape's lit face covers a further one's shade
      b.each = b.shapes.map((s) => {
        const p = new Path2D();
        addShape(p, s);
        let sh = null;
        if (s.shade) { sh = new Path2D(); addShade(sh, s); }
        return { path: p, shade: sh };
      });
    }
    if (patterns) {
      let marks = null;
      for (const s of b.shapes) {
        if (!PATTERNED.has(s.pat)) continue;
        marks = marks || new Path2D();
        if (s.type === 'band') bandMarks(marks, s, s.pat);
        else if (s.type === 'disc') discMarks(marks, s, s.pat);
      }
      b.marks = marks;
    }
  }
  return out;
}

/** One outline round everything, for the heavier line the plant is drawn round with. */
export function silhouette(list) {
  const p = new Path2D();
  for (const s of list) addShape(p, s);
  return p;
}

/** How far over a face turned from the light is printed a second time. */
export const SHADE_OVER = 0.45;

/**
 * The plant while a section grows in: the same as its batches — the heavy line
 * round all of it, then each run of one ink, outlined and filled, with its
 * material's pattern — but drawn straight from the shapes, since they change
 * every frame until it has arrived.
 */
export function drawPlantLive(ctx, list, { heavy, line, lineColour, colour, marks = 0 }) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = lineColour;
  ctx.beginPath();
  for (const s of list) addShape(ctx, s);
  ctx.lineWidth = heavy * 2;
  ctx.stroke();
  ctx.lineWidth = line * 2;
  for (let a = 0; a < list.length;) {
    let b = a;
    while (b + 1 < list.length && list[b + 1].ink === list[a].ink) b++;
    ctx.beginPath();
    for (let k = a; k <= b; k++) addShape(ctx, list[k]);
    ctx.stroke();
    ctx.fillStyle = colour(list[a].ink, 0);
    ctx.fill();
    if (marks > 0) {
      let any = false;
      for (let k = a; k <= b && !any; k++) any = PATTERNED.has(list[k].pat);
      if (any) {
        ctx.save();
        ctx.clip();
        ctx.beginPath();
        for (let k = a; k <= b; k++) {
          const s = list[k];
          if (!PATTERNED.has(s.pat)) continue;
          if (s.type === 'band') bandMarks(ctx, s, s.pat);
          else if (s.type === 'disc') discMarks(ctx, s, s.pat);
        }
        ctx.globalAlpha = marks;
        ctx.fillStyle = colour(list[a].ink, 1);
        ctx.fill();
        ctx.restore();
        ctx.lineWidth = line * 2;
      }
    }
    a = b + 1;
  }
}

/**
 * Lay down shapes that are made afresh every frame — a deer mid-stride, a
 * butterfly mid-beat — the same way as batches, but straight onto the canvas's
 * own path rather than into a Path2D per run: a frame's worth of throwaway
 * path objects is garbage, and collecting it stalls whatever is drawn next.
 */
export function drawLive(ctx, list, { line, lineColour, colour, shade = false }) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = lineColour;
  ctx.lineWidth = line * 2;
  for (let a = 0; a < list.length;) {
    let b = a;
    while (b + 1 < list.length && list[b + 1].ink === list[a].ink) b++;
    ctx.beginPath();
    for (let k = a; k <= b; k++) addShape(ctx, list[k]);
    if (line > 0) ctx.stroke();
    ctx.fillStyle = colour(list[a].ink, 0);
    if (!shade) ctx.fill();
    else {
      for (let k = a; k <= b; k++) {
        ctx.beginPath();
        addShape(ctx, list[k]);
        ctx.fillStyle = colour(list[a].ink, 0);
        ctx.fill();
        if (list[k].shade) {
          ctx.beginPath();
          addShade(ctx, list[k]);
          ctx.fillStyle = colour(list[a].ink, SHADE_OVER);
          ctx.fill();
        }
      }
    }
    a = b + 1;
  }
}

/**
 * Lay batches down. `line` is a line's width in the current transform's units;
 * `colour(ink, over)` gives the CSS colour of an ink with `over` of a second
 * pass on it (0 for the ink itself); `marks` is how much of a pattern shows.
 */
export function draw(ctx, batches, { line, lineColour, colour, marks = 0 }) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = lineColour;
  ctx.lineWidth = line * 2;
  for (const b of batches) {
    if (line > 0) ctx.stroke(b.path);
    if (b.each) {
      const lit = colour(b.ink, 0);
      const dark = colour(b.ink, SHADE_OVER);
      for (const e of b.each) {
        ctx.fillStyle = lit;
        ctx.fill(e.path);
        if (e.shade) { ctx.fillStyle = dark; ctx.fill(e.shade); }
      }
    } else {
      ctx.fillStyle = colour(b.ink, 0);
      ctx.fill(b.path);
    }
    if (marks > 0 && b.marks) {
      ctx.save();
      ctx.clip(b.path);
      ctx.globalAlpha = marks;
      ctx.fillStyle = colour(b.ink, 1);
      ctx.fill(b.marks);
      ctx.restore();
    }
  }
}
