// The illustrated look (v3): colour as a screen print lays it down.
//
// A print has a handful of inks and every shape is one of them. So the world is
// not lit here: each surface takes the ink nearest to the colour it was built
// with, from the place's own set, and the camera pass draws the line round it.
// Nearest is measured in Oklab, where distance is close to how different two
// colours look, with lightness counting for less than hue — a dark green leaf
// should still be printed green, not in the brown that happens to be as dark.

/** sRGB hex to linear RGB, which is what the renderer works in. */
export function linear(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
}

/** Linear RGB to Oklab. */
export function oklab([r, g, b]) {
  const l = Math.cbrt(Math.max(0, 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b));
  const m = Math.cbrt(Math.max(0, 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b));
  const s = Math.cbrt(Math.max(0, 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b));
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/** How much lightness counts against hue when choosing an ink. */
export const LIGHTNESS_WEIGHT = 0.35;

/**
 * How much a colour's hue is exaggerated before its ink is chosen. The world is
 * built in muted colours — a dark olive for a far wooded island — and muted, one
 * sits nearly as close to brown as to green; a printer choosing a screen goes by
 * what hue a thing is, so this pushes each colour out along its own hue first.
 * Greys have no hue to push, and stay grey. The push tapers off as a colour
 * gets as strong as the inks themselves: pushed at full strength, a pale blue
 * ink overshot itself and printed as the deeper blue next to it.
 */
export const CHROMA_BOOST = 1.8;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The nearest ink, as the shader chooses it — for checking offline. */
export function nearestInk(rgb, inks, boost = CHROMA_BOOST) {
  const q0 = oklab(rgb);
  const k = boost + (1 - boost) * smooth(0.05, 0.13, Math.hypot(q0[1], q0[2]));
  const q = [q0[0], q0[1] * k, q0[2] * k];
  let best = Infinity;
  let pick = 0;
  inks.forEach((ink, i) => {
    const p = oklab(linear(ink[1]));
    const dl = (q[0] - p[0]) * LIGHTNESS_WEIGHT;
    const e = dl * dl + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
    if (e < best) { best = e; pick = i; }
  });
  return pick;
}

/** The line every shape is drawn round with. */
export const INK = '#2a1a18';

/**
 * The plant's own inks, the same in every place: it is the subject, and it is
 * printed in the loudest colours there are.
 */
export const PLANT_INKS = [
  ['pink', '#ff5f9e'], ['yellow', '#ffd93b'], ['orange', '#ff8a3d'], ['red', '#f0452b'],
  ['blue', '#3b5fe6'], ['lilac', '#b9a3f0'], ['green', '#35b24f'], ['dark green', '#1f8a3e'],
  ['cream', '#fbf2dd'], ['brown', '#7a4a32'], ['teal', '#2fb3a8'], ['blush', '#ffb3c9'],
];

/** Uniform-ready: linear colours and their Oklab, padded to `n`. */
export function inkUniforms(inks, n = 12) {
  const rgb = [];
  const lab = [];
  for (let i = 0; i < n; i++) {
    const ink = inks[Math.min(i, inks.length - 1)];
    const c = linear(ink[1]);
    const o = oklab(c);
    rgb.push(...c);
    lab.push(o[0] * LIGHTNESS_WEIGHT, o[1], o[2]);
  }
  return { rgb: new Float32Array(rgb), lab: new Float32Array(lab), count: Math.min(n, inks.length) };
}

/** Between two linear colours. */
export const mixLinear = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
