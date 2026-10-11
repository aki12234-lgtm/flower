// Flat shapes, and the few kinds there are of them.
//
// Everything the flat renderer draws is one of three things — a band (a tube
// seen from the front), a disc (a sphere seen from the front) or a polygon —
// in world units, with the ink it prints in. The plant and the things standing
// about the world are both built out of these; only the inks they choose from
// differ.

export const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const rot = (v, axis, ang) => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
  return [
    v[0] * c + (axis[1] * v[2] - axis[2] * v[1]) * s + axis[0] * d * (1 - c),
    v[1] * c + (axis[2] * v[0] - axis[0] * v[2]) * s + axis[1] * d * (1 - c),
    v[2] * c + (axis[0] * v[1] - axis[1] * v[0]) * s + axis[2] * d * (1 - c),
  ];
};

/**
 * Collects shapes. Each one keeps the order it was made in, which settles ties
 * the way the depth test did: at one depth, the later one shows.
 *
 * `pick` chooses the ink for a colour. `shade` marks shapes that take the
 * world's flat shade side (the plant never does: a shade side is the one
 * thing that says a shape is round).
 */
export class Shapes {
  constructor(pick, shade = false) {
    this.list = [];
    this.pick = pick;
    this.shade = shade;
  }

  get count() { return this.list.length; }

  add(s) {
    s.i = this.list.length;
    if (this.shade && s.shade === undefined) s.shade = true;
    this.list.push(s);
    return s;
  }

  /**
   * A tube seen from the front: a band along its path, as wide as the tube
   * either side, with its substance's relief on the two edges you can see.
   * Where its colour crosses from one ink to another it is cut in two there.
   */
  band(path, colourAt, pat, z, relief = null) {
    if (path.length < 2) return;
    let arc = 0;
    const pts = [];
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      if (i) arc += Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y, (p.z ?? 0) - (path[i - 1].z ?? 0));
      const l = relief ? p.r + relief(arc, Math.PI * 0.5, p) : p.r;
      const r = relief ? p.r + relief(arc, Math.PI * 1.5, p) : p.r;
      pts.push({ x: p.x, y: p.y, l: Math.max(p.r * 0.25, l), r: Math.max(p.r * 0.25, r), arc,
        ink: this.pick(colourAt(i, p)) });
    }
    let start = 0;
    for (let i = 1; i <= pts.length; i++) {
      if (i < pts.length && pts[i].ink === pts[start].ink) continue;
      const run = pts.slice(start, Math.min(pts.length, i + 1));
      if (run.length >= 2) this.add({ type: 'band', pts: run, ink: pts[start].ink, pat, z });
      start = i;
    }
  }

  /** A sphere seen from the front. Relief, where the substance has one, roughens its rim. */
  disc(x, y, r, rgb, pat, z, relief = null) {
    const s = { type: 'disc', x, y, r, ink: this.pick(rgb), pat, z };
    if (relief) {
      // round the rim, in the sphere's own terms: the outline seen face on is
      // the great circle through its poles, from the top down either side
      const rim = [];
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        const phi = Math.acos(Math.cos(a));
        const th = Math.sin(a) >= 0 ? 0 : Math.PI;
        rim.push(Math.max(r * 0.4, r + relief(th, phi, r)));
      }
      s.rim = rim;
    }
    return this.add(s);
  }

  /**
   * A sphere whose surface is pushed about as a function of where each point
   * is in the world — the form every lumpy thing in the world is built with.
   */
  lump(x, y, z, r, rgb, disp, depth = 0) {
    const s = { type: 'disc', x, y, r, ink: this.pick(rgb), pat: 0, z: depth };
    if (disp) {
      const rim = [];
      for (let k = 0; k < 20; k++) {
        const a = (k / 20) * Math.PI * 2;
        rim.push(Math.max(r * 0.3, r + disp(x + Math.cos(a) * r, y + Math.sin(a) * r, z)));
      }
      s.rim = rim;
    }
    return this.add(s);
  }

  poly(pts, rgb, pat, z) {
    return this.add({ type: 'poly', pts, ink: this.pick(rgb), pat, z });
  }

  /**
   * A petal or a leaf: the curved blade buildPlant makes, seen from the front.
   * Its outline is the two long edges of the surface; its colour runs from the
   * base to the tip, so where that crosses an ink the blade is printed in two.
   */
  blade(o, pat, z) {
    const {
      origin, dir, side, len, width, cup = 0.5, sweep = 0.35, tipTaper = 1,
      albedo, baseAlbedo = null, ripple = 0,
    } = o;
    const up = norm(cross(dir, side));
    const at = (u, v) => {
      const half = Math.sin(Math.pow(u, 0.65) * Math.PI) * width * (1 - u * (1 - tipTaper));
      const along = u * len;
      const lift = -cup * v * v * half + sweep * u * u * len * 0.25
        + Math.sin(u * 9.0 + v * 2.0) * ripple * half * 0.25;
      return [
        origin[0] + dir[0] * along + side[0] * v * half + up[0] * lift,
        origin[1] + dir[1] * along + side[1] * v * half + up[1] * lift,
      ];
    };
    const colourAt = (u) => {
      if (!baseAlbedo) return albedo;
      const t = Math.min(1, Math.pow(u, 0.55));
      return [0, 1, 2].map((k) => baseAlbedo[k] + (albedo[k] - baseAlbedo[k]) * t);
    };
    const R = 16;
    const rows = [];
    for (let i = 0; i <= R; i++) {
      const u = i / R;
      rows.push({ a: at(u, -1), b: at(u, 1), ink: this.pick(colourAt(Math.min(1, u + 0.5 / R))) });
    }
    // one polygon per run of rows printed in one ink, the later run on top
    let start = 0;
    for (let i = 1; i <= R; i++) {
      if (i < R && rows[i].ink === rows[start].ink) continue;
      const run = rows.slice(start, i + 1);
      const pts = [];
      for (const r of run) pts.push({ x: r.a[0], y: r.a[1] });
      for (let k = run.length - 1; k >= 0; k--) pts.push({ x: run[k].b[0], y: run[k].b[1] });
      this.add({ type: 'poly', pts, ink: rows[start].ink, pat, z });
      start = i;
    }
  }

  /** A flat outline put into the plane, the way buildPlant's sheet() does it. */
  sheet(o, pat, z) {
    const { pts, origin, dir, side, scale = 1, albedo } = o;
    this.poly(pts.map((p) => ({
      x: origin[0] + side[0] * p.x * scale + dir[0] * p.y * scale,
      y: origin[1] + side[1] * p.x * scale + dir[1] * p.y * scale,
    })), albedo, pat, z);
  }

  /** Points on the outline of every shape since `from`, for measuring a part. */
  outlineSince(from) {
    const out = [];
    for (let k = from; k < this.list.length; k++) {
      const s = this.list[k];
      if (s.type === 'disc') {
        for (let a = 0; a < 12; a++) out.push([s.x + Math.cos(a * 0.5236) * s.r, s.y + Math.sin(a * 0.5236) * s.r]);
      } else if (s.type === 'band') {
        for (const p of s.pts) {
          for (let a = 0; a < 8; a++) out.push([p.x + Math.cos(a * 0.785) * p.l, p.y + Math.sin(a * 0.785) * p.l]);
        }
      } else {
        for (const p of s.pts) out.push([p.x, p.y]);
      }
    }
    return out;
  }

  shiftSince(from, dx, dy) {
    for (let k = from; k < this.list.length; k++) {
      const s = this.list[k];
      if (s.type === 'disc') { s.x += dx; s.y += dy; } else for (const p of s.pts) { p.x += dx; p.y += dy; }
    }
  }

  /** In the order to draw them: furthest back first, and at one depth, as made. */
  sorted() {
    return this.list.slice().sort((a, b) => a.z - b.z || a.i - b.i);
  }
}

/** The world box a shape covers, for skipping what is off the screen. */
export function boundsOf(list) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const take = (x, y, r) => {
    if (x - r < x0) x0 = x - r;
    if (x + r > x1) x1 = x + r;
    if (y - r < y0) y0 = y - r;
    if (y + r > y1) y1 = y + r;
  };
  for (const s of list) {
    if (s.type === 'disc') take(s.x, s.y, s.rim ? Math.max(...s.rim) : s.r);
    else if (s.type === 'band') for (const p of s.pts) take(p.x, p.y, Math.max(p.l, p.r));
    else for (const p of s.pts) take(p.x, p.y, 0);
  }
  return { x0, x1, y0, y1 };
}
