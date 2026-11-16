// Plasticine: the whole scene modelled by hand.
//
// It is the 3D look's own scene, the same meshes under the same light, with
// one thing changed: what everything is made of. Every surface, the plant and
// the hills and the sky behind them, is the one material, in different colours.
//
//  - It is matte and a little waxy: light wraps round it, there is one broad
//    soft shine and no sharp one, and the shaded side keeps its colour.
//  - Nothing made by hand is true: every form is pushed a little out of shape,
//    lumpier where a thumb pressed it.
//  - And it carries the hand: dents the size of a fingertip, and the fine
//    ridges of the print itself, which is what makes it plasticine and not
//    plastic.
//  - It moves the way a model moves, a frame at a time.

import { Renderer3D } from '../../versions/v1/src/gl/renderer3d.js';

const CLAY_FNS = `
float clayH3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float clayN3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(clayH3(i), clayH3(i + vec3(1, 0, 0)), f.x), mix(clayH3(i + vec3(0, 1, 0)), clayH3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(clayH3(i + vec3(0, 0, 1)), clayH3(i + vec3(1, 0, 1)), f.x), mix(clayH3(i + vec3(0, 1, 1)), clayH3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
/** The worked surface at p, where one unit is the width of a print's ridge and a half. */
float claySurface(vec3 p) {
  // where a fingertip pressed and where it pushed the clay up beside itself
  float dents = clayN3(p * 0.085) * 0.65 + clayN3(p * 0.21 + 7.0) * 0.35;
  // the print: ridges that run together and swirl, in patches, never everywhere
  float swirl = clayN3(p * 0.055 + 13.0) * 9.0 + clayN3(p * 0.16) * 2.0;
  vec3 dir = normalize(vec3(0.62, 0.34, 0.71));
  float ridges = 0.5 + 0.5 * sin((dot(p, dir) * 0.55 + swirl) * 6.2832 / 1.5);
  float patch_ = smoothstep(0.42, 0.66, clayN3(p * 0.045 + 31.0));
  // and the grain of the stuff itself
  float grain = clayN3(p * 2.3);
  return dents * 1.0 + ridges * patch_ * 0.16 + grain * 0.05;
}
vec3 clayOf(vec3 a) {
  // plasticine comes in sticks of plain strong colour, none of them very dark
  float l = dot(a, vec3(0.2126, 0.7152, 0.0722));
  vec3 c = mix(vec3(l), a, 1.12);
  float t = clamp(l / 0.20, 0.0, 1.6);
  float want = 0.040 + 0.115 * pow(t, 0.75);
  return max(c, 0.0) * (want / max(l, 0.004));
}
`;

function patch({ SCENE_VS, SCENE_FS, DEPTH_VS, POST_FS }) {
  const swap = (src, from, to) => {
    if (!src.includes(from)) throw new Error('clay: the scene shader is not as expected near "' + from.slice(0, 40) + '"');
    return src.replace(from, to);
  };
  // every form a little out of true, and re-pressed between one frame and the next
  const lump = `
float clayVH(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float clayVN(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(clayVH(i), clayVH(i + vec3(1, 0, 0)), f.x), mix(clayVH(i + vec3(0, 1, 0)), clayVH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(clayVH(i + vec3(0, 0, 1)), clayVH(i + vec3(1, 0, 1)), f.x), mix(clayVH(i + vec3(0, 1, 1)), clayVH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 lumped(vec3 p, vec3 n, int id) {
  if (id == 0 || dot(n, n) < 0.25) return p;
  float boil = floor(uSceneTime * 6.0);
  float k = clayVN(p * 0.045) - 0.5 + (clayVN(p * 0.13 + boil * 0.37) - 0.5) * 0.35;
  return p + normalize(n) * k * 2.4;
}
void main() {`;
  let vs = swap(SCENE_VS, 'void main() {', lump);
  vs = swap(vs, 'vec3 pos = stirred(aPos, aUv, int(aParams.w + 0.5));',
    'vec3 pos = lumped(stirred(aPos, aUv, int(aParams.w + 0.5)), aNormal, int(aParams.w + 0.5));');

  let fs = swap(SCENE_FS, 'void main() {', CLAY_FNS + 'void main() {');
  // the surface is clay whatever the mesh was built to be
  fs = swap(fs, 'N = normalize(N - (T * (hx - h0) + Bt * (hy - h0)) * bumpStrength(matId) * 1.45 * uRelief);', `
  // the print keeps its size on the eye: far off it is a bigger hand's
  float clayPx = max(length(dpx), length(dpy));
  float clayS = exp2(ceil(log2(max(1.0, clayPx / 0.55))));
  vec3 cp = vWorld / clayS;
  float ce = 0.45;
  float c0 = claySurface(cp);
  float cx = claySurface(cp + T * ce);
  float cy = claySurface(cp + Bt * ce);
  N = normalize(N - (T * (cx - c0) + Bt * (cy - c0)) / ce * (matId == 0 ? 0.55 : 2.3));`);
  fs = swap(fs, 'float shadow = shadowAt(vLightPos, ndl);', `float shadow = shadowAt(vLightPos, ndl);
  {
    vec3 base = matId == 0 ? skyAt(vWorld, normalize(vNormal)) * (0.55 + uSkyColour * 1.1) * 0.42 : clayOf(vAlbedo);
    // pressed places are a shade deeper: the clay is thinner over what is under it
    base *= 0.88 + 0.24 * smoothstep(0.25, 0.85, c0);
    float wrap = clamp((dot(N, L) + 0.42) / 1.42, 0.0, 1.0);
    float sh = mix(0.42, 1.0, shadow);
    vec3 direct = base / 3.14159 * uSunColour * wrap * wrap * 1.9 * sh;
    // light gets a little way into it: the shaded side stays its own colour, warmer
    direct += base * base * uSunColour * (1.0 - wrap) * 0.10;
    // one broad waxy shine, and a soft edge where it turns away
    direct += uSunColour * pow(ndh, 22.0) * 0.045 * shadow;
    direct += base * uSunColour * pow(1.0 - ndv, 3.0) * 0.16;
    float up = N.y * 0.5 + 0.5;
    vec3 ambient = mix(uGroundColour, uSkyColour, up) * base * 1.05;
    float gloom = gloomAt(vWorld);
    vec3 lit = direct * gloom + ambient * mix(1.0, gloom, 0.60);
    if (matId == 0) { outColour = vec4(lit * mix(1.0, 0.16, uGloom), 0.0); return; }
    outColour = vec4(aerial(lit, vWorld, mix(0.20, 0.94, uUnderwater), uGloom > 0.5 ? min(1.0, gloom * 1.3) : 1.0), 0.0);
    return;
  }`);
  // the shadow has to fall from the lumped shape, near enough: leave the depth pass be
  return { SCENE_VS: vs, SCENE_FS: fs, DEPTH_VS, POST_FS };
}

export class RendererClay extends Renderer3D {
  constructor(canvas) {
    super(canvas, { shaders: patch });
    this.gpuName = 'WebGL 2 (clay)';
    this.held = null;
  }

  /** A model is moved between exposures: growth and weather go a frame at a time. */
  render(plant, cam, time, sections, reveal = null) {
    const FRAME = 1 / 12;
    const t = Math.floor(time / FRAME) * FRAME;
    if (reveal) {
      if (!this.held || this.held.step !== reveal.step || this.held.t !== t || reveal.progress >= 1) {
        this.held = { step: reveal.step, t, reveal: { ...reveal } };
      }
      reveal = this.held.reveal;
    } else this.held = null;
    return super.render(plant, cam, t, sections, reveal);
  }
}
