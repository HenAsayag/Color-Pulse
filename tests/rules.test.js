/* Headless rule tests. Run with:  node tests/rules.test.js
 *
 * These cover the verification list in MASTER_PROMPT.md section 8 that can be
 * checked without a browser: angular boundaries and wrap-around, one input to
 * one outcome, timeout/press ordering, score farming, the heart cap, losing at
 * zero lives exactly once, paused and hidden timer preservation, count-up
 * correctness and restart hygiene. Browser-only items (listeners, touch
 * sizes, resize) are covered in TEST_REPORT.md.
 */
'use strict';

const assert = require('assert');
const G = require('../src/geometry.js');
const { CONFIG } = require('../src/config.js');
const { createRng } = require('../src/rng.js');
const { Ring } = require('../src/ring.js');
const { Game } = require('../src/game.js');

const TAU = G.TAU;
let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failures.push({ name, err });
    console.log('  FAIL ' + name + '\n       ' + err.message);
  }
}

function section(title) { console.log('\n' + title); }

/* A fresh config per test, so one test cannot tune another. */
function freshConfig(overrides) {
  const config = JSON.parse(JSON.stringify(CONFIG));
  Object.assign(config.rules, overrides || {});
  return config;
}

function newGame(overrides, seed) {
  const config = freshConfig(overrides);
  const events = [];
  const game = new Game(config, {
    rng: createRng(seed === undefined ? 1234 : seed),
    onEvent: (type, payload) => events.push({ type, ...payload })
  });
  game.events = events;
  return game;
}

/* Drive the game the way requestAnimationFrame would. */
function run(game, ms, step = 16) {
  for (let i = 0; i < Math.round(ms / step); i++) {
    game.lastNowCursor = (game.lastNowCursor || 0) + step;
    game.advanceTo(game.lastNowCursor);
  }
  return game.lastNowCursor;
}

function startPlaying(game, seed) {
  game.lastNowCursor = 0;
  game.start(0, { seed: seed === undefined ? 1234 : seed });
  run(game, 3300);
  assert.strictEqual(game.state, 'playing', 'expected countdown to finish');
  return game;
}

/* ------------------------------------------------------------ geometry --- */

section('Angles: boundaries and wrap-around');

test('norm maps any angle into [0, TAU)', () => {
  assert.ok(G.norm(-0.001) > 6.28 && G.norm(-0.001) < TAU);
  assert.strictEqual(G.norm(TAU), 0);
  assert.ok(Math.abs(G.norm(TAU * 3 + 1) - 1) < 1e-9);
  assert.ok(G.norm(-TAU * 5 - 1) >= 0 && G.norm(-TAU * 5 - 1) < TAU);
});

test('arcContains is inclusive at the start edge, exclusive at the end', () => {
  assert.strictEqual(G.arcContains(1, 0.5, 1), true, 'start edge is inside');
  assert.strictEqual(G.arcContains(1, 0.5, 1.5), false, 'end edge is outside');
  assert.strictEqual(G.arcContains(1, 0.5, 1.4999), true);
  assert.strictEqual(G.arcContains(1, 0.5, 0.9999), false);
});

test('arcContains works across the 0 / TAU seam', () => {
  const start = TAU - 0.2;          /* spans the seam: [TAU-0.2, 0.3) */
  const span = 0.5;
  assert.strictEqual(G.arcContains(start, span, 0), true, 'the marker at 0');
  assert.strictEqual(G.arcContains(start, span, TAU - 0.1), true);
  assert.strictEqual(G.arcContains(start, span, 0.29), true);
  assert.strictEqual(G.arcContains(start, span, 0.31), false);
  assert.strictEqual(G.arcContains(start, span, TAU - 0.21), false);
});

test('two touching sectors never both claim the same angle', () => {
  const a = { start: 1.0, span: 0.5 };   /* [1.0, 1.5) */
  const b = { start: 1.5, span: 0.5 };   /* [1.5, 2.0) */
  for (let x = 0.9; x < 2.1; x += 0.01) {
    const inA = G.arcContains(a.start, a.span, x);
    const inB = G.arcContains(b.start, b.span, x);
    assert.ok(!(inA && inB), 'overlap at ' + x.toFixed(3));
  }
  assert.strictEqual(G.arcContains(a.start, a.span, 1.5), false);
  assert.strictEqual(G.arcContains(b.start, b.span, 1.5), true);
});

test('arcsOverlap detects wrap-around overlap', () => {
  assert.strictEqual(G.arcsOverlap(TAU - 0.2, 0.5, 0.1, 0.2), true);
  assert.strictEqual(G.arcsOverlap(TAU - 0.2, 0.1, 0.1, 0.2), false);
});

/* ---------------------------------------------------------------- ring --- */

section('Ring layout and spawning');

test('opening layout leaves the marker in a dark gap', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const ring = new Ring(freshConfig(), createRng(seed));
    ring.reset();
    assert.strictEqual(ring.hitTest(0), null, 'seed ' + seed + ' starts on a sector');
  }
});

test('opening sectors never overlap and keep the minimum gap', () => {
  const config = freshConfig();
  const minGap = G.degToRad(config.rules.minGapDeg) - 1e-9;
  for (let seed = 1; seed <= 200; seed++) {
    const ring = new Ring(config, createRng(seed));
    ring.reset();
    const list = ring.sectors;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        assert.ok(!G.arcsOverlap(list[i].start, list[i].span, list[j].start, list[j].span),
          'overlap on seed ' + seed);
      }
      /* distance from this sector's end to the next sector's start */
      const end = G.norm(list[i].start + list[i].span);
      let nearest = TAU;
      list.forEach((other, j) => {
        if (i === j) return;
        nearest = Math.min(nearest, G.cwDelta(end, other.start));
      });
      assert.ok(nearest >= minGap, 'gap too small on seed ' + seed + ': ' + nearest);
    }
  }
});

test('a spawned sector is never already under the marker, in either direction', () => {
  const config = freshConfig();
  for (const direction of [1, -1]) {
    for (let seed = 1; seed <= 150; seed++) {
      const ring = new Ring(config, createRng(seed));
      ring.reset();
      ring.direction = direction;
      const ringAngle = (seed / 150) * TAU;
      ring.sectors = [];
      assert.ok(ring.spawn('green', ringAngle), 'spawn failed, seed ' + seed);
      const s = ring.sectors[0];
      const abs = G.norm(ringAngle + s.start);
      assert.strictEqual(G.arcContains(abs, s.span, 0), false,
        'spawned onto the marker, dir ' + direction + ' seed ' + seed);
    }
  }
});

test('a spawned sector always has travel left before reaching the marker', () => {
  const config = freshConfig();
  const clear = G.degToRad(config.rules.spawnClearDeg);
  for (const direction of [1, -1]) {
    for (let seed = 1; seed <= 150; seed++) {
      const ring = new Ring(config, createRng(seed));
      ring.reset();
      ring.direction = direction;
      const ringAngle = (seed / 150) * TAU;
      ring.sectors = [];
      ring.spawn('yellow', ringAngle);
      const s = ring.sectors[0];
      const A = G.norm(ringAngle + s.start);
      /* clockwise: the far edge arrives; anticlockwise: the near edge does */
      const travel = direction > 0 ? TAU - (A + s.span) : A;
      assert.ok(travel >= clear, 'no lead time, dir ' + direction + ' seed ' + seed +
        ' travel=' + travel.toFixed(3));
    }
  }
});

test('freeIntervals merges overlapping and wrapping blocked runs', () => {
  /* Padding sectors by a minimum gap makes neighbouring blocked intervals
   * overlap. Treating them as disjoint invents free space across a sector. */
  const overlapping = [{ start: 0, span: 2 }, { start: 1, span: 2 }];
  const free = G.freeIntervals(overlapping);
  assert.strictEqual(free.length, 1, 'expected one free run');
  assert.ok(Math.abs(free[0].start - 3) < 1e-6, 'free run starts at the merged end');
  assert.ok(Math.abs(free[0].span - (TAU - 3)) < 1e-6, 'free run covers the rest');

  /* Nothing reported as free may overlap anything reported as blocked. */
  const blocked = [{ start: 6.0, span: 1.5 }, { start: 0.5, span: 1.0 }, { start: 1.2, span: 1.0 }];
  G.freeIntervals(blocked).forEach(f => {
    blocked.forEach(b => {
      assert.ok(!G.arcsOverlap(f.start, f.span, G.norm(b.start), b.span),
        'a free run overlapped a blocked run');
    });
  });

  /* Fully blocked leaves nothing. */
  assert.strictEqual(G.freeIntervals([{ start: 0, span: TAU }]).length, 0);
});

test('sectors never come closer than the minimum gap during a live run', () => {
  const config = freshConfig();
  const minGap = G.degToRad(config.rules.minGapDeg);
  let worst = Infinity;
  let violations = 0;
  let overlaps = 0;

  for (let seed = 1; seed <= 12; seed++) {
    const game = startPlaying(newGame({}, seed), seed);
    while (game.state === 'playing' && game.lastNowCursor < 25000) {
      run(game, 16);
      if (game.ring.hitTest(game.ringAngle)) {
        game.lastPressAt = -Infinity;
        game.press(game.lastNowCursor);
      }
      const visible = game.ring.sectors.filter(s => s.phase !== 'out');
      for (const a of visible) {
        for (const b of visible) {
          if (a === b) continue;
          const A = G.norm(game.ringAngle + a.start);
          const B = G.norm(game.ringAngle + b.start);
          if (G.arcsOverlap(A, a.span, B, b.span)) overlaps++;
          const gap = G.cwDelta(G.norm(A + a.span), B);
          if (gap < worst) worst = gap;
          if (gap < minGap - 1e-6) violations++;
        }
      }
    }
  }
  assert.strictEqual(overlaps, 0, 'sectors overlapped');
  assert.strictEqual(violations, 0,
    violations + ' gaps below the minimum; smallest was ' + G.radToDeg(worst).toFixed(1) + ' deg');
});

test('a sector is not judgeable while it is fading in or out', () => {
  const game = startPlaying(newGame());
  const ring = game.ring;
  ring.sectors = [];
  ring.direction = 1;
  ring.spawn('green', game.ringAngle);
  const s = ring.sectors[0];
  s.start = G.norm(-s.span / 2 - game.ringAngle);   /* park it on the marker */
  assert.strictEqual(s.phase, 'in');
  assert.strictEqual(ring.hitTest(game.ringAngle), null, 'a fading-in sector was hit');
  s.phase = 'live';
  assert.strictEqual(ring.hitTest(game.ringAngle), s, 'a live sector was missed');
  s.phase = 'out';
  assert.strictEqual(ring.hitTest(game.ringAngle), null, 'a fading-out sector was hit');
});

/* ------------------------------------------------------------- scoring --- */

section('Scoring, lives and input');

function aim(game, type) {
  const s = game.ring.sectors.find(x => x.id === type && x.phase === 'live');
  assert.ok(s, 'no live ' + type + ' sector');
  game.ringAngle = G.norm(-s.span / 2 - s.start);
  return s;
}

test('each colour awards its configured points', () => {
  const expected = { yellow: 1, blue: 2, green: 5 };
  for (const [type, points] of Object.entries(expected)) {
    const game = startPlaying(newGame());
    aim(game, type);
    game.lastPressAt = -Infinity;
    const before = game.score;
    const result = game.press(game.lastNowCursor);
    assert.strictEqual(result.type, 'hit', type + ' was not a hit');
    assert.strictEqual(result.points, points, type + ' points');
    assert.strictEqual(game.score, before + points);
  }
});

test('one press gives exactly one outcome; duplicates are swallowed', () => {
  const game = startPlaying(newGame());
  aim(game, 'yellow');
  game.lastPressAt = -Infinity;
  const t = game.lastNowCursor;
  const first = game.press(t);
  assert.strictEqual(first.type, 'hit');
  /* a duplicated pointer/click pair arriving in the same instant */
  const second = game.press(t);
  assert.strictEqual(second.type, 'duplicate');
  assert.strictEqual(game.score, first.points, 'duplicate press scored again');
  const judged = game.events.filter(e => ['hit', 'heal', 'miss'].includes(e.type));
  assert.strictEqual(judged.length, 1, 'more than one outcome emitted');
});

test('a sector cannot be farmed during a single pass', () => {
  const game = startPlaying(newGame({ reverseOnPress: false }));
  const sector = aim(game, 'yellow');
  game.lastPressAt = -Infinity;
  const first = game.press(game.lastNowCursor);
  assert.strictEqual(first.type, 'hit');
  assert.strictEqual(sector.phase, 'out', 'struck sector stayed judgeable');

  /* Hammer the same spot for a second without letting the ring move on. */
  let extra = 0;
  for (let i = 0; i < 20; i++) {
    game.lastPressAt = -Infinity;
    const r = game.press(game.lastNowCursor);
    if (r.type === 'hit' && r.sector === 'yellow') extra++;
  }
  assert.strictEqual(extra, 0, 'the same pass scored ' + extra + ' extra times');
});

test('pressing a dark gap costs exactly one life and no score', () => {
  const game = startPlaying(newGame());
  game.ring.sectors = [];               /* nothing under the marker */
  const before = { lives: game.lives, score: game.score };
  game.lastPressAt = -Infinity;
  const result = game.press(game.lastNowCursor);
  assert.strictEqual(result.type, 'miss');
  assert.strictEqual(result.cause, 'gap');
  assert.strictEqual(game.lives, before.lives - 1);
  assert.strictEqual(game.score, before.score, 'a miss changed the score');
});

test('hearts are capped, and orange still scores at full health', () => {
  const game = startPlaying(newGame());
  game.ring.sectors = [];
  game.ring.direction = game.direction;
  game.ring.spawn('orange', game.ringAngle);
  const orange = game.ring.sectors[0];
  orange.phase = 'live';
  aim(game, 'orange');
  assert.strictEqual(game.lives, 3, 'expected full health');
  game.lastPressAt = -Infinity;
  const result = game.press(game.lastNowCursor);
  assert.strictEqual(result.type, 'heal');
  assert.strictEqual(result.points, 3, 'orange scored nothing at full health');
  assert.strictEqual(game.lives, 3, 'hearts went over the cap');
  assert.strictEqual(result.healed, false);
});

test('orange restores exactly one heart when one is missing', () => {
  const game = startPlaying(newGame());
  game.lives = 1;
  game.ring.sectors = [];
  game.ring.direction = game.direction;
  game.ring.spawn('orange', game.ringAngle);
  game.ring.sectors[0].phase = 'live';
  aim(game, 'orange');
  game.lastPressAt = -Infinity;
  const result = game.press(game.lastNowCursor);
  assert.strictEqual(result.healed, true);
  assert.strictEqual(game.lives, 2);
});

test('only one orange collectible exists at a time', () => {
  const game = startPlaying(newGame({ heartSpawnChancePerSuccess: 1 }));
  for (let i = 0; i < 60; i++) {
    run(game, 120);
    const live = game.ring.hitTest(game.ringAngle);
    if (live) { game.lastPressAt = -Infinity; game.press(game.lastNowCursor); }
    const oranges = game.ring.sectors.filter(s => s.id === 'orange' && s.phase !== 'out');
    assert.ok(oranges.length <= 1, 'found ' + oranges.length + ' oranges');
  }
});

test('every press re-rolls the sector widths', () => {
  const game = startPlaying(newGame());
  let pressesThatChanged = 0;
  const total = 20;
  for (let i = 0; i < total; i++) {
    game.lives = 3;
    const before = new Map(game.ring.sectors.filter(s => s.phase !== 'out').map(s => [s.uid, s.span]));
    game.lastPressAt = -Infinity;
    game.press(game.lastNowCursor);
    const after = game.ring.sectors.filter(s => s.phase !== 'out');
    const changed = after.some(s => before.has(s.uid) && Math.abs(before.get(s.uid) - s.span) > 1e-9);
    if (changed) pressesThatChanged++;
    run(game, 120);
  }
  assert.strictEqual(pressesThatChanged, total,
    'only ' + pressesThatChanged + '/' + total + ' presses changed a width');
});

test('resizing keeps every width inside its colour range', () => {
  const config = freshConfig();
  const game = startPlaying(newGame());
  const byId = {};
  config.sectors.forEach(a => { byId[a.id] = a; });
  for (let i = 0; i < 60; i++) {
    game.lives = 3;
    game.lastPressAt = -Infinity;
    game.press(game.lastNowCursor);
    run(game, 100);
    game.ring.sectors.filter(s => s.phase !== 'out').forEach(s => {
      const arch = byId[s.id];
      const maxDeg = arch.spanDeg + (arch.spanJitterDeg || 0);
      /* Widths may be squeezed DOWN by a neighbour, never inflated. */
      assert.ok(G.radToDeg(s.span) <= maxDeg + 1e-6,
        s.id + ' grew to ' + G.radToDeg(s.span).toFixed(1) + ' deg, above its ' + maxDeg);
      assert.ok(G.radToDeg(s.span) >= config.rules.minSpanDeg - 1e-6,
        s.id + ' shrank below the floor');
    });
  }
});

test('a fading-in sector never sits on the marker, even across a reversal', () => {
  /* A press reverses the ring, so a sector still fading in can have its
   * trailing edge become the leading one. Placement must leave room on both
   * sides or a target turns collidable right on the marker. */
  let onMarker = 0;
  let samples = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const game = startPlaying(newGame({}, seed), seed);
    while (game.state === 'playing' && game.lastNowCursor < 20000) {
      run(game, 16);
      if (game.ring.hitTest(game.ringAngle)) {
        game.lastPressAt = -Infinity;
        game.press(game.lastNowCursor);
      }
      game.ring.sectors.forEach(s => {
        if (s.phase !== 'in') return;
        samples++;
        const abs = G.norm(game.ringAngle + s.start);
        if (G.arcContains(abs, s.span, 0)) onMarker++;
      });
    }
  }
  assert.ok(samples > 500, 'not enough fading-in samples: ' + samples);
  assert.strictEqual(onMarker, 0, onMarker + ' fading-in sectors were on the marker');
});

test('every press flips the direction of rotation', () => {
  const game = startPlaying(newGame());
  const seen = [game.direction];
  for (let i = 0; i < 6; i++) {
    game.lives = 3;              /* keep the run alive; gap presses would end it */
    game.lastPressAt = -Infinity;
    game.press(game.lastNowCursor);
    seen.push(game.direction);
    assert.strictEqual(game.ring.direction, game.direction, 'ring direction out of step');
  }
  for (let i = 1; i < seen.length; i++) {
    assert.strictEqual(seen[i], -seen[i - 1], 'direction did not alternate: ' + seen.join(','));
  }
});

test('direction reversal actually reverses travel', () => {
  const game = startPlaying(newGame());
  const a0 = game.ringAngle;
  run(game, 100);
  const forward = G.shortestDelta(a0, game.ringAngle);
  game.lastPressAt = -Infinity;
  game.press(game.lastNowCursor);
  const a1 = game.ringAngle;
  run(game, 100);
  const backward = G.shortestDelta(a1, game.ringAngle);
  assert.ok(forward > 0 && backward < 0, 'forward=' + forward + ' backward=' + backward);
});

/* --------------------------------------------------------------- timer --- */

section('Countdown timer');

test('the timer costs one life on expiry and restarts cleanly', () => {
  const game = startPlaying(newGame());
  game.ring.sectors = [];
  run(game, 6200);
  const timeouts = game.events.filter(e => e.type === 'miss' && e.cause === 'timeout');
  assert.strictEqual(timeouts.length, 1, 'expected 1 timeout, saw ' + timeouts.length);
  assert.strictEqual(game.lives, 2);
  assert.ok(game.timerFraction() > 0.8, 'the interval did not restart');
});

test('one long frame cannot charge two timeouts', () => {
  const game = startPlaying(newGame());
  game.ring.sectors = [];
  game.resetTimer();            /* start the interval from a known point */
  run(game, 5950);
  assert.strictEqual(game.lives, 3, 'expired early');
  /* a single 240ms hitch straddling the expiry */
  game.lastNowCursor += 240;
  game.advanceTo(game.lastNowCursor);
  assert.strictEqual(game.lives, 2, 'a single hitch cost ' + (3 - game.lives) + ' lives');
});

test('a hit resets the interval', () => {
  const game = startPlaying(newGame());
  run(game, 4000);
  assert.ok(game.timerFraction() < 0.5);
  aim(game, 'blue');
  game.lastPressAt = -Infinity;
  game.press(game.lastNowCursor);
  assert.ok(game.timerFraction() > 0.99, 'the interval did not reset on a hit');
});

test('decorative mode never charges a timeout', () => {
  const game = startPlaying(newGame({ timerMode: 'decorative' }));
  game.ring.sectors = [];
  run(game, 20000);
  assert.strictEqual(game.lives, 3, 'decorative mode still cost lives');
});

/* ------------------------------------------------------- pause / hidden --- */

section('Pause, hidden tabs and the simulation clock');

test('pausing freezes the timer, the angle and the clock', () => {
  const game = startPlaying(newGame());
  run(game, 1500);
  const frozen = {
    timer: game.timerLeft, angle: game.ringAngle, sim: game.simTime
  };
  game.pause(game.lastNowCursor, 'manual');
  assert.strictEqual(game.state, 'paused');
  run(game, 9000);      /* far longer than the 6s interval */
  assert.strictEqual(game.timerLeft, frozen.timer, 'the timer ran while paused');
  assert.strictEqual(game.ringAngle, frozen.angle, 'the ring turned while paused');
  assert.strictEqual(game.simTime, frozen.sim, 'the clock ran while paused');
  assert.strictEqual(game.lives, 3, 'a life was lost while paused');
});

test('a press is ignored while paused', () => {
  const game = startPlaying(newGame());
  aim(game, 'yellow');
  game.pause(game.lastNowCursor, 'manual');
  game.lastPressAt = -Infinity;
  const result = game.press(game.lastNowCursor);
  assert.strictEqual(result.type, 'ignored');
  assert.strictEqual(game.score, 0);
});

test('resuming goes back through the countdown, and input is dead until it ends', () => {
  const game = startPlaying(newGame());
  game.pause(game.lastNowCursor, 'manual');
  game.resume(game.lastNowCursor);
  assert.strictEqual(game.state, 'countdown');
  game.lastPressAt = -Infinity;
  assert.strictEqual(game.press(game.lastNowCursor).type, 'ignored');
  run(game, 3200);
  assert.strictEqual(game.state, 'playing');
});

test('a long hidden stretch cannot bank up timer penalties', () => {
  const game = startPlaying(newGame());
  game.ring.sectors = [];
  /* the tab is suspended for 30s and hands back one enormous delta */
  game.lastNowCursor += 30000;
  game.advanceTo(game.lastNowCursor);
  assert.ok(game.lives >= 2, 'a suspended tab cost ' + (3 - game.lives) + ' lives');
});

/* ----------------------------------------------------------- game over --- */

section('Game over');

test('the run ends exactly once, at zero lives', () => {
  const game = startPlaying(newGame());
  game.ring.sectors = [];
  for (let i = 0; i < 8; i++) {
    game.lastPressAt = -Infinity;
    game.press(game.lastNowCursor);
  }
  const overs = game.events.filter(e => e.type === 'gameover');
  assert.strictEqual(overs.length, 1, 'gameover fired ' + overs.length + ' times');
  assert.strictEqual(game.lives, 0);
  assert.strictEqual(game.state, 'gameover');
});

test('no further presses register after the run ends', () => {
  const game = startPlaying(newGame());
  game.ring.sectors = [];
  for (let i = 0; i < 4; i++) { game.lastPressAt = -Infinity; game.press(game.lastNowCursor); }
  const finalScore = game.score;
  game.lastPressAt = -Infinity;
  assert.strictEqual(game.press(game.lastNowCursor).type, 'ignored');
  assert.strictEqual(game.score, finalScore);
});

test('practice never ends the run or spends a heart', () => {
  const game = newGame();
  game.lastNowCursor = 0;
  game.start(0, { practice: true, seed: 5 });
  run(game, 3300);
  game.ring.sectors = [];
  for (let i = 0; i < 10; i++) { game.lastPressAt = -Infinity; game.press(game.lastNowCursor); }
  run(game, 14000);
  assert.strictEqual(game.lives, 3, 'practice cost a heart');
  assert.strictEqual(game.state, 'playing', 'practice ended the run');
});

/* ------------------------------------------------------------- restart --- */

section('Restart and determinism');

test('restart clears score, lives, timer, targets and latches', () => {
  const game = startPlaying(newGame());
  aim(game, 'green');
  game.lastPressAt = -Infinity;
  game.press(game.lastNowCursor);
  game.lives = 1;
  assert.ok(game.score > 0);

  game.start(game.lastNowCursor, { seed: 77 });
  run(game, 3300);
  assert.strictEqual(game.score, 0);
  assert.strictEqual(game.lives, 3);
  assert.strictEqual(game.direction, 1, 'direction survived a restart');
  assert.ok(game.timerFraction() > 0.9, 'timer not refilled: ' + game.timerFraction());
  assert.strictEqual(game.gameOverEmitted, false);
  assert.strictEqual(game.ring.pending.length, 0, 'a pending spawn survived a restart');
});

test('the same seed reproduces the same run', () => {
  const play = (seed) => {
    const game = newGame({}, seed);
    game.lastNowCursor = 0;
    game.start(0, { seed });
    run(game, 3300);
    for (let i = 0; i < 120; i++) {
      run(game, 48);
      if (game.ring.hitTest(game.ringAngle)) {
        game.lastPressAt = -Infinity;
        game.press(game.lastNowCursor);
      }
    }
    return { score: game.score, lives: game.lives, angle: game.ringAngle.toFixed(9) };
  };
  assert.deepStrictEqual(play(2024), play(2024), 'the same seed diverged');
  assert.notDeepStrictEqual(play(2024), play(9999), 'different seeds matched');
});

test('speed ramps smoothly and respects the cap', () => {
  const game = startPlaying(newGame());
  const rules = game.rules();
  assert.ok(Math.abs(game.speed - rules.speedStartRadPerSec) < 0.05);
  game.score = 10000;                         /* far past the cap */
  let previous = game.speed;
  let biggestStep = 0;
  for (let i = 0; i < 400; i++) {
    run(game, 16);
    biggestStep = Math.max(biggestStep, Math.abs(game.speed - previous));
    previous = game.speed;
  }
  assert.ok(game.speed <= rules.speedMaxRadPerSec + 1e-9, 'speed passed the cap');
  assert.ok(game.speed > rules.speedMaxRadPerSec - 0.02, 'speed never reached the cap');
  /* Expressed against the configured range so the bound stays meaningful if
   * the speeds are retuned: one frame may never cover more than 5% of the
   * whole start-to-cap ramp, which is far below what reads as a jump. */
  const range = rules.speedMaxRadPerSec - rules.speedStartRadPerSec;
  assert.ok(biggestStep < range * 0.05,
    'speed stepped by ' + biggestStep.toFixed(3) + ' in one frame (' +
    (100 * biggestStep / range).toFixed(1) + '% of the ramp)');
});

test('a full bot run stays consistent: score matches the awards', () => {
  const game = startPlaying(newGame({}, 4242), 4242);
  let expected = 0;
  game.onEvent = (type, payload) => {
    if (type === 'hit' || type === 'heal') expected += payload.points;
  };
  for (let i = 0; i < 4000 && game.state === 'playing'; i++) {
    run(game, 16);
    if (game.ring.hitTest(game.ringAngle)) {
      game.lastPressAt = -Infinity;
      game.press(game.lastNowCursor);
    }
  }
  assert.strictEqual(game.score, expected, 'score drifted from the sum of awards');
  assert.ok(game.score > 100, 'the bot barely scored: ' + game.score);
});

section('Configuration');

test('config/game-config.json does not contradict the code defaults', () => {
  /* The JSON is fetched and merged OVER src/config.js when the game is
   * served, so a stale value here silently changes the shipped game. */
  const json = JSON.parse(require('fs').readFileSync(__dirname + '/../config/game-config.json', 'utf8'));
  const drift = [];
  Object.keys(json.rules || {}).forEach(key => {
    if (CONFIG.rules[key] === undefined) return;
    if (json.rules[key] !== CONFIG.rules[key]) {
      drift.push(key + ': json=' + json.rules[key] + ' code=' + CONFIG.rules[key]);
    }
  });
  (json.sectors || []).forEach(entry => {
    const arch = CONFIG.sectors.filter(s => s.id === entry.id)[0];
    if (!arch) return;
    ['spanDeg', 'spanJitterDeg', 'points'].forEach(f => {
      if (entry[f] !== undefined && entry[f] !== arch[f]) {
        drift.push(entry.id + '.' + f + ': json=' + entry[f] + ' code=' + arch[f]);
      }
    });
  });
  assert.strictEqual(drift.length, 0, 'config drift: ' + drift.join('; '));
});

/* ---------------------------------------------------------------- done --- */

console.log('\n' + '-'.repeat(52));
if (failures.length) {
  console.log(passed + ' passed, ' + failures.length + ' FAILED');
  failures.forEach(f => console.log('  * ' + f.name + ': ' + f.err.message));
  process.exit(1);
}
console.log(passed + ' passed, 0 failed');
