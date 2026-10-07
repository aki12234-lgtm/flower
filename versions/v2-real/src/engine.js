// The engine: one turn of the game, with no rendering in it.
//
// Keeping this free of the DOM is what lets tools/simulate.js run thousands of
// playthroughs headlessly to check that different answer sequences really do
// produce different organisms.

import { makeRng, hashString, clamp01 } from './rng.js';
import { ValueState, resolveEffects } from './values.js';
import { PROMPTS_BY_ID, pickPrompt } from './prompts.js';
import { createPlant, seedPlant, growSection, growthParams, measureStructure } from './growth.js';
import { createVitality, stepVitality, conditionNote } from './vitality.js';
import { chooseMaterial, MATERIAL_BY_ID } from './materials.js';
import { chooseEnvironment, ENV_BY_ID } from './environment.js';

export const SAVE_KEY = 'flower.save.v1';
export const ARCHIVE_KEY = 'flower.archive.v1';

export class Engine {
  /**
   * Two independent random streams.
   *
   * `rng` is the script: which prompt is asked, when the material changes, when
   * the scene changes. `growthRng` is the hand: the wander in a stem, where a
   * branch lands. Keeping them apart means re-rolling the geometry never
   * changes the questions, which is what makes it possible to measure how much
   * of a plant's shape comes from the answers and how much from luck.
   */
  constructor(seed = String(Date.now()), growthSeed = null) {
    this.seed = String(seed);
    this.growthSeed = String(growthSeed ?? seed);
    this.rng = makeRng(this.seed + ':script');
    this.growthRng = makeRng(this.growthSeed + ':growth');
    this.values = new ValueState();
    this.plant = createPlant();
    this.vit = createVitality();
    this.history = [];
    this.scene = {
      materialId: 'botanical', matHold: 0, matRecent: ['botanical'],
      envId: 'soil', envHold: 0, envRecent: ['soil'],
    };
    this.finished = false;
    this.ending = null;      // 'voluntary' | 'natural' | 'grounded'
    this.archive = null;     // { name, reflection }
    this.lastNote = null;
    this.prompt = null;
  }

  start() {
    const seed = seedPlant(this.plant, this.growthRng);
    seed.baseHue = this.plant.baseHue;
    seed.materialId = this.scene.materialId;
    seed.envId = this.scene.envId;
    seed.vitality = 1;
    seed.condition = 'healthy';
    seed.values = { ...this.values.values };
    this.nextPrompt();
    return seed;
  }

  nextPrompt() {
    this.prompt = this.finished ? null : pickPrompt(this.rng, this.history);
    return this.prompt;
  }

  get step() { return this.plant.sections.length; }

  /**
   * Apply a response and grow one section.
   * @param {object} response { index } for binary/quad, { t } for slider/action
   */
  answer(response) {
    if (this.finished || !this.prompt) return null;
    const prompt = this.prompt;

    let effects;
    let label;
    let detail = null;
    let t = null;

    if (prompt.type === 'binary' || prompt.type === 'quad') {
      const opt = prompt.options[response.index];
      effects = resolveEffects(opt.effects);
      label = opt.label;
    } else if (prompt.type === 'slider') {
      t = clamp01(response.t);
      effects = resolveEffects(prompt.effects, t);
      label = t < 0.2 ? prompt.poles[0] : t > 0.8 ? prompt.poles[1]
        : t < 0.45 ? `towards ${prompt.poles[0].toLowerCase()}`
        : t > 0.55 ? `towards ${prompt.poles[1].toLowerCase()}` : 'in the middle';
      detail = { poles: prompt.poles, t };
    } else {
      t = clamp01(response.t);
      effects = resolveEffects(prompt.effects, t);
      label = describeAction(prompt.action, t, response);
      detail = { kind: prompt.action.kind, t, raw: response.raw ?? null };
    }

    // How far this one answer moved things, before and after.
    //
    // The material used to change on a timer: hold for a few turns, then roll
    // against a chance that climbed with how long it had been held. That makes
    // the switch a property of the clock rather than of anything the player
    // did, and it is meant to be the organism reacting to an answer. The size
    // of the shift is now what drives it.
    const wasValues = { ...this.values.values };
    this.values.apply(effects);
    const derived = this.values.derived();
    const values = this.values.values;
    let shift = 0;
    for (const k of Object.keys(values)) shift += Math.abs(values[k] - wasValues[k]);

    // Material and environment are chosen independently, from different reads
    // of the same state, and both are sticky.
    const nextMat = chooseMaterial(this.rng, values, derived, this.scene, shift);
    if (nextMat !== this.scene.materialId) {
      this.scene.materialId = nextMat;
      this.scene.matHold = 0;
      this.scene.matRecent.push(nextMat);
    } else this.scene.matHold++;

    const nextEnv = chooseEnvironment(this.rng, values, derived, this.scene);
    if (nextEnv !== this.scene.envId) {
      this.scene.envId = nextEnv;
      this.scene.envHold = 0;
      this.scene.envRecent.push(nextEnv);
    } else this.scene.envHold++;

    const params = growthParams(values, derived, this.vit.vitality, measureStructure(this.plant));
    const section = growSection(this.plant, params, this.growthRng, {
      promptId: prompt.id,
      promptText: prompt.text,
      type: prompt.type,
      tone: prompt.tone,
      responseLabel: label,
      responseDetail: detail,
      t,
      values: { ...values },
      materialId: this.scene.materialId,
      envId: this.scene.envId,
      baseHue: this.plant.baseHue,
    });

    const struct = measureStructure(this.plant);
    const before = this.vit.condition;
    stepVitality(this.vit, struct, derived);
    section.vitality = this.vit.vitality;
    section.condition = this.vit.condition;

    this.lastNote = conditionNote(before, this.vit.condition);
    this.history.push({
      step: section.step,
      promptId: prompt.id,
      type: prompt.type,
      tone: prompt.tone,
      label,
      t,
      vitality: this.vit.vitality,
    });

    if (this.vit.dead) {
      this.finished = true;
      this.ending = 'natural';
      this.prompt = null;
    } else if (this.plant.grounded) {
      // It has come back down to the floor it started from. There is nowhere
      // further for it to go, so the life is over — the same as dying, arrived
      // at by a different road.
      this.finished = true;
      this.ending = 'grounded';
      this.prompt = null;
    } else {
      this.nextPrompt();
    }

    return { section, note: this.lastNote, condition: this.vit.condition, struct };
  }

  /** The player decides the plant is complete. */
  finish(reason = 'voluntary') {
    if (this.finished) return;
    this.finished = true;
    this.ending = reason;
    this.prompt = null;
  }

  canFinish() { return !this.finished && this.step >= 4; }

  stats() {
    const struct = measureStructure(this.plant);
    const mats = new Set();
    const envs = new Set();
    for (const s of this.plant.sections) {
      if (s.materialId) mats.add(s.materialId);
      if (s.envId) envs.add(s.envId);
    }
    return {
      step: this.step,
      age: this.history.length,
      height: struct.height,
      length: struct.length,
      mass: struct.mass,
      spread: this.plant.bounds.maxX - this.plant.bounds.minX,
      tips: struct.tipCount,
      sections: this.plant.sections.length,
      materials: [...mats],
      environments: [...envs],
      materialNames: [...mats].map((m) => MATERIAL_BY_ID[m]?.name ?? m),
      environmentNames: [...envs].map((e) => ENV_BY_ID[e]?.name ?? e),
      condition: this.vit.condition,
      vitality: this.vit.vitality,
      ending: this.ending,
    };
  }

  // ------------------------------------------------------------------ save --

  toJSON() {
    return {
      v: 1,
      seed: this.seed,
      growthSeed: this.growthSeed,
      values: this.values.toJSON(),
      plant: this.plant,
      vit: this.vit,
      history: this.history,
      scene: this.scene,
      finished: this.finished,
      ending: this.ending,
      archive: this.archive,
      promptId: this.prompt?.id ?? null,
    };
  }

  static fromJSON(data) {
    const e = new Engine(data.seed, data.growthSeed ?? data.seed);
    e.values = ValueState.fromJSON(data.values);
    e.plant = data.plant;
    e.vit = data.vit;
    e.history = data.history;
    e.scene = data.scene;
    e.finished = data.finished;
    e.ending = data.ending;
    e.archive = data.archive;
    // How far along each random stream was is not stored, so both are reseeded
    // from the seed plus the answers given so far. That is still deterministic
    // for this save — reloading twice continues identically — it just does not
    // reproduce the stream an uninterrupted session would have had.
    const played = data.history.map((h) => h.promptId + ':' + h.label).join('|');
    e.rng = makeRng(hashString(e.seed + ':script|' + played));
    e.growthRng = makeRng(hashString(e.growthSeed + ':growth|' + played));
    e.prompt = data.promptId ? PROMPTS_BY_ID[data.promptId] : (data.finished ? null : e.nextPrompt());
    return e;
  }
}

function describeAction(action, t, response) {
  switch (action.kind) {
    case 'hold': {
      const secs = response.raw?.seconds ?? (action.min + t * (action.max - action.min));
      return `held ${secs.toFixed(1)}s`;
    }
    case 'drag':
      return t < 0.15 ? 'barely moved it' : t > 0.85 ? 'as far as it would go' : `moved it ${Math.round(t * 100)}%`;
    case 'scale':
      return t < 0.2 ? 'made it small' : t > 0.8 ? 'made it large' : `sized it ${Math.round(t * 100)}%`;
    case 'rotate':
      return `turned it ${Math.round(t * (action.turns ?? 1) * 360)}°`;
    case 'place':
      return t < 0.2 ? action.poles[0].toLowerCase() : t > 0.8 ? action.poles[1].toLowerCase() : 'somewhere between';
    default:
      return 'responded';
  }
}
