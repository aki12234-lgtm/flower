// Cultivar names.
//
// At the end of a game the plant is offered a name in the botanical form for a
// cultivated variety: *Genus* 'Cultivar Name'. The player can keep it, change
// it or write their own (see docs/meaning.md).
//
//   genus     from the two strongest hidden values at the end. Fifteen pairs,
//             fifteen genera, plus one for a plant where nothing pulled harder
//             than the rest. The same genus always means the same tendency.
//   cultivar  from particular answers, so every word can be traced back to
//             something the player chose:
//               adjective  the turning point, the answer that went most
//                          against the direction things had been moving; or a
//                          word of steadiness when there was no real turn
//               noun       the first answer, where the journey started
//               closing    in games of 12 answers or more, the season the
//                          journey ended in: at Noon, in Bloom, at Harvest,
//                          at Dusk
//
// Nothing here is random. The same history always gives the same name, and
// the name never feeds back into the game.

import { PROMPTS_BY_ID, seasonAt } from './prompts.js';
import { VALUE_KEYS } from './values.js';

// ------------------------------------------------------------------ genera --

// Keyed by the two values, alphabetical, joined with '+'.
export const GENERA = {
  'expansion+stability': { name: 'Peregrina', gloss: 'travels far on a steady root' },
  'expansion+openness': { name: 'Vagantha', gloss: 'wanders, and opens as it goes' },
  'attachment+expansion': { name: 'Tendrilla', gloss: 'reaches out, and holds on to what it reaches' },
  'expansion+intensity': { name: 'Flagrantha', gloss: 'reaches, and burns while it does' },
  'expansion+order': { name: 'Scalaria', gloss: 'climbs outward one deliberate step at a time' },
  'openness+stability': { name: 'Serenella', gloss: 'stays open without being shaken' },
  'attachment+stability': { name: 'Tenaxia', gloss: 'holds on, and holds steady' },
  'intensity+stability': { name: 'Focaria', gloss: 'a hearth: a strong fire kept in one place' },
  'order+stability': { name: 'Lapidaria', gloss: 'set like stone, and just as careful' },
  'attachment+openness': { name: 'Amplexia', gloss: 'opens its arms, and keeps what comes in' },
  'intensity+openness': { name: 'Luminaria', gloss: 'lets everything in, and feels all of it' },
  'openness+order': { name: 'Fenestria', gloss: 'a window: open, but inside a frame' },
  'attachment+intensity': { name: 'Cordatia', gloss: 'heart-shaped, and holds hard to what it loves' },
  'attachment+order': { name: 'Custodia', gloss: 'a keeper of things, each in its place' },
  'intensity+order': { name: 'Fabria', gloss: 'a smith: heat, given a shape' },
};
export const BALANCED_GENUS = { name: 'Aequalia', gloss: 'nothing in it pulled harder than the rest' };
const BALANCED_BELOW = 0.6; // the strongest value has to reach this to lead

// -------------------------------------------------------------- word banks --

// Per prompt, per option: [adjective, noun]. For sliders and actions the three
// entries are the low end, the middle and the high end of the response.
// Nouns are single words that read both on their own and after "of".
export const WORDS = {
  // binary
  'understand': [['Knowing', 'Lantern'], ['Unclasped', 'Release']],
  'owed': [['Beholden', 'Ledger'], ['Vanished', 'Husk']],
  'ends-well': [['Finished', 'Coda'], ['Onward', 'Echo']],
  'door-warm': [['Open', 'Doorway'], ['Sheltered', 'Ember']],
  'repeat-refuse': [['Returning', 'Refrain'], ['Refusing', 'Flint']],
  'unremembered': [['Unforgetting', 'Imprint'], ['Passing', 'Breath']],
  'known': [['Devoted', 'Confidant'], ['Wide', 'Chorus']],
  'silence': [['Hushed', 'Stillness'], ['Overtaken', 'Snowfall']],
  'grief': [['Mended', 'Stitch'], ['Shifting', 'Tide']],
  'choose-wrongly': [['Daring', 'Crossroad'], ['Undecided', 'Fork']],
  'self-built': [['Discovered', 'Seed'], ['Forged', 'Frame']],
  'return-place': [['Wandering', 'Visitor'], ['Haunted', 'Homecoming']],
  'outlive': [['Lasting', 'Monument'], ['Gentle', 'Kindness']],
  'forgetting': [['Mourning', 'Keepsake'], ['Merciful', 'Rain']],
  'belong': [['Native', 'Root'], ['Chosen', 'Compass']],
  'waiting-staying': [['Patient', 'Vigil'], ['Staying', 'Harbour']],
  'changed-preserved': [['Changed', 'Flame'], ['Preserved', 'Amber']],
  'light-room': [['Warm', 'Lamp'], ['Pale', 'Frost']],
  'facing': [['Turned', 'Wall'], ['Watchful', 'Room']],
  'finish-books': [['Steadfast', 'Chapter'], ['Restless', 'Margin']],
  'first-rule': [['Faithful', 'Covenant'], ['Wayward', 'Fence']],
  'happiest-child': [['Solitary', 'Treehouse'], ['Twinned', 'Playmate']],
  'proud-unseen': [['Secret', 'Crown'], ['Applauded', 'Mirror']],
  'forgive-first': [['Proud', 'Gate'], ['Forgiving', 'Olive']],
  'fair-kind': [['Even', 'Scales'], ['Tender', 'Blanket']],
  'plant-or-sit': [['Sowing', 'Sapling'], ['Shaded', 'Canopy']],
  'give-or-given': [['Gifted', 'Parcel'], ['Generous', 'Harvest']],
  'want-more-less': [['Content', 'Bowl'], ['Hungry', 'Appetite']],
  'relief-said': [['Guarded', 'Sigh'], ['Spoken', 'Bell']],
  'window-aisle': [['Gazing', 'Cloud'], ['Ready', 'Passage']],
  'caught-rain': [['Hurried', 'Shower'], ['Unhurried', 'Downpour']],
  'best-bite': [['Saving', 'Sweetness'], ['Eager', 'Plum']],
  'sing-alone': [['Singing', 'Lark'], ['Silent', 'Kitchen']],

  // quad
  'stays-longest': [['Vivid', 'Photograph'], ['Aching', 'Pulse'], ['Worn', 'Groove'], ['Hollow', 'Absence']],
  'person-lives': [['Embodied', 'Bone'], ['Diligent', 'Workbench'], ['Remembered', 'Portrait'], ['Present', 'Hour']],
  'promise': [['Anxious', 'Tremor'], ['Hopeful', 'Dawn'], ['Habitual', 'Ritual'], ['Indebted', 'Bond']],
  'notice-first': [['Named', 'Signet'], ['Inked', 'Script'], ['Ravenous', 'Feast'], ['Fraying', 'Thread']],
  'never-open': [['Bolted', 'Key'], ['Ajar', 'Hinge'], ['Cleared', 'Doorframe'], ['Forgotten', 'Door']],
  'carry-out': [['Ancestral', 'Heirloom'], ['Unfinished', 'Draft'], ['Given', 'Locket'], ['Unburdened', 'Smoke']],
  'time-is': [['Flowing', 'River'], ['Still', 'Chamber'], ['Owing', 'Clock'], ['Whispered', 'Rumour']],
  'what-you-trust': [['Instinctive', 'Heartbeat'], ['Patterned', 'Lattice'], ['Trusting', 'Stranger'], ['Lingering', 'Dusk']],
  'survives-translation': [['Rhythmic', 'Drum'], ['Meant', 'Word'], ['Errant', 'Stray'], ['Untranslated', 'Silence']],
  'keep-too-long': [['Kept', 'Letter'], ['Bitter', 'Thorn'], ['Planned', 'Map'], ['Clinging', 'Latch']],
  'morning-sound': [['Early', 'Birdsong'], ['Urban', 'Street'], ['Homely', 'Kettle'], ['Soundless', 'Fog']],
  'taught-unsaid': [['Careful', 'Glass'], ['Useful', 'Trowel'], ['Quiet', 'Moth'], ['Brave', 'Banner']],
  'open-unknown': [['Sealed', 'Envelope'], ['Prying', 'Postmark'], ['Curious', 'Drawer'], ['Dreaming', 'Moonrise']],
  'anger-for': [['Fierce', 'Shield'], ['Burning', 'Furnace'], ['Unarmed', 'Stone'], ['Smouldering', 'Riddle']],
  'laugh-with': [['Old', 'Friend'], ['Sudden', 'Meeting'], ['Playful', 'Kite'], ['Wry', 'Grin']],
  'like-to-make': [['Homeward', 'Hearth'], ['Handy', 'Hammer'], ['Lyric', 'Song'], ['Kind', 'Afternoon']],
  'still-delights': [['Glad', 'Company'], ['Skilled', 'Craft'], ['Windswept', 'Weather'], ['Startled', 'Surprise']],
  'carry-name': [['Rooted', 'Village'], ['Inherited', 'Habit'], ['Bright', 'Idea'], ['Anonymous', 'Mist']],
  'outgrown-fits': [['Outgrown', 'Companion'], ['Fearless', 'Nightlight'], ['Beloved', 'Cradle'], ['Renamed', 'Nickname']],
  'in-pocket': [['Jangling', 'Keys'], ['Pocketed', 'Pebble'], ['Weightless', 'Feather'], ['Absent', 'Pocket']],

  // slider: low, middle, high
  'past-carry': [['Clean', 'Slate'], ['Balanced', 'Satchel'], ['Laden', 'Archive']],
  'above-ground': [['Grounded', 'Soil'], ['Hovering', 'Hill'], ['Soaring', 'Summit']],
  'let-seen': [['Veiled', 'Veil'], ['Half-lit', 'Porch'], ['Bare', 'Daylight']],
  'order-alive': [['Wild', 'Bramble'], ['Tended', 'Garden'], ['Ordered', 'Grid']],
  'mourned': [['Brief', 'Candle'], ['Remembering', 'Anniversary'], ['Eternal', 'Elegy']],
  'wanting-having': [['Practical', 'Pantry'], ['Wishful', 'Wishbone'], ['Longing', 'Daydream']],
  'believe-chose': [['Handed-down', 'Creed'], ['Questioning', 'Crossing'], ['Self-made', 'Manifesto']],
  'affection-distance': [['Close', 'Embrace'], ['Measured', 'Bridge'], ['Distant', 'Star']],
  'fill-glass': [['Sparing', 'Sip'], ['Moderate', 'Cup'], ['Brimming', 'Brim']],
  'voice-borrowed': [['Own', 'Voice'], ['Blended', 'Harmony'], ['Borrowed', 'Accent']],
  'good-at-one': [['Many-sided', 'Prism'], ['Studied', 'Apprentice'], ['Single-minded', 'Needle']],
  'how-much-enough': [['Modest', 'Crumb'], ['Sufficient', 'Loaf'], ['Insatiable', 'Ocean']],
  'give-knowing': [['Secretive', 'Vault'], ['Sharing', 'Lesson'], ['Open-handed', 'Library']],
  'see-sky': [['Enclosed', 'Ceiling'], ['Glimpsed', 'Skylight'], ['Open-skied', 'Sky']],

  // action: low, middle, high
  'hold-worth': [['Quick', 'Blossom'], ['Holding', 'Rope'], ['Enduring', 'Anchor']],
  'far-enough': [['Near', 'Doorstep'], ['Distanced', 'Orchard'], ['Faraway', 'Horizon']],
  'actual-size': [['Small', 'Acorn'], ['True', 'Measure'], ['Towering', 'Mountain']],
  'face-you': [['Averted', 'Profile'], ['Turning', 'Weathervane'], ['Facing', 'Gaze']],
  'where-belongs': [['Buried', 'Bulb'], ['Half-buried', 'Threshold'], ['Unhidden', 'Clearing']],
  'until-certain': [['Doubting', 'Question'], ['Wavering', 'Pendulum'], ['Certain', 'Anvil']],
  'pull-apart': [['Entwined', 'Knot'], ['Parting', 'Seam'], ['Severed', 'Distance']],
  'room-for': [['Crowded', 'Nest'], ['Expectant', 'Vase'], ['Spacious', 'Meadow']],
  'wind-back': [['Accepting', 'Daybreak'], ['Rewound', 'Reel'], ['Nostalgic', 'Clockwork']],
  'first-afraid': [['Diminished', 'Shadow'], ['Wary', 'Cellar'], ['Looming', 'Giant']],
  'hand-out': [['Withdrawn', 'Glove'], ['Offering', 'Palm'], ['Welcoming', 'Welcome']],
  'give-away-size': [['Frugal', 'Coin'], ['Fair', 'Portion'], ['Lavish', 'Bounty']],
  'open-curtain': [['Shuttered', 'Shade'], ['Parted', 'Curtain'], ['Sunlit', 'Morning']],
};

// For a journey without a real turning point. Picked by the answers, not luck.
export const STEADY_WORDS = [
  'Steady', 'Constant', 'Evergreen', 'Unwavering', 'Perennial', 'Level', 'Even-keeled', 'Abiding',
  'Unhurried', 'Enduring', 'Settled', 'Loyal', 'Patient', 'Unbending', 'Rooted', 'Sure',
];

// How hard an answer has to go against the recent direction to count as a
// turn, in value units. Set from tools/names.js so that roughly one game in
// five reads as steady.
export const TURN_THRESHOLD = 0.035;
const TREND_WINDOW = 4;
const LONG_GAME = 12;

// Where the journey ended, for long games. Roots never closes a long game.
export const CLOSINGS = {
  reaching: 'at Noon',
  opening: 'in Bloom',
  giving: 'at Harvest',
  shedding: 'at Dusk',
};

// ----------------------------------------------------------------- reading --

/** The [adjective, noun] pair for one history entry, or null. */
export function wordsFor(entry) {
  const bank = WORDS[entry.promptId];
  const prompt = PROMPTS_BY_ID[entry.promptId];
  if (!bank || !prompt) return null;
  if (prompt.options) {
    const i = prompt.options.findIndex((o) => o.label === entry.label);
    return i >= 0 ? bank[i] : null;
  }
  // A slider's middle is as narrow as the label engine.js gives it ("in the
  // middle"), so the word never contradicts what the player was told. Actions
  // have no such label and are split in thirds.
  const t = entry.t ?? 0.5;
  const [lo, hi] = prompt.type === 'slider' ? [0.45, 0.55] : [1 / 3, 2 / 3];
  return bank[t < lo ? 0 : t > hi ? 2 : 1];
}

/** The genus for a set of final values. */
export function genusFor(values) {
  const ranked = VALUE_KEYS.map((k) => [k, values[k] ?? 0.5]).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] < BALANCED_BELOW) return { ...BALANCED_GENUS, keys: [] };
  const keys = [ranked[0][0], ranked[1][0]];
  return { ...GENERA[[...keys].sort().join('+')], keys };
}

/**
 * The turning point: the answer that pushed hardest against the way the values
 * had been moving over the few answers before it. Returns { index, score }, or
 * null when nothing went against the grain by more than TURN_THRESHOLD.
 */
export function findTurn(log, deltaLog, threshold = TURN_THRESHOLD) {
  let best = null;
  for (let i = 3; i < deltaLog.length; i++) {
    const from = log[Math.max(0, i - TREND_WINDOW)];
    const to = log[i];
    let len = 0;
    for (const k of VALUE_KEYS) len += (to[k] - from[k]) ** 2;
    len = Math.sqrt(len);
    if (len < 1e-6) continue;
    let against = 0;
    for (const k of VALUE_KEYS) against -= (deltaLog[i].applied[k] || 0) * (to[k] - from[k]);
    const score = against / len;
    if (!best || score > best.score) best = { index: i, score };
  }
  return best && best.score > threshold ? best : null;
}

/**
 * The name for a game. Takes the engine, or anything with `history` and a
 * `values` ValueState. Returns the pieces as well as the text, because the
 * journey text needs to say where each word came from.
 */
export function cultivarName(engine) {
  const history = engine.history;
  const { values, log, deltaLog } = engine.values;
  const genus = genusFor(values);
  if (!history.length) return { genus, epithet: null, text: genus.name, moments: {} };

  const moment = (index, role) => {
    const words = wordsFor(history[index]);
    return words ? { role, index, promptId: history[index].promptId, label: history[index].label, words } : null;
  };

  // The first answer that has words at all; normally the very first.
  let start = null;
  for (let i = 0; i < history.length && !start; i++) start = moment(i, 'start');

  const turnAt = findTurn(log, deltaLog);
  const turn = turnAt ? moment(turnAt.index, 'turn') : null;

  let adjective;
  if (turn) adjective = turn.words[0];
  else {
    const key = history.map((h) => h.promptId + ':' + h.label).join('|');
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    adjective = STEADY_WORDS[h % STEADY_WORDS.length];
  }

  const noun = start ? start.words[1] : 'Seed';
  let epithet = `${adjective} ${noun}`;
  const closing = history.length >= LONG_GAME ? CLOSINGS[seasonAt(history.length - 1)] : null;
  if (closing) epithet += ` ${closing}`;

  return {
    genus,
    epithet,
    text: `${genus.name} '${epithet}'`,
    steady: !turn,
    closing,
    moments: { start, turn },
  };
}
