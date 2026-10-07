// The prompt bank.
//
// Authoring rules, kept deliberately strict:
//   - no option is "correct", and no option is the generous one
//   - effects are cross-wired on purpose. Letting go is not simply openness.
//     Understanding is not simply order. A player should be able to feel that
//     their answers matter without being able to work out the mapping.
//   - every option touches 3-4 values so nothing reads as a single lever
//   - quiet prompts exist for pacing. Not every turn should be profound.
//
// Effect magnitudes sit between 0.03 and 0.16. See values.js for how they
// accumulate.

export const PROMPTS = [
  // ------------------------------------------------------------------ binary
  {
    id: 'understand', type: 'binary', tone: 'heavy',
    text: 'Would you rather understand what happened, or stop needing to?',
    options: [
      { label: 'Understand', effects: { order: 0.13, intensity: 0.09, attachment: 0.08, openness: -0.05 } },
      { label: 'Let go', effects: { expansion: 0.09, stability: 0.10, attachment: -0.12, order: -0.06 } },
    ],
  },
  {
    id: 'owed', type: 'binary', tone: 'heavy',
    text: 'The person you were five years ago. Are they owed anything?',
    options: [
      { label: 'They are owed', effects: { attachment: 0.14, order: 0.07, expansion: -0.08 } },
      { label: 'They are gone', effects: { expansion: 0.11, intensity: 0.07, attachment: -0.11, stability: -0.04 } },
    ],
  },
  {
    id: 'ends-well', type: 'binary', tone: 'heavy',
    text: 'When something ends well, does it end?',
    options: [
      { label: 'It ends', effects: { order: 0.11, stability: 0.09, openness: -0.07, intensity: -0.05 } },
      { label: 'It continues elsewhere', effects: { openness: 0.12, expansion: 0.08, order: -0.09 } },
    ],
  },
  {
    id: 'door-warm', type: 'binary', tone: 'heavy',
    text: 'Do you keep the door open, or close it so the room stays warm?',
    options: [
      { label: 'Keep it open', effects: { openness: 0.14, intensity: 0.06, stability: -0.09, attachment: -0.05 } },
      { label: 'Close it', effects: { stability: 0.12, attachment: 0.09, openness: -0.11, expansion: -0.05 } },
    ],
  },
  {
    id: 'repeat-refuse', type: 'binary', tone: 'heavy',
    text: 'Which is truer: you are what you repeat, or what you refuse?',
    options: [
      { label: 'What I repeat', effects: { order: 0.13, stability: 0.10, expansion: -0.06 } },
      { label: 'What I refuse', effects: { intensity: 0.13, expansion: 0.07, openness: -0.08, order: -0.05 } },
    ],
  },
  {
    id: 'unremembered', type: 'binary', tone: 'heavy',
    text: 'If no one remembers it, did it still shape you?',
    options: [
      { label: 'It still shaped me', effects: { attachment: 0.11, intensity: 0.08, order: -0.07 } },
      { label: 'Only while it lasted', effects: { openness: 0.10, expansion: 0.09, attachment: -0.10, stability: 0.04 } },
    ],
  },
  {
    id: 'known', type: 'binary', tone: 'heavy',
    text: 'Would you rather be known completely by one person, or partly by many?',
    options: [
      { label: 'Completely, by one', effects: { attachment: 0.15, intensity: 0.08, expansion: -0.10 } },
      { label: 'Partly, by many', effects: { expansion: 0.13, openness: 0.09, attachment: -0.08, intensity: -0.04 } },
    ],
  },
  {
    id: 'silence', type: 'binary', tone: 'heavy',
    text: 'Is silence something you keep, or something that happens to you?',
    options: [
      { label: 'Something I keep', effects: { order: 0.12, stability: 0.09, openness: -0.10 } },
      { label: 'Something that happens', effects: { intensity: 0.11, openness: 0.08, stability: -0.10, order: -0.05 } },
    ],
  },
  {
    id: 'grief', type: 'binary', tone: 'heavy',
    text: 'Does grief end, or does it change shape?',
    options: [
      { label: 'It ends', effects: { stability: 0.13, order: 0.08, intensity: -0.09, attachment: -0.06 } },
      { label: 'It changes shape', effects: { intensity: 0.10, attachment: 0.09, expansion: 0.06, order: -0.08 } },
    ],
  },
  {
    id: 'choose-wrongly', type: 'binary', tone: 'heavy',
    text: 'Would you rather choose wrongly, or not choose?',
    options: [
      { label: 'Choose wrongly', effects: { expansion: 0.14, intensity: 0.09, stability: -0.10, order: -0.05 } },
      { label: 'Not choose', effects: { stability: 0.11, order: 0.09, attachment: 0.06, expansion: -0.12 } },
    ],
  },
  {
    id: 'self-built', type: 'binary', tone: 'heavy',
    text: 'Is the self something you find, or something you build?',
    options: [
      { label: 'Found', effects: { openness: 0.13, attachment: 0.07, order: -0.10, expansion: 0.04 } },
      { label: 'Built', effects: { order: 0.14, stability: 0.08, intensity: 0.05, openness: -0.07 } },
    ],
  },
  {
    id: 'return-place', type: 'binary', tone: 'heavy',
    text: 'When you return to a place, are you visiting it, or is it visiting you?',
    options: [
      { label: 'I visit it', effects: { expansion: 0.11, order: 0.07, attachment: -0.09 } },
      { label: 'It visits me', effects: { attachment: 0.13, intensity: 0.08, openness: -0.06, expansion: -0.05 } },
    ],
  },
  {
    id: 'outlive', type: 'binary', tone: 'heavy',
    text: 'Would you rather your work outlive you, or your kindness?',
    options: [
      { label: 'The work', effects: { order: 0.12, expansion: 0.10, intensity: 0.06, openness: -0.07 } },
      { label: 'The kindness', effects: { openness: 0.13, attachment: 0.08, stability: 0.06, order: -0.08 } },
    ],
  },
  {
    id: 'forgetting', type: 'binary', tone: 'heavy',
    text: 'Is forgetting a loss, or a mercy?',
    options: [
      { label: 'A loss', effects: { attachment: 0.13, order: 0.09, expansion: -0.07 } },
      { label: 'A mercy', effects: { stability: 0.12, expansion: 0.08, attachment: -0.12, intensity: -0.05 } },
    ],
  },
  {
    id: 'belong', type: 'binary', tone: 'heavy',
    text: 'Do you belong to the places you came from, or the ones you chose?',
    options: [
      { label: 'Where I came from', effects: { attachment: 0.14, stability: 0.08, expansion: -0.09, openness: -0.04 } },
      { label: 'Where I chose', effects: { expansion: 0.13, order: 0.07, attachment: -0.10 } },
    ],
  },
  {
    id: 'waiting-staying', type: 'binary', tone: 'heavy',
    text: 'Is there a difference between waiting and staying?',
    options: [
      { label: 'There is', effects: { order: 0.11, intensity: 0.09, stability: -0.06, openness: 0.05 } },
      { label: 'There is not', effects: { stability: 0.12, attachment: 0.08, intensity: -0.09, order: -0.05 } },
    ],
  },
  {
    id: 'changed-preserved', type: 'binary', tone: 'heavy',
    text: 'Would you rather be changed by love, or preserved by it?',
    options: [
      { label: 'Changed', effects: { expansion: 0.12, openness: 0.10, intensity: 0.07, stability: -0.11 } },
      { label: 'Preserved', effects: { stability: 0.14, attachment: 0.10, order: 0.05, expansion: -0.09 } },
    ],
  },
  {
    id: 'light-room', type: 'binary', tone: 'quiet',
    text: 'The light in the room you are in. Warm, or cold?',
    options: [
      { label: 'Warm', effects: { attachment: 0.06, stability: 0.05, intensity: -0.03 } },
      { label: 'Cold', effects: { order: 0.06, openness: 0.05, attachment: -0.04 } },
    ],
  },
  {
    id: 'facing', type: 'binary', tone: 'quiet',
    text: 'Do you sleep facing the wall, or facing the room?',
    options: [
      { label: 'The wall', effects: { attachment: 0.06, stability: 0.06, openness: -0.05 } },
      { label: 'The room', effects: { openness: 0.07, intensity: 0.04, stability: -0.04 } },
    ],
  },
  {
    id: 'finish-books', type: 'binary', tone: 'quiet',
    text: 'Do you finish books you have stopped enjoying?',
    options: [
      { label: 'I finish them', effects: { order: 0.07, stability: 0.05, expansion: -0.04 } },
      { label: 'I stop', effects: { expansion: 0.06, intensity: 0.05, order: -0.06 } },
    ],
  },

  // -------------------------------------------------------------------- quad
  {
    id: 'stays-longest', type: 'quad', tone: 'heavy',
    text: 'What stays longest after something ends?',
    options: [
      { label: 'The image', effects: { order: 0.11, attachment: 0.07, openness: -0.06 } },
      { label: 'The feeling', effects: { intensity: 0.13, attachment: 0.06, order: -0.07 } },
      { label: 'The habit', effects: { stability: 0.12, order: 0.08, expansion: -0.07 } },
      { label: 'The absence', effects: { openness: 0.11, expansion: 0.07, stability: -0.09 } },
    ],
  },
  {
    id: 'person-lives', type: 'quad', tone: 'heavy',
    text: 'Where does a person actually live?',
    options: [
      { label: 'In their body', effects: { stability: 0.12, intensity: 0.07, expansion: -0.06 } },
      { label: 'In their work', effects: { order: 0.13, expansion: 0.07, openness: -0.06 } },
      { label: 'In what others remember', effects: { attachment: 0.13, openness: 0.06, order: -0.05 } },
      { label: 'In the next hour', effects: { expansion: 0.12, openness: 0.08, attachment: -0.11 } },
    ],
  },
  {
    id: 'promise', type: 'quad', tone: 'heavy',
    text: 'What is a promise made of?',
    options: [
      { label: 'Fear', effects: { intensity: 0.12, stability: -0.09, order: 0.06 } },
      { label: 'Hope', effects: { expansion: 0.12, openness: 0.08, order: -0.06 } },
      { label: 'Habit', effects: { stability: 0.13, order: 0.09, intensity: -0.07 } },
      { label: 'Debt', effects: { attachment: 0.14, order: 0.07, expansion: -0.08 } },
    ],
  },
  {
    id: 'notice-first', type: 'quad', tone: 'heavy',
    text: 'Which loss would you notice first?',
    options: [
      { label: 'Your name', effects: { attachment: 0.12, order: 0.08, expansion: -0.06 } },
      { label: 'Your handwriting', effects: { order: 0.12, intensity: 0.06, openness: -0.05 } },
      { label: 'Your appetite', effects: { intensity: 0.13, expansion: -0.08, stability: -0.05 } },
      { label: 'Your patience', effects: { stability: -0.12, intensity: 0.10, openness: 0.05 } },
    ],
  },
  {
    id: 'never-open', type: 'quad', tone: 'heavy',
    text: 'What do you do with a door you will never open again?',
    options: [
      { label: 'Lock it', effects: { order: 0.13, stability: 0.08, openness: -0.09 } },
      { label: 'Leave it', effects: { openness: 0.11, attachment: 0.07, order: -0.08 } },
      { label: 'Remove it', effects: { expansion: 0.13, intensity: 0.08, attachment: -0.11 } },
      { label: 'Forget it', effects: { stability: 0.11, attachment: -0.10, intensity: -0.06 } },
    ],
  },
  {
    id: 'carry-out', type: 'quad', tone: 'heavy',
    text: 'Everyone is already safe. What do you carry out of the house?',
    options: [
      { label: 'Something old', effects: { attachment: 0.14, stability: 0.06, expansion: -0.07 } },
      { label: 'Something unfinished', effects: { expansion: 0.12, intensity: 0.08, stability: -0.07 } },
      { label: 'Something given to you', effects: { attachment: 0.10, openness: 0.09, order: -0.05 } },
      { label: 'Nothing', effects: { openness: 0.12, stability: 0.08, attachment: -0.13 } },
    ],
  },
  {
    id: 'time-is', type: 'quad', tone: 'heavy',
    text: 'Time is',
    options: [
      { label: 'A river', effects: { expansion: 0.11, openness: 0.08, order: -0.07 } },
      { label: 'A room', effects: { stability: 0.12, attachment: 0.07, expansion: -0.08 } },
      { label: 'A debt', effects: { order: 0.11, intensity: 0.09, openness: -0.07 } },
      { label: 'A rumour', effects: { openness: 0.13, intensity: 0.06, stability: -0.10 } },
    ],
  },
  {
    id: 'what-you-trust', type: 'quad', tone: 'heavy',
    text: 'When you do not know what to do, what do you trust?',
    options: [
      { label: 'The body', effects: { intensity: 0.12, stability: 0.07, order: -0.08 } },
      { label: 'The pattern', effects: { order: 0.14, stability: 0.07, openness: -0.07 } },
      { label: 'A stranger', effects: { openness: 0.14, expansion: 0.07, attachment: -0.08 } },
      { label: 'The delay', effects: { stability: 0.12, expansion: -0.10, intensity: -0.05 } },
    ],
  },
  {
    id: 'survives-translation', type: 'quad', tone: 'heavy',
    text: 'What survives translation?',
    options: [
      { label: 'Rhythm', effects: { order: 0.12, stability: 0.07, intensity: 0.05 } },
      { label: 'Meaning', effects: { attachment: 0.10, order: 0.08, openness: -0.05 } },
      { label: 'Error', effects: { intensity: 0.12, openness: 0.08, order: -0.11 } },
      { label: 'Nothing', effects: { expansion: 0.10, openness: 0.09, attachment: -0.12 } },
    ],
  },
  {
    id: 'keep-too-long', type: 'quad', tone: 'heavy',
    text: 'What are you most likely to keep too long?',
    options: [
      { label: 'A letter', effects: { attachment: 0.13, order: 0.06, expansion: -0.06 } },
      { label: 'A grudge', effects: { intensity: 0.13, attachment: 0.08, openness: -0.10 } },
      { label: 'A plan', effects: { order: 0.12, expansion: 0.08, stability: -0.06 } },
      { label: 'A key', effects: { stability: 0.11, attachment: 0.09, openness: -0.06 } },
    ],
  },
  {
    id: 'morning-sound', type: 'quad', tone: 'quiet',
    text: 'What sound means morning to you?',
    options: [
      { label: 'Birds', effects: { openness: 0.07, expansion: 0.04 } },
      { label: 'Traffic', effects: { intensity: 0.06, expansion: 0.05, stability: -0.03 } },
      { label: 'A kettle', effects: { stability: 0.07, attachment: 0.04 } },
      { label: 'Nothing', effects: { order: 0.06, attachment: -0.05, openness: 0.03 } },
    ],
  },

  // ------------------------------------------------------------------ slider
  {
    id: 'past-carry', type: 'slider', tone: 'heavy',
    text: 'How much of the past should the future carry?',
    poles: ['Nothing', 'Everything'],
    effects: {
      attachment: [-0.14, 0.16], order: [-0.09, 0.10],
      expansion: [0.12, -0.10], openness: [0.07, -0.06],
    },
  },
  {
    id: 'above-ground', type: 'slider', tone: 'heavy',
    text: 'How far from the ground should a life be lived?',
    poles: ['On it', 'Far above it'],
    effects: {
      expansion: [-0.10, 0.15], stability: [0.12, -0.13],
      openness: [-0.05, 0.09], intensity: [-0.04, 0.07],
    },
  },
  {
    id: 'let-seen', type: 'slider', tone: 'heavy',
    text: 'How much of yourself would you let a person see?',
    poles: ['A little', 'All of it'],
    effects: {
      openness: [-0.14, 0.15], intensity: [-0.06, 0.11],
      stability: [0.10, -0.09], order: [0.08, -0.07],
    },
  },
  {
    id: 'order-alive', type: 'slider', tone: 'heavy',
    text: 'How much order does a life need before it stops being alive?',
    poles: ['None', 'Total'],
    effects: {
      order: [-0.15, 0.16], stability: [-0.08, 0.11],
      intensity: [0.10, -0.09], expansion: [0.06, -0.07],
    },
  },
  {
    id: 'mourned', type: 'slider', tone: 'heavy',
    text: 'How long should a thing be mourned?',
    poles: ['A moment', 'Always'],
    effects: {
      attachment: [-0.13, 0.15], intensity: [-0.07, 0.12],
      expansion: [0.11, -0.10], stability: [0.06, -0.08],
    },
  },
  {
    id: 'wanting-having', type: 'slider', tone: 'heavy',
    text: 'How much should wanting something count as having it?',
    poles: ['Not at all', 'Completely'],
    effects: {
      intensity: [-0.08, 0.13], openness: [-0.09, 0.12],
      order: [0.11, -0.12], stability: [0.05, -0.07],
    },
  },
  {
    id: 'believe-chose', type: 'slider', tone: 'heavy',
    text: 'How much of what you believe did you choose?',
    poles: ['None of it', 'All of it'],
    effects: {
      order: [-0.10, 0.14], attachment: [0.12, -0.11],
      expansion: [-0.07, 0.10], openness: [0.06, -0.05],
    },
  },
  {
    id: 'affection-distance', type: 'slider', tone: 'heavy',
    text: 'How much distance does affection need?',
    poles: ['None', 'A great deal'],
    effects: {
      attachment: [0.14, -0.13], openness: [-0.10, 0.11],
      intensity: [0.09, -0.08], stability: [-0.06, 0.09],
    },
  },
  {
    id: 'fill-glass', type: 'slider', tone: 'quiet',
    text: 'How full do you fill a glass?',
    poles: ['Barely', 'To the rim'],
    effects: { expansion: [-0.05, 0.07], intensity: [-0.03, 0.06], order: [0.04, -0.04] },
  },

  // ------------------------------------------------------------------ action
  {
    id: 'hold-worth', type: 'action', tone: 'heavy',
    text: 'Hold on for as long as it still feels worth holding.',
    action: { kind: 'hold', min: 0.4, max: 9 },
    effects: {
      attachment: [-0.12, 0.16], stability: [-0.05, 0.10],
      expansion: [0.12, -0.09], intensity: [0.08, -0.04],
    },
  },
  {
    id: 'far-enough', type: 'action', tone: 'heavy',
    text: 'Move it as far away as it needs to be.',
    action: { kind: 'drag', maxDist: 230 },
    effects: {
      openness: [-0.11, 0.13], attachment: [0.13, -0.14],
      stability: [0.08, -0.07], expansion: [-0.05, 0.10],
    },
  },
  {
    id: 'actual-size', type: 'action', tone: 'heavy',
    text: 'Make it the size it actually is.',
    action: { kind: 'scale', min: 0.25, max: 3.2 },
    effects: {
      intensity: [-0.10, 0.15], expansion: [-0.09, 0.12],
      order: [0.09, -0.10], stability: [0.07, -0.08],
    },
  },
  {
    id: 'face-you', type: 'action', tone: 'heavy',
    text: 'Turn it until it is facing you.',
    action: { kind: 'rotate', turns: 1 },
    effects: {
      order: [0.12, -0.11], openness: [-0.08, 0.12],
      intensity: [-0.05, 0.09], attachment: [0.06, -0.06],
    },
  },
  {
    id: 'where-belongs', type: 'action', tone: 'heavy',
    text: 'Put it where it belongs.',
    action: { kind: 'place', poles: ['Buried', 'In the open'] },
    effects: {
      openness: [-0.13, 0.14], attachment: [0.11, -0.09],
      order: [0.08, -0.07], intensity: [0.06, -0.05],
    },
  },
  {
    id: 'until-certain', type: 'action', tone: 'heavy',
    text: 'Press until you are certain. Let go when you are not.',
    action: { kind: 'hold', min: 0.4, max: 7 },
    effects: {
      order: [-0.10, 0.13], stability: [-0.09, 0.12],
      openness: [0.10, -0.08], expansion: [0.07, -0.06],
    },
  },
  {
    id: 'pull-apart', type: 'action', tone: 'heavy',
    text: 'Pull the two apart until it stops hurting.',
    action: { kind: 'drag', maxDist: 250, paired: true },
    effects: {
      attachment: [0.15, -0.15], intensity: [0.12, -0.09],
      expansion: [-0.07, 0.11], stability: [-0.06, 0.08],
    },
  },
  {
    id: 'room-for', type: 'action', tone: 'heavy',
    text: 'Leave room for what has not happened yet.',
    action: { kind: 'scale', min: 0.3, max: 3.4 },
    effects: {
      expansion: [-0.11, 0.14], openness: [-0.09, 0.12],
      attachment: [0.10, -0.09], order: [0.06, -0.07],
    },
  },
  {
    id: 'wind-back', type: 'action', tone: 'quiet',
    text: 'Wind it back to where you would rather it had stopped.',
    action: { kind: 'rotate', turns: 1.5 },
    effects: { attachment: [-0.06, 0.09], order: [0.05, -0.06], intensity: [-0.04, 0.07] },
  },
];

export const PROMPTS_BY_ID = Object.fromEntries(PROMPTS.map((p) => [p.id, p]));

const TYPES = ['binary', 'quad', 'slider', 'action'];

/**
 * Choose the next prompt.
 *
 * Pacing rules, in order of importance:
 *   - never repeat a prompt
 *   - never use the same response type three times running
 *   - after two heavy prompts, strongly prefer a quiet one
 *   - otherwise weight towards types we have used least
 */
export function pickPrompt(rng, history) {
  const used = new Set(history.map((h) => h.promptId));
  let pool = PROMPTS.filter((p) => !used.has(p.id));
  if (pool.length === 0) pool = PROMPTS.slice(); // very long game: allow repeats rather than stall

  const lastTypes = history.slice(-2).map((h) => h.type);
  const blockedType = lastTypes.length === 2 && lastTypes[0] === lastTypes[1] ? lastTypes[0] : null;
  const heavyRun = history.length >= 2 && history.slice(-2).every((h) => h.tone === 'heavy');

  const typeCounts = Object.fromEntries(TYPES.map((t) => [t, 0]));
  for (const h of history) typeCounts[h.type] = (typeCounts[h.type] || 0) + 1;
  const maxCount = Math.max(1, ...Object.values(typeCounts));

  const filtered = blockedType ? pool.filter((p) => p.type !== blockedType) : pool;
  const candidates = filtered.length ? filtered : pool;

  return rng.weighted(candidates, (p) => {
    let w = 1;
    w *= 0.35 + (maxCount - typeCounts[p.type]) / maxCount; // favour under-used types
    if (heavyRun) w *= p.tone === 'quiet' ? 3.2 : 0.5;
    else w *= p.tone === 'quiet' ? 0.55 : 1;
    if (history.length < 2 && p.type === 'action') w *= 0.4; // ease the player in
    return w;
  });
}
