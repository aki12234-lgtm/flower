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
  createGL, programs, setUniforms, mesh, disposeMesh, framebuffer, shadowTarget,
  fullscreenTriangle, mat4, norm3,
} from './glutil.js';
import { LAYOUT } from './meshes.js';
import { buildPlant, buildBackdrop, movingAt, groundAt, PLACES, MAT_ID, setStyle } from './scene.js';
import { inkUniforms, PLANT_INKS, INK, linear, mixLinear } from './toon.js';

/** The plant's inks, the same everywhere. */
const PLANT_UNIFORMS = inkUniforms(PLANT_INKS);
/** Where the drawn sun hangs: high on the right of the first view. */
const SUN_SPOT = norm3([0.42, 0.20, -1.0]);
import { ENV_BY_ID, ENVIRONMENTS, dominantEnv, buildBands } from '../environment.js';

const SHADOW_SIZE = 2048;

// Light direction matches the 2D renderer's, so the two agree about where the
// sun is: upper left, slightly towards the viewer.
// A three-quarter light: from the left, and still in front of the subject.
//
// It stood behind the camera, which is front lighting — every surface the eye
// can see faces the sun, nothing has a shadow side, and it is the flattest light
// there is. Swinging it round to the side and a little behind gave everything a
// shadow side, and was right for the scenery and wrong for the plant: the camera
// looks at the plant's front, a light from behind leaves that front with nothing
// but fill, and the organism went dull purple-grey against a lit world. This is
// where a portrait is lit from — the side the camera sees stays in the light, the
// far side turns away into shade, and a stem is round without losing its colour.
export const LIGHT_DIR = norm3([-0.68, 0.52, 0.42]);

/**
 * Foliage as cut-outs.
 *
 * A canopy built as a solid is a balloon however it is shaded — its outline is
 * a curve and nothing shows through it — and grass built as one tube per blade
 * costs a dozen vertices for a blade a pixel wide. What real foliage looks like
 * at any distance is a mass with holes in it: sky between the leaves, ground
 * between the blades. So both are cards, flat quads with the shapes cut out of
 * them here, per pixel, and everything outside a shape discarded.
 *
 * A card's uv is (seed + u, v): the whole part says which card it is, so each
 * has its own blades or leaves, and the fraction runs across it, 0 to 1. The
 * same test runs in the shadow pass, so a canopy's shadow is dappled too.
 */
// Printed, a second pass of ink over a shape (its pattern, its shade side) is
// written into the alpha channel beside the material id as a fraction under
// one half, so every reader that rounds the id still gets the id.
const OVERPRINT = `
const float OVERPRINT = 0.48;   // how much darker a full second pass leaves an ink
const float OVER_SLOT = 0.45;   // the share of one id step it is written into
`;

const CARD_MASKS = `
uniform sampler2D uCardAtlas;   // every card's cut-outs, baked once; see cardAtlas()

// One card's cell of the atlas. The derivatives come from the caller, taken
// before any branch, since inside one they are undefined.
vec4 cardCell(vec2 uv, vec2 gx, vec2 gy) {
  float seed = mod(floor(uv.x), 64.0);
  vec2 cell = vec2(mod(seed, 8.0), floor(seed / 8.0));
  vec2 p = clamp(vec2(fract(uv.x), uv.y), 0.002, 0.998);
  return textureGrad(uCardAtlas, (cell + p) / 8.0, gx, gy);
}

// Grass: (inside a blade, how far up it). A lower threshold than a half, so
// that blades a pixel wide are not thinned out of existence by the mipmaps.
vec2 grassCard(vec2 uv, vec2 gx, vec2 gy) {
  vec4 a = cardCell(uv, gx, gy);
  return vec2(step(0.35, a.r), a.g);
}

// Leaves: (inside a leaf, which one — so each can have its own shade).
vec2 leafCard(vec2 uv, vec2 gx, vec2 gy) {
  vec4 a = cardCell(uv, gx, gy);
  return vec2(step(0.42, a.b), a.a);
}
`;

const SCENE_VS = `#version 300 es
precision highp float;
in vec3 aPos; in vec3 aNormal; in vec3 aAlbedo; in vec4 aParams; in vec2 aUv;
uniform mat4 uViewProj; uniform mat4 uLightViewProj; uniform float uSceneTime;
uniform mat4 uLightViewProjFar;
out vec3 vWorld; out vec3 vNormal; out vec3 vAlbedo; out vec4 vParams;
out vec2 vUv; out vec4 vLightPos; out vec4 vLightPosFar;

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
  } else if (id == 31) {                           // anything with a blade to it
    float ph = p.x * 0.004 + p.z * 0.0052;
    float sway = sin(uSceneTime * 1.15 + ph) * 0.6 + sin(uSceneTime * 2.7 + ph * 1.7) * 0.4;
    p.x += sway * uv.x * 0.09;
    p.z += sway * uv.x * 0.05;
  } else if (id == 32) {                           // grass cards: tops move, roots stay
    float ph = p.x * 0.004 + p.z * 0.0052;
    float sway = sin(uSceneTime * 1.15 + ph) * 0.6 + sin(uSceneTime * 2.7 + ph * 1.7) * 0.4;
    p.x += sway * uv.y * 5.0;
    p.z += sway * uv.y * 3.0;
  }
  return p;
}

void main() {
  vec3 pos = stirred(aPos, aUv, int(aParams.w + 0.5));
  vWorld = pos; vNormal = aNormal; vAlbedo = aAlbedo; vParams = aParams; vUv = aUv;
  vLightPos = uLightViewProj * vec4(pos, 1.0);
  vLightPosFar = uLightViewProjFar * vec4(pos, 1.0);
  gl_Position = uViewProj * vec4(pos, 1.0);
}`;

const SCENE_FS = `#version 300 es
precision highp float;
${OVERPRINT}
in vec3 vWorld; in vec3 vNormal; in vec3 vAlbedo; in vec4 vParams;
in vec2 vUv; in vec4 vLightPos; in vec4 vLightPosFar;
uniform vec3 uLightDir; uniform vec3 uEye;
uniform vec3 uSunColour; uniform vec3 uSkyColour; uniform vec3 uGroundColour;
// How bright the air itself looks, which is not how much light it throws.
//
// The two were one uniform, and it was set low — low enough that the sky and the
// haze looked right, and low enough that nothing in shade could be seen. Raising
// it to light the shadow sides also brightened the sky and whitened everything
// in the distance, so the picture went pale while it was getting more solid. The
// sky's appearance and the sky's illumination are separate quantities in life
// and are separate here.
uniform vec3 uAirColour;
uniform vec3 uHazeTint;         // the colour the distance goes, where it is not sky-blue
uniform float uRelief;   // 0 flattens every surface, for isolating the relief in tests
uniform float uSceneExposure;   // so a drawing can cancel it and keep its own range
uniform float uWorldKind;       // which ground the plant started from
uniform float uNightness;       // 0 day, 1 night — the whole column drifts through it
uniform highp sampler2DShadow uShadow;
uniform highp sampler2DShadow uShadowFar;   // the world's own shadows, over the whole view
uniform highp sampler2D uSurfaceTable;   // how each material's relief is made
// Always 3. A uniform rather than a constant so that the loops bounded by it
// stay loops: the compiler Windows browsers use unrolls anything it can, and
// unrolled, the relief and the ground detail took over a minute to build.
uniform int uReliefTaps;
uniform float uSceneTime;        // seconds, for anything that moves
// The illustrated look (v3). See toon.js.
uniform float uToon;             // 1: printed in flat inks; 0: lit, as it was
uniform vec3 uInkRgb[12];        // this place's inks, linear
uniform vec3 uInkLab[12];        // and in Oklab, lightness already weighted
uniform int uInkN;
uniform vec3 uPlantRgb[12];      // the plant's own, louder inks
uniform vec3 uPlantLab[12];
uniform int uPlantN;
uniform vec3 uGroundFlat;        // the ground is one ink
uniform vec3 uSkyFlat;           // and so is the sky
uniform vec3 uFarFlat;           // what lies below the horizon past the ground
uniform vec3 uSunSpot;           // where the drawn sun hangs, as a direction
uniform vec3 uSunFlat;
uniform vec3 uLineFlat;          // the ink lines are drawn in, for the sun's face
uniform vec3 uInkTint;           // a place's world pushed towards its inks before choosing
uniform vec3 uPoolFlat;          // a cave's pool of light
uniform vec3 uFarLand;           // what lies below the horizon past the built ground
uniform float uWorldIdiom;      // 0 = the world as it is; otherwise the manner it has taken on
uniform float uUnderwater;      // 1 when the camera is in the sea rather than above it
uniform float uGloom;           // 1 in a cave: no light but what falls through the break
uniform float uRecede;          // 1 to hold the world back behind the plant; 0 to see it raw
out vec4 outColour;

// Four comparisons the hardware filters, each already a blend of the four
// texels round it — as soft as the nine taps compared by hand it replaces, at
// under half the reads, on every pixel on the screen.
float shadowIn(highp sampler2DShadow map, vec3 pc, float bias, float spread) {
  vec2 texel = vec2(1.0 / ${SHADOW_SIZE}.0) * spread;
  float z = pc.z - bias;
  return 0.25 * (texture(map, vec3(pc.xy + vec2(-0.5, -0.5) * texel, z))
    + texture(map, vec3(pc.xy + vec2(0.5, -0.5) * texel, z))
    + texture(map, vec3(pc.xy + vec2(-0.5, 0.5) * texel, z))
    + texture(map, vec3(pc.xy + vec2(0.5, 0.5) * texel, z)));
}

/**
 * Two shadow maps: a tight one round the plant, and a wide one over everything
 * the camera can see.
 *
 * There was only the tight one and only the plant was drawn into it, so the
 * plant was the one thing in the world that cast a shadow. Trees stood on a
 * forest floor that was lit evenly right up to their roots; a hill had no dark
 * side; a boulder did not shade the sand. The wide map is coarse — a few world
 * units to a texel — which is plenty for a trunk or a ridge and too coarse for
 * a leaf, so near the plant the tight one still wins.
 */
float shadowAt(vec4 lp, float ndl) {
  if (uToon > 0.5) return 1.0;
  vec3 pn = lp.xyz / lp.w * 0.5 + 0.5;
  vec3 pf = vLightPosFar.xyz / vLightPosFar.w * 0.5 + 0.5;
  float far = 1.0;
  if (pf.z <= 1.0 && pf.x > 0.0 && pf.x < 1.0 && pf.y > 0.0 && pf.y < 1.0) {
    far = shadowIn(uShadowFar, pf, mix(0.0011, 0.00035, ndl), 1.6);
  }
  if (pn.z > 1.0 || pn.x < 0.0 || pn.x > 1.0 || pn.y < 0.0 || pn.y > 1.0) return far;
  // slope-scaled bias, or a surface facing away from the light shadows itself
  float near = shadowIn(uShadow, pn, mix(0.0016, 0.0004, ndl), 1.4);
  // hand over across the edge of the tight map rather than at a line
  vec2 edge = min(pn.xy, 1.0 - pn.xy);
  float w = smoothstep(0.0, 0.08, min(edge.x, edge.y));
  return mix(far, min(near, far), w);
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
${CARD_MASKS}
/**
 * Each material's relief, as one recipe read from a table.
 *
 * This was a chain of thirty branches, one per material, each with its own
 * fractal noise — and it is sampled three times a pixel to find the slope.
 * GPUs cope with that; the compiler Windows browsers hand shaders to does not.
 * It inlines every call and unrolls every loop, and faced with ninety copies of
 * nested noise it spent over a minute building this one program: a new player
 * on Windows looked at a black screen for that long, and the GPU watchdog could
 * give up on the page before it finished.
 *
 * Every one of those branches was the same few ingredients in different
 * amounts — up to two fractal noises, up to two plain ones, a wave, a
 * sawtooth — so they are that now: one formula, and a row of numbers for each
 * material saying how much of each at what scale. SURFACE_RECIPES has the rows.
 * The relief is identical; the program takes seconds.
 */
struct Recipe { vec4 f1; vec4 f2; vec4 n1; vec4 n2; vec4 wave; vec4 cut; vec4 tf; vec4 tn; };

Recipe recipeFor(int id) {
  int row = id <= 33 ? id : (id == 42 ? 34 : 35);
  Recipe r;
  r.f1 = texelFetch(uSurfaceTable, ivec2(0, row), 0);
  r.f2 = texelFetch(uSurfaceTable, ivec2(1, row), 0);
  r.n1 = texelFetch(uSurfaceTable, ivec2(2, row), 0);
  r.n2 = texelFetch(uSurfaceTable, ivec2(3, row), 0);
  r.wave = texelFetch(uSurfaceTable, ivec2(4, row), 0);
  r.cut = texelFetch(uSurfaceTable, ivec2(5, row), 0);
  r.tf = texelFetch(uSurfaceTable, ivec2(6, row), 0);
  r.tn = texelFetch(uSurfaceTable, ivec2(7, row), 0);
  return r;
}

/**
 * How large a material's surface is drawn, in cycles per world unit.
 *
 * The plant's materials were at the same scale as the world's, which put wool's
 * fuzz and clay's thumbprints three to five units across — a pixel or two at
 * the distance the game is played at, where relief that fine is faded out
 * rather than left to shimmer. So at a glance every material was its colour and
 * nothing else, and they were hard to tell apart. Drawn three times larger on
 * the plant, what makes each one itself survives at playing distance. The
 * world's own surfaces were already the size they should be.
 */
float reliefScale(int id) { return id <= 22 ? 0.065 : 0.19; }

float surfaceHeight(Recipe r, vec2 uvRaw, float sc) {
  vec2 uv = uvRaw * sc;
  float h = r.wave.w;
  if (r.f1.z > 0.0) h += fbm(uv * r.f1.xy) * r.f1.z;
  if (r.f2.z > 0.0) h += fbm(mix(uv, uv.yx, r.f2.w) * r.f2.xy) * r.f2.z;
  if (r.n1.z > 0.0) h += pow(vnoise(uv * r.n1.x), r.n1.y) * r.n1.z;
  if (r.n2.z > 0.0) h += pow(vnoise(uv * r.n2.x), r.n2.y) * r.n2.z;
  if (r.wave.z > 0.0) h += sin(dot(uv, r.wave.xy)) * r.wave.z;
  if (r.cut.z > 0.0) h += fract(dot(uv, r.cut.xy)) * r.cut.z;
  return h;
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
  if (id == 23) return 0.25;                       // cloud: soft, not lumpy
  if (id == 24) return 0.90;                       // terrain
  if (id == 25) return 0.80;                       // distant rock
  if (id == 26) return 0.55;                       // distant leaf
  if (id == 27) return 0.45;                       // water: the swell is the surface
  if (id == 28) return 1.25;                      // cave rock: deep relief, hard edges
  if (id == 29) return 0.50;                      // feather
  if (id == 30) return 0.35;                      // scale
  if (id == 31) return 0.45;                      // blade
  if (id == 32 || id == 33) return 0.15;           // cards: their shape is their detail
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
/**
 * Ground, seen edge-on.
 *
 * The ground is the largest thing in almost every frame and it was a wash: its
 * colour varied in vertex noise a few hundred units across, and seen at the
 * grazing angle the camera looks across it at, that foreshortens into soft
 * horizontal bands with nothing inside them. Real ground at that angle is busy
 * all the way down — patches, then clumps, then grain — so this is six octaves
 * of it in world space, from nine hundred units to three.
 *
 * Each octave fades out as it approaches the size of a pixel rather than being
 * drawn and aliased: detail finer than the screen can show becomes shimmer the
 * moment anything moves, which is worse than a wash. What survives is exactly
 * the detail this particular distance can carry.
 */
//
// One sample an octave. Averaging four along each pixel's footprint kept more
// detail across the view on ground seen edge-on, at four times the cost on the
// largest surface in the picture; the grass now covers the ground where that
// mattered, and this has to run on modest machines.
vec3 groundDetail(vec3 w) {
  vec2 p = w.xz;
  float reach = max(length(fwidth(p)), 1e-3);      // world units under one pixel
  float v = 0.0;
  float sc = 1.0 / 900.0;
  float a = 0.5;
  for (int i = 0; i < uReliefTaps * 2; i++) {      // six, and not unrolled
    float period = 1.0 / sc;
    float keep = 1.0 - smoothstep(period * 0.12, period * 0.45, reach);
    if (keep <= 0.0) break;                        // and every finer one is gone too
    v += (vnoise(p * sc + float(i) * 17.3) - 0.5) * a * keep;
    sc *= 2.95;
    a *= 0.74;
  }
  // and the ground is not one colour: drier and yellower in some places,
  // darker and greener where it holds water
  float dry = smoothstep(0.35, 0.75, vnoise(p / 2400.0 + 5.1));
  vec3 tinge = mix(vec3(0.92, 1.0, 0.94), vec3(1.10, 1.04, 0.84), dry);
  return tinge * (1.0 + v * 0.95);
}

// The noise each tint is driven by is computed once, from the same table the
// relief comes from; the branches below only mix colours. With the noise
// inside them, this was the second-largest thing the Windows shader compiler
// had to chew through, for the same reason the relief was.
vec3 patternTint(int id, Recipe r, vec2 uvRaw, float h) {
  vec2 uv = uvRaw * reliefScale(id);
  float fa = r.tf.w > 0.0 ? fbm(uv * r.tf.xy + r.tf.z) : 0.5;
  float na = r.tn.x > 0.0 ? vnoise(uv * r.tn.x + r.tn.y) : 0.5;
  float nb = r.tn.z > 0.0 ? vnoise(uv * r.tn.z + r.tn.w) : 0.5;

  if (id == 17) {                                  // rust
    // oxide in patches, bare metal showing through where it has not taken
    // 'patch' is reserved in GLSL ES 3.00
    float taken = smoothstep(0.42, 0.66, fa);
    float scab = smoothstep(0.55, 0.85, na);
    vec3 iron = vec3(0.32, 0.30, 0.30);
    vec3 oxide = vec3(1.45, 0.72, 0.30);
    vec3 deep = vec3(0.85, 0.34, 0.16);
    return mix(iron, mix(oxide, deep, scab), taken);
  }
  if (id == 21) {                                  // stone
    // pale ground with darker and lighter grains through it
    float dark = smoothstep(0.62, 0.78, na);
    float pale = smoothstep(0.66, 0.86, nb);
    vec3 c = vec3(1.0);
    c = mix(c, vec3(0.52, 0.50, 0.47), dark * 0.8);
    c = mix(c, vec3(1.30, 1.28, 1.22), pale * 0.5);
    return c;
  }
  if (id == 16) {                                  // porcelain
    // blue underglaze: a few soft shapes with a darker line where the brush
    // turned, which is what makes it read as painted rather than stained
    float m = fa;
    float shape = smoothstep(0.52, 0.60, m);
    float edge = smoothstep(0.58, 0.60, m) - smoothstep(0.60, 0.64, m);
    vec3 blue = vec3(0.30, 0.46, 1.35);
    vec3 c = mix(vec3(1.0), blue, shape * 0.85);
    return mix(c, vec3(0.16, 0.28, 1.10), edge * 0.9);
  }
  if (id == 19) {                                  // bone
    // porous, and yellowed unevenly the way old bone is
    float age = fa;
    float pore = smoothstep(0.60, 0.80, na);
    vec3 c = mix(vec3(1.02, 1.00, 0.94), vec3(0.96, 0.88, 0.70), age);
    return mix(c, vec3(0.72, 0.66, 0.55), pore * 0.55);
  }
  if (id == 9) {                                   // metal
    // brushed: fine streaks that run along the length, not across it
    float streak = fa;
    return vec3(0.86 + streak * 0.34);
  }
  if (id == 11) {                                  // mould
    float bloom = smoothstep(0.45, 0.75, na);
    return mix(vec3(0.70, 0.76, 0.62), vec3(1.15, 1.10, 0.92), bloom);
  }
  if (id == 1) {                                   // botanical
    // fibres running the length of the stem, and a paler underside stripe
    float fib = fa;
    return vec3(0.90 + fib * 0.22);
  }
  if (id == 20) {                                  // resin
    // amber is not uniform: it holds darker seams and the odd clouded patch
    float seam = smoothstep(0.50, 0.72, fa);
    return mix(vec3(1.12, 0.98, 0.74), vec3(0.72, 0.52, 0.28), seam * 0.7);
  }
  if (id == 3) {                                   // clay
    float fire = fa;
    return mix(vec3(1.06, 0.98, 0.90), vec3(0.86, 0.78, 0.72), fire * 0.7);
  }
  if (id == 15) {                                  // charcoal
    float ash = smoothstep(0.58, 0.80, na);
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
// ------------------------------------------------------------ in print --

vec3 labOf(vec3 c) {
  vec3 lms = vec3(
    0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
    0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
    0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  lms = pow(max(lms, vec3(0.0)), vec3(1.0 / 3.0));
  return vec3(
    (0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z) * 0.35,
    1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
    0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z);
}

// The nearest ink, the way a printer would choose which screen a colour goes on.
vec3 inkFor(vec3 c, bool plant) {
  if (!plant) c *= uInkTint;
  vec3 q = labOf(c);
  // chosen by hue first (see CHROMA_BOOST in toon.js): muted colours pushed out
  // along their own hue, so a dark olive prints green rather than brown — and
  // colours already as strong as an ink left alone, so each ink chooses itself
  q.yz *= mix(plant ? 1.3 : 1.8, 1.0, smoothstep(0.05, 0.13, length(q.yz)));
  float best = 1e9;
  vec3 pick = c;
  for (int i = 0; i < 12; i++) {
    if (i >= (plant ? uPlantN : uInkN)) break;
    vec3 d = q - (plant ? uPlantLab[i] : uInkLab[i]);
    float e = dot(d, d);
    if (e < best) { best = e; pick = plant ? uPlantRgb[i] : uInkRgb[i]; }
  }
  return pick;
}

/**
 * A material, printed: each one a pattern laid over its ink rather than a
 * surface under a light — stripes, dots, hatching, grain — the way a print
 * tells cloth from clay. Measured along and around each stem in world units,
 * and faded out before it is too fine to draw.
 */
float printPattern(int id, vec2 uv) {
  float fine = length(fwidth(uv));
  vec2 p = uv / 7.0;
  float m = 0.0;
  if (id == 3 || id == 10) {                                 // clay, wax: dots
    vec2 f = fract(p + vec2(0.5 * floor(p.y), 0.0)) - 0.5;
    m = step(length(f), 0.2);
  } else if (id == 4 || id == 18 || id == 22) {               // wool, velvet, flock: short hatch
    m = step(0.72, fract((p.x + p.y) * 2.0));
  } else if (id == 5 || id == 19) {                           // thread, bone: rings
    m = step(0.62, fract(p.x));
  } else if (id == 6) {                                        // embroidery: crosses
    vec2 f = abs(fract(p * 1.5) - 0.5);
    m = step(min(f.x, f.y), 0.08) * step(max(f.x, f.y), 0.32);
  } else if (id == 9 || id == 16) {                            // metal, porcelain: long stripes
    m = step(0.7, fract(p.y * 1.4));
  } else if (id == 11 || id == 17 || id == 21) {               // mould, rust, stone: speckle
    m = step(0.78, hash21(floor(uv / 2.5)));
  } else if (id == 12 || id == 13 || id == 14) {               // paint: brushed bands
    m = step(0.6, vnoise(vec2(p.x * 0.8, p.y * 3.0)));
  } else if (id == 15 || id == 7) {                            // charcoal, paper: cross-hatch
    m = max(step(0.8, fract((p.x + p.y) * 2.0)), step(0.8, fract((p.x - p.y) * 2.0)));
  }
  return m * (1.0 - smoothstep(0.3, 0.55, fine / 7.0));
}

/**
 * The sky, printed: one ink, a sun that is a disc with rays round it and a
 * face on it — the sun in every one of these pictures has one — sparkles by
 * day, and stars and a moon at night.
 */
vec3 printedSky(vec3 d) {
  vec3 c = uSkyFlat;
  if (uUnderwater > 0.5 || uGloom > 0.5) return c;
  if (d.y < -0.02) return uFarFlat;
  vec3 s = normalize(uSunSpot);
  float along = dot(d, s);
  if (along > 0.9) {
    vec3 right = normalize(cross(s, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, s);
    vec2 q = vec2(dot(d, right), dot(d, up)) / 0.05;
    float r = length(q);
    vec3 disc = mix(uSunFlat, vec3(0.93, 0.90, 0.80), smoothstep(0.4, 0.8, uNightness));
    if (r < 1.0) {
      c = disc;
      // a face, by day
      if (uNightness < 0.55) {
        float eyes = step(length(vec2(abs(q.x) - 0.34, q.y - 0.16)), 0.11);
        float smile = step(abs(length(q - vec2(0.0, 0.12)) - 0.46), 0.06) * step(q.y, -0.08);
        if (eyes + smile > 0.0) c = uLineFlat;
      }
    } else if (r < 2.0 && uNightness < 0.55) {
      // rays: twelve short strokes
      float a = atan(q.y, q.x) / 6.2832 * 12.0;
      if (r > 1.3 && abs(fract(a) - 0.5) * r < 0.06) c = disc;
    }
  }
  // sparkles by day, stars by night: four-pointed, scattered by direction
  vec2 ang = vec2(atan(d.x, -d.z), asin(clamp(d.y, -1.0, 1.0))) * 38.0;
  vec2 cell = floor(ang);
  float h = hash21(cell + 7.3);
  float want = mix(0.06, 0.22, uNightness);
  if (h < want && d.y > 0.02) {
    vec2 f = fract(ang) - 0.5 - (vec2(hash21(cell * 1.7), hash21(cell * 2.3)) - 0.5) * 0.4;
    float k = 0.14 + hash21(cell * 3.1) * 0.12;
    f = abs(f) / k;
    if (f.x * f.y < 0.04 && f.x + f.y < 1.0) c = vec3(0.98, 0.95, 0.86);
  }
  return c;
}

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

  // Dusk, on the way there. The night comes on as the plant climbs, and it
  // used to arrive as a dimmer: the same blue, darker. Between day and night
  // is the gold hour, and it is not one colour laid over the sky. Towards the
  // sun the horizon burns orange and the glow reaches well up. Away from it —
  // which is where this camera mostly looks — there is a narrow rose band a
  // few degrees up, the earth's own shadow grey-blue beneath it, and the sky
  // above deepening to violet.
  float dusk = smoothstep(0.05, 0.40, uNightness) * (1.0 - smoothstep(0.55, 0.92, uNightness));
  vec2 heading = dir.xz / max(length(dir.xz), 1e-4);
  vec2 sunFlat = uLightDir.xz / max(length(uLightDir.xz), 1e-4);
  float toSun = dot(heading, sunFlat) * 0.5 + 0.5;
  vec3 zenith = vec3(0.20, 0.25, 0.56);
  vec3 away = mix(vec3(0.30, 0.35, 0.50), vec3(0.86, 0.58, 0.58), smoothstep(0.0, 0.03, up));
  away = mix(away, zenith, smoothstep(0.045, 0.20, up));
  vec3 toward = mix(vec3(1.15, 0.60, 0.28), vec3(0.95, 0.70, 0.55), smoothstep(0.0, 0.22, up));
  toward = mix(toward, zenith, smoothstep(0.22, 0.65, up));
  air = mix(air, mix(away, toward, toSun * toSun), dusk);

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
  vec3 open = mix(earth, skyDir(dir), smoothstep(-0.12, 0.10, dir.y));
  // In a cave there is no sky to see, except straight up through the break.
  // Reflecting open sky everywhere turned the rock floor into what looked like
  // standing water.
  vec3 roofed = mix(earth * 0.35, skyDir(dir), smoothstep(0.86, 0.97, dir.y));
  return mix(open, roofed, uGloom);
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
  vec3 air = skyDir(to / max(d, 0.001)) * (0.62 + uAirColour * 0.9) * gloom * uHazeTint;
  return mix(lit, air, f * k);
}

// What the atmosphere shell shows. No ground on it any more — the ground is
// geometry, standing in front of it, so this is only ever sky.
vec3 skyAt(vec3 world, vec3 nrm) {
  vec3 to = world - uEye;
  vec3 dir = to / max(length(to), 0.001);
  vec3 air = skyDir(dir);

  // Below the horizon, land. The built ground stops eleven thousand units out,
  // and past it the shell showed sky colour all the way down — invisible from
  // the ground, where that is a sliver at the horizon, and most of the picture
  // from up in the air: a pale haze where the world should have dropped away
  // beneath. It is the far land now, lit by the same sun, seen through as much
  // air as lies between it and the eye — so it is haze near the horizon and
  // land further down, and the height reads.
  if (dir.y < 0.0 && uUnderwater < 0.5 && uGloom < 0.5) {
    float reach = max(uEye.y, 200.0) / max(-dir.y, 0.004);
    // Never less hazed than the far edge of the built ground in front of it —
    // a darker strip of land beyond hazed hills is distance running backwards —
    // and held back the way the rest of the world is, but thin enough, up in
    // the air, that the ground is still down there.
    float through = 1.0 - exp(-reach * 0.00004);
    vec3 land = uFarLand * (uSunColour * 0.55 + uSkyColour * 1.2) * 1.3;
    // and not one colour: country seen from the air is a patchwork — fields,
    // woods, rises in shade — laid where this line of sight meets the ground
    vec2 ground = uEye.xz + dir.xz * reach;
    land *= 0.62 + vnoise(ground / 9000.0) * 0.5 + vnoise(ground / 2600.0 + 3.7) * 0.3;
    land = mix(land, vec3(dot(land, vec3(0.2126, 0.7152, 0.0722))), 0.12);
    // and what distance does to land is turn it blue, not grey: the air in
    // front of it is lit sky, the colour of the sky a little above the horizon
    // rather than of the pale band right on it. Hazed towards that pale band,
    // the land beyond the hills came out a murky grey-green.
    vec3 blue = skyDir(normalize(vec3(dir.x, 0.05, dir.z)));
    air = mix(land, mix(air, blue, 0.7 * smoothstep(0.0, 0.10, -dir.y)), through);
  }

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
  int matId = int(vParams.w + 0.5);
  // Cards first: outside a blade or a leaf there is nothing here at all. Only
  // the card program has this. A discard anywhere in a program stops the GPU
  // rejecting hidden pixels before shading them, for everything that program
  // draws — with it in the one program the whole world is drawn with, every
  // rock hidden behind another rock was shaded in full, and the cave, which
  // has no cards at all, got half again slower.
  float cardShade = 1.0;
#ifdef CARDS
  vec2 cgx = dFdx(vUv / 8.0);
  vec2 cgy = dFdy(vUv / 8.0);
  if (matId == 32) {
    vec2 g = grassCard(vUv, cgx, cgy);
    if (g.x < 0.5) discard;
    cardShade = mix(0.45, 1.0, g.y);             // dark at the root, lit at the tip
  } else if (matId == 33) {
    vec2 l = leafCard(vUv, cgx, cgy);
    if (l.x < 0.5) discard;
    cardShade = 0.78 + hash21(vec2(floor(vUv.x), l.y * 13.0)) * 0.42;
  }
#endif
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uEye - vWorld);
  // Blades are single-sided sheets and take the side facing the eye. Leaf cards
  // do not: they carry the clump's own rounded normal, which is what lets a
  // crown of flat cards shade as a crown, and turning it round would light
  // the far side of every tree as if it faced the sun.
  if (dot(N, V) < 0.0 && matId != 33) N = -N;

  // The world keeps its own hours. When its era is a drawn one, its ids become
  // that idiom's id here, and the whole rest of the pipeline — the flat path
  // below, the screen-space work in the camera pass — treats the ground and the
  // sky as a drawing, on a rhythm that has nothing to do with what the plant is
  // made of or how far it has grown.
  int worldIdiom = int(uWorldIdiom + 0.5);
  // Every id the world owns, 23 to 31. This stopped at 26 when those were all
  // there were, and everything added since — water, cave rock, birds, fish,
  // grass and kelp — stayed lit inside a drawn era: a blockprint landscape with
  // a photographed floor and cyan kelp standing in it.
  bool ofTheWorld = matId == 0 || (matId >= 23 && matId <= 33);
  if (ofTheWorld && worldIdiom > 0) matId = worldIdiom;

  // Printed: every surface is one of its place's inks, and nothing is lit.
  if (uToon > 0.5) {
    // A drawn idiom (halftone, dither, ASCII...) is already a way of drawing,
    // and on its own screen-space path it came out as a lit grey sketch pasted
    // into a print. Printed, each is the pattern nearest to it, laid over the
    // section's ink like any material's.
    int pid = matId;
    if (matId >= 40) {
      pid = ofTheWorld ? 25
        : (matId == 42 || matId == 46) ? 11 : matId == 43 ? 6 : matId == 44 ? 9
        : matId == 45 ? 3 : matId == 47 ? 15 : 2;
    }
    vec3 c;
    // How far this pixel is laid over with a second, darker pass of its own ink:
    // the pattern its material is printed in, and the side of it turned from the
    // sun, as one flat shade the way a print gives a hill a lit face and a dark
    // one. It rides in the alpha beside the id, and the camera pass takes it
    // back out before looking for lines, so neither is ever outlined.
    float over = 0.0;
    // lit from the upper left, as a print is, whatever the sun is doing: with the
    // sun behind the camera nearly every face turned to the eye was lit, and
    // nothing had a shade side at all
    float lit = dot(N, normalize(vec3(-0.8, 0.45, 0.4)));
    float edge = max(fwidth(lit), 0.02);
    if (pid == 0) c = printedSky(normalize(vWorld - uEye));
    else if (pid == 24 || (pid == 28 && uGloom > 0.5 && N.y > 0.6)) c = uGroundFlat;
    else if (ofTheWorld) {
      c = inkFor(vAlbedo * cardShade, false);
      // a bird in the sky is a mark of the pen, the way every one of these
      // pictures draws them
      if (pid == 29) c = uLineFlat;
      // not the water, the birds, or the grass and leaf cards, which carry
      // shading of their own
      else if (pid != 27 && pid != 32 && pid != 33)
        over = (1.0 - smoothstep(0.3 - edge, 0.3 + edge, lit)) * 0.45;
    } else {
      // The plant is a drawing, pressed flat (see PRESSED in scene.js): its
      // own ink and its material's pattern, and no shade side — a shade side
      // is the one thing that says a shape is round.
      c = inkFor(vAlbedo, true);
      over = printPattern(pid, vUv);
    }
    // in a cave, the light that falls through the break lies on the floor as
    // a flat pool under the plant
    if (ofTheWorld && pid != 0 && uGloom > 0.5 && N.y > 0.6
      && length(vWorld.xz - vec2(0.0, -250.0)) < 760.0 + (vnoise(vWorld.xz / 260.0) - 0.5) * 180.0) {
      c = uPoolFlat;
      over = 0.0;
    }
    c *= 1.0 - OVERPRINT * over;
    // The evening comes on in the inks too: the world goes over to a night
    // print, each ink towards a blue-violet of its own lightness, so the whole
    // place becomes a few tones of one colour under the stars; the plant keeps
    // more of its own. (The sky has night inks of its own.) Linear in c, so the
    // camera pass can still take a second pass back out of it.
    if (pid != 0) {
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 night = mix(lum * vec3(0.55, 0.60, 1.25), c, ofTheWorld ? 0.3 : 0.6) * 0.6;
      c = mix(c, night, uNightness * (ofTheWorld ? 0.9 : 0.45));
    }
    outColour = vec4(c, (float(pid) + OVER_SLOT * over) / 255.0);
    return;
  }

  // relief: bend the normal by the slope of the material's own height field,
  // sampled at a fixed fraction of that material's own feature size
  float rsc = reliefScale(matId);
  float e = 0.16 / (rsc * featureFreq(matId));
  Recipe recipe = recipeFor(matId);
  // Its bound is a uniform so that the compiler cannot unroll it into three
  // copies of the whole recipe — which is most of what made this slow to build.
  vec3 hs = vec3(0.5);
  // How many pixels one feature of the relief covers, worked out first: where
  // it is too fine to see it is faded out anyway (below), so it is not worth
  // working out at all — which is most of the distant world, most of the frame.
  float period = 1.0 / (rsc * featureFreq(matId));
  float perPx = period / max(length(fwidth(vUv)), 1e-5);
  float resolve = smoothstep(1.5, 6.0, perPx);
#ifndef CARDS                                     // a card's shape is its detail
  if (resolve > 0.01)
  for (int k = 0; k < min(uReliefTaps, 3); k++) {
    vec2 o = k == 1 ? vec2(e, 0.0) : (k == 2 ? vec2(0.0, e) : vec2(0.0));
    float hk = surfaceHeight(recipe, vUv + o, rsc);
    if (k == 0) hs.x = hk; else if (k == 1) hs.y = hk; else hs.z = hk;
  }
#endif
  float h0 = hs.x;
  float hx = hs.y;
  float hy = hs.z;
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
  vec2 dux = dFdx(vUv), duy = dFdy(vUv);
  float det = dux.x * duy.y - duy.x * dux.y;
  vec3 T = abs(det) > 1e-8 ? normalize((dpx * duy.y - dpy * dux.y) / det) : normalize(dpx);
  vec3 Bt = normalize(cross(N, T));
  // Relief shrunk below a few pixels is noise, not surface.
  //
  // A height field bends the normal at its own scale, and once that scale is
  // smaller than a pixel every pixel bends a different way — and at a grazing
  // angle each one then reflects a different part of the sky. That was the sea:
  // a field of white static where there should have been water, and the same
  // fizz along the edge of every canopy. So relief fades out as its features
  // approach pixel size, and what it would have contributed goes into roughness
  // instead. A surface too detailed to resolve looks duller from a distance
  // rather than sparkling, which is what it does through a lens.
  N = normalize(N - (T * (hx - h0) + Bt * (hy - h0)) * bumpStrength(matId) * 1.45 * uRelief
    * resolve);

  vec3 L = normalize(uLightDir);
  vec3 H = normalize(L + V);

  float rough = clamp(vParams.x + (h0 - 0.5) * 0.22 * (1.0 + albedoVar(matId) * 2.2)
    + (1.0 - resolve) * min(bumpStrength(matId), 1.0) * 0.22 * uRelief, 0.04, 1.0);
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
    // The world's own range, which moved down when the ground was brought into
    // the midtones for the lit look — left where it was, every print came out
    // with a black foreground.
    float toneLo = ofTheWorld ? 0.06 : 0.03;
    float toneSpan = ofTheWorld ? 0.52 : 0.13;
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
    outColour = vec4(world3 * lit * (0.55 + uAirColour * 1.1), 0.0);
    return;
  }

  float av = albedoVar(matId) * uRelief;
  vec3 albedo = vAlbedo * cardShade * (1.0 - av * 0.5 + h0 * av);

  // Cavity occlusion. Light reaching the bottom of a pit has to get past the
  // walls of it, so a crevice is darker than a lambert term alone will ever
  // make it. Without this the relief reads as a pattern of highlights lying on
  // a flat surface rather than as a surface with depth in it — and it is the
  // cheapest thing that makes a rough material look rough.
  float cav = mix(1.0, smoothstep(-0.15, 0.72, h0), av * 0.85);
  albedo *= cav;
#ifndef CARDS
  albedo *= mix(vec3(1.0), patternTint(matId, recipe, vUv, h0), uRelief);
  if (matId == 24 || matId == 28) albedo *= mix(vec3(1.0), groundDetail(vWorld), uRelief);
#endif
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

  // Clouds are lit as volumes, not as surfaces. Light soaks through them, so
  // the lit side wraps a long way round; their bases are flat and in their own
  // shade, darker than their tops by more than their curvature explains; and
  // looking towards the sun their thin edges burn — the silver lining.
  if (matId == 23) {
    float under = 1.0 - smoothstep(-0.65, 0.35, N.y);
    direct = (kd * albedo / 3.14159) * uSunColour * (dot(N, L) * 0.45 + 0.55) * (1.0 - under * 0.5);
    direct += albedo * uSunColour * pow(max(dot(-V, L), 0.0), 5.0) * pow(1.0 - ndv, 2.0) * 0.9;
    // At night a cloud is a soft pale shape against the dark, lit by the moon
    // and the glow of the sky evenly. Lit as by day, its relief turned into a
    // scatter of little bright and dark facets — a disco ball.
    direct = mix(direct, albedo * uSkyColour * (1.1 + N.y * 0.35), uNightness * 0.8);
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
  // Rough surfaces lose their mirror, and lose it faster than linearly: the
  // same bumps that spread a reflection out also shadow it, most of all at the
  // grazing angles where Fresnel was asking for the most. Scaled by one minus
  // roughness, grass at 0.7 still mirrored over half the sky near the horizon,
  // and every field and forest floor went milky towards the back. Squared, the
  // glossy things — glass, water, a polished stem — are where they were.
  float gloss = 1.0 - rough;
  ambient += env * envF * min(gloss * gloss * 1.35, 1.1) * (0.55 + trans * 0.7);
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
  // Water is exempt. A sea is nearly all distance, and held back with the rest
  // of the world it went grey out to the horizon — the colour of a beach is the
  // colour of its water.
  if (ofTheWorld && matId != 27 && uRecede > 0.5) {
    // Enough to put the world behind the plant, not enough to drain it. At
    // nearly half the colour gone by five thousand units the ground went grey
    // and the whole picture with it — holding a background back is a nudge, and
    // past a certain point it stops being restraint and starts being fog.
    float far = clamp((length(vWorld - uEye) - 900.0) / 7000.0, 0.0, 1.0);
    vec3 lit = direct + ambient;
    float l = dot(lit, vec3(0.2126, 0.7152, 0.0722));
    // Much less than it was. Held back hard, the world went pale and flat
    // while the plant kept its full colour and contrast, and the difference
    // itself was what read — a plant composited over a photograph of a place.
    lit = mix(lit, vec3(l), 0.10 * far);                  // colour goes first
    lit = mix(lit, vec3(l * 0.5 + 0.26), 0.05 * far);     // then contrast
    direct = lit;
    ambient = vec3(0.0);
  }

  float gloom = gloomAt(vWorld);
  direct *= gloom;
  // Where the plant stands, the ground is in its own shade: light from the sky
  // cannot reach under it from every side. A soft darkening round the base is
  // what sets a thing down on the ground rather than hovering over it.
  if (ofTheWorld && matId != 23) {
    float contact = 1.0 - 0.38 * exp(-dot(vWorld.xz, vWorld.xz) / (170.0 * 170.0)) * smoothstep(260.0, 0.0, vWorld.y);
    direct *= contact;
    ambient *= contact;
  }
  // The cloud's own edge thins out and the sky behind shows through it: a cloud
  // has no surface, and a hard white outline is the thing that made these read
  // as cotton wool rather than as weather.
  float cloudEdge = matId == 23 ? pow(1.0 - ndv, 2.4) : 0.0;
  ambient *= mix(1.0, gloom, 0.60);
  float hazeGloom = uGloom > 0.5 ? min(1.0, gloom * 1.3) : 1.0;

  vec3 seen = aerial(direct + ambient, vWorld,
      // Under water the world goes into the blue fast, and so did the plant:
      // whenever the camera drew back it sank into the same colour as the
      // water. It is the subject; it keeps its colour.
      matId == 23 ? 0.16 : (ofTheWorld ? mix(0.34, 0.94, uUnderwater) : mix(0.34, 0.26, uUnderwater)),
      hazeGloom);
  if (matId == 23) seen = mix(seen, skyDir(-V) * (0.55 + uAirColour * 1.1) * 0.85, cloudEdge * 0.6);
  // the material id rides out in alpha so the camera pass can find it again
  outColour = vec4(seen, float(matId) / 255.0);
}`;

const DEPTH_VS = `#version 300 es
precision highp float;
in vec3 aPos; in vec4 aParams; in vec2 aUv;
uniform mat4 uLightViewProj;
out float vId; out vec2 vUv;
void main() { vId = aParams.w; vUv = aUv; gl_Position = uLightViewProj * vec4(aPos, 1.0); }`;

// What does not cast: the sky shell, which would put the whole world in its
// shadow; cloud and birds, which are too far off for either map to reach where
// their shadow falls; water, which lets the light through; and grass, which
// moves every frame and is too small for the wide map to resolve anyway. Leaf
// cards cast through their own cut-outs, so a canopy's shadow is dappled.
const DEPTH_FS = `#version 300 es
precision highp float;
in float vId; in vec2 vUv;
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
${CARD_MASKS}
void main() {
  vec2 cgx = dFdx(vUv / 8.0);
  vec2 cgy = dFdy(vUv / 8.0);
  int id = int(vId + 0.5);
  if (id == 0 || id == 23 || id == 27 || id == 29 || id == 31 || id == 32) discard;
  if (id == 33 && leafCard(vUv, cgx, cgy).x < 0.5) discard;
}`;

const POST_VS = `#version 300 es
precision highp float;
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const POST_FS = `#version 300 es
precision highp float;
${OVERPRINT}
in vec2 vUv; out vec4 outColour;
uniform sampler2D uScene; uniform sampler2D uDepth; uniform sampler2D uGlyphs;
uniform sampler2D uBackdrop;
uniform sampler2D uSceneSmooth;  // the same image, read filtered
uniform vec2 uPixel; uniform float uFocus; uniform float uAperture;
uniform float uNear; uniform float uFar; uniform float uTime; uniform float uExposure;
uniform float uGlyphCount;
uniform float uScale;    // device pixels per CSS pixel, so cells stay legible
uniform vec2 uGrid;      // camera pan in device pixels, so screens stay put on the plant
uniform float uToneOnly; // 1 shows a flat idiom's tone with no treatment, for tests
uniform float uToon;     // printed (v3): lines and paper, no lens
uniform vec3 uInk;       // the colour the lines are drawn in
// the place's own grade: shadows and highlights tinted, black point, contrast
uniform vec3 uGradeShadow;
uniform vec3 uGradeLight;
uniform vec2 uGradeTone;
uniform float uTonemap;      // 1: PBR Neutral; 0: the ACES fit it replaced

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

// ------------------------------------------------------------ in print --

vec3 sceneAt(ivec2 p) {
  return texelFetch(uScene, clamp(p, ivec2(0), textureSize(uScene, 0) - 1), 0).rgb;
}
// Whether a pixel is the plant: every id under the world's own (see MAT_ID).
bool plantAt(ivec2 p) {
  int id = int(texelFetch(uScene, clamp(p, ivec2(0), textureSize(uScene, 0) - 1), 0).a * 255.0 + 0.5);
  return id >= 1 && id < 23;
}
// The ink a shape was laid down in, with any second pass over it (pattern,
// shade side) taken back out: what the lines are found from.
vec3 inkAt(ivec2 p) {
  vec4 s = texelFetch(uScene, clamp(p, ivec2(0), textureSize(uScene, 0) - 1), 0);
  float a = s.a * 255.0;
  float over = clamp((a - floor(a + 0.05)) / OVER_SLOT, 0.0, 1.0);
  return s.rgb / (1.0 - OVERPRINT * over);
}
// Inverse depth: it runs straight across any flat surface on the screen, even
// one seen almost edge-on, so only a real break in it — something in front of
// something else, or a fold — draws a line. Depth itself curves across the
// ground towards the horizon, and would have lined the whole floor.
float nearness(ivec2 p) {
  float d = texelFetch(uDepth, clamp(p, ivec2(0), textureSize(uDepth, 0) - 1), 0).r;
  return 1.0 / max(linearDepth(d), 1.0);
}

/**
 * The picture as a print: an ink line wherever one colour meets another or
 * one thing stands in front of another, drawn by a hand — the lookups wander
 * a pixel or two, so the lines do. The fills are left clean: paper grain,
 * pinholes and worn patches were tried, and read as noise over the picture.
 *
 * A line is drawn on one side of its edge only: outside the nearer shape, or
 * where two shapes lie at one depth, on the paler of them. Drawn on both
 * sides, a stem thinner than two lines was nothing but line — a black cord.
 */
vec3 printed() {
  vec2 fc = gl_FragCoord.xy;
  vec2 wob = vec2(vnoise(fc * 0.045 + 3.1), vnoise(fc.yx * 0.045 + 7.7)) - 0.5;
  ivec2 at = ivec2(fc + wob * 2.2 * uScale);
  // lookups at two reaches round the pixel: the far ring sets how wide a line
  // is, the near one keeps a shape thinner than that from slipping between
  int r = int(max(1.0, floor(2.0 * uScale + 0.5)));
  int rd = max(1, int(float(r) * 0.7 + 0.5));
  int rh = max(1, r / 2);
  vec3 cc = inkAt(at);
  float lc = dot(cc, vec3(0.2126, 0.7152, 0.0722));
  float nc = nearness(at);
  float line = 0.0;
  for (int k = 0; k < 12; k++) {
    ivec2 o = k == 0 ? ivec2(r, 0) : k == 1 ? ivec2(-r, 0) : k == 2 ? ivec2(0, r) : k == 3 ? ivec2(0, -r)
      : k == 4 ? ivec2(rd, rd) : k == 5 ? ivec2(-rd, -rd) : k == 6 ? ivec2(rd, -rd) : k == 7 ? ivec2(-rd, rd)
      : k == 8 ? ivec2(rh, 0) : k == 9 ? ivec2(-rh, 0) : k == 10 ? ivec2(0, rh) : ivec2(0, -rh);
    vec3 cn = inkAt(at + o);
    float nn = nearness(at + o);
    // where one colour meets another, on the far side, or the paler
    vec3 dc = abs(cn - cc);
    float mine = nn > nc * 1.015 ? 1.0
      : (nn * 1.015 < nc ? 0.0 : step(dot(cn, vec3(0.2126, 0.7152, 0.0722)), lc));
    line = max(line, smoothstep(0.012, 0.045, max(dc.r, max(dc.g, dc.b))) * mine);
    // where something stands in front, whatever its colour: the two lookups
    // opposite each other bend the inverse depth, which runs straight across
    // any flat surface — only its upward bend, which is the far side
    if ((k & 1) == 0) {
      float bend = nn + nearness(at - o) - 2.0 * nc;
      line = max(line, smoothstep(0.10, 0.28, bend / nc));
    }
  }
  // The plant is the subject, and drawn round with a heavier line than anything
  // else: printed in the same loud inks as a forest of painted trunks, it was
  // one more trunk among them. A third ring, further out, that only the plant
  // in front of this pixel counts in.
  int rp = r + max(1, int(1.2 * uScale + 0.5));
  int rpd = max(1, int(float(rp) * 0.7 + 0.5));
  if (!plantAt(at)) {
    for (int k = 0; k < 8; k++) {
      ivec2 o = k == 0 ? ivec2(rp, 0) : k == 1 ? ivec2(-rp, 0) : k == 2 ? ivec2(0, rp) : k == 3 ? ivec2(0, -rp)
        : k == 4 ? ivec2(rpd, rpd) : k == 5 ? ivec2(-rpd, -rpd) : k == 6 ? ivec2(rpd, -rpd) : ivec2(-rpd, rpd);
      if (plantAt(at + o) && nearness(at + o) > nc * 1.015) line = 1.0;
    }
  }
  vec3 col = pow(mix(sceneAt(at), uInk, line), vec3(1.0 / 2.2));
  return col;
}

// ACES, the filmic curve. Straight linear-to-sRGB looks like a render; this
// looks like a photograph, mostly because of what it does to the highlights.
vec3 aces(vec3 x) {
  const float a = 2.51; const float b = 0.03; const float c = 2.43;
  const float d = 0.59; const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/**
 * Khronos PBR Neutral.
 *
 * ACES was made for film, and it grades as it maps: hues shift on the way up
 * (saturated yellow runs orange, red runs pink) and colour drains out of
 * everything bright, which is why graded() below has had to push saturation
 * back in. This one is made for showing a material as its colour: below the
 * shoulder it only takes a small offset off the darks, so a petal is the
 * colour its pigment says, and above it compresses towards white with a
 * little desaturation, the way a highlight does.
 */
vec3 neutral(vec3 c) {
  const float start = 0.76;
  const float desat = 0.15;
  float x = min(c.r, min(c.g, c.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c -= offset;
  float peak = max(c.r, max(c.g, c.b));
  if (peak < start) return c;
  const float d = 1.0 - start;
  float top = 1.0 - d * d / (peak + d - start);
  c *= top / peak;
  float g = 1.0 - 1.0 / (desat * (peak - top) + 1.0);
  return mix(c, vec3(top), g);
}

/**
 * Each place's own grade, after the curve.
 *
 * The same exposure and the same curve everywhere made every place the same
 * picture with different things in it. A photographer grades a beach warm and
 * a cave cold: shadows and highlights each nudged a few per cent towards a
 * colour, the black point set where the place wants it — a cave's blacks
 * deep, a beach's lifted — and a touch of contrast either way. Small numbers;
 * the plant is in this light too, and must keep its own colour.
 */
vec3 placeGrade(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(uGradeShadow, vec3(1.0), smoothstep(0.0, 0.45, l));
  // and white stays white: a warm grade on a beach is right for the sand and
  // wrong for the clouds, which came out cream
  c *= mix(vec3(1.0), uGradeLight, smoothstep(0.45, 0.8, l) * (1.0 - smoothstep(0.82, 0.98, l) * 0.8));
  c = max(c - uGradeTone.x, 0.0) / (1.0 - uGradeTone.x);
  return (c - 0.45) * uGradeTone.y + 0.45;
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
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Not in the darks, though: there a tiny difference between the channels is
  // noise, not colour, and lifting it by two thirds speckled every shadow — at
  // night, the whole sky — with coloured grit.
  float lift = 1.0 + 0.70 * (1.0 - sat) * (1.0 - sat) * smoothstep(0.04, 0.22, l);
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

// ---------------------------------------------------------------- the lens --
//
// Three things a photograph has that a raw render does not, done in the one
// pass that already reads the whole frame.

float ign(vec2 p) {
  // interleaved gradient noise: the per-pixel spin that turns a sampling
  // pattern's banding into grain fine enough to sit under the film grain
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float lumaOf(vec3 hdr) {
  return dot(aces(hdr * uExposure), vec3(0.299, 0.587, 0.114));
}

vec3 smoothAt(vec2 uv) { return textureLod(uSceneSmooth, uv, 0.0).rgb; }

/**
 * Edges without stairs.
 *
 * Nothing was anti-aliased at all: every stem is a few pixels wide and every
 * one of them was stepped along its length. Multisampling is out, because a
 * resolve averages the material id in alpha along exactly the edges where it
 * has to be exact. So this is FXAA — find an edge by its contrast in the
 * finished tone, work out which way it runs, and blend along it — reading the
 * image through a filtered sampler, which the ids never go near.
 */
vec3 antialiased(vec2 uv, vec3 centre) {
  vec2 px = uPixel;
  float lM = lumaOf(centre);
  float lNW = lumaOf(smoothAt(uv + vec2(-px.x, px.y)));
  float lNE = lumaOf(smoothAt(uv + vec2(px.x, px.y)));
  float lSW = lumaOf(smoothAt(uv + vec2(-px.x, -px.y)));
  float lSE = lumaOf(smoothAt(uv + vec2(px.x, -px.y)));
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.03, lMax * 0.09)) return centre;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcpMin, vec2(-8.0), vec2(8.0)) * px;
  vec3 a = 0.5 * (smoothAt(uv + dir * (1.0 / 3.0 - 0.5)) + smoothAt(uv + dir * (2.0 / 3.0 - 0.5)));
  vec3 b = a * 0.5 + 0.25 * (smoothAt(uv - dir * 0.5) + smoothAt(uv + dir * 0.5));
  float lB = lumaOf(b);
  return (lB < lMin || lB > lMax) ? a : b;
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
    // specks a few pixels across: at two they averaged into a smooth grey at
    // any distance and the grain was hard to see at all
    vec2 sp = floor(gpos() / (3.2 * uScale));
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

  if (uToon > 0.5) { outColour = vec4(printed(), 1.0); return; }

  vec3 col = texture(uScene, vUv).rgb;

  // Anti-aliased, except within reach of a drawn section — a drawing's edge is
  // its own and blending across it would pull the flat tone into the lit side.
  bool nearDrawn = false;
  for (int j = 0; j < 4; j++) {
    ivec2 o = ivec2(j < 2 ? 1 : -1, (j % 2) == 0 ? 1 : -1);
    if (int(texelFetch(uScene, ivec2(gl_FragCoord.xy) + o, 0).a * 255.0 + 0.5) >= 40) nearDrawn = true;
  }
  if (!nearDrawn) col = antialiased(vUv, col);


  col *= uExposure;
  // the same middle grey either way: the ACES fit carries a lift of its own
  col = uTonemap > 0.5 ? neutral(col * 1.7) : aces(col);
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col = placeGrade(col);
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
/**
 * How low the eye may go, and how far below itself it may look instead.
 *
 * The eye used to be held twenty-six units off the ground and always looked
 * level. On a lens this long, from three thousand units back, that is a shot
 * from ground level: everything behind a seedling was squeezed into a band a
 * few pixels high at the horizon, and the ground in front of it — a fifth of
 * the screen above the prompt — was seen so nearly edge-on that no amount of
 * texture could make it more than a smear.
 *
 * Now the eye stops higher, and when the framing asks for a view lower than
 * that, the camera tilts down to it rather than refusing. The picture puts the
 * plant where the framing asked for it, the ground reads as a surface going
 * away, and the place behind the plant has room to be a place. Above the floor
 * nothing changes: the camera is level, as before.
 */
const EYE_FLOOR = 90;
const LOOK_FLOOR = -300;

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

/**
 * The sun's colour from day into night.
 *
 * The night comes on as the plant climbs, and the light used to go straight
 * from white to moonlight along a line — dimmer and bluer, and never warm. It
 * passes through gold and then deep orange now, which is what light does when
 * the sun gets low, at about the same brightness as the line had at each point
 * so nothing else has to be rebalanced round it.
 */
// Midday is nearly white. It was warmer than this while ACES was draining the
// warmth back out of everything bright; under a curve that keeps colour, a sun
// with half as much red again as blue turned pale sand orange.
const SUN_THROUGH = [
  [0.00, [4.50, 4.12, 3.55]],
  [0.35, [4.30, 3.25, 2.10]],
  [0.55, [3.20, 1.75, 0.95]],
  [0.80, [0.90, 0.50, 0.42]],
  [1.00, [0.376, 0.363, 0.415]],
];
function sunThrough(n) {
  for (let i = 1; i < SUN_THROUGH.length; i++) {
    const [n1, c1] = SUN_THROUGH[i];
    const [n0, c0] = SUN_THROUGH[i - 1];
    if (n <= n1) {
      const t = (n - n0) / (n1 - n0);
      return c0.map((v, k) => v + (c1[k] - v) * t);
    }
  }
  return SUN_THROUGH[SUN_THROUGH.length - 1][1];
}
/** How far into the golden hour: none by day, most of it half way to night. */
function duskOf(n) {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return ss(0.05, 0.40, n) * (1 - ss(0.55, 0.92, n));
}

/**
 * Every card's cut-outs, baked into one texture.
 *
 * Worked out per pixel in the shader, a leaf card cost six hashes and six
 * rotations for every pixel it covered — and a crown is five or six cards deep,
 * most of them gaps, so nearly all of that work was done to decide to draw
 * nothing. In the forest it was half the frame. Baked once, it is one texture
 * read; and with mipmaps, a far crown's leaves average out to the right amount
 * of cover instead of sparkling.
 *
 * Sixty-four cells of 64 × 64, eight by eight. Per cell: R, grass cover; G, how
 * far up the blade; B, leaf cover; A, which leaf. The shapes are the ones the
 * shader drew: seven tapering, bowing blades; six pointed ovals at angles.
 */
function cardAtlas(gl) {
  const C = 64;
  const W = C * 8;
  const out = new Uint8Array(W * W * 4);
  const fract = (x) => x - Math.floor(x);
  const hash = (x, y) => {
    let a = fract(x * 123.34);
    let b = fract(y * 456.21);
    const d = a * (a + 45.32) + b * (b + 45.32);
    a += d;
    b += d;
    return fract(a * b);
  };
  for (let seed = 0; seed < 64; seed++) {
    const blades = [];
    for (let k = 0; k < 7; k++) {
      const h1 = hash(seed * 1.37 + k, 4.1);
      const h2 = hash(k * 2.11, seed + 7.3);
      blades.push([h1, 0.5 + 0.5 * h2]);
    }
    const leaves = [];
    for (let k = 0; k < 6; k++) {
      const a = hash(seed * 0.7 + k, 9.1) * Math.PI * 2;
      leaves.push([hash(seed + k * 3.7, 1.3) * 0.6 + 0.2, hash(k * 5.1, seed + 2.9) * 0.6 + 0.2,
        Math.cos(a), Math.sin(a), k / 6 + 0.08]);
    }
    const ox = (seed % 8) * C;
    const oy = Math.floor(seed / 8) * C;
    for (let j = 0; j < C; j++) {
      for (let i = 0; i < C; i++) {
        const px = (i + 0.5) / C;
        const py = (j + 0.5) / C;
        let grass = 0;
        let up = 0;
        for (const [h1, tall] of blades) {
          const v = py / tall;
          const x = 0.12 + 0.76 * h1 + (h1 - 0.5) * 0.55 * v * v;
          if (v < 1 && Math.abs(px - x) < 0.05 * (1 - v)) { grass = 1; up = Math.max(up, v); }
        }
        let leaf = 0;
        let which = 0;
        for (const [cx, cy, co, si, w] of leaves) {
          const dx = px - cx;
          const dy = py - cy;
          const qx = (co * dx + si * dy) / 0.22;
          const qy = (co * dy - si * dx) / 0.22;
          const t = qx * 0.5 + 0.5;
          if (t > 0 && t < 1 && Math.abs(qy) < 0.42 * Math.sin(Math.PI * t)) { leaf = 1; which = w; }
        }
        const o = ((oy + j) * W + ox + i) * 4;
        out[o] = grass * 255;
        out[o + 1] = up * 255;
        out[o + 2] = leaf * 255;
        out[o + 3] = which * 255;
      }
    }
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, W, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

/**
 * Most pixels the renderer will draw, whatever the display claims.
 *
 * This is a browser game and has to run on ordinary machines, so it is set for
 * a modest graphics card rather than a good one: about a 1080p screen's worth.
 */
const MAX_RENDER_PIXELS = 1920 * 1200;

/**
 * How each material's relief is made — the rows the scene shader's
 * surfaceHeight reads. Each term is optional:
 *
 *   f1, f2   fractal noise   [scale x, scale y, amount, swap axes]
 *   n1, n2   plain noise     [scale, power, amount]
 *   wave     sin(uv · k)     [kx, ky, amount, constant added to the whole]
 *   cut      fract(uv · k)   [kx, ky, amount]
 *
 * and the noise that drives the material's colour pattern (patternTint):
 *
 *   tf       fractal noise   [scale x, scale y, offset, on]
 *   tn       two plain ones  [scale, offset, scale, offset] (scale 0 = off)
 *
 * Rows 0–33 are material ids; 34 is the grain idiom; 35 is everything else
 * (glass, the sweep, the flat idioms, the cards), which is nearly flat.
 */
const FLAT_RECIPE = { f1: [0.12, 0.12, 0.35] };
const SURFACE_RECIPES = {
  1: { f1: [0.10, 2.6, 0.55], f2: [0.06, 0.06, 0.45], tf: [0.08, 3.4, 0, 1] },          // botanical: fibres
  3: { f1: [0.66, 0.66, 0.62], n1: [1.6, 1, 0.38], tf: [0.6, 0.6, 2.0, 1] },             // clay: thumbed
  4: { f1: [1.5, 1.5, 0.7], n1: [4.0, 1, 0.3] },                 // wool: fuzz
  5: { wave: [0.9, 2.2, 0.5, 0.5] },                             // thread: plies
  6: { cut: [0.55, 0.18, 0.8], f1: [0.6, 0.6, 0.2] },            // embroidery: satin
  7: { f1: [1.1, 1.1, 0.6], f2: [2.3, 2.3, 0.4, 1] },            // paper: tooth
  9: { f1: [0.04, 9.0, 0.9], wave: [0, 0, 0, 0.1], tf: [0.05, 11.0, 0, 1] },             // metal: brushed
  10: { f1: [0.38, 0.38, 0.75], f2: [0.9, 0.9, 0.25] },          // wax: pours
  11: { n1: [2.2, 2.0, 0.7], f1: [0.9, 0.9, 0.3], tn: [2.4, 0, 0, 0] },              // mould: spores
  12: { f1: [0.8, 0.8, 0.7] },                                   // gouache: paper
  13: { f1: [0.55, 1.3, 0.8], wave: [0, 2.2, 0.12, 0] },         // oil: strokes
  14: { f1: [0.8, 0.8, 0.7] },                                   // watercolour: paper
  15: { f1: [1.7, 1.7, 0.5], n1: [3.3, 1, 0.5], tn: [2.6, 0, 0, 0] },                // charcoal
  16: { f1: [0.5, 0.5, 0.7], n1: [3.4, 6.0, 0.3], tf: [0.42, 0.42, 5.0, 1] },              // porcelain: crazing
  17: { n1: [1.8, 1.6, 0.6], f1: [0.7, 0.7, 0.4], tf: [0.55, 0.55, 0, 1], tn: [1.7, 0, 0, 0] },              // rust: pitted
  18: { f1: [2.2, 2.2, 0.6], n1: [5.0, 1, 0.4] },                // velvet: pile
  19: { f1: [1.2, 1.2, 0.55], n1: [2.6, 2.0, 0.45], tf: [0.5, 0.5, 11.0, 1], tn: [3.0, 0, 0, 0] },            // bone: porous
  20: { f1: [0.45, 0.45, 0.8], f2: [1.1, 1.1, 0.2], tf: [0.7, 0.7, 0, 1] },            // resin: flow
  21: { n1: [3.0, 1, 0.5], f1: [1.0, 1.0, 0.5], tn: [3.4, 0, 2.1, 31.0] },                // stone: granular
  22: { f1: [3.1, 3.1, 0.55], n1: [7.0, 1, 0.45] },              // flock
  23: { f1: [0.22, 0.22, 0.7], f2: [0.6, 0.6, 0.3] },            // cloud: billow
  24: { f1: [0.30, 0.30, 0.6], n1: [1.1, 1, 0.4] },              // terrain
  25: { n1: [2.4, 1, 0.5], f1: [0.9, 0.9, 0.5] },                // distant rock
  26: { f1: [1.4, 1.4, 0.6], n1: [3.2, 1, 0.4] },                // distant leaf
  // water: the finest ripple is gone — too small to see anywhere but right
  // under the camera, and everywhere else it turned the sea to static
  27: { f1: [0.5, 0.5, 0.62], n1: [1.9, 1, 0.34] },               // water
  // cave rock: the bedding it split along, the blocks, the grain of the stone
  28: { f1: [0.55, 0.55, 0.42], n1: [1.7, 1, 0.30], n2: [6.5, 1, 0.18], f2: [15.0, 15.0, 0.10] },
  29: { f1: [2.2, 2.2, 0.6], n1: [7.0, 1, 0.4] },                // feather
  30: { n1: [9.0, 1, 0.6], f1: [3.0, 3.0, 0.4] },                // scale
  31: { f1: [0.4, 3.0, 0.7], n1: [4.0, 1, 0.3] },                // blade: ribbed
  34: { n1: [2.6, 1, 1.0] },                                     // grain idiom
};

/** The recipes as an 8 × 36 float texture, one row per material. */
function surfaceTable(gl) {
  const rows = 36;
  const data = new Float32Array(8 * rows * 4);
  for (let row = 0; row < rows; row++) {
    const r = SURFACE_RECIPES[row] || FLAT_RECIPE;
    ['f1', 'f2', 'n1', 'n2', 'wave', 'cut', 'tf', 'tn'].forEach((k, col) => {
      const v = r[k] || [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) data[(row * 8 + col) * 4 + i] = v[i] || 0;
    });
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 8, rows, 0, gl.RGBA, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

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

    // The card program is the scene's own shader with the cut-outs in it, for
    // the foliage cards alone.
    [this.sceneProg, this.cardProg, this.depthProg, this.postProg] = programs(gl, [
      [SCENE_VS, SCENE_FS],
      [SCENE_VS, SCENE_FS.replace('#version 300 es\n', '#version 300 es\n#define CARDS 1\n')],
      [DEPTH_VS, DEPTH_FS],
      [POST_VS, POST_FS],
    ]);

    this.shadow = shadowTarget(gl, SHADOW_SIZE);
    this.shadowFar = shadowTarget(gl, SHADOW_SIZE);
    // The scene image read a second way: filtered, and through its mip chain.
    this.smooth = gl.createSampler();
    gl.samplerParameteri(this.smooth, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.smooth, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.smooth, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.smooth, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // shadow maps read through a comparing, filtering sampler (see shadowIn)
    this.shadowCompare = gl.createSampler();
    gl.samplerParameteri(this.shadowCompare, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.shadowCompare, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.shadowCompare, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.shadowCompare, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.shadowCompare, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.samplerParameteri(this.shadowCompare, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.quad = fullscreenTriangle(gl, this.postProg);
    this.glyphs = makeGlyphAtlas(gl);
    this.surfaceTable = surfaceTable(gl);
    // 'toon' (v3, printed) unless a page asks for the lit look
    this.style = opts.style || 'toon';
    // What the graphics chip is, for the stats readout — and on the kinds that
    // are usually the weak ones (integrated, mobile, software), start drawing
    // at three quarters of the resolution rather than waiting to find out the
    // hard way. adapt() still raises it if the machine turns out to keep up.
    // Pages that render single frames for comparison keep full size.
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (!opts.preserve && /Intel|UHD|Iris|HD Graphics|Mali|Adreno|PowerVR|llvmpipe|SwiftShader|Basic Render/i
      .test(this.gpuName)) this.renderScale = 0.75;
    this.cardAtlas = cardAtlas(gl);

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
    const want = Math.min(1.5, window.devicePixelRatio || 1);
    const capped = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, cw * ch));
    // and fewer still if this machine has shown it cannot keep up (see adapt)
    const dpr = Math.max(0.5, Math.max(1, Math.min(want, capped)) * (this.renderScale ?? 1));

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

  invalidate() { this.builtKey = null; this.settledKey = null; this.growKey = null; this.builtEnv = null; }

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
  get eyeFloor() { return this.eyeFloorAt ?? EYE_FLOOR; }

  /**
   * Where the camera is and what it is looking at, for a given framing.
   *
   * One place for it, because the render and the history inspector's hit
   * testing must agree to the pixel about where everything is.
   */
  lens(cam) {
    const aspect = this.w / this.h;
    // A real lens, far enough back that perspective is gentle: the reference
    // photographs are shot long, so the plant reads as depth rather than as a
    // wide-angle exaggeration.
    const fov = 0.30;
    const dist = (this.h / Math.max(0.05, cam.zoom)) / (2 * Math.tan(fov / 2));
    // The floor is a real surface with one side to it, and height above it is a
    // property of the set rather than a framing preference, so it is held here
    // rather than left to the caller. Below it the camera looks down instead.
    // and never under the ground it is standing over, which is not level
    // everywhere the camera goes
    const place = PLACES[(this.worldKind ?? 0) % PLACES.length] || PLACES[0];
    const eyeY = Math.max(cam.y, this.eyeFloor, groundAt(cam.x * CAM_X_DAMP, dist, place) + 60);
    const lookY = Math.max(cam.y, this.lookFloorAt ?? LOOK_FLOOR);
    const x = cam.x * CAM_X_DAMP;
    const eye = [x, eyeY, dist];
    const view = mat4.lookAt(eye, [x, lookY, 0], [0, 1, 0]);
    const proj = mat4.perspective(fov, aspect, dist * 0.05, farPlane(dist));
    return { eye, dist, view, proj, viewProj: mat4.multiply(proj, view) };
  }

  /** World point to screen pixels, for the history inspector. */
  project(cam, x, y, z = 0) {
    const vp = this.lens(cam).viewProj;
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
    // Two meshes: the settled sections, rebuilt only when one is added or
    // growth starts or stops; and the one growing, rebuilt every frame while it
    // grows (see buildPlant).
    const settledKey = plant.sections.length + ':' + (reveal ? reveal.step : '-');
    const growKey = reveal ? reveal.step + ':' + reveal.progress.toFixed(3) : '';
    if (this.settledKey !== settledKey) {
      this.settledKey = settledKey;
      this.growKey = null;
      disposeMesh(gl, this.plantMesh);
      const built = buildPlant(plant, reveal, reveal ? 'settled' : 'all');
      this.plantMesh = built.indices.length ? mesh(gl, this.sceneProg, built.data, built.indices, LAYOUT) : null;
      this.plantWide = built.wide;
    }
    if (this.growKey !== growKey) {
      this.growKey = growKey;
      disposeMesh(gl, this.growMesh);
      this.growMesh = null;
      if (reveal) {
        const built = buildPlant(plant, reveal, 'growing');
        this.growMesh = built.indices.length ? mesh(gl, this.sceneProg, built.data, built.indices, LAYOUT) : null;
        this.growWide = built.wide;
      }
    }
    this.builtKey = settledKey + '|' + growKey;
    // Keyed on what the camera can see, not only on where it is. A backdrop
    // sized from the plant alone left the world stopping short of the frame at
    // a wide window or a pulled-back zoom, with the void showing past its edges.
    setStyle(this.style);
    const envKey = this.style + ':' + env?.id + ':' + (this.worldKind ?? 0)
      + ':' + Math.round((view?.w || 0) / 400) + ':' + Math.round((view?.h || 0) / 400);
    if (this.builtEnv !== envKey) {
      disposeMesh(gl, this.backdropMesh);
      const built = buildBackdrop(env, view, this.worldKind ?? 0);
      this.backdropMesh = mesh(gl, this.sceneProg, built.data, built.indices, LAYOUT);
      this.backdropWide = built.wide;
      this.backdropCards = built.cardStart ?? built.indices.length;
      this.builtEnv = envKey;
    }
  }

  /**
   * The inks this place is printed in, and its sky through the day: its day
   * colour, its dusk colour on the way to night, and its night.
   */
  printUniforms(place) {
    const t = place.toon;
    if (!t) return { uToon: 0 };
    if (!this.inkCache || this.inkCache.id !== place.id) {
      this.inkCache = { id: place.id, inks: inkUniforms(t.inks) };
    }
    const n = this.nightness ?? 0;
    const [day, dusk, night] = t.sky.map(linear);
    const sky = n < 0.45 ? mixLinear(day, dusk, n / 0.45) : mixLinear(dusk, night, Math.min(1, (n - 0.45) / 0.4));
    const ink = this.inkCache.inks;
    return {
      uToon: this.style === 'real' ? 0 : 1,
      uInkRgb: ink.rgb, uInkLab: ink.lab, uInkN: ink.count,
      uPlantRgb: PLANT_UNIFORMS.rgb, uPlantLab: PLANT_UNIFORMS.lab, uPlantN: PLANT_UNIFORMS.count,
      uGroundFlat: linear(t.ground),
      uSkyFlat: sky,
      uFarFlat: linear(t.far || t.ground),
      uSunSpot: SUN_SPOT,
      uSunFlat: linear('#ffd24a'),
      uLineFlat: linear(INK),
      uInkTint: t.tint || [1, 1, 1],
      uPoolFlat: linear(t.pool || t.ground),
    };
  }

  /** The place's land beyond the built ground, as the sky shell shows it. */
  farLand(place) {
    if (place.farLand) return place.farLand;
    const g = place.ground || [0.2, 0.2, 0.2];
    return [g[0] * 0.35, g[1] * 0.35, g[2] * 0.35];
  }

  /**
   * Everything that moves — birds, fish, tumbleweed — where it is this frame.
   *
   * Placed afresh every frame and poured into the same buffers: a few thousand
   * vertices, which is nothing to refill and everything to getting them to move
   * like living things rather than orbit like a mobile (see movingAt).
   */
  drawMoving(gl, place, time, plant) {
    // where the flowers are, for whatever comes to them; worked out again only
    // when the plant has changed
    if (this.visitKey !== this.builtKey) {
      this.visitKey = this.builtKey;
      const blooms = [];
      for (const sec of plant?.sections || []) {
        for (const n of sec.nodes || []) if (n.kind !== 'leaf') blooms.push([n.x, n.y, n.z ?? 0]);
      }
      this.visits = { blooms, top: plant?.bounds?.maxY ?? 300 };
    }
    const built = movingAt(place, time * 0.001, this.visits);
    if (!built || !built.indices.length) return;
    if (!this.birdMesh || built.wide !== this.birdWide) {
      disposeMesh(gl, this.birdMesh);
      this.birdMesh = mesh(gl, this.sceneProg, built.data, built.indices, LAYOUT);
      this.birdWide = built.wide;
    } else {
      gl.bindVertexArray(this.birdMesh.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.birdMesh.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, built.data, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.birdMesh.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, built.indices, gl.DYNAMIC_DRAW);
      gl.bindVertexArray(null);
      this.birdMesh.count = built.indices.length;
    }
    this.drawMesh(gl, this.birdMesh, this.birdWide);
  }

  drawMesh(gl, m, wide, first = 0, count = m ? m.count - first : 0) {
    if (!m || count <= 0) return;
    gl.bindVertexArray(m.vao);
    gl.drawElements(gl.TRIANGLES, count,
      wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, first * (wide ? 4 : 2));
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

  /**
   * Draw fewer pixels on a machine that cannot keep up.
   *
   * The time between frames is the honest measure of whether it can: when the
   * graphics card is the bottleneck, frames come further apart. Held over a
   * second or two, a slow average takes the resolution down a step, and a fast
   * one lets it back up — but never back to a size that has already proved too
   * much, or it would see-saw. Pages that render single frames, like the field
   * guide and the tests, pass the same time or jump it and are left alone.
   */
  adapt(time) {
    const dt = this.lastTime === undefined ? 0 : time - this.lastTime;
    this.lastTime = time;
    if (!(dt > 2 && dt < 250) || this.fixedScale) return;
    this.frameMs = this.frameMs === undefined ? dt : this.frameMs * 0.94 + dt * 0.06;
    this.sinceScale = (this.sinceScale || 0) + dt;
    if (this.sinceScale < 2000) return;
    const scale = this.renderScale ?? 1;
    let next = scale;
    if (this.frameMs > 26 && scale > 0.6) {
      next = Math.max(0.6, scale - 0.15);
      this.scaleCeiling = Math.max(0.6, scale - 0.05);
    } else if (this.frameMs < 17.5 && scale < (this.scaleCeiling ?? 1)) {
      next = Math.min(this.scaleCeiling ?? 1, scale + 0.1);
    }
    if (next !== scale) {
      this.renderScale = next;
      this.sinceScale = 0;
    }
  }

  render(plant, cam, time, sections, reveal = null) {
    const gl = this.gl;
    this.adapt(time);
    this.resize();

    // Where the light comes from depends on where you are. Out in the open it is
    // the sun, low and to one side. In a cave the only light is what falls
    // through the break in the roof, which is overhead — and with the world now
    // casting shadows, a sun coming in low from the side lit nothing in a cave at
    // all: it met rock. Under water it comes down through the surface.
    const place = PLACES[(this.worldKind ?? 0) % PLACES.length] || {};
    // and the sun goes lower as the evening comes on, so the shadows lengthen
    const dusk = duskOf(this.nightness ?? 0);
    const SUN = place.sun ? norm3(place.sun)
      : norm3([LIGHT_DIR[0], LIGHT_DIR[1] * (1 - dusk * 0.4), LIGHT_DIR[2]]);

    const env = dominantEnv(buildBands(sections), cam.y - 600, cam.y + 600);
    // how much world the camera actually covers at this zoom and shape
    const seenH = this.h / Math.max(0.05, cam.zoom);
    this.ensureMeshes(plant, env, reveal, cam.y, {
      w: seenH * (this.w / Math.max(1, this.h)),
      h: seenH,
    });

    // ---- camera ----
    const { eye, dist, viewProj } = this.lens(cam);

    // ---- light ----
    const span = 1500;
    const centre = [cam.x * CAM_X_DAMP, cam.y, -150];
    const lightEye = [
      centre[0] + SUN[0] * 2200,
      centre[1] + SUN[1] * 2200,
      centre[2] + SUN[2] * 2200,
    ];
    const lightView = mat4.lookAt(lightEye, centre, [0, 1, 0]);
    const lightProj = mat4.ortho(-span, span, -span, span, 200, 5200);
    const lightViewProj = mat4.multiply(lightProj, lightView);

    // The wide map: centred on the ground the camera is looking across, not on
    // the plant, and large enough to hold everything out to the horizon.
    const farSpan = 16000;
    // It moves in steps rather than with every pixel of camera travel: it has
    // to be redrawn whenever it moves, and a map that slides by a fraction of a
    // texel each frame makes every shadow edge crawl.
    const farX = Math.round(cam.x * CAM_X_DAMP / 2000) * 2000;
    const farCentre = [farX, 0, -7000];
    const farEye = [
      farCentre[0] + SUN[0] * 45000,
      farCentre[1] + SUN[1] * 45000,
      farCentre[2] + SUN[2] * 45000,
    ];
    const lightViewProjFar = mat4.multiply(
      mat4.ortho(-farSpan, farSpan, -farSpan, farSpan, 1000, 95000),
      mat4.lookAt(farEye, farCentre, [0, 1, 0]));

    // ---- shadow passes ----
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.depthProg.p);
    // The wide map holds only the world, and the world does not move — what
    // does move is left out of shadow maps anyway — so it is drawn when the
    // world, the sun or the map's own position changes and kept otherwise. In
    // the forest, half a million vertices of trees drawn into it every frame
    // was a quarter of the frame. The plant is in the tight map, which follows
    // it; out at the scale of the wide one it is a few texels.
    // The tight map holds the plant alone. It is redrawn every frame because
    // it follows the camera, and drawing the whole world into it — a quarter of
    // a million vertices in the forest — bought nothing the wide map (which
    // holds the world, and is kept) did not already give.
    const passes = [[this.shadow, lightViewProj, true, false]];
    // The plant is in it too, redrawn when the plant gains a section: its long
    // shadow across the land, in the evening especially, is what ties it to
    // the ground it stands on. (Left out, it had none beyond the tight map.)
    const farKey = [this.builtEnv, this.worldOff, SUN.map((v) => v.toFixed(2)).join(','), farX,
      sections ? sections.length : 0, this.castShadowsOff].join('|');
    if (farKey !== this.farKey) {
      passes.push([this.shadowFar, lightViewProjFar, true, true]);
      this.farKey = farKey;
    }
    // In print nothing casts: the picture is flat ink, and both passes go.
    if (this.style !== 'real') passes.length = 0;
    for (const [target, vp, withPlant, withWorld] of passes) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.size, target.size);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      setUniforms(gl, this.depthProg, { uLightViewProj: vp, uCardAtlas: this.cardAtlas });
      if (withPlant && !this.castShadowsOff) {
        this.drawMesh(gl, this.plantMesh, this.plantWide);
        this.drawMesh(gl, this.growMesh, this.growWide);
      }
      if (withWorld && !this.worldOff) this.drawMesh(gl, this.backdropMesh, this.backdropWide);
    }

    // ---- scene pass ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdr.fbo);
    gl.viewport(0, 0, this.pw, this.ph);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.sceneProg.p);

    const night = this.nightness ?? 0;
    const dim = (c, k, tint) => c.map((v, i) => v * (1 - night * k) + night * tint[i]);
    // Through gold on the way to night, rather than straight down to it.
    const sun = env.dark ? dim([1.9, 1.95, 2.2], 0.94, [0.10, 0.12, 0.22]) : sunThrough(night);
    // The fill. Outdoors the sky puts down a fifth of what the sun does, from
    // every direction at once; this had it at a twentieth, which only went
    // unnoticed because a sun behind the camera left nothing in shade. Lit from
    // the side, a shadow side that dark reads as a hole.
    // Nearly neutral. Skylight is blue, but a blue fill on anything green or
    // warm reads as grey once the curve has had it, and most of this world is
    // green or warm.
    const sky = dim(env.dark ? [0.09, 0.11, 0.17] : [0.33, 0.36, 0.41], 0.72, [0.05, 0.06, 0.13]);
    // and the air's own look stays where it was
    const air = dim(env.dark ? [0.06, 0.075, 0.12] : [0.20, 0.22, 0.26], 0.72, [0.05, 0.06, 0.13]);
    const ground = dim(env.dark ? [0.035, 0.035, 0.045] : [0.19, 0.165, 0.13], 0.80,
      [0.012, 0.013, 0.022]);
    const sceneUniforms = {
      uViewProj: viewProj,
      uLightViewProj: lightViewProj,
      uLightViewProjFar: lightViewProjFar,
      uShadowFar: { tex: this.shadowFar.depth, sampler: this.shadowCompare },
      uSurfaceTable: this.surfaceTable,
      uCardAtlas: this.cardAtlas,
      uReliefTaps: 3,
      ...this.printUniforms(place),
      uFarLand: this.farLand(place),
      uLightDir: SUN,
      uEye: eye,
      uSunColour: sun,
      uSkyColour: sky,
      uAirColour: air,
      uHazeTint: PLACES[(this.worldKind ?? 0) % PLACES.length]?.haze || [1, 1, 1],
      uGroundColour: ground,
      uShadow: { tex: this.shadow.depth, sampler: this.shadowCompare },
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
    };
    setUniforms(gl, this.sceneProg, sceneUniforms);
    // The world can be left out, the way shadows can. A screen idiom takes its
    // contrast from whatever is behind it — that is how a mark stays visible on
    // any ground — so measuring how much ink a glyph lays down means measuring
    // it against a constant field. Against a landscape the same glyph reads as
    // more or less ink depending on what it happens to be covering.
    if (!this.worldOff) {
      // the solid world first, so that the cards behind it are never shaded
      this.drawMesh(gl, this.backdropMesh, this.backdropWide, 0, this.backdropCards);
      this.drawMoving(gl, place, time, plant);
      if (!this.cardsOff && this.backdropMesh && this.backdropCards < this.backdropMesh.count) {
        gl.useProgram(this.cardProg.p);
        setUniforms(gl, this.cardProg, sceneUniforms);
        this.drawMesh(gl, this.backdropMesh, this.backdropWide, this.backdropCards);
        gl.useProgram(this.sceneProg.p);
        // Texture units are shared state, and the card program has one texture
        // more than this one, so its bindings sit in different slots. Left as
        // they were, the plant read the relief table as its shadow map.
        setUniforms(gl, this.sceneProg, sceneUniforms);
      }
    }

    // Keep the backdrop before the plant covers it. The idioms that describe
    // tone by how much ink lands need to know what is behind them: without it
    // the only thing they can leave in the gaps is a white fill, which reads as
    // a sticker laid on the scene rather than as a drawing of the plant.
    // Only when something drawn is on screen: it is a copy of the whole frame,
    // and nothing else ever reads it.
    // (printed, nothing takes the drawn path: see the print block in SCENE_FS)
    const drawn = this.style === 'real' && ((this.worldIdiom ?? 0) > 0
      || (sections || []).some((sec) => (MAT_ID[sec.materialId] ?? 0) >= 40));
    if (drawn) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.hdr.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.bg.fbo);
      gl.blitFramebuffer(0, 0, this.pw, this.ph, 0, 0, this.pw, this.ph,
        gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdr.fbo);
    }

    this.drawMesh(gl, this.plantMesh, this.plantWide);
    this.drawMesh(gl, this.growMesh, this.growWide);

    // ---- camera pass ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.pw, this.ph);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.postProg.p);
    setUniforms(gl, this.postProg, {
      uScene: this.hdr.colour,
      uBackdrop: this.bg.colour,
      uSceneSmooth: { tex: this.hdr.colour, sampler: this.smooth },
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
      uTonemap: this.tonemap ?? 1,
      uToon: this.style === 'real' ? 0 : 1,
      uInk: linear(INK),
      uGradeShadow: this.gradeOff ? [1, 1, 1] : place.grade?.shadows || [1, 1, 1],
      uGradeLight: this.gradeOff ? [1, 1, 1] : place.grade?.lights || [1, 1, 1],
      uGradeTone: this.gradeOff ? [0, 1] : [place.grade?.black ?? 0, place.grade?.contrast ?? 1],
    });
    gl.bindVertexArray(this.quad.vao);
    gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0);

    gl.bindVertexArray(null);

    return env;
  }
}

export { ENVIRONMENTS, ENV_BY_ID };
