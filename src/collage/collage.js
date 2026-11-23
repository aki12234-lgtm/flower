// Collage: the scene cut out of paper and stuck down.
//
// The pieces are cut to the flat picture (the illustrated look's, drawn out of
// sight): every shape in it is one ink, so every run of one ink is one piece
// of paper, and there are as many pieces as there are things, not as many as
// there are shades of light. Its lines are not drawn at all: a collage has no
// outlines, only edges where one sheet stops and the next shows.
//
// Most edges are cut with scissors, and some stretches are torn by hand. A cut
// edge has no white: it is a shadow on the sheet under it and a hairline of
// light along its own thickness. A torn one shows the white core of the paper,
// in patches. The upper sheet is the nearer, which in a picture of land is the
// one lower down. The plant is cut from stronger paper and stuck on last, over
// everything, a little off the page so that it throws a shadow. The papers
// come from different places: newspaper as it came, newspaper painted over,
// sugar paper, a magazine photograph.

import { Renderer2D } from '../flat/renderer2d.js';
import { buildFlatPlant } from '../flat/plant2d.js';
import { drawPlantLive, patternAlpha, outlineOf } from '../flat/paint.js';

/**
 * The plant is folded, not cut flat: origami. Every shape is split into the
 * facets it would be folded into, and each facet is filled with how much
 * light it catches, as a grey, on a sheet of its own; the shader multiplies
 * the paper by that. A stem is a strip folded once down its length, so it
 * has a lit side and a shaded side, and which is which turns at every bend.
 * A petal or a leaf has a crease down its middle. A round thing (a bud, a
 * flower's eye) is a little folded pyramid.
 */
const FOLD_LIGHT = (() => {
  const l = Math.hypot(-0.45, 0.55, 0.7);
  return [-0.45 / l, 0.55 / l, 0.7 / l];
})();
const TILT = 0.75;
function facetGrey(nx, ny) {
  const l = Math.hypot(nx * TILT, ny * TILT, 1);
  const lit = (nx * TILT * FOLD_LIGHT[0] + ny * TILT * FOLD_LIGHT[1] + FOLD_LIGHT[2]) / l;
  const g = Math.round(Math.max(0, Math.min(1, lit)) * 255);
  return `rgb(${g},${g},${g})`;
}
function drawFolds(ctx, shapes, px = 1) {
  for (const s of shapes) {
    if (s.type === 'band') {
      const p = s.pts;
      for (let i = 0; i + 1 < p.length; i++) {
        const a = p[i], b = p[i + 1];
        const tx = b.x - a.x, ty = b.y - a.y;
        const tl = Math.hypot(tx, ty) || 1;
        const px = -ty / tl, py = tx / tl;
        for (const side of [1, -1]) {
          const wa = side > 0 ? a.l : a.r, wb = side > 0 ? b.l : b.r;
          ctx.fillStyle = facetGrey(px * side, py * side);
          ctx.beginPath();
          ctx.moveTo(a.x - tx / tl * 0.3, a.y - ty / tl * 0.3);
          ctx.lineTo(b.x + tx / tl * 0.3, b.y + ty / tl * 0.3);
          ctx.lineTo(b.x + px * side * wb, b.y + py * side * wb);
          ctx.lineTo(a.x + px * side * wa, a.y + py * side * wa);
          ctx.closePath();
          ctx.fill();
        }
      }
    } else if (s.type === 'disc' && s.r * px < 7) {
      // too small to fold: a dot punched from the sheet, flat
      ctx.fillStyle = facetGrey(0, 0);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.type === 'disc') {
      const n = 8;
      const out = outlineOf(s);
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
        ctx.fillStyle = facetGrey(Math.cos(am), Math.sin(am));
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        const m = out.length;
        for (let j = Math.floor((k / n) * m); j <= Math.ceil(((k + 1) / n) * m); j++) {
          const q = out[j % m];
          ctx.lineTo(q.x, q.y);
        }
        ctx.closePath();
        ctx.fill();
      }
    } else {
      // a crease down the long axis, the two halves folded up towards it
      const pts = outlineOf(s);
      if (!pts || pts.length < 3) continue;
      let cx = 0, cy = 0;
      for (const q of pts) { cx += q.x; cy += q.y; }
      cx /= pts.length; cy /= pts.length;
      let sxx = 0, syy = 0, sxy = 0;
      for (const q of pts) { const dx = q.x - cx, dy = q.y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const ux = Math.cos(ang), uy = Math.sin(ang);
      const R = Math.sqrt(Math.max(sxx, syy) / pts.length) * 6 + 10;
      for (const side of [1, -1]) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx - ux * R, cy - uy * R);
        ctx.lineTo(cx + ux * R, cy + uy * R);
        ctx.lineTo(cx + ux * R - uy * R * side, cy + uy * R + ux * R * side);
        ctx.lineTo(cx - ux * R - uy * R * side, cy - uy * R + ux * R * side);
        ctx.closePath();
        ctx.clip();
        // each half tilts up towards the crease: its normal leans across, inward
        ctx.fillStyle = facetGrey(uy * side * 0.8, -ux * side * 0.8);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j].x, pts[j].y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }
}

/**
 * How a section arrives. Paper does not grow: a cut-out film is made by laying
 * pieces down one at a time and photographing each. So a new section comes in
 * this many pieces, each laid down whole, held a little off the page until
 * it is pressed down; and a flower or a leaf, which is a symmetrical cut-out,
 * comes folded in half and opens out.
 */
const PIECES = 4;

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uWorld;
uniform sampler2D uPlant;
uniform sampler2D uNew;    // the piece being laid down now
uniform float uLift;       // how far off the page it still is, 0..1
uniform sampler2D uHeads;  // the heads that are opening, drawn flat
uniform sampler2D uFold;   // how much light each facet of the plant catches
uniform sampler2D uHeadFold;
uniform vec4 uHead[3];     // each: the crease's point (xy) and direction (zw), CSS px
uniform vec2 uHeadP[3];    // each: how far turned over (0 flat open, pi folded), and its reach
uniform int uHeadN;
uniform sampler2D uLayer;  // which layer: how fast it moves against the plant (r, g), far range (b)
uniform vec2 uCentre;      // the one point on screen no layer's motion moves, CSS px
uniform vec2 uRes;      // device pixels
uniform float uPx;      // device pixels to a CSS pixel
uniform vec2 uAnchor;   // where the world's origin is on screen at the plant's depth, CSS px
out vec4 outColour;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.5 + vnoise(p * 2.03 + 7.1) * 0.25 + vnoise(p * 4.1 + 3.3) * 0.15
    + vnoise(p * 8.3 + 1.7) * 0.1;
}

vec2 uvAt(vec2 p) {
  vec2 uv = p * uPx / uRes;
  return vec2(clamp(uv.x, 0.001, 0.999), clamp(1.0 - uv.y, 0.001, 0.999));
}
/**
 * The world's ink at p (CSS px from top left). An edge in the sketch is
 * antialiased, and a pixel half of one ink and half of another is a third
 * piece one pixel wide: so a colour no neighbour shares gives way to one that
 * a neighbour does.
 */
vec3 worldAt(vec2 p) {
  vec3 c = texture(uWorld, uvAt(p)).rgb;
  vec3 a = texture(uWorld, uvAt(p + vec2(1.0, 0.0))).rgb;
  vec3 b = texture(uWorld, uvAt(p + vec2(0.0, 1.0))).rgb;
  vec3 d = texture(uWorld, uvAt(p - vec2(1.0, 0.0))).rgb;
  vec3 e = texture(uWorld, uvAt(p - vec2(0.0, 1.0))).rgb;
  float t = 0.02;
  if (distance(c, a) < t || distance(c, b) < t || distance(c, d) < t || distance(c, e) < t) return c;
  if (distance(a, d) < t) return a;
  if (distance(b, e) < t) return b;
  return distance(c, a) < distance(c, b) ? a : b;
}
vec4 plantAt(vec2 p) {
  vec4 c = texture(uPlant, uvAt(p));
  if (c.a < 0.5) return vec4(0.0);
  return vec4(c.rgb / max(c.a, 1e-3), 1.0);
}

/**
 * Which piece a colour is. Coarse on purpose: the sketch shades a field in
 * five greens a few percent apart, and five strips of near-identical paper
 * torn and laid edge to edge are a scribble, not a meadow.
 */
float keyOf(vec3 c) {
  vec3 q = floor(sqrt(c) * 11.0 + 0.5);
  return q.r + q.g * 12.0 + q.b * 144.0;
}

/**
 * How torn the edges are here. Most of a collage is cut with scissors; a
 * stretch of it here and there is torn by hand. Not per piece: the same piece
 * is cut along one side and torn along another, as real ones are.
 */
float tornness(vec2 a) { return smoothstep(0.50, 0.64, fbm(a * 0.0042 + 50.0)); }

/** How fast the layer at p moves on screen, against the plant's own. */
float speedAt(vec2 p) {
  vec4 m = texture(uLayer, uvAt(p));
  return (floor(m.r * 255.0 + 0.5) * 256.0 + floor(m.g * 255.0 + 0.5)) / 65535.0 * 4.0;
}
/** Where a layer moving at that speed has the world's origin: its paper is pinned there. */
vec2 anchorOf(float k) { return uCentre + k * (uAnchor - uCentre); }

/** Where a point is taken to lie, for deciding which piece it is on. */
vec2 warp(vec2 p, vec2 anc) {
  vec2 a = p - anc;
  // scissors: a slow wander, never a ruled line
  vec2 w = (vec2(vnoise(a * 0.035 + 11.0), vnoise(a * 0.035 + 37.0)) - 0.5) * 2.6;
  // a tear: wanders a long way, and is ragged close to
  float t = tornness(a);
  vec2 big = vec2(fbm(a * 0.03 + 3.0), fbm(a * 0.03 + 17.0)) - 0.5;
  vec2 fine = vec2(vnoise(a * 0.55 + 5.0), vnoise(a * 0.55 + 29.0)) - 0.5;
  return p + w + t * (big * 9.0 + fine * 2.0);
}
vec2 cut(vec2 p) {
  vec2 a = p - uAnchor;
  return p + (vec2(vnoise(a * 0.04 + 11.0), vnoise(a * 0.04 + 37.0)) - 0.5) * 2.2;
}

/**
 * Paper of a colour: dyed, not lit. Less chroma, a warm cast, no true white
 * and no true black, every sheet a little off its neighbour.
 */
vec3 paper(vec3 c, float key, float strong) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, mix(0.86, 0.96, strong));
  c *= vec3(1.0, 0.972, 0.915);
  c = mix(vec3(0.115, 0.10, 0.10), vec3(0.955, 0.93, 0.875), c);
  float lot = hash21(vec2(key, 41.0)) - 0.5;
  return clamp(c * (1.0 + lot * 0.07), 0.0, 1.0);
}

float grain(vec2 a, float key) {
  float fib = fbm(a * vec2(0.9, 0.45) + key * 3.1) - 0.5;
  float fleck = smoothstep(0.86, 0.95, hash21(floor(a * 0.9) + key));
  return 1.0 + fib * 0.07 - fleck * 0.06;
}

vec2 rot(vec2 q, float a) { float s = sin(a), c = cos(a); return vec2(c * q.x - s * q.y, s * q.x + c * q.y); }

/**
 * A newspaper page, as ink coverage 0..1: columns of body type with ragged
 * paragraph ends, a headline now and then, a halftone photograph now and then,
 * and a rule between some of the columns.
 */
float newsprint(vec2 q, float seed) {
  float colW = 54.0, gut = 6.0;
  float ci = floor(q.x / (colW + gut));
  float cx = q.x - ci * (colW + gut);
  if (cx > colW) return step(abs(cx - colW - gut * 0.5), 0.4) * step(0.55, hash21(vec2(ci, seed))) * 0.7;
  float bh = 84.0;
  float bi = floor((q.y + hash21(vec2(ci, seed + 3.0)) * bh) / bh);
  float by = q.y + hash21(vec2(ci, seed + 3.0)) * bh - bi * bh;
  float h = hash21(vec2(ci * 7.1 + bi, seed));
  if (h < 0.07) {
    // a photograph: a picture of nothing in particular, screened
    float img = smoothstep(0.2, 0.8, fbm(q * 0.05 + vec2(ci, bi) * 5.3 + seed));
    vec2 g = fract(rot(q, 0.785) / 1.6) - 0.5;
    float dotc = smoothstep(0.08, 0.0, length(g) - sqrt(1.0 - img) * 0.5);
    return dotc * 0.55 * step(3.0, by) * step(by, bh - 30.0);
  }
  if (h < 0.15 && by < 20.0) {
    // a headline: two lines of heavy type
    float lh = 8.0;
    float row = floor(by / lh);
    float f = fract(by / lh);
    float inRow = step(0.12, f) * step(f, 0.82);
    float glyph = step(0.18, hash21(floor(vec2(cx / 3.0, row + bi * 9.0)) + seed));
    float word = step(0.22, vnoise(vec2(cx * 0.085, row * 5.0 + bi + seed)));
    float len = step(cx, colW * (0.45 + 0.55 * hash21(vec2(row, bi + seed))));
    return inRow * glyph * word * len * 0.85;
  }
  // body type
  float lh = 2.9;
  float row = floor(q.y / lh);
  float f = fract(q.y / lh);
  float inRow = step(0.22, f) * step(f, 0.74);
  float glyph = step(0.38, hash21(floor(vec2(cx / 1.05, row)) + seed));
  float word = step(0.26, vnoise(vec2(cx * 0.32, row * 3.7 + seed)));
  float pr = mod(row + floor(hash21(vec2(ci, seed)) * 9.0), 11.0);
  float end = 1.0 - step(10.0, pr) * step(colW * (0.2 + 0.7 * hash21(vec2(floor(row / 11.0), ci + seed))), cx);
  float indent = 1.0 - step(pr, 0.5) * step(cx, 4.0);
  return inRow * glyph * word * end * indent * 0.7;
}

const vec3 NEWS = vec3(0.865, 0.85, 0.80);    // newsprint, a day old
const vec3 NEWS_INK = vec3(0.16, 0.155, 0.165);

/** What each paper was before it was cut up. */
vec3 printOn(vec3 base, vec2 a, float key, float bias, float noNews) {
  float t = fract(hash21(vec2(key, 7.0)) + bias);
  // a field or a sky in newsprint is wallpaper: only the pale and neutral
  // pieces are ever the raw page, and the plant is cut from coloured paper
  t = mix(t, 0.24 + t * 0.76, noNews);
  vec2 q = rot(a, (hash21(vec2(key, 13.0)) - 0.5) * 0.5) + hash21(vec2(key, 5.0)) * 900.0;
  vec3 col;
  if (t < 0.24) {
    // a piece of the newspaper itself, as it came, the colour only hinted at
    float ink = newsprint(q, key);
    vec3 page = mix(NEWS, base, 0.16) * grain(q, key);
    col = mix(page, NEWS_INK, ink * 0.62);
  } else if (t < 0.62) {
    // newspaper painted over: a wash of colour, the print showing through it,
    // heavier where the brush went twice
    float ink = newsprint(q, key + 1.0);
    float brush = fbm(rot(q, 0.4) * vec2(0.012, 0.09) + key) - 0.5;
    col = base * (1.0 + brush * 0.16) * (1.0 - ink * 0.13) * grain(q, key);
  } else if (t < 0.84) {
    // sugar paper: no print, only its own coarse fibre and a mottle in the dye
    float m = fbm(q * 0.025 + key) - 0.5;
    float f = fbm(q * vec2(0.35, 0.18) + key) - 0.5;
    col = base * (1.0 + m * 0.10 + f * 0.08) * grain(q, key);
  } else {
    // a magazine photograph: the colour in a fine screen, blotched
    vec2 g = fract(rot(q, 0.26) / 2.5) - 0.5;
    float b = fbm(q * 0.022 + key) - 0.5;
    float dotc = smoothstep(0.36, 0.28, length(g));
    col = mix(base * 1.06, base * 0.72, dotc * 0.35) * (1.0 + b * 0.22);
  }
  return col;
}

/**
 * Origami: the paper times the light its facet catches, and a fine line where
 * two facets meet, which is the crease. A flat facet (facing the viewer)
 * catches FLAT, and is left as it is.
 */
const float FLAT = 0.70;
vec3 folded(vec3 c, sampler2D fs, vec2 q) {
  float f = texture(fs, uvAt(q)).r;
  float fx = texture(fs, uvAt(q + vec2(0.8, 0.0))).r;
  float fy = texture(fs, uvAt(q + vec2(0.0, 0.8))).r;
  float shade = clamp(mix(1.0, f / FLAT, 0.9), 0.5, 1.3);
  float crease = smoothstep(0.03, 0.10, max(abs(fx - f), abs(fy - f)));
  return c * shade * (1.0 - crease * 0.14);
}

const vec3 BOARD = vec3(0.90, 0.865, 0.79);   // what it is all stuck down on
const vec3 CORE = vec3(0.965, 0.955, 0.925);  // the inside of a sheet, where it tears

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uPx;
  // Every layer's paper is pinned to that layer. The edges use a softened
  // version, an average over the neighbourhood, so a tear does not jump where
  // one layer gives way to another.
  float kHere = speedAt(p);
  float kSoft = 0.0;
  for (int i = 0; i < 6; i++) {
    float b = float(i) * 1.0472;
    kSoft += speedAt(p + vec2(cos(b), sin(b)) * 9.0);
  }
  kSoft = (kSoft + kHere * 2.0) / 8.0;
  vec2 ancW = anchorOf(kSoft);
  vec2 a = p - anchorOf(kHere);                 // this piece's own paper
  vec2 aw = p - ancW;                           // its edges
  vec2 ap = p - uAnchor;                        // the plant's

  // ---- the world ----
  vec3 wc = worldAt(warp(p, ancW));
  float wk = keyOf(wc);
  vec3 base = paper(wc, wk, 0.0);

  // How far the nearest edge is above this point, and below it. The nearer
  // sheet is the lower one on screen, and lies on top.
  float up = 99.0, down = 99.0;
  vec3 upC = wc, downC = wc;
  for (int r = 1; r <= 8; r++) {
    float fr = float(r);
    for (int i = -1; i <= 1; i++) {
      vec2 d = normalize(vec2(float(i) * 0.8, 1.0));
      if (up > 98.0) {
        vec3 c = worldAt(warp(p - d * fr, ancW));
        if (keyOf(c) != wk) { up = fr; upC = c; }
      }
      if (down > 98.0) {
        vec3 c = worldAt(warp(p + d * fr, ancW));
        if (keyOf(c) != wk) { down = fr; downC = c; }
      }
    }
  }
  float upK = smoothstep(0.035, 0.11, distance(base, paper(upC, keyOf(upC), 0.0)));
  float downK = smoothstep(0.035, 0.11, distance(base, paper(downC, keyOf(downC), 0.0)));

  // Which pieces may be the raw newspaper: those near its own colour, the
  // greys and beiges. Decided by the colour, so a piece is one paper all over.
  float sat = (max(wc.r, max(wc.g, wc.b)) - min(wc.r, min(wc.g, wc.b))) / max(1e-3, max(wc.r, max(wc.g, wc.b)));
  float big = step(0.32, sat);
  vec3 col = printOn(base, a, wk, 0.0, big);
  // The far range is always the newspaper, whatever its colour: one layer of
  // every place cut from the same paper, which is how a collage is planned
  // rather than chanced. A little more of its colour is left in, so its lit
  // and shaded faces still read.
  if (texture(uLayer, uvAt(warp(p, ancW))).b > 0.5) {
    vec2 q = rot(a, (hash21(vec2(wk, 13.0)) - 0.5) * 0.5) + hash21(vec2(wk, 5.0)) * 900.0;
    vec3 page = mix(NEWS, base, 0.34) * grain(q, wk);
    col = mix(page, NEWS_INK, newsprint(q, wk) * 0.6);
  }

  // Under another sheet: a tight contact shadow right at its edge and a soft
  // one spreading from it. This, not a line, is what an edge of paper is.
  float contact = 1.0 - smoothstep(0.0, 2.2, down);
  float spread = pow(1.0 - smoothstep(0.0, 8.0, down), 1.6);
  col *= 1.0 - (contact * 0.20 + spread * 0.20) * downK;

  // The upper sheet's own edge. Cut, it catches the light along its thickness:
  // a hairline brighter, no more. Torn, the white core of the sheet shows, but
  // only where the tear ran the right way, in patches, never as a band of one
  // width, and its outer edge is loose fibre.
  float tw = tornness(aw);
  col *= 1.0 + 0.07 * (1.0 - smoothstep(0.6, 1.6, up)) * upK * (1.0 - tw);
  float spots = smoothstep(0.38, 0.62, fbm(aw * 0.05 + 21.0));
  float w = (0.4 + 3.4 * pow(fbm(aw * 0.09 + 7.0), 1.5)) * spots * tw * upK;
  float fibre = (vnoise(aw * vec2(2.4, 1.1)) - 0.5) * 1.4 + (vnoise(aw * 5.0) - 0.5) * 0.6;
  float core = 1.0 - smoothstep(w - 0.5, w + 0.3, up - 0.5 + fibre);
  col = mix(col, mix(CORE, base, 0.12) * (0.95 + 0.05 * vnoise(aw * 1.7)), core * step(0.15, w));

  // ---- the world folded too ----
  // The ranges already have a lit face and a shade face, which is a fold. The
  // land is pleated: broad folds across it, valley and mountain in turn, wider
  // the further back, pinned to its own layer. The sky is a flat sheet.
  if (kHere > 0.001 && texture(uLayer, uvAt(p)).b < 0.5) {
    float yl = (p - anchorOf(kHere)).y;
    float w = 34.0 * clamp(kHere, 0.35, 1.0) + 10.0;
    float f = yl / w;
    float side = mod(floor(f), 2.0) < 1.0 ? 1.0 : -1.0;
    float fr = fract(f);
    col *= 1.0 + side * 0.07 + (fr - 0.5) * side * 0.05;
    col *= 1.0 - smoothstep(0.05, 0.0, min(fr, 1.0 - fr)) * 0.08;
  }

  // ---- the plant: cut out and stuck on top ----
  vec2 cp = cut(p);
  vec4 pc = plantAt(cp);
  float held = pc.a;
  // its shadow: it stands off the page on a pad of glue, lit from the upper left
  float ps = 0.0, pt = 0.0, pn = 0.0;
  float lo = 1.0 + uLift * 2.6;
  for (int i = 0; i < 8; i++) {
    float b = float(i) * 0.7854;
    vec2 o = vec2(cos(b), sin(b));
    ps += plantAt(cut(p + vec2(-3.4, -4.4) + o * 3.0)).a;
    pt += plantAt(cut(p + vec2(-1.2, -1.6) + o * 0.9)).a;
    // the piece in the hand: its shadow further off and softer the higher it is
    pn += texture(uNew, uvAt(cut(p + vec2(-3.4, -4.4) * lo + o * 3.0 * lo))).a;
  }
  vec4 nw = texture(uNew, uvAt(cp));
  float newHere = step(0.5, nw.a);
  col *= 1.0 - (ps / 8.0 * 0.26 + pt / 8.0 * 0.22) * (1.0 - held);
  if (pc.a > 0.5) {
    float pk = keyOf(pc.rgb);
    vec3 pcol = printOn(paper(pc.rgb, pk, 1.0), ap, pk, 0.45, 1.0);
    // one cut piece over another: the upper one's edge throws a hairline
    float e = 0.0;
    for (int i = 0; i < 4; i++) {
      float b = float(i) * 1.5708 + 0.785;
      vec4 q = plantAt(cut(p + vec2(cos(b), sin(b)) * 1.5));
      if (q.a > 0.5 && keyOf(q.rgb) != pk) e = 1.0;
    }
    pcol *= 1.0 - e * 0.16;
    // and the outer edge, facing the light, catches it along the paper's thickness
    float lit = 1.0 - plantAt(cut(p + vec2(-1.1, -1.1))).a;
    col = folded(pcol * (1.0 + lit * 0.10), uFold, cp);
  }
  // The piece in hand, opening: over everything, its shadow cast on whatever
  // it is held above, further off and softer the higher it is.
  col *= 1.0 - (pn / 8.0) * 0.34 * (0.35 + 0.65 * uLift) * (1.0 - newHere);
  if (newHere > 0.5) {
    vec3 nrgb = nw.rgb / max(nw.a, 1e-3);
    float nk = keyOf(nrgb);
    col = folded(printOn(paper(nrgb, nk, 1.0), ap, nk, 0.45, 1.0) * (1.0 + uLift * 0.06), uFold, cp);
  }

  // ---- heads opening: half on the page, half turning over above it ----
  const vec3 LIGHT = vec3(-0.42, -0.52, 0.74);   // from the upper left, and in front
  for (int i = 0; i < 3; i++) {
    if (i >= uHeadN) break;
    vec2 H = uHead[i].xy;
    vec2 A = normalize(uHead[i].zw);
    vec2 N = vec2(-A.y, A.x);
    float ph = uHeadP[i].x, R = uHeadP[i].y;
    float cph = cos(ph), sph = sin(ph);
    const float D = 900.0;                       // how far the lens is, for the perspective
    // Is there a point of the turning half over here? A point d out from the
    // crease, turned by ph, is seen at d cos(ph), enlarged by its height.
    // Run that backwards from this pixel.
    vec2 rel = p - H;
    float a1 = dot(rel, A), n1 = dot(rel, N);
    float flap = 0.0;
    vec3 flapCol = vec3(0.0);
    float den = cph + n1 * sph / D;
    if (abs(den) > 1e-3) {
      float d = n1 / den;
      if (d > 0.0 && d < R) {
        float zf = 1.0 - d * sph / D;
        vec2 src = H + A * a1 * zf + N * d;
        vec4 hc = texture(uHeads, uvAt(src));
        if (hc.a > 0.5) {
          flap = 1.0;
          // its own light: the normal turns with it
          vec3 nrm = normalize(vec3(-N * sph, cph));
          bool back = cph < 0.0;
          if (back) nrm = -nrm;
          float lit = (0.55 + 0.45 * max(dot(nrm, normalize(LIGHT)), 0.0)) / (0.55 + 0.45 * normalize(LIGHT).z);
          vec3 rgb = hc.rgb / max(hc.a, 1e-3);
          float hk = keyOf(rgb);
          vec3 face = back ? CORE * grain(src - uAnchor, 31.0) : folded(printOn(paper(rgb, hk, 1.0), src - uAnchor, hk, 0.45, 1.0), uHeadFold, src);
          flapCol = face * lit;
        }
      }
    }
    // the half that stays, where it is
    float baseHit = 0.0;
    vec3 baseCol = vec3(0.0);
    if (n1 <= 0.5 && length(rel) < R * 1.3) {
      vec4 hb = texture(uHeads, uvAt(p));
      if (hb.a > 0.5) {
        vec3 rgb = hb.rgb / max(hb.a, 1e-3);
        float hk = keyOf(rgb);
        baseHit = 1.0;
        baseCol = folded(printOn(paper(rgb, hk, 1.0), ap, hk, 0.45, 1.0), uHeadFold, p);
      }
    }
    // the shadow of the turning half, cast away from the light, longer the
    // higher it is held
    float sh = 0.0;
    vec2 toward = -normalize(LIGHT).xy / normalize(LIGHT).z;
    for (int k = 0; k < 10; k++) {
      // spread over heights and a little to the side: a soft shadow, not bars
      float fk = float(k);
      float hgt = R * 0.45 * max(sph, 0.0) * (0.55 + 0.09 * fk);
      vec2 q = p - toward * hgt + N * (fract(fk * 0.618) - 0.5) * (2.0 + hgt * 0.25);
      vec2 r2 = q - H;
      float n2 = dot(r2, N);
      float dn = cph + n2 * sph / D;
      if (abs(dn) > 1e-3) {
        float d2 = n2 / dn;
        if (d2 > 0.0 && d2 < R) {
          vec2 s2 = H + A * dot(r2, A) * (1.0 - d2 * sph / D) + N * d2;
          sh += step(0.5, texture(uHeads, uvAt(s2)).a);
        }
      }
    }
    sh = sh / 10.0 * (0.35 + 0.65 * max(sph, 0.0));
    if (flap > 0.5) col = flapCol;
    else {
      if (baseHit > 0.5) col = baseCol;
      col *= 1.0 - sh * 0.38;
    }
  }

  // the whole board photographed: glue cockle, and the window's fall-off
  vec2 uv = p * uPx / uRes;
  col *= 0.985 + 0.03 * (fbm(p * 0.006) - 0.5);
  col *= 1.03 - 0.03 * uv.x - 0.05 * uv.y;
  col *= 1.0 - 0.16 * pow(clamp(length(uv - 0.5) * 1.25, 0.0, 1.0), 2.6);
  outColour = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

function program(gl, vs, fs) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('program: ' + gl.getProgramInfoLog(p));
  return p;
}

const canvasOf = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h)
  : Object.assign(document.createElement('canvas'), { width: w, height: h }));

/**
 * The flat picture, drawn as the pieces are to be cut: the world on one sheet,
 * the plant alone on a clear one, and no lines.
 */
class Sketch extends Renderer2D {
  constructor(canvas) {
    super(canvas);
    this.line = 'rgba(0,0,0,0)';
  }

  /**
   * The board does not have depth. Everything on it is glued to one sheet, so
   * when the camera climbs or pulls back, all of it has to move together; a
   * far range that slid more slowly than the ground in front of it was the
   * picture coming apart into layers.
   *
   * So the eye never moves. It stays where it was at the start, at the floor
   * and at zoom 1, and the camera's travel is done to the picture instead: a
   * rise is a shift of the whole image (folded into the tilt, which every
   * layer takes the same), and a zoom is a longer lens from the same spot,
   * which scales every layer alike. In the plant's own plane this is exactly
   * the camera it was, so the plant does not move at all.
   */
  lens(cam) {
    const real = super.lens(cam);
    const ref = super.lens({ x: cam.x, y: -1e9, zoom: 1 });
    return {
      F: ref.F * real.zoom,
      zoom: real.zoom,
      dist: ref.dist,
      ex: real.ex,
      ey: ref.ey,
      lookY: real.lookY,
      tilt: real.tilt - (real.ey - ref.ey) * real.zoom,
    };
  }

  render(plant, cam, time, sections, reveal = null) {
    // Laid down in pieces. The growth is held at whole steps: everything up to
    // the last step is the plant, and the step's new piece is drawn on a sheet
    // of its own, held off the page until it is pressed down.
    this.lift = 0;
    let now = null;
    let prev = null;
    let u = 1;
    if (reveal) {
      const f = reveal.progress * PIECES;
      const k = Math.min(PIECES, Math.floor(f) + 1);
      u = reveal.progress >= 1 ? 1 : Math.min(1, (f - (k - 1)) / 0.75);
      now = { ...reveal, progress: k / PIECES };
      prev = { ...reveal, progress: (k - 1) / PIECES };
      this.lift = 1 - u * u * (3 - 2 * u);
    }
    // Heads open on their own clock, as the stem reaches them, and are drawn
    // apart from the rest while they do: everything else is built from a plant
    // that does not have them yet.
    const opening = [];
    if (reveal && reveal.progress < 1) {
      const section = plant.sections.find((sc) => sc.step === reveal.step);
      if (section) {
        const k = reveal.progress * section.steps;
        const OPEN_OVER = 2.2;
        const keep = [];
        for (const node of section.nodes) {
          const open = Math.min(1, Math.max(0, (k - Math.max(0, node.k - OPEN_OVER)) / OPEN_OVER));
          if (open >= 1) keep.push(node);
          else if (open > 0) opening.push({ section, node, open });
        }
        plant = { ...plant, sections: plant.sections.map((sc) => (sc === section ? { ...sc, nodes: keep } : sc)) };
      }
    }
    this.resize();
    this.ensureWorld();
    // The growing part is kept between frames by how far it has got, and that
    // is now held at whole steps; but which heads it has changes within a step,
    // as each finishes opening. Kept, a head that had just opened was missing
    // until the next step.
    if (reveal) this.plantKey = null;
    this.ensurePlant(plant, now);
    const v = this.view(cam, time);
    const s0 = v.s(0);
    this.anchor = [v.X(0, s0), v.Y(0, s0)];
    this.centre = [v.W / 2, v.H / 2 - v.tilt];
    const moving = this.moving.at(time * 0.001, plant, v);
    const ctx = this.ctx;
    // the world, everything in it, in its order: the plant is not in this sheet
    this.drawSky(ctx, v);
    const items = this.world.items;
    let m = 0;
    for (const it of items) {
      while (m < moving.length && moving[m].z < it.z) moving[m++].draw(ctx, v);
      if (!it.sky) it.draw(ctx, v);
    }
    while (m < moving.length) moving[m++].draw(ctx, v);

    // Which layer each pixel belongs to, as how fast that layer moves on the
    // screen against the plant's own (red and green, sixteen bits), and
    // whether it is the far range (blue). Every layer's paper is pinned to its
    // own layer: the far hills' newsprint moves with the far hills, and the
    // sky's does not move at all.
    const lc = this.sheet('layerSheet').getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.fillStyle = 'rgb(0,0,0)';
    lc.fillRect(0, 0, this.pw, this.ph);
    const world = this.world;
    const own = world.colour;
    let cur = 'rgb(0,0,0)';
    const enc = (z, far) => {
      const q = Math.round(Math.min(0.9999, Math.max(0, (s0 ? v.s(z) / s0 : 0) / 4)) * 65535);
      return `rgb(${q >> 8},${q & 255},${far ? 255 : 0})`;
    };
    world.colour = () => cur;
    try {
      m = 0;
      for (const it of items) {
        while (m < moving.length && moving[m].z < it.z) { cur = enc(moving[m].z, false); moving[m++].draw(lc, v); }
        if (it.sky) continue;
        cur = enc(it.z, it.kind === 'range');
        it.draw(lc, v);
      }
      while (m < moving.length) { cur = enc(moving[m].z, false); moving[m++].draw(lc, v); }
    } finally {
      world.colour = own;
    }

    // The plant as it is now, but for the piece in hand. (Drawn as it is now,
    // and not as it was a step ago, because a step ago it had a bud on the old
    // tip, and that bud is not there any more.)
    const pc = this.sheet('plantSheet').getContext('2d');
    pc.setTransform(1, 0, 0, 1, 0, 0);
    pc.clearRect(0, 0, this.pw, this.ph);
    this.drawPlant(pc, v);
    const colour = (ink, over) => this.plantColour(ink, over);
    // with the material's marks, as drawPlant has them, so a piece does not change when it is laid
    const opts = { heavy: 0, line: 0, lineColour: 'rgba(0,0,0,0)', colour, marks: patternAlpha(s0 * this.dpr) };
    // The pieces are the stem's only. A head is built at a size that depends on
    // how far the stem has got, so the head now less the head a step ago is a
    // ring, and cutting that ring out of the plant left the head hollow.
    const stems = now ? { ...plant, sections: plant.sections.map((sc) => (sc.step === now.step ? { ...sc, nodes: [] } : sc)) } : null;
    const grownNow = now ? buildFlatPlant(stems, now, 'growing') : null;
    const grownBefore = now && prev.progress > 0 ? buildFlatPlant(stems, prev, 'growing') : null;
    if (now) {
      // the piece, where it will lie, cut out of the plant's sheet
      const cc = this.sheet('cutSheet').getContext('2d');
      cc.setTransform(1, 0, 0, 1, 0, 0);
      cc.globalCompositeOperation = 'source-over';
      cc.clearRect(0, 0, this.pw, this.ph);
      v.at(cc, 0);
      drawPlantLive(cc, grownNow, opts);
      if (grownBefore) {
        cc.globalCompositeOperation = 'destination-out';
        drawPlantLive(cc, grownBefore, opts);
        cc.globalCompositeOperation = 'source-over';
      }
      pc.setTransform(1, 0, 0, 1, 0, 0);
      pc.globalCompositeOperation = 'destination-out';
      pc.drawImage(this.cutSheet, 0, 0);
      pc.globalCompositeOperation = 'source-over';
    }

    // the piece in hand: this step's growth less the last step's
    const nc = this.sheet('newSheet').getContext('2d');
    nc.setTransform(1, 0, 0, 1, 0, 0);
    nc.globalCompositeOperation = 'source-over';
    nc.clearRect(0, 0, this.pw, this.ph);
    if (now) {
      v.at(nc, 0);
      drawPlantLive(nc, grownNow, opts);
      if (grownBefore) {
        nc.globalCompositeOperation = 'destination-out';
        drawPlantLive(nc, grownBefore, opts);
        nc.globalCompositeOperation = 'source-over';
      }
    }

    // The heads that are opening, drawn flat on a sheet of their own: the
    // shader folds them. Each is a symmetrical cut-out, and a symmetrical
    // cut-out is made folded, so it arrives folded in half down its own
    // middle and opens about that crease: one half stays on the page, the
    // other turns over in three dimensions on top of it.
    const hc = this.sheet('headSheet').getContext('2d');
    hc.setTransform(1, 0, 0, 1, 0, 0);
    hc.clearRect(0, 0, this.pw, this.ph);
    this.heads = [];
    if (opening.length) {
      v.at(hc, 0);
      for (const { section, node, open } of opening.slice(0, 3)) {
        const shapes = buildFlatPlant({ ...plant, tips: [], sections: [{ ...section, segments: [], nodes: [node] }] }, null, 'all');
        drawPlantLive(hc, shapes, opts);
        // turned over flat at the start, upright half way, a little bounce as
        // it lands: paper is light, and the air under it holds it up a moment.
        // Held on twos, as a cut-out film is shot.
        const q = Math.floor(open * 14) / 14;
        const e = q * q * (3 - 2 * q);
        const phi = Math.PI * (1 - Math.min(1, e / 0.86)) + 0.22 * Math.sin(Math.PI * Math.min(1, Math.max(0, (e - 0.86) / 0.14)));
        const sd = [Math.sin(node.angle), Math.cos(node.angle)];
        this.heads.push({
          H: [v.X(node.x, s0), v.Y(node.y, s0)],
          A: [sd[0], -sd[1]],
          phi,
          R: node.size * 1.7 * s0 + 8,
        });
      }
    }

    // the folds: how much light each facet of the plant catches
    const fc = this.sheet('foldSheet').getContext('2d');
    fc.setTransform(1, 0, 0, 1, 0, 0);
    fc.clearRect(0, 0, this.pw, this.ph);
    v.at(fc, 0);
    const foldKey = `${plant.sections.length}|${now ? now.step + ':' + now.progress : '-'}|${opening.length}`;
    if (this.foldKey !== foldKey) {
      this.foldKey = foldKey;
      this.foldShapes = buildFlatPlant(plant, now, 'all');
    }
    drawFolds(fc, this.foldShapes, s0);
    const hf = this.sheet('headFoldSheet').getContext('2d');
    hf.setTransform(1, 0, 0, 1, 0, 0);
    hf.clearRect(0, 0, this.pw, this.ph);
    if (opening.length) {
      v.at(hf, 0);
      for (const { section, node } of opening.slice(0, 3)) {
        drawFolds(hf, buildFlatPlant({ ...plant, tips: [], sections: [{ ...section, segments: [], nodes: [node] }] }, null, 'all'), s0);
      }
    }
  }

  /** A canvas of the screen's size, kept by name. */
  sheet(name) {
    if (!this[name] || this[name].width !== this.pw || this[name].height !== this.ph) {
      this[name] = canvasOf(this.pw, this.ph);
    }
    return this[name];
  }

}

export class RendererCollage {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('This browser could not open WebGL 2.');
    this.gl = gl;
    this.gpuName = 'WebGL 2 (collage)';
    // how long a section takes to arrive: slower than the other looks, so a
    // piece can be seen to be laid and a head to open
    this.growMs = 3200;
    this.renderScale = 1;
    const hidden = document.createElement('canvas');
    hidden.className = 'stage';
    hidden.style.visibility = 'hidden';
    hidden.style.pointerEvents = 'none';
    hidden.setAttribute('aria-hidden', 'true');
    (canvas.parentNode || document.body).insertBefore(hidden, canvas);
    this.hidden = hidden;
    try { this.sketch = new Sketch(hidden); } catch (err) { hidden.remove(); throw err; }
    this.prog = program(gl, VS, FS);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    // NEAREST: an ink is an exact colour, and a blend of two is a third piece
    const tex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t;
    };
    this.texWorld = tex();
    this.texPlant = tex();
    this.texLayer = tex();
    this.texNew = tex();
    this.texHeads = tex();
    this.texFold = tex();
    this.texHeadFold = tex();
    this.resize();
  }

  resize() {
    const cw = this.canvas.clientWidth || 800;
    const ch = this.canvas.clientHeight || 600;
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    this.w = cw; this.h = ch; this.dpr = dpr;
    this.pw = Math.max(1, Math.round(cw * dpr));
    this.ph = Math.max(1, Math.round(ch * dpr));
    if (this.canvas.width !== this.pw || this.canvas.height !== this.ph) {
      this.canvas.width = this.pw;
      this.canvas.height = this.ph;
    }
    this.sketch.resize();
  }

  set fixedScale(v) { this.sketch.fixedScale = v; }
  get fixedScale() { return this.sketch.fixedScale; }
  invalidate() { this.sketch.invalidate(); }
  setLook() {}
  camYToPlaceAt(...a) { return this.sketch.camYToPlaceAt(...a); }
  camYToCentre(...a) { return this.sketch.camYToCentre?.(...a); }
  camXToCentre(...a) { return this.sketch.camXToCentre?.(...a); }
  project(...a) { return this.sketch.project(...a); }
  setWorld(...a) { this.sketch.setWorld(...a); }

  render(plant, cam, time, sections, reveal = null) {
    this.resize();
    this.sketch.render(plant, cam, time, sections, reveal);
    const gl = this.gl;
    gl.viewport(0, 0, this.pw, this.ph);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texWorld);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.hidden);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texPlant);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sketch.plantSheet);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.texLayer);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sketch.layerSheet);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.texNew);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sketch.newSheet);
    gl.useProgram(this.prog);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uLayer'), 2);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uNew'), 3);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uLift'), this.sketch.lift || 0);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.texHeads);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sketch.headSheet);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uHeads'), 4);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.texFold);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sketch.foldSheet);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uFold'), 5);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.texHeadFold);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sketch.headFoldSheet);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uHeadFold'), 6);
    const hs = this.sketch.heads || [];
    const hv = new Float32Array(12), hp = new Float32Array(6);
    hs.slice(0, 3).forEach((h, i) => { hv.set([h.H[0], h.H[1], h.A[0], h.A[1]], i * 4); hp.set([h.phi, h.R], i * 2); });
    gl.uniform4fv(gl.getUniformLocation(this.prog, 'uHead'), hv);
    gl.uniform2fv(gl.getUniformLocation(this.prog, 'uHeadP'), hp);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uHeadN'), Math.min(3, hs.length));
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uWorld'), 0);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uPlant'), 1);
    gl.uniform2f(gl.getUniformLocation(this.prog, 'uRes'), this.pw, this.ph);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uPx'), this.dpr);
    const an = this.sketch.anchor || [0, 0];
    gl.uniform2f(gl.getUniformLocation(this.prog, 'uAnchor'), an[0], an[1]);
    const ce = this.sketch.centre || [0, 0];
    gl.uniform2f(gl.getUniformLocation(this.prog, 'uCentre'), ce[0], ce[1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const a = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(a);
  }
}
