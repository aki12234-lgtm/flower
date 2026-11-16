// The looks: the ways the whole picture can be drawn, and the player's to choose.
//
// A look is not what the plant is made of (that is a material, and comes from
// the answers) and not where it grows (that is a place, and comes from the
// seed). It is the hand the whole scene is drawn in, plant and world together,
// and nothing but the player ever changes it: it used to turn over on a clock,
// and a place going magenta on its own reads as the game breaking.
//
// `renderer` is which of the two renderers draws it. For the 3D one, `style` is
// printed ('toon') or lit ('real'), and `idiom` is a material id from MAT_ID
// that everything in a lit picture is handed, so every stage after treats the
// plant, the ground and the sky as one drawing.

export const LOOKS = [
  { id: 'print', name: 'Print', renderer: 'gl', style: 'toon', idiom: 0 },
  { id: 'flat', name: 'Flat', renderer: 'flat' },
  { id: 'real', name: '3D', renderer: 'gl', style: 'real', idiom: 0 },
  { id: 'riso', name: 'Riso', renderer: 'gl', style: 'real', idiom: 53 },
  { id: 'ascii', name: 'ASCII', renderer: 'gl', style: 'real', idiom: 43 },
  { id: 'blueprint', name: 'Blueprint', renderer: 'gl', style: 'real', idiom: 52 },
  { id: 'halftone', name: 'Halftone', renderer: 'gl', style: 'real', idiom: 45 },
  { id: 'line', name: 'Line', renderer: 'gl', style: 'real', idiom: 41 },
  { id: 'blockprint', name: 'Block print', renderer: 'gl', style: 'real', idiom: 57 },
  { id: 'thermal', name: 'Thermal', renderer: 'gl', style: 'real', idiom: 48 },
];

export const LOOK_BY_ID = Object.fromEntries(LOOKS.map((l) => [l.id, l]));

/** Where the chosen look is kept. It belongs to the player, not to a plant. */
export const LOOK_KEY = 'flower.look.v1';

/**
 * What the ASCII look is written in: every question asked and the answer
 * given, in order, and then the question now on the table.
 */
export function wordsOf(engine) {
  const said = [];
  for (const s of engine.plant.sections) {
    if (!s.promptText) continue;
    said.push(`${s.promptText} ${String(s.responseLabel || '').replace(/[.?!]*$/, '')}.`);
  }
  if (engine.prompt?.text) said.push(engine.prompt.text);
  return said.join(' ');
}
