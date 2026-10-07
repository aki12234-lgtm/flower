// The prompt bank.
//
// Authoring rules, kept deliberately strict:
//   - no option is "correct", and no option is the generous one
//   - effects are cross-wired on purpose. Letting go is not simply openness.
//     Understanding is not simply order. A player should be able to feel that
//     their answers matter without being able to work out the mapping.
//   - every option touches 3-4 values so nothing reads as a single lever
//   - quiet prompts exist for pacing. Not every turn should be profound.
//   - the bank is not all loss. A journey also has delight, pride, anger and
//     wanting in it, and the questions have to leave room for those.
//
// Every prompt belongs to a season (see docs/meaning.md). Seasons give the
// questions an arc; they feed the story told at the end and never the growth.
// The effects stay cross-wired whatever the season is.
//   roots     where you come from, what you hold. Only the first answers.
//   reaching  will, choice, who you are making yourself into
//   opening   other people, being seen, love
//   giving    what you make, want and leave behind
//   shedding  loss, memory, letting go
//   weather   the quiet prompts, which belong to no season
//
// Effect magnitudes sit between 0.03 and 0.16. See values.js for how they
// accumulate.

export const SEASONS = ['roots', 'reaching', 'opening', 'giving', 'shedding', 'weather'];

// Roots happens once, then the cycle repeats for as long as the game lasts.
export const ROOTS_TURNS = 3;
export const SEASON_TURNS = 5;
export const CYCLE = ['reaching', 'opening', 'giving', 'shedding'];

/** Which season the turn with this index (0-based) falls in. */
export function seasonAt(turn) {
  if (turn < ROOTS_TURNS) return 'roots';
  return CYCLE[Math.floor((turn - ROOTS_TURNS) / SEASON_TURNS) % CYCLE.length];
}

export const PROMPTS = [
  // ------------------------------------------------------------------ binary
  {
    id: 'understand', type: 'binary', tone: 'heavy', season: 'shedding',
    text: 'Would you rather understand what happened, or stop needing to?',
    options: [
      { label: 'Understand', effects: { order: 0.13, intensity: 0.09, attachment: 0.08, openness: -0.05 } },
      { label: 'Let go', effects: { expansion: 0.09, stability: 0.10, attachment: -0.12, order: -0.06 } },
    ],
  },
  {
    id: 'owed', type: 'binary', tone: 'heavy', season: 'roots',
    text: 'The person you were five years ago. Are they owed anything?',
    options: [
      { label: 'They are owed', effects: { attachment: 0.14, order: 0.07, expansion: -0.08 } },
      { label: 'They are gone', effects: { expansion: 0.11, intensity: 0.07, attachment: -0.11, stability: -0.04 } },
    ],
  },
  {
    id: 'ends-well', type: 'binary', tone: 'heavy', season: 'shedding',
    text: 'When something ends well, does it end?',
    options: [
      { label: 'It ends', effects: { order: 0.11, stability: 0.09, openness: -0.07, intensity: -0.05 } },
      { label: 'It continues elsewhere', effects: { openness: 0.12, expansion: 0.08, order: -0.09 } },
    ],
  },
  {
    id: 'door-warm', type: 'binary', tone: 'heavy', season: 'opening',
    text: 'Do you keep the door open, or close it so the room stays warm?',
    options: [
      { label: 'Keep it open', effects: { openness: 0.14, intensity: 0.06, stability: -0.09, attachment: -0.05 } },
      { label: 'Close it', effects: { stability: 0.12, attachment: 0.09, openness: -0.11, expansion: -0.05 } },
    ],
  },
  {
    id: 'repeat-refuse', type: 'binary', tone: 'heavy', season: 'reaching',
    text: 'Which is truer: you are what you repeat, or what you refuse?',
    options: [
      { label: 'What I repeat', effects: { order: 0.13, stability: 0.10, expansion: -0.06 } },
      { label: 'What I refuse', effects: { intensity: 0.13, expansion: 0.07, openness: -0.08, order: -0.05 } },
    ],
  },
  {
    id: 'unremembered', type: 'binary', tone: 'heavy', season: 'roots',
    text: 'If no one remembers it, did it still shape you?',
    options: [
      { label: 'It still shaped me', effects: { attachment: 0.11, intensity: 0.08, order: -0.07 } },
      { label: 'Only while it lasted', effects: { openness: 0.10, expansion: 0.09, attachment: -0.10, stability: 0.04 } },
    ],
  },
  {
    id: 'known', type: 'binary', tone: 'heavy', season: 'opening',
    text: 'Would you rather be known completely by one person, or partly by many?',
    options: [
      { label: 'Completely, by one', effects: { attachment: 0.15, intensity: 0.08, expansion: -0.10 } },
      { label: 'Partly, by many', effects: { expansion: 0.13, openness: 0.09, attachment: -0.08, intensity: -0.04 } },
    ],
  },
  {
    id: 'silence', type: 'binary', tone: 'heavy', season: 'opening',
    text: 'Is silence something you keep, or something that happens to you?',
    options: [
      { label: 'Something I keep', effects: { order: 0.12, stability: 0.09, openness: -0.10 } },
      { label: 'Something that happens', effects: { intensity: 0.11, openness: 0.08, stability: -0.10, order: -0.05 } },
    ],
  },
  {
    id: 'grief', type: 'binary', tone: 'heavy', season: 'shedding',
    text: 'Does grief end, or does it change shape?',
    options: [
      { label: 'It ends', effects: { stability: 0.13, order: 0.08, intensity: -0.09, attachment: -0.06 } },
      { label: 'It changes shape', effects: { intensity: 0.10, attachment: 0.09, expansion: 0.06, order: -0.08 } },
    ],
  },
  {
    id: 'choose-wrongly', type: 'binary', tone: 'heavy', season: 'reaching',
    text: 'Would you rather choose wrongly, or not choose?',
    options: [
      { label: 'Choose wrongly', effects: { expansion: 0.14, intensity: 0.09, stability: -0.10, order: -0.05 } },
      { label: 'Not choose', effects: { stability: 0.11, order: 0.09, attachment: 0.06, expansion: -0.12 } },
    ],
  },
  {
    id: 'self-built', type: 'binary', tone: 'heavy', season: 'reaching',
    text: 'Is the self something you find, or something you build?',
    options: [
      { label: 'Found', effects: { openness: 0.13, attachment: 0.07, order: -0.10, expansion: 0.04 } },
      { label: 'Built', effects: { order: 0.14, stability: 0.08, intensity: 0.05, openness: -0.07 } },
    ],
  },
  {
    id: 'return-place', type: 'binary', tone: 'heavy', season: 'roots',
    text: 'When you return to a place, are you visiting it, or is it visiting you?',
    options: [
      { label: 'I visit it', effects: { expansion: 0.11, order: 0.07, attachment: -0.09 } },
      { label: 'It visits me', effects: { attachment: 0.13, intensity: 0.08, openness: -0.06, expansion: -0.05 } },
    ],
  },
  {
    id: 'outlive', type: 'binary', tone: 'heavy', season: 'giving',
    text: 'Would you rather your work outlive you, or your kindness?',
    options: [
      { label: 'The work', effects: { order: 0.12, expansion: 0.10, intensity: 0.06, openness: -0.07 } },
      { label: 'The kindness', effects: { openness: 0.13, attachment: 0.08, stability: 0.06, order: -0.08 } },
    ],
  },
  {
    id: 'forgetting', type: 'binary', tone: 'heavy', season: 'shedding',
    text: 'Is forgetting a loss, or a mercy?',
    options: [
      { label: 'A loss', effects: { attachment: 0.13, order: 0.09, expansion: -0.07 } },
      { label: 'A mercy', effects: { stability: 0.12, expansion: 0.08, attachment: -0.12, intensity: -0.05 } },
    ],
  },
  {
    id: 'belong', type: 'binary', tone: 'heavy', season: 'roots',
    text: 'Do you belong to the places you came from, or the ones you chose?',
    options: [
      { label: 'Where I came from', effects: { attachment: 0.14, stability: 0.08, expansion: -0.09, openness: -0.04 } },
      { label: 'Where I chose', effects: { expansion: 0.13, order: 0.07, attachment: -0.10 } },
    ],
  },
  {
    id: 'waiting-staying', type: 'binary', tone: 'heavy', season: 'reaching',
    text: 'Is there a difference between waiting and staying?',
    options: [
      { label: 'There is', effects: { order: 0.11, intensity: 0.09, stability: -0.06, openness: 0.05 } },
      { label: 'There is not', effects: { stability: 0.12, attachment: 0.08, intensity: -0.09, order: -0.05 } },
    ],
  },
  {
    id: 'changed-preserved', type: 'binary', tone: 'heavy', season: 'opening',
    text: 'Would you rather be changed by love, or preserved by it?',
    options: [
      { label: 'Changed', effects: { expansion: 0.12, openness: 0.10, intensity: 0.07, stability: -0.11 } },
      { label: 'Preserved', effects: { stability: 0.14, attachment: 0.10, order: 0.05, expansion: -0.09 } },
    ],
  },
  {
    id: 'light-room', type: 'binary', tone: 'quiet', season: 'weather',
    text: 'The light in the room you are in. Warm, or cold?',
    options: [
      { label: 'Warm', effects: { attachment: 0.06, stability: 0.05, intensity: -0.03 } },
      { label: 'Cold', effects: { order: 0.06, openness: 0.05, attachment: -0.04 } },
    ],
  },
  {
    id: 'facing', type: 'binary', tone: 'quiet', season: 'weather',
    text: 'Do you sleep facing the wall, or facing the room?',
    options: [
      { label: 'The wall', effects: { attachment: 0.06, stability: 0.06, openness: -0.05 } },
      { label: 'The room', effects: { openness: 0.07, intensity: 0.04, stability: -0.04 } },
    ],
  },
  {
    id: 'finish-books', type: 'binary', tone: 'quiet', season: 'weather',
    text: 'Do you finish books you have stopped enjoying?',
    options: [
      { label: 'I finish them', effects: { order: 0.07, stability: 0.05, expansion: -0.04 } },
      { label: 'I stop', effects: { expansion: 0.06, intensity: 0.05, order: -0.06 } },
    ],
  },

  {
    id: 'first-rule', type: 'binary', tone: 'heavy', season: 'roots',
    text: 'The first rule you were ever given. Do you still keep it?',
    options: [
      { label: 'I keep it', effects: { order: 0.12, attachment: 0.09, openness: -0.07 } },
      { label: 'I broke it long ago', effects: { expansion: 0.10, intensity: 0.08, order: -0.09, stability: -0.04 } },
    ],
  },
  {
    id: 'happiest-child', type: 'binary', tone: 'heavy', season: 'roots',
    text: 'The happiest you remember being as a child. Were you alone, or with someone?',
    options: [
      { label: 'Alone', effects: { openness: 0.09, order: 0.08, attachment: -0.08 } },
      { label: 'With someone', effects: { attachment: 0.12, expansion: 0.07, order: -0.06 } },
    ],
  },
  {
    id: 'proud-unseen', type: 'binary', tone: 'heavy', season: 'reaching',
    text: 'Can you be proud of something no one else noticed?',
    options: [
      { label: 'Yes', effects: { stability: 0.12, order: 0.07, expansion: -0.08 } },
      { label: 'Not until someone sees it', effects: { expansion: 0.12, intensity: 0.08, attachment: 0.06, stability: -0.08 } },
    ],
  },
  {
    id: 'forgive-first', type: 'binary', tone: 'heavy', season: 'opening',
    text: 'Should the one who was wronged wait to be asked, or forgive first?',
    options: [
      { label: 'Wait to be asked', effects: { order: 0.12, intensity: 0.08, attachment: 0.05, openness: -0.08 } },
      { label: 'Forgive first', effects: { openness: 0.12, attachment: 0.07, order: -0.08, intensity: -0.04 } },
    ],
  },
  {
    id: 'fair-kind', type: 'binary', tone: 'heavy', season: 'opening',
    text: 'When fair and kind pull in different directions, which do you follow?',
    options: [
      { label: 'Fair', effects: { order: 0.13, stability: 0.07, attachment: -0.07 } },
      { label: 'Kind', effects: { attachment: 0.11, openness: 0.08, order: -0.09, intensity: 0.04 } },
    ],
  },
  {
    id: 'plant-or-sit', type: 'binary', tone: 'heavy', season: 'giving',
    text: 'Would you rather plant the tree, or sit under one someone else planted?',
    options: [
      { label: 'Plant it', effects: { order: 0.11, expansion: 0.09, attachment: -0.07 } },
      { label: 'Sit under it', effects: { stability: 0.11, openness: 0.08, order: -0.06, intensity: -0.04 } },
    ],
  },
  {
    id: 'give-or-given', type: 'binary', tone: 'heavy', season: 'giving',
    text: 'Would you rather be the one it is given to, or the one who gives it?',
    options: [
      { label: 'The one it is given to', effects: { attachment: 0.12, stability: 0.07, intensity: 0.05, expansion: -0.07 } },
      { label: 'The one who gives', effects: { expansion: 0.11, openness: 0.08, attachment: -0.08 } },
    ],
  },
  {
    id: 'want-more-less', type: 'binary', tone: 'heavy', season: 'giving',
    text: 'Do you want less than you used to, or more?',
    options: [
      { label: 'Less', effects: { stability: 0.12, order: 0.06, intensity: -0.09, expansion: -0.04 } },
      { label: 'More', effects: { intensity: 0.12, expansion: 0.09, stability: -0.08 } },
    ],
  },
  {
    id: 'relief-said', type: 'binary', tone: 'heavy', season: 'shedding',
    text: 'When you were relieved that something ended, did you say so?',
    options: [
      { label: 'I kept it to myself', effects: { attachment: 0.09, order: 0.09, openness: -0.09 } },
      { label: 'I said so', effects: { openness: 0.11, intensity: 0.08, stability: -0.06 } },
    ],
  },
  {
    id: 'window-aisle', type: 'binary', tone: 'quiet', season: 'weather',
    text: 'Window seat, or aisle?',
    options: [
      { label: 'Window', effects: { openness: 0.06, attachment: 0.04, expansion: -0.03 } },
      { label: 'Aisle', effects: { order: 0.06, expansion: 0.05, openness: -0.03 } },
    ],
  },
  {
    id: 'caught-rain', type: 'binary', tone: 'quiet', season: 'weather',
    text: 'Caught in the rain. Do you run?',
    options: [
      { label: 'I run', effects: { order: 0.06, intensity: 0.04, stability: -0.03 } },
      { label: 'I walk', effects: { stability: 0.06, openness: 0.05, order: -0.03 } },
    ],
  },
  {
    id: 'best-bite', type: 'binary', tone: 'quiet', season: 'weather',
    text: 'Do you save the best bite for last?',
    options: [
      { label: 'I save it', effects: { order: 0.06, attachment: 0.05, intensity: -0.03 } },
      { label: 'I eat it first', effects: { intensity: 0.06, expansion: 0.05, order: -0.04 } },
    ],
  },
  {
    id: 'sing-alone', type: 'binary', tone: 'quiet', season: 'weather',
    text: 'Do you sing when no one is home?',
    options: [
      { label: 'I sing', effects: { intensity: 0.06, openness: 0.05, order: -0.03 } },
      { label: 'I do not', effects: { order: 0.05, stability: 0.05, intensity: -0.03 } },
    ],
  },

  // -------------------------------------------------------------------- quad
  {
    id: 'stays-longest', type: 'quad', tone: 'heavy', season: 'shedding',
    text: 'What stays longest after something ends?',
    options: [
      { label: 'The image', effects: { order: 0.11, attachment: 0.07, openness: -0.06 } },
      { label: 'The feeling', effects: { intensity: 0.13, attachment: 0.06, order: -0.07 } },
      { label: 'The habit', effects: { stability: 0.12, order: 0.08, expansion: -0.07 } },
      { label: 'The absence', effects: { openness: 0.11, expansion: 0.07, stability: -0.09 } },
    ],
  },
  {
    id: 'person-lives', type: 'quad', tone: 'heavy', season: 'giving',
    text: 'Where does a person actually live?',
    options: [
      { label: 'In their body', effects: { stability: 0.12, intensity: 0.07, expansion: -0.06 } },
      { label: 'In their work', effects: { order: 0.13, expansion: 0.07, openness: -0.06 } },
      { label: 'In what others remember', effects: { attachment: 0.13, openness: 0.06, order: -0.05 } },
      { label: 'In the next hour', effects: { expansion: 0.12, openness: 0.08, attachment: -0.11 } },
    ],
  },
  {
    id: 'promise', type: 'quad', tone: 'heavy', season: 'opening',
    text: 'What is a promise made of?',
    options: [
      { label: 'Fear', effects: { intensity: 0.12, stability: -0.09, order: 0.06 } },
      { label: 'Hope', effects: { expansion: 0.12, openness: 0.08, order: -0.06 } },
      { label: 'Habit', effects: { stability: 0.13, order: 0.09, intensity: -0.07 } },
      { label: 'Debt', effects: { attachment: 0.14, order: 0.07, expansion: -0.08 } },
    ],
  },
  {
    id: 'notice-first', type: 'quad', tone: 'heavy', season: 'reaching',
    text: 'Which loss would you notice first?',
    options: [
      { label: 'Your name', effects: { attachment: 0.12, order: 0.08, expansion: -0.06 } },
      { label: 'Your handwriting', effects: { order: 0.12, intensity: 0.06, openness: -0.05 } },
      { label: 'Your appetite', effects: { intensity: 0.13, expansion: -0.08, stability: -0.05 } },
      { label: 'Your patience', effects: { stability: -0.12, intensity: 0.10, openness: 0.05 } },
    ],
  },
  {
    id: 'never-open', type: 'quad', tone: 'heavy', season: 'shedding',
    text: 'What do you do with a door you will never open again?',
    options: [
      { label: 'Lock it', effects: { order: 0.13, stability: 0.08, openness: -0.09 } },
      { label: 'Leave it', effects: { openness: 0.11, attachment: 0.07, order: -0.08 } },
      { label: 'Remove it', effects: { expansion: 0.13, intensity: 0.08, attachment: -0.11 } },
      { label: 'Forget it', effects: { stability: 0.11, attachment: -0.10, intensity: -0.06 } },
    ],
  },
  {
    id: 'carry-out', type: 'quad', tone: 'heavy', season: 'roots',
    text: 'Everyone is already safe. What do you carry out of the house?',
    options: [
      { label: 'Something old', effects: { attachment: 0.14, stability: 0.06, expansion: -0.07 } },
      { label: 'Something unfinished', effects: { expansion: 0.12, intensity: 0.08, stability: -0.07 } },
      { label: 'Something given to you', effects: { attachment: 0.10, openness: 0.09, order: -0.05 } },
      { label: 'Nothing', effects: { openness: 0.12, stability: 0.08, attachment: -0.13 } },
    ],
  },
  {
    id: 'time-is', type: 'quad', tone: 'heavy', season: 'shedding',
    text: 'Time is',
    options: [
      { label: 'A river', effects: { expansion: 0.11, openness: 0.08, order: -0.07 } },
      { label: 'A room', effects: { stability: 0.12, attachment: 0.07, expansion: -0.08 } },
      { label: 'A debt', effects: { order: 0.11, intensity: 0.09, openness: -0.07 } },
      { label: 'A rumour', effects: { openness: 0.13, intensity: 0.06, stability: -0.10 } },
    ],
  },
  {
    id: 'what-you-trust', type: 'quad', tone: 'heavy', season: 'reaching',
    text: 'When you do not know what to do, what do you trust?',
    options: [
      { label: 'The body', effects: { intensity: 0.12, stability: 0.07, order: -0.08 } },
      { label: 'The pattern', effects: { order: 0.14, stability: 0.07, openness: -0.07 } },
      { label: 'A stranger', effects: { openness: 0.14, expansion: 0.07, attachment: -0.08 } },
      { label: 'The delay', effects: { stability: 0.12, expansion: -0.10, intensity: -0.05 } },
    ],
  },
  {
    id: 'survives-translation', type: 'quad', tone: 'heavy', season: 'opening',
    text: 'What survives translation?',
    options: [
      { label: 'Rhythm', effects: { order: 0.12, stability: 0.07, intensity: 0.05 } },
      { label: 'Meaning', effects: { attachment: 0.10, order: 0.08, openness: -0.05 } },
      { label: 'Error', effects: { intensity: 0.12, openness: 0.08, order: -0.11 } },
      { label: 'Nothing', effects: { expansion: 0.10, openness: 0.09, attachment: -0.12 } },
    ],
  },
  {
    id: 'keep-too-long', type: 'quad', tone: 'heavy', season: 'shedding',
    text: 'What are you most likely to keep too long?',
    options: [
      { label: 'A letter', effects: { attachment: 0.13, order: 0.06, expansion: -0.06 } },
      { label: 'A grudge', effects: { intensity: 0.13, attachment: 0.08, openness: -0.10 } },
      { label: 'A plan', effects: { order: 0.12, expansion: 0.08, stability: -0.06 } },
      { label: 'A key', effects: { stability: 0.11, attachment: 0.09, openness: -0.06 } },
    ],
  },
  {
    id: 'morning-sound', type: 'quad', tone: 'quiet', season: 'weather',
    text: 'What sound means morning to you?',
    options: [
      { label: 'Birds', effects: { openness: 0.07, expansion: 0.04 } },
      { label: 'Traffic', effects: { intensity: 0.06, expansion: 0.05, stability: -0.03 } },
      { label: 'A kettle', effects: { stability: 0.07, attachment: 0.04 } },
      { label: 'Nothing', effects: { order: 0.06, attachment: -0.05, openness: 0.03 } },
    ],
  },

  {
    id: 'taught-unsaid', type: 'quad', tone: 'heavy', season: 'roots',
    text: 'What were you taught without anyone saying it?',
    options: [
      { label: 'To be careful', effects: { stability: 0.12, order: 0.07, expansion: -0.08 } },
      { label: 'To be useful', effects: { order: 0.12, intensity: 0.06, openness: -0.06 } },
      { label: 'To be quiet', effects: { attachment: 0.08, stability: 0.05, openness: -0.09, intensity: -0.05 } },
      { label: 'To be brave', effects: { intensity: 0.12, expansion: 0.08, stability: -0.07 } },
    ],
  },
  {
    id: 'open-unknown', type: 'quad', tone: 'heavy', season: 'reaching',
    text: 'What would you open if no one would ever know?',
    options: [
      { label: 'Nothing', effects: { order: 0.12, stability: 0.08, expansion: -0.08 } },
      { label: 'A letter not meant for you', effects: { attachment: 0.10, intensity: 0.09, stability: -0.07 } },
      { label: 'A locked drawer', effects: { intensity: 0.11, openness: 0.07, order: -0.08 } },
      { label: 'A door in a dream', effects: { openness: 0.13, expansion: 0.07, stability: -0.06 } },
    ],
  },
  {
    id: 'anger-for', type: 'quad', tone: 'heavy', season: 'reaching',
    text: 'What is your anger for?',
    options: [
      { label: 'Protecting something', effects: { attachment: 0.11, stability: 0.07, openness: -0.08 } },
      { label: 'Fuel', effects: { intensity: 0.13, expansion: 0.08, stability: -0.07 } },
      { label: 'Nothing. I put it down', effects: { stability: 0.12, openness: 0.07, intensity: -0.09 } },
      { label: 'I have not found out', effects: { openness: 0.10, intensity: 0.06, order: -0.10 } },
    ],
  },
  {
    id: 'laugh-with', type: 'quad', tone: 'heavy', season: 'opening',
    text: 'Who do you laugh most easily with?',
    options: [
      { label: 'An old friend', effects: { attachment: 0.12, stability: 0.07, expansion: -0.06 } },
      { label: 'A stranger', effects: { openness: 0.12, expansion: 0.08, attachment: -0.07 } },
      { label: 'A child', effects: { intensity: 0.09, openness: 0.08, order: -0.08 } },
      { label: 'Myself', effects: { stability: 0.10, order: 0.07, attachment: -0.08 } },
    ],
  },
  {
    id: 'like-to-make', type: 'quad', tone: 'heavy', season: 'giving',
    text: 'What would you most like to have made?',
    options: [
      { label: 'A home', effects: { attachment: 0.12, stability: 0.09, expansion: -0.07 } },
      { label: 'A tool', effects: { order: 0.12, stability: 0.06, openness: -0.06 } },
      { label: 'A song', effects: { intensity: 0.12, openness: 0.08, order: -0.08 } },
      { label: "Someone's good day", effects: { openness: 0.10, attachment: 0.08, expansion: 0.06, order: -0.05 } },
    ],
  },
  {
    id: 'still-delights', type: 'quad', tone: 'heavy', season: 'giving',
    text: 'What still delights you, even now?',
    options: [
      { label: "Other people's happiness", effects: { attachment: 0.11, openness: 0.07, intensity: -0.05 } },
      { label: 'Being good at something', effects: { order: 0.12, intensity: 0.07, openness: -0.05 } },
      { label: 'Weather', effects: { openness: 0.11, stability: 0.06, order: -0.06 } },
      { label: 'Being surprised', effects: { expansion: 0.11, intensity: 0.08, stability: -0.08 } },
    ],
  },
  {
    id: 'carry-name', type: 'quad', tone: 'heavy', season: 'giving',
    text: 'What would you let carry your name?',
    options: [
      { label: 'A place', effects: { attachment: 0.12, stability: 0.07, expansion: -0.06 } },
      { label: 'A habit someone picked up from you', effects: { openness: 0.09, attachment: 0.08, intensity: 0.05, order: -0.06 } },
      { label: 'An idea', effects: { expansion: 0.12, order: 0.07, attachment: -0.06 } },
      { label: 'Nothing', effects: { openness: 0.10, stability: 0.07, attachment: -0.11 } },
    ],
  },
  {
    id: 'outgrown-fits', type: 'quad', tone: 'heavy', season: 'shedding',
    text: 'What have you outgrown that still fits?',
    options: [
      { label: 'A friendship', effects: { attachment: 0.10, intensity: 0.08, stability: -0.07 } },
      { label: 'A fear', effects: { stability: 0.11, expansion: 0.07, intensity: -0.07 } },
      { label: 'A way of being loved', effects: { openness: 0.10, attachment: 0.06, order: -0.07 } },
      { label: 'A name', effects: { expansion: 0.10, openness: 0.08, attachment: -0.08 } },
    ],
  },
  {
    id: 'in-pocket', type: 'quad', tone: 'quiet', season: 'weather',
    text: 'What is in your pocket right now?',
    options: [
      { label: 'Keys', effects: { stability: 0.06, order: 0.04, openness: -0.03 } },
      { label: 'Something small I kept', effects: { attachment: 0.07, intensity: 0.03, expansion: -0.03 } },
      { label: 'Nothing', effects: { openness: 0.06, attachment: -0.04, stability: 0.03 } },
      { label: 'I would have to look', effects: { expansion: 0.05, openness: 0.03, order: -0.05 } },
    ],
  },

  // ------------------------------------------------------------------ slider
  {
    id: 'past-carry', type: 'slider', tone: 'heavy', season: 'roots',
    text: 'How much of the past should the future carry?',
    poles: ['Nothing', 'Everything'],
    effects: {
      attachment: [-0.14, 0.16], order: [-0.09, 0.10],
      expansion: [0.12, -0.10], openness: [0.07, -0.06],
    },
  },
  {
    id: 'above-ground', type: 'slider', tone: 'heavy', season: 'reaching',
    text: 'How far from the ground should a life be lived?',
    poles: ['On it', 'Far above it'],
    effects: {
      expansion: [-0.10, 0.15], stability: [0.12, -0.13],
      openness: [-0.05, 0.09], intensity: [-0.04, 0.07],
    },
  },
  {
    id: 'let-seen', type: 'slider', tone: 'heavy', season: 'opening',
    text: 'How much of yourself would you let a person see?',
    poles: ['A little', 'All of it'],
    effects: {
      openness: [-0.14, 0.15], intensity: [-0.06, 0.11],
      stability: [0.10, -0.09], order: [0.08, -0.07],
    },
  },
  {
    id: 'order-alive', type: 'slider', tone: 'heavy', season: 'reaching',
    text: 'How much order does a life need before it stops being alive?',
    poles: ['None', 'Total'],
    effects: {
      order: [-0.15, 0.16], stability: [-0.08, 0.11],
      intensity: [0.10, -0.09], expansion: [0.06, -0.07],
    },
  },
  {
    id: 'mourned', type: 'slider', tone: 'heavy', season: 'shedding',
    text: 'How long should a thing be mourned?',
    poles: ['A moment', 'Always'],
    effects: {
      attachment: [-0.13, 0.15], intensity: [-0.07, 0.12],
      expansion: [0.11, -0.10], stability: [0.06, -0.08],
    },
  },
  {
    id: 'wanting-having', type: 'slider', tone: 'heavy', season: 'giving',
    text: 'How much should wanting something count as having it?',
    poles: ['Not at all', 'Completely'],
    effects: {
      intensity: [-0.08, 0.13], openness: [-0.09, 0.12],
      order: [0.11, -0.12], stability: [0.05, -0.07],
    },
  },
  {
    id: 'believe-chose', type: 'slider', tone: 'heavy', season: 'roots',
    text: 'How much of what you believe did you choose?',
    poles: ['None of it', 'All of it'],
    effects: {
      order: [-0.10, 0.14], attachment: [0.12, -0.11],
      expansion: [-0.07, 0.10], openness: [0.06, -0.05],
    },
  },
  {
    id: 'affection-distance', type: 'slider', tone: 'heavy', season: 'opening',
    text: 'How much distance does affection need?',
    poles: ['None', 'A great deal'],
    effects: {
      attachment: [0.14, -0.13], openness: [-0.10, 0.11],
      intensity: [0.09, -0.08], stability: [-0.06, 0.09],
    },
  },
  {
    id: 'fill-glass', type: 'slider', tone: 'quiet', season: 'weather',
    text: 'How full do you fill a glass?',
    poles: ['Barely', 'To the rim'],
    effects: { expansion: [-0.05, 0.07], intensity: [-0.03, 0.06], order: [0.04, -0.04] },
  },

  {
    id: 'voice-borrowed', type: 'slider', tone: 'heavy', season: 'roots',
    text: "How much of your voice is someone else's?",
    poles: ['None of it', 'Most of it'],
    effects: {
      attachment: [-0.10, 0.13], order: [0.09, -0.08],
      openness: [-0.07, 0.11], intensity: [0.08, -0.05],
    },
  },
  {
    id: 'good-at-one', type: 'slider', tone: 'heavy', season: 'reaching',
    text: 'How much would you give up to be very good at one thing?',
    poles: ['Nothing', 'Everything'],
    effects: {
      order: [-0.08, 0.13], intensity: [-0.07, 0.14],
      attachment: [0.10, -0.09], expansion: [0.09, -0.08],
    },
  },
  {
    id: 'how-much-enough', type: 'slider', tone: 'heavy', season: 'giving',
    text: 'How much is enough?',
    poles: ['A little', 'Never quite'],
    effects: {
      expansion: [-0.09, 0.14], stability: [0.12, -0.10],
      intensity: [-0.06, 0.11], openness: [0.05, -0.05],
    },
  },
  {
    id: 'give-knowing', type: 'slider', tone: 'heavy', season: 'giving',
    text: 'How much of what you know should you give away?',
    poles: ['None of it', 'All of it'],
    effects: {
      openness: [-0.10, 0.13], order: [0.10, -0.08],
      attachment: [0.07, -0.08], expansion: [-0.06, 0.10],
    },
  },
  {
    id: 'see-sky', type: 'slider', tone: 'quiet', season: 'weather',
    text: 'How much sky can you see from where you are?',
    poles: ['None', 'All of it'],
    effects: { openness: [-0.04, 0.07], expansion: [-0.03, 0.06], stability: [0.04, -0.03] },
  },

  // ------------------------------------------------------------------ action
  {
    id: 'hold-worth', type: 'action', tone: 'heavy', season: 'shedding',
    text: 'Hold on for as long as it still feels worth holding.',
    action: { kind: 'hold', min: 0.4, max: 9 },
    effects: {
      attachment: [-0.12, 0.16], stability: [-0.05, 0.10],
      expansion: [0.12, -0.09], intensity: [0.08, -0.04],
    },
  },
  {
    id: 'far-enough', type: 'action', tone: 'heavy', season: 'shedding',
    text: 'Move it as far away as it needs to be.',
    action: { kind: 'drag', maxDist: 230 },
    effects: {
      openness: [-0.11, 0.13], attachment: [0.13, -0.14],
      stability: [0.08, -0.07], expansion: [-0.05, 0.10],
    },
  },
  {
    id: 'actual-size', type: 'action', tone: 'heavy', season: 'reaching',
    text: 'Make it the size it actually is.',
    action: { kind: 'scale', min: 0.25, max: 3.2 },
    effects: {
      intensity: [-0.10, 0.15], expansion: [-0.09, 0.12],
      order: [0.09, -0.10], stability: [0.07, -0.08],
    },
  },
  {
    id: 'face-you', type: 'action', tone: 'heavy', season: 'opening',
    text: 'Turn it until it is facing you.',
    action: { kind: 'rotate', turns: 1 },
    effects: {
      order: [0.12, -0.11], openness: [-0.08, 0.12],
      intensity: [-0.05, 0.09], attachment: [0.06, -0.06],
    },
  },
  {
    id: 'where-belongs', type: 'action', tone: 'heavy', season: 'roots',
    text: 'Put it where it belongs.',
    action: { kind: 'place', poles: ['Buried', 'In the open'] },
    effects: {
      openness: [-0.13, 0.14], attachment: [0.11, -0.09],
      order: [0.08, -0.07], intensity: [0.06, -0.05],
    },
  },
  {
    id: 'until-certain', type: 'action', tone: 'heavy', season: 'reaching',
    text: 'Press until you are certain. Let go when you are not.',
    action: { kind: 'hold', min: 0.4, max: 7 },
    effects: {
      order: [-0.10, 0.13], stability: [-0.09, 0.12],
      openness: [0.10, -0.08], expansion: [0.07, -0.06],
    },
  },
  {
    id: 'pull-apart', type: 'action', tone: 'heavy', season: 'opening',
    text: 'Pull the two apart until it stops hurting.',
    action: { kind: 'drag', maxDist: 250, paired: true },
    effects: {
      attachment: [0.15, -0.15], intensity: [0.12, -0.09],
      expansion: [-0.07, 0.11], stability: [-0.06, 0.08],
    },
  },
  {
    id: 'room-for', type: 'action', tone: 'heavy', season: 'giving',
    text: 'Leave room for what has not happened yet.',
    action: { kind: 'scale', min: 0.3, max: 3.4 },
    effects: {
      expansion: [-0.11, 0.14], openness: [-0.09, 0.12],
      attachment: [0.10, -0.09], order: [0.06, -0.07],
    },
  },
  {
    id: 'wind-back', type: 'action', tone: 'quiet', season: 'weather',
    text: 'Wind it back to where you would rather it had stopped.',
    action: { kind: 'rotate', turns: 1.5 },
    effects: { attachment: [-0.06, 0.09], order: [0.05, -0.06], intensity: [-0.04, 0.07] },
  },
  {
    id: 'first-afraid', type: 'action', tone: 'heavy', season: 'roots',
    text: 'Make the first thing you were afraid of the size it was then.',
    action: { kind: 'scale', min: 0.25, max: 3.2 },
    effects: {
      intensity: [-0.09, 0.14], attachment: [-0.06, 0.11],
      stability: [0.09, -0.08], expansion: [0.07, -0.06],
    },
  },
  {
    id: 'hand-out', type: 'action', tone: 'heavy', season: 'opening',
    text: 'Hold out your hand for as long as it takes someone to take it.',
    action: { kind: 'hold', min: 0.4, max: 8 },
    effects: {
      openness: [-0.10, 0.13], attachment: [-0.06, 0.12],
      stability: [0.09, -0.08], intensity: [-0.04, 0.08],
    },
  },
  {
    id: 'give-away-size', type: 'action', tone: 'heavy', season: 'giving',
    text: 'Make what you give away the right size.',
    action: { kind: 'scale', min: 0.25, max: 3.2 },
    effects: {
      openness: [-0.07, 0.09], expansion: [-0.08, 0.10],
      attachment: [0.12, -0.10], intensity: [0.11, -0.05],
    },
  },
  {
    id: 'open-curtain', type: 'action', tone: 'quiet', season: 'weather',
    text: 'Open the curtain as far as feels right.',
    action: { kind: 'drag', maxDist: 200 },
    effects: { openness: [-0.05, 0.07], expansion: [-0.03, 0.05], stability: [0.04, -0.03] },
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
 *   - heavy prompts come from the current season, and others only once it runs dry
 *   - otherwise weight towards types we have used least
 *
 * Whether the next turn is quiet is decided first, and then which prompt. That
 * keeps the share of quiet turns where it was when the bank was mostly heavy:
 * weighting the quiet prompts against one season's worth of heavy ones would
 * have made nearly every third turn a quiet one.
 *
 * Only the answers decide the questions. The plant's condition would be the
 * obvious thing to steer by (more shedding as it wilts), but condition depends
 * on the growth noise, and the question sequence must not.
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

  const season = seasonAt(history.length);
  const quietChance = season === 'roots' ? 0 : heavyRun ? 0.47 : 0.07;
  const wantQuiet = rng.chance(quietChance);
  let toned = candidates.filter((p) => (p.tone === 'quiet') === wantQuiet);
  if (!toned.length) toned = candidates;
  if (!wantQuiet) {
    const inSeason = toned.filter((p) => p.season === season);
    if (inSeason.length) toned = inSeason;
  }

  return rng.weighted(toned, (p) => {
    let w = 1;
    w *= 0.35 + (maxCount - typeCounts[p.type]) / maxCount; // favour under-used types
    if (history.length < 2 && p.type === 'action') w *= 0.4; // ease the player in
    return w;
  });
}
