// Building the scene from the plant.
//
// The whole organism becomes one interleaved vertex buffer, rebuilt only when a
// section is added. Materials stop being drawing routines and become surface
// parameters — roughness, metalness, how much light passes through — which is
// what lets clay, wax, glass and metal differ the way they actually differ
// rather than by having different textures painted on them.

import { makeRng, clamp, clamp01, lerp, noise2 } from '../rng.js';
import { linear } from './toon.js';
import { MATERIAL_BY_ID, MATERIALS, nodeOutlines, stemProfile, roundCorners } from '../materials.js';
import { ENV_BY_ID, ENVIRONMENTS } from '../environment.js';
import { MeshBuilder, FLOATS_PER_VERTEX, tube, sphere, sphereAt, shard, blade, sheet, sweep, depthAt } from './meshes.js';

/**
 * Leaf clumps, as displacement over a canopy: two octaves of lumps a few to a
 * canopy across, which break a round crown into masses without the detail of
 * individual leaves — the low-poly look the world is built in.
 */
const lumps = (rad, seed) => (px, py, pz) => {
  const k = 2.4 / rad;
  return ((noise2(px * k + pz * k * 0.6 + seed, py * k, 55) - 0.5) * 0.40
    + (noise2(px * k * 2.7 - pz * k * 1.9, py * k * 2.7 + seed, 91) - 0.5) * 0.18) * rad;
};

const cross3 = (a, b) => {
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const l = Math.hypot(c[0], c[1], c[2]) || 1;
  return [c[0] / l, c[1] / l, c[2] / l];
};

/**
 * Surface parameters per material: [roughness, metalness, translucency].
 *
 * This is the payoff of moving to a real renderer. Wax is not "a pale colour
 * with a soft gradient", it is a rough dielectric that light passes through;
 * metal is not "a stripey gradient", it has no diffuse term at all. The flat
 * idioms keep a neutral surface and are handled as screen-space treatments.
 */
export const MAT_ID = {
  botanical: 1, simple3d: 2, clay: 3, wool: 4, thread: 5, embroidery: 6,
  paper: 7, glass: 8, metal: 9, wax: 10, mold: 11, gouache: 12, oil: 13,
  watercolor: 14, charcoal: 15,
  porcelain: 16, rust: 17, velvet: 18, bone: 19, resin: 20, stone: 21, flock: 22,
  // Not a material a plant can be made of — the world's own, so cloud and
  // ground are lit and surfaced by the same system as everything else.
  cloud: 23, terrain: 24, scenery: 25, thicket: 26, water: 27, rock: 28,
  wing: 29, fish: 30, frond: 31,
  // foliage as cut-out cards: the shapes are cut per pixel in the shader
  grass: 32, leaves: 33,
  // 40 and above are the flat idioms, handled as screen-space treatments. The
  // boundary was at 20 and the substances had run up against it.
  vector: 40, lineart: 41, grain: 42, ascii: 43, pixel: 44, halftone: 45,
  dither: 46, wireframe: 47,
  thermal: 48, xray: 49, depth: 50, contour: 51, blueprint: 52, riso: 53,
  collage: 54, smoke: 55, stipple: 56, blockprint: 57, illumination: 58,
};
export const BACKDROP_ID = 0;

const SURFACE = {
  botanical: [0.2, 0.0, 0.45],
  simple3d: [0.05, 0.0, 0.05],
  clay: [0.3, 0.0, 0.06],
  wool: [0.44, 0.0, 0.46],
  thread: [0.38, 0.0, 0.22],
  embroidery: [0.38, 0.0, 0.18],
  paper: [0.18, 0.0, 0.55],
  glass: [0.015, 0.0, 0.95],
  metal: [0.07, 1.0, 0.0],
  wax: [0.15, 0.0, 0.92],
  mold: [0.46, 0.0, 0.12],
  gouache: [0.14, 0.0, 0.10],
  oil: [0.24, 0.0, 0.08],
  watercolor: [0.13, 0.0, 0.40],
  charcoal: [0.34, 0.0, 0.02],
  porcelain: [0.05, 0.0, 0.58],     // glaze over a body light passes into
  rust: [0.52, 0.35, 0.0],          // oxide keeps a trace of the metal under it
  velvet: [0.3, 0.0, 0.26],
  bone: [0.28, 0.0, 0.38],
  resin: [0.06, 0.0, 0.90],
  stone: [0.4, 0.0, 0.03],
  vector: [0.70, 0.0, 0.10],
  lineart: [0.80, 0.0, 0.05],
  grain: [0.26, 0.0, 0.08],
  ascii: [0.75, 0.0, 0.10],
  pixel: [0.72, 0.0, 0.10],
  halftone: [0.75, 0.0, 0.10],
  dither: [0.75, 0.0, 0.10],
  wireframe: [0.60, 0.0, 0.20],
  thermal: [0.70, 0.0, 0.10],
  xray: [0.70, 0.0, 0.10],
  depth: [0.70, 0.0, 0.10],
  contour: [0.70, 0.0, 0.10],
  blueprint: [0.70, 0.0, 0.10],
  riso: [0.70, 0.0, 0.10],
  collage: [0.70, 0.0, 0.10],
  smoke: [0.70, 0.0, 0.10],
  stipple: [0.70, 0.0, 0.10],
  blockprint: [0.70, 0.0, 0.10],
  illumination: [0.70, 0.0, 0.10],
  flock: [1.00, 0.0, 0.34],         // dense pile: no specular to speak of
  // Not materials a plant can be made of — the world's own, so that cloud and
  // ground are lit and surfaced by the same system as everything else.
  cloud: [1.00, 0.0, 0.85],         // vapour: no specular, and light goes through
  terrain: [0.70, 0.0, 0.10],   // earth: rough, but not paper
  scenery: [0.58, 0.0, 0.08],       // distant rock: it has faces
  thicket: [0.48, 0.0, 0.42],       // distant leaf: waxy, and light goes through
  water: [0.11, 0.0, 0.45],         // smooth enough to hold the sky in it
  rock: [0.62, 0.0, 0.03],          // cave stone: dry, and it has faces
  wing: [0.55, 0.0, 0.30],          // feather
  fish: [0.30, 0.0, 0.25],          // wet, and it catches the light off its side
  frond: [0.48, 0.0, 0.52],         // a blade of anything: thin, and lit through
  // Matte, both. Seen at the grazing angle grass always is, any gloss at all
  // mirrors the sky, and a meadow goes mint.
  grass: [0.90, 0.0, 0.40],         // a clump of blades, lit through at the tips
  leaves: [0.74, 0.0, 0.55],        // a leaf is thin enough to glow with the sun behind it
};

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  s = clamp01(s / 100);
  l = clamp01(l / 100);
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  // to linear, since the shader works in linear light
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((c) => Math.pow(c, 2.2));
}

function hueTowards(from, to, t) {
  const d = ((to - from + 540) % 360) - 180;
  return from + d * t;
}

/** The section's stem colour, matching the 2D palette logic. */
/**
 * What the substance does to the pigment.
 *
 * A material used to change only a roughness number, so wool, clay and glass
 * came out the same colour and read as one texture with three glosses. The
 * plant still owns the hue — that is its identity across a material switch —
 * but saturation, lightness and warmth belong to the substance, and are applied
 * after the hue blend so they cannot be washed out by it.
 *
 * [saturation x, lightness x, lightness +, how far the hue is pulled, and to where]
 *
 * The fifth value matters for substances whose identity *is* a colour. Without
 * it rust, velvet and resin came out as three shades of the same red, because
 * the plant's own hue survived and only saturation and lightness were left to
 * tell them apart. Iron oxide is not crimson and amber is not either.
 */
const PIGMENT = {
  botanical: [1.00, 1.00, 0, 0.00, 32],
  simple3d: [0.88, 1.06, 2, 0.05, 32],
  clay: [0.44, 0.98, 6, 0.55, 32],        // chalky terracotta
  wool: [0.34, 1.22, 10, 0.30, 32],       // fibre scatter lifts it pale
  thread: [1.05, 0.88, -3, 0.10, 32],
  embroidery: [1.25, 0.92, -2, 0.05, 32],
  paper: [0.22, 1.34, 16, 0.22, 32],      // pigment lying thin on white stock
  glass: [0.55, 0.74, -3, 0.00, 32],      // the body is dim; the grazing rim carries it
  metal: [0.14, 1.55, 40, 0.08, 32],      // F0, not a diffuse: metals sit high
  wax: [0.46, 1.18, 8, 0.18, 32],
  mold: [0.52, 0.70, -6, 0.35, 32],
  gouache: [1.35, 1.10, 4, 0.00, 32],     // flat opaque pigment
  oil: [1.20, 0.86, -4, 0.06, 32],
  watercolor: [0.42, 1.30, 14, 0.05, 32],
  charcoal: [0.12, 0.58, -3, 0.00, 32],   // near black, but still has to show its tooth
  porcelain: [0.26, 1.30, 13, 0.38, 205], // fired white, cooled by the glaze
  rust: [1.10, 0.78, -3, 0.80, 24],       // iron oxide, nothing crimson about it
  velvet: [1.30, 0.60, -7, 0.58, 344],    // deep pile drinks the light
  bone: [0.32, 1.26, 11, 0.46, 44],
  resin: [1.05, 1.04, 3, 0.66, 34],       // amber, holding its own colour
  stone: [0.26, 0.94, 2, 0.40, 40],
  flock: [1.15, 1.06, 4, 0.10, 32],       // dyed pile holds its colour
  cloud: [0.10, 1.30, 20, 0.00, 32],
  scenery: [0.94, 1.00, 0, 0.00, 32],
  water: [1.10, 1.00, 0, 0.12, 200],
  rock: [0.30, 1.00, 0, 0.10, 28],
  wing: [0.60, 1.00, 0, 0.00, 32],
  fish: [1.10, 1.05, 0, 0.06, 200],
  frond: [1.05, 1.00, 0, 0.12, 108],
  thicket: [1.15, 1.02, 0, 0.16, 108],
  grass: [1.05, 1.00, 0, 0.12, 108],
  leaves: [1.15, 1.02, 0, 0.16, 108],
  terrain: [0.60, 1.00, 0, 0.30, 38],
  grain: [0.70, 1.02, 3, 0.30, 32],
  vector: [1.30, 1.08, 3, 0.00, 32],
  lineart: [0.30, 1.25, 10, 0.00, 32],
  ascii: [0.55, 0.95, 0, 0.05, 32],
  pixel: [1.22, 1.02, 2, 0.00, 32],
  halftone: [0.65, 1.05, 4, 0.00, 32],
  dither: [0.75, 0.98, 0, 0.00, 32],
  wireframe: [0.45, 0.90, -4, 0.00, 32],
  thermal: [1.00, 1.00, 0, 0.00, 32],
  xray: [0.40, 1.10, 4, 0.00, 32],
  depth: [0.70, 1.00, 0, 0.00, 32],
  contour: [0.55, 1.08, 5, 0.10, 32],
  blueprint: [0.60, 0.95, -2, 0.00, 32],
  riso: [1.15, 1.05, 3, 0.00, 32],
  collage: [1.20, 1.10, 4, 0.12, 32],
  smoke: [0.30, 1.05, 2, 0.00, 218],
  stipple: [0.35, 1.12, 6, 0.15, 38],
  blockprint: [1.45, 0.94, -2, 0.00, 32],
  illumination: [1.40, 1.02, 2, 0.20, 45],
};

/**
 * How far a substance's own surface stands off the ideal cylinder.
 *
 * [amplitude as a fraction of the member's radius, cells along, cells around,
 *  and optionally a structure the noise is laid over]
 *
 * Shading alone cannot do this: a normal map leaves the outline perfectly
 * smooth, so a rough material still reads as a smooth object with roughness
 * drawn on it. Rust has to be lumpy where it meets the backdrop and glass has
 * to stay clean there.
 */
// Only substances appear here. A flat idiom is a picture, so displacing its
// geometry would give a drawing a lumpy three-dimensional outline — grain was
// the one that slipped through.
const RELIEF = {
  rust: [0.52, 0.09, 3.5],
  mold: [0.46, 0.16, 4.0],
  stone: [0.4, 0.13, 4.5],
  wool: [0.44, 0.20, 5.0],
  embroidery: [0.38, 0.15, 3.0, 'band'],
  charcoal: [0.34, 0.11, 3.5],
  thread: [0.38, 0.34, 2.0, 'helix'],   // a cord is twisted, not merely bumpy
  clay: [0.3, 0.05, 2.0],
  bone: [0.28, 0.09, 3.2],
  velvet: [0.3, 0.26, 6.5],
  oil: [0.24, 0.09, 2.5],
  paper: [0.18, 0.10, 3.0],
  botanical: [0.2, 0.07, 3.0, 'ribs'],  // stems are ridged along their length
  gouache: [0.14, 0.08, 2.5],
  watercolor: [0.13, 0.09, 2.5],
  wax: [0.15, 0.04, 1.5],
  metal: [0.07, 0.03, 1.5],
  porcelain: [0.05, 0.04, 2.0],
  resin: [0.06, 0.04, 1.5],
  simple3d: [0.05, 0.05, 2.0],
  glass: [0.015, 0.03, 1.5],
};

/**
 * Test hook: build every member as a perfect cylinder.
 *
 * The geometry cannot be switched off in the shader the way the shading can, so
 * without this there is no way to measure what the displacement contributes —
 * and it was briefly not being applied at all while every shading number stayed
 * perfectly healthy.
 */
let displacementOff = false;
export function setDisplacement(on) { displacementOff = !on; }

/** The displacement function for one section's material, or null if it is flat. */
function reliefFor(materialId, salt) {
  const k = RELIEF[materialId];
  if (!k || displacementOff) return null;
  const [amp, along, around, pattern] = k;
  return (u, ang, p) => {
    const a = ang * around;
    const n1 = noise2(u * along + salt, Math.cos(a) * 2 + Math.sin(a) * 2, 41) - 0.5;
    const n2 = noise2(u * along * 2.7 + salt, Math.cos(a) * 5 + Math.sin(a) * 5, 73) - 0.5;
    let v = n1 * 1.4 + n2 * 0.6;
    // Some surfaces are not noise. A cord is twisted, a stem is ridged along
    // its length, a satin stitch runs across it — noise alone gives all three
    // the same lumpy character and loses what makes each recognisable.
    if (pattern === 'helix') {
      v = v * 0.35 + Math.sin(ang * 3 + u * 0.42) * 0.65;
    } else if (pattern === 'ribs') {
      v = v * 0.45 + Math.sin(ang * 5) * 0.55;
    } else if (pattern === 'band') {
      v = v * 0.40 + (Math.abs(((u * 0.16) % 1) - 0.5) * 2 - 0.5) * 0.60;
    }
    return v * amp * (p.r ?? p);
  };
}

function stemColour(section, rng) {
  const mat = MATERIAL_BY_ID[section.materialId] || MATERIALS[0];
  const wilt = clamp01(1 - (section.vitality ?? 1));
  let h = lerp(mat.hue[0], mat.hue[1], rng());
  const s = lerp(mat.sat[0], mat.sat[1], rng()) * 0.92;
  let l = lerp(mat.lum[0], mat.lum[1], rng());
  if (section.baseHue != null) {
    h = hueTowards(h, section.baseHue, 0.68);
    const baseLum = 34 + ((Math.round(section.baseHue * 7.3) % 100) / 100) * 12;
    l = l * 0.42 + baseLum * 0.58;
  }
  h = hueTowards(h, 34, wilt * 0.6);

  const pig = PIGMENT[section.materialId] || PIGMENT.botanical;
  h = hueTowards(h, pig[4] ?? 32, pig[3]);
  return {
    h,
    s: clamp(s * pig[0] * (1 - wilt * 0.58), 0, 100),
    l: clamp((l * pig[1] + pig[2]) * (1 - wilt * 0.26), 3, 94),
  };
}

/**
 * The hues flowers actually come in, relative to foliage: yellows through
 * oranges, reds, pinks and violets, plus white. One is chosen per plant so
 * every bloom on it belongs to the same flower, rather than each head picking
 * its own colour.
 */
const FLOWER_HUES = [52, 44, 28, 12, 355, 340, 322, 300, 275, 58];

function flowerHueFor(plant) {
  const k = Math.abs(Math.round((plant.baseHue ?? 110) * 977.3)) % FLOWER_HUES.length;
  return FLOWER_HUES[k];
}

/**
 * Bloom colour: the plant's flower hue with small per-bloom variation, kept in
 * the same substance as the stem it grows from.
 *
 * These used to swing +/-105 degrees per head, which put cyan leaves on a green
 * plant, and fixed saturation and lightness clamps then overrode whatever the
 * material had done — so a wool plant grew glassy teal blooms. The clamps are
 * now relative to the stem colour, so pale wool stays pale and charcoal stays
 * near-black while blooms still read as brighter than the stalk.
 */
function bloomColour(base, node, flowerHue, pig) {
  const a = (node.seed % 997) / 997;
  const b = ((node.seed >> 9) % 811) / 811;
  const pull = node.kind === 'leaf' ? 0.10 : 0.74;
  // then back towards the substance, or a rust plant grows crimson berries
  const toward = hueTowards(base.h, flowerHue, pull) + (a - 0.5) * 22;
  return {
    h: hueTowards(toward, pig[4] ?? 32, (pig[3] ?? 0) * 0.55),
    s: clamp(base.s * (0.90 + b * 0.55), base.s * 0.45, base.s * 1.6 + 7),
    l: clamp(base.l * (1.05 + b * 0.28), base.l * 0.72, base.l * 1.34 + 5),
  };
}

const rot = (v, axis, ang) => {
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
 * How wide a stem is drawn, against the width growth gives it. The simulation's
 * widths carry the plant's weight (see vitality.js) and are left as they are;
 * drawn at full width a stem was a pipe beside the flowers it carried.
 */
export const STEM_DRAWN = 0.42;

/**
 * Printed (v3), the plant is a drawing: pressed into its own plane to this
 * fraction of its depth, so every part of it is a shape seen from the front —
 * a sphere a disc, a tube a band — the same shapes the lit version (v2) has,
 * seen the same way, with the depth taken out.
 */
const PRESSED = 0.12;

/** Pressed flat along z, with the normals turned to match. */
function pressFlat(data) {
  const F = FLOATS_PER_VERTEX;
  for (let i = 0; i < data.length; i += F) {
    data[i + 2] *= PRESSED;
    const nx = data[i + 3];
    const ny = data[i + 4];
    const nz = data[i + 5] / PRESSED;
    const l = Math.hypot(nx, ny, nz) || 1;
    data[i + 3] = nx / l;
    data[i + 4] = ny / l;
    data[i + 5] = nz / l;
  }
}

/**
 * The eye of a flower: gold in a flower of any other colour, and brown in a
 * yellow one — the one rule the flowers in both looks keep, so a head reads as
 * the same flower lit or printed.
 */
function eyeColour(h) {
  const hue = ((h % 360) + 360) % 360;
  return hue > 34 && hue < 72 ? hslToRgb(24, 55, 26) : hslToRgb(44, 92, 54);
}

/**
 * How far out from the stem a part's head begins, in multiples of its size.
 * growth.js claims ground for each part on the same terms (PART_SPACE there),
 * and tools/test.js checks every drawn part stays inside what it claimed.
 */
export const PART_CLEAR = 0.25;

/**
 * Carry a part clear of the stem it grows from.
 *
 * Every kind of head is built round its own centre, and for many of them that
 * centre was the joint itself or near it: a star's arms and an umbel's rays
 * radiate from the point on the stem, a daisy's petals reach back past its
 * stalk, a lily's hang down over it. So flowers sat on the stem, and read as
 * stuck to it. Measured once the part is built: wherever its head comes nearer
 * the joint than PART_CLEAR, the whole part moves out along its own direction
 * and the stalk is lengthened to carry it — the same rule for every kind.
 */
function carryClear(mb, p) {
  const F = FLOATS_PER_VERTEX;
  const d = mb.verts;
  const v1 = mb.vertexCount;
  const su = Math.sin(p.n.angle);
  const cu = Math.cos(p.n.angle);
  let umin = Infinity;
  for (let v = p.v0; v < v1; v++) {
    const x = d[v * F] - p.n.x;
    const y = d[v * F + 1] - p.n.y;
    // the head: anything wider than the stalk, or reaching back past the joint
    const u = x * su + y * cu;
    if (Math.abs(x * cu - y * su) > p.stalkR * 2.2 || u < -0.02 * p.n.size) umin = Math.min(umin, u);
  }
  const clear = p.n.size * PART_CLEAR;
  if (!(umin < clear)) return;
  const shift = clear - umin;
  for (let v = p.v0; v < v1; v++) {
    d[v * F] += su * shift;
    d[v * F + 1] += cu * shift;
  }
  tube(mb, [
    { x: p.n.x, y: p.n.y, z: p.z, r: p.stalkR * 1.3 },
    { x: p.n.x + su * shift, y: p.n.y + cu * shift, z: p.z, r: p.stalkR * 1.3 },
  ], 7, () => p.rgb, () => p.surf);
}

/** Build the whole plant as one mesh. */
//
// `which` builds part of it: 'settled', every section but the one growing, or
// 'growing', that one alone. While a section grows in, the rest of the plant
// does not change, and rebuilding all of it every frame of the growth — every
// stem, every flower — cost fourteen milliseconds a frame on a fast machine for
// a plant of thirty sections, which on a slow one is every growth stuttering.
export function buildPlant(plant, reveal = null, which = 'all') {
  const mb = new MeshBuilder();
  const flowerHue = flowerHueFor(plant);
  const pressed = STYLE !== 'real';
  // the stem still growing, which carries the bud
  const live = new Map((plant.tips || []).filter((t) => t.alive !== false).map((t) => [t.id, t]));

  for (const section of plant.sections) {
    // the section currently growing is built only as far as it has got
    const growing = reveal && section.step === reveal.step;
    if (which === 'settled' && growing) continue;
    if (which === 'growing' && !growing) continue;
    const kMax = growing ? reveal.progress * section.steps : Infinity;
    if (growing && reveal.progress <= 0) continue;
    const mat = MATERIAL_BY_ID[section.materialId] || MATERIALS[0];
    const base3 = SURFACE[section.materialId] || SURFACE.botanical;
    const matId = MAT_ID[section.materialId] || 1;
    const surf = [base3[0], base3[1], base3[2], matId];

    // For a flat idiom the roughness slot carries the layer instead.
    //
    // Which plane a shape sits in has to be one value for the whole piece. The
    // first version read it from the fragment's own world z, and on a tube that
    // varies across the width — so the curving edge of every member landed in a
    // different tier and got its own band of tone, which is a rim, and a rim is
    // the one thing these are not supposed to have.
    const flat = matId >= 40;
    const layered = (z) => (flat
      ? [clamp(z / 190 + 0.5, 0, 1), base3[1], base3[2], matId]
      : surf);
    const rng = makeRng(1013 + section.step * 7919);
    const col = stemColour(section, rng);
    const rgb = hslToRgb(col.h, col.s, col.l);
    const salt = section.step * 3.7;
    const relief = reliefFor(section.materialId, salt);

    // ---- stems ----
    for (const seg of section.segments) {
      const pts = growing ? seg.points.filter((p) => p.k <= kMax) : seg.points;
      if (pts.length < 2) continue;
      const prof = stemProfile(roundCorners(pts, 0.55), 44 + (section.step % 4) * 7, 0.24);

      // Where a branch meets its parent.
      //
      // Growth spawns a child at the parent's exact point with a fraction of
      // its width, so the two tubes simply interpenetrated: a thin pipe butted
      // into a thick one, which is the one thing no plant does. A real branch
      // leaves through a swollen collar and flares into the wood it comes from.
      // Built here rather than in growth.js, so the simulation stays planar and
      // every structural measurement keeps reading the same numbers.
      // One depth for the whole member.
      //
      // Depth used to be sampled per point from smooth noise over x and y, so a
      // member that was dead straight in the simulation bent through space as
      // it went — which is how a plant built entirely from 45 and 90 degree
      // runs still came out looking like a handful of wandering vines. Depth
      // belongs *between* members, not along them: it separates branches from
      // each other and gives the camera something to focus past, and every
      // piece stays as straight in space as it is on the lattice. Taking it
      // from the first point keeps joints continuous, because a branch starts
      // exactly where its parent was.
      // (pressed flat, a drawing has no depth to give it)
      const segZ = (pressed ? 0 : depthAt(pts[0].x, pts[0].y, salt) * 0.3) + seg.depth * 4;
      // and the lean the branch grows with (see growth.js, leanFor): depth
      // along the member in proportion to how far along it the point is, which
      // keeps every straight run straight in space and every joint joined
      const leanAt = (() => {
        const z0 = seg.z0 ?? 0;
        const slope = seg.zSlope ?? 0;
        let arc = 0;
        let prev = null;
        return (p) => {
          if (prev) arc += Math.hypot(p.x - prev.x, p.y - prev.y);
          prev = p;
          return Math.max(-1200, Math.min(1200, z0 + slope * arc));
        };
      })();
      const p0 = prof.points[0];
      const isBranch = seg.depth > 0;
      const nodeAt = prof.points.map((_, i) => {
        let best = Infinity;
        for (const n of prof.nodes) best = Math.min(best, Math.abs(i - n));
        return Math.exp(-(best * best) / 2.2);
      });

      const path = prof.points.map((p, i) => {
        const d = Math.hypot(p.x - p0.x, p.y - p0.y);
        // A longer, gentler flare. A short sharp one leaves a step where it
        // ends, which is another edge for the eye to catch on.
        const flare = isBranch ? 1 + 0.85 * Math.exp(-d / 13) : 1;
        const lean = leanAt(p);
        return {
          x: p.x,
          y: p.y,
          z: segZ + (pressed ? 0 : lean),
          r: p.w * 0.5 * STEM_DRAWN * flare * (1 + nodeAt[i] * 0.22),
        };
      });
      // more sides, because a displaced outline needs somewhere to be displaced
      const segSurf = layered(segZ);
      // Colour that moves along the member.
      //
      // One flat green from base to tip is the thing that made a stem read as
      // extruded plastic. A living stem is uneven along its length — older wood
      // duller, newer growth brighter — and it warms towards red at every node,
      // which is where the pigment gathers and the commonest tell that a thing
      // is grown rather than moulded.
      tube(mb, path, 18,
        (i, p) => {
          const nd = nodeAt[i];
          const along = noise2(p.x * 0.010 + salt, p.y * 0.010, 53) - 0.5;
          const k = 1 + along * 0.20 - nd * 0.14;
          return [
            Math.min(1, rgb[0] * k + nd * 0.10),   // nodes take on a red flush
            rgb[1] * k * (1 - nd * 0.16),
            rgb[2] * k * (1 - nd * 0.10),
          ];
        },
        () => segSurf, relief);

      // The collar fills the intersection; the flare above does the shaping.
      //
      // It used to be darkened by an eighth, which is what made the joint
      // *visible*: a sphere in a different colour from the wood either side
      // announces itself as a separate object however well it is placed, and
      // the eye reads a seam. It is the same colour as the member now, and a
      // touch larger so nothing of the crease underneath shows past it.
      // Whatever shading a joint deserves, the light gives it.
      if (isBranch) {
        sphere(mb, p0.x, p0.y, segZ, path[0].r * 1.06, 9, 12, rgb, segSurf, relief);
      }

      // Round both stem ends. A tube caps only its far end, so every segment
      // start was an open ring you could see down the inside of, and where a
      // stem genuinely stops the far cap faces the camera as a cut pipe. Where
      // one section runs into the next the rounding is buried inside the
      // following segment and costs nothing, so it needs no special case.
      for (const e of [path[0], path[path.length - 1]]) {
        sphere(mb, e.x, e.y, e.z, e.r * 1.0, 8, 10, rgb, segSurf, relief);
      }

      // The growing tip carries a bud: closed, cupped in the stem's own colour,
      // with the plant's flower colour showing at the top. A stem that simply
      // stopped read as a cut wire, and the flowers as things stuck onto one;
      // with the bud the stem is visibly the thing the flowers come from.
      const tipNow = live.get(seg.tipId);
      const end = pts[pts.length - 1];
      if (tipNow && (growing || Math.hypot(end.x - tipNow.x, end.y - tipNow.y) < 0.5)) {
        const e = path[path.length - 1];
        const q = path[Math.max(0, path.length - 2)];
        let d = [e.x - q.x, e.y - q.y];
        const dl = Math.hypot(d[0], d[1]) || 1;
        d = [d[0] / dl, d[1] / dl];
        const B = bloomColour(col, { seed: seg.id * 7919, kind: 'bud' }, flowerHue,
          PIGMENT[section.materialId] || PIGMENT.botanical);
        if (pressed) {
          B.s = Math.max(B.s, 75);
          B.l = clamp(B.l, 50, 68);
        }
        const petal = hslToRgb(B.h, B.s, B.l);
        const r0 = Math.max(e.r, 1.2);
        const len = Math.max(r0 * 7, 14);
        const bud = [];
        for (let i = 0; i <= 10; i++) {
          const t = i / 10;
          bud.push({
            x: e.x + d[0] * t * len, y: e.y + d[1] * t * len, z: e.z,
            // swelling out of the stem, full two thirds of the way, to a point
            r: r0 * (0.9 + Math.sin(Math.pow(t, 0.75) * Math.PI) * 1.25) * (1 - t * 0.55),
          });
        }
        tube(mb, bud, 12, (i) => (i < 5 ? rgb : petal), () => segSurf);
      }
    }

    // ---- blooms ----
    const bcolBase = col;
    // each part is carried clear of the stem once all of it is built: at the
    // top of the next time round, and after the last
    let pendingPart = null;
    const carry = () => { if (pendingPart) carryClear(mb, pendingPart); pendingPart = null; };
    for (const node of section.nodes) {
      carry();
      // Blooms open, they do not appear.
      //
      // A node was drawn at full size the instant the stem reached it, so a
      // whole flower head arrived between one frame and the next while the
      // member carrying it was still creeping outward — the growth read as
      // careful and the parts as pasted on. It swells over the next few steps
      // of the same reveal instead, which costs nothing and is what the eye
      // expects of something growing.
      // It starts swelling as the stem comes up to it, and is out by the time
      // the stem gets there. Measuring from the node's own step instead meant a
      // terminal bloom — whose step *is* the last one — never began opening at
      // all within its section's reveal, and arrived whole at the end: exactly
      // the pop this is here to remove, moved later.
      const OPEN_OVER = 2.2;   // steps of stem it takes to come out
      const open = growing
        ? clamp01((kMax - Math.max(0, node.k - OPEN_OVER)) / OPEN_OVER)
        : 1;
      if (open <= 0) continue;
      // eased so it starts quickly and settles, rather than growing linearly
      const swell = open * open * (3 - 2 * open);
      const n = swell < 1 ? { ...node, size: node.size * swell } : node;

      const B = bloomColour(bcolBase, n, flowerHue,
        PIGMENT[section.materialId] || PIGMENT.botanical);
      // Printed, a flower keeps its hue but is one of the loud inks: muted to
      // suit a wooden stalk, every bloom on it printed in the brown ink, and
      // the plant flowered in mud.
      if (STYLE !== 'real') {
        B.s = Math.max(B.s, 75);
        B.l = clamp(B.l, 50, 68);
      }
      const brgb = hslToRgb(B.h, B.s, B.l);
      const eye = eyeColour(B.h);
      const z = pressed ? 0 : (n.z ?? 0) + depthAt(n.x, n.y, salt) * 0.3;
      const parts = nodeOutlines(n.kind, n.size, makeRng(n.seed));
      // Flowers and leaves are clean. The section's material is carried by its
      // stems, and colours its flowers through the pigment, but on the heads
      // themselves its surface — fibre, crazing, pitting, fuzz — made every
      // flower a mottled, dark, textured lump, and a plant covered in them
      // looked messy rather than made. A drawing stays a drawing.
      const bloomSurf = matId >= 40 ? layered(z) : [0.38, 0.0, 0.5, MAT_ID.simple3d];
      // What carries a head is stem, not flower: the same substance, colour and
      // thickness as the member it comes off, so the stalk reads as the stem
      // going on into the flower rather than as a peg the head is stuck on.
      const stalkSurf = layered(z);

      // A leaf is a thin sheet with a rib down it, and it is not shiny.
      //
      // The blades were cupped hard enough to curl into pods and carried the
      // section's full specular, so foliage came out as a row of inflated
      // glossy pillows — the single least plant-like thing left in the scene.
      // Roughening the surface for foliage costs nothing structurally and is
      // what actually separates a leaf from a petal at a glance.
      const FOLIAGE = new Set(['leaf', 'heart', 'lobed', 'strap', 'fan', 'frond', 'trefoil']);
      const leafSurf = FOLIAGE.has(n.kind)
        ? [Math.min(1, bloomSurf[0] + (matId >= 40 ? 0 : 0.26)), bloomSurf[1], bloomSurf[2], bloomSurf[3]]
        : bloomSurf;

      // A leaf pales and yellows towards the edge, where the blade is thinnest,
      // and is deepest where it joins the stalk. A petal does the opposite: the
      // base is the unpigmented part, and the colour gathers towards the tip.
      const leafBase = [brgb[0] * 0.72, brgb[1] * 0.80, brgb[2] * 0.66];
      const leafEdge = [
        Math.min(1, brgb[0] * 1.24 + 0.05),
        Math.min(1, brgb[1] * 1.20 + 0.06),
        Math.min(1, brgb[2] * 0.92 + 0.03),
      ];
      const petalBase = [
        Math.min(1, brgb[0] * 0.70 + 0.34),
        Math.min(1, brgb[1] * 0.74 + 0.32),
        Math.min(1, brgb[2] * 0.62 + 0.18),
      ];

      /**
       * Secondary veins, leaving the midrib at forty-five degrees.
       *
       * A blade with a rib down the middle and nothing else is a shape; the
       * branching is what the eye actually uses to read it as a leaf. They run
       * at the same angle the stems do, which keeps the lattice honest all the
       * way out to the smallest part on the plant.
       */
      const veins = (from, len, halfWidth) => {
        const pairs = 5;
        for (let i = 0; i < pairs; i++) {
          const t = 0.18 + (i / pairs) * 0.66;
          const at = [
            from[0] + stemDir[0] * t * len,
            from[1] + stemDir[1] * t * len,
            from[2] + stemDir[2] * t * len,
          ];
          const reach = halfWidth * (0.92 - t * 0.55);
          for (const sd of [-1, 1]) {
            let dir = [
              (stemDir[0] + sd * sideDir[0]) * 0.7071,
              (stemDir[1] + sd * sideDir[1]) * 0.7071,
              (stemDir[2] + sd * sideDir[2]) * 0.7071,
            ];
            const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
            dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
            tube(mb, [
              { x: at[0], y: at[1], z: at[2], r: n.size * 0.016 },
              { x: at[0] + dir[0] * reach, y: at[1] + dir[1] * reach,
                z: at[2] + dir[2] * reach, r: n.size * 0.005 },
            ], 5, () => [brgb[0] * 0.88, brgb[1] * 0.92, brgb[2] * 0.84], () => leafSurf);
          }
        }
      };

      /** The midrib, which every broad leaf has and none of these did. */
      const midrib = (from, len, wide) => {
        const path = [];
        for (let i = 0; i <= 5; i++) {
          const t = i / 5;
          path.push({
            x: from[0] + stemDir[0] * t * len,
            y: from[1] + stemDir[1] * t * len,
            z: from[2] + stemDir[2] * t * len,
            r: wide * (1 - t * 0.85),
          });
        }
        tube(mb, path, 6,
          () => [brgb[0] * 0.86, brgb[1] * 0.88, brgb[2] * 0.84], () => leafSurf);
      };

      /**
       * The stalk a leaf is held by, and where the blade then starts.
       *
       * Every leaf here grew straight out of the wood with no petiole at all,
       * which is the same fault the floating berries had: a part attached to
       * nothing. Almost no leaf does that — the ones that do are called sessile
       * and are the exception worth having as an exception.
       */
      const stalkR = n.size * 0.034;
      pendingPart = { v0: mb.vertexCount, n, z, rgb, surf: stalkSurf, stalkR };
      const petiole = (frac) => {
        const len = n.size * frac;
        const tip = [
          n.x + stemDir[0] * len, n.y + stemDir[1] * len, z + stemDir[2] * len,
        ];
        tube(mb, [
          { x: n.x, y: n.y, z, r: stalkR * 1.3 },
          { x: tip[0], y: tip[1], z: tip[2], r: stalkR },
        ], 7, () => rgb, () => stalkSurf);
        return tip;
      };
      // Where a stalk becomes a flower: a small cup in the stem's colour, the
      // calyx, which is what makes a head look grown from its stalk.
      const calyx = (at) => {
        sphere(mb, at[0], at[1], at[2], n.size * 0.085, 7, 9, rgb, stalkSurf);
      };

      // The head's own orientation in space. Turned towards the viewer, give or
      // take: heads that faced every which way — some straight up, some away —
      // showed the side of a flower or the back of one, a different thing lit
      // than printed. Facing out, a head is the same flower in both looks.
      const tilt = ((n.seed >> 3) % 1000) / 1000;
      const spin = (((n.seed >> 13) % 1000) / 1000 - 0.5) * 1.1;
      const face = pressed
        ? rot([0, 0, 1], [1, 0, 0], -0.10 - tilt * 0.18)
        : rot(rot([0, 0, 1], [0, 1, 0], spin), [1, 0, 0], -0.22 - tilt * 0.45);
      const stemDir = [Math.sin(n.angle), Math.cos(n.angle), 0];
      const sideDir = [-stemDir[1], stemDir[0], 0];

      if (n.kind === 'globe') {
        // The pedicel, and a stalk to each fruit.
        //
        // The cluster is built around a centre set a whole node-size above the
        // stem, so without these the berries simply hung in the air next to the
        // plant with nothing joining them to it — which is the one thing that
        // never happens on a real one. Every fruit is held by something.
        const hub = [n.x + stemDir[0] * n.size * 0.55,
          n.y + stemDir[1] * n.size * 0.55, z + stemDir[2] * n.size * 0.2];
        tube(mb, [
          { x: n.x, y: n.y, z, r: stalkR * 1.3 },
          { x: hub[0], y: hub[1], z: hub[2], r: stalkR },
        ], 7, () => rgb, () => stalkSurf);

        // The outline lays the cluster out across and along the head; placed
        // on the world's own axes instead, it sat round the joint whichever way
        // the head pointed, and half of it on the stem.
        const at = (b) => [n.x + sideDir[0] * b.x + stemDir[0] * b.y,
          n.y + sideDir[1] * b.x + stemDir[1] * b.y];
        for (const part of parts) {
          if (!part.sphere) continue;
          const b = part.sphere;
          const [bx, by] = at(b);
          const bz = z + (b.depth - 0.5) * n.size * 0.9;
          tube(mb, [
            { x: hub[0], y: hub[1], z: hub[2], r: stalkR * 0.8 },
            { x: bx, y: by, z: bz, r: stalkR * 0.6 },
          ], 6, () => rgb, () => stalkSurf);
        }

        for (const part of parts) {
          if (!part.sphere) continue;
          const s = part.sphere;
          const [sx, sy] = at(s);
          sphere(mb, sx, sy, z + (s.depth - 0.5) * n.size * 0.9,
            s.r, 9, 12, brgb, bloomSurf, null);
        }
        continue;
      }

      // A spike is a dense head of tiny florets packed round a stalk — a
      // bulrush, a plantain, a grass in seed. It was a flat blade, which is a
      // leaf shape, and read as one: the thing that makes a spike a spike is
      // that it is round and packed, and it stands on its own bare stem.
      if (n.kind === 'spike') {
        const bare = petiole(0.55);
        calyx(bare);
        const len = n.size * 2.3;
        const path = [];
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          path.push({
            x: bare[0] + stemDir[0] * t * len,
            y: bare[1] + stemDir[1] * t * len,
            z: bare[2] + stemDir[2] * t * len,
            // fattest a third of the way up, blunt at the top
            r: Math.sin(Math.pow(t, 0.55) * Math.PI) * n.size * 0.185 + n.size * 0.025,
          });
        }
        tube(mb, path, 14, () => brgb, () => bloomSurf,
          (u, ang) => Math.sin(ang * 7 + u * 1.4) * n.size * 0.022);
        continue;
      }

      // A bell hangs, and it is one fused tube with a flared mouth — a
      // foxglove, a campanula. It had no builder of its own, so it fell through
      // to the petal code and came out as a ring of separate petals radiating
      // from a point, which is the one shape a bell is not.
      if (n.kind === 'bell') {
        // Off to whichever side of the stalk is lower, bending over from it:
        // it used to drop straight down, which for a stalk pointing up is
        // straight back down its own stalk and onto the stem it came from.
        const low = sideDir[1] <= 0 ? 1 : -1;
        let hang = [
          stemDir[0] * 0.55 + sideDir[0] * low * 0.84,
          stemDir[1] * 0.55 + sideDir[1] * low * 0.84,
          0,
        ];
        const hl = Math.hypot(hang[0], hang[1], hang[2]) || 1;
        hang = [hang[0] / hl, hang[1] / hl, hang[2] / hl];
        const neck = petiole(0.42);
        calyx(neck);
        const len = n.size * 1.15;
        const path = [];
        for (let i = 0; i <= 10; i++) {
          const t = i / 10;
          path.push({
            x: neck[0] + hang[0] * t * len,
            y: neck[1] + hang[1] * t * len,
            z: neck[2] + hang[2] * t * len,
            // narrow where it joins, opening to the lip
            r: n.size * (0.07 + Math.pow(t, 1.7) * 0.34),
          });
        }
        tube(mb, path, 14, () => brgb, () => bloomSurf);
        continue;
      }

      if (n.kind === 'leaf') {
        const base = petiole(0.30);
        blade(mb, {
          origin: base, dir: stemDir, side: sideDir,
          len: n.size * 2.0, width: n.size * 0.52, cup: 0.20, sweep: 0.26,
          tipTaper: 0.45, albedo: brgb, baseAlbedo: leafBase, edgeAlbedo: leafEdge,
          params: leafSurf, rows: 14, cols: 9, ripple: 0.28,
        });
        midrib(base, n.size * 1.9, n.size * 0.030);
        veins(base, n.size * 1.9, n.size * 0.50);
        continue;
      }

      // A tuft or whorl: blades from one point, bearings held to the eighths of
      // a turn so the head is built on the same lattice as the stems carrying
      // it. This is the reference's discipline applied above the wood as well
      // as in it.
      if (n.kind === 'needle' || n.kind === 'star' || n.kind === 'umbel') {
        const arms = n.kind === 'star' ? 8 : 6;
        // Kept short and broad enough to read as parts of a plant. Thin long
        // spokes came out as sparks rather than as needles or petals.
        const long = n.kind === 'needle' ? 1.15 : n.kind === 'star' ? 1.05 : 0.85;
        const wide = n.kind === 'needle' ? 0.15 : n.kind === 'star' ? 0.26 : 0.055;
        for (let i = 0; i < arms; i++) {
          const a = (i / 8) * Math.PI * 2;
          let dir = rot(stemDir, face, a);
          if (n.kind === 'needle') {
            dir = [
              dir[0] * 0.55 + stemDir[0] * 0.85,
              dir[1] * 0.55 + stemDir[1] * 0.85,
              dir[2] * 0.55 + stemDir[2] * 0.85,
            ];
            const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
            dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
          }
          const sd = cross3(face, dir);
          const len = n.size * long * (0.82 + ((n.seed >> (i % 10)) % 5) * 0.07);
          blade(mb, {
            origin: [n.x, n.y, z], dir, side: sd,
            len, width: n.size * wide, cup: 0.5, sweep: n.kind === 'umbel' ? 0.05 : 0.16,
            tipTaper: n.kind === 'star' ? 0.25 : 0.12,
            albedo: brgb, params: bloomSurf, rows: 8, cols: 4, ripple: 0.1,
          });
          // an umbel carries a little head of florets at the end of each stalk
          if (n.kind === 'umbel') {
            const tipP = [n.x + dir[0] * len, n.y + dir[1] * len, z + dir[2] * len];
            for (let f = 0; f < 6; f++) {
              const fa = (f / 6) * Math.PI * 2;
              sphere(mb,
                tipP[0] + Math.cos(fa) * n.size * 0.11,
                tipP[1] + Math.sin(fa) * n.size * 0.08,
                tipP[2] + Math.sin(fa * 1.7) * n.size * 0.07,
                n.size * 0.13, 5, 7, brgb, bloomSurf);
            }
          }
        }
        continue;
      }

      // A frond: leaflets paired along a rachis, each leaving it at 45 degrees.
      if (n.kind === 'frond') {
        const len = n.size * 2.1;
        const rachis = [];
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          rachis.push({
            x: n.x + stemDir[0] * t * len,
            y: n.y + stemDir[1] * t * len,
            z: z + stemDir[2] * t * len,
            r: n.size * 0.055 * (1 - t * 0.6),
          });
        }
        tube(mb, rachis, 6, () => brgb, () => surf);
        const pairs = 5;
        for (let i = 0; i < pairs; i++) {
          const t = 0.16 + (i / pairs) * 0.78;
          const base = [
            n.x + stemDir[0] * t * len, n.y + stemDir[1] * t * len, z + stemDir[2] * t * len,
          ];
          for (const side of [-1, 1]) {
            // exactly 45 degrees off the rachis, both ways
            let dir = [
              (stemDir[0] + side * sideDir[0]) * 0.7071,
              (stemDir[1] + side * sideDir[1]) * 0.7071,
              (stemDir[2] + side * sideDir[2]) * 0.7071,
            ];
            const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
            dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
            blade(mb, {
              origin: base, dir, side: cross3(face, dir),
              len: n.size * (0.72 - t * 0.32), width: n.size * 0.17,
              cup: 0.4, sweep: 0.2, tipTaper: 0.45,
              albedo: brgb, params: leafSurf, rows: 6, cols: 5, ripple: 0.2,
            });
          }
        }
        continue;
      }

      // Single blades, each a different proportion of the same surface. Without
      // their own case these fell through to the petal builder, which measures a
      // petal's reach from the head's hub — and for one body part the hub *is*
      // that body's centroid, so the reach came out at zero and every one of
      // them rendered as a sliver.
      const BLADES = {
        heart: { len: 1.55, width: 0.60, cup: 0.16, sweep: 0.22, taper: 1.15, ripple: 0.20 },
        lobed: { len: 1.80, width: 0.44, cup: 0.20, sweep: 0.26, taper: 0.62, ripple: 0.80 },
        strap: { len: 2.90, width: 0.13, cup: 0.34, sweep: 0.38, taper: 0.30, ripple: 0.28 },
      };
      if (BLADES[n.kind]) {
        const b = BLADES[n.kind];
        const base = petiole(n.kind === 'strap' ? 0.20 : 0.34);
        blade(mb, {
          origin: base, dir: stemDir, side: sideDir,
          len: n.size * b.len, width: n.size * b.width,
          cup: b.cup, sweep: b.sweep, tipTaper: b.taper,
          albedo: brgb, baseAlbedo: leafBase, edgeAlbedo: leafEdge,
          params: leafSurf, rows: 14, cols: 9, ripple: b.ripple,
        });
        if (n.kind !== 'strap') {
          midrib(base, n.size * b.len * 0.92, n.size * 0.028);
          veins(base, n.size * b.len * 0.92, n.size * b.width * 0.95);
        }
        continue;
      }

      // A trefoil: three leaflets on a short stalk, the outer two at 45 degrees.
      if (n.kind === 'trefoil') {
        const stalk = n.size * 0.55;
        const base = [
          n.x + stemDir[0] * stalk, n.y + stemDir[1] * stalk, z + stemDir[2] * stalk,
        ];
        tube(mb, [
          { x: n.x, y: n.y, z, r: n.size * 0.045 },
          { x: base[0], y: base[1], z: base[2], r: n.size * 0.038 },
        ], 6, () => brgb, () => surf);
        for (const side of [-1, 0, 1]) {
          let dir = side === 0 ? stemDir : [
            (stemDir[0] + side * sideDir[0]) * 0.7071,
            (stemDir[1] + side * sideDir[1]) * 0.7071,
            (stemDir[2] + side * sideDir[2]) * 0.7071,
          ];
          const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
          dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
          blade(mb, {
            origin: base, dir, side: cross3(face, dir),
            len: n.size * (side === 0 ? 0.95 : 0.82), width: n.size * 0.30,
            cup: 0.40, sweep: 0.24, tipTaper: 1.15,
            albedo: brgb, params: leafSurf, rows: 8, cols: 7, ripple: 0.20,
          });
        }
        continue;
      }

      // The sharp kinds. Everything else here is built from curved surfaces;
      // these keep the corners they were drawn with, which is the whole point
      // of having them — a plant that grows these does not read the same as one
      // that grows hearts and bells.
      if (n.kind === 'saw' || n.kind === 'arrow') {
        const base = petiole(n.kind === 'arrow' ? 0.22 : 0.28);
        const body = parts.find((p) => p.role === 'body');
        if (body) {
          sheet(mb, {
            pts: body.points, origin: base, dir: stemDir, side: sideDir,
            lift: n.size * 0.012, albedo: brgb, params: leafSurf,
          });
          if (n.kind === 'saw') midrib(base, n.size * 1.8, n.size * 0.026);
        }
        continue;
      }

      if (n.kind === 'burr') {
        const stalk = petiole(0.30);
        calyx(stalk);
        const cy = n.size * 0.52;
        const core = [
          stalk[0] + stemDir[0] * cy, stalk[1] + stemDir[1] * cy, stalk[2] + stemDir[2] * cy,
        ];
        sphere(mb, core[0], core[1], core[2], n.size * 0.34, 9, 12, brgb, bloomSurf, null);
        // spines on the eighths, in and out of the plane so it reads as a ball
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const tilt = ((i % 3) - 1) * 0.7;
          let dir = rot(rot(stemDir, face, a), sideDir, tilt);
          const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
          dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
          const len = n.size * (0.30 + ((n.seed >> (i % 9)) % 5) * 0.045);
          tube(mb, [
            { x: core[0] + dir[0] * n.size * 0.28,
              y: core[1] + dir[1] * n.size * 0.28,
              z: core[2] + dir[2] * n.size * 0.28, r: n.size * 0.045 },
            { x: core[0] + dir[0] * (n.size * 0.28 + len),
              y: core[1] + dir[1] * (n.size * 0.28 + len),
              z: core[2] + dir[2] * (n.size * 0.28 + len), r: n.size * 0.004 },
          ], 5, () => brgb, () => bloomSurf);
        }
        continue;
      }

      // An allium: a globe made of separate florets, not one surface. Lily and
      // pansy are left to the petal builder, which is what it is for.
      if (n.kind === 'allium') {
        const stalk = petiole(0.40);
        calyx(stalk);
        const r = n.size * 0.46;
        const hub = [
          stalk[0] + stemDir[0] * r, stalk[1] + stemDir[1] * r, stalk[2] + stemDir[2] * r,
        ];
        const golden = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < 30; i++) {
          // an even spread over the sphere, not over a disc
          const y = 1 - (i / 29) * 2;
          const rad = Math.sqrt(Math.max(0, 1 - y * y));
          const th = i * golden;
          const p = [Math.cos(th) * rad, y, Math.sin(th) * rad];
          sphere(mb,
            hub[0] + p[0] * r, hub[1] + p[1] * r, hub[2] + p[2] * r,
            n.size * 0.085, 5, 7, brgb, bloomSurf);
        }
        continue;
      }

      // A drumstick: one small head on a long bare stalk, and nothing between.
      if (n.kind === 'drumstick') {
        const stalk = petiole(1.25);
        calyx(stalk);
        sphere(mb, stalk[0], stalk[1], stalk[2], n.size * 0.26, 10, 12, brgb, bloomSurf, null);
        continue;
      }

      // A cactus: a ribbed column, spined along every ridge.
      if (n.kind === 'cactus') {
        const len = n.size * 1.6;
        const ribs = 7;
        const path = [];
        for (let i = 0; i <= 10; i++) {
          const t = i / 10;
          path.push({
            x: n.x + stemDir[0] * t * len,
            y: n.y + stemDir[1] * t * len,
            z: z + stemDir[2] * t * len,
            r: n.size * (0.20 + Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.14),
          });
        }
        tube(mb, path, 20, () => brgb, () => bloomSurf,
          (u, ang, p) => Math.cos(ang * ribs) * p.r * 0.16);
        // areoles: a spine on each ridge, a few times up the column
        for (let k = 1; k <= 4; k++) {
          const t = k / 5;
          const at = [
            n.x + stemDir[0] * t * len, n.y + stemDir[1] * t * len, z + stemDir[2] * t * len,
          ];
          const rr = n.size * (0.20 + Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.14);
          for (let i = 0; i < ribs; i++) {
            const a = (i / ribs) * Math.PI * 2;
            let dir = rot(stemDir, face, a);
            const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
            dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
            const sp = n.size * 0.20;
            tube(mb, [
              { x: at[0] + dir[0] * rr, y: at[1] + dir[1] * rr, z: at[2] + dir[2] * rr,
                r: n.size * 0.022 },
              { x: at[0] + dir[0] * (rr + sp), y: at[1] + dir[1] * (rr + sp),
                z: at[2] + dir[2] * (rr + sp), r: n.size * 0.003 },
            ], 4, () => [brgb[0] * 1.3 + 0.10, brgb[1] * 1.2 + 0.10, brgb[2] * 1.1 + 0.08],
              () => bloomSurf);
          }
        }
        continue;
      }

      // The plain flowers. Each is one clean form on a stalk, built directly
      // rather than assembled out of petals — that is what makes them plain.
      if (n.kind === 'button') {
        const stalk = petiole(0.34);
        calyx(stalk);
        const r = n.size * 0.52;
        const face2 = [face[0], face[1], face[2]];
        const seat = [
          stalk[0] + face2[0] * r * 0.18,
          stalk[1] + face2[1] * r * 0.18,
          stalk[2] + face2[2] * r * 0.18,
        ];
        // a disc, not a ball: flattened hard along the way it faces
        blade(mb, {
          origin: seat, dir: stemDir, side: sideDir,
          len: r * 1.9, width: r * 1.9, cup: 0.10, sweep: 0.0,
          tipTaper: 1.9, albedo: brgb, params: bloomSurf, rows: 10, cols: 14, ripple: 0.06,
        });
        sphere(mb,
          seat[0] + face2[0] * r * 0.30 + stemDir[0] * r * 0.95,
          seat[1] + face2[1] * r * 0.30 + stemDir[1] * r * 0.95,
          seat[2] + face2[2] * r * 0.30, r * 0.30, 8, 10, eye, bloomSurf);
        continue;
      }

      if (n.kind === 'trumpet') {
        const stalk = petiole(0.30);
        calyx(stalk);
        const len = n.size * 1.2;
        const path = [];
        for (let i = 0; i <= 10; i++) {
          const t = i / 10;
          path.push({
            x: stalk[0] + stemDir[0] * t * len,
            y: stalk[1] + stemDir[1] * t * len,
            z: stalk[2] + stemDir[2] * t * len,
            r: n.size * (0.05 + Math.pow(t, 1.6) * 0.42),
          });
        }
        tube(mb, path, 14, () => brgb, () => bloomSurf);
        continue;
      }

      if (n.kind === 'pom') {
        const stalk = petiole(0.32);
        calyx(stalk);
        const hub = [
          stalk[0] + stemDir[0] * n.size * 0.30,
          stalk[1] + stemDir[1] * n.size * 0.30,
          stalk[2] + stemDir[2] * n.size * 0.30,
        ];
        sphere(mb, hub[0], hub[1], hub[2], n.size * 0.10, 6, 8, brgb, bloomSurf);
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const tilt = ((i % 4) - 1.5) * 0.55;
          let dir = rot(rot(stemDir, face, a), sideDir, tilt);
          const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
          dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
          const len = n.size * 0.78;
          tube(mb, [
            { x: hub[0], y: hub[1], z: hub[2], r: n.size * 0.030 },
            { x: hub[0] + dir[0] * len, y: hub[1] + dir[1] * len, z: hub[2] + dir[2] * len,
              r: n.size * 0.012 },
          ], 5, () => brgb, () => bloomSurf);
        }
        continue;
      }

      // A fan, and a pod: one surface and one closed capsule.
      if (n.kind === 'fan') {
        blade(mb, {
          origin: petiole(0.46), dir: stemDir, side: sideDir,
          len: n.size * 1.45, width: n.size * 0.95, cup: 0.24, sweep: 0.16,
          tipTaper: 1.5, albedo: brgb, params: leafSurf, rows: 10, cols: 14, ripple: 0.26,
        });
        continue;
      }

      if (n.kind === 'pod') {
        const stalk = petiole(0.34);
        calyx(stalk);
        const len = n.size * 1.7;
        const path = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          path.push({
            x: stalk[0] + stemDir[0] * t * len,
            y: stalk[1] + stemDir[1] * t * len,
            z: stalk[2] + stemDir[2] * t * len,
            r: Math.sin(Math.pow(t, 0.8) * Math.PI) * n.size * 0.30 + n.size * 0.02,
          });
        }
        tube(mb, path, 12, () => brgb, () => bloomSurf);
        continue;
      }

      // Petal-bearing heads.
      //
      // The outlines build a flower around a centre set above its node — a disc
      // puts its petals in a ring at y = size * 0.95 — but every petal's bearing
      // was being measured from the origin instead of from that centre. From far
      // enough below, a ring of petals all lie in almost the same direction, so
      // atan2 returned nearly the same angle for all of them and the head came
      // out as a bunch of petals crumpled to one side rather than a flower. The
      // hub has to be found first, and everything placed relative to it.
      const petals = parts.filter((p) => p.role === 'petal' || p.role === 'body');
      const centroid = (pts) => {
        let ax = 0;
        let ay = 0;
        for (const q of pts) { ax += q.x; ay += q.y; }
        return [ax / pts.length, ay / pts.length];
      };
      const calyxPart = parts.find((p) => p.role === 'calyx');
      let hub = [0, 0];
      if (calyxPart) {
        hub = centroid(calyxPart.points);
      } else if (petals.length) {
        const cs = petals.map((p) => centroid(p.points));
        hub = [
          cs.reduce((a, c) => a + c[0], 0) / cs.length,
          cs.reduce((a, c) => a + c[1], 0) / cs.length,
        ];
      }
      // the head sits that far up the stem from the node it grows on
      const hubUp = Math.hypot(hub[0], hub[1]);
      const head = [
        n.x + stemDir[0] * hubUp,
        n.y + stemDir[1] * hubUp,
        z + stemDir[2] * hubUp,
      ];

      // the same for a flower: the outlines put the head above its node, so it
      // needs the short stalk that actually carries it
      if (hubUp > n.size * 0.12) {
        tube(mb, [
          { x: n.x, y: n.y, z, r: stalkR * 1.3 },
          { x: head[0], y: head[1], z: head[2], r: stalkR },
        ], 7, () => rgb, () => stalkSurf);
      }

      petals.forEach((p, i) => {
        const [pcx, pcy] = centroid(p.points);
        const cx = pcx - hub[0];
        const cy = pcy - hub[1];
        const reach = Math.hypot(cx, cy) || 1;
        const around = Math.atan2(cx, cy);

        // radiate about the face normal
        let dir = rot(stemDir, face, around);
        dir = [
          dir[0] * 0.72 + face[0] * 0.68,
          dir[1] * 0.72 + face[1] * 0.68,
          dir[2] * 0.72 + face[2] * 0.68,
        ];
        const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
        const sd = [
          face[1] * dir[2] - face[2] * dir[1],
          face[2] * dir[0] - face[0] * dir[2],
          face[0] * dir[1] - face[1] * dir[0],
        ];
        const sl = Math.hypot(sd[0], sd[1], sd[2]) || 1;

        blade(mb, {
          origin: [
            head[0] + face[0] * n.size * 0.16,
            head[1] + face[1] * n.size * 0.16,
            head[2] + face[2] * n.size * 0.16,
          ],
          dir,
          side: [sd[0] / sl, sd[1] / sl, sd[2] / sl],
          // reach is to the petal's middle, so the petal is about twice that
          len: reach * 2.0,
          width: n.size * (0.30 + ((n.seed >> (i % 8)) % 7) * 0.030),
          // A petal is a sheet, not a shell. Cupped as hard as these were they
          // curled into thick scoops and a head came out looking armoured.
          cup: 0.16, sweep: 0.20 + (i % 3) * 0.06,
          tipTaper: 0.80, albedo: brgb, baseAlbedo: petalBase, params: bloomSurf,
          rows: 10, cols: 7, ripple: 0.22,
        });
      });

      // the floret head at the centre of a composite flower
      // the floret head at the centre of a composite flower, laid out in the
      // flower's own plane rather than pasted onto the node
      const florets = parts.filter((p) => p.role === 'floret');
      for (const f of florets) {
        const fs2 = f.sphere;
        const ox = fs2.x - hub[0];
        const oy = fs2.y - hub[1];
        sphere(mb,
          head[0] + sideDir[0] * ox + stemDir[0] * oy,
          head[1] + sideDir[1] * ox + stemDir[1] * oy,
          head[2] + face[2] * fs2.r,
          fs2.r * 1.1, 5, 6, eye, bloomSurf);
      }
      // the receptacle, where the petals actually attach: every head has one,
      // in the stem's colour, so the petals come out of the stalk rather than
      // off the end of it
      sphere(mb, head[0], head[1], head[2], n.size * (calyxPart ? 0.20 : 0.12), 7, 9, rgb, stalkSurf);
    }
    carry();
  }

  const built = mb.build();
  if (pressed) pressFlat(built.data);
  return built;
}

/** The studio backdrop, coloured by the environment the camera is in. */
/**
 * Cloud, built rather than painted.
 *
 * Painted into the backdrop it was flat by definition: a gradient with noise on
 * it, sitting behind an organism made of real geometry that catches real light.
 * The two never occupied the same space, and no amount of detail in the paint
 * would have fixed that — the plant is *built* and the sky was *drawn*. These
 * are clusters of real volumes, lit by the same sun, surfaced by the same
 * system, and they sit in the same depth of field as everything else.
 */
// ---------------------------------------------------------------- the world --
//
// It used to be a photographer's cyclorama: a floor sweeping up into a wall a
// few hundred units behind the plant, with ground, haze, cloud, birds and stars
// all painted onto it by the shader. That is why it read flat next to the
// plant — it WAS flat. A painted distance has no parallax, takes no light
// across its form, and cannot be moved through.
//
// So the distance is built, out of the same primitives the plant is built from,
// and lit by the same sun in the same pass. Only the air itself is still a
// gradient, because air really is one.
//
// And it is somewhere. The first version had five abstract grounds — loam,
// sand, shale — which is a texture swatch rather than a place: nothing about
// the shape of the land, nothing standing on it, nothing at the horizon. A
// place is the ground AND what grows there AND what the far edge of it does.

const FAR_Z = -11000;     // how far the built ground runs
const FAR_RING_Z = -70000;  // and the coarse ring beyond it, out under the ranges
const NEAR_Z = 3600;      // the front lip of it, well towards the camera
const SKY_Z = -150000;    // where the atmosphere shell stands

/**
 * The places a game can happen in.
 *
 * Real ones. Not outer space, and not a swatch: each is somewhere you could
 * stand, with its own ground, its own weather at the horizon, and its own
 * things growing or lying on it.
 */
export const PLACES = [
  {
    id: 'field',
    // The illustrated look's inks: sky by day, dusk and night; the ground;
    // and the set everything else is printed from.
    toon: {
      sky: ['#6cb0f2', '#f59aa6', '#1d2356'], ground: '#35b24f',
      inks: [['green', '#35b24f'], ['dark green', '#1f8a3e'], ['lime', '#9fd65a'], ['cream', '#f4ead2'],
        ['lilac', '#b9a3f0'], ['brown', '#7a4a32'], ['pink', '#ff6fa6'], ['yellow', '#ffd93b'],
        ['orange', '#ff8a3d'], ['blue', '#3b5fe6'], ['white', '#fbf7ee'], ['red', '#f0452b']],
    },
    note: 'grass, hedges, open sky',
    ground: [0.24, 0.42, 0.16],
    swell: [520, 110, 18],           // three scales of relief
    props: ['tuft', 'tuft', 'tuft', 'bush', 'tree', 'stone'],
    density: 1.25,
    // [darker, lighter] ends of the grass's range, how many clumps, how tall
    // Held a step back from the fullest green they could be: the grass is the
    // largest thing in the opening shot, and under a curve that keeps colour it
    // went a lime loud enough to compete with the stem.
    grass: { count: 7000, colours: [[0.12, 0.23, 0.07], [0.18, 0.30, 0.09]] },
    // The grade, per place: what the shadows and the highlights lean towards,
    // where black is, and contrast. A field is the neutral one.
    grade: { shadows: [0.98, 1.02, 0.99], lights: [1.02, 1.01, 0.97], black: 0.0, contrast: 1.02 },
    // green hills, higher hills behind, and a range with snow on it
    ridges: [
      { z: -12500, depth: 3000, height: 700, shape: 'round', scale: 5000, colour: [0.07, 0.15, 0.05], leafy: true },
      { z: -21000, depth: 5000, height: 1700, shape: 'round', scale: 7500, colour: [0.07, 0.13, 0.06], leafy: true },
      { z: -36000, depth: 7000, height: 4600, shape: 'sharp', scale: 9000, colour: [0.33, 0.25, 0.62], snow: true },
    ],
    clouds: 1,
  },
  {
    id: 'beach',
    toon: {
      sky: ['#ff8c69', '#ff6f91', '#231d57'], ground: '#f7d98c', far: '#2f5fe6',
      inks: [['sand', '#f7d98c'], ['dark sand', '#e8b85c'], ['sea', '#2f5fe6'], ['shallows', '#5aa4f5'],
        ['foam', '#fbf7ee'], ['lilac', '#b9a3f0'], ['rock', '#7d63c9'], ['driftwood', '#8a5a3a'],
        ['green', '#35b24f'], ['dark green', '#1f8a3e'], ['pink', '#ff6fa6'], ['yellow', '#ffd93b']],
    },
    note: 'sand, then the sea',
    // pale: beach sand is nearly white, and a curve that keeps saturation took
    // the old tan to the orange of a desert
    ground: [0.78, 0.72, 0.58],
    swell: [130, 60, 14],            // beaches are flat; the dunes are behind you
    props: ['stone', 'driftwood', 'tuft'],
    density: 0.5,
    water: -3000,                    // the shoreline, in z
    farLand: [0.025, 0.07, 0.10],    // past the built ground it is all sea
    grade: { shadows: [1.0, 0.99, 0.97], lights: [1.02, 1.0, 0.97], black: 0.0, contrast: 1.0 },
    // a headland running out on one side, and islands far out
    ridges: [
      { z: -9000, depth: 1800, height: 1300, shape: 'sharp', scale: 3200, side: -1, colour: [0.34, 0.26, 0.60] },
      { z: -30000, depth: 4000, height: 2400, shape: 'round', scale: 6500, islands: true,
        colour: [0.08, 0.14, 0.07], leafy: true },
    ],
    clouds: 1,
  },
  {
    id: 'ocean',
    toon: {
      sky: ['#2446b8', '#2a3a9e', '#141a4a'], ground: '#f3dfa6',
      inks: [['deep', '#2446b8'], ['water', '#3a6ee8'], ['light', '#6fb3f7'], ['sand', '#f3dfa6'],
        ['coral', '#ff6fa6'], ['red', '#f0452b'], ['yellow', '#ffd93b'], ['orange', '#ff8a3d'],
        ['green', '#35b24f'], ['dark green', '#1f8a3e'], ['lilac', '#b9a3f0'], ['cream', '#fbf2dd']],
    },
    note: 'under it, on the reef',
    ground: [0.44, 0.40, 0.30],      // pale sand, which is what a reef floor is
    swell: [160, 70, 18],
    props: ['coral', 'coral', 'coral', 'stone', 'weed'],
    // sea grass on the floor, where the kelp was: the kelp stood thousands of
    // units up through the water as long bare stalks nobody could read
    grass: { count: 2600, colours: [[0.05, 0.15, 0.10], [0.10, 0.24, 0.13]], tall: 1.8 },
    density: 1.5,
    // Not a bar with the sea beyond it, and not standing on the surface: under
    // it. The camera is in the water, the surface is a ceiling of light a long
    // way overhead, and the plant grows up towards it through fish and coral.
    underwater: 5200,                // where the surface is
    sun: [-0.28, 0.90, 0.33],        // down through the surface
    grade: { shadows: [0.93, 1.0, 1.05], lights: [0.98, 1.02, 1.03], black: 0.01, contrast: 1.03 },
    // reef walls rising behind, the far one only a shape in the blue
    ridges: [
      { z: -9000, depth: 2500, height: 1400, shape: 'sharp', scale: 3500, colour: [0.30, 0.22, 0.55], ink: '#6fb3f7' },
      { z: -17000, depth: 3500, height: 2800, shape: 'sharp', scale: 5000, colour: [0.26, 0.18, 0.50], ink: '#3a6ee8' },
    ],
    clouds: 0,
  },
  {
    id: 'cave',
    toon: {
      sky: ['#1a1226', '#1a1226', '#140e1e'], ground: '#3b2b52', pool: '#ffd36e',
      // the rock is built grey-brown; pushed purple it prints in the cave's inks
      tint: [1.4, 1.1, 2.4],
      inks: [['dark', '#2b1d3a'], ['rock', '#6a52b8'], ['pale rock', '#9a84e0'], ['floor', '#3b2b52'],
        ['light', '#ffd36e'], ['cream', '#f4ead2'], ['pink', '#ff6fa6'],
        ['green', '#35b24f'], ['teal', '#2fb3a8']],
    },
    note: 'rock on every side',
    ground: [0.105, 0.098, 0.094],
    rockFloor: true,
    swell: [180, 90, 26],
    props: ['stalagmite', 'stone', 'stone'],
    density: 0.9,
    cave: true,
    sun: [-0.16, 0.96, 0.22],        // straight down the shaft
    // cold in the dark and deep in the blacks, warm where the light comes in
    grade: { shadows: [0.91, 0.96, 1.08], lights: [1.05, 1.0, 0.93], black: 0.03, contrast: 1.06 },
    clouds: 0,
  },
  {
    id: 'forest',
    toon: {
      sky: ['#2a3a8a', '#6b3f9e', '#141a44'], ground: '#35b24f',
      inks: [['green', '#35b24f'], ['dark green', '#1f8a3e'], ['lime', '#9fd65a'], ['brown', '#5a2e22'],
        ['pink', '#ff5f9e'], ['yellow', '#f7e04a'], ['orange', '#ff8a3d'], ['blue', '#2f5ee8'],
        ['cream', '#efe6d8'], ['red', '#f0452b'], ['lilac', '#b9a3f0'], ['navy', '#1f2a66']],
    },
    note: 'trunks, moss and mushrooms',
    ground: [0.13, 0.20, 0.09],      // moss and needle litter, in shade
    swell: [280, 120, 22],
    props: ['fern', 'fern', 'moss', 'moss', 'mushroom', 'mushroom', 'log',
      'sapling', 'bush', 'stone'],
    density: 2.0,
    forest: true,
    creatures: true,
    // The air in a wood is lit through leaves, and the distance goes green in it
    // rather than blue. Hazed towards open sky, the far trunks and crowns came
    // out a cold grey-blue that read as fog.
    haze: [0.78, 1.0, 0.70],
    // shade in a wood is green, lit through leaves
    grade: { shadows: [0.94, 1.05, 0.95], lights: [1.02, 1.02, 0.95], black: 0.01, contrast: 1.03 },
    // wooded hills beyond the trees, higher ones, then mountains
    ridges: [
      { z: -34000, depth: 4000, height: 2600, shape: 'round', scale: 6000, colour: [0.05, 0.10, 0.04], leafy: true },
      { z: -44000, depth: 6000, height: 4200, shape: 'round', scale: 8000, colour: [0.05, 0.09, 0.05], leafy: true },
      { z: -58000, depth: 8000, height: 7500, shape: 'sharp', scale: 11000, colour: [0.33, 0.25, 0.62], snow: true },
    ],
    clouds: 0.3,
  },
  {
    id: 'dunes',
    toon: {
      sky: ['#ff9fb8', '#ff7a6b', '#2a1d57'], ground: '#ffd35a',
      inks: [['sand', '#ffd35a'], ['dark sand', '#f2a73e'], ['orange', '#ff8a3d'], ['red', '#f0603a'],
        ['mesa', '#c9452e'], ['green', '#35b24f'], ['dark green', '#1f8a3e'], ['brown', '#8a5a3a'],
        ['cream', '#fbf2dd'], ['pink', '#ff6fa6'], ['lilac', '#b9a3f0']],
    },
    note: 'sand, and more of it',
    ground: [0.84, 0.70, 0.44],
    swell: [620, 150, 16],
    props: ['scrub', 'stone', 'cactus', 'cactus'],
    density: 0.45,
    dunes: true,
    grade: { shadows: [1.02, 0.98, 0.94], lights: [1.06, 1.01, 0.90], black: 0.0, contrast: 1.02 },
    // bigger dunes behind these, bigger still, and mesas at the edge of it all
    ridges: [
      { z: -12500, depth: 3500, height: 1000, shape: 'round', scale: 4200, colour: [0.95, 0.62, 0.12] },
      { z: -22000, depth: 4500, height: 1900, shape: 'round', scale: 6000, colour: [0.85, 0.40, 0.08] },
      { z: -36000, depth: 5000, height: 2700, shape: 'mesa', scale: 7000, colour: [0.62, 0.12, 0.05] },
    ],
    clouds: 0.6,
  },
];

/**
 * Which look the world is built for: 'toon', the illustrated one (v3), or
 * 'real', the lit one it grew out of. The renderer sets it before it builds.
 */
export let STYLE = 'toon';
export function setStyle(s) { STYLE = s === 'real' ? 'real' : 'toon'; }

const placeAt = (kind) => PLACES[((kind % PLACES.length) + PLACES.length) % PLACES.length];

/**
 * The shape of the land.
 *
 * Flat where the plant stands — it must not look perched — and increasingly
 * restless towards the horizon, which is what gives the eye its sense of how
 * far away the horizon is. The eye is twenty-six units up looking at a
 * seedling, so ground reads flat much further out here than feels right on
 * paper, for the same reason it does in life.
 */
/**
 * Where a beach meets its sea: a line that curves gently along the coast.
 *
 * The sand used to carry its ordinary noise right down to the water, and the
 * sea carried its swell right up to the sand, so the two surfaces crossed each
 * other in blotches — a shore of puddles and islands. Now the sand runs down to
 * the water on one even slope, and the sea is calm where it meets it.
 */
function shoreAt(x, place) {
  return place.water + (noise2(x * 0.0004, 3.3, 5) - 0.5) * 700;
}

function groundHeight(x, z, place) {
  const d = Math.hypot(x, z);
  // Level only right at the foot of the plant, and gently undulating from a
  // few hundred units out, before the land gets up to its full height further
  // off. The ground used to be held dead flat for two and a half thousand
  // units all round — so the plant stood on a flat disc of its own, a plain
  // band between the textured land in front of it and behind it, and read as
  // standing on a separate plane from the place it was in.
  const ramp = (a, b) => { const t = clamp01((d - a) / (b - a)); return t * t * (3 - 2 * t); };
  // Except in the lane between the plant and the camera, which is kept low:
  // the eye stands only a hundred or so units up, and a rise there would hide
  // the seedling behind it.
  const aside = clamp01((Math.abs(x) - 250) / 850);
  const lane = z > 0 ? 1 - 0.85 * (1 - aside * aside * (3 - 2 * aside)) * clamp01((z - 200) / 500) : 1;
  const settle = (0.2 * ramp(220, 1000) + 0.8 * ramp(1000, 6500)) * lane;
  const [a, b, c] = place.swell;
  // Which character this stretch of ground has, and it changes as you go.
  const sharpness = clamp01((noise2(x * 0.00016, z * 0.00016, 91) - 0.34) * 3.4);
  const ridged = (f, sc, amp) => {
    const v = noise2(x * sc, z * sc, f);
    return (1 - Math.abs(v * 2 - 1)) * amp - amp * 0.5;   // folded: creases, not swells
  };
  const round = (f, sc, amp) => (noise2(x * sc, z * sc, f) - 0.5) * 2 * amp;
  const mixed = (f, sc, amp) => lerp(round(f, sc, amp), ridged(f, sc, amp * 1.5), sharpness);
  let h = mixed(31, 0.00030, a);
  h += mixed(77, 0.0011, b);
  h += mixed(13, 0.0044, c);
  if (place.dunes) {                        // long, and one-sided
    h += Math.sin(x * 0.0008 + noise2(z * 0.0006, 0, 5) * 3.0) * 150;
  }
  if (place.seabed !== undefined) {
    // Open water: there is no shore to walk down, the floor is simply a long
    // way under everything, and it stays under. The plant is standing in the
    // sea rather than next to it.
    return place.seabed + h * 0.5;
  }
  if (place.water !== undefined) {
    // The ground goes down to meet the water rather than stopping at it, and
    // keeps going: a shore is a slope, and a sea floor that levels off at the
    // waterline is a swimming pool.
    const into = clamp01((place.water - z) / 2600);
    h = h * (1 - into) - into * into * 900;
    // and across the waterline itself, one even slope into the sea
    const shore = shoreAt(x, place);
    const near = clamp01(1 - Math.abs(z - shore) / 1600);
    return lerp(h * settle, (z - shore) * 0.045, near * near * (3 - 2 * near));
  }
  return h * settle;
}

/**
 * Ranges beyond the ground.
 *
 * Every place was one band at the horizon: the ground swelled a little and
 * stopped, and behind it was sky — a backdrop with one depth to it, which is
 * what read as flat. Land at a distance comes in layers: the near hills, the
 * higher ones behind them, and a range beyond those, each hazier and bluer
 * than the one in front. That stack is most of what tells the eye how deep a
 * view is, and it is cheap — a strip of land per layer, a few thousand
 * vertices for the lot, in the distant materials rather than the ground's.
 *
 * Each has a back slope, so from up in the air it is still a hill and not a
 * wall; and a foot below the ground, so it rises out of the land rather than
 * standing on it.
 *
 *   z, depth     where the crest runs, and how far its front slope reaches
 *   height       how high the crest stands, at its highest
 *   shape        'round' hills, 'sharp' peaks, 'mesa' flat tops
 *   scale        how wide one rise is, in world units
 *   side         -1 or 1: only on that side (a headland, not a range)
 *   islands      its low stretches sink below the water
 *   leafy        wooded, in the distant-leaf material; otherwise rock
 *   snow         pale above four fifths of its height
 *   ink          printed, the colour it is laid down in instead (hex)
 */
function buildRidges(mb, place) {
  if (!place.ridges) return;
  const rock = [SURFACE.scenery[0], SURFACE.scenery[1], SURFACE.scenery[2], MAT_ID.scenery];
  const leafy = [SURFACE.thicket[0], SURFACE.thicket[1], SURFACE.thicket[2], MAT_ID.thicket];
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  // front foot, up the face, the crest, and down the back
  const ROWS = [0, 0.3, 0.55, 0.78, 0.92, 1.0, 1.35, 2.0];
  place.ridges.forEach((rd, li) => {
    const surf = rd.leafy ? leafy : rock;
    const half = Math.abs(rd.z) * 1.2 + 10000;
    const cols = 140;
    const crest = (x) => {
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
    const grid = [];
    for (const t of ROWS) {
      const z = t <= 1 ? rd.z + rd.depth * (1 - t) : rd.z - rd.depth * 0.8 * (t - 1);
      const lift = t <= 1 ? Math.sin(t * Math.PI / 2) ** 1.4 : Math.cos((t - 1) * Math.PI / 2) ** 1.2;
      const row = [];
      for (let j = 0; j <= cols; j++) {
        const x = (j / cols - 0.5) * half * 2;
        const h = crest(x);
        // gullies down the face, strongest half way up
        const gully = (noise2(x / 700 + li, t * 3, 5) - 0.5) * Math.abs(h) * 0.12 * Math.sin(Math.min(t, 1) * Math.PI);
        row.push([x, -400 + (h + 400) * lift + gully, z]);
      }
      grid.push(row);
    }
    const base = mb.vertexCount;
    for (let i = 0; i < grid.length; i++) {
      for (let j = 0; j <= cols; j++) {
        const [x, y, z] = grid[i][j];
        // the normal off the neighbours: across the range, and up the slope
        const a = grid[i][Math.max(0, j - 1)];
        const b = grid[i][Math.min(cols, j + 1)];
        const c = grid[Math.max(0, i - 1)][j];
        const d = grid[Math.min(grid.length - 1, i + 1)][j];
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = d[0] - c[0], vy = d[1] - c[1], vz = d[2] - c[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const v = 0.82 + noise2(x / 2200, i * 0.7 + li, 9) * 0.36;
        let col = (STYLE !== 'real' && rd.ink ? linear(rd.ink) : rd.colour).map((k) => k * v);
        if (rd.shape === 'mesa') col = col.map((k) => k * (0.86 + 0.14 * Math.sin(y / 90)));   // strata
        if (rd.snow) {
          const white = smooth(rd.height * 0.72, rd.height * 0.9, y) * smooth(0.25, 0.6, ny);
          col = col.map((k, q) => k + ([0.78, 0.80, 0.84][q] - k) * white);
        }
        mb.push([x, y, z], [nx, ny, nz], col, surf, [x * 0.004, (y - z) * 0.004]);
      }
    }
    for (let i = 0; i < grid.length - 1; i++) {
      for (let j = 0; j < cols; j++) {
        const q = base + i * (cols + 1) + j;
        mb.quad(q, q + 1, q + cols + 2, q + cols + 1);
      }
    }
  });
}

/**
 * The ground as built, anywhere — including out in front, under the camera.
 *
 * Past the front lip of the main ground it carries on as an apron, levelling
 * out: the camera pulls back as far as twenty-odd thousand units when a tall
 * plant is framed whole, and the built ground used to stop at three and a half,
 * so a pulled-back camera stood out beyond the edge of the world looking at the
 * cut end of it from below.
 */
const APRON_Z = 34000;
const apronFade = (z) => 1 - clamp01((z - NEAR_Z) / 4000);
export function groundAt(x, z, place) {
  const h = groundHeight(x, z, place);
  return z > NEAR_Z ? h * apronFade(z) : h;
}

function buildTerrain(mb, spanX, place) {
  const surf = place.rockFloor
    ? [SURFACE.rock[0], SURFACE.rock[1], SURFACE.rock[2], MAT_ID.rock]
    : [SURFACE.terrain[0], SURFACE.terrain[1], SURFACE.terrain[2], MAT_ID.terrain];
  const cols = 128;
  const rows = 80;
  const base = mb.vertexCount;
  const width = Math.max(spanX * 2.6, 26000);
  const tint = place.ground;

  for (let i = 0; i <= rows; i++) {
    // Dense underfoot, sparse towards the horizon: even spacing spends every
    // triangle where nothing is happening and leaves the near ground faceted.
    const t = i / rows;
    const z = NEAR_Z + (FAR_Z - NEAR_Z) * (t * t * 0.86 + t * 0.14);
    for (let j = 0; j <= cols; j++) {
      const u = j / cols - 0.5;
      const x = u * width * (0.6 + Math.abs(z / FAR_Z) * 0.7);
      const y = groundHeight(x, z, place);
      // The normal comes off the height field itself, so light breaks over the
      // land the same way it breaks over a stem.
      const e = 40;
      const nx = groundHeight(x + e, z, place) - groundHeight(x - e, z, place);
      const nz = groundHeight(x, z + e, place) - groundHeight(x, z - e, place);
      const len = Math.hypot(nx, 2 * e, nz) || 1;
      const n = [-nx / len, (2 * e) / len, -nz / len];

      const patch = noise2(x * 0.00055, z * 0.00055, 44);
      const drift = noise2(x * 0.0022, z * 0.0022, 61);
      const mottle = noise2(x * 0.009, z * 0.009, 12);
      // Down in the middle of the range, where a tonemapper leaves it alone.
      //
      // Lit by a sun of four and a half, ground at this albedo landed around one
      // and a half in the linear image — squarely in the curve's shoulder, where
      // everything from one to two comes out between 0.82 and 0.90. The ground
      // read as a pale wash not because it had no texture but because the
      // texture it had was being compressed to a few per cent, and it read as
      // washed out for the same reason: a filmic curve drains colour as it
      // compresses. Real grass has an albedo around a fifth; this puts it there.
      let v = (0.42 + patch * 0.30 + drift * 0.19 + mottle * 0.22) * 0.58;
      const dry = clamp01(patch * 1.3 - 0.15);
      const col = [
        tint[0] * v * (1 + dry * 0.16),
        tint[1] * v * (1 + dry * 0.06),
        tint[2] * v * (1 - dry * 0.12),
      ];
      // Wet sand at the tideline: darker, and it is what makes a shore read as
      // a shore rather than as a blue rectangle laid over a beige one.
      if (place.water !== undefined) {
        const wet = clamp01((place.water + 900 - z) / 1400);
        for (let k = 0; k < 3; k++) col[k] *= 1 - wet * 0.42;
      }
      mb.push([x, y, z], n, col, surf,
        place.rockFloor ? [x * 0.010, z * 0.010] : [x * 0.05, z * 0.05]);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = base + i * (cols + 1) + j;
      mb.quad(a, a + 1, a + cols + 2, a + cols + 1);
    }
  }

  // and the apron out in front, coarse, levelling out; its first row is the
  // main ground's front row exactly, so there is no seam
  const apronRows = 16;
  const apron = mb.vertexCount;
  for (let i = 0; i <= apronRows; i++) {
    const t = i / apronRows;
    const z = NEAR_Z + (APRON_Z - NEAR_Z) * t * t;
    for (let j = 0; j <= cols; j++) {
      const u = j / cols - 0.5;
      const x = u * width * (0.6 + Math.abs(z / FAR_Z) * 0.7);
      const y = groundAt(x, z, place);
      const v = (0.42 + noise2(x * 0.00055, z * 0.00055, 44) * 0.30
        + noise2(x * 0.0022, z * 0.0022, 61) * 0.19 + noise2(x * 0.009, z * 0.009, 12) * 0.22) * 0.58;
      mb.push([x, y, z], [0, 1, 0], [tint[0] * v, tint[1] * v, tint[2] * v], surf,
        place.rockFloor ? [x * 0.010, z * 0.010] : [x * 0.05, z * 0.05]);
    }
  }
  for (let i = 0; i < apronRows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = apron + i * (cols + 1) + j;
      mb.quad(a, a + 1, a + cols + 2, a + cols + 1);
    }
  }

  // And out past the far edge, coarse, as far as the ranges. The ground used
  // to stop eleven thousand units back while trees and hills stood thirty and
  // forty thousand back, and from up in the air there was a band of bare sky
  // under them where the land should have been. Its first row is the main
  // ground's last row exactly.
  const farRows = 30;
  const beyond = mb.vertexCount;
  for (let i = 0; i <= farRows; i++) {
    const t = i / farRows;
    const z = FAR_Z + (FAR_RING_Z - FAR_Z) * t * t;
    for (let j = 0; j <= cols; j++) {
      const u = j / cols - 0.5;
      const x = u * width * (0.6 + Math.abs(z / FAR_Z) * 0.7);
      const y = groundHeight(x, z, place);
      const e = 200;
      const nx = groundHeight(x + e, z, place) - groundHeight(x - e, z, place);
      const nz = groundHeight(x, z + e, place) - groundHeight(x, z - e, place);
      const nl = Math.hypot(nx, 2 * e, nz) || 1;
      const v = (0.42 + noise2(x * 0.00055, z * 0.00055, 44) * 0.30
        + noise2(x * 0.0022, z * 0.0022, 61) * 0.19) * 0.58;
      mb.push([x, y, z], [-nx / nl, (2 * e) / nl, -nz / nl], [tint[0] * v, tint[1] * v, tint[2] * v], surf,
        place.rockFloor ? [x * 0.010, z * 0.010] : [x * 0.05, z * 0.05]);
    }
  }
  for (let i = 0; i < farRows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = beyond + i * (cols + 1) + j;
      mb.quad(a, a + 1, a + cols + 2, a + cols + 1);
    }
  }
}

/**
 * Water.
 *
 * A surface, not a colour: it has to run to its own horizon, take the sun on
 * its swell, and reflect the sky — which it can, now that there is a sky to
 * reflect. Its far edge goes well past the land's so that the sea is the thing
 * the sky meets, which is what you actually see at a coast.
 */
function buildWater(mb, place) {
  const surf = [SURFACE.water[0], SURFACE.water[1], SURFACE.water[2], MAT_ID.water];
  const cols = 96;
  const rows = 60;
  const base = mb.vertexCount;
  const nearZ = place.water + 900;
  const farZ = -46000;
  const width = 120000;

  // the swell dies away towards the shore, so the waterline is a clean line
  // rather than the sea and the sand crossing each other in blotches
  const calm = (x, z) => place.seabed !== undefined ? 1
    : 0.2 + 0.8 * clamp01((shoreAt(x, place) - 200 - z) / 1800);
  const waveAt = (x, z) => (Math.sin(x * 0.0042 + z * 0.0016) * 5
    + Math.sin(x * 0.0011 - z * 0.0037) * 8
    + (noise2(x * 0.0025, z * 0.0025, 23) - 0.5) * 9) * calm(x, z);

  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const z = nearZ + (farZ - nearZ) * (t * t * 0.9 + t * 0.1);
    for (let j = 0; j <= cols; j++) {
      const u = j / cols - 0.5;
      const x = u * width * (0.06 + Math.abs(z / farZ) * 0.94);
      const y = -14 + waveAt(x, z);
      const e = 30;
      const nx = waveAt(x + e, z) - waveAt(x - e, z);
      const nz = waveAt(x, z + e) - waveAt(x, z - e);
      const len = Math.hypot(nx, 2 * e, nz) || 1;
      // Foam where the water is shallow enough to be breaking on the sand —
      // measured against the sand actually under it, so it lies along the real
      // waterline rather than along a straight line in front of it.
      const depth = y - groundHeight(x, z, place);
      const surfy = place.seabed !== undefined ? 0
        : clamp01(1 - depth / 30) * (depth > -8 ? 1 : 0)
          * (0.5 + noise2(x * 0.006, z * 0.006, 9) * 0.9);
      const deep = clamp01(-z / 12000);
      const col = [
        lerp(0.09, 0.03, deep) + surfy * 0.7,
        lerp(0.30, 0.14, deep) + surfy * 0.7,
        lerp(0.40, 0.26, deep) + surfy * 0.7,
      ];
      mb.push([x, y, z], [-nx / len, (2 * e) / len, -nz / len], col, surf,
        [x * 0.05, z * 0.05]);
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
 * Cloud, as volume.
 *
 * Flattish rafts of overlapping spheres — wide, not tall, and heavier
 * underneath, which is the shape that reads as cloud rather than as balls.
 *
 * And a very long way off. The camera looks level with a seventeen degree
 * field, so the visible sky is the eight degrees just above the horizon; cloud
 * placed a few thousand units up and a few thousand out sits at twenty-five
 * degrees and is never in shot at all, which is why the sky had been empty. Real
 * cloud is two kilometres up and tens of kilometres away, and that is exactly
 * why you see it near the horizon rather than overhead.
 */
function buildClouds(mb, place) {
  if (!place.clouds) return;
  const surf = [SURFACE.cloud[0], SURFACE.cloud[1], SURFACE.cloud[2], MAT_ID.cloud];
  const rng = makeRng(4711);
  // More of the near, high ones than of the far: those are the sky the plant
  // climbs into, and with as few as there were most of the way up was empty.
  const banks = Math.round(30 * place.clouds);
  for (let b = 0; b < banks; b++) {
    // Two populations, because there are two ways to see a cloud.
    //
    // From the ground you see the far ones, low on the horizon, because the
    // visible sky is the few degrees above it. But the plant climbs, and it does
    // not stop: at four thousand units up the camera is in the air, the land has
    // dropped out of the frame entirely, and everything there was to look at was
    // a hundred kilometres away and the size of a thumbnail. So there is a
    // second lot, near enough and high enough to be passed — the sky you get
    // into rather than the sky you look at.
    const high = b % 3 !== 0;
    const cz = high ? -2600 - rng.range(0, 20000) : -26000 - rng.range(0, 92000);
    const away = -cz;
    const y = high ? 2200 + rng.range(0, 16000) : away * rng.range(0.045, 0.15);
    const cx = rng.range(-1, 1) * away * (high ? 0.8 : 1.5);
    const scale = high ? 260 + rng.range(0, 900) : away * rng.range(0.008, 0.019);
    const reach = scale * rng.range(2.4, 4.0);

    // Many lumps, radii spread wide, packed closer together than their own
    // radii and kept in nearly one plane: a row of same-sized balls gives an
    // outline with one wavelength in it and the eye names the balls.
    for (let i = 0; i < 24; i++) {
      const t = rng.range(-0.5, 0.5);
      const dome = Math.cos(t * Math.PI) ** 0.7;
      const big = rng.range(0, 1) ** 2.1;
      const r = scale * (0.22 + big * 0.6) * (0.5 + dome * 0.7);
      sphere(mb,
        cx + t * reach + rng.range(-scale * 0.12, scale * 0.12),
        y + dome * scale * rng.range(-0.05, 0.5) + r * 0.35,
        cz + rng.range(-scale * 0.14, scale * 0.14),
        r, 7, 10, [1.0, 1.0, 1.0], surf);
    }
  }
}

/**
 * A cave: the one place with no sky in it.
 *
 * Walls closing in on both sides and a ceiling low overhead, all out of the
 * same rock as the floor — and an opening ahead, which is the whole reason to
 * be in a cave rather than in a box. The sky is still out there; the rock is
 * simply in front of most of it.
 */
function buildCave(mb, place) {
  const surf = [SURFACE.rock[0], SURFACE.rock[1], SURFACE.rock[2], MAT_ID.rock];
  const rng = makeRng(5150);
  const cols = 46;
  // It reaches out past anywhere the camera can stand. It used to end at
  // four thousand units, and a camera pulled back to frame a tall plant stood
  // outside it, looking at the cut edge of the rock.
  const rows = 110;
  const zNear = 32000;
  const zFar = -34000;
  const OPEN = -2600;                        // the roof breaks open above the plant

  // Sized against the lens.
  //
  // A wall running parallel to the view converges towards the vanishing point,
  // so it only enters a seventeen degree frame once it is far enough ahead: at
  // x = 1100 that is ten thousand units. The passage has to be long — tens of
  // thousands of units — for any of it to be visible at all.
  //
  // It does not open onto anything at the far end. A bright doorway is what the
  // eye goes to, and with one there the picture was of standing at an entrance
  // looking out rather than of being in a cave. The rock runs on into the dark
  // in front; the only way out is up.
  const shut = (z) => clamp01((z + 30000) / 9000);
  const halfW = (z) => (1100 + noise2(z * 0.00022, 0, 3) * 520) * shut(z);
  const roof = (z) => (3100 + noise2(z * 0.00031, 9, 4) * 700) * shut(z);

  const base = mb.vertexCount;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const z = zNear + (zFar - zNear) * t;
    const w = halfW(z);
    const h = roof(z);
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * Math.PI;
      // Rock is bedded and broken, not crumpled. The first version stacked three
      // displacements to more than the radius of the passage itself, which folds
      // the wall into something closer to foil than to stone — and then had no
      // surface detail underneath to say what it was made of. The shape is
      // calmer now and the stone happens on the surface, where it belongs.
      const bed = Math.sin(a * 5.0 + noise2(z * 0.0004, 0, 11) * 6.0) * 55;
      const fracture = (noise2(Math.cos(a) * 700, z * 0.0009, 7) - 0.5) * 150;
      const coarse = (noise2(Math.cos(a) * 220, z * 0.00028, 19) - 0.5) * 380;
      const ripple = bed + fracture + coarse;
      const x = -Math.cos(a) * (w + ripple);
      const y = Math.sin(a) * (h + ripple * 0.6) - 300;
      // and it is not one colour: wet streaks under the opening, dry stone away
      // from it, a paler mineral in the bedding
      // Strata: rock is laid down in beds and the beds are different colours.
      // It is the single most recognisable thing about a cut face of stone and
      // costs one sine.
      const strata = Math.sin(y * 0.0042 + noise2(z * 0.0003, 0, 27) * 4.0) * 0.5 + 0.5;
      const streak = clamp01(1 - Math.abs(z - OPEN) / 6000) * clamp01(Math.sin(a) * 1.4);
      const v = 0.62 + noise2(x * 0.0016, z * 0.0016, 21) * 0.55 + strata * 0.34;
      const wet = streak * 0.5;
      mb.push([x, y, z], [Math.cos(a), -Math.sin(a), 0],
        [place.ground[0] * v * (1 - wet * 0.4), place.ground[1] * v * (1 - wet * 0.3),
          place.ground[2] * v * (1 - wet * 0.1)],
        surf, [x * 0.006, y * 0.006]);
    }
  }
  for (let i = 0; i < rows; i++) {
    const z = zNear + (zFar - zNear) * (i / rows);
    for (let j = 0; j < cols; j++) {
      const a = (j / cols) * Math.PI;
      // The one opening: a break in the roof over the plant, which is where the
      // light comes from and the only direction there is to grow.
      if (z > OPEN && z < 3000 && a > 1.19 && a < Math.PI - 1.19) continue;
      const q = base + i * (cols + 1) + j;
      mb.quad(q, q + cols + 1, q + cols + 2, q + 1);
    }
  }

  // ---- what hangs from it ----
  //
  // Three kinds, because one repeated shape is a texture rather than a cave:
  // stalactites in ranks, single long straws, and heavy columns that have met
  // the floor and fused.
  for (let i = 0; i < 90; i++) {
    const z = OPEN - rng.range(0, 24000);
    const w = halfW(z);
    if (w < 200) continue;
    const x = rng.range(-1, 1) * w * 0.8;
    const top = Math.sin(Math.acos(clamp(-x / w, -1, 1))) * roof(z) - 300;
    const roll = rng.range(0, 1);

    if (roll < 0.5) {
      // stalactite: fat at the roof, tapering to a point
      const drop = rng.range(240, 1100);
      const r = drop * rng.range(0.10, 0.18);
      const path = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        path.push({ x: x, y: top - drop * t, z: z, r: r * (1 - t * 0.88) });
      }
      tube(mb, path, 6, () => [0.20, 0.175, 0.155], () => surf);
    } else if (roll < 0.78) {
      // straw: very long, very thin, and nearly parallel-sided
      const drop = rng.range(700, 2400);
      const r = rng.range(14, 34);
      tube(mb, [
        { x: x, y: top, z: z, r: r },
        { x: x + rng.range(-40, 40), y: top - drop, z: z, r: r * 0.55 },
      ], 5, () => [0.30, 0.27, 0.24], () => surf);
    } else {
      // column: roof to floor, thick in the middle where the two have met
      const floorY = groundHeight(x, z, place);
      const span = top - floorY;
      if (span < 400) continue;
      const r = rng.range(70, 220);
      const path = [];
      for (let k = 0; k <= 5; k++) {
        const t = k / 5;
        path.push({
          x: x + Math.sin(t * 3.1) * r * 0.3,
          y: top - span * t,
          z: z,
          r: r * (0.55 + Math.abs(t - 0.5) * 0.9),
        });
      }
      tube(mb, path, 6, () => [0.23, 0.20, 0.175], () => surf);
    }
  }

  // and boulders on the floor, fallen from all that
  for (let i = 0; i < 40; i++) {
    const z = OPEN - rng.range(0, 20000);
    const w = halfW(z);
    if (w < 200) continue;
    const x = rng.range(-1, 1) * w * 0.85;
    if (Math.abs(x) < 260 && z > -1200) continue;
    const y = groundHeight(x, z, place);
    const r = rng.range(60, 260);
    sphereAt(mb, x, y + r * 0.2, z, r, 5, 8, [0.19, 0.17, 0.15], surf,
      (px, py, pz) => (noise2(px * 0.02, pz * 0.02, 8) - 0.5) * r * 0.55
        - Math.max(0, py - y) * 0.5);
  }
}

/**
 * Things standing on the land.
 *
 * Not detail for its own sake — they are the only reason the middle distance
 * has a scale, and they are what slides against the hills as the camera rises.
 * Which of them appear is what makes a field a field and a beach a beach.
 */
function buildScatter(mb, place) {
  const rng = makeRng(2027);
  const clump = (cx, cy, cz, rad, col) => {
    sphereAt(mb, cx, cy, cz, rad, 4, 6, col, bot, lumps(rad, cx * 0.01));
  };
  const stone = [SURFACE.scenery[0], SURFACE.scenery[1], SURFACE.scenery[2], MAT_ID.scenery];
  const bot = [SURFACE.thicket[0], SURFACE.thicket[1], SURFACE.thicket[2], MAT_ID.thicket];
  const frond = [SURFACE.frond[0], SURFACE.frond[1], SURFACE.frond[2], MAT_ID.frond];
  const props = place.props;

  const put = (x, z, r, what) => {
    const y = groundHeight(x, z, place);
    if (place.water !== undefined && z < place.water && y < -30) return;  // under water
    if (what === 'stone') {
      const w = r * rng.range(1.1, 1.9);
      // Round or broken, according to the ground it is lying on — so an
      // outcrop of crags and a scatter of boulders are never mixed together,
      // and crossing from one stretch to the next is something you can see.
      if (clamp01((noise2(x * 0.00016, z * 0.00016, 91) - 0.34) * 3.4) > 0.5) {
        const tall = 0.34 + rng.range(0, 0.3);
        shard(mb, x, y + w * tall * 0.7, z, w,
          (i) => rng.range(-0.55, 0.75) - (i === 3 ? 0.4 : 0)
            - (i === 2 ? 1 - tall * 2.4 : 0), [0.34, 0.32, 0.30], stone);
      } else {
        sphereAt(mb, x, y + r * 0.16, z, w, 4, 6, [0.36, 0.34, 0.31], stone,
          (px, py, pz) => (noise2(px * 0.05, pz * 0.05, 8) - 0.5) * w * 0.45
            - Math.max(0, py - y) * 0.55);
      }
    } else if (what === 'bush' || what === 'scrub') {
      const lobes = what === 'scrub' ? 2 : 3 + Math.floor(rng.range(0, 3));
      const w = r * (what === 'scrub' ? 0.8 : 1.4);
      for (let k = 0; k < lobes; k++) {
        const a = (k / lobes) * Math.PI * 2 + rng.range(0, 1);
        const rad = w * rng.range(0.42, 0.72);
        const bx = x + Math.cos(a) * w * rng.range(0.1, 0.55);
        const by = y + rad * rng.range(0.55, 0.95);
        const bz = z + Math.sin(a) * w * rng.range(0.1, 0.55);
        if (what === 'scrub') sphere(mb, bx, by, bz, rad, 4, 6, [0.34, 0.33, 0.17], bot);
        else clump(bx, by, bz, rad, [0.18, 0.36, 0.10], 36);
      }
    } else if (what === 'tuft') {
      // grass: a few blades leaning off one point, too small to be anything
      // but texture, which is what grass is at any distance at all
      for (let k = 0; k < 4; k++) {
        const a = rng.range(0, Math.PI * 2);
        const h = r * rng.range(1.2, 2.4);
        tube(mb, [
          { x:x, y: y, z: z, r: r * 0.10 },
          { x:x + Math.cos(a) * r * 0.3, y: y + h * 0.6, z: z + Math.sin(a) * r * 0.3, r: r * 0.06 },
          { x:x + Math.cos(a) * r * 0.9, y: y + h, z: z + Math.sin(a) * r * 0.9, r: r * 0.01 },
        ], 4, () => [0.26, 0.44, 0.14], () => bot);
      }
    } else if (what === 'coral') {
      buildCoral(mb, x, y, z, r, rng, bot, stone);
    } else if (what === 'weed') {
      for (let k = 0; k < 4; k++) {
        const a = rng.range(0, Math.PI * 2);
        const h = r * rng.range(4, 9);
        const sway = rng.range(0.3, 0.8);
        tube(mb, [
          { x:x, y: y, z: z, r: r * 0.12 },
          { x:x + Math.cos(a) * h * sway * 0.3, y: y + h * 0.55, z: z + Math.sin(a) * h * sway * 0.3,
            r: r * 0.09 },
          { x:x + Math.cos(a) * h * sway, y: y + h, z: z + Math.sin(a) * h * sway, r: r * 0.03 },
        ], 4, () => [0.20, 0.36, 0.20], () => frond);
      }
    } else if (what === 'mushroom') {
      // In a ring, the way they come up: a cluster of caps on pale stalks, and
      // one of the few things on a forest floor that is not green.
      const n = 3 + Math.floor(rng.range(0, 5));
      const pale = rng.range(0, 1) < 0.4;
      const cap = pale ? [0.72, 0.66, 0.52] : [0.52, 0.20, 0.13];
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, Math.PI * 2);
        const d = r * rng.range(0.2, 1.5);
        const mx = x + Math.cos(a) * d;
        const mz = z + Math.sin(a) * d;
        const my = groundHeight(mx, mz, place);
        const h = r * rng.range(0.5, 1.1);
        const wide = h * rng.range(0.5, 0.85);
        tube(mb, [
          { x: mx, y: my - h * 0.1, z: mz, r: wide * 0.22 },
          { x: mx, y: my + h, z: mz, r: wide * 0.17 },
        ], 5, () => [0.80, 0.76, 0.66], () => bot);
        // the cap: a squashed dome, which is the whole silhouette
        sphereAt(mb, mx, my + h, mz, wide, 4, 7, cap, bot,
          (px, py) => -Math.max(0, py - (my + h)) * 0.65);
      }
    } else if (what === 'moss') {
      // A low green cushion, half over whatever it is growing on.
      for (let k = 0; k < 3; k++) {
        const a = rng.range(0, Math.PI * 2);
        const d = r * rng.range(0, 0.7);
        const rad = r * rng.range(0.5, 0.9);
        sphereAt(mb, x + Math.cos(a) * d, y + rad * 0.18, z + Math.sin(a) * d, rad, 4, 6,
          [0.16, 0.34, 0.11], bot,
          (px, py) => -Math.max(0, py - y) * 0.72);
      }
    } else if (what === 'log') {
      // Fallen, and mossed over on the side the rain hits.
      const len = r * rng.range(4, 9);
      const a = rng.range(0, Math.PI);
      const path = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4 - 0.5;
        path.push({
          x: x + Math.cos(a) * len * t,
          y: y + r * 0.5 + Math.sin(t * 2.2) * r * 0.12,
          z: z + Math.sin(a) * len * t,
          r: r * 0.5 * (1 - Math.abs(t) * 0.35),
        });
      }
      tube(mb, path, 6, (i) => (i % 2 ? [0.20, 0.16, 0.12] : [0.17, 0.26, 0.12]), () => stone);
    } else if (what === 'sapling') {
      const h = r * rng.range(3, 6);
      const lean = rng.range(-0.2, 0.2);
      const path = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        path.push({ x: x + lean * h * t * t, y: y + h * t, z: z, r: r * 0.09 * (1 - t * 0.6) });
      }
      tube(mb, path, 4, () => [0.22, 0.18, 0.12], () => bot);
      for (let k = 0; k < 3; k++) {
        const a = rng.range(0, Math.PI * 2);
        const rad = r * rng.range(0.4, 0.8);
        clump(x + lean * h + Math.cos(a) * rad * 0.8, y + h - rng.range(0, r),
          z + Math.sin(a) * rad * 0.8, rad, [0.17, 0.38, 0.10], 30);
      }
    } else if (what === 'fern') {
      // A few fronds arching from one crown, which is what the floor of a wood
      // is covered in and what makes its light read as green.
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + rng.range(0, 1.2);
        const reach = r * rng.range(1.6, 2.8);
        const lift = r * rng.range(0.8, 1.5);
        const path = [];
        for (let q = 0; q <= 4; q++) {
          const t = q / 4;
          path.push({
            x:x + Math.cos(a) * reach * t, y: y + lift * Math.sin(t * 2.2) * 0.9, z:
              z + Math.sin(a) * reach * t,
            r: r * 0.16 * (1 - t * 0.7),
          });
        }
        tube(mb, path, 4, () => [0.16, 0.30, 0.11], () => frond);
      }
    } else if (what === 'tree') {
      const h = r * rng.range(5, 9);
      const lean = rng.range(-0.1, 0.1);
      const path = [];
      for (let k = 0; k <= 5; k++) {
        const t = k / 5;
        path.push({ x:x + lean * h * t * t, y: y + h * t, z: z, r: r * 0.16 * (1 - t * 0.55) });
      }
      tube(mb, path, 5, () => [0.20, 0.16, 0.11], () => bot);
      const crown = r * rng.range(1.1, 1.9);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        clump(x + lean * h + Math.cos(a) * crown * 0.5,
          y + h + crown * rng.range(0.1, 0.5), z + Math.sin(a) * crown * 0.5,
          crown * rng.range(0.55, 0.85), [0.14, 0.32, 0.09], 48);
      }
    } else if (what === 'cactus') {
      // a saguaro: a ribbed column, and arms that go out and then up
      const h = r * rng.range(5, 9);
      const green = [0.10 + rng.range(-0.01, 0.02), 0.20 + rng.range(-0.02, 0.02), 0.08];
      const trunk = [];
      for (let k = 0; k <= 5; k++) {
        const t = k / 5;
        trunk.push({ x: x, y: y - r * 0.3 + h * t, z: z, r: r * 0.42 * (1 - t * 0.15) });
      }
      tube(mb, trunk, 8, () => green, () => bot);
      sphere(mb, x, y + h * 0.97 - r * 0.3, z, r * 0.36, 3, 6, green, bot);
      const arms = Math.floor(rng.range(0, 3.2));
      for (let k = 0; k < arms; k++) {
        const a = rng.range(0, Math.PI * 2);
        const at = y + h * rng.range(0.35, 0.6);
        const reach = r * rng.range(1.1, 1.8);
        const up = h * rng.range(0.2, 0.35);
        const ax = Math.cos(a);
        const az = Math.sin(a);
        tube(mb, [
          { x: x, y: at, z: z, r: r * 0.3 },
          { x: x + ax * reach * 0.7, y: at + reach * 0.15, z: z + az * reach * 0.7, r: r * 0.3 },
          { x: x + ax * reach, y: at + reach * 0.5, z: z + az * reach, r: r * 0.29 },
          { x: x + ax * reach, y: at + up, z: z + az * reach, r: r * 0.27 },
        ], 6, () => green, () => bot);
        sphere(mb, x + ax * reach, at + up, z + az * reach, r * 0.26, 3, 5, green, bot);
      }
    } else if (what === 'driftwood') {
      const len = r * rng.range(3, 6);
      const a = rng.range(0, Math.PI);
      const path = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4 - 0.5;
        path.push({
          x:x + Math.cos(a) * len * t, y: y + r * 0.3 + Math.sin(t * 3) * r * 0.2, z:
            z + Math.sin(a) * len * t,
          r: r * 0.22 * (1 - Math.abs(t) * 0.5),
        });
      }
      tube(mb, path, 5, () => [0.44, 0.40, 0.34], () => stone);
    } else if (what === 'stalagmite') {
      const h = r * rng.range(2.5, 6);
      const path = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        path.push({ x:x, y: y + h * t, z: z, r: r * 0.5 * (1 - t) ** 1.3 });
      }
      tube(mb, path, 6, () => [0.33, 0.30, 0.27], () => stone);
    }
  };

  // A clearing behind the plant. The lens is long and the frame narrow, so
  // everything from just behind the plant to the horizon stacks up in the one
  // cone of view directly behind it — the middle of the picture was always the
  // busiest part of it, and the plant was the thing that got lost. Most of what
  // would stand in that cone is left out; the sides keep it all.
  const clearing = (x, z) => Math.abs(x) < 260 + Math.max(0, -z) * 0.065;
  // Printed, half as much of it: every small thing gets a line drawn round it,
  // and at full count the ground read as confetti rather than as ground.
  const sparse = STYLE === 'real' ? 1 : 0.5;
  // Things level with the plant, out to either side. Everything stood either
  // behind it or in front, nothing beside it, so there was nothing at its own
  // depth to measure it against and it floated free of the place.
  for (let i = 0; i < Math.round(16 * place.density); i++) {
    const z = rng.range(-600, 450);
    const x = (rng.range(0, 1) < 0.5 ? -1 : 1) * (380 + rng.range(0, 1) ** 1.3 * 2100);
    put(x, z, 9 + rng.range(0, 22), props[Math.floor(rng.range(0, props.length))]);
  }
  // And a few low things in front of it, off to either side: a plant with the
  // whole world behind it and nothing before it stands in front of a place
  // rather than in one. Low, and never over the stem.
  // Across the whole foreground, not only at its feet: the small things lying
  // about the ground were all behind the plant, and it stood in front of the
  // place's clutter rather than in the middle of it.
  const low = (what) => (what === 'tree' || what === 'cactus' || what === 'sapling' || what === 'bush'
    ? 'stone' : what);
  for (let i = 0; i < Math.round(40 * place.density * sparse); i++) {
    const z = 120 + rng.range(0, 1) ** 1.3 * 2100;
    const reach = 60 + (2900 - z) * 0.26;
    const x = (rng.range(0, 1) < 0.5 ? -1 : 1) * (40 + rng.range(0, 1) * reach);
    put(x, z, 3 + rng.range(0, 7), low(props[Math.floor(rng.range(0, props.length))]));
  }
  const count = Math.round(150 * place.density * sparse);
  for (let i = 0; i < count; i++) {
    const z = -700 - rng.range(0, 3400);
    const x = rng.range(-1, 1) * 2400;
    if (Math.abs(x) < 300 && z > -1100) continue;     // not on top of the plant
    if (clearing(x, z) && rng.range(0, 1) < 0.85) continue;
    put(x, z, 9 + rng.range(0, 22), props[Math.floor(rng.range(0, props.length))]);
  }
  for (let i = 0; i < count; i++) {
    const z = -900 - rng.range(0, 7000);
    const away = Math.abs(z / FAR_Z);
    const x = rng.range(-1, 1) * (1800 + away * 11000);
    if (Math.abs(x) < 320 && z > -900) continue;
    if (clearing(x, z) && rng.range(0, 1) < 0.85) continue;
    put(x, z, (7 + rng.range(0, 13)) * (1 + away * 6.0),
      props[Math.floor(rng.range(0, props.length))]);
  }
}

/**
 * A wood, from inside it.
 *
 * Trunks are the whole of it: near ones running up out of frame, further ones
 * closing the view off entirely, so there is no horizon and no distance — which
 * is what being in a wood is, and the opposite of every other place here. They
 * keep out of a corridor around the plant, because a trunk through the middle
 * of the organism is not atmosphere, it is an obstruction.
 */

function buildForest(mb, place) {
  const rng = makeRng(3301);
  const bark = [SURFACE.scenery[0], SURFACE.scenery[1], SURFACE.scenery[2], MAT_ID.scenery];
  const leaf = [SURFACE.thicket[0], SURFACE.thicket[1], SURFACE.thicket[2], MAT_ID.thicket];

  // A tree, rather than a pole with balls over it: a trunk that flares at the
  // foot and tapers, limbs that leave it high up and turn upward, and foliage
  // carried on the ends of those where a tree actually carries it.
  //
  // And very tall. The camera rides up with the plant and the plant does not
  // stop — at four thousand units a thirty-metre tree is a shrub somewhere below
  // the bottom of the frame, which is why the first wood disappeared the moment
  // anything grew. These are on the organism's own scale, so it stays among them.
  const tree = (x, y, z, r, h) => {
    const lean = rng.range(-0.05, 0.05);
    const trunk = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      trunk.push({
        x:x + lean * h * t * t + noise2(t * 3, x, 6) * r * 0.5, y: y - r * 0.6 + h * t, z: z,
        r: r * (1 - t * 0.62) * (1 + (1 - t) * (1 - t) * 0.55),
      });
    }
    const barkCol = STYLE === 'real' ? [0.19, 0.15, 0.11]
      : TRUNK_INKS[Math.abs(Math.floor(x * 0.013 + z * 0.0071)) % TRUNK_INKS.length];
    tube(mb, trunk, 6, () => barkCol, () => bark);

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
        arm.push({
          x:bx + Math.cos(a) * reach * u, y:
            by + reach * (u * 0.5 + u * u * 0.4), z:        // outward and then up
            z + Math.sin(a) * reach * u,
          r: r * 0.30 * (1 - u * 0.7),
        });
      }
      tube(mb, arm, 4, () => barkCol, () => bark);

      const tip = [bx + Math.cos(a) * reach, by + reach * 0.9, z + Math.sin(a) * reach];
      for (let q = 0; q < 2; q++) {
        const rad = reach * rng.range(0.34, 0.58);
        const lx = tip[0] + rng.range(-rad, rad) * 0.7;
        const ly = tip[1] + rng.range(-rad * 0.4, rad * 0.8);
        const lz = tip[2] + rng.range(-rad, rad) * 0.7;
        // a deeper, more saturated green than the solid crowns had: through a
        // canopy of cards there is sky showing, and it pales the whole mass
        const colour = [0.11 + rng.range(-0.02, 0.03), 0.30 + rng.range(-0.03, 0.05), 0.07];
        sphereAt(mb, lx, ly, lz, rad, 4, 6, colour, leaf, lumps(rad, lx * 0.01));
      }
    }
  };

  // Dense means dense. A wood is the one place where most of what you can see
  // is other trees, and that takes enough of them to overlap at every depth.
  for (let i = 0; i < 140; i++) {
    // No nearer than this: closer than five thousand units a trunk is a wall.
    const away = 5000 + rng.range(0, 1) ** 1.5 * 30000;
    const z = 3000 - away;
    // Kept off the axis by an angle, so the corridor round the plant stays open
    // at every depth rather than only close up. The frame is about a ninth of a
    // radian either side of centre.
    // out to the sides: packed as they were into the cone straight behind the
    // plant, the middle of the wood was a wall of trunks
    const spread = away * rng.range(0.07, 0.40);
    const x = (rng.range(0, 1) < 0.5 ? -1 : 1) * spread;
    if (Math.abs(x) < 300 + away * 0.07 && rng.range(0, 1) < 0.8) continue;
    const y = groundHeight(x, z, place);
    const r = away * rng.range(0.0035, 0.010);
    tree(x, y, z, r, r * rng.range(26, 44));
  }
}

/**
 * Grass, as a carpet rather than as scenery.
 *
 * The scatter puts a tuft here and there, which is a lawn with a problem. A
 * field is continuous: close to, the ground IS grass, and nothing else about
 * the place reads right until that is true.
 *
 * Cards now, each a pair of crossed quads with seven blades cut out of it, and
 * running right up to the camera. The tube grass stopped short of the plant and
 * never came in front of it, so everything between the lens and the stem was
 * bare ground seen edge-on — a fifth of the picture as a smooth green smear.
 * They stand clear of the mound itself, so the stem still rises in the open;
 * the ones round it hide where it meets the ground.
 */
function grassCard(mb, x, y, z, w, h, yaw, col, surf, seed, lean = [0, 0]) {
  for (let k = 0; k < 2; k++) {
    const a = yaw + k * Math.PI * 0.5;
    const dx = Math.cos(a) * w * 0.5;
    const dz = Math.sin(a) * w * 0.5;
    // lit as the ground under it is lit, not as a flat sheet standing on edge
    const up = [0, 1, 0];
    const b = mb.vertexCount;
    mb.push([x - dx, y - h * 0.06, z - dz], up, col, surf, [seed, 0]);
    mb.push([x + dx, y - h * 0.06, z + dz], up, col, surf, [seed + 1, 0]);
    mb.push([x + dx + lean[0], y + h, z + dz + lean[1]], up, col, surf, [seed + 1, 1]);
    mb.push([x - dx + lean[0], y + h, z - dz + lean[1]], up, col, surf, [seed, 1]);
    mb.quad(b, b + 1, b + 2, b + 3);
  }
}

// ---------------------------------------------------------- drawn ground
//
// An illustration says "grass" with a few strokes here and there and "meadow"
// with flowers dotted over a flat green — it does not draw a lawn blade by
// blade, and seven thousand blades each with an ink line round them would be a
// scribble. So in the illustrated look the ground is flat colour, and on it:

/** The flat colours the trunks of the illustrated forest come in. */
const TRUNK_INKS = ['#ff5f9e', '#f7e04a', '#ff8a3d', '#2f5ee8', '#efe6d8', '#b9a3f0'].map(linear);

/** How much of each, per place. */
const TOON_GROUND = {
  field: { tufts: 320, tuft: '#1f8a3e', flowers: 220 },
  forest: { tufts: 90, tuft: '#1f8a3e', flowers: 70 },
  dunes: { tufts: 70, tuft: '#8a5a3a', flowers: 24 },
  ocean: { tufts: 240, tuft: '#1f8a3e', tall: 2.2 },
  beach: { tufts: 40, tuft: '#35b24f' },
};

/**
 * Tufts: a few strokes fanning out of the ground. Thin enough that the line
 * the camera pass draws round every shape swallows them whole, so each one is
 * an ink mark, the way the posters draw grass.
 */
function buildTufts(mb, place, count, col, tall) {
  const rng = makeRng(8181);
  const surf = [SURFACE.scenery[0], SURFACE.scenery[1], SURFACE.scenery[2], MAT_ID.scenery];
  for (let i = 0; i < count; i++) {
    const t = rng.range(0, 1) ** 1.5;
    const z = 2600 - t * 9000;
    const away = 2900 - z;
    const x = rng.range(-1, 1) * (away * 0.32 + 200);
    if (Math.hypot(x, z) < 160) continue;
    if (place.water !== undefined && z < place.water) continue;
    const y = groundHeight(x, z, place);
    const h = (10 + away * 0.004) * rng.range(0.7, 1.3) * tall;
    const blades = 3 + Math.floor(rng.range(0, 2.5));
    for (let b = 0; b < blades; b++) {
      const lean = (b / (blades - 1) - 0.5) * 1.3 + rng.range(-0.15, 0.15);
      tube(mb, [
        { x, y: y - 1, z, r: h * 0.07 },
        { x: x + Math.sin(lean) * h * 0.45, y: y + Math.cos(lean) * h * 0.55, z, r: h * 0.05 },
        { x: x + Math.sin(lean) * h * 0.95, y: y + Math.cos(lean) * h * 0.95, z, r: h * 0.02 },
      ], 3, () => col, () => surf);
    }
  }
}

/** A flat five-petalled flower facing the viewer, with a round eye. */
function flatFlower(mb, x, y, z, s, petal, eye, surf) {
  const n = 30;
  const up = [0, 0, 1];
  const c = mb.vertexCount;
  mb.push([x, y, z], up, petal, surf, [0, 0]);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = s * (0.55 + 0.45 * Math.abs(Math.cos(a * 2.5)));
    mb.push([x + Math.cos(a) * r, y + Math.sin(a) * r, z], up, petal, surf, [0, 0]);
  }
  for (let i = 0; i < n; i++) mb.tri(c, c + 1 + i, c + 2 + i);
  const e = mb.vertexCount;
  const ez = z + s * 0.06;
  mb.push([x, y, ez], up, eye, surf, [0, 0]);
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    mb.push([x + Math.cos(a) * s * 0.3, y + Math.sin(a) * s * 0.3, ez], up, eye, surf, [0, 0]);
  }
  for (let i = 0; i < 12; i++) mb.tri(e, e + 1 + i, e + 2 + i);
}

/** Flowers dotted over the ground, on short stems. */
function buildMeadowFlowers(mb, place, count) {
  const rng = makeRng(8282);
  const surf = [SURFACE.scenery[0], SURFACE.scenery[1], SURFACE.scenery[2], MAT_ID.scenery];
  const petals = ['#ff6fa6', '#ffd93b', '#3b5fe6', '#fbf7ee', '#ff8a3d', '#f0452b', '#b9a3f0'].map(linear);
  const eyes = ['#ffd93b', '#fbf7ee', '#ff8a3d'].map(linear);
  const stem = linear('#1f8a3e');
  for (let i = 0; i < count; i++) {
    const t = rng.range(0, 1) ** 1.4;
    const z = 2400 - t * 8500;
    const away = 2900 - z;
    const x = rng.range(-1, 1) * (away * 0.32 + 200);
    if (Math.hypot(x, z) < 200) continue;
    const g = groundHeight(x, z, place);
    const s = (6 + away * 0.0026) * rng.range(0.8, 1.35);
    const top = g + s * rng.range(1.2, 2.2);
    tube(mb, [{ x, y: g - 1, z, r: s * 0.09 }, { x, y: top, z, r: s * 0.08 }], 3, () => stem, () => surf);
    const pc = petals[Math.floor(rng.range(0, petals.length))];
    let ec = eyes[Math.floor(rng.range(0, eyes.length))];
    if (ec === pc) ec = eyes[0] === pc ? eyes[1] : eyes[0];
    flatFlower(mb, x, top, z + s * 0.1, s, pc, ec, surf);
  }
}

function buildGrass(mb, place) {
  const spec = place.grass;
  const rng = makeRng(6120);
  const surf = [SURFACE.grass[0], SURFACE.grass[1], SURFACE.grass[2], MAT_ID.grass];
  const [c0, c1] = spec.colours;
  let seed = 0;
  for (let i = 0; i < spec.count; i++) {
    // from under the lens out to where a clump is a few pixels across
    const t = rng.range(0, 1) ** 1.7;
    const z = 2700 - t * 9700;
    if (spec.back !== undefined && z < spec.back) continue;
    const away = 2900 - z;
    const x = rng.range(-1, 1) * (away * 0.32 + 200);
    if (Math.hypot(x, z) < 150) continue;              // the mound, and the stem out of it
    const y = groundHeight(x, z, place);
    const h = (14 + away * 0.0035 + rng.range(0, 10)) * (spec.tall || 1);
    const g = rng.range(0, 1);
    const col = [0, 1, 2].map((k) => c0[k] + (c1[k] - c0[k]) * g);
    // Near the plant the grass leans away from it, pushed aside by the stem
    // coming up through it — the one place the ground answers to the plant.
    const d = Math.hypot(x, z);
    const push = Math.max(0, 1 - d / 520) * h * 0.55;
    grassCard(mb, x, y, z, h * rng.range(1.1, 1.7), h, rng.range(0, Math.PI), col, surf, seed,
      [(x / (d || 1)) * push, (z / (d || 1)) * push]);
    seed = (seed + 1) % 61;
  }
}

/**
 * Where the plant comes out of the ground.
 *
 * Growth starts at the origin and the first stem simply began in mid-air above
 * the floor, so a game opened with the organism resting on the ground rather
 * than rooted in it — and when growth went downwards it ended in a rounded tip
 * lying on the surface like a dropped cable. A little heaped earth covers the
 * join, which is also what the ground round a real stem looks like.
 */
function buildMound(mb, place) {
  const rng = makeRng(7742);
  const surf = [SURFACE.terrain[0], SURFACE.terrain[1], SURFACE.terrain[2], MAT_ID.terrain];
  const t = place.ground;
  const y0 = groundHeight(0, 0, place);
  for (let i = 0; i < 7; i++) {
    const a = i === 0 ? 0 : rng.range(0, Math.PI * 2);
    const d = i === 0 ? 0 : rng.range(18, 62);
    const r = i === 0 ? 78 : rng.range(24, 46);
    const v = 0.8 + rng.range(0, 0.5);
    sphereAt(mb, Math.cos(a) * d, y0 - r * 0.52, Math.sin(a) * d, r, 6, 9,
      [t[0] * v, t[1] * v, t[2] * v], surf,
      (px, py, pz) => (noise2(px * 0.06, pz * 0.06, 15) - 0.5) * r * 0.4);
  }
}

/**
 * The underside of the sea, and what is under it.
 *
 * Seen from below, the surface is a ceiling: bright where the sun comes
 * straight through and darker away from that, rippling, and it is the only
 * light down here. Everything else — the blue that eats the distance, the way
 * colour drops out with depth — is the water itself, and that is handled in the
 * shader by the same haze that does aerial perspective on land.
 */
const SURFACE_INK_LIGHT = linear('#6fb3f7');
const SURFACE_INK_GLINT = linear('#fbf2dd');
function buildSurface(mb, place) {
  const surf = [SURFACE.water[0], SURFACE.water[1], SURFACE.water[2], MAT_ID.water];
  const cols = 70;
  const rows = 46;
  const base = mb.vertexCount;
  const y0 = place.underwater;
  const span = 60000;

  const waveAt = (x, z) => Math.sin(x * 0.0035 + z * 0.0021) * 46
    + Math.sin(x * 0.0012 - z * 0.0029) * 62
    + (noise2(x * 0.0018, z * 0.0018, 23) - 0.5) * 70;

  for (let i = 0; i <= rows; i++) {
    const z = NEAR_Z + (-span - NEAR_Z) * (i / rows);
    for (let j = 0; j <= cols; j++) {
      const x = (j / cols - 0.5) * span * 1.6;
      const y = y0 + waveAt(x, z);
      const e = 90;
      const nx = waveAt(x + e, z) - waveAt(x - e, z);
      const nz = waveAt(x, z + e) - waveAt(x, z - e);
      const len = Math.hypot(nx, 2 * e, nz) || 1;
      // Normal pointing DOWN: this is a ceiling, and it is lit from above
      // through itself, so the face the camera sees is its underside.
      const glint = clamp01(noise2(x * 0.0009, z * 0.0009, 31) * 1.6 - 0.3);
      // printed, the ceiling is the pale blue, with the bright of it in cream
      const col = STYLE !== 'real'
        ? (glint > 0.8 ? SURFACE_INK_GLINT : SURFACE_INK_LIGHT)
        : [0.10 + glint * 0.55, 0.30 + glint * 0.6, 0.42 + glint * 0.5];
      mb.push([x, y, z], [nx / len, -(2 * e) / len, nz / len], col, surf,
        [x * 0.02, z * 0.02]);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = base + i * (cols + 1) + j;
      mb.quad(a, a + cols + 1, a + cols + 2, a + 1);
    }
  }
}



/** Coral, which is the reason to be down there. */
function buildCoral(mb, x, y, z, r, rng, bot, stone) {
  const kind = rng.range(0, 1);
  if (kind < 0.4) {
    // branching: a few forks going up and out
    const col = [0.66, 0.30, 0.34];
    const grow = (px, py, pz, rad, dir, depth) => {
      const len = rad * rng.range(3, 5);
      const nx = px + Math.cos(dir) * len * 0.5;
      const nz = pz + Math.sin(dir) * len * 0.5;
      const ny = py + len;
      tube(mb, [{ x:px, y: py, z: pz, r: rad }, { x:nx, y: ny, z: nz, r: rad * 0.6 }],
        5, () => col, () => bot);
      if (depth > 0) {
        grow(nx, ny, nz, rad * 0.62, dir + rng.range(0.4, 1.1), depth - 1);
        grow(nx, ny, nz, rad * 0.62, dir - rng.range(0.4, 1.1), depth - 1);
      }
    };
    grow(x, y, z, r * 0.3, rng.range(0, 6.28), 2);
  } else if (kind < 0.72) {
    // brain: a lumpy dome
    const col = [0.72, 0.58, 0.30];
    for (let k = 0; k < 4; k++) {
      const a = rng.range(0, 6.28);
      const d = r * rng.range(0, 0.5);
      sphereAt(mb, x + Math.cos(a) * d, y + r * 0.3, z + Math.sin(a) * d,
        r * rng.range(0.5, 0.8), 5, 8, col, stone,
        (px, py, pz) => (noise2(px * 0.14, pz * 0.14, 41) - 0.5) * r * 0.5);
    }
  } else {
    // fan: a flat blade standing across the current
    const col = [0.58, 0.26, 0.42];
    const a = rng.range(0, 3.14);
    for (let k = 0; k < 5; k++) {
      const t = (k / 4 - 0.5) * 1.6;
      const h = r * rng.range(2, 3.4) * (1 - Math.abs(t) * 0.5);
      tube(mb, [
        { x:x + Math.cos(a) * t * r, y: y, z: z + Math.sin(a) * t * r, r: r * 0.10 },
        { x:x + Math.cos(a) * t * r * 1.5, y: y + h, z: z + Math.sin(a) * t * r * 1.5, r: r * 0.04 },
      ], 4, () => col, () => bot);
    }
  }
}

/**
 * The world.
 *
 * It no longer depends on the plant or on where the camera has climbed to. It
 * used to take both, and the rebuild was keyed on the camera's height, so every
 * nine hundred units of growth threw the whole thing away and built it again —
 * five to twelve megabytes of geometry, on the main thread, in the middle of
 * play, to produce the same world it already had. Everything that once needed
 * the plant's size is now fixed and generous: the ground runs to the horizon
 * whatever is standing on it, and the sky is a hundred and fifty thousand units
 * off. So this is built when the place changes or the window resizes, and not
 * otherwise.
 */
// ------------------------------------------------------------ things that move
//
// Birds in the air, fish in the water, tumbleweed across the dunes.
//
// Built into the world mesh and moved in the vertex shader, the only thing that
// told one bird from another was which patch of sky it was in: a whole flock
// moved as one rigid block, round a fixed circle, sideways to the way its
// bodies faced, every wing beating in time with every other — and the fish
// swayed ninety units in schools thousands of units away, which is to say not
// at all. Now each kind is one shape, built once at unit size, and every copy
// of it is placed, turned and bent afresh each frame into one buffer: a few
// thousand vertices and a few multiplies each, drawn in one call.

/**
 * A shape to be copied, with a weight per vertex for how much it bends — how
 * far out along a wing, how far back along a tail.
 */
function shapeOf(build, weight) {
  const mb = new MeshBuilder();
  build(mb);
  const b = mb.build();
  const n = b.data.length / FLOATS_PER_VERTEX;
  const w = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const i = v * FLOATS_PER_VERTEX;
    w[v] = weight ? weight(b.data[i], b.data[i + 1], b.data[i + 2]) : 0;
  }
  return { data: b.data, indices: b.indices, n, w };
}

/**
 * One copy: bent (up for a wing, sideways for a tail, in proportion to each
 * vertex's weight), rolled about its own sideways axis, turned to face
 * `heading` about the vertical, scaled, placed, and tinted if asked.
 */
function putCopy(out, o, shape, x, y, z, heading, size, bendUp, bendSide, roll, tint) {
  const F = FLOATS_PER_VERTEX;
  const src = shape.data;
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  for (let v = 0; v < shape.n; v++, o += F) {
    const i = v * F;
    let lx = src[i];
    let ly = src[i + 1] + shape.w[v] * bendUp;
    const lz = src[i + 2] + shape.w[v] * bendSide;
    let nx = src[i + 3];
    let ny = src[i + 4];
    const nz = src[i + 5];
    if (roll) {
      const rx = lx * cr - ly * sr;
      ly = lx * sr + ly * cr;
      lx = rx;
      const qx = nx * cr - ny * sr;
      ny = nx * sr + ny * cr;
      nx = qx;
    }
    out[o] = x + (lx * c - lz * s) * size;
    out[o + 1] = y + ly * size;
    out[o + 2] = z + (lx * s + lz * c) * size;
    out[o + 3] = nx * c - nz * s;
    out[o + 4] = ny;
    out[o + 5] = nx * s + nz * c;
    out[o + 6] = tint ? src[i + 6] * tint[0] : src[i + 6];
    out[o + 7] = tint ? src[i + 7] * tint[1] : src[i + 7];
    out[o + 8] = tint ? src[i + 8] * tint[2] : src[i + 8];
    for (let k = 9; k < F; k++) out[o + k] = src[i + k];
  }
  return o;
}

const smoothish = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };

/**
 * Birds: a flock flies a straight course across the sky the way it is facing,
 * wrapping round far outside the picture, loosely in a V whose members drift
 * about their places; each bird beats its own wings at its own rate, and now
 * and then stops and glides.
 */
function birdKind(place) {
  const rng = makeRng(6613);
  const flocks = [];
  // Nearer and lower than they were: flocks out at twenty-odd thousand units
  // and up to fifteen thousand high spent nearly all their time above or
  // beside the picture, and a player could go a whole game without seeing one.
  for (let f = 0; f < 9; f++) {
    const away = 1500 + rng.range(0, 1) ** 1.3 * 16000;
    const heading = (rng.range(0, 1) < 0.5 ? 0 : Math.PI) + rng.range(-0.55, 0.55);
    const n = 3 + Math.floor(rng.range(0, 6));
    const birds = [];
    for (let i = 0; i < n; i++) {
      birds.push({ seed: rng.range(0, 1), rate: 1.5 + rng.range(0, 1), phase: rng.range(0, Math.PI * 2),
        slot: [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)] });
    }
    flocks.push({
      home: [rng.range(-1, 1) * away * 0.5, 500 + rng.range(0, 1) * (1800 + away * 0.22), -away],
      heading, speed: away * rng.range(0.018, 0.032) + 40, span: away * 1.2 + 5000,
      start: rng.range(0, 1), size: away * 0.0075, birds,
    });
  }
  const dark = [SURFACE.wing[0], SURFACE.wing[1], SURFACE.wing[2], MAT_ID.wing];
  const shape = shapeOf((mb) => {
    sphere(mb, 0, 0, 0, 0.42, 3, 5, [0.17, 0.16, 0.17], dark);
    for (const w of [-1, 1]) {
      tube(mb, [
        { x: 0, y: 0, z: 0, r: 0.16 },
        { x: 0, y: 0, z: w * 1.1, r: 0.11 },
        { x: 0, y: 0, z: w * 2.2, r: 0.03 },
      ], 4, () => [0.15, 0.14, 0.15], () => dark);
    }
  }, (x, y, z) => clamp01((Math.abs(z) - 0.3) / 1.9) ** 1.3 * 1.5);
  return {
    shape,
    count: flocks.reduce((a, fl) => a + fl.birds.length, 0),
    write(out, o, t) {
      for (const fl of flocks) {
        const dx = Math.cos(fl.heading);
        const dz = Math.sin(fl.heading);
        const along = ((fl.start * fl.span + t * fl.speed) % fl.span) - fl.span / 2;
        const cx = fl.home[0] + dx * along;
        const cy = fl.home[1] + Math.sin(t * 0.13 + fl.start * 9) * fl.size * 8;
        const cz = fl.home[2] + dz * along;
        const size = fl.size;
        fl.birds.forEach((b, i) => {
          const row = Math.ceil(i / 2);
          const side = i === 0 ? 0 : (i % 2 ? 1 : -1);
          const wx = Math.sin(t * 0.31 + b.seed * 40) * size * 1.6 + b.slot[0] * size * 1.5;
          const wy = Math.sin(t * 0.23 + b.seed * 17) * size * 1.3 + b.slot[1] * size * 1.8;
          const wz = Math.cos(t * 0.27 + b.seed * 29) * size * 1.6 + b.slot[2] * size * 1.5;
          const back = row * size * 5.5;
          const aside = side * row * size * 4.2;
          const gliding = smoothish(-0.2, 0.35, Math.sin(t * 0.37 + b.seed * 6.28));
          const stroke = Math.sin(t * Math.PI * 2 * b.rate + b.phase) * (1 - gliding * 0.85);
          o = putCopy(out, o, shape,
            cx - dx * back - dz * aside + wx,
            cy + wy - stroke * size * 0.25,
            cz - dz * back + dx * aside + wz,
            fl.heading, size, 0.12 + stroke * 0.5 + gliding * 0.1, 0, 0, null);
        });
      }
    },
  };
}

/**
 * Fish: schools crossing the water the way they face, each fish keeping its
 * own place in the school loosely and beating its own tail.
 */
function fishKind(place) {
  const rng = makeRng(9001);
  const COLOURS = [[0.70, 0.50, 0.14], [0.46, 0.52, 0.58], [0.66, 0.30, 0.16]];
  const schools = [];
  for (let s = 0; s < 12; s++) {
    const away = 700 + rng.range(0, 1) ** 1.4 * 12000;
    const n = 8 + Math.floor(rng.range(0, 10));
    const fish = [];
    for (let i = 0; i < n; i++) {
      fish.push({ seed: rng.range(0, 1), rate: 2.5 + rng.range(0, 2), phase: rng.range(0, Math.PI * 2),
        slot: [rng.range(-1, 1) * 16, rng.range(-1, 1) * 6, rng.range(-1, 1) * 12] });
    }
    schools.push({
      home: [rng.range(-1, 1) * away * 0.3,
        groundHeight(0, -away, place) + 200 + rng.range(0, 1) * place.underwater * 0.8, -away],
      heading: (rng.range(0, 1) < 0.5 ? 0 : Math.PI) + rng.range(-0.6, 0.6),
      speed: away * 0.014 + 50, span: away * 1.7 + 5000, start: rng.range(0, 1),
      size: 16 + away * 0.0045, colour: COLOURS[Math.floor(rng.range(0, 3))], fish,
    });
  }
  const bot = [SURFACE.fish[0], SURFACE.fish[1], SURFACE.fish[2], MAT_ID.fish];
  const shape = shapeOf((mb) => {
    // a spindle along the way it swims, and a tail flattened across it
    sphereAt(mb, 0, 0, 0, 1, 4, 6, [1, 1, 1], bot, (px) => 0.9 * px * px - 0.42);
    sphereAt(mb, -2, 0, 0, 0.55, 3, 5, [1, 1, 1], bot, (px, py) => -Math.abs(py) * 0.6);
  }, (x) => clamp01((-x - 0.6) / 2.0));
  return {
    shape,
    count: schools.reduce((a, sc) => a + sc.fish.length, 0),
    write(out, o, t) {
      for (const sc of schools) {
        const dx = Math.cos(sc.heading);
        const dz = Math.sin(sc.heading);
        const along = ((sc.start * sc.span + t * sc.speed) % sc.span) - sc.span / 2;
        const cx = sc.home[0] + dx * along;
        const cy = sc.home[1] + Math.sin(t * 0.21 + sc.start * 7) * sc.size * 6;
        const cz = sc.home[2] + dz * along;
        const size = sc.size;
        for (const f of sc.fish) {
          const [sx, sy, sz] = f.slot;
          const drift = [Math.sin(t * 0.5 + f.seed * 30) * 2.5, Math.sin(t * 0.37 + f.seed * 11) * 1.2,
            Math.cos(t * 0.43 + f.seed * 23) * 2.5];
          const lx = (sx + drift[0]) * size;
          const lz = (sz + drift[2]) * size;
          const beat = Math.sin(t * Math.PI * 2 * f.rate + f.phase);
          o = putCopy(out, o, shape,
            cx + lx * dx - lz * dz, cy + (sy + drift[1]) * size, cz + lx * dz + lz * dx,
            sc.heading + beat * 0.06, size, 0, beat * 0.45, 0, sc.colour);
        }
      }
    },
  };
}

/**
 * Tumbleweed: now and then a dry ball of twigs rolls across the dunes on the
 * wind, bouncing, and is gone.
 */
function weedKind(place) {
  const rng = makeRng(4040);
  const weeds = [];
  for (let i = 0; i < 6; i++) {
    const z = -500 - rng.range(0, 1) ** 1.3 * 5500;
    weeds.push({ z, size: 28 + (-z) * 0.009, speed: 170 + rng.range(0, 170), span: 8000 + (-z) * 1.3,
      start: rng.range(0, 1), rest: 1.5 + rng.range(0, 2.5), seed: rng.range(0, 1) });
  }
  const dry = [SURFACE.thicket[0], SURFACE.thicket[1], SURFACE.thicket[2], MAT_ID.thicket];
  const shape = shapeOf((mb) => {
    // arcs of twig round a ball, every which way
    const r = makeRng(4141);
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
      const path = [];
      for (let k = 0; k <= 4; k++) {
        const th = a0 + k * 0.55;
        const rr = 0.8 + r.range(-0.15, 0.15);
        path.push({ x: (e1[0] * Math.cos(th) + e2[0] * Math.sin(th)) * rr,
          y: (e1[1] * Math.cos(th) + e2[1] * Math.sin(th)) * rr,
          z: (e1[2] * Math.cos(th) + e2[2] * Math.sin(th)) * rr, r: 0.045 });
      }
      tube(mb, path, 3, () => [0.40, 0.32, 0.19], () => dry);
    }
  });
  return {
    shape,
    count: weeds.length,
    write(out, o, t) {
      for (const w of weeds) {
        // across, and then a while off to one side before the next one comes
        const cycle = w.span * (1 + w.rest);
        const x = ((w.start * cycle + t * w.speed) % cycle) - w.span / 2;
        const y = groundHeight(x, w.z, place) + w.size * 0.85
          + Math.abs(Math.sin(t * 2.4 + w.seed * 9)) * w.size * 0.7;
        o = putCopy(out, o, shape, x, y, w.z, 0, w.size, 0, 0, -x / w.size, null);
      }
    },
  };
}

/**
 * Butterflies. Each keeps to its own patch of meadow out to one side of the
 * plant, going from flower to flower there; now and then, when the plant has
 * flowers of its own, it crosses over to one of them for a while. They all
 * used to be sent to the plant's flowers — and with none yet, to one point at
 * its foot — so the whole lot hung in a knot in the middle of the picture.
 */
function butterflyKind(place) {
  const COLOURS = [[1.0, 0.95, 0.55], [0.95, 0.95, 0.92], [1.0, 0.62, 0.20], [0.55, 0.70, 1.0],
    [1.0, 0.55, 0.75], [1.0, 0.95, 0.55]];
  const flies = COLOURS.map((colour, i) => ({
    seed: i * 0.37 + 0.11, colour, stay: 5.5 + (i % 4) * 1.3,
    side: i % 2 ? 1 : -1, depth: -700 + ((i * 0.618) % 1) * 1500,
  }));
  const h = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  // a flower of the meadow's, out on this butterfly's side, for leg n
  const meadow = (f, n) => {
    const x = f.side * (320 + h(n, f.seed * 50) * 1500);
    const z = f.depth + (h(n + 0.5, f.seed * 70) - 0.5) * 500;
    return [x, groundHeight(x, z, place) + 30 + h(n + 0.25, f.seed * 90) * 120, z];
  };
  const wing = [SURFACE.thicket[0], SURFACE.thicket[1], SURFACE.thicket[2], MAT_ID.thicket];
  const shape = shapeOf((mb) => {
    tube(mb, [{ x: -0.35, y: 0, z: 0, r: 0.05 }, { x: 0.35, y: 0, z: 0, r: 0.04 }], 3,
      () => [0.12, 0.10, 0.08], () => wing);
    const up = [0, 1, 0];
    for (const s of [-1, 1]) {
      for (const poly of [
        [[0.1, 0.05], [0.55, 0.55], [0.1, 0.9], [-0.15, 0.45]],
        [[-0.05, 0.05], [0.0, 0.5], [-0.45, 0.55], [-0.35, 0.15]],
      ]) {
        const b = mb.vertexCount;
        for (const [px, pz] of poly) mb.push([px, 0, pz * s], up, [1, 1, 1], wing, [0, 0]);
        mb.quad(b, b + 1, b + 2, b + 3);
      }
    }
  }, (x, y, z) => Math.abs(z));
  return {
    shape,
    count: flies.length,
    write(out, o, t, plant) {
      const blooms = plant && plant.blooms.length ? plant.blooms : null;
      for (const f of flies) {
        // which flower, and the one before it, for the flight between them:
        // mostly the meadow's, one visit in three the plant's
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
        const y = a[1] + (b[1] - a[1]) * go + r * 0.6 + Math.sin(t * 2.1 + f.seed * 3) * r * 0.5
          + Math.sin(go * Math.PI) * 90;
        const z = a[2] + (b[2] - a[2]) * go + Math.cos(t * 1.1 + f.seed * 5) * r;
        const heading = Math.atan2(-Math.sin(t * 1.1 + f.seed * 5) * 1.1, Math.cos(t * 1.3 + f.seed * 9) * 1.3);
        const flap = 0.4 + Math.sin(t * Math.PI * 2 * 7 + f.seed * 20) * 0.8;
        o = putCopy(out, o, shape, x, y, z, heading, 24, flap, 0, 0, f.colour);
      }
    },
  };
}

/**
 * Deer in the wood, walking. Each keeps to a stretch of ground off to one side
 * of the plant at its own depth: it walks a while, stops to graze with its head
 * down, and walks on, turning at the end of its stretch. They used to be built
 * standing into the world, still as the trees.
 *
 * Two kinds share one herd: the body (with the neck and head, which bend down
 * to graze) and the legs, four copies each, which swing in a walk.
 */
function deerKinds(place) {
  const rng = makeRng(8154);
  const herd = [];
  for (let i = 0; i < 6; i++) {
    const away = 3000 + rng.range(0, 8000);
    const side = i % 2 ? 1 : -1;
    // in the open between the plant and the trunks, where the frame can see
    // them: out past the trunks they spent their whole walk off the edge
    const near = side * (260 + away * 0.045);
    const far = side * away * rng.range(0.13, 0.19);
    herd.push({
      z: 2400 - away, x0: near, x1: far, size: away * 0.010,
      walk: 6 + rng.range(0, 6), graze: 4 + rng.range(0, 5), offset: rng.range(0, 40),
    });
  }
  const at = (d, t) => {
    const P = d.walk + d.graze;
    const tt = t + d.offset;
    const cyc = Math.floor(tt / P);
    const tm = tt - cyc * P;
    const walked = (cyc * d.walk + Math.min(tm, d.walk)) * d.size * 1.1;
    const L = Math.abs(d.x1 - d.x0) || 1;
    const dir = Math.sign(d.x1 - d.x0) || 1;
    const u = walked % (2 * L);
    const out = u < L;
    const x = out ? d.x0 + dir * u : d.x1 - dir * (u - L);
    const facing = out ? dir : -dir;
    const walking = tm < d.walk ? smoothish(0, 0.6, tm) * (1 - smoothish(d.walk - 0.6, d.walk, tm)) : 0;
    const graze = tm >= d.walk ? smoothish(d.walk, d.walk + 1.2, tm) * (1 - smoothish(P - 1.2, P, tm)) : 0;
    const gait = walked / (d.size * 0.9);
    return {
      x, y: groundHeight(x, d.z, place) + Math.abs(Math.cos(gait)) * d.size * 0.06 * walking,
      heading: facing > 0 ? 0 : Math.PI, walking, graze, gait,
    };
  };
  const hide = [SURFACE.thicket[0], SURFACE.thicket[1], SURFACE.thicket[2], MAT_ID.thicket];
  // printed, a dark coat went to the brown ink and body, neck and head ran
  // together into one shape: tan prints orange, with a pale tail
  const coat = STYLE !== 'real' ? linear('#c8733a') : [0.30, 0.20, 0.13];
  const pale = STYLE !== 'real' ? linear('#fbf2dd') : [0.62, 0.55, 0.46];
  const body = shapeOf((mb) => {
    tube(mb, [
      { x: -1.25, y: 2.25, z: 0, r: 0.30 }, { x: -0.8, y: 2.25, z: 0, r: 0.62 },
      { x: 0.2, y: 2.3, z: 0, r: 0.66 }, { x: 0.95, y: 2.4, z: 0, r: 0.55 }, { x: 1.25, y: 2.55, z: 0, r: 0.25 },
    ], 8, () => coat, () => hide);
    tube(mb, [{ x: 0.95, y: 2.55, z: 0, r: 0.30 }, { x: 1.55, y: 3.45, z: 0, r: 0.22 }], 6, () => coat, () => hide);
    tube(mb, [{ x: 1.45, y: 3.55, z: 0, r: 0.28 }, { x: 2.25, y: 3.25, z: 0, r: 0.13 }], 6, () => coat, () => hide);
    for (const s of [-1, 1]) {
      tube(mb, [{ x: 1.5, y: 3.75, z: s * 0.14, r: 0.10 }, { x: 1.35, y: 4.25, z: s * 0.32, r: 0.02 }], 4,
        () => coat, () => hide);
    }
    tube(mb, [{ x: -1.2, y: 2.45, z: 0, r: 0.13 }, { x: -1.45, y: 2.75, z: 0, r: 0.05 }], 4, () => pale, () => hide);
  }, (x) => clamp01((x - 0.9) / 1.0));
  const leg = shapeOf((mb) => {
    tube(mb, [{ x: 0, y: 0, z: 0, r: 0.15 }, { x: 0, y: -1.0, z: 0, r: 0.09 }, { x: 0.04, y: -2.05, z: 0, r: 0.07 }],
      4, () => coat, () => hide);
  });
  // hips, in the deer's own frame: front pair, then back pair
  const HIPS = [[0.75, 0.33, 0], [0.75, -0.33, Math.PI], [-0.8, 0.33, Math.PI], [-0.8, -0.33, 0]];
  return [
    {
      shape: body,
      count: herd.length,
      write(out, o, t) {
        for (const d of herd) {
          const a = at(d, t);
          // the head down to the grass while grazing, and a nod in the walk
          const nod = -a.graze * 1.9 + Math.sin(a.gait * 2) * 0.06 * a.walking;
          o = putCopy(out, o, body, a.x, a.y, d.z, a.heading, d.size, nod, 0, 0, null);
        }
      },
    },
    {
      shape: leg,
      count: herd.length * 4,
      write(out, o, t) {
        for (const d of herd) {
          const a = at(d, t);
          const c = Math.cos(a.heading);
          const s = Math.sin(a.heading);
          for (const [hx, hz, ph] of HIPS) {
            const swing = Math.sin(a.gait + ph) * 0.5 * a.walking;
            o = putCopy(out, o, leg,
              a.x + (hx * c - hz * s) * d.size, a.y + 2.05 * d.size, d.z + (hx * s + hz * c) * d.size,
              a.heading, d.size, 0, 0, swing, null);
          }
        }
      },
    },
  ];
}

/** Under water: a few fish that keep circling the plant, in front and behind. */
function circlingKind() {
  const COLOUR = [0.95, 0.72, 0.20];
  const bot = [SURFACE.fish[0], SURFACE.fish[1], SURFACE.fish[2], MAT_ID.fish];
  const shape = shapeOf((mb) => {
    sphereAt(mb, 0, 0, 0, 1, 4, 6, [1, 1, 1], bot, (px) => 0.9 * px * px - 0.42);
    sphereAt(mb, -2, 0, 0, 0.55, 3, 5, [1, 1, 1], bot, (px, py) => -Math.abs(py) * 0.6);
  }, (x) => clamp01((-x - 0.6) / 2.0));
  const N = 9;
  return {
    shape,
    count: N,
    write(out, o, t, plant) {
      const top = plant ? plant.top : 300;
      const cy = Math.max(120, top * 0.55) + Math.sin(t * 0.2) * 80;
      for (let i = 0; i < N; i++) {
        const radius = 280 + (i % 3) * 30;
        const ang = t * 0.32 + i * 0.35;
        const beat = Math.sin(t * Math.PI * 2 * (3 + (i % 4) * 0.4) + i);
        // swimming round: facing along the circle
        o = putCopy(out, o, shape, Math.sin(ang) * radius, cy + (i - N / 2) * 9 + Math.sin(t + i) * 6,
          Math.cos(ang) * radius, -ang + Math.PI, 11, 0, beat * 0.45, 0, COLOUR);
      }
    },
  };
}

const movingByPlace = new Map();

function movingFor(place) {
  const key = `${place.id}:${STYLE}`;
  if (movingByPlace.has(key)) return movingByPlace.get(key);
  const kinds = [];
  if (place.clouds) kinds.push(birdKind(place));
  if (place.underwater !== undefined) kinds.push(fishKind(place), circlingKind());
  if (place.dunes) kinds.push(weedKind(place));
  if (place.clouds && !place.cave) kinds.push(butterflyKind(place));
  if (place.creatures) kinds.push(...deerKinds(place));
  let verts = 0;
  let idx = 0;
  for (const k of kinds) {
    k.first = verts;
    verts += k.count * k.shape.n;
    idx += k.count * k.shape.indices.length;
  }
  const wide = verts > 65535;
  const indices = wide ? new Uint32Array(idx) : new Uint16Array(idx);
  let o = 0;
  for (const k of kinds) {
    for (let c = 0; c < k.count; c++) {
      const base = k.first + c * k.shape.n;
      for (let i = 0; i < k.shape.indices.length; i++) indices[o++] = k.shape.indices[i] + base;
    }
  }
  const m = { kinds, data: new Float32Array(verts * FLOATS_PER_VERTEX), indices, wide };
  movingByPlace.set(key, m);
  return m;
}

/**
 * Everything that moves in this place at time t (seconds), ready to draw.
 * `plant` — { blooms: [[x, y, z], ...], top } — is what the visitors come to.
 */
export function movingAt(place, t = 0, plant = null) {
  const m = movingFor(place);
  if (!m.kinds.length) return null;
  for (const k of m.kinds) k.write(m.data, k.first * FLOATS_PER_VERTEX, t, plant);
  return m;
}

/**
 * The same mesh with its foliage cards moved to the end, and where they start.
 *
 * Cards are drawn by a program of their own, after everything solid, so that
 * the solid world keeps the GPU's early rejection of hidden pixels and so that
 * a card behind a trunk or a hill is thrown away before it is shaded.
 */
function cardsLast(built) {
  const { data, indices } = built;
  const solid = [];
  const cards = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * FLOATS_PER_VERTEX;
    const id = Math.round(data[a + 12]);
    // how near the camera: it always stands out in front, looking down -z
    const near = data[a + 2] + data[indices[i + 1] * FLOATS_PER_VERTEX + 2]
      + data[indices[i + 2] * FLOATS_PER_VERTEX + 2];
    (id === MAT_ID.grass || id === MAT_ID.leaves ? cards : solid).push(near, i);
  }
  // Nearest first, within each. Drawn in the order they were built, a far
  // leaf was as likely to be shaded in full as a near one and then covered —
  // a crown of cards is many layers deep, and in the forest that was most of
  // the frame's time. Nearest first, the depth test throws the hidden layers
  // away before they are shaded.
  const order = (list) => {
    const n = list.length / 2;
    const idx = new Uint32Array(n);
    for (let k = 0; k < n; k++) idx[k] = k;
    idx.sort((x, y) => list[y * 2] - list[x * 2]);
    return idx;
  };
  const out = new indices.constructor(indices.length);
  let o = 0;
  for (const list of [solid, cards]) {
    for (const k of order(list)) {
      const i = list[k * 2 + 1];
      out[o++] = indices[i];
      out[o++] = indices[i + 1];
      out[o++] = indices[i + 2];
    }
  }
  return { ...built, indices: out, cardStart: solid.length / 2 * 3 };
}

export function buildBackdrop(env, view = null, kind = 0) {
  const mb = new MeshBuilder();
  const top = ENV_BY_ID[env?.id]?.sky?.[0]?.[1] || '#b6a894';
  const rgb = hexToLinear(top);
  const place = placeAt(kind);
  const spanX = Math.max(9000, (view?.w || 0) * 1.9);

  // The shell the air is drawn on. It is not something the plant stands in
  // front of any more — it is far enough off to be sky, and everything else in
  // the world stands between it and the camera. Its colour is a function of the
  // direction you look, so its size does not affect what it shows.
  sweep(mb, {
    width: 900000,
    height: 400000,
    wallZ: -SKY_Z,
    floorFront: 200,
    radius: 60000,
    albedo: rgb,
    params: [0.95, 0.0, 0.0, BACKDROP_ID],
    cols: 10,
    rows: 18,
    yBase: -2200,
  });
  if (place.cave) buildCave(mb, place);
  if (place.forest) buildForest(mb, place);
  if (STYLE === 'real') {
    if (place.grass) buildGrass(mb, place);
  } else {
    // Drawn, not grown: ink tufts and flat flowers instead of a lawn of blades.
    const t = TOON_GROUND[place.id];
    if (t) {
      if (t.tufts) buildTufts(mb, place, t.tufts, linear(t.tuft), t.tall || 1);
      if (t.flowers) buildMeadowFlowers(mb, place, t.flowers);
    }
  }
  if (place.underwater !== undefined) {
    buildSurface(mb, place);
  }
  buildMound(mb, place);
  buildTerrain(mb, spanX, place);
  buildRidges(mb, place);
  if (place.water !== undefined) buildWater(mb, place);
  buildClouds(mb, place);
  // (birds are built every frame instead: see buildBirds)
  buildScatter(mb, place);
  return cardsLast(mb.build());
}

function hexToLinear(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
    .map((c) => Math.pow(c, 2.2));
}

export { hexToLinear, ENVIRONMENTS };
