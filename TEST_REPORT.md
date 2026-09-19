# Test report

Two layers: headless rule tests in Node, and browser checks driven through the
`COLOR_PULSE` test hooks in Chromium (Claude's built-in browser pane), served by
`node tools/serve.js`.

## Headless rule tests

```
node tests/rules.test.js
→ 36 passed, 0 failed
```

| Group | Covered |
|---|---|
| Angles | `norm` over any input; membership inclusive at the start edge and exclusive at the end; wrap-around across the 0/2π seam; two touching sectors never both claim an angle; overlap detection across the seam |
| Ring layout | 200 seeds: the marker always opens inside a dark gap; no sector overlaps; the minimum gap always holds |
| Spawning | 150 seeds × both directions: a new sector is never placed on the marker and always has travel left before reaching it; a sector is unjudgeable while fading in or out |
| Scoring | each colour awards its configured points; one press gives exactly one outcome and a duplicate is swallowed; a single pass cannot be farmed; a gap press costs one heart and no score |
| Hearts | the cap holds; orange still scores at full health; exactly one heart is restored when one is missing; never more than one orange alive |
| Direction | every press flips the direction, ring and game stay in step, and travel actually reverses |
| Timer | expiry costs one heart and restarts the interval; one long frame cannot charge two timeouts; a hit resets the interval; decorative mode never charges one |
| Pause / hidden | pausing freezes timer, angle and clock; presses are ignored while paused; resuming re-enters the countdown with input dead; a 30-second suspension cannot bank penalties |
| Game over | fires exactly once at zero lives; no press registers afterwards; practice never ends a run or spends a heart |
| Restart | score, lives, timer, direction, targets and pending spawns all reset; the same seed reproduces a run exactly and different seeds diverge |
| Speed | ramps to the cap without exceeding it; largest single-frame change 0.063 rad/s, i.e. no visible stepping |
| Consistency | a 4000-frame bot run ends with the score exactly equal to the sum of its awards |
| Spacing | `freeIntervals` merges overlapping and wrapping blocked runs, and no free run overlaps a blocked one; across 12 seeded bot runs no two visible sectors ever overlap or come closer than the 26° minimum gap |

## Rendering

| Check | Result |
|---|---|
| Backend | `webgl` — `WebGL 1.0 (OpenGL ES 2.0 Chromium)` |
| `gl.getError()` | `0` across menu, gameplay, all three flash types and the sprite pass |
| Glyph atlas | built for both sizes (`score`, `label`), rasterised at the device-pixel sizes actually in use (111px / 34px at DPR 2) and rebuilt on resize |
| Uncaught errors | none, captured via a `window.onerror` probe over a full scripted run |
| Fallback | `?renderer=2d` produces `canvas2d` with a live 2D context and a visually identical frame |
| Parity | WebGL and Canvas 2D captures of the same scripted run (green hit → blue hit → heart pickup) are visually indistinguishable: same composition, same flash, same three stacked labels, same heart flight |

### Hearts are never covered by a colour

Verified by reading the WebGL framebuffer with the orange collectible parked on
the marker:

- centre of the heart badge → `[255, 255, 255]`, the white heart
- the orange arc beside it → `[245, 107, 8]`, exactly `#F56B08`

Hearts and text are a separate textured pass drawn after every arc, so no colour
can paint over them. The collected heart's flight is drawn last of all, above
the floating labels.

## Browser checks

| Check | Result |
|---|---|
| Console errors | none from game code. The only warnings came from the test probes' own `getImageData` calls |
| Network | all requests `200`. No 404s, no external requests |
| Assets | 13/13 SVGs loaded; `images.__missing` empty |
| Audio (http) | mode `buffer`; 10/10 WAVs prefetched and decoded; `AudioContext` created only on a gesture and reaching `running`; master gain 0.5 |
| Audio (`file://` path) | with `fetch` forced to fail, the engine falls back to mode `element`, builds 10 pools of 3, plays, and returns `false` while muted |
| Config fallback | with `fetch` failing, built-in defaults remain valid and complete |
| One input, one outcome | one `pointerdown` → 1 judgement; an immediately following duplicate → still 1; a right-click → still 1; a non-primary pointer (second finger) → still 1 |
| Controls do not strike | `pointerdown` on the pause button produced 0 judgements |
| Listener hygiene | after 20 restarts, one click on *Play again* produced exactly 1 `game.start` |
| Mute across restart | muted, then 20 restarts → still muted; `sound:false` persisted to `localStorage` |
| Touch target sizes | full screen 44×44, pause 44×44, mute 44×44, TAP 132×44 |
| Best score | persisted and re-read across runs |

### Full screen

The button renders at 44×44 with the correct label and `aria-pressed`, is wired
to `requestFullscreen` on `documentElement`, swaps its icon on
`fullscreenchange`, triggers a re-layout, and suppresses the blur auto-pause for
700 ms so entering full screen cannot pause a live run.

**Entering full screen could not be verified end to end**: the desktop app's
browser pane refuses the API outright (`TypeError: Permissions check failed`)
even from a real click with user activation, although it reports
`document.fullscreenEnabled === true`. What was verified is the refusal path —
when the request rejects, the button hides itself and the HUD collapses rather
than leaving a dead control, and the game keeps running normally. This needs a
check on a real phone browser.

### Layout fitting

`layout.compute` was run across the required sizes. In every case the ring
clears the hearts, stays inside the viewport bottom, and fits the width:

| Viewport | Ring Ø | Score px | Heart px | Ring top → bottom |
|---|---|---|---|---|
| 320×568 | 262 | 54 | 16 | 176 → 439 |
| 375×667 | 308 | 63 | 19 | 214 → 521 |
| **390×844** | **320** | **66** | **20** | 298 → 618 |
| 414×896 | 339 | 70 | 21 | 318 → 658 |
| 460×634 | 360 | 74 | 22 | 183 → 543 |
| 844×390 (landscape) | 200 | 41 | 12 | 136 → 336 |
| 1024×500 (desktop) | 305 | 63 | 19 | 163 → 468 |
| 300×480 | 246 | 50 | 15 | 168 → 414 |

At 390 px the ring is 320 px and the score 66 px, both inside the brief's
targets (290–330 and 60–72). Resizing recomputes the layout without resetting
the run; the device pixel ratio is handled separately from the CSS size and
capped at 2.5.

## Visual pass against the reference

Captured from the running game and compared with the frame contact sheet:

- **Normal rotation** — dark charcoal track, yellow/blue/small-green sectors with
  flat radial ends and dark gaps, huge white score, three pink hearts below it,
  thin white marker fixed at twelve o'clock, bright green inner arc with a
  visible gap. Matches the clip's composition closely.
- **Green hit** — full-playfield green with the ring and its colours still clearly
  drawn on top, `+5` under the hearts, score counting up. Matches the reference
  green frames, including the flash being *behind* the ring rather than over it.
- **Heart pickup** — orange field, `+3`, the collected heart travelling to its HUD
  slot, the restored heart popping. Matches the reference orange frame.
- **Miss** — red field, ring on top, a heart emptied, and the ring group shaken
  while the HUD stays still. Matches the reference red frame.
- **Game over / how-to / menu** — no reference exists for these; they follow the
  same restrained visual language.

## Bugs found and fixed during verification

1. **Inner arc rendered black on every hit.** `mixHex` returned `rgb(...)` but its
   parser only accepted hex, so feeding its own output back in for the reset
   pulse produced `NaN` and an invalid stroke colour.
2. **The marker could open on top of a sector.** The opening layout closed the
   circle exactly, so a positive starting offset put angle 0 inside the *last*
   sector instead of the first gap. Caught by a 200-seed test.
3. **Replacement sectors spawned behind the marker after a reversal.** Sectors
   are placed inside `award()`, which ran before the direction flip. The flip now
   happens between judging and awarding.
4. **The loading screen never faded out**, because the UI did not know it was the
   initially visible screen.
5. **The travelling heart and the `+N` labels fought over the same band.** Hearts
   now draw last, so they are never covered.
6. **`+1`/`+2` in the how-to were clipped by the scrollbar.**
7. **`half` is a reserved word in GLSL**, so the ring shader failed to compile and
   every load silently fell back to Canvas 2D.
8. **Floating labels could march off the screen.** Each simultaneous label took
   a new lane 40px further out with no bound, so a fast streak pushed the
   outermost ones past the viewport edge. The group is now clamped, and both
   renderers clamp again at draw time as a final guard. Verified with 12
   labels alive at once: all stayed within the playfield.
9. **Sectors could spawn touching, with no dark gap between them.** To keep
   spacing, each existing sector is padded by the minimum gap before free
   space is computed — which makes neighbouring blocked intervals overlap.
   `freeIntervals` assumed they were disjoint and walked them pairwise, so an
   overlapping pair produced a phantom free run spanning other sectors, and a
   replacement could be placed hard against a neighbour. Measured before the
   fix: 91,947 violations in 1.3M pair checks, gaps down to 0°. After: zero
   violations, zero overlaps, smallest gap exactly 26.0°. The spawn tests had
   missed it because they ran against an empty ring. Spotted in a screenshot
   of the deployed site.
10. **The Canvas 2D fallback could not get a context.** A canvas is bound to the
   first context type it hands out, and the failed WebGL attempt had already
   taken it, so `getContext('2d')` returned `null` and every frame threw. The
   fallback now swaps in a fresh canvas element first.

## Not verified

- **Entering full screen**, as above — the browser pane blocks the API.
- Real touch hardware. Touch was exercised through synthetic `PointerEvent`s and
  emulated viewports, not on a physical device.
- GPUs and drivers other than the Chromium build in Claude's browser pane. The
  shaders are WebGL 1 / GLSL ES 1.00 with no extensions, loop bounds are
  constant and uniform arrays are indexed by the loop variable only, which is
  the portable subset. Context loss is handled; automatic restore is not
  implemented.
- Browsers other than that Chromium build. The code uses no APIs outside the
  common baseline and includes fallbacks for WebGL, `AudioContext`,
  `decodeAudioData`'s callback form, `ResizeObserver` and `localStorage`.
- Audio was verified as decoded, routed and gated, but not listened to.
- Long-session behaviour beyond the ~3-minute bot runs in the headless tests.
