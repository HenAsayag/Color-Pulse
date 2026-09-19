# Evidence and assumptions

What follows separates what the supplied 10.7-second clip actually shows from
what this build decided in order to be playable. Nothing in the second list is a
recovered original rule.

## Observed in the reference clip

Taken from the video and the frame contact sheet, and reproduced here:

- Near-black portrait playfield, no background art or gradients
- Very large white score high in the frame, changing smoothly rather than jumping
- Three small pink heart slots directly below the score, filled and outlined
- A thick dark charcoal circular track
- Yellow, blue and a small green moving arc segment, flat radial ends, separated
  by dark gaps
- An occasional orange segment carrying a white heart glyph
- A stationary thin white marker at twelve o'clock, above the track
- A thin inner arc with a visible moving gap, shifting between green, lime and
  yellow
- A green full-playfield success flash, a red failure flash, an orange
  heart-collection flash — in every case the ring and its colours stay clearly
  drawn **on top of** the flash, so the flash is the background, not a wash over
  the scene
- A translucent expanding circular pulse
- Floating `+5` and `+3` labels beneath the hearts, which can appear side by side
- Lives changing; the excerpt runs from roughly 208 to 239

Deliberately **not** reproduced: the meme caption, the mouse cursor, the
social-video overlays, the music, and the pause glyph near the end (which may
belong to the video player rather than the game).

## Supplied by the user

- **Every press reverses the direction of rotation.** This was not derivable
  from the clip; it was specified directly during development and is implemented
  as the default (`rules.reverseOnPress`).

## Reconstruction defaults

Each of these is a design decision, configurable in `src/config.js`.

| Area | Default | Why |
|---|---|---|
| Input contract | one press judges the sector under the marker | The clip never shows the player's hands or an instruction screen. |
| Yellow / Blue | +1 / +2 | The clip only ever confirms +5 and +3. Ordered by how wide each target is. |
| Green | +5 | Confirmed by the clip's `+5` labels alongside green flashes. |
| Orange | +3, restores one heart, capped at 3 | `+3` and a heart filling are both visible; the cap and the full-health behaviour are choices. At full health it still scores. |
| Gap press | costs one heart | Consistent with the red flash and heart loss, but the cause is not visible. |
| Inner arc | a 6-second countdown per strike, reset on every resolved press | The clip shows a thin arc with a moving gap changing colour. A timer is a plausible reading, **not** an established one. `rules.timerMode: 'decorative'` (a menu setting) switches it to pure motion if this reading is wrong. |
| Timeout | costs one heart, once, then restarts the interval | Never observed. |
| Speed | 2.8 rad/s, +0.012 per point, capped at 5.2 | Estimated from the clip, which sits near the cap at scores of 208–239. Eased over 600 ms so it never steps. |
| Sector widths | yellow 65°, blue 48°, green 14°, orange 23°, jittered | Kit values, close to the frames. |
| Minimum gap | 26° | Chosen so every target stays reachable. |
| Orange spawn | 18% per successful hit, never more than one alive | Balancing assumption. |
| Starting state | score 0, three hearts | The clip's 208 is mid-run. |
| Respawn | the struck sector fades out and a replacement fades in elsewhere | The clip shows targets in changing positions; the exact mechanism is not visible. |
| Menus, countdown, game over, practice | all of it | None appear in the clip. |
| Sounds | the kit WAVs | Original synthesized effects. The recording does not isolate any original game audio. |
| Font | local bold sans-serif, tabular digits | The original font is unknown. |

## Rules the implementation pins down

These resolve cases the clip could never show, and are worth stating because
they are decisions rather than physics:

- **Sector membership** is inclusive at the start edge and exclusive at the end
  edge, so two touching sectors can never both claim the marker.
- **A press and a timeout landing together**: the press carries its input
  event's timestamp, the simulation is advanced to that instant, and whichever
  event is earlier in simulation time resolves first. A timeout falling strictly
  before the press applies first and may end the run, in which case the press is
  ignored. Either way there is exactly one outcome per press.
- **Collision is off during transitions.** A sector fading in cannot be struck,
  and a struck sector stops being judgeable immediately. Nothing invisible is
  ever judged.
- **New sectors are always reachable.** A replacement is never placed on the
  marker and never closer than `spawnClearDeg` of travel to it, measured in the
  direction the ring is currently turning — which flips with every press.
- **The struck sector is consumed**, so a single pass cannot be farmed.
- **A duplicated input inside 110 ms is swallowed.** This absorbs a
  pointer/click pair or a stray repeat; it is short enough not to block real
  repeated play.
- **The simulation clock only runs while a run is live.** Menus, pause, the
  resume countdown and a hidden tab cannot spend the timer or a heart, and a
  suspended tab's catch-up delta is clamped rather than replayed.
- **Resuming always goes back through 3-2-1**, with input dead until it ends.

## Known limits

- The reference is 10.7 seconds of mid-run footage. Anything about progression,
  onboarding, failure states or long-run pacing is invention.
- The speed curve is fitted to a clip that is already near its cap, so the early
  ramp is unconstrained by evidence.
- The heart's flight to the HUD is an embellishment consistent with the visible
  heart feedback, not verified choreography.
