# Meaning, stages and cultivar names

A planning document. Steps 1, 2 and 4 of the order of work at the bottom are
done; the rest is not implemented yet.

## What the game is about

The plant is the player's own journey. Some players will read it as grief or as
love, and that is fine, but the game is not about either. It is about the person
answering.

Working title: **Cultivar**. A cultivar is a variety that exists because of how
it was grown. At the end the player learns which cultivar they grew.

## Decisions so far

- **Research-grounded, not a test.** The questions stay poetic. They are designed
  around established psychology, but the game never claims to measure the player.
  The wording is "informed by", never a diagnosis. That matters most for players
  who bring grief into it.
- **The game is endless.** It ends in one of three ways:
  `natural` (the plant dies), `grounded` (it grows back down to the floor), or
  `voluntary` (the player ends it, allowed from step 4). Nothing can assume a
  fixed length.
- **The game offers an interpretation; it does not impose one.** At the end the
  game proposes a cultivar name and a journey text. The player can keep them,
  edit them, or replace them with their own. This replaces the README principle
  "the game never interprets for you" with "the game offers, the player decides".
- **Names are procedural.** No AI API. The same answers always produce the same
  name, it works offline, and it needs no server.

## The research behind it

| Part of the game | Grounded in | Honest status |
|---|---|---|
| Hidden values | Big Five personality traits, adult attachment, affect intensity | Big Five is the best-supported model in personality psychology |
| Seasons of the cycle | Erikson's psychosocial stages | Influential theory; mixed empirical support |
| Journey text | McAdams' narrative identity: turning points, redemption and contamination sequences, agency and communion | Well researched, and directly about how people tell their own journey |
| Returning questions | Test-retest; change over time within a person | Standard method |

How the six hidden values line up. This is an inspiration, not a measurement,
because the effects are cross-wired on purpose (see `src/values.js`):

| Value | Nearest construct |
|---|---|
| openness | Openness to Experience (Big Five) |
| order | Conscientiousness (Big Five) |
| expansion | Extraversion, the approach and reach side (Big Five) |
| stability | Emotional Stability, the inverse of Neuroticism (Big Five) |
| attachment | Adult attachment, holding on versus distance (Bowlby; Fraley and Shaver) |
| intensity | Affect intensity (Larsen and Diener) |

Agreeableness has no value of its own. The question bank barely touches it
either, which is one of the gaps listed below.

**Keep the growth mapping and the meaning separate.** The effects on hidden
values stay cross-wired so the plant cannot be decoded. Each prompt gets
separate meaning tags (`season`, and later `agency` or `communion`) that feed
only the journey text and the name. The plant stays mysterious while the story
stays grounded.

## Seasons: an arc that works at any length

1. **Roots** happens once, for the first 3 answers. Where you come from, what
   you hold. (Erikson: trust, autonomy.)
2. Then a **cycle** that repeats for as long as the game lasts, about 4–6
   answers per season:
   - **Reaching**: will, choice, who you are making yourself into. (Identity,
     industry.)
   - **Opening**: other people, being seen, love. (Intimacy.)
   - **Giving**: what you make, want, and leave behind. (Generativity.)
   - **Shedding**: loss, memory, letting go. (Integrity.)
3. **Condition override (not done, needs a decision).** The idea: once the
   plant is `wilting` or worse, Shedding questions become much more likely. The
   catch is that the question sequence has to depend on the answers alone. The
   plant's condition depends on the growth noise, and the tests and
   `simulate.js` need the two separate to measure anything. It could steer by an
   answers-only signal instead (churn, fixation), or the rule could be relaxed.
4. **Weather**: the quiet prompts. They are not tied to a season and exist for
   pacing, as they do now.
5. **Returning questions.** From the second cycle on, now and then, re-ask a
   question the player answered at least 12 answers earlier. The journey text
   can then show real change: "At step 3 you said forgetting is a loss. At step
   31 you called it a mercy." A returning question counts as an answer like any
   other.

## The bank

Now 80 prompts: Roots 13, Reaching 14, Opening 14, Giving 13, Shedding 13,
Weather 13. The 31 new ones fill Giving and add joy, pride, curiosity, anger,
fairness and forgiveness. `pickPrompt` takes heavy prompts from the current
season, keeps the old share of quiet turns (about 1 in 5), and falls back to
other seasons only when a season runs dry, which happens after about three
cycles.

Authoring note: across the bank the *last* option leans slightly towards
openness and expansion and away from attachment and order. Nothing in the game
depends on it, but `tools/simulate.js` builds its players from option position,
so new prompts should keep it or the balance numbers blur.

### Before the new prompts (49)

| Season | Prompts | Count |
|---|---|---|
| Roots | owed, unremembered, return-place, belong, carry-out, past-carry, believe-chose, where-belongs | 8 |
| Reaching | repeat-refuse, choose-wrongly, self-built, waiting-staying, notice-first, what-you-trust, above-ground, order-alive, actual-size, until-certain | 10 |
| Opening | door-warm, known, silence, changed-preserved, promise, survives-translation, let-seen, affection-distance, face-you, pull-apart | 10 |
| Giving | outlive, person-lives, wanting-having, room-for | 4 |
| Shedding | understand, ends-well, grief, forgetting, stays-longest, never-open, time-is, keep-too-long, mourned, hold-worth, far-enough | 11 |
| Weather | light-room, facing, finish-books, morning-sound, fill-glass, wind-back | 6 |

### Gaps (as found before the new prompts)

- **Giving is thin.** It has 4 prompts and needs about 12.
- **The whole bank leans towards loss.** A person's journey also contains
  wonder, desire, pride, play, curiosity and anger. There are almost no
  questions about joy, and the journey text cannot tell a redemption story if
  nothing good can be said.
- **Agreeableness and conflict are missing.** Forgiveness, fairness and anger at
  someone else barely appear; `a grudge` is the only trace.
- **Endless play needs volume.** Aim for about 12–15 prompts per season plus
  about 12 weather prompts, roughly 75–85 in total. Returning questions stretch
  that further.

## Cultivar names (built: `src/names.js`)

Format: ***Genus* 'Adjective Noun'**, plus a closing phrase in longer games.
For example: *Cordatia* 'Insatiable Imprint at Noon', *Luminaria* 'Even Husk',
*Custodia* 'Settled Trowel'.

**Genus** comes from the two strongest hidden values at the end: 15 pairs, 15
genera. Each one has a one-line gloss for the journey text, e.g. *Focaria*, "a
hearth: a strong fire kept in one place". A plant whose strongest value is
still below 0.6 is *Aequalia*, "nothing in it pulled harder than the rest"
(about 2% of games). Some genera are rare by design: *Tendrilla* needs
expansion and attachment together, and those usually pull against each other.

**Words.** Every option of every prompt has an `[adjective, noun]` pair.
Sliders and actions have three pairs (low, middle, high); a slider's middle is
the same narrow band the game labels "in the middle", so the word never
contradicts what the player was told.

- **Noun:** from the **first answer**.
- **Adjective:** from the **turning point**, the answer that pushed hardest
  against the direction the values had been moving over the four answers
  before it. If nothing pushed back by more than `TURN_THRESHOLD` (0.035), the
  journey was steady, and the adjective comes from a list of steadiness words
  instead: Steady, Evergreen, Perennial, Abiding and so on. That is about 18%
  of games.
- **Closing:** for games of 12 answers or more, the season the journey ended in:
  *at Noon* (reaching), *in Bloom* (opening), *at Harvest* (giving), *at Dusk*
  (shedding).

This differs from the first sketch, which put a third word from the recent
stretch into the name ('... of Profile'). That read badly: two nouns from
unrelated answers do not combine. The recent stretch belongs in the journey
text instead.

Deterministic, and not affected by growth noise or by saving and reloading. In
2000 simulated games 98.5% of names were distinct, so names are unique in
practice but not guaranteed. `node tools/names.js` prints the numbers and
sample names with the answer behind each word.

## Journey text

It is written from fragments and follows narrative identity research:

- **Opening:** the first answers, quoted. "You began by saying the person you
  were is owed something."
- **Turn:** the turning point, told as a redemption sequence (strain, then
  recovery: vitality fell and came back) or a contamination sequence (it was
  going well, then something gave). If there was no turn, it describes
  steadiness.
- **Returns:** any returning question whose answer changed, quoted side by side.
- **Close:** one line per ending type:
  - `natural`: the plant is kept as a pressed specimen. The text says what it was
    carrying, without judgement.
  - `grounded`: it came back to where it started, and the circle closes.
  - `voluntary`: it ends on the last choice the player made.
- **The name:** one sentence tying the cultivar name back to the moments it came
  from.

Rule: every sentence must point at something the player actually did. Nothing
generic that would be true of anyone (the Barnum effect).

## How "offer it" fits the current flow

The existing flow is ending card → reflection screen (name and reflection
fields) → specimen card.

- The reflection screen shows the journey text, with the name field pre-filled
  with the cultivar name. The player can keep, edit or clear it.
- The player's own reflection box stays underneath, still optional.
- The specimen card shows the final name, the journey text if the player kept
  it, and their own reflection.

## Order of work

1. Add `season` tags to all prompts and make `pickPrompt` season-aware. This is
   playable and testable in `tools/simulate.js`.
2. Write new prompts for Giving, joy and conflict.
3. Returning questions.
4. Name generator (genus table and word banks), testable in Node.
5. Journey text.
6. Changes to the reflection screen.
