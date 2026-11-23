// Riso: the whole scene run through a stencil duplicator.
//
// A risograph does not print a picture, it prints inks: one drum a colour, one
// pass a drum, each pass laid over the last on the same sheet and never quite
// in the same place. So this is not a tint over a picture. The lit, rounded
// scene (the 3D look's, drawn out of sight) is taken apart into three drums,
// blue, fluorescent pink and yellow; each is screened into dots at its own
// angle, slips its own small way off register, takes the ink unevenly, and is
// laid on cream paper where the inks multiply through one another. What makes
// green is yellow under blue, and where the drums disagree you get the bright
// fringe down the edge of everything.

import { Renderer3D } from '../../versions/v1/src/gl/renderer3d.js';

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uPx;      // device pixels to a CSS pixel
uniform float uSheet;   // which sheet this is: the grain and the slip change with it
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
/** The scene as the drum's master sees it: p in CSS pixels from the top left. */
vec3 scene(vec2 p) {
  vec2 uv = p * uPx / uRes;
  uv.y = 1.0 - uv.y;
  vec3 c = texture(uScene, clamp(uv, 0.001, 0.999)).rgb;
  // a master is cut harder than the picture it is cut from
  c = clamp((c - 0.5) * 1.18 + 0.47, 0.0, 1.0);
  // nothing is printed solid edge to edge: the deepest tone still shows the screen
  c = pow(c, vec3(0.80)) * 0.94 + 0.06;
  return c;
}
/** How much of each ink a colour asks for: blue, pink, yellow. */
vec3 inksFor(vec3 c) {
  float blue = 1.0 - c.r;
  float pink = clamp(((1.0 - c.g) - 0.50 * blue) / 0.74, 0.0, 1.0);
  float yell = clamp((1.0 - c.b) - 0.22 * blue - 0.30 * pink, 0.0, 1.0);
  // the dark of the picture is carried by the blue drum: it is the key
  // (the dark only: a red stays pink and yellow, with no blue to muddy it)
  float k = 1.0 - max(c.r, max(c.g, c.b));
  blue = clamp(max(blue, k * 1.25), 0.0, 1.0);
  // and where the key is heavy the bright drums hold back, or three inks
  // on one spot turn to mud and the sheet never dries
  float hold = 1.0 - 0.85 * smoothstep(0.35, 0.85, k);
  pink *= hold; yell *= hold;
  return vec3(blue, pink, yell);
}
/** A screen of round dots: how much ink lands at p for a tone 0..1. */
float screen(vec2 p, float tone, float angle, float pitch, float seed) {
  float s = sin(angle), c = cos(angle);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y) / pitch;
  float dots = 0.5 + 0.25 * (cos(q.x * 6.2832) + cos(q.y * 6.2832));
  // the grain of the master: the dots are never clean, and flat tone breaks up
  float g = vnoise(p * 1.35 + seed) * 0.55 + hash21(floor(p * 1.6) + seed) * 0.45;
  float th = mix(dots, g, 0.42);
  float soft = 0.16;
  float a = smoothstep(th - soft, th + soft, tone * 1.16 - 0.05);
  // soy ink on uncoated paper: full solids still let the sheet through in flecks
  float fleck = smoothstep(0.80, 0.97, vnoise(p * 0.9 + seed * 3.0) * 0.6 + hash21(floor(p * 1.1) - seed) * 0.5);
  float uneven = 0.86 + 0.14 * vnoise(p * vec2(0.012, 0.09) + seed);
  return a * uneven * (1.0 - 0.55 * fleck);
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uPx;
  vec2 mid = uRes / uPx * 0.5;
  // each drum sits a little off the others, and a little askew
  float k = hash21(vec2(uSheet, 3.0));
  vec2 offPink = vec2(3.4, -2.2) + (vec2(k, fract(k * 7.3)) - 0.5) * 1.6;
  vec2 offYell = vec2(-2.8, 3.0) + (vec2(fract(k * 3.1), fract(k * 5.7)) - 0.5) * 1.6;
  vec2 d = p - mid;
  vec2 pPink = mid + d * 1.004 + vec2(-d.y, d.x) * 0.0022 + offPink;
  vec2 pYell = mid + d * 0.997 + vec2(d.y, -d.x) * 0.0018 + offYell;

  float blue = inksFor(scene(p)).x;
  float pink = inksFor(scene(pPink)).y;
  float yell = inksFor(scene(pYell)).z;
  // the fringe: each bright drum also carries a ghost of the key
  float kB = smoothstep(0.75, 0.2, blue);   // (only where this spot is itself light: the fringe is an edge)
  pink = max(pink, inksFor(scene(pPink)).x * 0.30 * kB);
  yell = max(yell, inksFor(scene(pYell)).x * 0.22 * kB);

  float aB = screen(p, blue, 1.309, 4.6, 11.0);
  float aP = screen(pPink, pink, 0.262, 4.6, 47.0);
  float aY = screen(pYell, yell, 0.0, 5.0, 83.0);

  // cream stock, with its fibre
  vec3 paper = vec3(0.953, 0.925, 0.868);
  paper *= 0.975 + 0.05 * vnoise(p * 0.55) - 0.035 * smoothstep(0.72, 0.95, vnoise(p * vec2(0.25, 2.2) + 9.0));
  vec3 inkB = vec3(0.07, 0.25, 0.72);
  vec3 inkP = vec3(1.0, 0.30, 0.62);
  vec3 inkY = vec3(1.0, 0.89, 0.12);
  vec3 col = paper;
  col *= mix(vec3(1.0), inkY, aY * 0.94);
  col *= mix(vec3(1.0), inkP, aP * 0.90);
  col *= mix(vec3(1.0), inkB, aB * 0.95);
  outColour = vec4(col, 1.0);
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

export class RendererRiso {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('This browser could not open WebGL 2.');
    this.gl = gl;
    this.gpuName = 'WebGL 2 (riso)';
    this.renderScale = 1;
    // the scene itself, lit and round, drawn where nobody sees it
    const hidden = document.createElement('canvas');
    hidden.className = 'stage';
    hidden.style.visibility = 'hidden';
    hidden.style.pointerEvents = 'none';
    hidden.setAttribute('aria-hidden', 'true');
    (canvas.parentNode || document.body).insertBefore(hidden, canvas);
    this.hidden = hidden;
    try { this.scene = new Renderer3D(hidden); } catch (err) { hidden.remove(); throw err; }
    this.prog = program(gl, VS, FS);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.sheet = 0;
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
    this.scene.resize();
  }

  set fixedScale(v) { this.scene.fixedScale = v; }
  get fixedScale() { return this.scene.fixedScale; }
  invalidate() { this.scene.invalidate(); }
  setLook() {}
  camYToPlaceAt(...a) { return this.scene.camYToPlaceAt(...a); }
  camYToCentre(...a) { return this.scene.camYToCentre?.(...a); }
  camXToCentre(...a) { return this.scene.camXToCentre?.(...a); }
  project(...a) { return this.scene.project(...a); }
  setWorld(...a) { this.scene.setWorld(...a); }

  render(plant, cam, time, sections, reveal = null) {
    this.resize();
    this.scene.render(plant, cam, time, sections, reveal);
    // one sheet per section: the register slips anew each time something is added
    this.sheet = plant?.sections?.length || 0;
    const gl = this.gl;
    gl.viewport(0, 0, this.pw, this.ph);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.hidden);
    gl.useProgram(this.prog);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uScene'), 0);
    gl.uniform2f(gl.getUniformLocation(this.prog, 'uRes'), this.pw, this.ph);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uPx'), this.dpr);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uSheet'), this.sheet);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const a = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(a);
  }
}
