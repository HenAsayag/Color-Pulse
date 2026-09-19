# Asset integration

All newly created vector artwork, sounds and helper code in this kit are original recreations for this project. The reference video/contact sheet are supplied only for visual analysis; do not ship them as game art or claim ownership of them.

## Coordinates

Ring component SVGs: 512×512 transparent viewBox, center (256,256), outer radius 204 with 44 stroke, inner radius 170 with 12 stroke. Sector ends are flat. In design coordinates zero degrees is at the top, clockwise positive. Canvas angle = designAngle - Math.PI/2. Rotate every full-canvas SVG around (256,256) if compositing with images. All arc SVGs are centered at the top by default. Do not overlay all four at angle zero.

Use procedural Canvas arc drawing for variable angular widths and exact matching hit tests. Static SVGs are source assets/references, not a reason to rasterize the entire ring or freeze it. Full-canvas marker is stationary and drawn last. Inner arc start/end can change independently.

Hearts/control icons: 64×64; particle: 16×16. Render HUD hearts around 16–20 CSS px. Orange heart badge is separate from orange arc and follows its center angle. All SVGs have transparent backgrounds.

## File mapping

- ring-track.svg — charcoal annulus.
- arc-{yellow,blue,green,orange}.svg — four base target shapes, centered at twelve o'clock.
- inner-ring-{lime,green,yellow}.svg — meter style variants with gap; game draws dynamic meter procedurally.
- marker.svg — fixed white strike marker.
- heart-full.svg / heart-empty.svg — lives.
- heart-pickup.svg — white heart on dark orange badge.
- icon-{play,pause,restart,close,sound,muted}.svg — UI controls.
- hit-pulse.svg — ripple reference, animate scale/opacity.
- spark.svg / particle.svg — optional restrained particle primitives, tint in renderer if needed.
- assets/audio/*.wav — mono 44.1 kHz PCM original short effects; no third-party music.
- config/game-config.json — centralized palette, geometry, suggested rules and effect timing.
- runtime/effects.js — Canvas flash/ripple/floating text/shake helper; no external dependencies.
- effects-preview.html — offline asset/effect demonstrator with event buttons and audio; not the final game.

## Effect helper

`const fx = new SmashEffects()`; `fx.trigger('success', {label:'+5'})`; `fx.update(dtMilliseconds)`; `fx.draw(ctx,width,height,ringCenterX,ringCenterY,ringRadius)` after geometry. Use `fx.offset()` for a visual-only world translation, restore context before HUD. For orange use `heal`; for failure `miss`. Pass the game's simulation delta, stop updates while paused, and `fx.clear()` on restart. The preview calls the same helper. Toggle `fx.reduced = true` to reduce flashes and remove shake.

## Audio mapping

hit-yellow/blue/green on their hits; heal on orange; miss on gap/timeout; game-over once; tap for menu buttons; countdown per countdown number; pause/resume on state changes. These sounds are proposed replacements because the recording does not isolate original game audio.

## Preview

Open effects-preview.html directly in a browser. It contains a CSS/Canvas preview with the real SVG icons and WAV files. Use the event buttons to inspect green/orange/red flashes, count-up, heart changes, ripples and labels; Reduced effects lowers flash intensity. Alternatively run `python3 -m http.server 8000` from this directory.
