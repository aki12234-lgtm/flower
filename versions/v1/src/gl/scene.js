// Building the scene from the plant.
//
// The whole organism becomes one interleaved vertex buffer, rebuilt only when a
// section is added. Materials stop being drawing routines and become surface
// parameters — roughness, metalness, how much light passes through — which is
// what lets clay, wax, glass and metal differ the way they actually differ
// rather than by having different textures painted on them.

import { makeRng, clamp, clamp01, lerp, noise2 } from '../rng.js';
import { MATERIAL_BY_ID, MATERIALS, nodeOutlines, stemProfile, roundCorners } from '../materials.js';
import { ENV_BY_ID, ENVIRONMENTS } from '../environment.js';
import { MeshBuilder, tube, sphere, shard, blade, sheet, sweep, depthAt } from './meshes.js';

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

/** Build the whole plant as one mesh. */
export function buildPlant(plant, reveal = null) {
  const mb = new MeshBuilder();
  const flowerHue = flowerHueFor(plant);

  for (const section of plant.sections) {
    // the section currently growing is built only as far as it has got
    const growing = reveal && section.step === reveal.step;
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
      const segZ = depthAt(pts[0].x, pts[0].y, salt) + seg.depth * 7;
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
        return {
          x: p.x,
          y: p.y,
          z: segZ,
          r: p.w * 0.5 * flare * (1 + nodeAt[i] * 0.22),
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
    }

    // ---- blooms ----
    const bcolBase = col;
    for (const node of section.nodes) {
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
      const brgb = hslToRgb(B.h, B.s, B.l);
      const z = depthAt(n.x, n.y, salt);
      const parts = nodeOutlines(n.kind, n.size, makeRng(n.seed));
      const bloomSurf = layered(z);

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
      const petiole = (frac) => {
        const len = n.size * frac;
        const tip = [
          n.x + stemDir[0] * len, n.y + stemDir[1] * len, z + stemDir[2] * len,
        ];
        tube(mb, [
          { x: n.x, y: n.y, z, r: n.size * 0.050 },
          { x: tip[0], y: tip[1], z: tip[2], r: n.size * 0.038 },
        ], 7, () => rgb, () => bloomSurf);
        return tip;
      };

      // the head's own orientation in space
      const tilt = ((n.seed >> 3) % 1000) / 1000;
      const spin = (((n.seed >> 13) % 1000) / 1000) * Math.PI * 2;
      const face = rot(rot([0, 0, 1], [0, 1, 0], spin), [1, 0, 0], -0.5 - tilt * 0.9);
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
          { x: n.x, y: n.y, z, r: n.size * 0.055 },
          { x: hub[0], y: hub[1], z: hub[2], r: n.size * 0.042 },
        ], 7, () => rgb, () => bloomSurf);

        for (const part of parts) {
          if (!part.sphere) continue;
          const b = part.sphere;
          const bz = z + (b.depth - 0.5) * n.size * 0.9;
          tube(mb, [
            { x: hub[0], y: hub[1], z: hub[2], r: n.size * 0.030 },
            { x: n.x + b.x, y: n.y + b.y, z: bz, r: n.size * 0.024 },
          ], 6, () => rgb, () => bloomSurf);
        }

        for (const part of parts) {
          if (!part.sphere) continue;
          const s = part.sphere;
          sphere(mb, n.x + s.x, n.y + s.y, z + (s.depth - 0.5) * n.size * 0.9,
            s.r, 9, 12, brgb, bloomSurf, relief);
        }
        continue;
      }

      // A spike is a dense head of tiny florets packed round a stalk — a
      // bulrush, a plantain, a grass in seed. It was a flat blade, which is a
      // leaf shape, and read as one: the thing that makes a spike a spike is
      // that it is round and packed, and it stands on its own bare stem.
      if (n.kind === 'spike') {
        const bare = petiole(0.55);
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
        let hang = [
          stemDir[0] * 0.35, stemDir[1] * 0.35 - 0.9, stemDir[2] * 0.35,
        ];
        const hl = Math.hypot(hang[0], hang[1], hang[2]) || 1;
        hang = [hang[0] / hl, hang[1] / hl, hang[2] / hl];
        const neck = petiole(0.42);
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
        const cy = n.size * 0.52;
        const core = [
          stalk[0] + stemDir[0] * cy, stalk[1] + stemDir[1] * cy, stalk[2] + stemDir[2] * cy,
        ];
        sphere(mb, core[0], core[1], core[2], n.size * 0.34, 9, 12, brgb, bloomSurf, relief);
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
        sphere(mb, stalk[0], stalk[1], stalk[2], n.size * 0.26, 10, 12, brgb, bloomSurf, relief);
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
          seat[2] + face2[2] * r * 0.30, r * 0.30, 8, 10,
          [brgb[0] * 0.28, brgb[1] * 0.26, brgb[2] * 0.24], bloomSurf);
        continue;
      }

      if (n.kind === 'trumpet') {
        const stalk = petiole(0.30);
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
          { x: n.x, y: n.y, z, r: n.size * 0.060 },
          { x: head[0], y: head[1], z: head[2], r: n.size * 0.046 },
        ], 7, () => rgb, () => bloomSurf);
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
        const dark = [brgb[0] * 0.22, brgb[1] * 0.20, brgb[2] * 0.18];
        sphere(mb,
          head[0] + sideDir[0] * ox + stemDir[0] * oy,
          head[1] + sideDir[1] * ox + stemDir[1] * oy,
          head[2] + face[2] * fs2.r,
          fs2.r * 1.1, 5, 6, dark, [0.55, 0, 0.05]);
      }
      // the receptacle, where the petals actually attach
      if (calyxPart) {
        sphere(mb, head[0], head[1], head[2], n.size * 0.20, 7, 9,
          hslToRgb(col.h, col.s * 0.9, col.l * 0.8), bloomSurf);
      }
    }
  }

  return mb.build();
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
    note: 'grass, hedges, open sky',
    ground: [0.24, 0.42, 0.16],
    swell: [520, 110, 18],           // three scales of relief
    props: ['tuft', 'tuft', 'tuft', 'bush', 'tree', 'stone'],
    density: 1.25,
    grass: true,
    clouds: 1,
  },
  {
    id: 'beach',
    note: 'sand, then the sea',
    ground: [0.80, 0.70, 0.50],
    swell: [130, 60, 14],            // beaches are flat; the dunes are behind you
    props: ['stone', 'driftwood', 'tuft'],
    density: 0.5,
    water: -3000,                    // the shoreline, in z
    clouds: 1,
  },
  {
    id: 'ocean',
    note: 'under it, on the reef',
    ground: [0.44, 0.40, 0.30],      // pale sand, which is what a reef floor is
    swell: [160, 70, 18],
    props: ['coral', 'coral', 'coral', 'stone', 'weed'],
    density: 1.5,
    // Not a bar with the sea beyond it, and not standing on the surface: under
    // it. The camera is in the water, the surface is a ceiling of light a long
    // way overhead, and the plant grows up towards it through fish and coral.
    underwater: 5200,                // where the surface is
    clouds: 0,
  },
  {
    id: 'cave',
    note: 'rock on every side',
    ground: [0.105, 0.098, 0.094],
    rockFloor: true,
    swell: [180, 90, 26],
    props: ['stalagmite', 'stone', 'stone'],
    density: 0.9,
    cave: true,
    clouds: 0,
  },
  {
    id: 'forest',
    note: 'trunks, moss and mushrooms',
    ground: [0.13, 0.20, 0.09],      // moss and needle litter, in shade
    swell: [280, 120, 22],
    props: ['fern', 'fern', 'moss', 'moss', 'mushroom', 'mushroom', 'log',
      'sapling', 'bush', 'stone'],
    density: 2.0,
    forest: true,
    creatures: true,
    clouds: 0.3,
  },
  {
    id: 'dunes',
    note: 'sand, and more of it',
    ground: [0.84, 0.70, 0.44],
    swell: [620, 150, 16],
    props: ['scrub', 'stone'],
    density: 0.45,
    dunes: true,
    clouds: 0.6,
  },
];

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
function groundHeight(x, z, place) {
  const d = Math.hypot(x, z);
  const settle = clamp01((d - 2600) / 7000);
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
  }
  return h * settle;
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
      let v = 0.42 + patch * 0.30 + drift * 0.19 + mottle * 0.22;
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

  const waveAt = (x, z) => Math.sin(x * 0.0042 + z * 0.0016) * 5
    + Math.sin(x * 0.0011 - z * 0.0037) * 8
    + (noise2(x * 0.0025, z * 0.0025, 23) - 0.5) * 9;

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
      // Foam where the water is shallow enough to be breaking on the sand.
      const surfy = place.seabed !== undefined ? 0
        : clamp01(1 - Math.abs(z - nearZ) / 700)
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
  const banks = Math.round(16 * place.clouds);
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
    const high = b % 2 === 1;
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
  const rows = 64;
  const zNear = 4200;
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
    sphere(mb, x, y + r * 0.2, z, r, 5, 8, [0.19, 0.17, 0.15], surf,
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
        sphere(mb, x, y + r * 0.16, z, w, 4, 6, [0.36, 0.34, 0.31], stone,
          (px, py, pz) => (noise2(px * 0.05, pz * 0.05, 8) - 0.5) * w * 0.45
            - Math.max(0, py - y) * 0.55);
      }
    } else if (what === 'bush' || what === 'scrub') {
      const lobes = what === 'scrub' ? 2 : 3 + Math.floor(rng.range(0, 3));
      const w = r * (what === 'scrub' ? 0.8 : 1.4);
      for (let k = 0; k < lobes; k++) {
        const a = (k / lobes) * Math.PI * 2 + rng.range(0, 1);
        const rad = w * rng.range(0.42, 0.72);
        sphere(mb, x + Math.cos(a) * w * rng.range(0.1, 0.55), y + rad * rng.range(0.55, 0.95),
          z + Math.sin(a) * w * rng.range(0.1, 0.55), rad, 4, 6,
          what === 'scrub' ? [0.34, 0.33, 0.17] : [0.21, 0.36, 0.13], bot);
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
        sphere(mb, mx, my + h, mz, wide, 4, 7, cap, bot,
          (px, py) => -Math.max(0, py - (my + h)) * 0.65);
      }
    } else if (what === 'moss') {
      // A low green cushion, half over whatever it is growing on.
      for (let k = 0; k < 3; k++) {
        const a = rng.range(0, Math.PI * 2);
        const d = r * rng.range(0, 0.7);
        const rad = r * rng.range(0.5, 0.9);
        sphere(mb, x + Math.cos(a) * d, y + rad * 0.18, z + Math.sin(a) * d, rad, 4, 6,
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
        sphere(mb, x + lean * h + Math.cos(a) * rad * 0.8, y + h - rng.range(0, r),
          z + Math.sin(a) * rad * 0.8, rad, 4, 6, [0.20, 0.38, 0.13], bot);
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
        sphere(mb, x + lean * h + Math.cos(a) * crown * 0.5,
          y + h + crown * rng.range(0.1, 0.5), z + Math.sin(a) * crown * 0.5,
          crown * rng.range(0.55, 0.85), 5, 7, [0.17, 0.31, 0.12], bot);
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

  const count = Math.round(150 * place.density);
  for (let i = 0; i < count; i++) {
    const z = -700 - rng.range(0, 3400);
    const x = rng.range(-1, 1) * 2400;
    if (Math.abs(x) < 300 && z > -1100) continue;     // not on top of the plant
    put(x, z, 9 + rng.range(0, 22), props[Math.floor(rng.range(0, props.length))]);
  }
  for (let i = 0; i < count; i++) {
    const z = -900 - rng.range(0, 7000);
    const away = Math.abs(z / FAR_Z);
    const x = rng.range(-1, 1) * (1800 + away * 11000);
    if (Math.abs(x) < 320 && z > -900) continue;
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
    tube(mb, trunk, 6, () => [0.19, 0.15, 0.11], () => bark);

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
      tube(mb, arm, 4, () => [0.19, 0.15, 0.11], () => bark);

      const tip = [bx + Math.cos(a) * reach, by + reach * 0.9, z + Math.sin(a) * reach];
      for (let q = 0; q < 2; q++) {
        const rad = reach * rng.range(0.34, 0.58);
        sphere(mb,
          tip[0] + rng.range(-rad, rad) * 0.7,
          tip[1] + rng.range(-rad * 0.4, rad * 0.8),
          tip[2] + rng.range(-rad, rad) * 0.7,
          rad, 4, 6, [0.14, 0.27, 0.10], leaf);
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
    const spread = away * rng.range(0.02, 0.30);
    const x = (rng.range(0, 1) < 0.5 ? -1 : 1) * spread;
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
 */
function buildGrass(mb, place) {
  const rng = makeRng(6120);
  const frond = [SURFACE.frond[0], SURFACE.frond[1], SURFACE.frond[2], MAT_ID.frond];
  for (let i = 0; i < 2200; i++) {
    // Thickest where the eye is, thinning out to where a blade stops being
    // resolvable anyway.
    const away = 900 + rng.range(0, 1) ** 2 * 7000;
    const x = rng.range(-0.5, 0.5) * away * 1.4;
    const z = -away * 0.75;
    if (Math.abs(x) < 240 && z > -1600) continue;      // not in front of the plant
    const y = groundHeight(x, z, place);
    const r = 4 + away * 0.0032;
    const h = r * rng.range(1.6, 3.4);
    const lean = rng.range(0, Math.PI * 2);
    const bow = rng.range(0.25, 0.75);
    const g = [0.22 + rng.range(0, 0.1), 0.40 + rng.range(0, 0.14), 0.11];
    tube(mb, [
      { x:x, y: y - r, z: z, r: r * 0.22 },
      { x:x + Math.cos(lean) * h * bow * 0.35, y: y + h * 0.62, z:
        z + Math.sin(lean) * h * bow * 0.35, r: r * 0.13 },
      { x:x + Math.cos(lean) * h * bow, y: y + h, z: z + Math.sin(lean) * h * bow, r: r * 0.02 },
    ], 3, () => g, () => frond);
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
    sphere(mb, Math.cos(a) * d, y0 - r * 0.52, Math.sin(a) * d, r, 6, 9,
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
      mb.push([x, y, z], [nx / len, -(2 * e) / len, nz / len],
        [0.10 + glint * 0.55, 0.30 + glint * 0.6, 0.42 + glint * 0.5], surf,
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

/** Fish, in schools, because one fish on its own reads as a mistake. */
function buildFish(mb, place) {
  const rng = makeRng(9001);
  const bot = [SURFACE.fish[0], SURFACE.fish[1], SURFACE.fish[2], MAT_ID.fish];
  for (let school = 0; school < 9; school++) {
    const cz = -900 - rng.range(0, 11000);
    const away = -cz;
    const cx = rng.range(-1, 1) * away * 0.28;
    const cy = groundHeight(cx, cz, place) + rng.range(400, place.underwater * 0.8);
    const hue = rng.range(0, 1);
    const col = hue < 0.4 ? [0.62, 0.44, 0.12] : hue < 0.75 ? [0.30, 0.36, 0.42] : [0.52, 0.24, 0.14];
    const n = 9 + Math.floor(rng.range(0, 14));
    const size = 14 + away * 0.004;
    for (let i = 0; i < n; i++) {
      const x = cx + rng.range(-1, 1) * size * 14;
      const y = cy + rng.range(-1, 1) * size * 7;
      const z = cz + rng.range(-1, 1) * size * 14;
      // a body and a tail, at the size a fish is when you notice it
      sphere(mb, x, y, z, size, 4, 6, col, bot,
        (px) => -Math.abs(px - x) * 0.35);
      sphere(mb, x + size * 1.5, y, z, size * 0.5, 3, 5, col, bot);
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
      sphere(mb, x + Math.cos(a) * d, y + r * 0.3, z + Math.sin(a) * d,
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
/**
 * Whatever else is in the wood.
 *
 * A forest with nothing moving through it is a diagram of trees. These are at
 * the size and distance you actually see an animal in one — far enough that it
 * is a shape rather than a species, standing still and mostly hidden — which is
 * also the only size at which four spheres and a tube are convincing.
 */
function buildCreatures(mb, place) {
  const rng = makeRng(8154);
  const hide = [SURFACE.thicket[0], SURFACE.thicket[1], SURFACE.thicket[2], MAT_ID.thicket];

  for (let i = 0; i < 7; i++) {
    const away = 3000 + rng.range(0, 9000);
    const z = 2400 - away;
    const x = (rng.range(0, 1) < 0.5 ? -1 : 1) * away * rng.range(0.05, 0.26);
    const y = groundHeight(x, z, place);
    const s = away * 0.010;                       // held to a constant angular size
    const coat = rng.range(0, 1) < 0.5 ? [0.30, 0.20, 0.13] : [0.22, 0.17, 0.14];
    const face = rng.range(0, Math.PI * 2);
    const fx = Math.cos(face);
    const fz = Math.sin(face);

    // body, neck, head — the three masses that make an animal read as one
    sphere(mb, x, y + s * 2.2, z, s * 1.15, 5, 7, coat, hide,
      (px) => -Math.abs(px - x) * 0.18);
    tube(mb, [
      { x: x + fx * s * 0.9, y: y + s * 2.5, z: z + fz * s * 0.9, r: s * 0.34 },
      { x: x + fx * s * 1.7, y: y + s * 3.4, z: z + fz * s * 1.7, r: s * 0.26 },
    ], 5, () => coat, () => hide);
    sphere(mb, x + fx * s * 2.0, y + s * 3.6, z + fz * s * 2.0, s * 0.44, 4, 6, coat, hide);

    // legs
    for (let k = 0; k < 4; k++) {
      const lx = x + fx * s * (k < 2 ? 0.7 : -0.7) + fz * s * (k % 2 ? 0.42 : -0.42);
      const lz = z + fz * s * (k < 2 ? 0.7 : -0.7) - fx * s * (k % 2 ? 0.42 : -0.42);
      tube(mb, [
        { x: lx, y: y + s * 1.9, z: lz, r: s * 0.16 },
        { x: lx, y: y, z: lz, r: s * 0.10 },
      ], 4, () => coat, () => hide);
    }
  }
}

/**
 * Birds.
 *
 * They were two strokes drawn on the atmosphere shell, which stands a hundred
 * and fifty thousand units off — so they were always the same distance away and
 * always the same few degrees above the horizon, whatever the camera did. That
 * is fine as a hint that the air is occupied and useless as something to climb
 * past. These are in the air itself, at heights the plant reaches, in loose
 * skeins: a body and two swept wings, which at any distance you will see one
 * from is the whole of a bird.
 */
function buildBirds(mb, place) {
  if (!place.clouds) return;
  const rng = makeRng(6613);
  const dark = [SURFACE.wing[0], SURFACE.wing[1], SURFACE.wing[2], MAT_ID.wing];

  for (let flock = 0; flock < 7; flock++) {
    const away = 1800 + rng.range(0, 1) ** 1.6 * 26000;
    const cz = -away;
    const cy = 700 + rng.range(0, 1) ** 0.8 * 15000;
    const cx = rng.range(-1, 1) * away * 0.5;
    const size = away * 0.006;
    const n = 3 + Math.floor(rng.range(0, 6));
    const heading = rng.range(0, Math.PI * 2);

    for (let i = 0; i < n; i++) {
      // strung out behind one another, the way a skein actually flies
      const t = i / Math.max(1, n - 1) - 0.5;
      const x = cx + Math.cos(heading) * t * size * 22 + rng.range(-1, 1) * size * 5;
      const y = cy + rng.range(-1, 1) * size * 6;
      const z = cz + Math.sin(heading) * t * size * 22 + rng.range(-1, 1) * size * 5;
      const beat = rng.range(-0.3, 0.55);              // where in the stroke it is

      sphere(mb, x, y, z, size * 0.42, 3, 5, [0.17, 0.16, 0.17], dark);
      for (const w of [-1, 1]) {
        const wx = Math.cos(heading + Math.PI / 2) * w;
        const wz = Math.sin(heading + Math.PI / 2) * w;
        tube(mb, [
          { x: x, y: y, z: z, r: size * 0.16 },
          { x: x + wx * size * 1.1, y: y + size * beat * 0.6, z: z + wz * size * 1.1,
            r: size * 0.11 },
          { x: x + wx * size * 2.2, y: y + size * beat * 1.5, z: z + wz * size * 2.2,
            r: size * 0.03 },
        ], 4, () => [0.15, 0.14, 0.15], () => dark);
      }
    }
  }
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
  if (place.grass) buildGrass(mb, place);
  if (place.creatures) buildCreatures(mb, place);
  if (place.underwater !== undefined) { buildSurface(mb, place); buildFish(mb, place); }
  buildMound(mb, place);
  buildTerrain(mb, spanX, place);
  if (place.water !== undefined) buildWater(mb, place);
  buildClouds(mb, place);
  buildBirds(mb, place);
  buildScatter(mb, place);
  return mb.build();
}

function hexToLinear(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
    .map((c) => Math.pow(c, 2.2));
}

export { hexToLinear, ENVIRONMENTS };
