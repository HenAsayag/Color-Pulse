# COLOR PULSE

A minimalist circular timing game. The white marker at twelve o'clock never
moves; the ring of colours turns underneath it. Press once when a colour is
under the marker. **Every press reverses the direction of rotation.**

Built from the supplied Color Smash asset kit and reference clip.
Created by Hen Asayag.

## Run it

```bash
node tools/serve.js
```

Then open <http://localhost:8080>.

`index.html` also works opened directly from disk (double-click it). Over
`file://` the browser blocks `fetch`, so the game automatically falls back to
pooled `<audio>` elements for sound and to its built-in configuration defaults.
Serving it is still preferable — that is the path where `config/game-config.json`
is read and Web Audio is used.

## Controls

| Action | Input |
|---|---|
| Strike | Tap the playfield, click, <kbd>Space</kbd>, <kbd>Enter</kbd>, or the **TAP** button |
| Pause / resume | <kbd>Esc</kbd>, <kbd>P</kbd>, or the pause button |
| Mute | The speaker button, or the Sound setting in the menu |
| Full screen | The corner-brackets button, top right |

The full-screen button is aimed at phones, where the address bar eats a good
part of a portrait viewport. It appears on touch devices and narrow windows
whenever the browser allows it, and stays reachable from the menus as well as
during a run, so a phone can be set up before play starts. It hides itself on
browsers with no element full-screen API (iOS Safari on iPhone) or where the
host refuses the request, rather than leaving a dead control on screen.

## Scoring

| Target | Points | Notes |
|---|---|---|
| Yellow | +1 | widest |
| Blue | +2 | |
| Green | +5 | narrow, hardest |
| Orange | +3 | also restores one heart, capped at three |

Striking a dark gap costs a heart. So does letting the inner countdown ring run
out — six seconds per strike. Three hearts; the run ends when the last one goes.

**These values are reconstruction defaults, not rules recovered from the
original game.** See [ASSUMPTIONS.md](ASSUMPTIONS.md) for what the reference
clip actually shows and what was completed by design.

## Layout

```
index.html              markup and the screen structure
styles.css              dark minimal shell, menus and controls
src/config.js           every tuning value, in one object
src/rng.js              seeded generator (mulberry32)
src/geometry.js         angle convention and arc maths
src/ring.js             sectors, spawning, collision
src/game.js             rules, scoring, lives, state machine
src/color.js            colour parsing and mixing
src/layout.js           viewport fitting, shared by both renderers
src/effects.js          feedback TIMING only: flashes, ripples, labels, pops
src/gl.js               WebGL plumbing: programs, textures, glyph atlas
src/renderer-gl.js      WebGL renderer (default)
src/renderer-2d.js      Canvas 2D renderer (fallback)
src/audio.js            Web Audio, with an <audio> fallback
src/input.js            pointer and keyboard
src/ui.js               screens, settings, persistence, practice coach
src/main.js             boot, the single animation loop
assets/svg, assets/audio    the kit artwork and sounds
config/game-config.json     tuning, read when served over http
tools/serve.js          zero-dependency static server
tests/rules.test.js     headless rule tests
kit/                    the original brief and kit documents, unmodified
```

Menus and controls are ordinary accessible DOM. There is one animation loop and
one simulation clock, and the simulation advances only while a run is live.

## Rendering

The playfield is **WebGL**. The whole ring — flash background, charcoal track,
every colour sector, the inner countdown arc, the ripples and the fixed marker —
is a single fullscreen quad whose fragment shader evaluates the ring
analytically in polar coordinates. Nothing is stroked or tessellated on the CPU,
and every edge is anti-aliased in the shader against its own pixel-space
distance, so the arcs stay clean at any device pixel ratio. One draw call covers
the entire ring.

Hearts and text are a second, textured pass drawn **on top of** the ring, which
is also why a heart can never be covered by a colour. Text has no native form in
WebGL, so the eleven characters the game actually shows (`0123456789+`) are
rasterised into a glyph atlas at the exact device-pixel size in use and rebuilt
on resize — digits stay crisp instead of being scaled from one baked size, and
they keep the fixed tabular advance so a count-up never shifts sideways.

`src/renderer-2d.js` is an automatic fallback used when a WebGL context cannot
be created. Both renderers share `src/layout.js` and read the same state out of
`src/effects.js`, so the two paths cannot drift apart. Append `?renderer=2d` to
the URL to force the fallback.

### Angles

One convention throughout: **0 rad is twelve o'clock, positive is clockwise,
radians.** It matches the SVG kit. Conversion to canvas space happens in exactly
one place, `geometry.toCanvasAngle()`. Collision never reads a rendering value.

## Tuning

Everything lives in `src/config.js`. When the game is served over http, the
values in `config/game-config.json` are fetched and merged over them, so the
game can be retuned without touching code. Useful knobs:

- `rules.reverseOnPress` — set `false` for continuous one-way rotation
- `rules.timerMode` — `'countdown'` or `'decorative'` (also a menu setting)
- `rules.seed` — set non-zero to make every run use the same layout
- `rules.speedStartRadPerSec` / `speedMaxRadPerSec` / `speedPerPoint`
- `effects.*` — flash, ripple, label and count-up timings

## Tests

```bash
node tests/rules.test.js
```

Headless tests covering angular boundaries and wrap-around, one input to one
outcome, score farming, the heart cap, timeout handling, pause and hidden-tab
clock preservation, direction reversal, restart hygiene and seeded determinism.
Browser-side results are in [TEST_REPORT.md](TEST_REPORT.md).

## Accessibility

- `prefers-reduced-motion` is honoured by default; reduced-motion and
  reduced-flash are also separate settings
- Flashes are coalesced rather than stacked, and capped in reduced-flash mode
- All controls are at least 44×44 CSS px
- A WebGL failure falls back to Canvas 2D rather than showing a blank page
- Menus are real focusable DOM; score and life changes go to an `aria-live` region

## Assets

All artwork and sounds come from the supplied kit and are original work for this
project. The reference video and contact sheet were used for visual analysis
only and are **not** shipped as game art. The kit's WAVs are original synthesized
effects, not audio recovered from the referenced game. No reference music is
used, and the meme caption and mouse cursor visible in the clip are recording
overlays that are deliberately not reproduced.

The project's SVG copies are byte-identical to the kit originals except for an
added explicit `width`/`height` on each root element, which gives `drawImage()`
a reliable intrinsic size across browsers.
