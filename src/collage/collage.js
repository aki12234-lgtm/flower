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

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uWorld;
uniform sampler2D uPlant;
uniform sampler2D uFar;    // where the far range shows: that layer is cut from the newspaper
uniform vec2 uRes;      // device pixels
uniform float uPx;      // device pixels to a CSS pixel
uniform vec2 uAnchor;   // where the world's origin is on screen, CSS px: the paper is fixed to it
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

/** Where a point is taken to lie, for deciding which piece it is on. */
vec2 warp(vec2 p) {
  vec2 a = p - uAnchor;
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

const vec3 BOARD = vec3(0.90, 0.865, 0.79);   // what it is all stuck down on
const vec3 CORE = vec3(0.965, 0.955, 0.925);  // the inside of a sheet, where it tears

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uPx;
  vec2 a = p - uAnchor;                         // fixed to the world, not the glass

  // ---- the world ----
  vec3 wc = worldAt(warp(p));
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
        vec3 c = worldAt(warp(p - d * fr));
        if (keyOf(c) != wk) { up = fr; upC = c; }
      }
      if (down > 98.0) {
        vec3 c = worldAt(warp(p + d * fr));
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
  if (texture(uFar, uvAt(warp(p))).a > 0.5) {
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
  float tw = tornness(a);
  col *= 1.0 + 0.07 * (1.0 - smoothstep(0.6, 1.6, up)) * upK * (1.0 - tw);
  float spots = smoothstep(0.38, 0.62, fbm(a * 0.05 + 21.0));
  float w = (0.4 + 3.4 * pow(fbm(a * 0.09 + 7.0), 1.5)) * spots * tw * upK;
  float fibre = (vnoise(a * vec2(2.4, 1.1)) - 0.5) * 1.4 + (vnoise(a * 5.0) - 0.5) * 0.6;
  float core = 1.0 - smoothstep(w - 0.5, w + 0.3, up - 0.5 + fibre);
  col = mix(col, mix(CORE, base, 0.12) * (0.95 + 0.05 * vnoise(a * 1.7)), core * step(0.15, w));

  // ---- the plant: cut out and stuck on top ----
  vec2 cp = cut(p);
  vec4 pc = plantAt(cp);
  // usually cut close; here and there the scissors went wide and a sliver of
  // the sheet it was cut from is still on it
  float mw = max(0.0, vnoise(a * 0.025 + 2.0) * 7.0 - 4.0);
  float margin = 0.0;
  if (pc.a < 0.5 && mw > 0.3) {
    for (int i = 0; i < 8; i++) {
      float b = float(i) * 0.7854;
      if (plantAt(cp + vec2(cos(b), sin(b)) * mw).a > 0.5) margin = 1.0;
    }
  }
  float held = max(pc.a, margin);
  // its shadow: it stands off the page on a pad of glue, lit from the upper left
  float ps = 0.0, pt = 0.0;
  for (int i = 0; i < 8; i++) {
    float b = float(i) * 0.7854;
    ps += plantAt(cut(p + vec2(-3.4, -4.4) + vec2(cos(b), sin(b)) * 3.0)).a;
    pt += plantAt(cut(p + vec2(-1.2, -1.6) + vec2(cos(b), sin(b)) * 0.9)).a;
  }
  col *= 1.0 - (ps / 8.0 * 0.26 + pt / 8.0 * 0.22) * (1.0 - held);
  col = mix(col, NEWS * grain(a, 17.0), margin);
  if (pc.a > 0.5) {
    float pk = keyOf(pc.rgb);
    vec3 pcol = printOn(paper(pc.rgb, pk, 1.0), a, pk, 0.45, 1.0);
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
    col = pcol * (1.0 + lit * 0.10);
  }

  // the whole board photographed: glue cockle, and the window's fall-off
  vec2 uv = p * uPx / uRes;
  col *= 0.985 + 0.03 * (fbm(a * 0.006) - 0.5);
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

  render(plant, cam, time, sections, reveal = null) {
    this.resize();
    this.ensureWorld();
    this.ensurePlant(plant, reveal);
    const v = this.view(cam, time);
    const s0 = v.s(0);
    this.anchor = [v.X(0, s0), v.Y(0, s0)];
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
    // where the far range is still to be seen: drawn in order, every range
    // laid down and everything else rubbing out what it covers
    if (!this.farSheet || this.farSheet.width !== this.pw || this.farSheet.height !== this.ph) {
      this.farSheet = canvasOf(this.pw, this.ph);
    }
    const fc = this.farSheet.getContext('2d');
    fc.setTransform(1, 0, 0, 1, 0, 0);
    fc.globalCompositeOperation = 'source-over';
    fc.clearRect(0, 0, this.pw, this.ph);
    for (const it of items) {
      if (it.sky) continue;
      fc.globalCompositeOperation = it.kind === 'range' ? 'source-over' : 'destination-out';
      it.draw(fc, v);
    }
    fc.globalCompositeOperation = 'destination-out';
    for (const mv of moving) mv.draw(fc, v);
    fc.globalCompositeOperation = 'source-over';
    // and the plant on its own
    if (!this.plantSheet || this.plantSheet.width !== this.pw || this.plantSheet.height !== this.ph) {
      this.plantSheet = canvasOf(this.pw, this.ph);
    }
    const pc = this.plantSheet.getContext('2d');
    pc.setTransform(1, 0, 0, 1, 0, 0);
    pc.clearRect(0, 0, this.pw, this.ph);
    this.drawPlant(pc, v);
  }
}

export class RendererCollage {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('This browser could not open WebGL 2.');
    this.gl = gl;
    this.gpuName = 'WebGL 2 (collage)';
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
    this.texFar = tex();
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
    gl.bindTexture(gl.TEXTURE_2D, this.texFar);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sketch.farSheet);
    gl.useProgram(this.prog);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uFar'), 2);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uWorld'), 0);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uPlant'), 1);
    gl.uniform2f(gl.getUniformLocation(this.prog, 'uRes'), this.pw, this.ph);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uPx'), this.dpr);
    const an = this.sketch.anchor || [0, 0];
    gl.uniform2f(gl.getUniformLocation(this.prog, 'uAnchor'), an[0], an[1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const a = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(a);
  }
}
