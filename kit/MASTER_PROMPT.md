# Build a polished Color Smash-style timing game

You are a senior game engineer, technical artist, and game-feel designer. Build the actual complete playable HTML5 game using the attached asset kit and reference video. Do not stop after a plan, wireframe, static mockup, or partial prototype. Use English UI. Working title: COLOR PULSE; credit Hen Asayag unobtrusively on the menu. Reproduce the supplied video's composition, motion, feedback and rhythm as closely as the evidence allows. Do not invent original-game features and describe them as verified.

## 1. Read the package before coding

Watch `reference/gameplay.mp4`, including frame-by-frame inspection around successful taps, misses, and heart collection. Read `REFERENCE_ANALYSIS.md`, `ASSET_GUIDE.md`, and `config/game-config.json`. Inspect the vector assets and `effects-preview.html`. The preview demonstrates asset integration and proposed effects, NOT a finished game or verified original mechanics. Config values are tunable defaults, not original source values. Use the reference as the authority for what can actually be observed.

Deliver a functional game with all assets connected, complete menus, real scoring, lives, pause/resume, restart, responsive touch controls, sound settings and local high scores. Preserve the minimalist visual identity. Do not add characters, landscapes, illustrated backgrounds, gradients, a bulky dashboard, or unnecessary HUD clutter.

## 2. Evidence and reconstruction boundaries

Confirmed in the provided clip: near-black portrait playfield; huge white score above the ring; three small pink heart slots; thick dark circular track; yellow, blue and small green moving arc segments; occasional orange heart segment; stationary thin white marker at twelve o'clock; a thin inner arc with a moving gap and yellow/lime/green changes; green full-playfield success flash; red failure flash; orange heart-collection flash; translucent expanding circular feedback; floating +5 and +3 labels; changing lives; smoothly changing score numbers. The clip starts mid-run around 208 and reaches 239.

Unknown from this short clip: exact input contract, every color's score, precise speed curve, exact role of the inner arc, original menus, original sound effects and any game-over or onboarding screens. The apparent pause icon near the end may belong to the video player; do not claim that it proves an original in-game pause control. The meme caption and visible mouse cursor are recording overlays and MUST NOT be copied into gameplay. The video music is not a game asset.

Use the explicit reconstruction defaults below for unobservable rules. Keep them configurable and document them. Do not block implementation waiting for clarification.

## 3. Core gameplay: implement this coherent reconstruction

The player presses once when a desirable moving colored sector aligns with the fixed twelve-o'clock marker. The outer ring rotates continuously. Rotation is deterministic and time-based, never tied to frame count. One touch, click, or Space keydown produces one judgement using the current simulation angle.

Proposed points: yellow +1, blue +2, green +5; orange +3 and restores one missing heart, capped at three. At full health orange still awards its points. A press in a dark gap loses one heart and produces a miss event. Start new games at score 0 with three lives; the clip's 208 is not a starting score.

Use a configurable six-second inner countdown arc, reset after a successful hit and after a timeout penalty. This timer interpretation is a reconstruction, not established by the clip. Timeout loses one life exactly once and starts a fresh interval. Interpolate its color green to lime to yellow as time diminishes; show a short bright green reset pulse on success. Preserve the thin line and visible gap rather than drawing a solid disk. Expose an option to switch the inner arc to decorative motion if later evidence invalidates the timer interpretation.

Rotate all active sectors around the same center. Use variable, non-overlapping sector positions separated by dark gaps. Use the supplied angular widths as initial values. Seed the layout generator for repeatable testing. Reposition or refresh targets after resolved hits with a brief transition that never creates a hidden collision target. Do not snap the whole ring. Begin at 2.8 radians/second and increase gradually toward a 5.2 cap; tune against the clip, as these numbers are estimates. Do not implement arbitrary mid-flight direction reversals unless the video supports them. Every generated sector must be reachable; never move a sector away at the moment of judgement.

A green target is narrow and more rewarding. Orange is an occasional collectible, not always present; use a configurable probability, avoid overlaps, and remove a collected orange sector until a later spawn. Default probability is a balancing assumption. Do not award multiple points for one physical press, key repeat, touch/click duplication, or repeated taps on the same sector during a single pass. Judge sector boundaries consistently, including the angle wrap around 0/2π. A held input must not autoplay.

There is no XP, shop, permanent power upgrade or automatic stat growth. Improvement comes from player timing and practice. Do not include betting, payments or cash tournaments.

## 4. Layout and rendering

Use Canvas 2D for procedural gameplay geometry and effects, with DOM controls and accessible menus. SVGs are provided as precise visual assets and component references. Draw active arcs procedurally from the same shared geometry and color configuration; do not stretch static arc images into arbitrary sizes. All full-ring SVG assets use a 512-square viewBox with center (256,256), outer radius 204/width 44, inner radius 170/width 12. All angles in the game must share the documented top-origin convention.

Use a nearly black background and a slightly lighter charcoal ring track. Use saturated flat yellow, blue, green and orange sectors with flat radial ends, matching the clip. Keep the thin white vertical marker above the track at twelve o'clock; do not rotate it with the sectors. The inner ring is visibly separated from the thick outer ring. Keep the middle empty during normal play.

On portrait screens place the white score high in the playfield, hearts immediately below, then the ring centered horizontally. Use approximately 60–72 CSS px score text and a ring diameter around 290–330 CSS px on a 390 px viewport, scaled proportionally and bounded by available height. Use a locally available bold sans-serif or system font; no blocking remote font dependency. Render digits crisply, with tabular numerals. The original font is unknown.

Fit the playable area to the viewport with `100dvh`, safe-area padding and no accidental scrolling. At 320 px wide or short landscape sizes all controls must remain usable and the ring visible. On desktop retain a centered portrait composition. Handle device pixel ratio separately from CSS size, cap it if needed for performance, and resize without resetting the run.

## 5. Required animation and feedback system

Implement real event-driven animations. Never substitute a single static screenshot. Treat the timings below as tunable targets:

- Continuous rotation: requestAnimationFrame with elapsed simulation time; smooth speed ramps. Avoid visible stepping or interpolation jitter. Keep the marker perfectly stationary.
- Standard hit: a short color response at the struck sector, green playfield flash with roughly 240 ms decay, thin translucent circular ripple expanding from the inner ring over 280 ms, and score scale 1 → 1.15 → 1 over 160–200 ms. Start feedback on the same input frame.
- Green hit: clearly readable +5 beneath the hearts, floating upward about 26 px and fading over 650 ms. Brighter green flash and reset pulse; optional sparse particles only if they do not obscure the close visual match.
- Yellow/blue hits: +1/+2 using the same restrained label system. Their exact feedback is a design completion, not fully demonstrated in the clip.
- Score count-up: animate the displayed total over 100–180 ms, while authoritative score changes immediately. Retarget from the currently displayed value if another award arrives. Do not lose points or leave obsolete tweens running.
- Heart collection: orange full-playfield flash over about 320 ms, +3 label, heart travels toward the HUD over 350–500 ms, restored heart scales 1 → 1.3 → 1; settle cleanly. Heart travel is a proposed embellishment consistent with the visible heart feedback, not verified exact choreography.
- Miss: immediate red playfield flash with about 300 ms decay; heart becomes empty; optional 5 px shake over 160 ms and short heart pop/fade. Shake must not alter hit geometry. No negative score unless configured.
- Spawn/removal: quick 100–140 ms alpha/scale transition for replaced sectors, rendered independently from collision state. Define when collision becomes active; never accept invisible sectors or judge old positions.
- HUD: temporary score labels must stack or merge sensibly during quick events and must not overlap the score digits.
- Pause: freeze simulation, timer and gameplay effects; quiet game audio; display a legible overlay with Resume, Restart, Sound and Menu. Resume with a brief 3–2–1 countdown, accepting no gameplay input until finished.
- Game over: resolve the last miss once, stop simulation, settle effects, then reveal score, best score and Restart. A new-best celebration should be restrained and clearly outside the captured reference sequence.
- Transitions: fade menus in/out within 150–250 ms, preserve low input latency, and cancel obsolete timers on restart.

Keep flashes within the playfield. Provide reduced-flash and reduced-motion settings, honor prefers-reduced-motion, disable shake/zoom there and lower flash opacity. Coalesce frequent flashes with the configured cooldown instead of stacking intense full-screen pulses. Make high contrast heart outlines readable. The supplied effect preview can be reused as a starting point; adapt it to the game's pause clock and settings.

## 6. Controls and complete states

Support pointerdown for mouse and touchscreen and Space/Enter for action. Use Pointer Events once, not parallel touchstart + click handlers. Ignore keyboard repeats. Ignore secondary pointers, right clicks and events from UI controls. Prevent Space scrolling only while gameplay has focus. Keep Pause/Mute controls at least 44×44 CSS px; activating them must not also strike the ring. Touch playfield is the primary action target, with an optional labeled TAP button for discoverability.

Required states: loading, main menu, how-to-play, countdown, playing, paused, game-over. Include Play, concise instructions, Best score, Sound toggle and reduced-motion/flash settings. Escape/P pauses. Auto-pause on visibilitychange or focus loss; never consume a life while hidden. Resume deliberately. Do not count menus, loading or tab suspension toward the timer.

Provide one practice example that explains the fixed marker, moving sectors, green +5, heart pickups and misses. Show the assumed scoring values clearly. On restart reset score, lives, timer, targets, temporary effects, audio handles and input latches; preserve settings and best score in localStorage with a safe fallback.

## 7. Sound and assets

Use `assets/audio/*.wav`: yellow/blue/green successes have distinct short sounds; heal uses an ascending chime; miss a low buzz; game-over a descending motif; countdown, tap, pause and resume are included. They are original synthesized replacements, NOT the soundtrack or recovered sounds of the referenced game. Initialize/unlock AudioContext only after a user gesture, support mute and master volume, and cap simultaneous voices. Avoid clipping or rapid click artifacts. Do not add the reference video's music.

Load the supplied SVG heart and control icons, use shared palette and geometry, and integrate the real assets instead of placeholder emoji. Use `runtime/effects.js` as a reusable baseline if appropriate. For packaging, preserve relative paths and serve locally without external APIs. Include a README with the simplest run command. If the existing environment has a project, integrate cleanly without replacing unrelated work.

## 8. Architecture and verification

Separate state, scoring, ring geometry/collision, renderer, input, effects and audio. Use one animation loop and a monotonic simulation clock. Inject a seeded random generator for reproducible scenarios. Expose tuning parameters from one configuration object. Do not use CSS animation angle as an independent source of truth for collision.

Verify: exact angular boundaries and wrap-around; one input/one outcome; simultaneous timeout/input has one defined resolution; no score farming on a single sector pass; heart cap; loss at zero lives only once; paused/hidden timer preservation; correct score under overlapping count-up tweens; repeated restarts do not multiply listeners; sound remains muted across restart; touch at 320×568 and 390×844; desktop and landscape resize; no console errors or missing files.

Perform a visual pass side-by-side with the reference at green flash, miss flash, heart pickup and normal rotation. Check arc proportions, marker position, spacing, saturation and animation decay. If you can capture the game, provide screenshots or a short recording. Deliver complete source, run instructions, a brief test report, and a concise list of remaining assumptions. Do not describe reconstruction defaults as recovered original rules. Finish the implementation and polish it before presenting the result.
