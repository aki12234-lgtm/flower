# Flower

A reflective game in which you grow a plant by answering philosophical, emotional
and occasionally spiritual prompts. There is no score and no correct way for the
plant to develop. What grows is a record of the sequence of decisions you made.

This is the first prototype. It exists to answer one question:

> Can a relatively small set of hidden rules produce plants that feel
> meaningfully different, personal, and worth looking back through?

The short answer is yes, and there is a number for it further down.

## Playing it

It is online at <https://aki12234-lgtm.github.io/flower/>, served by GitHub
Pages straight from this repository: whatever is pushed to `main` is what is
played, a minute or so later.

Two versions of it are up, and the switch in the top right corner moves between
them:

| | |
|---|---|
| **v3**, `/` | the live game, printed in flat inks |
| **v2**, `/v2/` | the lit, realistic line as it stood before v3 — `versions/v2-real`, frozen |

Each keeps a plant of its own. On one site they share one `localStorage`, and a
save written by one version is not something the other can carry on from, so
`switch.js` files v2's under a name of its own; going across to look at the
other version and coming back costs nothing.

## Running it

No build step, no dependencies. ES modules need a real origin, so `file://` will
not work — start the little server:

```bash
node tools/serve.js
```

Then open <http://localhost:5173>.

**It has to be served.** Opening `index.html` straight off the disk gives a
blank page: browsers refuse to load JavaScript modules over `file://`, so
nothing starts and nothing is said about why. The page now detects that case and
explains itself, but the fix is always to run the server above.

If it comes up half-grown and will not respond to anything, that is a saved game
it cannot carry on from — most often one that has already ended, in which case
the page is showing you the ending rather than a question. Open
<http://localhost:5173/index.html?reset> to throw it away and start another, or
use the button on the support page below.

If it still will not start, open **`/support.html`**. It reports what the
browser can do — WebGL 2, floating point render targets, the GPU, the display —
and then builds the renderer for real, so the reason appears on the page instead
of as a blank screen. It also reads the saved game back — how many sections it
holds, whether it has already finished, whether the plant is dead, and what
question it thinks is next — because "it always comes up the same and does
nothing" is a description of a save, not of a renderer, and there was no way to
look at one from outside the game. There is a button to copy the report, and one
to wipe the save.

Three other pages and scripts come with it:

```bash
node tools/test.js
```

```bash
node tools/simulate.js 60 24
```

| | |
|---|---|
| `/` | the game |
| `/?sandbox` | a throwaway game that never touches your saved one |
| `/v2/` | v2, the lit version before v3, with a saved game of its own |
| `/gl.html` | the 3D renderer, six plants side by side |
| `/dev.html` | the older 2D renderer, same six plants, for comparison |
| `/guide.html` | the field guide: every botanical kind, material and scene. `?only=kinds`, `?cell=155`, `?snap=1` saves a contact sheet |
| `/mat.html` | the materials sheet: one plant, every substance, side by side |
| `/selftest.html` | browser checks (23), all against the 3D path the game actually uses |
| `node tools/test.js` | rule-level assertions (41 of them) |
| `node tools/names.js` | plays games and prints the cultivar names they end with, and where each word came from |
| `node tools/simulate.js` | plays thousands of games and reports the balance |
| `node tools/tune.js` | raw strain distributions with damage switched off, for setting thresholds |
| `node tools/diagnose.js measured 22` | one game, turn by turn, with the structural numbers |

The server also accepts `POST /_snap` with `{name, data}` where `data` is a data
URL; it writes the file into `tools/snapshots/`. Any page can call it. This
exists because the project is about how it looks, and reading pixel statistics
back out of a canvas turned out to be no substitute for opening the image — a
whole round of "improvements" passed every numeric check while the output was
plainly ugly. There is a materials contact sheet and a set of game-view frames
in there.

## How it works

### Hidden values

Six values — expansion, stability, openness, attachment, intensity, order — all
start at 0.5 and are never shown. Every response moves three or four of them, and
the mapping is cross-wired on purpose: letting go is not simply openness,
understanding is not simply order. The intent is that answers feel consequential
without being decodable.

Internally each value is an unbounded accumulator mapped through a sigmoid, which
buys three properties:

- near the middle, an authored effect of `0.14` moves the value by about `0.11`
- the edges are asymptotic — reachable, never cheap, never pinned at 0 or 1
- a 5% per-turn pull towards the middle means an extreme has to be *maintained*

So a single answer leaves a trace that is still visible eight turns later
(0.61 → 0.58) but a value only reaches ~0.89 after twenty turns of relentless
pushing in one direction.

Second-order readings matter as much as the raw values. `volatility` is how much
the state moved, `pressure` is how hard the answers pushed regardless of whether
anything gave, `reversal` is how often you answered against yourself. Two players
who arrive at the same six numbers by different routes still grow different
organisms.

### Growth

`growth.js` owns geometry and nothing else. It knows nothing about how a section
will be drawn. Tips advance one micro-step at a time, breadth-first, so the
micro-step index doubles as the growth animation's clock — the whole new part
pushes outward at once instead of one strand finishing before the next starts.

**Growth runs at 0, 45 and 90 degrees — but not mechanically.** A tip holds one
of eight bearings for a run of steps, then turns by a quarter or a half of a
right angle, so a stem is a sequence of straight members meeting at hard corners
rather than a curve. Every step is the same length, so runs read as deliberate
lines rather than as a curve that happens to be made of segments.

On top of that each run departs from its ideal bearing by a couple of degrees and
bows very slightly along its length — currently about 1.7 degrees on average and
never past about 10. That is the difference between a drawing of an armature and a
real stem that has been trained into one, and order buys precision: a composed
plant sits close to the lattice, a disordered one wanders off it.

Both halves are asserted, because both matter. The discipline has to dominate
(mean deviation under 4 degrees, 99th percentile under 12) and it must not be
perfect (mean deviation over 0.2). A separate check confirms real runs exist at
all — counting only bearing changes past 10 degrees as corners, so the bow is not
mistaken for one.

Everything that used to nudge a floating-point heading now weights a discrete
choice: **inertia** keeps a run going, **steer** pulls back towards where the tip
wants to be, **winding** makes a tip keep turning the same way (which is what
boxes a stem into a spiral), and **sag** makes unwell growth take the next corner
downhill. Branches leave at 45 or 90 degrees; leaves sit at 45 or 90 to their
stem.

**The armature is sparse, and it has a spine.** Tips that survive a turn are
chosen by thickness *minus* how far out on the structure they sit, so the main
member keeps going while side arms run a little way and stop. Every arm that
stops ends in a bloom. That one rule is what made the thing read as a
constructed piece rather than a bush: flowers sit at the ends of members, the
way they do when someone has assembled one.

Bloom spacing is per tip, not per plant. Sharing a single accumulator meant a
plant with three growing points sprouted three times as fast as one with a single
stem, and bloom counts ranged from 1 to 26 for the same number of answers. They
now land between 5 and 16 after eighteen answers, mostly at the ends.

The values become behaviour: how far growth reaches, how long its straight runs
are, how regular they are, whether it winds, how wide it leans, whether it grows
back down into its own history (attachment), how thick it is, how many arms it
can support, whether branches are mirrored.

Two things are deliberately *not* random:

- **branching** runs off an accumulator, so the number of branches is a direct
  function of the values and only their placement is jittered
- **which tips survive** a turn is a count derived from stability, resolved by
  thickness rather than a coin flip per tip

Both were coin flips in an earlier version, and the consequence was measurable:
two plants grown from completely different answers came out about as different as
two grown from identical ones.

### Members keep out of each other's way

Two rules, both absolute rather than merely unlikely, because either one read as
a mistake whenever it happened. A run may not point back the way the last one
came — a single turn is capped at ninety degrees so it cannot double back in one
move, but two turns the same way could. And a tip may not step onto ground the
plant already occupies: growth is on a lattice, so "is this cell taken" is a
lookup rather than a geometry problem.

Getting that second one working took four attempts, and each failure was
instructive. Sizing the grid from the section's own step length meant every
section laid down a grid that did not line up with the last. Checking only when
a run *begins* let the rest of the run plough through. Handing a branch its
parent's whole trail made it blind to the parent for life — and a branch running
back down its own parent is most of the overlap there is; it needs to be free of
the joint and nothing else. And a tip has to be blind to its own trail entirely,
or a straight run blocks itself on its own previous step.

It goes from about fifteen touches a plant to nine. Not none: what is left is
members passing close enough to touch without either ever choosing a cell the
other had taken, which a grid cannot see and only real segment-to-segment
collision would. The assertion is placed between the two, so it fails outright
if the rule stops working rather than pretending the problem is solved.

One part per answer, too. Every tip kept its own running debt, so a plant with
two or three live tips could put out a leaf on each in the same turn, and a
"symmetric" node grew an opposite *pair* in one go. An answer produces a length
of stem and at most one thing on it.

### The floor

Growth is planar and knows nothing about the sweep the renderer builds later, so
a plant driven downwards carried straight on through the floor and out of the
world underneath it — the one direction with something already in the way.

A tip that cannot take its next step without crossing `y = 0` stops where it is,
and the plant is marked as having come down. The step is **refused rather than
shortened**: clamping the end of it to the floor left one member a fraction of a
degree off the lattice, which is the rule the whole form is built on.

Reaching the ground ends the life. It is a third kind of ending alongside dying
and stopping by choice — the plant has come back down to where it started and
there is nowhere further to go — and the specimen card records it as such. It is
rare: about one game in eighty played neutrally, and roughly one in thirteen when
every answer pushes downward, which is the only way to get there deliberately.

The assertion covers both halves, over ninety games driven down: no point ever
sits below zero, and any plant that touched down has finished and is not still
asking questions.

### Vitality

The plant can weaken, wilt, recover, and die, and none of it is ever shown as a
meter — you read it off the organism. Strain comes from what the plant has
*become*, not from any single choice:

| | |
|---|---|
| `overload` | more mass than the base laid down early can carry |
| `topple` | the centre of mass sitting far off the axis relative to the base width |
| `sprawl` | more growing tips than the structure supports |
| `churn` | volatility and reversal, turn after turn |
| `fixation` | one value held out at an extreme for a long time |

Damage is capped per turn at `0.105`, so **collapse takes at least ten
consecutive turns of accumulated strain** and any of them can be walked back.
That is asserted in the test suite, not just intended.

Damage and healing both apply every turn, so there is an equilibrium load rather
than a cliff: below it the plant recovers, above it the plant declines.

**Reaction wood** is what makes recovery real. `topple` is measured from the
centre of mass, which is a fact about the plant's whole history — new growth is
too small a share of it to move the number, so a plant that ever leaned could
never get better however long you spent putting it right. Traced through, lean
fell from 14.0 to 13.0 over six turns while the plant died anyway. So a leaning
plant now lays down extra timber at the base to carry what it became, exactly as
a real one does. Staying still and not making things worse is a genuine way back;
it just takes a while, and the mass keeps mounting meanwhile.

### The renderer is 3D

The game renders through WebGL2, hand-written, no library — the rest of the
project has no dependencies and no build step and there was no reason for the
renderer to be the exception. Three passes: depth from the light into a 2048²
shadow map, the scene into a half-float target, then a camera pass.

**The simulation did not change at all.** Growth is still planar, every
structural measurement in `growth.js` and `vitality.js` reads the same numbers,
and all 26 rule tests and the whole tuning apparatus carry over untouched. Depth
is derived at mesh-build time from smooth noise along each path, so branches sit
at different distances from the camera and there is something for depth of field
to separate, without the growth system knowing anything about it.

What the geometry actually is now:

- stems are **tubes** swept along the path with parallel-transport frames, so
  they do not spin about their own axis when the path turns
- the node profile modulates the tube radius, so the swelling is in the geometry
- berries and floret heads are **spheres**
- petals and blades are **surfaces** — cupped across, swept along, with normals
  taken from the actual surface derivatives
- the backdrop is a **cyclorama**: a floor that curves seamlessly into a wall,
  three hundred units behind the plant

**Materials stopped being drawing routines and became surfaces.** Each carries
roughness, metalness, how much light passes through, and — the part that
actually tells them apart — its own procedural relief. Roughness alone is not
enough: under one light a rough tube and a smooth tube are both still tubes.
What separates them is that bark runs in fibres along its length, cloth is
woven, clay is dimpled, metal is brushed, mould is spores. Every vertex carries
a material-space coordinate, each material has a height field written in it, and
the normal is bent by that field's slope. Shading is GGX with hemisphere ambient.

The surface coordinates are in world units, so texel density is the same on a
thick member and a thin one. Getting the feature scale wrong is very visible:
the first pass ran sixty noise cells across a forty-unit blade and every leaf
came out looking like netting.

**The flat idioms are screen-space treatments now**, applied only where the
material id says so — the id rides out of the scene pass in the alpha channel.
Vector posterises, line and wireframe key off depth discontinuities, ASCII
indexes a glyph strip rasterised at init, pixel snaps to a coarse grid, halftone
is a rotated dot screen, dither is an ordered Bayer threshold. This is a better
home than they had in 2D: a section rendered as halftone still occludes what is
behind it, still casts a real shadow onto the sweep, and still sits in the same
depth of field as everything else. Only its surface is a picture.

The camera pass does depth of field from the depth buffer, a cheap bloom, ACES
tonemapping, film grain, a little lateral chromatic aberration and a vignette.
Straight linear-to-sRGB looks like a render; the filmic curve is most of what
makes it look photographed.

Two bugs from that work worth recording, both found by measuring rather than
guessing. The first frame was entirely black because the shadow map had compare
mode set while the shader sampled it through a plain `sampler2D`, which is an
invalid operation and silently killed every draw in the frame; the fix also
needed explicit `bindAttribLocation`, because a VAO stores attribute *indices*
and the depth pass declared a different set of attributes than the scene pass.
Then the shadows did not appear: the backdrop was fifteen hundred units behind
the plant, so with a forty-five degree key the cast shadow landed two thousand
units up and out of frame. Projecting a plant point and a backdrop point into
light space by hand showed it immediately.

### Why it might not start

Three things could stop this dead, and none of them used to say anything.

**It was never served.** Modules over `file://` are blocked outright. An
ordinary inline script — which still runs when the module cannot — now catches
that and says what to do.

**The renderer threw.** `new Renderer3D(canvas)` sat at the top of the module
with nothing around it, so a missing extension or a shader the driver would not
take killed the whole file before any of the game ran. It is wrapped now, and
failure puts up a panel naming the cause along with what the machine reports.
`EXT_color_buffer_float` is also checked explicitly rather than requested and
ignored: every colour target here is half-float, so its absence is fatal and
should be said plainly.

**It asked for too much memory.** Two half-float targets and a depth texture
were allocated at the full device resolution — on an ordinary 1440p laptop at
devicePixelRatio 2 that is 5120 x 2880, about 300 MB of GPU memory before
anything is drawn, and four times that on a 4K display. Modest hardware either
refuses the allocation, in which case nothing appears, or accepts it and then
crawls. Rendering is now capped at about 3.4 megapixels however large the
display claims to be; the canvas still fills its box, and at that size the
difference is hard to see. `preserveDrawingBuffer` is off for the game too — it
costs real bandwidth on some drivers and only the pages that read a frame back
afterwards ever needed it.

The browser checks now include one for the symptom itself: load the real page and
fail if it has put up its failure panel, or if the canvas is still the HTML
default size because the module died before sizing it.

### Why it took so long to appear

Measured rather than guessed, and it was not the plant: playing twenty-four
turns costs 10 ms, building the mesh 58 ms, and a steady frame a tenth of a
millisecond. Compiling the shaders costs **592 ms** on a GTX 1070 — the post
program carries every idiom — and it held the main thread for all of it, during
module evaluation, so the browser could not paint anything at all until it was
done. The first thing anyone saw was a blank window for however long their
driver took.

The cost has not gone anywhere, but it no longer has to be spent in silence.
Restoring or starting a game needs no GPU and takes a few milliseconds, so it
happens first and puts the question on screen; the shaders are compiled two
frames later and the organism appears behind it. `KHR_parallel_shader_compile`
is requested as well, which lets a driver do the work off this thread.

First paint went from 656 ms to 60 ms. Nothing about the rendering changed.

### Back to the lattice

Runs used to carry a small fixed departure from their ideal bearing and a bow
across their length — about nine degrees at most — on the argument that a
perfectly straight member reads as a drawing of a plant rather than as one.
Held up against the reference constructions that argument does not survive.
Those are made of pieces cut and joined at right angles and half-right angles,
and the wobble only blurred the single rule the whole form is built on.

Every member now sits exactly on one of the eight directions. Character comes
from which directions get chosen and how long the runs are, not from bending
them, and the plants read as constructed rather than sketched. Signal-to-noise
fell from 2.2x to 2.1x, which is the cost: some of the variety was in the
wobble. It is still well clear of the 1.3x the system needs.

The assertion that guarded this had to be reversed rather than deleted. It
required *both* that the lattice dominate and that it not be perfect; the lower
bound is gone and the discipline is now exact, to within floating point.

### Flowers and leaves

Six kinds was a thin vocabulary for an organism meant to feel particular. There
are now sixteen — disc, cup, bell, globe, spike, umbel, star and pod for flowers
and fruit; leaf, frond, needle, fan, heart, lobed, strap and trefoil for foliage
— and the new ones are built on the same lattice as the stems that carry them. An umbel's stalks, a frond's
leaflets and a needle tuft's spokes all leave at multiples of 45 degrees, so the
discipline holds above the wood as well as in it.

Each kind is weighted by the hidden values, as the original six were: an umbel
is many small parts held in one plane, so openness and order; a pod is what is
left when a flower closes around what it is keeping, so attachment and stability
against openness; needles are intensity with nothing spare.

With twenty kinds and a weighted pick per node, though, one plant grew a sample
of all of them and read as a catalogue. Two at a time is a vocabulary — one form
and a foil for it — where three already looked like an assortment on a plant
this spare.

Two at a time was not enough on its own: the values drift, the top of the list
drifts with them, and a life still gathered four or five kinds. A plant now
remembers what it has grown and weights those heavily, so a vocabulary *settles*.
It can still take up something new when the values move far enough to overcome
the habit, and that becomes the thing it keeps doing. Three kinds a life, at
most, and usually the same two.

The flowers themselves were thinned to match: five to seven rays on a disc
rather than six to eleven, four florets on an umbel arm rather than six, nine
spines on a burr rather than twenty-two. A head with a dozen petals is a
texture; a head with six is a shape, and a shape is what the reference puts on a
bare frame.

`/guide.html` is the field guide. Every kind is shown on the *same* specimen
with only the botany swapped, so the twelve can be compared against each other
rather than against memory, and the materials and scenes get the same treatment.
It exists because the catalogue previously lived only as tables in source: the
only way to find out whether a frond looked like a frond was to play until one
appeared, which is how a flower that had never radiated correctly went unnoticed.

### Three faults that hid the discipline

Putting every run exactly on the lattice did not, by itself, make the plants
look built. Three separate things were undoing it:

**Depth was applied along each member, not between them.** `depthAt` sampled
smooth noise over x and y, and since both change as a stem advances, a member
that was dead straight in the simulation bent through space as it went. A plant
made entirely of 45 and 90 degree runs still came out as a handful of wandering
vines. Depth belongs *between* members — separating branches, giving the camera
something to focus past — so it is now taken once per segment, from its first
point. Joints stay continuous because a branch starts exactly where its parent
was, and every piece is as straight in space as it is on the lattice. Corner
rounding came down from 1.5 to 0.55 at the same time; at the higher value a run
of short members blended into a continuous curve.

**The botanical parts were specks.** A node was about two per cent of the
plant's height — on a two-thousand-unit armature that is punctuation, not a
flower, and the organism read as bare wire. They are roughly twice the size now
and spaced a little closer: bigger and still few, which is what the reference
does, rather than many and small.

**Flowers were not radiating.** The outlines build a head around a centre set
above its node — a disc puts its petals in a ring at `y = size * 0.95` — but the
3D builder measured each petal's bearing from the origin. From far enough below,
a ring of petals all lie in nearly the same direction, so `atan2` returned almost
the same angle for every one of them and the head came out as petals crumpled to
one side. The hub is now found first, from the calyx or from the mean of the
petal centroids, and the petals, florets and receptacle are all placed relative
to it.

None of these were visible in the numbers, and the first two were not visible in
a close-up either — only in a whole plant next to the reference.

### Spare, not thicketed

Twenty answers were producing around sixty members carrying thirty parts, all
fighting for the same space — which is a hedge, not an armature. The reference
is a few clean runs with a great deal of nothing around them, and every part on
it visible *as* a part. Branching, the number of live tips and how often a node
appears were all roughly twice what they should have been. Twenty answers now
give about thirty-five members and ten parts, on one or two tips rather than
three to five.

Signal-to-noise went from 2.01x to 1.93x, which is the price: a sparser plant
has fewer places to differ. Still comfortably clear of the 1.3x the system
needs, and the parts that remain are large enough to tell apart, which they were
not before.

Two browser checks had to be rewritten rather than retuned, because both were
measuring the plant's *size* while claiming to measure something else:

- The reveal check asked what share of the **frame** changed while a section
  grew, which is mostly a question about how much backdrop there is. It now asks
  how much plant is on screen at three points through the reveal and requires
  each to be more than the last — which is what "grows in rather than appearing
  at once" actually means, and needs no threshold at all.
- The ASCII check ran on a ten-answer plant, which is no longer enough subject
  to have light and dark under a glyph grid. It grows one further before
  looking.
- It also asked the *vector* idiom how dark the picture was, because that was
  the nearest thing to hand. Vector posterises each channel separately, so the
  moment the drawn idioms stopped being grey its luminance stopped tracking the
  tone underneath and the check failed on a colour change. There is a hook for
  the flat tone itself now, alongside the ones for shadows and relief.

### Blooms open, they do not appear

A node was drawn at full size the instant the stem reached it, so a whole flower
head arrived between one frame and the next while the member carrying it was
still creeping outward — the growth read as careful and the parts as pasted on.
A bloom now swells over a couple of steps of the same reveal, eased so it starts
quickly and settles.

The first version measured that from the node's own step, which looked right and
was wrong for the ones that matter most: a terminal bloom's step *is* the last
one, so it never began opening within its section's reveal and arrived whole at
the end — the same pop, moved later. It starts swelling as the stem comes up to
it and is out by the time the stem gets there.

The check builds the section alone and without its stem — the whole plant's
extent is set by everything that grew before, and the stem itself genuinely
reveals a point at a time, both of which swamp the thing being asked about —
then samples the reveal finely and fails if any one step accounts for most of
the opening.

### How often the material changes

The rule is in `chooseMaterial`: a substance has to last a minimum number of
answers, after which the chance of changing climbs with how long it has been
held, plus a little for volatility and intensity. It was holding for five and
climbing slowly, which gave about two changes in a twenty-answer life and three
of the thirty-five states seen. The switch is one of the things the piece is
*for*, and almost nobody was meeting it — a state nobody sees may as well not
exist. It holds for three now and climbs faster: a change every six answers,
about five states a life, median run of five. Long enough to register as a
state, short enough to see several.

### The background is a column, not a tint

The backdrop was one flat colour per section, picked from a list of twelve
moods — and it fought the thing the whole piece is built on. Growth happens on
one continuous vertical canvas with the ground at zero and the future upward,
and the background was the only part of the scene that did not know that.

It is a single column now, evaluated in the shader from world position: the
ground a plant grew out of, the air just above it, a band of cloud, the thinning
blue, and then the dark with stars in it. Scrolling down through a plant's
history goes back down through the world it grew in, because they are the same
axis. Which ground — loam, sand, turf, shale, or an ocean — comes from the
plant's own seed and does not change halfway up, and the night comes on as the
organism climbs.

The world is sized from what the camera can see, not from the plant. Sized to
the plant alone it stopped short of the frame at a wide window or a pulled-back
zoom, and the void showed past its edges.

Cloud, birds and stars all sat far above where a plant ever reaches — the sky
had weather in it that nobody would ever meet. Cloud now starts just overhead,
birds occupy the air between, and the stars come in as the column darkens. The
ground has stones and patchy colour in it and hazes into the horizon rather than
meeting it: one flat colour under a plant reads as a card it was stood on, which
is the studio sweep all over again.

Two things went wrong worth recording. Ground and sky were first separated by
*height*, which put the horizon a hundred units above zero — and a seedling's
camera sits inside that band, so a new game opened on a screen of bare earth.
Which way a surface faces says the same thing and says it at every scale: the
sweep's floor points up, its wall points at the viewer.

And `setWorld` was added to the renderer by a string replacement whose anchor
did not match, so the method silently never existed while the game called it
every frame. The frame loop threw on the first frame and stopped, which renders
as a black canvas with a working interface on top of it — the same signature as
half a dozen other faults, and the reason to read the console rather than guess.

### Materials and scenes

Growth produces geometry; materials produce appearance. That separation is what
lets any of the 35 materials render any shape, so a wool section and a wireframe
section join into one continuous organism without either system knowing about the
other. Switching is abrupt on purpose — there is no morph, the new growth simply
begins in a different substance.

#### Forty-one states

Twenty-two substances and nineteen graphic states. The six substances added
last — porcelain, rust, velvet, bone, resin, stone — are palette and surface
only; the 2D drawing routine the older entries carry is for a canvas renderer
that is retired.

Six of the graphic states are **instrument readings**: the organism seen
through something that measures rather than looks. Thermal maps luminance onto a
heat palette; the radiograph treats a silhouette as the longest path through
material, so edges glow and the body shows through; depth colours by distance
from the camera; contour draws a topographic survey with every fifth line
heavier; blueprint is cyan on drafting blue over a construction grid; risograph
prints two inks through screens at different angles, deliberately off register.

These are the one group that covers its subject rather than laying marks on the
scene — a thermal camera does not leave the background showing through, it
reports a value for every pixel it can see.

Two things had to change to fit them. The flat-idiom boundary moved from id 20
to id 40, because the substances had run up against it. And the weight that
keeps graphic states occasional went from 0.15 to 0.20: with fourteen of them
sharing it rather than eight, any *particular* one had become half as likely as
before and a blueprint would have been a thing almost nobody saw. That puts
pictures at about an eighth of switches rather than a fourteenth. The
reachability check now samples 320 games instead of 120 and fails a material
that appears fewer than six times — enough to tell "rare" from "unreachable",
which is the distinction it exists to make.

#### Six more, each its own thing

Added from a set of references that were deliberately *not* one style:

- **flock** — a dense even pile, finer than wool and fuzzier than velvet, the
  only new one that is a substance rather than a treatment.
- **collage** — cut paper: flat areas of colour with a torn edge, the tooth of
  the stock showing through, and a hard little shadow where one piece lies over
  another. The tear is what makes it collage; a clean edge reads as vector.
- **smoke** — it does not have an edge, it has a place where it stops being
  dense enough to see. Density follows the light and dissolves into the ground
  rather than meeting it.
- **stipple** — single dots, all the same size, tone being nothing but how many
  there are. That is the whole discipline of it: a stipple that varies its dot
  size is a halftone, which is already here.
- **blockprint** — flat colour inside a heavy keyline, the way a lino cut
  separates its areas. Unlike lineart the fill carries the colour and the line
  is there to hold it.
- **illumination** — manuscript work: flat colour, a gold keyline rather than a
  black one, and a ground that is never quite clean.

Smoke and stipple are printed from something lit, like the other screens.
Collage, blockprint and illumination are drawings and stay flat.

Three of the six needed a second pass, and each was wrong in a way worth
recording:

- **Stipple** raised its wanted density to a power, which crushed everything but
  the deepest shadow to bare paper — a drawing with dots only where it is nearly
  black describes an outline, not a form. Density now runs across the whole
  tonal range, and the shadows are where it *gathers* rather than the only place
  it appears.
- **Block print** was quantised in three steps *per channel*, which on a
  saturated colour still leaves a gradient running along a member; one flat
  colour is the whole point of a cut block. Its keyline was also a soft wide
  band, which is shading by another name — a cut edge is one width and hard on
  both sides.
- **Collage** tinted its fill by a few per cent of hash and called that stock,
  which is invisible. Real paper has felted fibre, a laid pattern from the mould
  it was made on, and flecks of pulp that never broke down; the edge is torn
  rather than cut, and the piece carries a shadow where it laps over what is
  behind.

#### What a surface is made of, in colour

Everything below varied a material by how rough it was and by how much its
height field lightened and darkened it — which is monochrome. That can make a
surface look bumpy; it cannot make it look like a particular substance. Rust is
not brown wood with deeper pits, it is orange oxide in patches over bare iron.
Granite is pale stone with dark mineral grains through it. Blue-and-white
porcelain is *drawn on*. Those are facts about colour, and none of them could be
said before `patternTint`.

Each substance that has one now gets its own: rust's oxide taking unevenly over
iron; stone's light and dark grains; porcelain's blue underglaze with a darker
line where the brush turned; bone yellowed unevenly and pitted; metal's brushed
streaks running the length rather than across it; amber's darker seams; the
ash-bloom on charcoal; the fibres in a living stem.

#### Prints are made from something lit

Grain, halftone, dither and riso describe tone by how much ink lands, and ink
that lands evenly describes nothing — a flat subject screened at one density is
a shape, not a picture. More ink in the shadows is the whole reason those
processes can carry an image at all. They keep the ordinary lighting in the
scene pass and are screened afterwards: the marks stay flat, the ground still
shows through, and how many of them there are follows the light.

Thermal and the depth pass joined them: a thermal camera pointed at a lit object
sees the light, and a depth pass is the one reading that genuinely does not — so
that one is shaded after the fact instead, because distance alone renders every
surface at one remove as a single flat sheet of colour.

The drawn idioms — vector, line, ASCII, pixel, wireframe, blueprint, contour and
the radiograph — stay unlit. Those are drawings rather than prints, and the
distinction is the useful one.

They also kept only two fifths of their pigment, mixing the rest towards white,
which washed every one of them out to grey. Normalising a pigment to unit
luminance is what lets the stepped tone own the range; the point was to keep the
hue, not to discard it. A vector illustration of a green plant with red fruit is
green and red.

#### What actually makes two materials look different

For a while every substance came out looking like the same substance with a
different gloss, and the reason turned out to have nothing to do with roughness.

A material only ever changed three shading numbers. The **pigment** came from
the plant, not the material: `stemColour` pulled hue 68% and lightness 58%
toward the plant's own `baseHue`, which is right — a plant should stay itself
across a material switch — but it meant wool, clay and glass were rendered in
exactly the same colour. Colour is the first thing anyone reads. So the material
now owns saturation, lightness and warmth through a `PIGMENT` table applied
*after* the hue blend, where it cannot be washed out, while the plant keeps the
hue. Clay goes chalky terracotta, wool pale and desaturated, charcoal nearly
colourless, watercolour thin on white.

Saturation and lightness are not enough for a substance whose identity *is* a
colour, though. Rust, velvet and resin first came out as three shades of the
same red, because the plant's own hue survived intact and only brightness told
them apart — and iron oxide is not crimson, nor is amber. `PIGMENT` carries a
target hue and a pull towards it, applied to blooms as well as stems, so a rust
plant does not grow crimson berries.

The **blooms ignored it entirely**. `bloomColour` swung hue up to ±105° per
head and then clamped saturation and lightness to fixed windows, which both put
cyan leaves on a green plant and overrode whatever the material had done — a
wool plant grew glassy teal buds. Blooms now take one flower hue per plant from
the range flowers actually occur in relative to foliage, vary by ±11° between
heads, and clamp *relative* to the stem colour, so a wool bloom stays wool.

The **relief was measured wrong**. The height-field gradient was sampled at a
fixed offset in uv, but feature sizes across these materials span more than a
decade — wool's fuzz against clay's dimples. A fixed offset is a fine derivative
for coarse fields and a wild over-step for fine ones, so it flattened precisely
the surfaces that should have been roughest: wool measured *smoother* than clay.
It now samples a fixed fraction of each material's own cell, via `featureFreq`.

Two fields were also simply too coarse to exist. A cell spans `1/(0.19 × mult)`
world units and a stem is about eight units across, so clay at 0.16 put less than
one cell on the entire plant: it was flat by construction, whatever its bump
strength said. Clay and wax were rescaled to feature sizes that fit on a stem.

Finally, two things were missing from the lighting that no roughness value can
substitute for. **Sheen** — the pale retroreflective rim on fibre at grazing
angles — is what separates cloth from matte plastic, and wool, thread and
embroidery now have it. **Grazing reflectance** gives every surface a mirror at
a shallow angle; without it a smooth dark material had no sun lobe to catch and
glass and charcoal rendered as flat black silhouettes rather than substances.

`/mat.html` exists because none of this is arguable from a table of numbers.
It renders one plant in every material at a chosen zoom — `?zoom=3.4&only=wool,clay&cell=440`
— through a single shared WebGL context, since a browser quietly drops all but a
handful of live contexts and a sheet of 23 otherwise comes back blank.

#### The glyph ramp, measured rather than guessed

The ASCII ramp was ordered by eye, and it was wrong in the middle: 'x' covers
more of its cell than '*' does, so the mapping ran backwards across part of its
range. It is now sorted by rendering each character once and measuring how much
ink it actually puts down — which also makes it correct on whatever monospace
font the platform happens to supply, rather than on the one it was written
against.

The check for that is worth separating from the drawing-level one. Whether the
type follows the form and whether the ramp is the right way round are different
claims, and the first cannot see the second: inverting the ramp still leaves a
plant covered in characters with tonal structure, and the drawing check went on
passing. Reading the ordering straight off the atlas is unambiguous, and it
caught the defect the moment it was written.

#### Flat colour is what gives a model away

No leaf and no petal is one colour. A petal is paler, often yellower, where it
joins: that is where the nectar guide sits and where the pigment runs out. A
leaf is deepest at the stalk and pales towards the edge, where the blade is
thinnest and there is less of it to hold chlorophyll. And a stem is uneven along
its length — older wood duller, newer growth brighter — warming towards red at
every node, which is the commonest tell that a thing grew rather than being
extruded.

All three were a single flat fill. `blade` now takes a base and an edge colour
as well as its own, and the stem's colour moves along the member.

Broad leaves also grew **secondary veins**, leaving the midrib at forty-five
degrees like everything else here. A blade with a rib down the middle and
nothing else is a shape; the branching is what the eye actually uses to read it
as a leaf.

#### Everything is attached to something

Blooms are built around a centre set above the node that carries them — a berry
cluster a whole node-size up, a flower head rather less — and nothing joined
them to the plant, so fruit hung in the air beside the stem. Real clusters hang
from a pedicel and every fruit is held by its own stalk; a flower head sits on
the end of one too. Both are built now, which also gives the eye something to
follow between the stem and the part.

Leaves had the same fault and it was easier to miss, because a leaf sitting
directly on a stem looks *nearly* right — botany even has a word for it,
sessile, and it is the exception. Every blade now grows from a petiole.

#### What the parts were getting wrong

Held against how the real things are built, four of the sixteen were not the
thing they were named after:

- **A spike was a flat blade**, which is a leaf shape. What makes a bulrush or a
  plantain a spike is that it is *round* and densely packed and stands on its own
  bare stem. It is a tapered cylinder now, on a length of clear stalk.
- **A bell had no builder at all** and fell through to the petal code, so it came
  out as a ring of separate petals radiating from a point — the one shape a bell
  is not. A foxglove is a single fused tube that hangs and flares at the lip.
- **Foliage was inflated and glossy.** The blades were cupped hard enough to curl
  into scoops and carried the section's full specular, so leaves read as a row of
  shiny pillows. They are flatter, longer, roughened relative to the material
  they are made of, and every broad one has the midrib it should always have had.
- **Petals were shells.** Same cupping problem, on the part where it matters most.

The remaining kinds — umbel, star, needle, frond, trefoil, pod, globe — were
structurally right and only needed their attachment.

#### A page has to start even when nobody is watching

Deferring the renderer past first paint was done with `requestAnimationFrame`,
which does not fire in a hidden or offscreen frame — so a page nobody was
looking at got its prompt up and then waited forever for a frame that never
came, with no plant behind it. Waiting for a frame is an optimisation, not a
requirement, and it needed a way out: a timer fires the same boot if no frame
has arrived. The browser check found this, because it loads the real page in an
offscreen iframe, which is precisely the case that broke.

#### Joints, again

The collar was darkened by an eighth, which is exactly what made the joint
*visible*: a sphere in a different colour from the wood either side announces
itself as a separate object however well it is placed, and the eye reads a seam.
It is the same colour as the member now, slightly larger so nothing of the
crease underneath shows past it, and carries the same surface relief. Whatever
shading a joint deserves, the light gives it. The flare feeding into it was
lengthened and softened too — a short sharp one leaves a step where it ends,
which is another edge to catch on.

#### Joints

Growth spawns a branch at its parent's exact point with a fraction of its width,
so the two tubes simply interpenetrated: a thin pipe butted into a thick one,
which is the one thing no plant does. A real branch leaves through a swollen
collar and flares into the wood it comes from. Three things were added, all in
the mesh builder so the simulation stays planar and every structural measurement
keeps reading the same numbers:

- the base of a branch **flares** back toward its parent's girth, decaying over
  about eight world units;
- a **collar** sits at the junction, barely proud of the flared stem — a sphere
  much wider than the wood reads as a bead threaded onto it rather than a joint;
- **both ends of every stem are rounded.** `tube` caps only its far end, so
  each segment start was an open ring you could see down the inside of, and
  where a stem genuinely stopped the far cap faced the camera as a cut pipe.
  Where one section runs into the next the rounding is buried inside the
  following segment and costs nothing, so it needs no special case.

Internode swellings became geometry at the same time. They had been a 20% colour
darkening at a single point, which is a stripe, not a node.

#### The ASCII idiom

It rendered as random dots, and the atlas was not at fault — it holds real
glyphs. Every *fragment* picked its own character from its own luminance, so one
cell was painted with pieces of several different letters at once. Type needs the
brightness read once per cell and the whole cell drawn as that one glyph, which
is now what happens: the colour is sampled at the cell centre and carries both
the character and the tone.

The ramp also ran backwards — bright areas were taking the densest glyphs.
Ink is what you add to paper, so brightness runs the ramp in reverse. Cells are
sized in CSS pixels rather than device pixels, because at `devicePixelRatio` 2
a seven-pixel cell is three and a half pixels of actual type and no character is
legible at that size. Halftone, dither and pixel had the same latent problem and
were scaled the same way.

#### Relief is two things, and only one of them is light

Bump mapping bends the normal, which is enough to shade a surface and not
enough to *be* one: the outline stays perfectly smooth, so a rough material
still reads as a smooth object with roughness drawn on it. The silhouette is the
one part no amount of shading can touch, and it is the first thing that gives
the trick away.

Every substance now moves its own surface. `RELIEF` gives each an amplitude as a
fraction of the member's radius and a feature size along and around it, and the
tube and sphere builders take a displacement function. Wool stands about 16 per
cent of its radius off the ideal cylinder, rust 17, glass half of one. Some of
them are not noise at all — a cord is twisted, a stem is ridged along its
length, a satin stitch runs across it, and noise alone gave all three the same
lumpy character.

Two shading changes went with it. **Cavity occlusion** darkens the pits: light
reaching the bottom of a crevice has to get past the walls of it, and without
that the relief reads as a pattern of highlights lying on a flat surface rather
than a surface with depth in it. And with the outline now carrying the coarse
relief, the normal perturbation could be pushed considerably harder.

The check for this took three attempts, and the first two were measuring the
wrong thing. Comparing wool's silhouette against glass's read wool as the
*smoother* of the two — wool is pale against a pale sweep, so the mask was
picking up colour contrast rather than shape. Comparing displaced against
undisplaced fixed that but still showed nothing, because the metric was the
ratio of boundary pixels to area, and a rippled outline grows both together.
The displacement is geometry, so it is now asserted as geometry, in the node
suite where no GPU is involved: build the same plant twice, with the
displacement on and off, and measure how far the vertices moved. That reads
16 per cent of radius for wool and 0.5 for glass, and it goes to zero the moment
the feature is disabled — which the shading numbers never noticed at all.

#### The flat idioms are pictures, not surfaces

Even with legible type, ASCII still read as something laid *on* a plant rather
than as the plant. The cause was architectural: the idioms were a screen-space
treatment applied at the end of a fully photographic pipeline, so an ASCII
section was a lit, specular, depth-blurred, film-grained render with characters
sprinkled over the top. Every cue underneath said photograph.

They now leave that pipeline in two places:

- **In the scene pass** a flat idiom gets a stepped light instead of the full
  GGX evaluation — no specular, no sheen, no relief, no translucency. Seven
  steps across almost the whole range, because flatness alone is not enough: a
  narrow band of tone left ASCII picking from the middle of its ramp and a
  drawing came out in four near-identical characters.
- **In the camera pass** those pixels return early, before depth of field, lens
  colour fringing and film grain. All three are artefacts of a camera looking at
  a real object. Only the vignette is kept, because it belongs to the frame
  rather than to the plant, and skipping it would cut the section out of the
  picture.

Depth is untouched, so a section drawn this way still occludes what is behind it
and still casts a real shadow onto the sweep — it is a flat picture standing in
a lit room, which is what the abrupt material switch is supposed to feel like.

Grain changed kind at the same time. Multiplying noise over the render was
literally dirt on a photograph; it is now a stochastic screen that decides per
speck whether ink lands at all, so tone is carried by how many specks are inked,
the way newsprint does it.

#### A drawing has no light source

The flat idioms were still taking a stepped lambert term, which gave every
member a bright side and a dark side and rounded it into a tube — the bevel that
gave the whole thing away as a 3D render wearing a 2D costume. They take no
light at all now. A flat graphic gets its form from its outline and from flat
areas of tone butting against each other, never from a gradient across a
surface, and geometric displacement is off for them too: a picture should not
have a lumpy three-dimensional edge.

Tone instead comes from what a part *is* — the pigment it was given, quantised
hard, so a stem, a leaf and a bloom are three flat areas — plus a few flat tiers
by depth so overlapping shapes read apart. Flat illustration separates planes
with tints; it does not light them.

That has to be stretched across the range a plant's pigments actually occupy,
which is narrow: albedo luminance runs from about 0.03 to 0.16 across a whole
organism. Quantising it as though it filled 0 to 1 put ninety-five per cent of
the plant in one bucket, so the first version of this drew the entire plant in a
single character.

#### A screen pattern has to be on the plant, not on the screen

Every one of these — the glyph grid, the halftone rosette, the Bayer threshold,
the pixel cells, the stipple, the riso screens, the blueprint grid — was
measured from `gl_FragCoord`, which anchors it to the display. That looks
perfect in any single frame and comes apart the moment anything moves:
scrolling drags the plant across a stationary grid, so every cell's contents
change as it passes underneath and the type crawls and pops. It is the
"shower door" failure, and no still image can show it.

The patterns are now measured from the camera's own pan, which fixes the grid
to the plant — where a thing that is supposed to be *printed on it* belongs.
Cell size stays constant in pixels, so zooming still slides them; a drawing
that scaled with its subject would go sub-pixel as soon as the plant got small,
which is a worse trade.

Two of the idioms read the scene buffer back (ASCII samples each cell to choose
its glyph, pixel snaps to a cell centre), and those samples have to be converted
out of grid space again, because the buffer is still indexed by the screen.

#### The rim around a drawn shape

A bright thread traced the outline of every flat section, in a green that
appears nowhere on screen. It came from the buffer underneath: a flat idiom's
pixels still hold the ordinary lit colour there — the drawing is made from them
afterwards — and the *backdrop* around them goes through the photographic path,
which reaches across that boundary. Depth of field gathers a disc of neighbours,
and the lens fringing fetches a red and a blue tap sideways.

Guarding both of those was not enough, and the reason is the interesting part.
Each guard asked "is this sample part of a drawing?" by decoding the material id
out of the sampled alpha — but the buffer was filtered **linearly**, so a tap
landing on a silhouette returned a *blend* of two ids. A blend of 40-something
and zero is around twenty: not any material at all, and comfortably below the
threshold, so every guard answered "no" on precisely the pixels where it
mattered, and the tap contributed half the plant's raw colour to the background.

Alpha here is data, not coverage, and data must not be interpolated. Both
half-float targets are sampled with `NEAREST` now. No amount of guarding the
*uses* could have fixed it while the reads themselves were being averaged, which
is why it survived two rounds of fixes that each looked correct.

A check guards it now, because a still frame of any single idiom shows it
plainly: beside a drawn shape, the backdrop should still look like the backdrop.
It reads 0.9 per channel.

#### Depth without light

Flat illustration separates planes by cutting them apart, so where a nearer
shape crosses a farther one a thin gap of the ground shows through and the two
read as layered paper. That is a drawing device rather than a shading one, and
it costs the flatness nothing. Only where both sides belong to the drawing —
doing it at the outer edge would put a line around the whole thing, which is the
rim all over again.

The flat tonal tiers had to be fixed to go with it. They were read from the
fragment's own world z, and on a tube that varies across the width — so the
curving edge of every member landed in a different tier and got its own band of
tone. Which plane a shape sits in has to be one value for the whole piece, so it
now arrives per part, in the roughness slot that a drawing has no use for.

The check for it has to move the camera: it renders the plant, scrolls by a
whole number of device pixels, shifts the second frame back by exactly that
many, and compares. Only the pattern can differ. A screen-locked grid reads
about 11 per channel there and a plant-locked one about 2 — the residual being
perspective, since world-to-screen scale is only exactly `zoom x dpr` at the
plane the plant sits in.

#### There is no paper

ASCII, halftone, dither and grain all say the same thing: light means less ink,
dark means more. Tone is carried entirely by concentration, which leaves nothing
for a paper colour to do — and filling the silhouette with white made each
section look like a sticker stuck onto the scene. The gaps now show what is
actually behind the plant, so the drawing is made only of marks.

That needed the backdrop kept aside before the plant covers it: the scene pass
draws the sweep, blits the colour buffer into a second target, and only then
draws the plant, so the camera pass can composite ink over the real background.

A mark takes the opposite side of the backdrop's own luminance — near-black on a
pale sweep, chalk on a dark one — so a drawn section stays legible whichever of
the twelve scenes the plant is standing in. A little of the section's colour is
mixed back in so it keeps its identity.

Getting tone into those marks took two more passes at it. Multiplying the
stepped light by the plant's own albedo meant a mid-green stem sat at the dense
end of every ramp, and halftone came out as a single solid mass of ink; lifting
the pigment towards white flattened the range from the other side instead. The
flat path now takes the pigment's **hue but not its darkness**, and lets the
stepped light own tone outright.

Then exposure. A print does not get brighter because the room is dim, but the
dark scenes expose up by a quarter, which blew every flat idiom out to near
white — ASCII had almost no tone left to read. The flat path aims at a tone on
the page and divides the camera's exposure back out to hit it.

**There is one light, in world space, from the upper left.** Because growth is
now made of straight runs, each run can be shaded exactly: `cylinderGradient`
walks across the run's width computing a surface normal, and returns a real
wrapped-lambert term, a specular band that moves with the run's angle, and edges
that fall off because they are turning away rather than because a colour stop was
put there. A stem climbing to the right and a stem climbing to the left catch the
light differently, which is most of what makes a material read as a solid object.
A browser check asserts it: a vertical stem is brighter on its left flank, a
horizontal one brighter on top, and by different amounts.

Each physical material then differs by its actual optics rather than by its
palette — clay has a wide soft terminator and almost no specular; wax glows on
its shadow side because light is coming through it; glass is a dim body with both
rims caught bright; metal has a tight specular and anisotropic streaks; wool has
a shaded core under fibres that reach past the silhouette. Corners darken where
runs meet, the way a real joint occludes. The flat idioms — vector, line, ASCII,
pixel, halftone, dither, wireframe — deliberately ignore all of this.

**The realism lives in the blooms, not in the stems.** An earlier pass put fibre
striations, grain, thumbprints and joint occlusion on the members, and it read as
dirt. The reason is scale: a stem is four to ten pixels wide, so surface detail at
that size is sub-pixel and resolves to noise. In the reference photographs the
stems are clean, and every bit of the realism is carried by the flower heads,
which are large enough to hold it. Each bloom is built from separate parts —
petals, a dark centre, a throat, florets — and each takes a hue a long way from
the stem's, seeded per bloom, so one armature carries several unrelated species.
That is the reference's actual subject: hybrid botanical construction, separate
plants physically joined.

**What the reference actually is, and what I had backwards.** Going back to the
Latour board and comparing frame by frame turned up one structural mistake and
three smaller ones.

The mistake: in those photographs the *armature* is one substance — a green
stem, a brown branch, cactus pads — and the *flowers* supply all the variety.
Several unrelated species are joined to one body. I had it half inverted: the
stem was changing material every two or three sections, so a single organism
came out as segments of cream, olive, dark and striped, which reads as assembled
tubing rather than as one plant. Materials now hold for at least five sections
(two to three per plant instead of five or six), and when they do change they
keep the plant's value as well as its hue, so the join reads as a change of
substance rather than a change of colour block.

The rest:

- *No stem in the reference is cream or white.* Four materials were rendering
  pale enough to look like drinking straws; they are warmer and darker now, and
  the plant's base hue is drawn from green or woody brown, never the straw
  between them.
- *Those are seamless studio sweeps.* Rain streaks, drifting stars and pollen
  over the subject read as game effects. Particle rates are down to about a
  third.
- *Nothing in the photographs has bristles.* The wool fuzz and mould spores
  reached far enough past the silhouette to look like spines growing out of the
  stem, and narrow petals collapsed into needles once foreshortened — a ring of
  needles reads as an insect, not a flower. Both are pulled in.

**Regularity is what makes something look like an asset.** Every disc was
radially symmetric with identical petals; every head faced the viewer squarely;
the stem nodes were evenly spaced like bamboo; nothing anywhere was damaged.
That combination reads as a library asset no matter how well it is lit, because
nothing in a garden is regular. So:

- *No two petals are alike.* Each gets its own length, width, angle and curl, one
  is usually stunted, and sometimes one is missing outright.
- *Heads are foreshortened.* Each bloom carries a tilt and a spin, so a round
  head reads as an ellipse seen from an angle — in life you almost never see a
  flower square on. Leaves and spikes are held back from the strongest squash,
  since a blade is already flat and squashing it just makes a stub.
- *Internodes vary.* Evenly spaced nodes are bamboo or plastic tubing; each gap
  is now drawn from its own length.
- *Blades are lopsided and sometimes bitten.* The two halves differ in width,
  the midrib bends, and a third of them have a notch out of one edge.
- *Petals attach to a calyx*, which takes the stem's colour rather than the
  flower's, because it is part of the plant.

**The model matters more than the shading.** Several rounds of work went into
lighting a shape that was, underneath, a tapered ribbon with a gradient on it —
and it kept looking like a drinking straw, because that is what it was. What
fixed it was changing the geometry:

- *Stems are articulated.* A real stem swells at a node where a leaf attached and
  pinches just above it, and carries that rhythm the whole way up. `stemProfile`
  modulates the width along arc length to produce it, and the material draws a
  darker collar and a small scar at each node. This is the single most
  recognisable thing about a stem and no amount of surface texture substitutes
  for having it in the geometry.
- *Stems are ribbed.* Three to seven ridges run the length of almost any stem.
  They are drawn from the same lighting model as the body, so each catches the
  light according to where it sits around the circumference rather than being a
  decorative stripe.
- *Berries are spheres.* They were equal-sized discs scattered at random, which
  reads as bubblegum. A cluster is now spheres of varying size emitted
  back-to-front so painter's order does the occluding, each with a contact
  shadow on its shaded side and a single small specular *point* offset towards
  the light — not a gradient.
- *Composite flowers have a floret head.* The centre was a flat dark circle. It
  is now three dozen tiny spheres on a phyllotactic spiral, which is what a
  daisy centre actually is.
- *Petals shadow each other, have veins, and curve.* A petal is a shallow trough
  along its own length, so one side of the midline catches the light and the
  other falls away — shading that runs *across* the petal, on top of the shading
  that runs along it. Filling with a single axial gradient is what left them
  reading as cut paper however carefully they were coloured.
- *Members are long.* Short runs turning constantly read as a grid rather than
  as bent stems. Runs are now half again as long, with more inertia against
  turning, which cost some signal-to-noise (2.5x to 2.2x) and bought the
  reference's more relaxed line.

**The three things that made it read as a real object.** In order of how much
they did:

1. *A cast shadow on the backdrop.* A shape with no shadow floats in front of a
   colour; a shape with one is standing in a room. Each section drops a soft,
   offset, blurred copy of itself before anything else is drawn. It shadows the
   ground behind it, not the rest of the plant — real inter-object shadows would
   mean giving up the per-section cache.
2. *Rounded corners.* Growth turns at hard angles because that is the rule the
   organism is built on, but no real stem bends to a knife edge — it makes a
   radius roughly its own thickness. The fillet is applied at draw time, so the
   simulation stays exactly as discrete as it was while the thing on screen
   reads as material that has been bent.
3. *No outline.* See the caveat below.

**One colour family per plant.** Each organism picks a base hue and every
material's own hue is pulled 62% of the way towards it. Materials are still told
apart by their optics; they are no longer told apart by being salmon next to
mint. Before this the armature read as tangled wiring rather than as a plant, and
it was the single biggest thing wrong with the look.

**The flat idioms are accents, not the default.** Eight of the twenty-three
materials are pictures of a plant rather than substances — vector, line, ASCII,
pixel, halftone, dither, wireframe, grain. They are weighted down to 0.16, so a
typical organism is mostly substance with the occasional collision. At equal
weight most plants read as construction drawings.

**What stops a substance reading as a vector shape with a texture on it.** Four
things give that away, and none of them is the texture:

- *An exact silhouette.* Nothing real has a ruler-straight edge at any
  magnification. `roughenRibbon` pushes the edges about with smooth noise, a few
  percent of the width.
- *Shading that varies across the width but not along it.* A gradient fill is
  constant down the length; an object is not. `alongRun` modulates lightness
  along each member's axis, which also breaks the specular so it stops reading as
  a perfect stripe.
- *A shadow that is just a darker highlight.* Real light is warm where it lands
  and cool where only the sky reaches, so the hue shifts across the terminator.
- *A hard cut against the background.* Every real surface is feathered, so edges
  get a thin dark turn and a wider soft one instead of a stroke.

Blooms get the same treatment: petals are filled along their own axis, dark where
they meet the centre and bright towards the edge, with outlines that wobble — no
petal has a curve you could draw with a compass, and at bloom scale that is
plainly visible.

The feathering is worth a caveat. It was applied to stems too, and at a member
six pixels wide the two feather strokes *are* most of the member, so they read as
an outline and made everything look like pipe cleaner. Stems now have no outline
at all: their edge is simply where the shading has fallen off.

Two browser checks hold this in place: one measures that a real material's
silhouette wanders (but not more than a few pixels) and that its shading varies
down its length; the other that a vertical member and a horizontal one catch the
light differently.

Mitring matters more than it sounds: pushing each point out along an averaged
normal pinches an elbow to 70% of the stem's width and a right angle to half of
it, which with hard corners everywhere would have been visible on every stem.

The 12 environments are chosen from a *different* read of the same values
(exposure and altitude, rather than substance and handling) and held on their own
counter, so neither predicts the other. A test asserts that materials keep turning
up under more than one sky.

Scenes are backdrops, not skies. The reference photographs put these
constructions against a plain swept ground: one colour, a soft falloff, one
light. An earlier version had dramatic five-stop skies with big value ranges,
and they competed with the plant instead of holding it. Each ramp now stays
within roughly fifteen points of lightness and carries one soft light source in
screen space, plus a dither pass — large canvas gradients band badly on 8-bit
displays, and that banding was the most artificial-looking thing on screen.

Measured on the comparison grid, the plant now covers 2–8% of the frame. The
negative space is the composition.

Both changes are sticky — materials hold for at least two sections, scenes for at
least three — because variation that happens every turn stops reading as variation.

## Does it work?

`node tools/simulate.js 60 24` plays six kinds of player 60 times each and reports
this:

```
strategy         died  turns  height  spread   arms  curve  vert  down  mat  env
drifting           3%  23.8    2195     730    2.9  0.110  0.60  0.15  5.5  4.4
withholding        0%  24.0    1502     631    2.3  0.129  0.40  0.27  5.3  4.5
reaching          23%  23.4    2158    1508    3.1  0.089  0.64  0.10  5.4  4.5
contradicting     10%  23.5    1944     886    2.8  0.105  0.59  0.15  5.3  4.5
measured           0%  24.0    2316     785    3.0  0.109  0.60  0.16  5.3  4.5
leaning            0%  24.0    1864     682    2.5  0.120  0.48  0.22  5.3  4.4
```

Consistent players produce consistently different organisms: `withholding` grows
a short, tightly boxed piece that spends 30% of its length heading downward, while
`reaching` grows one three times as wide that turns back a quarter as often. Careless play can kill a plant; considered play rarely does.

The headline number is separation of signal from noise. Two plants can differ
because the answers differed, or because the random stream fell differently — only
the first is the game working. The two random streams are kept independent (one
picks the questions, one wanders the stems) precisely so this can be measured:

```
same script + noise, different answers : 1.216
same answers, different noise stream   : 0.540
signal / noise                         : 2.25x
deterministic replay                   : yes
```

Answers move the shape roughly **three times** as much as luck does. `/dev.html`
shows the same comparison visually — flip the mode dropdown to see the noise-only
version, where the six plants are recognisably siblings.

## Tuning

The strain thresholds were not chosen by feel. `tools/tune.js` runs the same six
players with vitality damage switched off and prints the raw ratios each one
actually produces, so each threshold can be placed above the considered players
and below the careless ones:

```
player          carry(p50/p90)   lean(p50/p90)
withholding       5.49 / 8.14     3.31 / 4.37
leaning           5.77 / 8.49     3.47 / 4.54
measured          6.51 / 8.60     4.02 / 9.42
drifting          5.46 / 7.22    5.08 / 17.46
contradicting     5.00 / 8.67    5.65 / 13.14
reaching          5.84 / 7.36   15.11 / 30.80
```

`lean` separates play styles cleanly, so `K_TOPPLE` sits at 6.8. `carry` barely
separates them at all — it mostly tracks how long the game has run — so
`K_OVERLOAD` sits at 6.2 and acts as a slow late-game pressure instead of a
style judgement. Both moved a long way when the armature got thin: a member four
to eight units wide has far less second moment than the old trunk, so every
strain ratio shifted at once. That is what the harness is for. All constants live in `TUNING` in `src/vitality.js`.

## A note on what the tests check

An early version of `selftest.html` asserted that the ending, reflection and
specimen panels were hidden by reading `element.hidden`. All three reported
hidden. All three were nevertheless painted on top of the game from the first
frame, because `.curtain { display: grid }` outranks the user agent's
`[hidden] { display: none }` and so the attribute did nothing at all.

The checks now read `getComputedStyle` on the real page, loaded in an iframe
with `?sandbox`, plus a separate check that the `hidden` attribute beats every
`display` rule in the stylesheet. Asserting on the state a component *believes*
it is in is not a test. Asserting on what is actually on screen is.

The same failure came back in a worse form. After the renderer moved to WebGL,
eleven of the fourteen browser checks were still driving the retired 2D canvas
path — fourteen green ticks that proved nothing whatever about the image. A test
that cannot fail when the thing it names is broken is worse than no test, because
it gets read as evidence. They were rewritten against the 3D renderer, and the
first honest run failed immediately on exactly the complaint that had prompted
it.

Two things were needed to make those renderer checks mean anything. They compare
frames only where the plant actually is — a whole-frame average is dominated by
an identical backdrop, so two genuinely different materials scored as the same —
and the mask is then **eroded away from its own boundary**, because a silhouette
edge is the highest-contrast thing in the frame and is identical whatever the
surface is made of. Before eroding, wool and clay measured 11.7 against 11.2,
which was a measurement of their shared outline.

Even eroded, a roughness statistic could not order them: depth of field softens
fine fuzz more than coarse dimples, so felted wool scored no higher than smooth
clay. The check now asks the question directly instead of through a proxy — it
switches each material's relief off via `uRelief` and measures what changed. That
ordering is unambiguous (wool 10.2, clay 2.7, glass 0.0), and it is what caught
clay having no surface at all.

Three more checks written since then were each **verified by breaking the fix and
watching them fail**, and three of those first drafts passed on the broken code:

- ASCII legibility first compared raw luminance per cell, and passed on the
  random-dot renderer, because a cell's paper colour already tracks the picture
  and swamped the glyph entirely. It now measures ink coverage against each
  cell's *own* ink and paper, and separately that a cell is printed in one tone
  — the sharper tell, since per-fragment glyph choice took its colour per
  fragment too. That second measure needed its sample kept clear of antialiased
  glyph edges before it separated anything.
- The camera-above-floor check built its own centroid camera and passed with the
  fix removed, because it was not exercising the code path that broke. It now
  frames through `camYToPlaceAt`, the call the game itself makes.
- That same check then measured the *top* of the frame, because `lumAt` counts
  y downwards from the top while `readPixels` returns rows bottom-up.

The ASCII check then had to be rewritten twice more, both times because the
thing it measured had stopped being true rather than because the drawing was
wrong. Measuring ink as *darkness* was right only while the paper was white:
once a mark took the opposite side of the backdrop's luminance, every section on
a dark sweep was drawn in chalk and read backwards. Ink is now distance from the
unpainted scene, which does not care which way it went. And the tone it was
being compared against was the photographic render, which is a different
function from the flat one ASCII actually quantises — it is now compared against
the flat drawing, and judged at a zoom where a stem is several glyph cells wide
rather than two. The paper-flatness half of the check was dropped outright: with
no paper left to paint, it no longer discriminates anything.

Changing the growth rules then broke three renderer checks at once, and the
common cause was that each named a **fixed zoom**. When the geometry changed,
those framings silently landed somewhere useless — the surface sample went from
7,617 pixels of plant to 71,097, and the ASCII check ended up judging a close-up
of one shadowed stem where every cell correctly picked the same dense glyph and
there was nothing left to correlate. Framing is now derived from the plant:
`fit` shows the whole organism, and `stemZoom(px)` asks for a typical member at
a given width, which is what a check about surface or about glyphs actually
wants. A reveal check that averaged over a whole frame of unchangeable backdrop
was rewritten to count the pixels that moved.

Two of those investigations were pure guesswork until the checks started
**writing the frames they judged** to `tools/snapshots` on failure. The first
dump showed a solid block of one character, which is what sent me looking at the
framing; the second showed dense type over the brightest part of the plant,
which is what exposed a real rendering bug — ASCII was point-sampling one pixel
at each cell's centre, so over a cluster of berries or a stem a few pixels wide
it landed in a gap as often as on the subject and chose the glyph for whatever
happened to be there. It now averages five taps across the cell, which is what
an ASCII conversion actually does. That one change moved the measured
correlation from +0.56 to −0.34.

The last −0.34 was a single plant being unrepresentative rather than anything
wrong: the check now runs over three, where it reads −0.61. A threshold set
against one organism is really a threshold set against that organism.

The general rule that keeps emerging: a visual check has to be confirmed against
a picture before it is trusted as a gate, and a check for a specific bug has to
be run against that bug before it is trusted at all. The corollary, learned
later than it should have been: make the check able to hand you the picture. Each of these was diagnosed by putting
the render on screen and looking at it, and only then was the metric written to
match what was visible. `/mat.html` and the `POST /_snap` endpoint in
`tools/serve.js` exist for that step.

## Against the brief's prototype checklist

Everything on the list is implemented: one continuous vertical canvas, Point 0 at
ground level, all four response types, 80 prompts, the hidden-value system,
procedural growth with several distinct behaviours, 23 visual states, 12
environmental states, abrupt visual switching, scrolling through history, the
vitality system with wilting and death, voluntary ending, plant naming, and the
final written reflection.

A few notes on how specific requirements were met:

- **History is visual first.** Past questions are not on screen. Click any past
  section to reveal the question, your answer, and the step it belongs to; a
  "↑ now" chip appears whenever you have drifted away from the growing tip.
- **A dead plant stays faithful to its final state.** Each section stores the
  vitality it had when it grew, so old healthy growth keeps its colour while
  recent growth dries out. Nothing is retouched at the end.
- **The game never interprets for you.** The only lines it ever volunteers are
  four short condition notes ("It is turning away from the light."), which
  describe and never explain. The final card lists what the plant is made of and
  how big it got. What it means is left alone.

## Files

```
index.html  styles.css        the game
dev.html                      six plants, six answer sequences
guide.html                    the field guide: kinds, materials, scenes
mat.html                      one plant in every material, side by side
selftest.html                 browser checks

src/rng.js                    seeded random, value noise
src/values.js                 the six hidden values and their second-order readings
src/prompts.js                80 prompts, their seasons, and the rules for choosing them
src/names.js                  cultivar names: genera, the words behind every answer, the turning point
src/growth.js                 geometry: tips, branching, thickening, structure
src/vitality.js               strain, wilting, recovery, death
src/materials.js              35 materials, palettes, node shapes
src/environment.js            12 scenes, bands, crossfading
src/engine.js                 one turn, with no rendering in it
src/render.js                 camera, section caching, scenes, particles
src/ui.js                     prompts, the four response types, endings
src/main.js                   bootstrap, camera, input, saving
src/dev.js  src/selftest.js   the extra pages
src/gl/devgl.js devmat.js     the 3D comparison grid and the materials sheet
src/gl/devguide.js            the field guide

tools/serve.js                static server
tools/test.js                 rule assertions
tools/simulate.js             balance and signal-to-noise
tools/tune.js                 raw strain distributions
tools/diagnose.js             one game, turn by turn
```

`engine.js` is deliberately free of the DOM. That is what lets the tuning and test
harnesses play thousands of games headlessly under node.

## Known limits

- **Reloading does not reproduce an uninterrupted session.** How far along each
  random stream was is not saved, so both are reseeded from the seed plus the
  answers given. A reloaded game is still deterministic — reloading twice
  continues identically — but it diverges from what the same answers would have
  produced without the interruption. Storing the stream position would fix it.
- **Very long games get heavy.** Each section keeps its own cached bitmap. Past
  roughly forty sections the memory is worth attending to; the cache is capped
  per section but not in total.
- **Values rarely leave 0.25–0.75.** Every growth coefficient is scaled to that
  band, which works, but it means the extreme ends of each value are mostly
  theoretical. Worth revisiting if prompts get stronger effects.
- **The plant sways as one piece.** The sway is applied per cached section, so it
  is kept deliberately small — a larger amplitude would shear the joins between
  sections.
- **Sound, the specimen gallery, and mobile gesture polish are not built.** The
  archive is written to `localStorage` but nothing reads it back yet.
- **Signal-to-noise sits at 2.2x, down from 3.6x before growth went discrete.**
  Choosing between five turns is coarser than nudging a heading, the per-run
  angle deviation adds draw on top, and lengthening the members added more.
  Still well clear of the 1.3x the system needs, but it is the figure to watch
  if the members get any longer.
- **Framing is better but not solved.** The camera now frames the last three
  sections rather than the newest tip, which stopped most of the empty-screen
  cases, but a sparse plant can still sit low in the frame. A seedling in the
  first few turns is also very small against a lot of empty sweep — the camera
  no longer falls through the floor there, but it does not move in close either.
  Framing on the nearest bloom would finish both.
- **Framing still lands low on a sparse plant.** Better since it frames the last
  three sections rather than the newest tip, but a thin organism can sit at the
  bottom of the frame with empty backdrop above it.
- **Nothing casts a shadow onto anything else.** Each section is lit and cached
  independently, so a branch passing in front of a stem does not darken it. Real
  contact shadows would mean giving up per-section caching, which is what keeps
  the raster materials affordable.
