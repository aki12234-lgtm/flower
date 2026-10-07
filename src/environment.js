// The environment / scene system.
//
// Deliberately decoupled from materials. A wool section and a wireframe section
// can share a sky; a photoreal stem can pass through fog, then sea, then space.
// The selection weights below use a different read of the hidden values than
// materials.js does, so neither system predicts the other.
//
// Environments are laid down as bands over world-y ranges. Adjacent bands
// crossfade over FADE world units, which is what lets a scene "evolve over
// several turns" while material changes stay abrupt.

import { clamp01, lerp } from './rng.js';

// Long, so a change of scene is a drift rather than a seam. At 150 the boundary
// compressed into a hard horizontal smear across the frame.
export const FADE = 520;

// Backdrops, not skies.
//
// The reference photographs put these constructions against a plain swept
// ground: one colour, a soft falloff, one light. An earlier version had
// dramatic five-stop skies with big value ranges, and they competed with the
// plant instead of holding it — the organism is the subject, and a background
// doing this much work is a background you are looking at.
//
// So each ramp stays within roughly fifteen points of lightness, shifts hue only
// slightly across that, and carries one soft light source in screen space.
export const ENVIRONMENTS = [
  {
    id: 'soil', name: 'Ground',
    sky: [[0, '#b6a894'], [0.4, '#ab9d89'], [0.75, '#9e907c'], [1, '#8e806d']],
    glow: { x: 0.30, y: 0.10, r: 1.4, color: '#ffeed2', strength: 0.11 },
    ground: true, ink: '#2b2620', light: '#f0e2c9', particles: { kind: 'dust', rate: 0.06 },
  },
  {
    id: 'meadow', name: 'Open air',
    sky: [[0, '#b9c3ae'], [0.4, '#c2cab5'], [0.75, '#bcc3ad'], [1, '#adb69f']],
    glow: { x: 0.26, y: 0.16, r: 1.3, color: '#fdf6dd', strength: 0.14 },
    ink: '#2c332c', light: '#f7f0da', particles: { kind: 'pollen', rate: 0.11 },
  },
  {
    id: 'fog', name: 'Fog',
    sky: [[0, '#c3c1bc'], [0.4, '#bcbab5'], [0.75, '#b4b2ae'], [1, '#a9a8a6']],
    glow: { x: 0.5, y: 0.28, r: 1.6, color: '#f2efe7', strength: 0.15 },
    ink: '#3a3c3c', light: '#e6e4dd', particles: { kind: 'mist', rate: 0.17 }, veil: 0.14,
  },
  {
    id: 'rain', name: 'Rain',
    sky: [[0, '#8b95a0'], [0.4, '#828d98'], [0.75, '#78838e'], [1, '#6c7681']],
    glow: { x: 0.68, y: 0.12, r: 1.3, color: '#dde6ee', strength: 0.09 },
    ink: '#20262c', light: '#ccd6de', particles: { kind: 'rain', rate: 0.32 }, veil: 0.07,
  },
  {
    id: 'sea', name: 'Underwater',
    sky: [[0, '#3c6d72'], [0.4, '#356367'], [0.75, '#2d585d'], [1, '#264d53']],
    glow: { x: 0.42, y: 0.02, r: 1.5, color: '#a9e2d9', strength: 0.15 },
    ink: '#bfe6e0', light: '#8fd6cf', particles: { kind: 'motes', rate: 0.15 }, veil: 0.12, dark: true,
  },
  {
    id: 'desert', name: 'Dry light',
    sky: [[0, '#d9bb99'], [0.4, '#dcbe9b'], [0.75, '#d0b18f'], [1, '#c1a281']],
    glow: { x: 0.70, y: 0.22, r: 1.15, color: '#ffeec8', strength: 0.19 },
    ink: '#4a3a28', light: '#fbecd0', particles: { kind: 'dust', rate: 0.19 },
  },
  {
    id: 'dusk', name: 'Late light',
    sky: [[0, '#8a7590'], [0.4, '#a2808a'], [0.75, '#b58d80'], [1, '#a67d70']],
    glow: { x: 0.30, y: 0.58, r: 1.1, color: '#ffcfa2', strength: 0.20 },
    ink: '#2e2436', light: '#f4cead', particles: { kind: 'pollen', rate: 0.08 },
  },
  {
    id: 'night', name: 'Night',
    sky: [[0, '#333d4e'], [0.4, '#2d3646'], [0.75, '#28303e'], [1, '#222a36']],
    glow: { x: 0.74, y: 0.18, r: 0.75, color: '#d3ddf5', strength: 0.17 },
    ink: '#cdd6e4', light: '#9fb2cf', particles: { kind: 'motes', rate: 0.06 }, dark: true,
  },
  {
    id: 'stars', name: 'Stars',
    sky: [[0, '#1f2740'], [0.4, '#1b2239'], [0.75, '#171d31'], [1, '#131829']],
    glow: { x: 0.5, y: 0.40, r: 1.7, color: '#41508a', strength: 0.11 },
    ink: '#dee6f5', light: '#b9c8ea', particles: { kind: 'stars', rate: 0.24 }, dark: true,
  },
  {
    id: 'storm', name: 'Storm',
    sky: [[0, '#5b5f6b'], [0.4, '#545863'], [0.75, '#4c505b'], [1, '#434752']],
    glow: { x: 0.36, y: 0.14, r: 1.35, color: '#bcc3d6', strength: 0.10 },
    ink: '#d8dae2', light: '#c3c8d6', particles: { kind: 'rain', rate: 0.45 }, veil: 0.09, dark: true, flash: true,
  },
  {
    id: 'space', name: 'Outside',
    sky: [[0, '#14131f'], [0.4, '#111019'], [0.75, '#0e0d15'], [1, '#0b0a11']],
    glow: { x: 0.62, y: 0.36, r: 1.5, color: '#39306a', strength: 0.13 },
    ink: '#e6e6f2', light: '#aeb0c8', particles: { kind: 'stars', rate: 0.35 }, dark: true,
  },
  {
    id: 'void', name: 'Nothing in particular',
    sky: [[0, '#efeae1'], [0.4, '#eae5db'], [0.75, '#e4ded3'], [1, '#dcd5c9']],
    glow: { x: 0.5, y: 0.26, r: 1.6, color: '#ffffff', strength: 0.12 },
    ink: '#2a2622', light: '#ffffff', particles: { kind: 'none', rate: 0.00 },
  },
];

export const ENV_BY_ID = Object.fromEntries(ENVIRONMENTS.map((e) => [e.id, e]));

const MIN_HOLD = 3;

/**
 * Choose the environment for the next section.
 *
 * Reads the values differently from materials.js on purpose: this is about
 * exposure and altitude of feeling, not about substance. The scene is also
 * sticky, so it reads as a place rather than a slideshow.
 */
export function chooseEnvironment(rng, values, derived, ctx) {
  const { expansion: E, stability: S, openness: O, attachment: A, intensity: I, order: R } = values;
  const held = ctx.envHold || 0;
  const current = ctx.envId;

  if (held < MIN_HOLD) return current;

  // Pressure to move somewhere else builds the longer we stay.
  const restlessness = clamp01((held - MIN_HOLD) / 6) * 0.55 + derived.volatility * 0.30 + I * 0.15;
  if (!rng.chance(restlessness)) return current;

  const w = {
    soil: 1.2 + A * 1.5 + S * 0.8 - E * 0.9,
    meadow: 1.0 + O * 1.0 + S * 0.7 - I * 0.5,
    fog: 0.7 + derived.volatility * 1.2 + (1 - R) * 0.7 - O * 0.3,
    rain: 0.6 + I * 0.9 + A * 0.6 - S * 0.4,
    sea: 0.5 + A * 1.2 + (1 - E) * 0.8 + derived.tensionBond * 0.7,
    desert: 0.5 + (1 - O) * 0.9 + R * 0.7 - A * 0.5,
    dusk: 0.7 + derived.tensionGrowth * 1.0 + A * 0.5,
    night: 0.6 + (1 - O) * 0.8 + I * 0.6,
    stars: 0.4 + E * 1.1 + O * 0.8 - A * 0.6,
    storm: 0.25 + I * 1.5 + derived.volatility * 1.0 - S * 0.8,
    space: 0.2 + E * 1.4 + O * 0.9 - A * 1.0 - S * 0.4,
    void: 0.35 + derived.extremity * 0.9 + (1 - I) * 0.5,
  };
  // Never immediately repeat, and prefer somewhere we have not been recently.
  const recent = new Set((ctx.envRecent || []).slice(-3));
  const pool = ENVIRONMENTS.filter((e) => e.id !== current);
  return rng.weighted(pool, (e) => Math.max(0.05, w[e.id]) * (recent.has(e.id) ? 0.25 : 1)).id;
}

/**
 * Build the list of world-y bands from the section list.
 * Bands are ordered bottom to top and painted in that order, so each band's
 * lower fade is drawn over the one beneath it.
 */
export function buildBands(sections) {
  const bands = [];
  for (const s of sections) {
    const id = s.envId || 'soil';
    const top = s.bounds ? s.bounds.maxY : 0;
    const bottom = s.bounds ? s.bounds.minY : 0;
    const last = bands[bands.length - 1];
    if (last && last.id === id) {
      last.top = Math.max(last.top, top);
      last.bottom = Math.min(last.bottom, bottom);
    } else {
      bands.push({ id, top, bottom: last ? last.top : Math.min(bottom, -400) });
    }
  }
  if (!bands.length) bands.push({ id: 'soil', bottom: -400, top: 400 });
  bands[0].bottom = Math.min(bands[0].bottom, -600);
  bands[bands.length - 1].top += 1400; // keep painting above the newest growth
  return bands;
}

/** Blend factor for band `i` at world y, 0..1. */
export function bandWeight(bands, i, y) {
  const b = bands[i];
  const lower = i === 0 ? -Infinity : b.bottom;
  if (y < lower - FADE) return 0;
  if (y < lower + FADE) return clamp01((y - (lower - FADE)) / (FADE * 2));
  return 1;
}

/** The environment that most fills the given world-y span, for ambient effects. */
export function dominantEnv(bands, yLow, yHigh) {
  let best = bands[0];
  let bestOverlap = -1;
  for (const b of bands) {
    const o = Math.min(b.top, yHigh) - Math.max(b.bottom, yLow);
    if (o > bestOverlap) { bestOverlap = o; best = b; }
  }
  return ENV_BY_ID[best.id] || ENVIRONMENTS[0];
}

/** Linear blend between two environments' ink colours, for cross-band tinting. */
export function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

// ---------------------------------------------------------------- the world --
//
// The scene above is the light and the air. This is what manner the world is in
// at the moment. Where it is — the place itself, its ground and what grows on
// it — is built geometry and lives with the rest of the world, in gl/scene.js.
//
// The two are on separate clocks and neither is on the plant's. A scene band is
// keyed to height, so it drifts as the organism climbs; the ground is fixed by
// the seed for the whole game; and the manner turns over on time alone, which
// is what makes it read as weather rather than as a consequence.

/**
 * The manners the world can be in.
 *
 * `idiom` is a material id from MAT_ID: 0 is the world as it is, lit and solid,
 * and anything else hands the ground, the air, the cloud and the far growth
 * that material's id, so every stage after treats the whole place as a drawing.
 * Lit comes up more often than any single drawing because it is the ground
 * state — but not so much more that a session is mostly one thing.
 */
export const WORLD_ERAS = [
  { idiom: 0, id: 'lit', note: 'solid' },
  { idiom: 41, id: 'lineart' },
  { idiom: 42, id: 'grain' },
  { idiom: 45, id: 'halftone' },
  { idiom: 46, id: 'dither' },
  { idiom: 52, id: 'blueprint' },
  { idiom: 53, id: 'riso' },
  { idiom: 55, id: 'smoke' },
  { idiom: 56, id: 'stipple' },
  { idiom: 57, id: 'blockprint' },
];

// Weighted so the world is itself about half the time.
const ERA_DRAW = [0, 0, 0, 0, 0, 0, 0, 0, 0, 41, 42, 45, 46, 52, 53, 55, 56, 57];

/** How long one era lasts, at its shortest, and how much longer it can run. */
const ERA_MIN = 42;
const ERA_SPAN = 38;

/**
 * Which manner the world is in, at a given moment.
 *
 * Indexed by which era we are in rather than by anything the player has done —
 * that is the whole point of it. Long eras: a background that turns over is a
 * different and much better idea than one that flickers.
 */
export function worldEra(nowMs) {
  let t = nowMs / 1000;
  let i = 0;
  for (;;) {
    const len = ERA_MIN + (((Math.sin(i * 12.9898 + 4.1) * 43758.5453) % 1) + 1) / 2 * ERA_SPAN;
    if (t < len) break;
    t -= len;
    i++;
    if (i > 4096) break;                    // a long session is not a hang
  }
  // The first era is always the world as itself. The clock starts when the page
  // loads, so whatever the first era drew was every player's first sight of the
  // game, every time — and it drew riso: a magenta print of a place nobody had
  // yet seen as it is.
  if (i === 0) return 0;
  return ERA_DRAW[Math.abs(Math.round(Math.sin(i * 78.233 + 1.7) * 43758.5453)) % ERA_DRAW.length];
}
