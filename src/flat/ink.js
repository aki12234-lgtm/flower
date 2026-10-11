// Colour as a screen print lays it down, for the flat renderer.
//
// The rules are the illustrated look's own (see toon.js and the print block in
// renderer3d.js's scene shader), word for word. The difference is only where
// they run: the shader chose an ink for every pixel of every frame, and here an
// ink is chosen once for a whole shape, when the shape is built.

import { linear, oklab, LIGHTNESS_WEIGHT, PLANT_INKS, INK } from '../gl/toon.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** How much darker a full second pass leaves an ink (OVERPRINT in the shader). */
export const OVERPRINT = 0.48;

/** A set of inks to choose from: each one's linear colour and weighted Oklab. */
export function inkSet(inks) {
  return inks.map(([name, hex]) => {
    const rgb = linear(hex);
    const lab = oklab(rgb);
    return { name, hex, rgb, lab: [lab[0] * LIGHTNESS_WEIGHT, lab[1], lab[2]] };
  });
}

export const PLANT_SET = inkSet(PLANT_INKS);
export const LINE = linear(INK);

/**
 * The nearest ink, the way a printer would choose which screen a colour goes
 * on: by hue first, with a muted colour pushed out along its own hue so a dark
 * olive prints green rather than brown. The plant's colours are pushed less
 * than the world's, and the world's are tinted towards the place's inks first.
 */
export function inkFor(c, set, plant = false, tint = null) {
  const rgb = !plant && tint ? [c[0] * tint[0], c[1] * tint[1], c[2] * tint[2]] : c;
  const q = oklab(rgb);
  const k = (plant ? 1.3 : 1.8) + (1 - (plant ? 1.3 : 1.8)) * smooth(0.05, 0.13, Math.hypot(q[1], q[2]));
  const l = q[0] * LIGHTNESS_WEIGHT;
  const a = q[1] * k;
  const b = q[2] * k;
  let best = Infinity;
  let pick = set[0];
  for (const ink of set) {
    const e = (l - ink.lab[0]) ** 2 + (a - ink.lab[1]) ** 2 + (b - ink.lab[2]) ** 2;
    if (e < best) { best = e; pick = ink; }
  }
  return pick;
}

/**
 * The evening, in the inks: the world goes over to a night print, each ink
 * towards a blue-violet of its own lightness, and the plant keeps more of its
 * own colour than the world does.
 */
export function atNight(c, n, world) {
  if (n <= 0) return c;
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const keep = world ? 0.3 : 0.6;
  const night = [0.55, 0.60, 1.25].map((k, i) => (lum * k + (c[i] - lum * k) * keep) * 0.6);
  const t = n * (world ? 0.9 : 0.45);
  return c.map((v, i) => v + (night[i] - v) * t);
}

/** A second, darker pass of the same ink, `over` of the way to a full one. */
export const overprint = (c, over) => c.map((v) => v * (1 - OVERPRINT * over));

/** Linear colour to CSS, through the same curve the camera pass ends with. */
export function css(c) {
  const g = (v) => Math.round(255 * Math.min(1, Math.max(0, v)) ** (1 / 2.2));
  return `rgb(${g(c[0])},${g(c[1])},${g(c[2])})`;
}

/** Between two linear colours. */
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

export { linear };
