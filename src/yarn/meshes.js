// Turning the plant's 2D growth data into real 3D geometry.
//
// The simulation is untouched and stays planar: growth still happens in x and y,
// and every structural measurement in growth.js and vitality.js still reads the
// same numbers. Depth is added here, at build time, from smooth noise along each
// path — so branches sit at different distances from the camera, blooms face
// different ways, and the whole thing has parallax and something for depth of
// field to separate. Nothing about the tuning changes.

import { noise2 } from '../rng.js';

/** Vertex layout shared by every mesh in the scene. */
export const LAYOUT = [
  ['aPos', 3], ['aNormal', 3], ['aAlbedo', 3], ['aParams', 4], ['aUv', 2],
];
export const FLOATS_PER_VERTEX = 15;

export class MeshBuilder {
  constructor() {
    this.verts = [];
    this.indices = [];
  }

  get vertexCount() { return this.verts.length / FLOATS_PER_VERTEX; }

  push(p, n, albedo, params, uv) {
    this.verts.push(p[0], p[1], p[2], n[0], n[1], n[2],
      albedo[0], albedo[1], albedo[2],
      params[0], params[1], params[2], params[3] || 0,
      uv ? uv[0] : 0, uv ? uv[1] : 0);
  }

  tri(a, b, c) { this.indices.push(a, b, c); }

  quad(a, b, c, d) { this.indices.push(a, b, c, a, c, d); }

  build() {
    // What overflows a Uint16 is the index VALUE, not how many there are: a mesh
    // of 70k vertices drawn with 30k indices would wrap silently and scatter
    // triangles across the model. Ask the vertex count.
    const wide = this.vertexCount > 65535;
    return {
      data: new Float32Array(this.verts),
      indices: wide ? new Uint32Array(this.indices) : new Uint16Array(this.indices),
      wide,
    };
  }
}

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];

/**
 * A tube swept along a polyline.
 *
 * The frame is carried forward from segment to segment (parallel transport)
 * rather than rebuilt from a fixed up vector, which is what stops the tube
 * spinning about its own axis when the path turns — the twist shows up as a
 * crawling highlight and is very obvious on a shiny material.
 */
export function tube(mb, path, sides, albedoAt, paramsAt, dispAt) {
  if (path.length < 2) return;
  const rings = [];

  let prevN = null;
  let arc = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (i > 0) {
      const q = path[i - 1];
      arc += Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    }
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const t = norm([b.x - a.x, b.y - a.y, b.z - a.z]);

    let n;
    if (!prevN) {
      const seed = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      n = norm(cross(t, seed));
    } else {
      // project the previous normal onto the plane of the new tangent
      const d = prevN[0] * t[0] + prevN[1] * t[1] + prevN[2] * t[2];
      n = norm([prevN[0] - t[0] * d, prevN[1] - t[1] * d, prevN[2] - t[2] * d]);
    }
    prevN = n;
    const bi = cross(t, n);

    const base = mb.vertexCount;
    const albedo = albedoAt(i, p);
    const params = paramsAt(i, p);
    for (let s = 0; s <= sides; s++) {
      const ang = (s / sides) * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const nrm = norm([n[0] * ca + bi[0] * sa, n[1] * ca + bi[1] * sa, n[2] * ca + bi[2] * sa]);
      // A rough material with a perfectly smooth outline reads as a smooth
      // object with roughness painted on it, however strong the shading is —
      // the silhouette is the one part a normal map cannot touch. This moves
      // the surface itself, so rust is lumpy at its edge and glass is not.
      const rr = p.r + (dispAt ? dispAt(arc, ang, p) : 0);
      mb.push(
        [p.x + nrm[0] * rr, p.y + nrm[1] * rr, p.z + nrm[2] * rr],
        nrm, albedo, params, [arc, (s / sides) * Math.PI * 2 * p.r]
      );
    }
    rings.push(base);
  }

  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const a = rings[i] + s;
      const b = rings[i] + s + 1;
      const c = rings[i + 1] + s + 1;
      const d = rings[i + 1] + s;
      mb.quad(a, b, c, d);
    }
  }

  // cap the far end so a cut tube does not show its hollow interior
  const last = path[path.length - 1];
  const capBase = mb.vertexCount;
  const t = norm([
    last.x - path[path.length - 2].x,
    last.y - path[path.length - 2].y,
    last.z - path[path.length - 2].z,
  ]);
  mb.push([last.x, last.y, last.z], t,
    albedoAt(path.length - 1, last), paramsAt(path.length - 1, last), [arc, 0]);
  for (let s = 0; s < sides; s++) {
    mb.tri(capBase, rings[rings.length - 1] + s, rings[rings.length - 1] + s + 1);
  }
}

/** A sphere, for berries and floret heads. */
/**
 * An angular lump: flat faces, hard edges, no smoothing anywhere.
 *
 * sphere() is the only volume the world had, and a sphere with noise on it is
 * round however much noise you put on it — every rock, every boulder, every
 * outcrop came out as a pebble. This is the other half of that vocabulary. It
 * is an octahedron with its vertices pulled about and every triangle given its
 * own normal, so the light breaks along the edges instead of wrapping round
 * them, which is the whole difference between a stone and a crag.
 */
export function shard(mb, cx, cy, cz, r, jitter, albedo, params) {
  // six poles, each pushed in or out
  const poles = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ].map((v, i) => {
    const k = r * (1 + jitter(i));
    return [v[0] * k, v[1] * k, v[2] * k];
  });
  const faces = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
  ];
  for (const f of faces) {
    const a = poles[f[0]];
    const b = poles[f[1]];
    const c = poles[f[2]];
    const n = norm(cross(
      [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
    ));
    const base = mb.vertexCount;
    for (const v of [a, b, c]) {
      mb.push([cx + v[0], cy + v[1], cz + v[2]], n, albedo, params, [v[0] * 0.05, v[1] * 0.05]);
    }
    mb.tri(base, base + 1, base + 2);
  }
}

export function sphere(mb, cx, cy, cz, r, rows, cols, albedo, params, dispAt) {
  const base = mb.vertexCount;
  for (let i = 0; i <= rows; i++) {
    const phi = (i / rows) * Math.PI;
    for (let j = 0; j <= cols; j++) {
      const th = (j / cols) * Math.PI * 2;
      const n = [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
      const rr = r + (dispAt ? dispAt(th, phi, r) : 0);
      mb.push([cx + n[0] * rr, cy + n[1] * rr, cz + n[2] * rr], n, albedo, params,
        [th * r, phi * r]);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = base + i * (cols + 1) + j;
      const b = a + 1;
      const c = a + cols + 2;
      const d = a + cols + 1;
      mb.quad(a, b, c, d);
    }
  }
}

/**
 * A petal or a blade: a surface, not a polygon.
 *
 * It curves two ways at once — cupped across its width and swept along its
 * length — because that is what makes light run across a petal instead of
 * sitting flat on it. Normals come from the actual surface derivatives, so the
 * shading is real rather than painted on.
 */
export function blade(mb, opts) {
  const {
    origin, dir, side, len, width, cup = 0.5, sweep = 0.35,
    tipTaper = 1, albedo, baseAlbedo = null, edgeAlbedo = null,
    params, rows = 10, cols = 6, ripple = 0,
  } = opts;
  const up = norm(cross(dir, side));
  const base = mb.vertexCount;

  const at = (u, v) => {
    // u: 0 at the base, 1 at the tip. v: -1 to 1 across the width.
    const half = Math.sin(Math.pow(u, 0.65) * Math.PI) * width * (1 - u * (1 - tipTaper));
    const along = u * len;
    // cupped across, swept along, with a little waviness near the edge
    const lift = -cup * v * v * half
      + sweep * u * u * len * 0.25
      + Math.sin(u * 9.0 + v * 2.0) * ripple * half * 0.25;
    return [
      origin[0] + dir[0] * along + side[0] * v * half + up[0] * lift,
      origin[1] + dir[1] * along + side[1] * v * half + up[1] * lift,
      origin[2] + dir[2] * along + side[2] * v * half + up[2] * lift,
    ];
  };

  const eps = 0.01;
  for (let i = 0; i <= rows; i++) {
    const u = i / rows;
    for (let j = 0; j <= cols; j++) {
      const v = (j / cols) * 2 - 1;
      const p = at(u, v);
      const pu = at(Math.min(1, u + eps), v);
      const pv = at(u, Math.min(1, v + eps));
      const du = [pu[0] - p[0], pu[1] - p[1], pu[2] - p[2]];
      const dv = [pv[0] - p[0], pv[1] - p[1], pv[2] - p[2]];
      let n = norm(cross(du, dv));
      if (n[0] * up[0] + n[1] * up[1] + n[2] * up[2] < 0) n = [-n[0], -n[1], -n[2]];
      // Colour that runs across the surface, not one value for the whole of it.
      //
      // No leaf and no petal is a single colour: a petal is almost always paler
      // or yellower where it joins, because that is where the nectar guide and
      // the unpigmented base are, and a leaf thins and pales towards its edge
      // where there is less of it to hold chlorophyll. Flat fill is the single
      // clearest sign of something modelled rather than grown.
      let c = albedo;
      if (baseAlbedo) {
        const t = Math.min(1, Math.pow(u, 0.55));
        c = [
          baseAlbedo[0] + (c[0] - baseAlbedo[0]) * t,
          baseAlbedo[1] + (c[1] - baseAlbedo[1]) * t,
          baseAlbedo[2] + (c[2] - baseAlbedo[2]) * t,
        ];
      }
      if (edgeAlbedo) {
        const e = Math.pow(Math.abs(v), 2.2);
        c = [
          c[0] + (edgeAlbedo[0] - c[0]) * e,
          c[1] + (edgeAlbedo[1] - c[1]) * e,
          c[2] + (edgeAlbedo[2] - c[2]) * e,
        ];
      }
      mb.push(p, n, c, params, [u * len, v * width]);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = base + i * (cols + 1) + j;
      mb.quad(a, a + 1, a + cols + 2, a + cols + 1);
    }
  }
}

/**
 * A flat outline, given a little thickness and put into space.
 *
 * `blade` can only make a smooth curved surface, which is the right shape for
 * most foliage and exactly the wrong one for anything meant to read as sharp:
 * teeth, barbs and points all get rounded away by it. This takes a polygon as
 * drawn and keeps its corners, which is what makes an angular kind angular.
 *
 * Triangulated as a fan from the centroid — every outline here is star-shaped
 * about its own middle, so that holds, and it costs one pass.
 */
export function sheet(mb, opts) {
  const { pts, origin, dir, side, scale = 1, lift = 0, albedo, params } = opts;
  const up = norm(cross(dir, side));
  const place = (p, off) => [
    origin[0] + side[0] * p.x * scale + dir[0] * p.y * scale + up[0] * off,
    origin[1] + side[1] * p.x * scale + dir[1] * p.y * scale + up[1] * off,
    origin[2] + side[2] * p.x * scale + dir[2] * p.y * scale + up[2] * off,
  ];

  let cx = 0;
  let cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length;
  cy /= pts.length;
  const centre = { x: cx, y: cy };

  for (const s of [1, -1]) {
    const n = [up[0] * s, up[1] * s, up[2] * s];
    const base = mb.vertexCount;
    mb.push(place(centre, lift * s), n, albedo, params, [0, 0]);
    for (const p of pts) {
      mb.push(place(p, lift * s), n, albedo, params,
        [p.x * scale, p.y * scale]);
    }
    for (let i = 0; i < pts.length; i++) {
      const a = base + 1 + i;
      const b = base + 1 + ((i + 1) % pts.length);
      if (s > 0) mb.tri(base, a, b); else mb.tri(base, b, a);
    }
  }
}

/**
 * The studio sweep: a wall that curves into a floor with no seam.
 *
 * This is the surface the whole look depends on — it is what the plant casts its
 * shadow onto, and a cyclorama with no visible corner is exactly what the
 * reference photographs are shot against.
 */
export function sweep(mb, opts) {
  const { width, height, wallZ, floorFront, radius, albedo, params, cols = 24, rows = 40,
    yBase = 0 } = opts;
  const base = mb.vertexCount;

  // The profile runs from the front of the floor — well towards the camera, so
  // the lower half of the frame is floor rather than void — back to the foot of
  // the wall, round the cove, and up. The wall has to stay close behind the
  // plant or its cast shadow lands off screen entirely.
  const profile = [];
  const flatRun = floorFront + (wallZ - radius);
  const wallRun = Math.max(1, height - radius);
  const total = flatRun + (Math.PI / 2) * radius + wallRun;
  for (let i = 0; i <= rows; i++) {
    const t = (i / rows) * total;
    if (t < flatRun) {
      profile.push({ y: 0, z: floorFront - t, n: [0, 1, 0] });
    } else if (t < flatRun + (Math.PI / 2) * radius) {
      const a = (t - flatRun) / radius;
      profile.push({
        y: radius * (1 - Math.cos(a)),
        z: -(wallZ - radius) - radius * Math.sin(a),
        n: [0, Math.cos(a), Math.sin(a)],
      });
    } else {
      profile.push({ y: radius + (t - flatRun - (Math.PI / 2) * radius), z: -wallZ, n: [0, 0, 1] });
    }
  }

  const top = profile[profile.length - 1].y || 1;
  for (const pr of profile) {
    for (let j = 0; j <= cols; j++) {
      const x = (j / cols - 0.5) * width;
      // darker towards the top and the edges, like a swept paper backdrop
      const v = 1 - Math.pow(Math.min(1, Math.max(0, pr.y) / top), 1.1) * 0.42;
      const e = 1 - Math.pow(Math.abs(j / cols - 0.5) * 2, 2.2) * 0.30;
      const k = v * e;
      mb.push([x, pr.y + yBase, pr.z], norm(pr.n),
        [albedo[0] * k, albedo[1] * k, albedo[2] * k], params, [x, pr.y]);
    }
  }
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const a = base + i * (cols + 1) + j;
      mb.quad(a, a + 1, a + cols + 2, a + cols + 1);
    }
  }
}

/**
 * How far a point on the plant sits from the backdrop.
 * Derived from the geometry rather than stored, so growth.js stays planar and
 * every existing structural measurement keeps working unchanged.
 */
export function depthAt(x, y, salt = 0) {
  return (noise2(x * 0.008 + salt, y * 0.008, 17) - 0.5) * 2 * 26
       + (noise2(x * 0.031, y * 0.031, 91) - 0.5) * 2 * 9;
}
