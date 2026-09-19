/* Event-driven feedback state: flashes, ripples, floating labels, shake, HUD
 * pops and the collected-heart flight.
 *
 * This module owns TIMING ONLY. It holds no drawing code and no reference to a
 * canvas, so the WebGL renderer and the Canvas 2D fallback can both read the
 * same state and present it their own way. Grown from the kit helper
 * (kit/effects-baseline.js).
 *
 * It is driven by the simulation clock, so it freezes with pause, and it
 * honours the reduced-motion / reduced-flash settings.
 */
(function (global) {
  'use strict';

  var Color = global.CP.color;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }

  function Effects(config) {
    this.config = config;
    this.reducedMotion = false;
    this.reducedFlash = false;
    this.clear();
  }

  Effects.prototype.clear = function () {
    this.clock = 0;
    this.flashes = [];
    this.ripples = [];
    this.labels = [];
    this.shakes = [];
    this.flights = [];
    this.heartPops = [];
    this.scorePopAge = Infinity;
    this.timerPulseAge = Infinity;
  };

  Effects.prototype.fxConfig = function () { return this.config.effects; };

  /* ---- triggers --------------------------------------------------------- */

  /* Full-screen flashes are coalesced: a burst of quick events refreshes one
   * flash rather than stacking several opaque pulses on top of each other. */
  Effects.prototype.flash = function (color, durationMs, maxAlpha) {
    var cooldown = this.fxConfig().flashCooldownMs;
    var recent = this.flashes[this.flashes.length - 1];
    if (recent && this.clock - recent.born < cooldown) {
      recent.born = this.clock;
      recent.age = 0;
      recent.color = color;
      recent.duration = durationMs;
      recent.maxAlpha = maxAlpha;
      return;
    }
    this.flashes.push({
      color: color, duration: durationMs, maxAlpha: maxAlpha,
      age: 0, born: this.clock
    });
    if (this.flashes.length > 3) this.flashes.shift();
  };

  Effects.prototype.ripple = function (color, durationMs) {
    this.ripples.push({ color: color, duration: durationMs, age: 0 });
    if (this.ripples.length > 4) this.ripples.shift();
  };

  /* Floating "+N" under the hearts. Simultaneous labels lay out side by side
   * and are re-centred once, at birth, so nothing jitters afterwards. */
  Effects.prototype.label = function (text, color) {
    var cfg = this.fxConfig().floatingScore;
    var visible = this.labels.filter(function (l) { return l.age < l.duration * 0.75; });
    var maxX = -Infinity;
    visible.forEach(function (l) { l.x -= cfg.gapPx / 2; if (l.x > maxX) maxX = l.x; });
    var x = visible.length ? maxX + cfg.gapPx : 0;
    this.labels.push({ text: text, color: color, age: 0, duration: cfg.durationMs, x: x });
    if (this.labels.length > this.fxConfig().maxEvents) this.labels.shift();

    /* A fast streak can put several labels up at once. Bound the group so it
     * always stays inside the playfield: past the cap the outermost lanes are
     * shared rather than marching off the edge of the screen. */
    var maxOffset = cfg.gapPx * 1.5;
    this.labels.forEach(function (l) {
      l.x = Math.max(-maxOffset, Math.min(maxOffset, l.x));
    });
  };

  Effects.prototype.shake = function () {
    if (this.reducedMotion) return;
    var cfg = this.fxConfig().miss;
    this.shakes.push({ age: 0, duration: cfg.shakeMs, amount: cfg.shakePx });
    if (this.shakes.length > 2) this.shakes.shift();
  };

  Effects.prototype.scorePop = function () { this.scorePopAge = 0; };
  Effects.prototype.timerPulse = function () { this.timerPulseAge = 0; };
  Effects.prototype.heartPop = function (index) { this.heartPops.push({ index: index, age: 0 }); };

  Effects.prototype.heartFlight = function (fromX, fromY, toIndex) {
    if (this.reducedMotion) return;
    this.flights.push({
      fromX: fromX, fromY: fromY, toIndex: toIndex,
      age: 0, duration: this.fxConfig().heal.flightMs
    });
  };

  /* ---- composite events ------------------------------------------------- */

  Effects.prototype.onHit = function (info) {
    var cfg = this.fxConfig();
    var palette = this.config.palette;
    var strong = info.sector === 'green';
    this.flash(palette.green, cfg.success.flashMs, cfg.success.maxAlpha * (strong ? 1 : 0.82));
    this.ripple(palette.ripple, cfg.success.pulseMs);
    this.label('+' + info.points, info.color);
    this.scorePop();
    this.timerPulse();
  };

  Effects.prototype.onHeal = function (info) {
    var cfg = this.fxConfig();
    this.flash(this.config.palette.orange, cfg.heal.flashMs, cfg.heal.maxAlpha);
    this.ripple(this.config.palette.orange, cfg.success.pulseMs);
    this.label('+' + info.points, this.config.palette.orange);
    this.scorePop();
    this.timerPulse();
  };

  Effects.prototype.onMiss = function () {
    var cfg = this.fxConfig();
    this.flash(cfg.miss.color || '#FF0505', cfg.miss.flashMs, cfg.miss.maxAlpha);
    this.shake();
  };

  /* ---- update ----------------------------------------------------------- */

  Effects.prototype.update = function (dt) {
    if (!(dt > 0)) dt = 0;
    this.clock += dt;
    var advance = function (list) {
      for (var i = 0; i < list.length; i++) list[i].age += dt;
      return list.filter(function (e) { return e.age < e.duration; });
    };
    this.flashes = advance(this.flashes);
    this.ripples = advance(this.ripples);
    this.labels = advance(this.labels);
    this.shakes = advance(this.shakes);
    this.flights = advance(this.flights);
    this.heartPops = this.heartPops.filter(function (p) {
      p.age += dt;
      return p.age < 400;
    });
    this.scorePopAge += dt;
    this.timerPulseAge += dt;
  };

  /* ---- queries, read by whichever renderer is active -------------------- */

  /* Playfield background, tinted by any active flash. In the reference clip
   * the flash is the BACKGROUND: the ring and its colours stay drawn on top of
   * it, rather than being washed over. Returns [r,g,b] in 0..255. */
  Effects.prototype.backgroundColor = function () {
    var color = Color.parse(this.config.palette.background);
    var reducedAlpha = this.config.effects.reducedMotion.flashAlpha;

    for (var i = 0; i < this.flashes.length; i++) {
      var f = this.flashes[i];
      var t = clamp01(f.age / f.duration);
      var peak = this.reducedFlash ? Math.min(f.maxAlpha, reducedAlpha) : f.maxAlpha;
      var alpha = peak * Math.pow(1 - t, 2);
      if (alpha > 0.001) color = Color.mix(color, f.color, alpha);
    }
    return color;
  };

  /* Expanding rings, resolved against the current ring geometry. */
  Effects.prototype.rippleList = function (innerRadius, outerRadius) {
    var out = [];
    for (var i = 0; i < this.ripples.length; i++) {
      var r = this.ripples[i];
      var t = clamp01(r.age / r.duration);
      var alpha = 0.55 * (1 - t) * (this.reducedFlash ? 0.5 : 1);
      if (alpha <= 0.002) continue;
      out.push({
        color: r.color,
        radius: Math.max(1, innerRadius + (outerRadius * 1.18 - innerRadius) * easeOutQuad(t)),
        lineWidth: Math.max(1, 3 * (1 - t) + 1),
        alpha: alpha
      });
    }
    return out;
  };

  /* Floating labels: dx is an offset from the HUD centre, rise is upward px. */
  Effects.prototype.labelList = function () {
    var cfg = this.fxConfig().floatingScore;
    var out = [];
    for (var i = 0; i < this.labels.length; i++) {
      var l = this.labels[i];
      var t = clamp01(l.age / l.duration);
      var alpha = Math.min(1, l.age / 40) * (1 - t * t);
      if (alpha <= 0.003) continue;
      out.push({
        text: l.text,
        color: l.color,
        dx: l.x,
        rise: this.reducedMotion ? 0 : cfg.risePx * easeOutCubic(t),
        alpha: alpha
      });
    }
    return out;
  };

  /* Collected hearts travelling to their HUD slot. `slotFor(index)` returns
   * {x, y} for a life slot. */
  Effects.prototype.flightList = function (slotFor, baseSize) {
    var out = [];
    for (var i = 0; i < this.flights.length; i++) {
      var f = this.flights[i];
      var t = clamp01(f.age / f.duration);
      var eased = easeOutCubic(t);
      var target = slotFor(f.toIndex);
      out.push({
        x: f.fromX + (target.x - f.fromX) * eased,
        y: f.fromY + (target.y - f.fromY) * eased,
        size: baseSize * (1.35 - 0.35 * eased),
        alpha: clamp01(t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15)
      });
    }
    return out;
  };

  /* Visual-only translation for the ring group. Never affects collision. */
  Effects.prototype.offset = function () {
    if (this.reducedMotion || !this.shakes.length) return [0, 0];
    var s = this.shakes[this.shakes.length - 1];
    var decay = 1 - clamp01(s.age / s.duration);
    var amount = s.amount * decay;
    return [Math.sin(s.age * 0.15) * amount, Math.cos(s.age * 0.12) * amount * 0.6];
  };

  Effects.prototype.scoreScale = function () {
    var cfg = this.fxConfig().success;
    if (this.reducedMotion && this.config.effects.reducedMotion.disableZoom) return 1;
    var t = clamp01(this.scorePopAge / cfg.scorePopMs);
    if (t >= 1) return 1;
    return 1 + (cfg.scoreScale - 1) * Math.sin(Math.PI * t);
  };

  Effects.prototype.heartScale = function (index) {
    var cfg = this.fxConfig().heal;
    var scale = 1;
    if (this.reducedMotion && this.config.effects.reducedMotion.disableZoom) return 1;
    this.heartPops.forEach(function (p) {
      if (p.index !== index) return;
      var t = clamp01(p.age / cfg.heartPopMs);
      if (t < 1) scale = Math.max(scale, 1 + (cfg.heartScale - 1) * Math.sin(Math.PI * t));
    });
    return scale;
  };

  /* Extra stroke weight and brightness on the inner arc just after a reset. */
  Effects.prototype.timerPulseAmount = function () {
    var t = clamp01(this.timerPulseAge / this.fxConfig().timerPulseMs);
    return t >= 1 ? 0 : 1 - t;
  };

  Effects.easeOutCubic = easeOutCubic;

  global.CP = global.CP || {};
  global.CP.Effects = Effects;
})(window);
