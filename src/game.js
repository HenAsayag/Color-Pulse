/* Rules, scoring, lives and the gameplay state machine.
 *
 * No DOM, no canvas, no wall clock of its own: every entry point is handed a
 * timestamp, so tests can drive a whole run deterministically.
 *
 * Simulation clock
 *   `simTime` only advances while the run is actually live (playing, and the
 *   ring also turns during the resume countdown). Menus, pause, loading and a
 *   hidden tab therefore cannot consume the countdown timer or a life.
 *
 * Simultaneous timeout and press
 *   A press carries the timestamp of the originating input event. The caller
 *   advances the simulation to that instant first, so whichever event has the
 *   earlier simulation time resolves first. A timeout that falls strictly
 *   before the press is applied first (and may end the run, in which case the
 *   press is ignored); a press at or before the expiry resets the timer and
 *   the timeout never happens. Exactly one outcome per press, either way.
 */
(function (global) {
  'use strict';

  var isNode = (typeof require === 'function' && typeof module !== 'undefined');
  var G = isNode ? require('./geometry.js') : global.CP.geometry;
  var RingMod = isNode ? require('./ring.js') : { Ring: global.CP.Ring };
  var RngMod = isNode ? require('./rng.js') : { createRng: global.CP.createRng };

  var MAX_STEP_MS = 1000 / 60;
  var MAX_CATCHUP_MS = 250;

  function Game(config, options) {
    options = options || {};
    this.config = config;
    this.onEvent = options.onEvent || function () {};
    this.rng = options.rng || RngMod.createRng(config.rules.seed);
    this.ring = new RingMod.Ring(config, this.rng);
    this.state = 'idle';
    this.practice = false;
    this.reset(0);
  }

  Game.prototype.rules = function () { return this.config.rules; };

  Game.prototype.reset = function (now) {
    var rules = this.rules();
    this.state = 'idle';
    this.simTime = 0;
    this.visualTime = 0;   /* advances during countdown too; drives decorative motion */
    this.lastNow = now || 0;
    this.ringAngle = 0;
    this.direction = 1;   /* +1 clockwise, -1 anticlockwise */
    this.ring.direction = 1;
    this.score = 0;
    this.lives = rules.initialLives;
    this.speed = rules.speedStartRadPerSec;
    this.timerLeft = rules.timerSeconds * 1000;
    this.countdownLeft = 0;
    this.countdownShown = 0;
    this.lastPressAt = -Infinity;
    this.hits = 0;
    this.misses = 0;
    this.timeouts = 0;
    this.hearts = 0;
    this.gameOverEmitted = false;
    this.ring.reset();
  };

  /* Begin a fresh run. `seed` is optional and makes the layout reproducible. */
  Game.prototype.start = function (now, options) {
    options = options || {};
    if (options.seed !== undefined) this.rng = RngMod.createRng(options.seed);
    this.ring = new RingMod.Ring(this.config, this.rng);
    this.reset(now);
    this.practice = !!options.practice;
    this.seed = this.rng.seed;
    this.beginCountdown(now, 'start');
  };

  Game.prototype.beginCountdown = function (now, reason) {
    this.state = 'countdown';
    this.lastNow = now;
    this.countdownLeft = this.rules().countdownSeconds * 1000;
    this.countdownShown = 0;
    this.emit('countdown-start', { reason: reason, seconds: this.rules().countdownSeconds });
  };

  Game.prototype.emit = function (type, payload) {
    this.onEvent(type, payload || {});
  };

  Game.prototype.isLive = function () {
    return this.state === 'playing' || this.state === 'countdown';
  };

  /* Advance the simulation to `now`. Safe to call repeatedly and from input
   * handlers; never steps backwards. */
  Game.prototype.advanceTo = function (now) {
    if (!this.isLive()) { this.lastNow = now; return; }
    var dt = now - this.lastNow;
    if (!(dt > 0)) { this.lastNow = Math.max(this.lastNow, now); return; }
    this.lastNow = now;
    /* A suspended tab can hand back a huge delta; clamp instead of teleporting
     * the ring (and never bank up timer penalties that the player never saw). */
    if (dt > MAX_CATCHUP_MS) dt = MAX_CATCHUP_MS;

    var remaining = dt;
    while (remaining > 0 && this.isLive()) {
      var step = Math.min(remaining, MAX_STEP_MS);
      if (this.state === 'countdown') this.stepCountdown(step);
      else this.stepPlaying(step);
      remaining -= step;
    }
  };

  Game.prototype.stepCountdown = function (dt) {
    this.advanceRing(dt);
    this.countdownLeft -= dt;
    var showing = Math.max(0, Math.ceil(this.countdownLeft / 1000));
    if (showing !== this.countdownShown && showing > 0) {
      this.countdownShown = showing;
      this.emit('countdown-tick', { value: showing });
    }
    if (this.countdownLeft <= 0) {
      this.state = 'playing';
      this.timerLeft = this.rules().timerSeconds * 1000;
      this.emit('countdown-end', {});
      this.emit('state', { state: 'playing' });
    }
  };

  Game.prototype.stepPlaying = function (dt) {
    this.simTime += dt;
    this.advanceRing(dt);
    if (this.rules().timerMode === 'countdown') {
      this.timerLeft -= dt;
      if (this.timerLeft <= 0) this.onTimeout();
    }
  };

  Game.prototype.advanceRing = function (dt) {
    var rules = this.rules();
    this.visualTime += dt;
    var target = Math.min(rules.speedMaxRadPerSec,
                          rules.speedStartRadPerSec + rules.speedPerPoint * this.score);
    /* Exponential ease so a score jump never steps the rotation visibly. */
    var k = rules.speedRampMs > 0 ? 1 - Math.exp(-dt / rules.speedRampMs) : 1;
    this.speed += (target - this.speed) * k;
    this.ringAngle = G.norm(this.ringAngle + this.direction * this.speed * dt / 1000);
    this.ring.update(dt, this.ringAngle);
  };

  Game.prototype.resetTimer = function () {
    this.timerLeft = this.rules().timerSeconds * 1000;
  };

  Game.prototype.timerFraction = function () {
    var total = this.rules().timerSeconds * 1000;
    if (total <= 0) return 1;
    return Math.max(0, Math.min(1, this.timerLeft / total));
  };

  /* One physical press -> exactly one outcome. */
  Game.prototype.press = function (atTime) {
    if (this.state !== 'playing') return { type: 'ignored' };
    if (atTime - this.lastPressAt < this.rules().inputCooldownMs) {
      return { type: 'duplicate' };
    }
    this.lastPressAt = atTime;

    /* Judge against the angle the player actually saw, then reverse, and only
     * then award: replacement sectors are placed by award() and must use the
     * NEW direction, or they would spawn behind the marker. */
    var sector = this.ring.hitTest(this.ringAngle);
    if (this.rules().reverseOnPress) this.reverse();
    return sector ? this.award(sector) : this.fail('gap');
  };

  /* Every press flips which way the ring turns. Only the sign changes; the
   * speed magnitude keeps its eased ramp, so there is no jolt. */
  Game.prototype.reverse = function () {
    this.direction = -this.direction;
    this.ring.direction = this.direction;
    this.emit('reverse', { direction: this.direction });
  };

  Game.prototype.award = function (sector) {
    var rules = this.rules();
    var healed = false;
    this.score += sector.points;
    this.hits++;

    if (sector.heals) {
      this.hearts++;
      if (this.lives < rules.maxLives) {
        this.lives = Math.min(rules.maxLives, this.lives + sector.heals);
        healed = true;
      }
    }

    var absStart = this.ring.absoluteStart(sector, this.ringAngle);
    this.ring.consume(sector, this.ringAngle);
    this.resetTimer();

    /* Only a normal hit can roll a new collectible, so collecting the orange
     * cannot immediately conjure another one. */
    if (!sector.heals) this.ring.maybeSpawnHeart(this.ringAngle);

    var result = {
      type: sector.heals ? 'heal' : 'hit',
      sector: sector.id,
      color: sector.color,
      points: sector.points,
      healed: healed,
      lives: this.lives,
      score: this.score,
      angle: absStart + sector.span / 2
    };
    this.emit(result.type, result);
    return result;
  };

  Game.prototype.fail = function (cause) {
    var rules = this.rules();
    var cost = cause === 'timeout' ? rules.timeoutCosts : rules.emptyTapCosts;
    if (cause === 'timeout') this.timeouts++; else this.misses++;

    if (!this.practice) {
      this.lives = Math.max(0, this.lives - cost);
      if (rules.missScorePenalty) {
        this.score = Math.max(0, this.score - rules.missScorePenalty);
      }
    }
    this.resetTimer();

    var result = { type: 'miss', cause: cause, lives: this.lives, score: this.score };
    this.emit('miss', result);

    if (this.lives <= 0 && !this.practice) this.endRun();
    return result;
  };

  Game.prototype.onTimeout = function () {
    /* Fold any overshoot back in so a long frame cannot charge two timeouts. */
    this.fail('timeout');
  };

  Game.prototype.endRun = function () {
    if (this.gameOverEmitted) return;
    this.gameOverEmitted = true;
    this.state = 'gameover';
    this.emit('gameover', {
      score: this.score,
      hits: this.hits,
      misses: this.misses,
      timeouts: this.timeouts,
      hearts: this.hearts
    });
    this.emit('state', { state: 'gameover' });
  };

  Game.prototype.pause = function (now, reason) {
    if (!this.isLive()) return false;
    this.advanceTo(now);
    if (!this.isLive()) return false;   /* the catch-up may have ended the run */
    this.resumeInto = this.state;
    this.state = 'paused';
    this.emit('state', { state: 'paused', reason: reason || 'manual' });
    return true;
  };

  Game.prototype.resume = function (now) {
    if (this.state !== 'paused') return false;
    this.lastNow = now;
    /* Always come back through the 3-2-1 countdown; input stays locked out
     * until it finishes, so nobody is punished for a surprise resume. */
    this.beginCountdown(now, 'resume');
    return true;
  };

  Game.prototype.snapshot = function () {
    return {
      state: this.state,
      simTime: this.visualTime,
      score: this.score,
      lives: this.lives,
      maxLives: this.rules().maxLives,
      ringAngle: this.ringAngle,
      speed: this.speed,
      timerFraction: this.timerFraction(),
      countdownValue: Math.max(0, Math.ceil(this.countdownLeft / 1000)),
      practice: this.practice,
      sectors: this.ring.snapshot(this.ringAngle)
    };
  };

  var api = { Game: Game };
  global.CP = global.CP || {};
  global.CP.Game = Game;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
