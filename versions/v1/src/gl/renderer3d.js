// The 3D renderer.
//
// Three passes:
//   1. depth from the light, into a shadow map
//   2. the scene, lit, into a half-float target with depth
//   3. a camera pass: depth of field, bloom, tonemap, grain, vignette
//
// The point of the rewrite is that the first and third of those are things a 2D
// canvas cannot do at all. A stem now occludes the stem behind it, drops a real
// shadow on the sweep, and goes soft when it is out of the focal plane.

import {
  createGL, program, setUniforms, mesh, disposeMesh, framebuffer, shadowTarget,
  fullscreenTriangle, mat4, norm3,
} from './glutil.js';
import { LAYOUT } from './meshes.js';
import { buildPlant, buildBackdrop, PLACES } from './scene.js';
import { ENV_BY_ID, ENVIRONMENTS, dominantEnv, buildBands } from '../environment.js';

const SHADOW_SIZE = 2048;

// Light direction matches the 2D renderer's, so the two agree about where the
// sun is: upper left, slightly towards the viewer.
export const LIGHT_DIR = norm3([-0.46, 0.58, 0.68]);

const SCENE_VS = `#version 300 es
precision highp float;
in vec3 aPos; in vec3 aNormal; in vec3 aAlbedo; in vec4 aParams; in vec2 aUv;
uniform mat4 uViewProj; uniform mat4 uLightViewProj; uniform float uSceneTime;
out vec3 vWorld; out vec3 vNormal; out vec3 vAlbedo; out vec4 vParams;
out vec2 vUv; out vec4 vLightPos;

float wob(vec2 p) {
  return fract(sin(dot(p, vec2(41.7, 289.1))) * 43758.5453);
}

/**
 * The living parts of the world, moved.
 *
 * All of this is geometry built once and never rebuilt — the world mesh is
 * megabytes and touching it per frame would cost more than the whole render.
 * So the movement happens here instead, as a displacement keyed to the material
 * an vertex belongs to. Nothing is animated that should not be: rock, ground,
 * trunks and the plant itself pass through untouched.
 *
 * The phases come from world position rather than from any per-vertex data, so
 * everything in one flock or one clump shares a phase and moves together, and
 * two of them a long way apart do not.
 */
vec3 stirred(vec3 p, vec2 uv, int id) {
  if (id == 23) {                                  // cloud, on the wind
    p.x += sin(uSceneTime * 0.019 + p.z * 0.00004) * 900.0;
    p.y += sin(uSceneTime * 0.031 + p.x * 0.00006) * 90.0;
  } else if (id == 29) {                           // birds: flying, and flapping
    float ph = wob(floor(p.xz * 0.0012)) * 6.2832;
    p.x += sin(uSceneTime * 0.17 + ph) * 1500.0;
    p.z += cos(uSceneTime * 0.17 + ph) * 1500.0;
    p.y += sin(uSceneTime * 0.4 + ph) * 90.0;
    // uv.x runs out along the wing from the body, so the tip travels furthest
    p.y += sin(uSceneTime * 6.5 + ph) * uv.x * 0.5;
  } else if (id == 30) {                           // fish, holding station
    float ph = wob(floor(p.xz * 0.004)) * 6.2832;
    p.x += sin(uSceneTime * 0.5 + ph) * 90.0;
    p.z += cos(uSceneTime * 0.37 + ph) * 90.0;
    p.y += sin(uSceneTime * 0.8 + ph) * 14.0;
  } else if (id == 31) {                           // anything with a blade to it
    float ph = p.x * 0.004 + p.z * 0.0052;
    float sway = sin(uSceneTime * 1.15 + ph) * 0.6 + sin(uSceneTime * 2.7 + ph * 1.7) * 0.4;
    p.x += sway * uv.x * 0.09;
    p.z += sway * uv.x * 0.05;
  }
  return p;
}

void main() {
  vec3 pos = stirred(aPos, aUv, int(aParams.w + 0.5));
  vWorld = pos; vNormal = aNormal; vAlbedo = aAlbedo; vParams = aParams; vUv = aUv;
  vLightPos = uLightViewProj * vec4(pos, 1.0);
  gl_Position = uViewProj * vec4(pos, 1.0);
}`;

const SCENE_FS = `#version 300 es
precision highp float;
in vec3 vWorld; in vec3 vNormal; in vec3 vAlbedo; in vec4 vParams;
in vec2 vUv; in vec4 vLightPos;
uniform vec3 uLightDir; uniform vec3 uEye;
uniform vec3 uSunColour; uniform vec3 uSkyColour; uniform vec3 uGroundColour;
uniform float uRelief;   // 0 flattens every surface, for isolating the relief in tests
uniform float uSceneExposure;   // so a drawing can cancel it and keep its own range
uniform float uWorldKind;       // which ground the plant started from
uniform float uNightness;       // 0 day, 1 night — the whole column drifts through it
uniform sampler2D uShadow;
uniform float uWorldIdiom;      // 0 = the world as it is; otherwise the manner it has taken on
uniform float uUnderwater;      // 1 when the camera is in the sea rather than above it
uniform float uGloom;           // 1 in a cave: no light but what falls through the break
uniform float uRecede;          // 1 to hold the world back behind the plant; 0 to see it raw
out vec4 outColour;

float shadowAt(vec4 lp, float ndl) {
  vec3 pc = lp.xyz / lp.w * 0.5 + 0.5;
  if (pc.z > 1.0 || pc.x < 0.0 || pc.x > 1.0 || pc.y < 0.0 || pc.y > 1.0) return 1.0;
  // slope-scaled bias, or a surface facing away from the light shadows itself
  float bias = mix(0.0016, 0.0004, ndl);
  float lit = 0.0;
  vec2 texel = vec2(1.0 / ${SHADOW_SIZE}.0);
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float d = texture(uShadow, pc.xy + vec2(float(x), float(y)) * texel * 1.4).r;
      lit += (pc.z - bias) > d ? 0.0 : 1.0;
    }
  }
  return lit / 9.0;
}

// ------------------------------------------------------------- surfaces --
//
// Roughness alone does not tell two materials apart: under one light a rough
// tube and a smooth tube are both still tubes. What separates them is relief —
// bark runs in fibres along its length, cloth is woven, clay is dimpled, metal
// is brushed. Each material gets a height field in its own surface coordinates,
// and the normal is bent by its slope.

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
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.07; a *= 0.5; }
  return s;
}

float surfaceHeight(int id, vec2 uvRaw) {
  vec2 uv = uvRaw * 0.19;
  if (id == 1) {                                   // botanical: fibres along the stem
    return fbm(vec2(uv.x * 0.10, uv.y * 2.6)) * 0.55
         + fbm(uv * 0.06) * 0.45;
  } else if (id == 3) {                            // clay: worked, thumbed
    return fbm(uv * 0.66) * 0.62 + vnoise(uv * 1.6) * 0.38;
  } else if (id == 4) {                            // wool: dense fuzz
    return fbm(uv * 1.5) * 0.7 + vnoise(uv * 4.0) * 0.3;
  } else if (id == 5) {                            // thread: helical plies
    return sin(uv.x * 0.9 + uv.y * 2.2) * 0.5 + 0.5;
  } else if (id == 6) {                            // embroidery: satin stitches
    return fract((uv.x * 0.55 + uv.y * 0.18)) * 0.8 + fbm(uv * 0.6) * 0.2;
  } else if (id == 7) {                            // paper: fibre tooth
    return fbm(uv * 1.1) * 0.6 + fbm(vec2(uv.y, uv.x) * 2.3) * 0.4;
  } else if (id == 9) {                            // metal: brushed along the length
    return fbm(vec2(uv.x * 0.04, uv.y * 9.0)) * 0.9 + 0.1;
  } else if (id == 10) {                           // wax: soft pours
    return fbm(uv * 0.38) * 0.75 + fbm(uv * 0.9) * 0.25;
  } else if (id == 11) {                           // mould: spores
    return pow(vnoise(uv * 2.2), 2.0) * 0.7 + fbm(uv * 0.9) * 0.3;
  } else if (id == 13) {                           // oil: loaded brush strokes
    return fbm(vec2(uv.x * 0.55, uv.y * 1.3)) * 0.8 + sin(uv.y * 2.2) * 0.12;
  } else if (id == 15) {                           // charcoal: paper tooth, coarse
    return fbm(uv * 1.7) * 0.5 + vnoise(uv * 3.3) * 0.5;
  } else if (id == 12 || id == 14) {               // gouache, watercolour: paper
    return fbm(uv * 0.8) * 0.7;
  } else if (id == 16) {                           // porcelain: faint crazing
    return fbm(uv * 0.5) * 0.7 + pow(vnoise(uv * 3.4), 6.0) * 0.3;
  } else if (id == 17) {                           // rust: pitted and flaking
    return pow(vnoise(uv * 1.8), 1.6) * 0.6 + fbm(uv * 0.7) * 0.4;
  } else if (id == 18) {                           // velvet: dense short pile
    return fbm(uv * 2.2) * 0.6 + vnoise(uv * 5.0) * 0.4;
  } else if (id == 19) {                           // bone: porous
    return fbm(uv * 1.2) * 0.55 + pow(vnoise(uv * 2.6), 2.0) * 0.45;
  } else if (id == 20) {                           // resin: slow flow
    return fbm(uv * 0.45) * 0.8 + fbm(uv * 1.1) * 0.2;
  } else if (id == 21) {                           // stone: granular
    return vnoise(uv * 3.0) * 0.5 + fbm(uv * 1.0) * 0.5;
  } else if (id == 23) {                           // cloud: soft billow
    return fbm(uv * 0.22) * 0.7 + fbm(uv * 0.6) * 0.3;
  } else if (id == 24) {                           // terrain
    return fbm(uv * 0.30) * 0.6 + vnoise(uv * 1.1) * 0.4;
  } else if (id == 25) {                           // distant rock
    return vnoise(uv * 2.4) * 0.5 + fbm(uv * 0.9) * 0.5;
  } else if (id == 26) {                           // distant leaf
    return fbm(uv * 1.4) * 0.6 + vnoise(uv * 3.2) * 0.4;
  } else if (id == 29) {                           // feather
    return fbm(uv * 2.2) * 0.6 + vnoise(uv * 7.0) * 0.4;
  } else if (id == 30) {                           // scale
    return vnoise(uv * 9.0) * 0.6 + fbm(uv * 3.0) * 0.4;
  } else if (id == 31) {                           // a blade, ribbed along its length
    return fbm(vec2(uv.x * 0.4, uv.y * 3.0)) * 0.7 + vnoise(uv * 4.0) * 0.3;
  } else if (id == 28) {                           // cave rock: grain, grit and fracture
    // Three scales, because a rock face has three: the bedding it split along,
    // the blocks that broke out of it, and the grain of the stone itself.
    return fbm(uv * 0.55) * 0.42 + vnoise(uv * 1.7) * 0.30
      + vnoise(uv * 6.5) * 0.18 + fbm(uv * 15.0) * 0.10;
  } else if (id == 27) {                           // water: ripple over swell
    return fbm(uv * 0.5) * 0.55 + vnoise(uv * 1.9) * 0.30 + vnoise(uv * 5.5) * 0.15;
  } else if (id == 22) {                           // flock: dense even pile
    return fbm(uv * 3.1) * 0.55 + vnoise(uv * 7.0) * 0.45;
  } else if (id == 42) {                           // grain
    return vnoise(uv * 2.6);
  }
  return fbm(uv * 0.12) * 0.35;                    // glass, vector, backdrop: near flat
}

/**
 * The dominant frequency of each material's height field.
 *
 * The relief gradient used to be sampled at a fixed offset in uv, but feature
 * sizes here span more than a decade — wool's fuzz against clay's slow dimples.
 * A fixed offset is a fine derivative for the coarse materials and a wild
 * over-step for the fine ones, which flattens exactly the surfaces that should
 * be roughest: wool measured smoother than clay. Sampling a fixed fraction of
 * each material's own cell makes the numbers comparable, and lets bumpStrength
 * mean what it says.
 */
float featureFreq(int id) {
  if (id == 4) return 1.5;                         // wool
  if (id == 15) return 1.7;                        // charcoal
  if (id == 7) return 1.1;                         // paper
  if (id == 11) return 2.2;                        // mould
  if (id == 42) return 2.6;                        // grain
  if (id == 16) return 0.5;                        // porcelain
  if (id == 17) return 1.8;                        // rust
  if (id == 18) return 2.2;                        // velvet
  if (id == 19) return 1.2;                        // bone
  if (id == 20) return 0.45;                       // resin
  if (id == 21) return 3.0;                        // stone
  if (id == 22) return 3.1;                        // flock
  if (id == 23) return 0.22;                       // cloud
  if (id == 24) return 1.05;                      // terrain
  if (id == 25) return 0.95;                      // distant rock
  if (id == 26) return 0.40;                       // distant leaf
  if (id == 27) return 0.28;                       // water
  if (id == 28) return 1.30;                      // cave rock
  if (id == 29) return 0.9;                       // feather
  if (id == 30) return 1.4;                       // scale
  if (id == 31) return 0.7;                       // blade
  if (id == 9) return 9.0;                         // metal, brushed
  if (id == 6) return 0.55;                        // embroidery, stitch pitch
  if (id == 5) return 2.2;                         // thread
  if (id == 12 || id == 14) return 0.8;            // gouache, watercolour
  if (id == 13) return 1.3;                        // oil
  if (id == 1) return 2.6;                         // botanical fibres
  if (id == 3) return 0.66;                        // clay
  if (id == 10) return 0.38;                       // wax
  return 0.12;
}

float bumpStrength(int id) {
  if (id == 4) return 1.75;                        // wool
  if (id == 6) return 1.55;                        // embroidery
  if (id == 11) return 1.45;                       // mould
  if (id == 15) return 1.15;                       // charcoal
  if (id == 5) return 1.10;                        // thread
  if (id == 3) return 1.35;                        // clay, thumbed by hand
  if (id == 13) return 1.05;                       // oil
  if (id == 1) return 0.80;                        // botanical
  if (id == 7) return 0.62;                        // paper
  if (id == 9) return 0.44;                        // metal
  if (id == 17) return 1.60;                       // rust
  if (id == 18) return 1.35;                       // velvet
  if (id == 21) return 1.05;                       // stone
  if (id == 22) return 1.60;                       // flock
  if (id == 23) return 0.55;                       // cloud
  if (id == 24) return 0.90;                       // terrain
  if (id == 25) return 0.80;                       // distant rock
  if (id == 26) return 0.55;                       // distant leaf
  if (id == 27) return 0.85;                       // water: the swell is the surface
  if (id == 28) return 1.25;                      // cave rock: deep relief, hard edges
  if (id == 29) return 0.50;                      // feather
  if (id == 30) return 0.35;                      // scale
  if (id == 31) return 0.45;                      // blade
  if (id == 19) return 0.85;                       // bone
  if (id == 20) return 0.30;                       // resin
  if (id == 16) return 0.20;                       // porcelain
  if (id == 8) return 0.04;                        // glass
  if (id == 0) return 0.10;                        // the sweep: a whisper of tooth
  if (id >= 40) return 0.10;                       // the flat idioms stay flat
  return 0.40;
}

/**
 * How much the height field tints the colour, not just the normal.
 *
 * Every material used to get the same flat 12% — but the thing that makes felt
 * look like felt is that its fibres are lighter and darker, not only that they
 * are bumpy. Relief alone reads as a shiny surface with a pattern of highlights
 * on it; pigment variation is what makes it a substance.
 */
float albedoVar(int id) {
  if (id == 11) return 0.78;                       // mould, blotchy
  if (id == 15) return 0.70;                       // charcoal
  if (id == 14) return 0.62;                       // watercolour, pooling
  if (id == 4) return 0.58;                        // wool
  if (id == 13) return 0.55;                       // oil, loaded and thin
  if (id == 42) return 0.52;                       // grain
  if (id == 6) return 0.46;                        // embroidery
  if (id == 3) return 0.42;                        // clay
  if (id == 5) return 0.40;                        // thread
  if (id == 7) return 0.36;                        // paper
  if (id == 1) return 0.30;                        // botanical
  if (id == 12) return 0.28;                       // gouache, flat by nature
  if (id == 9) return 0.26;                        // metal
  if (id == 10) return 0.20;                       // wax
  if (id == 8) return 0.05;                        // glass
  if (id == 0) return 0.06;                        // the sweep
  return 0.14;
}

/**
 * What the surface is *made of*, in colour rather than in brightness.
 *
 * Everything up to here varied a material by how rough it was and how much its
 * height field lightened and darkened it, which is monochrome: it can make a
 * surface look bumpy but never like a particular substance. Rust is not brown
 * wood with deeper pits, it is orange oxide in patches over dark iron; granite
 * is pale stone with dark mineral flecks in it; blue-and-white porcelain is
 * drawn on. Those are all facts about colour, and none of them were expressible
 * before this.
 *
 * Returned as a multiplier on the albedo, so it rides on top of whatever
 * pigment the plant and the material already agreed on.
 */
vec3 patternTint(int id, vec2 uvRaw, float h) {
  vec2 uv = uvRaw * 0.19;

  if (id == 17) {                                  // rust
    // oxide in patches, bare metal showing through where it has not taken
    // 'patch' is reserved in GLSL ES 3.00
    float taken = smoothstep(0.42, 0.66, fbm(uv * 0.55));
    float scab = smoothstep(0.55, 0.85, vnoise(uv * 1.7));
    vec3 iron = vec3(0.32, 0.30, 0.30);
    vec3 oxide = vec3(1.45, 0.72, 0.30);
    vec3 deep = vec3(0.85, 0.34, 0.16);
    return mix(iron, mix(oxide, deep, scab), taken);
  }
  if (id == 21) {                                  // stone
    // pale ground with darker and lighter grains through it
    float dark = smoothstep(0.62, 0.78, vnoise(uv * 3.4));
    float pale = smoothstep(0.66, 0.86, vnoise(uv * 2.1 + 31.0));
    vec3 c = vec3(1.0);
    c = mix(c, vec3(0.52, 0.50, 0.47), dark * 0.8);
    c = mix(c, vec3(1.30, 1.28, 1.22), pale * 0.5);
    return c;
  }
  if (id == 16) {                                  // porcelain
    // blue underglaze: a few soft shapes with a darker line where the brush
    // turned, which is what makes it read as painted rather than stained
    float m = fbm(uv * 0.42 + 5.0);
    float shape = smoothstep(0.52, 0.60, m);
    float edge = smoothstep(0.58, 0.60, m) - smoothstep(0.60, 0.64, m);
    vec3 blue = vec3(0.30, 0.46, 1.35);
    vec3 c = mix(vec3(1.0), blue, shape * 0.85);
    return mix(c, vec3(0.16, 0.28, 1.10), edge * 0.9);
  }
  if (id == 19) {                                  // bone
    // porous, and yellowed unevenly the way old bone is
    float age = fbm(uv * 0.5 + 11.0);
    float pore = smoothstep(0.60, 0.80, vnoise(uv * 3.0));
    vec3 c = mix(vec3(1.02, 1.00, 0.94), vec3(0.96, 0.88, 0.70), age);
    return mix(c, vec3(0.72, 0.66, 0.55), pore * 0.55);
  }
  if (id == 9) {                                   // metal
    // brushed: fine streaks that run along the length, not across it
    float streak = fbm(vec2(uv.x * 0.05, uv.y * 11.0));
    return vec3(0.86 + streak * 0.34);
  }
  if (id == 11) {                                  // mould
    float bloom = smoothstep(0.45, 0.75, vnoise(uv * 2.4));
    return mix(vec3(0.70, 0.76, 0.62), vec3(1.15, 1.10, 0.92), bloom);
  }
  if (id == 1) {                                   // botanical
    // fibres running the length of the stem, and a paler underside stripe
    float fib = fbm(vec2(uv.x * 0.08, uv.y * 3.4));
    return vec3(0.90 + fib * 0.22);
  }
  if (id == 20) {                                  // resin
    // amber is not uniform: it holds darker seams and the odd clouded patch
    float seam = smoothstep(0.50, 0.72, fbm(uv * 0.7));
    return mix(vec3(1.12, 0.98, 0.74), vec3(0.72, 0.52, 0.28), seam * 0.7);
  }
  if (id == 3) {                                   // clay
    float fire = fbm(uv * 0.6 + 2.0);
    return mix(vec3(1.06, 0.98, 0.90), vec3(0.86, 0.78, 0.72), fire * 0.7);
  }
  if (id == 15) {                                  // charcoal
    float ash = smoothstep(0.58, 0.80, vnoise(uv * 2.6));
    return mix(vec3(1.0), vec3(1.45, 1.42, 1.38), ash * 0.35);
  }
  return vec3(1.0);
}

float sheenStrength(int id) {
  if (id == 4) return 1.15;                        // wool
  if (id == 6) return 0.85;                        // embroidery
  if (id == 5) return 0.70;                        // thread
  if (id == 7) return 0.30;                        // paper
  if (id == 11) return 0.45;                       // mould
  if (id == 15) return 0.22;                       // charcoal
  if (id == 18) return 1.30;                       // velvet: the whole point of it
  if (id == 22) return 1.55;                       // flock: fuzzier still
  if (id == 23) return 1.10;                       // cloud: lit from every side at once
  if (id == 19) return 0.20;                       // bone
  if (id == 1) return 0.18;                        // leaf down
  return 0.0;
}

/**
 * The world behind the plant, as a function of how high up you are looking.
 *
 * The backdrop used to be one flat tint per section, picked from a list of
 * twelve moods — which fought the thing the whole piece is built on. Growth
 * happens on one continuous vertical canvas with the ground at zero and the
 * future upward, and the background was the only part of the scene that did not
 * know that. It is a single column now: ground, then the air just above it,
 * then cloud, then the thinning blue, then the dark and the stars. Scrolling
 * down through the plant's history goes back down through the world it grew in,
 * because they are the same axis.
 */
// The sky, by the angle you look at it — not by how high the surface showing it
// happens to be.
//
// Keyed to world height, the gradient ran out at six thousand units and went to
// near-black above that. On a shell that stood sixteen thousand tall the top of
// every frame was therefore outer space, in the middle of the afternoon, and
// climbing high enough took the plant into it. Sky colour has nothing to do with
// altitude: it is the depth of atmosphere you are looking through, which is a
// function of the elevation angle alone. At the horizon you look through the
// most air and it is palest; straight up you look through the least and it is
// deepest. That model needs no shell height at all and cannot run out.
// Light in a cave comes from one place, and everything else is dark.
//
// With the ordinary hemisphere ambient a cave is only a grey room: every
// surface takes sky light from every direction, which is exactly what a roof
// prevents. This is the roof. Light falls in a shaft through the break above
// the plant, drops off with distance from it and runs out with depth — and it
// ends: above the opening the sky is unobstructed again, so an organism that
// keeps climbing climbs out into the daylight. In a cave that is the only
// direction out, which is worth the plant having to find.
float gloomAt(vec3 world) {
  if (uGloom < 0.5) return 1.0;
  // Dramatic, not unlit. The first pass took the floor to eight per cent and
  // the shaft to a couple of thousand units wide, which is physically the right
  // shape and renders as a black rectangle: everything the eye needs is in the
  // range this now spans — full light under the break, two thirds on the near
  // walls, a third on the far end of the passage.
  float across = length(world.xz) / 1600.0;
  float shaft = exp(-across * across * 1.15);
  float escaped = smoothstep(2400.0, 4200.0, world.y);
  return clamp(max(0.10 + shaft * 0.95, escaped), 0.0, 1.35);
}

vec3 skyDir(vec3 dir) {
  float up = clamp(dir.y, -0.25, 1.0);

  vec3 haze = vec3(0.72, 0.80, 0.86);      // the horizon: all the air there is
  vec3 mid = vec3(0.38, 0.60, 0.88);
  vec3 deep = vec3(0.16, 0.38, 0.80);      // overhead: the least of it
  vec3 air = mix(haze, mid, smoothstep(0.0, 0.085, up));
  air = mix(air, deep, smoothstep(0.06, 0.42, up));

  // Night, on the same axis: still palest towards the horizon, because the
  // atmosphere is still deepest there and still carries what light there is.
  vec3 nightAir = mix(vec3(0.10, 0.13, 0.22), vec3(0.02, 0.03, 0.08),
    smoothstep(0.0, 0.5, up));
  air = mix(air, nightAir, uNightness);

  // Under the sea: the light comes from straight up and runs out fast going
  // down, and everything it does not reach is the same green blue.
  vec3 sea = mix(vec3(0.015, 0.055, 0.085), vec3(0.09, 0.34, 0.40),
    smoothstep(-0.5, 0.9, up));
  return mix(air, sea, uUnderwater);
}

/**
 * What a mirror pointed along dir would see.
 *
 * A metal has no diffuse term at all — everything visible on it arrives by
 * reflection — so with only a sun and one flat ambient number there was nothing
 * for it to be except black, and every metal stem in the game came out as a
 * silhouette with a hairline of colour at its edge. There is no environment map
 * here and there does not need to be one: the sky is already an analytic
 * function of direction, and below the horizon the answer is the ground, which
 * is one colour and a dark one.
 */
vec3 envAt(vec3 dir) {
  vec3 earth = uGroundColour * 2.2 + vec3(0.03);
  return mix(earth, skyDir(dir), smoothstep(-0.12, 0.10, dir.y));
}

// Distance eats contrast and pulls everything towards the colour of the air in
// between. It is the strongest depth cue there is, and it is what stitches the
// built distance to the sky behind it — without it a hill nine thousand units
// off is as saturated as a petal at arm's length, and the eye reads them as one
// plane. This is what the painted backdrop could never do: it had no distance
// to fade over.
vec3 aerial(vec3 lit, vec3 world, float k, float gloom) {
  vec3 to = world - uEye;
  float d = length(to);
  float onset = mix(6000.0, 260.0, uUnderwater);
  float rate = mix(0.000075, 0.00030, uUnderwater);
  float f = 1.0 - exp(-max(0.0, d - onset) * rate);
  vec3 air = skyDir(to / max(d, 0.001)) * (0.62 + uSkyColour * 0.9) * gloom;
  return mix(lit, air, f * k);
}

// What the atmosphere shell shows. No ground on it any more — the ground is
// geometry, standing in front of it, so this is only ever sky.
vec3 skyAt(vec3 world, vec3 nrm) {
  vec3 to = world - uEye;
  vec3 dir = to / max(length(to), 0.001);
  vec3 air = skyDir(dir);

  // No painted birds here any more. They were pinned to the shell, which meant
  // they never moved relative to the camera however far it climbed; they are
  // built now, in the air, at heights the plant can reach.

  // ---- stars ----
  //
  // Also by direction, which is the only way they hold still: pinned to world
  // position they slid across the sky as the camera climbed, and their size
  // depended on how far off the surface carrying them happened to stand.
  float night = uNightness;
  vec2 ang = vec2(atan(dir.x, -dir.z), asin(clamp(dir.y, -1.0, 1.0))) * 900.0;
  vec2 sp = floor(ang);
  float bright = step(0.9972, hash21(sp));
  vec2 within = fract(ang) - 0.5 + (vec2(hash21(sp * 1.7), hash21(sp * 2.3)) - 0.5) * 0.5;
  float point = 1.0 - smoothstep(0.10, 0.42, length(within));
  float star = bright * point * night * smoothstep(-0.02, 0.10, dir.y);
  air += vec3(star) * (0.55 + hash21(sp * 3.1) * 0.95) * vec3(0.92, 0.95, 1.0);
  return air;
}

// GGX, cut to what a small forward renderer needs
float distributionGGX(float ndh, float rough) {
  float a = rough * rough;
  float a2 = a * a;
  float d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / max(3.14159 * d * d, 1e-5);
}
float geometrySmith(float ndv, float ndl, float rough) {
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float gv = ndv / (ndv * (1.0 - k) + k);
  float gl = ndl / (ndl * (1.0 - k) + k);
  return gv * gl;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uEye - vWorld);
  if (dot(N, V) < 0.0) N = -N;          // blades are single-sided sheets
  int matId = int(vParams.w + 0.5);

  // The world keeps its own hours. When its era is a drawn one, its ids become
  // that idiom's id here, and the whole rest of the pipeline — the flat path
  // below, the screen-space work in the camera pass — treats the ground and the
  // sky as a drawing, on a rhythm that has nothing to do with what the plant is
  // made of or how far it has grown.
  int worldIdiom = int(uWorldIdiom + 0.5);
  bool ofTheWorld = matId == 0 || (matId >= 23 && matId <= 26);
  if (ofTheWorld && worldIdiom > 0) matId = worldIdiom;

  // relief: bend the normal by the slope of the material's own height field,
  // sampled at a fixed fraction of that material's own feature size
  float e = 0.16 / (0.19 * featureFreq(matId));
  float h0 = surfaceHeight(matId, vUv);
  float hx = surfaceHeight(matId, vUv + vec2(e, 0.0));
  float hy = surfaceHeight(matId, vUv + vec2(0.0, e));
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
  vec2 dux = dFdx(vUv), duy = dFdy(vUv);
  float det = dux.x * duy.y - duy.x * dux.y;
  vec3 T = abs(det) > 1e-8 ? normalize((dpx * duy.y - dpy * dux.y) / det) : normalize(dpx);
  vec3 Bt = normalize(cross(N, T));
  N = normalize(N - (T * (hx - h0) + Bt * (hy - h0)) * bumpStrength(matId) * 1.45 * uRelief);

  vec3 L = normalize(uLightDir);
  vec3 H = normalize(L + V);

  float rough = clamp(vParams.x + (h0 - 0.5) * 0.22 * (1.0 + albedoVar(matId) * 2.2), 0.04, 1.0);
  float metal = clamp(vParams.y, 0.0, 1.0);
  float trans = clamp(vParams.z, 0.0, 1.0);

  float ndl = max(dot(N, L), 0.0);
  float ndv = max(dot(N, V), 1e-4);
  float ndh = max(dot(N, H), 0.0);

  float shadow = shadowAt(vLightPos, ndl);

  // The flat idioms are pictures, not surfaces.
  //
  // They were a screen-space treatment laid over a fully photographic render,
  // so an ASCII section was a lit, specular, depth-blurred plant with
  // characters sprinkled on top: the drawing read as something sitting on the
  // plant rather than as the thing itself. A flat stepped light gives the idiom
  // clean tonal regions to quantise, and leaves nothing photographic underneath
  // to show through. Depth still writes normally, so one of these sections
  // still occludes what is behind it and still casts a real shadow.
  // The screens are printed *from* something lit.
  //
  // Grain, halftone, dither and riso describe tone by how much ink lands, and
  // ink that lands evenly describes nothing — a flat subject screened at one
  // density is a shape, not a picture. A reproduction of a lit object puts more
  // ink in the shadows, and that is the whole reason those processes can carry
  // an image at all. So these keep the ordinary lighting here and are screened
  // afterwards; the marks stay flat and the ground still shows through, but how
  // many of them there are follows the light.
  //
  // The drawn idioms — vector, line, ASCII, pixel, wireframe, blueprint and the
  // instrument readings — stay unlit, because those are drawings rather than
  // prints.
  // Grain, halftone, dither, riso — and the two instrument readings that are
  // also readings *of* something lit. A thermal camera looking at a lit object
  // sees the light; a depth pass is the one exception that genuinely does not,
  // so it is shaded afterwards rather than here.
  bool screened = matId == 42 || matId == 45 || matId == 46 || matId == 53
    || matId == 48 || matId == 50 || matId == 55 || matId == 56;

  if (matId >= 40 && !screened) {
    // No light at all. A drawing does not have a light source.
    //
    // These used to take a stepped lambert term, which gave every member a
    // bright side and a dark side and rounded it into a tube — the bevel that
    // gave the whole thing away as a 3D render wearing a 2D costume. A flat
    // graphic gets its form from its outline and from flat areas of tone
    // butting against each other, never from a gradient across a surface.
    // Keep the colour.
    //
    // Normalising the pigment to unit luminance is what lets the stepped tone
    // own the range, but only two fifths of it was being kept, and mixing the
    // rest towards white washed every drawn idiom out to grey. A vector
    // illustration of a green plant with red fruit is green and red; the point
    // of separating hue from tone was to keep the hue, not to discard it.
    float al = max(dot(vAlbedo, vec3(0.299, 0.587, 0.114)), 0.001);
    vec3 hue = mix(vec3(1.0), vAlbedo / al, 0.88);

    // Tone comes from what the part *is* — the pigment it was given, quantised
    // hard — so a stem, a leaf and a bloom are three flat areas rather than one
    // shaded mass.
    //
    // Stretched across the range a plant's pigments actually occupy, which is
    // narrow: albedo luminance runs from about 0.03 to 0.16 across a whole
    // organism. Quantising that as if it filled 0 to 1 put ninety-five per cent
    // of the plant in one bucket, so the drawing came out in a single glyph
    // everywhere and had no tonal structure left to describe anything with.
    float toneLo = ofTheWorld ? 0.14 : 0.03;
    float toneSpan = ofTheWorld ? 0.72 : 0.13;
    float own = floor(clamp((al - toneLo) / toneSpan, 0.0, 1.0) * 4.0 + 0.5) / 4.0;

    // and a few flat tiers by depth, so overlapping shapes read apart without
    // anything resembling shading. Flat illustration separates planes with
    // tints; it does not light them. The layer arrives per piece in the
    // roughness slot, which a drawing has no use for.
    float tier = floor(clamp(vParams.x, 0.0, 1.0) * 3.0 + 0.5) / 3.0;

    float page = clamp(0.12 + own * 0.66 + (tier - 0.5) * 0.20, 0.05, 0.97);
    // Undo the camera's transfer to land on that tone. A print does not get
    // brighter because the room is dim: letting exposure through blew every
    // flat idiom out to near-white in the dark scenes.
    vec3 drawn = pow(vec3(page), vec3(2.2)) * hue;
    outColour = vec4(drawn / max(uSceneExposure, 0.001), float(matId) / 255.0);
    return;
  }

  if (matId == 0) {
    // The sweep is only the surface this is projected onto; what it shows is
    // decided by where in the column each point of it sits.
    vec3 world3 = skyAt(vWorld, normalize(vNormal));
    // Lit gently and mostly ambiently: a sky is not a surface catching a sun,
    // and driving it off the sun's own colour left the ground end of the column
    // almost black in the dimmer weathers.
    float lit = (0.78 + max(dot(N, L), 0.0) * 0.22 * shadow)
      * mix(1.0, 0.16, uGloom);
    outColour = vec4(world3 * lit * (0.55 + uSkyColour * 1.1), 0.0);
    return;
  }

  float av = albedoVar(matId) * uRelief;
  vec3 albedo = vAlbedo * (1.0 - av * 0.5 + h0 * av);

  // Cavity occlusion. Light reaching the bottom of a pit has to get past the
  // walls of it, so a crevice is darker than a lambert term alone will ever
  // make it. Without this the relief reads as a pattern of highlights lying on
  // a flat surface rather than as a surface with depth in it — and it is the
  // cheapest thing that makes a rough material look rough.
  float cav = mix(1.0, smoothstep(-0.15, 0.72, h0), av * 0.85);
  albedo *= cav;
  albedo *= mix(vec3(1.0), patternTint(matId, vUv, h0), uRelief);
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  float D = distributionGGX(ndh, rough);
  float G = geometrySmith(ndv, ndl, rough);
  vec3 spec = (D * G * F) / max(4.0 * ndv * ndl, 1e-4);

  vec3 kd = (1.0 - F) * (1.0 - metal);
  vec3 direct = (kd * albedo / 3.14159 + spec) * uSunColour * ndl * shadow;

  // Fibrous surfaces scatter forward at grazing angles — the pale rim on a
  // wool edge. Nothing in a GGX lobe produces it, and without it cloth reads as
  // matte plastic, which is most of why wool and clay looked alike.
  float sheenAmt = sheenStrength(matId) * uRelief;
  if (sheenAmt > 0.0) {
    float rim = pow(1.0 - ndv, 3.5);
    direct += albedo * uSunColour * rim * sheenAmt * (0.35 + ndl * 0.65) * shadow;
  }

  // light coming through a leaf or a petal from behind
  float back = pow(max(dot(V, -L), 0.0), 2.0) * trans;
  direct += albedo * uSunColour * back * 0.55 * shadow;

  // hemisphere ambient: sky above, bounce from the sweep below
  float up = N.y * 0.5 + 0.5;
  vec3 sky = mix(uGroundColour, uSkyColour, up);
  vec3 ambient = sky * albedo * (1.0 - metal * 0.7) * mix(1.0, cav, 0.6);

  // Grazing reflectance: at a shallow angle every surface turns into a mirror.
  // With only a sun-driven GGX lobe, a smooth dark material had nothing to
  // catch — glass and charcoal came out as flat black silhouettes rather than
  // substances. This is the rim that tells you glass is glass.
  float fres = pow(1.0 - ndv, 5.0);
  vec3 envF = F0 + (1.0 - F0) * fres;
  // and what it reflects is the actual sky in the actual direction, blurred
  // towards the average by how rough the surface is. A flat ambient number here
  // is why metal was black: it had no sun in it, no sky above and no ground
  // below, so a mirror pointed anywhere returned the same dim grey.
  vec3 mirror = envAt(reflect(-V, N));
  vec3 env = mix(mirror, sky, rough * 0.75);
  ambient += env * envF * (1.0 - rough * 0.62) * (0.55 + trans * 0.7);
  // A metal's whole appearance is reflection; without this it keeps only the
  // grazing rim and reads as a hole cut in the picture.
  ambient += mirror * albedo * metal * (1.0 - rough * 0.55) * 0.85;

  // The world stands back, so the thing growing in it reads.
  //
  // Aerial perspective already separates them by distance, and it is not
  // enough: a green stem in front of a green hill is the same colour at nearly
  // the same value, and the eye has to work to find the subject. Painters have
  // one answer to this and have had it for centuries — everything that is not
  // the subject loses saturation and loses contrast, and keeps losing them with
  // distance. That is all this is, applied only to what the world is made of.
  // The plant is untouched: it is the only thing in the picture at full colour
  // and full contrast, which is what makes it the subject rather than the
  // largest object.
  if (ofTheWorld && uRecede > 0.5) {
    // Enough to put the world behind the plant, not enough to drain it. At
    // nearly half the colour gone by five thousand units the ground went grey
    // and the whole picture with it — holding a background back is a nudge, and
    // past a certain point it stops being restraint and starts being fog.
    float far = clamp((length(vWorld - uEye) - 900.0) / 7000.0, 0.0, 1.0);
    vec3 lit = direct + ambient;
    float l = dot(lit, vec3(0.2126, 0.7152, 0.0722));
    lit = mix(lit, vec3(l), 0.26 * far);                  // colour goes first
    lit = mix(lit, vec3(l * 0.5 + 0.26), 0.16 * far);     // then contrast
    direct = lit;
    ambient = vec3(0.0);
  }

  float gloom = gloomAt(vWorld);
  direct *= gloom;
  ambient *= mix(1.0, gloom, 0.60);
  float hazeGloom = uGloom > 0.5 ? min(1.0, gloom * 1.3) : 1.0;

  // the material id rides out in alpha so the camera pass can find it again
  outColour = vec4(aerial(direct + ambient, vWorld,
      matId == 23 ? 0.16 : mix(0.34, 0.94, uUnderwater), hazeGloom),
    float(matId) / 255.0);
}`;

const DEPTH_VS = `#version 300 es
precision highp float;
in vec3 aPos;
uniform mat4 uLightViewProj;
void main() { gl_Position = uLightViewProj * vec4(aPos, 1.0); }`;

const DEPTH_FS = `#version 300 es
precision highp float;
void main() {}`;

const POST_VS = `#version 300 es
precision highp float;
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const POST_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColour;
uniform sampler2D uScene; uniform sampler2D uDepth; uniform sampler2D uGlyphs;
uniform sampler2D uBackdrop;
uniform vec2 uPixel; uniform float uFocus; uniform float uAperture;
uniform float uNear; uniform float uFar; uniform float uTime; uniform float uExposure;
uniform float uGlyphCount;
uniform float uScale;    // device pixels per CSS pixel, so cells stay legible
uniform vec2 uGrid;      // camera pan in device pixels, so screens stay put on the plant
uniform float uToneOnly; // 1 shows a flat idiom's tone with no treatment, for tests

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// The same two the scene shader uses. They are declared again rather than
// shared because the two programs are separate strings; collage's torn edge and
// smoke's body both need something smoother than a hash.
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.07; a *= 0.5; }
  return s;
}

float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

// ACES, the filmic curve. Straight linear-to-sRGB looks like a render; this
// looks like a photograph, mostly because of what it does to the highlights.
vec3 aces(vec3 x) {
  const float a = 2.51; const float b = 0.03; const float c = 2.43;
  const float d = 0.59; const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// Colour, given back.
//
// Two things drain it and both are working correctly. ACES desaturates as it
// compresses — that is the price of its shoulder, and it costs most exactly
// where the picture is brightest. And aerial haze mixes everything towards the
// colour of the air, which is right for distance and merciless when most of the
// frame is distance. The answer is not to undo either, it is to grade after
// them, the way a photograph is graded after it is exposed.
//
// Vibrance rather than a flat saturation multiplier: the lift is largest where
// there is least colour already, so a hazed hillside comes back and a petal
// that is doing fine is left alone. A flat multiplier would take the picture
// straight to poster paint, which is the other way to be wrong about this.
vec3 graded(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = mx - mn;
  float lift = 1.0 + 0.70 * (1.0 - sat) * (1.0 - sat);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, lift);
  // and a little contrast under it: washed-out is as much a tonal fault as a
  // chromatic one, and saturation alone on a flat picture only makes it lurid.
  //
  // Pivoted below middle grey and with the toe lifted, so it opens the shadows
  // instead of closing them. Pivoted at 0.5 it took the dark materials — metal,
  // charcoal, glass — from nearly black to black, which is the one direction
  // they could not afford to go.
  c = (c - 0.42) * 1.08 + 0.42 + 0.014;
  return clamp(c, 0.0, 1.0);
}

const vec2 DISK[12] = vec2[12](
  vec2(0.0,1.0), vec2(0.87,0.5), vec2(0.87,-0.5), vec2(0.0,-1.0),
  vec2(-0.87,-0.5), vec2(-0.87,0.5), vec2(0.0,0.55), vec2(0.48,0.28),
  vec2(0.48,-0.28), vec2(0.0,-0.55), vec2(-0.48,-0.28), vec2(-0.48,0.28));

// ------------------------------------------------- the flat idioms --------
//
// The brief asks for ASCII, halftone, dither and the rest as visual states the
// organism can switch into. In 2D they were drawing routines. Here they are
// screen-space treatments applied only where the material id says so, which is
// a better home for them: a section rendered as halftone still occludes the
// section behind it, still casts a real shadow, and still sits in the same
// depth of field as everything else. Only its surface is a picture.

/**
 * Where a screen-space pattern is measured from.
 *
 * Anchoring these to gl_FragCoord anchors them to the *screen*, so scrolling
 * slides the plant across a stationary grid: every cell's contents change as it
 * passes, and the type crawls and pops. Offsetting by the camera's own pan
 * fixes the grid to the plant instead, which is where a pattern that is
 * supposed to be printed on it belongs. Cell size stays constant in pixels, so
 * zooming still slides them — a drawing that scaled with the subject would go
 * sub-pixel as soon as the plant got small.
 */
vec2 gpos() { return gl_FragCoord.xy + uGrid; }

const mat4 BAYER = mat4(
   0.0,  8.0,  2.0, 10.0,
  12.0,  4.0, 14.0,  6.0,
   3.0, 11.0,  1.0,  9.0,
  15.0,  7.0, 13.0,  5.0);

float bayerAt(vec2 p) {
  int x = int(mod(floor(p.x / uScale), 4.0));
  int y = int(mod(floor(p.y / uScale), 4.0));
  vec4 row = BAYER[y];
  float v = x == 0 ? row.x : x == 1 ? row.y : x == 2 ? row.z : row.w;
  return (v + 0.5) / 16.0;
}

float edgeAmount(vec2 uv, float centre) {
  float e = 0.0;
  e += abs(linearDepth(texture(uDepth, uv + vec2(uPixel.x, 0.0)).r) - centre);
  e += abs(linearDepth(texture(uDepth, uv - vec2(uPixel.x, 0.0)).r) - centre);
  e += abs(linearDepth(texture(uDepth, uv + vec2(0.0, uPixel.y)).r) - centre);
  e += abs(linearDepth(texture(uDepth, uv - vec2(0.0, uPixel.y)).r) - centre);
  return e;
}

/**
 * The colour a mark is made in, and what sits behind it.
 *
 * ASCII, halftone, dither and grain all say the same thing: light means less
 * ink, dark means more. The tone is carried entirely by concentration, so there
 * is nothing for a paper colour to do — filling the silhouette with white only
 * made the section look like a sticker stuck on the scene. The gaps show what
 * was actually behind the plant.
 *
 * The mark takes the opposite side of the backdrop's own luminance, so it stays
 * legible whichever scene the plant happens to be standing in: near-black on a
 * pale sweep, chalk on a dark one. A little of the section's colour is mixed
 * back in so it keeps its identity.
 */
vec3 markOn(vec3 back, vec3 col) {
  float bl = dot(back, vec3(0.299, 0.587, 0.114));
  vec3 m = bl > 0.42 ? back * 0.14 : min(back * 1.5 + 0.62, vec3(1.0));
  return mix(m, col, 0.16);
}

/**
 * Depth for a picture that has no lighting to give it any.
 *
 * Flat illustration separates planes by cutting them apart: where a nearer
 * shape crosses a farther one, a thin gap of the ground shows through and the
 * two read as layered paper rather than as one silhouette. That is a drawing
 * device, not a shading one, so it costs the flatness nothing.
 *
 * Only where both sides belong to the drawing. Doing it at the outer edge as
 * well would put a line around the whole thing, which is the rim that had to be
 * got rid of.
 */
float layerGap(vec2 uv, float centre) {
  float g = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = i == 0 ? vec2(uPixel.x, 0.0)
           : i == 1 ? vec2(-uPixel.x, 0.0)
           : i == 2 ? vec2(0.0, uPixel.y)
           :          vec2(0.0, -uPixel.y);
    vec2 at = uv + o * 1.6;
    vec4 s = texture(uScene, at);
    if (int(s.a * 255.0 + 0.5) < 40) continue;          // outside the drawing
    float d = linearDepth(texture(uDepth, at).r);
    // only when the neighbour is behind: the gap belongs to the nearer shape
    g = max(g, smoothstep(2.0, 26.0, d - centre));
  }
  return g;
}

vec3 backdropAt(vec2 uv) {
  vec3 b = texture(uBackdrop, uv).rgb * uExposure;
  return pow(aces(b), vec3(1.0 / 2.2));
}

/** A thermal palette: cold body, through red and orange, to white-hot. */
vec3 heatRamp(float t) {
  vec3 c = mix(vec3(0.03, 0.02, 0.16), vec3(0.42, 0.05, 0.42), smoothstep(0.00, 0.30, t));
  c = mix(c, vec3(0.88, 0.16, 0.16), smoothstep(0.26, 0.52, t));
  c = mix(c, vec3(1.00, 0.58, 0.06), smoothstep(0.48, 0.74, t));
  c = mix(c, vec3(1.00, 0.94, 0.42), smoothstep(0.70, 0.92, t));
  c = mix(c, vec3(1.00, 1.00, 0.96), smoothstep(0.90, 1.00, t));
  return c;
}

vec3 idiom(int id, vec3 col, vec2 uv, float dist) {
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 ink = col * 0.18;
  vec3 paper = min(col * 1.7 + 0.22, vec3(1.0));

  if (id == 40) {                                   // vector: flat, posterised
    return floor(col * 4.0 + 0.5) / 4.0;
  }
  if (id == 41 || id == 47) {                       // line, wireframe
    float e = smoothstep(1.5, 14.0, edgeAmount(uv, dist));
    vec3 body = id == 47 ? mix(paper, col, 0.25) : paper;
    return mix(body, ink, e);
  }
  if (id == 42) {                                   // grain: a stochastic screen
    // Multiplying noise over the render just dirtied a photograph. A print
    // screen decides, per speck, whether ink lands there at all — so the tone
    // is carried by how many specks are inked, the way newsprint does it.
    vec2 sp = floor(gpos() / (2.0 * uScale));
    float g = hash21(sp);
    float t = smoothstep(-0.15, 1.05, lum);
    vec3 back = backdropAt(uv);
    return mix(back, markOn(back, col), step(g, 1.0 - t));
  }
  if (id == 43) {                                   // ASCII
    // One glyph per cell, chosen from the middle of that cell.
    //
    // Every fragment used to pick its own character from its own luminance, so
    // a single cell was painted with fragments of several different glyphs at
    // once and the result was noise rather than type. The brightness has to be
    // read once per cell, and the whole cell then drawn as that one letter.
    vec2 cell = vec2(9.0, 14.0) * uScale;
    vec2 grid = floor(gpos() / cell);
    vec2 f = (gpos() - grid * cell) / cell;
    // The cell's average tone, not one pixel of it.
    //
    // A single tap at the centre is a point sample of a picture: over a cluster
    // of berries or a stem only a few pixels wide it lands in a gap as often as
    // on the subject, and picks the glyph for whatever happened to be there.
    // That put dense characters over the brightest parts of the plant. Five
    // taps across the cell is what an ASCII conversion actually does — it reads
    // the block, then chooses the letter.
    vec3 cc = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      vec2 o = i == 0 ? vec2(0.5, 0.5)
             : i == 1 ? vec2(0.22, 0.25)
             : i == 2 ? vec2(0.78, 0.25)
             : i == 3 ? vec2(0.22, 0.75)
             :          vec2(0.78, 0.75);
      cc += texture(uScene, ((grid + o) * cell - uGrid) * uPixel).rgb;
    }
    cc = pow(aces(cc * 0.2 * uExposure), vec3(1.0 / 2.2));
    float cl = dot(cc, vec3(0.299, 0.587, 0.114));
    // Dark areas take the dense glyphs, light areas the sparse ones — ink is
    // what you add to paper, so brightness has to run the ramp backwards.
    //
    // And stretched over the tone a drawn plant actually occupies, which is the
    // middle of the range and not the whole of it. Mapping 0..1 straight onto
    // the ramp meant a plant spanning roughly 0.35 to 0.80 only ever reached
    // glyphs three to eight of fourteen — six characters whose ink differs by a
    // couple of per cent — so the type was legible but said almost nothing about
    // the form. This is the same correction the flat tone quantiser needed, for
    // the same reason: a range used at a twentieth of its width describes
    // nothing. The clamp keeps the extremes available for whatever does reach
    // them, and darker-is-denser still runs backwards.
    float t = clamp((0.86 - cl) / 0.56, 1.05 / uGlyphCount, 0.999);
    float idx = floor(t * uGlyphCount);
    float gx = (idx + clamp(f.x, 0.02, 0.98)) / uGlyphCount;
    float mask = texture(uGlyphs, vec2(gx, 1.0 - f.y)).r;
    return mix(backdropAt(uv), markOn(backdropAt(uv), cc), mask);
  }
  if (id == 44) {                                   // pixel
    vec2 cell = vec2(7.0) * uScale;
    // back out of grid space to sample the scene, which is still screen-indexed
    vec2 snapped = (floor(gpos() / cell) + 0.5) * cell - uGrid;
    vec3 c = texture(uScene, snapped * uPixel).rgb * uExposure;
    c = pow(aces(c), vec3(1.0 / 2.2));
    return floor(c * 6.0 + 0.5) / 6.0;
  }
  if (id == 45) {                                   // halftone
    float a = 0.4;
    mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 p = rot * gpos() / (5.2 * uScale);
    float d = length(fract(p) - 0.5);
    float radius = sqrt(clamp(1.0 - lum, 0.0, 1.0)) * 0.70;
    vec3 back = backdropAt(uv);
    return mix(back, markOn(back, col), smoothstep(radius + 0.06, radius - 0.06, d));
  }
  if (id == 46) {                                   // dither
    float t = bayerAt(gpos());
    vec3 back = backdropAt(uv);
    return mix(back, markOn(back, col), 1.0 - step(t, lum));
  }
  if (id == 54) {                                   // collage
    // Cut paper, and the paper is the point.
    //
    // The first version tinted the fill by a few per cent of hash and called
    // that stock, which is invisible: real paper has a felted fibre in it, a
    // laid pattern from the mould it was made on, and flecks of pulp that did
    // not break down. It also needs a torn edge — a clean one reads as vector —
    // and the piece has to sit *on* something, so it carries a hard little
    // shadow where it laps over what is behind.
    vec2 p = gpos() / uScale;
    float felt = fbm(p * 0.10) * 0.6 + fbm(p * 0.35) * 0.4;   // fibre in the sheet
    float laid = sin(p.y * 0.55) * 0.5 + 0.5;                 // the mould's lines
    float fleck = step(0.988, hash21(floor(p * 0.7)));        // undigested pulp
    float al = max(dot(col, vec3(0.299, 0.587, 0.114)), 0.001);
    vec3 stock = col / al * 0.66;                             // one flat colour
    stock *= 0.86 + felt * 0.26 + laid * 0.05;
    stock = mix(stock, stock * 0.55, fleck);

    // the torn edge: ragged, and darker on the side that lies underneath
    float e = edgeAmount(uv, dist);
    float ragged = fbm(p * 0.9) * 0.5 + 0.5;
    float tear = smoothstep(2.0, 5.5, e * (0.55 + ragged));
    return mix(stock, stock * 0.42, tear);
  }
  if (id == 55) {                                   // smoke
    // It does not have an edge, it has a place where it stops being dense
    // enough to see. Density falls off with the light and dissolves into the
    // ground rather than meeting it.
    vec3 back = backdropAt(uv);
    vec2 p = gpos() / (13.0 * uScale);
    float body = fbm(p * 0.8) * 0.65 + fbm(p * 2.3) * 0.35;
    float dense = clamp(lum * 1.5 * (0.35 + body), 0.0, 1.0);
    vec3 vapour = mix(back, vec3(0.86, 0.89, 0.95), 0.75);
    return mix(back, vapour, smoothstep(0.10, 0.62, dense));
  }
  if (id == 56) {                                   // stipple
    // Pen stippling: single dots, all the same size, and tone is nothing but
    // how many of them there are — a stipple that varies its dot size is a
    // halftone, which is already here.
    //
    // The first attempt raised the wanted density to a power, which crushed
    // everything but the deepest shadow to bare paper: a drawing with dots only
    // where it is nearly black describes an outline, not a form. Density now
    // runs across the whole tonal range the way grain does, and the shadows are
    // where it gathers rather than the only place it appears at all.
    vec3 back = backdropAt(uv);
    vec2 cell = vec2(2.4) * uScale;
    vec2 g = floor(gpos() / cell);
    float jitter = hash21(g * 1.7);
    float want = clamp(0.12 + (1.0 - lum) * 1.25, 0.0, 1.0);
    float on = step(jitter, want);
    vec2 f = fract(gpos() / cell) - 0.5;
    float dot0 = 1.0 - smoothstep(0.18, 0.40, length(f));
    return mix(back, markOn(back, col), on * dot0);
  }
  if (id == 57) {                                   // block print
    // Flat colour inside a heavy keyline, the way a lino cut separates its
    // areas. Unlike lineart the fill carries the colour; the line holds it.
    //
    // Two things were stopping it reading as flat. The fill was quantised in
    // three steps *per channel*, which on a saturated colour still leaves a
    // gradient running along a member — one flat colour is the whole point of a
    // cut block. And the keyline was a soft wide band, which is shading by
    // another name: a cut edge is one width and hard on both sides.
    float e = edgeAmount(uv, dist);
    float line = smoothstep(2.5, 3.5, e);
    float al = max(dot(col, vec3(0.299, 0.587, 0.114)), 0.001);
    vec3 ink = col / al * 0.62;                    // the hue, at one flat value
    return mix(ink, vec3(0.05, 0.04, 0.06), line);
  }
  if (id == 58) {                                   // illumination
    // Manuscript work: flat colour, a gold keyline rather than a black one, and
    // a ground that is never quite clean.
    float e = smoothstep(1.0, 10.0, edgeAmount(uv, dist));
    vec3 flat3 = floor(col * 4.0 + 0.5) / 4.0;
    float vellum = hash21(gpos() * 0.4) * 0.10;
    vec3 gold = vec3(1.30, 0.92, 0.28);
    return mix(flat3 * (0.95 + vellum), gold, clamp(e * 1.2, 0.0, 1.0));
  }

  // ---- instrument readings ----
  //
  // The organism seen through something that measures rather than looks. These
  // replace the colour outright instead of laying marks over the scene: a
  // thermal camera does not leave the background showing through, it reports a
  // value for every pixel it can see. That is the honest form for them, and it
  // is why they are the one group of flat idioms that covers its subject.

  if (id == 48) {                                   // thermal
    return heatRamp(clamp(lum * 1.12 + 0.04, 0.0, 1.0));
  }
  if (id == 49) {                                   // radiograph
    // Absorption, not reflection: a silhouette is where the beam passed through
    // the most material, so edges read brightest and the body glows through.
    float e = smoothstep(0.5, 9.0, edgeAmount(uv, dist));
    float d = 0.20 + lum * 0.52 + e * 0.55;
    return vec3(0.52, 0.74, 1.0) * d + vec3(0.06, 0.09, 0.16);
  }
  if (id == 50) {                                   // depth pass
    float t = clamp((dist - uFocus * 0.80) / max(uFocus * 0.42, 1e-3), 0.0, 1.0);
    t = smoothstep(0.0, 1.0, t);
    vec3 c = mix(vec3(1.00, 0.99, 0.92), vec3(0.20, 0.62, 0.72), smoothstep(0.0, 0.55, t));
    c = mix(c, vec3(0.05, 0.06, 0.28), smoothstep(0.45, 1.0, t));
    // Distance is the only thing a depth pass measures, so on its own every
    // surface at one remove reads as a single flat sheet of colour. Letting the
    // light modulate it keeps the form legible without changing what is being
    // reported.
    return c * (0.55 + lum * 0.85);
  }
  if (id == 51) {                                   // contour survey
    float bands = 9.0;
    float v = lum * bands;
    float w = max(fwidth(v), 1e-4);
    float onLine = 1.0 - smoothstep(w * 0.6, w * 1.8, abs(fract(v) - 0.5));
    vec3 ground = mix(vec3(0.93, 0.91, 0.84), col, 0.30);
    vec3 line = vec3(0.24, 0.22, 0.18);
    // every fifth contour drawn heavier, as a survey does
    float major = step(0.5, abs(fract(floor(v) / 5.0 + 0.001) - 0.0) < 0.2 ? 1.0 : 0.0);
    return mix(ground, line, onLine * (0.55 + major * 0.45));
  }
  if (id == 52) {                                   // blueprint
    float e = smoothstep(1.0, 11.0, edgeAmount(uv, dist));
    vec2 g = fract(gpos() / (16.0 * uScale));
    float grid = (step(0.94, g.x) + step(0.94, g.y)) * 0.20;
    vec3 ground = vec3(0.06, 0.16, 0.36);
    vec3 line = vec3(0.74, 0.90, 1.0);
    return mix(ground + line * grid, line, clamp(e + (1.0 - lum) * 0.10, 0.0, 1.0));
  }
  if (id == 53) {                                   // risograph: two inks, misregistered
    vec3 back = backdropAt(uv);
    float t = clamp(1.0 - lum, 0.0, 1.0);
    float a1 = 0.36;
    float a2 = 1.18;
    mat2 r1 = mat2(cos(a1), -sin(a1), sin(a1), cos(a1));
    mat2 r2 = mat2(cos(a2), -sin(a2), sin(a2), cos(a2));
    vec2 p1 = r1 * (gpos() + vec2(1.6, 0.0)) / (5.4 * uScale);
    vec2 p2 = r2 * (gpos() - vec2(1.4, 1.1)) / (5.4 * uScale);
    float rad1 = sqrt(t) * 0.66;
    float rad2 = sqrt(t * 0.88) * 0.66;
    float d1 = smoothstep(rad1 + 0.07, rad1 - 0.07, length(fract(p1) - 0.5));
    float d2 = smoothstep(rad2 + 0.07, rad2 - 0.07, length(fract(p2) - 0.5));
    vec3 o = back;
    o = mix(o, vec3(0.16, 0.34, 0.82), d2 * 0.95);   // blue pulled first
    o = mix(o, vec3(0.94, 0.24, 0.34), d1 * 0.86);   // then red, off register
    return o;
  }
  return col;
}

void main() {
  float depth = texture(uDepth, vUv).r;
  float dist = linearDepth(depth);

  // A drawing is not photographed. Depth of field, lens colour fringing and
  // film grain are all artefacts of a camera looking at a real object, and
  // running a flat idiom through them is what made it read as a filter over a
  // photograph. These pixels leave the pipeline early, sharp and clean; only
  // the vignette is kept, because that belongs to the frame rather than to the
  // plant and skipping it would cut the section out of the picture.
  // Read the id from the exact texel, never through the filter.
  //
  // The material id rides in the alpha channel, and uScene is sampled linearly.
  // On a silhouette that blends the plant's alpha with the backdrop's zero, so
  // the id decodes to something that is not a material at all — those pixels
  // fall through the idiom and show the raw lit plant underneath, which is the
  // bright rim that was tracing every flat shape.
  int flatId = int(texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).a * 255.0 + 0.5);
  if (flatId >= 40) {
    vec3 f = texture(uScene, vUv).rgb * uExposure;
    f = pow(aces(f), vec3(1.0 / 2.2));
    // The tone a drawn idiom is working from, with nothing applied to it.
    //
    // Checking whether ASCII puts more ink where the picture is darker needs to
    // know how dark the picture is, and the nearest thing available was the
    // vector idiom — which posterises each channel separately, so as soon as
    // the drawn idioms stopped being grey its luminance stopped tracking the
    // tone underneath. This is that tone, exactly.
    if (uToneOnly > 0.5) { outColour = vec4(f, 1.0); return; }
    f = graded(idiom(flatId, f, vUv, dist));
    // cut the nearer shape away from whatever it is passing in front of
    f = mix(f, backdropAt(vUv), layerGap(vUv, dist) * 0.85);
    float fr = length((vUv - 0.5) * vec2(1.0, 1.15));
    f *= 1.0 - smoothstep(0.42, 0.95, fr) * 0.34;
    outColour = vec4(f, 1.0);
    return;
  }

  float coc = 0.0;
  float radius = 0.0;

  vec3 col = texture(uScene, vUv).rgb;
  float total = 1.0;
  vec3 bright = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    vec2 off = DISK[i] * radius * uPixel;
    vec4 sm = texture(uScene, vUv + off);
    vec3 s = sm.rgb;
    // do not let something in focus bleed onto a blurred background
    float sd = linearDepth(texture(uDepth, vUv + off).r);
    float w = sd > dist - uFocus * 0.08 ? 1.0 : 0.25;
    // and never gather from a section that is drawn rather than lit.
    //
    // A flat idiom's pixels still hold the ordinary lit colour in this buffer —
    // the drawing is made later, from them. Blurring the background across that
    // boundary pulled the plant's raw green into the backdrop and left a bright
    // rim hugging every flat shape: a halo of a colour that is never shown
    // anywhere on screen.
    if (int(sm.a * 255.0 + 0.5) >= 40) w = 0.0;
    col += s * w; total += w;
    bright += max(s - 1.0, vec3(0.0)) * w;
  }
  col /= total;
  // a cheap bloom from what was already over one in the sampled disk
  col += bright / 12.0 * 0.5;

  // Very slight lateral colour, the way a real lens splits at the edges — but
  // never fetched from across a drawn section. Like the blur above, these two
  // taps reach into a buffer that still holds the ordinary lit colour under
  // every flat idiom, and pulling a channel out of it laid a coloured thread
  // along the outline of every drawn shape. It was the last of that rim.
  vec2 ca = (vUv - 0.5) * 0.0006;
  vec4 rs = texture(uScene, vUv + ca);
  vec4 bs = texture(uScene, vUv - ca);
  if (int(rs.a * 255.0 + 0.5) < 40) col.r = mix(col.r, rs.r, 0.6);
  if (int(bs.a * 255.0 + 0.5) < 40) col.b = mix(col.b, bs.b, 0.6);

  col *= uExposure;
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  col = graded(col);

  // grain, and a little more of it in the shadows where film has more
  float g = fract(sin(dot(vUv * 1024.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * 0.020 * (1.3 - dot(col, vec3(0.33)));

  float r = length((vUv - 0.5) * vec2(1.0, 1.15));
  col *= 1.0 - smoothstep(0.42, 0.95, r) * 0.34;

  outColour = vec4(col, 1.0);
}`;

/**
 * The ASCII ramp, rasterised once into a strip.
 *
 * Generated rather than shipped: it has to match whatever the browser has, and
 * a texture built at init costs nothing. Ordered light to dark so the shader can
 * index it straight from luminance.
 */
/** Eye height floor, in world units above the sweep. */
const EYE_FLOOR = 26;

/** How much of the camera's sideways movement the eye actually takes. */
const CAM_X_DAMP = 0.4;

/**
 * How far the camera can see, given how far back it is sitting.
 *
 * Sized from the plant, this was `dist * 4 + 4000`, which was ample while the
 * world ended three hundred units behind it. The atmosphere shell now stands
 * nine thousand back, so at any close zoom — the materials sheet, the field
 * guide, a player looking at one bloom — the sky fell outside the frustum and
 * the top of the frame went black. It has to reach past the far edge of the
 * world, whatever the plant is doing.
 */
const farPlane = (dist) => dist + 190000;

/** Most pixels the renderer will draw, whatever the display claims. */
const MAX_RENDER_PIXELS = 2400 * 1400;

export function makeGlyphAtlas(gl) {
  // The characters, then sorted by how much ink each one actually puts down.
  //
  // Ordering this by eye is guesswork twice over: it is easy to get wrong — 'x'
  // covers more of its cell than '*' does, which had the ramp going backwards
  // in the middle — and the answer depends on the font, which differs by
  // platform. Measuring it is not much more code and cannot be wrong.
  const CHARS = ' .,:;=+*ox68%@';
  const cw = 24;
  const ch = 34;
  const font = 'bold 27px ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  const measure = document.createElement('canvas');
  measure.width = cw;
  measure.height = ch;
  const mg = measure.getContext('2d', { willReadFrequently: true });
  mg.font = font;
  mg.textAlign = 'center';
  mg.textBaseline = 'middle';
  const weighed = CHARS.split('').map((ch2) => {
    mg.fillStyle = '#000';
    mg.fillRect(0, 0, cw, ch);
    mg.fillStyle = '#fff';
    mg.fillText(ch2, cw / 2, ch / 2 + 1);
    const d = mg.getImageData(0, 0, cw, ch).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i];
    return { ch: ch2, ink: s / (cw * ch * 255) };
  });
  weighed.sort((a, b) => a.ink - b.ink);
  const RAMP = weighed.map((w) => w.ch).join('');

  const c = document.createElement('canvas');
  c.width = cw * RAMP.length;
  c.height = ch;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < RAMP.length; i++) {
    g.fillText(RAMP[i], i * cw + cw / 2, ch / 2 + 1);
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // the canvas and cell width come back too, so the ordering can be checked
  return { tex, count: RAMP.length, canvas: c, cellW: cw };
}

export class Renderer3D {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.gl = createGL(canvas, opts);
    const gl = this.gl;

    this.sceneProg = program(gl, SCENE_VS, SCENE_FS);
    this.depthProg = program(gl, DEPTH_VS, DEPTH_FS);
    this.postProg = program(gl, POST_VS, POST_FS);

    this.shadow = shadowTarget(gl, SHADOW_SIZE);
    this.quad = fullscreenTriangle(gl, this.postProg);
    this.glyphs = makeGlyphAtlas(gl);

    this.plantMesh = null;
    this.backdropMesh = null;
    this.builtSections = -1;
    this.builtEnv = null;
    this.hdr = null;
    this.bg = null;
    this.w = 0;
    this.h = 0;
    this.pw = 0;
    this.ph = 0;
    this.dpr = 1;
    this.resize();
  }

  resize() {
    const cw = this.canvas.clientWidth || 800;
    const ch = this.canvas.clientHeight || 600;

    // A ceiling on how many pixels are actually rendered.
    //
    // Two half-float colour targets and a depth texture are allocated at the
    // full device resolution. On an ordinary 1440p laptop at devicePixelRatio 2
    // that is 5120 x 2880, which is about 300 MB of GPU memory before anything
    // is drawn — and on a 4K display, four times that. Modest hardware either
    // refuses the allocation, in which case nothing appears at all, or accepts
    // it and then crawls. The canvas still fills its box; only the buffer
    // behind it is capped, and at this size the difference is hard to see.
    const want = Math.min(2, window.devicePixelRatio || 1);
    const capped = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, cw * ch));
    const dpr = Math.max(1, Math.min(want, capped));

    const w = Math.max(1, Math.round(cw * dpr));
    const h = Math.max(1, Math.round(ch * dpr));
    if (w === this.pw && h === this.ph) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.dpr = dpr;
    this.w = cw;
    this.h = ch;
    this.pw = w;
    this.ph = h;
    if (this.bg) {
      this.gl.deleteFramebuffer(this.bg.fbo);
      this.gl.deleteTexture(this.bg.colour);
    }
    if (this.hdr) {
      this.gl.deleteFramebuffer(this.hdr.fbo);
      this.gl.deleteTexture(this.hdr.colour);
      this.gl.deleteTexture(this.hdr.depth);
    }
    this.hdr = framebuffer(this.gl, w, h, { float: true, depth: true, nearest: true });
    // the backdrop on its own, so a drawn section can put ink straight onto the
    // scene instead of onto a painted-in sheet of white
    this.bg = framebuffer(this.gl, w, h, { float: true, nearest: true });
  }

  invalidate() { this.builtKey = null; this.builtEnv = null; }

  /**
   * The camera y that puts `worldY` at `frac` of the way down the frame.
   * The perspective camera is set up so one world unit is one CSS pixel at
   * zoom 1, which keeps every framing rule written for the 2D renderer valid.
   */
  camYToPlaceAt(worldY, frac, zoom) {
    return worldY - (0.5 - frac) * (this.h / Math.max(0.05, zoom));
  }

  camYToCentre(worldCentreY) { return worldCentreY; }

  /**
   * The cam.x that puts a given world x in the middle of the frame.
   *
   * The eye tracks sideways at a fraction of the camera's own x — horizontal
   * movement is damped, because a plant that wanders left and right should not
   * swing the whole picture with it. The consequence is that asking the camera
   * to look at x = -400 puts the eye at -160 and the thing you asked to see is
   * off the edge of the frame. Everything that wants a subject centred has to
   * go through this, and one of them was not: it is why a plant that had drifted
   * sideways came out clipped against the edge of the picture.
   */
  camXToCentre(worldX) { return worldX / CAM_X_DAMP; }

  /** The lowest the eye is allowed to sit, matching the render. */
  get eyeFloor() { return EYE_FLOOR; }

  /** World point to screen pixels, for the history inspector. */
  project(cam, x, y, z = 0) {
    const aspect = this.w / this.h;
    const fov = 0.30;
    const dist = (this.h / Math.max(0.05, cam.zoom)) / (2 * Math.tan(fov / 2));
    const eyeY = Math.max(cam.y, EYE_FLOOR);
    const eye = [cam.x * CAM_X_DAMP, eyeY, dist];
    const vp = mat4.multiply(
      mat4.perspective(fov, aspect, dist * 0.05, farPlane(dist)),
      mat4.lookAt(eye, [cam.x * CAM_X_DAMP, eyeY, 0], [0, 1, 0]));
    const o = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      o[i] = vp[0 * 4 + i] * x + vp[1 * 4 + i] * y + vp[2 * 4 + i] * z + vp[3 * 4 + i];
    }
    if (o[3] <= 0) return null;
    return {
      x: (o[0] / o[3] * 0.5 + 0.5) * this.w,
      y: (1 - (o[1] / o[3] * 0.5 + 0.5)) * this.h,
    };
  }

  ensureMeshes(plant, env, reveal, cam0Y, view) {
    const gl = this.gl;
    // rebuild while a section is growing, and whenever one is added
    const key = plant.sections.length + ':' + (reveal ? reveal.step + ':' + reveal.progress.toFixed(3) : '');
    if (this.builtKey !== key) {
      this.builtKey = key;
      disposeMesh(gl, this.plantMesh);
      const built = buildPlant(plant, reveal);
      this.plantMesh = built.indices.length
        ? mesh(gl, this.sceneProg, built.data, built.indices, LAYOUT)
        : null;
      this.plantWide = built.wide;
    }
    // Keyed on what the camera can see, not only on where it is. A backdrop
    // sized from the plant alone left the world stopping short of the frame at
    // a wide window or a pulled-back zoom, with the void showing past its edges.
    const envKey = env?.id + ':' + (this.worldKind ?? 0)
      + ':' + Math.round((view?.w || 0) / 400) + ':' + Math.round((view?.h || 0) / 400);
    if (this.builtEnv !== envKey) {
      disposeMesh(gl, this.backdropMesh);
      const built = buildBackdrop(env, view, this.worldKind ?? 0);
      this.backdropMesh = mesh(gl, this.sceneProg, built.data, built.indices, LAYOUT);
      this.backdropWide = built.wide;
      this.builtEnv = envKey;
    }
  }

  drawMesh(gl, m, wide) {
    if (!m) return;
    gl.bindVertexArray(m.vao);
    gl.drawElements(gl.TRIANGLES, m.count,
      wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
  }

  /**
   * @param {object} cam { x, y, zoom } in the same world units the 2D camera used
   */
  /**
   * Which ground this plant grew out of, and how far into the night it is.
   *
   * Both belong to the plant rather than to a section: a life is one column of
   * world, and the ground under it does not change halfway up.
   */
  setWorld(kind, nightness, idiom = 0) {
    this.worldKind = kind;
    this.nightness = nightness;
    this.worldIdiom = idiom;
  }

  render(plant, cam, time, sections, reveal = null) {
    const gl = this.gl;
    this.resize();

    const env = dominantEnv(buildBands(sections), cam.y - 600, cam.y + 600);
    // how much world the camera actually covers at this zoom and shape
    const seenH = this.h / Math.max(0.05, cam.zoom);
    this.ensureMeshes(plant, env, reveal, cam.y, {
      w: seenH * (this.w / Math.max(1, this.h)),
      h: seenH,
    });

    // ---- camera ----
    // A real lens, far enough back that perspective is gentle: the reference
    // photographs are shot long, so the plant reads as depth rather than as a
    // wide-angle exaggeration.
    const aspect = this.w / this.h;
    const fov = 0.30;
    const visibleHeight = this.h / Math.max(0.05, cam.zoom);
    const dist = visibleHeight / (2 * Math.tan(fov / 2));
    // The floor is a real surface with one side to it. Framing a seedling puts
    // the eye below the plant's own centre, and once it dropped under y = 0 the
    // whole lower frame became the underside of the sweep — a hard horizon with
    // black beneath it. Height above the floor is a property of the set, not a
    // framing preference, so it is held here rather than left to the caller.
    const eyeY = Math.max(cam.y, EYE_FLOOR);
    const eye = [cam.x * CAM_X_DAMP, eyeY, dist];
    const target = [cam.x * CAM_X_DAMP, eyeY, 0];
    const view = mat4.lookAt(eye, target, [0, 1, 0]);
    const proj = mat4.perspective(fov, aspect, dist * 0.05, farPlane(dist));
    const viewProj = mat4.multiply(proj, view);

    // ---- light ----
    const span = 1500;
    const centre = [cam.x * CAM_X_DAMP, cam.y, -150];
    const lightEye = [
      centre[0] + LIGHT_DIR[0] * 2200,
      centre[1] + LIGHT_DIR[1] * 2200,
      centre[2] + LIGHT_DIR[2] * 2200,
    ];
    const lightView = mat4.lookAt(lightEye, centre, [0, 1, 0]);
    const lightProj = mat4.ortho(-span, span, -span, span, 200, 5200);
    const lightViewProj = mat4.multiply(lightProj, lightView);

    // ---- shadow pass ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.fbo);
    gl.viewport(0, 0, this.shadow.size, this.shadow.size);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.depthProg.p);
    setUniforms(gl, this.depthProg, { uLightViewProj: lightViewProj });
    if (!this.castShadowsOff) this.drawMesh(gl, this.plantMesh, this.plantWide);

    // ---- scene pass ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdr.fbo);
    gl.viewport(0, 0, this.pw, this.ph);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.sceneProg.p);

    const night = this.nightness ?? 0;
    const dim = (c, k, tint) => c.map((v, i) => v * (1 - night * k) + night * tint[i]);
    const sun = dim(env.dark ? [1.9, 1.95, 2.2] : [4.2, 3.9, 3.4], 0.94, [0.10, 0.12, 0.22]);
    const sky = dim(env.dark ? [0.06, 0.075, 0.12] : [0.20, 0.22, 0.26], 0.72, [0.05, 0.06, 0.13]);
    const ground = dim(env.dark ? [0.025, 0.025, 0.032] : [0.11, 0.095, 0.075], 0.80,
      [0.012, 0.013, 0.022]);
    setUniforms(gl, this.sceneProg, {
      uViewProj: viewProj,
      uLightViewProj: lightViewProj,
      uLightDir: LIGHT_DIR,
      uEye: eye,
      uSunColour: sun,
      uSkyColour: sky,
      uGroundColour: ground,
      uShadow: this.shadow.depth,
      uRelief: this.reliefOff ? 0 : 1,
      uSceneExposure: env.dark ? 1.25 : 1.0,
      uWorldKind: this.worldKind ?? 0,
      uNightness: this.nightness ?? 0,
      uWorldIdiom: this.worldIdiom ?? 0,
      uSceneTime: time * 0.001,
      uUnderwater: PLACES[(this.worldKind ?? 0) % PLACES.length]?.underwater !== undefined
        ? 1 : 0,
      uGloom: PLACES[(this.worldKind ?? 0) % PLACES.length]?.cave ? 1 : 0,
      uRecede: this.recedeOff ? 0 : 1,
    });
    // The world can be left out, the way shadows can. A screen idiom takes its
    // contrast from whatever is behind it — that is how a mark stays visible on
    // any ground — so measuring how much ink a glyph lays down means measuring
    // it against a constant field. Against a landscape the same glyph reads as
    // more or less ink depending on what it happens to be covering.
    if (!this.worldOff) this.drawMesh(gl, this.backdropMesh, this.backdropWide);

    // Keep the backdrop before the plant covers it. The idioms that describe
    // tone by how much ink lands need to know what is behind them: without it
    // the only thing they can leave in the gaps is a white fill, which reads as
    // a sticker laid on the scene rather than as a drawing of the plant.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.hdr.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.bg.fbo);
    gl.blitFramebuffer(0, 0, this.pw, this.ph, 0, 0, this.pw, this.ph,
      gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdr.fbo);

    this.drawMesh(gl, this.plantMesh, this.plantWide);

    // ---- camera pass ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.pw, this.ph);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.postProg.p);
    setUniforms(gl, this.postProg, {
      uScene: this.hdr.colour,
      uBackdrop: this.bg.colour,
      uDepth: this.hdr.depth,
      uGlyphs: this.glyphs.tex,
      uGlyphCount: this.glyphs.count,
      uScale: this.dpr,
      uToneOnly: this.toneOnly ? 1 : 0,
      // world-to-device scale is zoom * dpr near the plant's own plane
      // world-to-device scale is zoom * dpr near the plant's own plane
      uGrid: [cam.x * CAM_X_DAMP * cam.zoom * this.dpr, cam.y * cam.zoom * this.dpr],
      uPixel: [1 / this.pw, 1 / this.ph],
      uFocus: dist,
      uAperture: 1.7,
      uNear: dist * 0.05,
      uFar: farPlane(dist),
      uTime: (time % 1000) * 0.001,
      uExposure: env.dark ? 1.25 : 1.0,
    });
    gl.bindVertexArray(this.quad.vao);
    gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);

    return env;
  }
}

export { ENVIRONMENTS, ENV_BY_ID };
