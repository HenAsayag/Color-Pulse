/* The rotating target ring: which sectors exist, where, and what the marker
 * is currently over. Pure logic, no rendering and no DOM, so the rules can be
 * exercised headlessly by tests/rules.test.js.
 *
 * Sector lifecycle
 *   'in'   fading/scaling in     -> collision OFF (never judgeable while invisible)
 *   'live' fully present         -> collision ON
 *   'out'  fading/scaling out    -> collision OFF (switched off the instant it is consumed)
 *
 * Placement guarantees, enforced by findPlacement():
 *   - a new sector never overlaps an existing one, and keeps a dark minimum gap
 *   - a new sector never appears already covering the marker
 *   - a new sector always appears at least `spawnLeadDeg` of travel BEFORE the
 *     marker, so every generated target is reachable and visible in advance
 */
(function (global) {
  'use strict';

  var G = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./geometry.js')
    : global.CP.geometry;

  var TAU = G.TAU;
  var nextUid = 1;

  function Ring(config, rng) {
    this.config = config;
    this.rng = rng;
    this.sectors = [];
    this.pending = [];
    this.direction = 1;   /* +1 clockwise, -1 anticlockwise; set by the Game */
    this.speed = config.rules.speedStartRadPerSec;  /* kept in step by the Game */
    this.archetypes = {};
    var self = this;
    config.sectors.forEach(function (s) { self.archetypes[s.id] = s; });
    this.baseTypes = config.sectors
      .filter(function (s) { return !s.heals; })
      .map(function (s) { return s.id; });
  }

  Ring.prototype.rules = function () { return this.config.rules; };

  Ring.prototype.spanFor = function (type) {
    var arch = this.archetypes[type];
    var jitter = arch.spanJitterDeg || 0;
    var deg = arch.spanDeg + this.rng.range(-jitter, jitter);
    return G.degToRad(Math.max(6, deg));
  };

  Ring.prototype.make = function (type, start, span, phase) {
    var arch = this.archetypes[type];
    return {
      uid: nextUid++,
      id: type,
      color: arch.color,
      points: arch.points,
      heals: arch.heals || 0,
      start: G.norm(start),
      span: span,
      phase: phase || 'in',
      phaseAge: 0
    };
  };

  /* Build the opening layout. The marker always starts inside a dark gap. */
  Ring.prototype.reset = function () {
    this.sectors = [];
    this.pending = [];
    this.direction = 1;
    var rules = this.rules();
    var minGap = G.degToRad(rules.minGapDeg);
    var types = this.baseTypes.slice();

    /* Shuffle the ordering around the circle. */
    for (var i = types.length - 1; i > 0; i--) {
      var j = this.rng.int(0, i);
      var tmp = types[i]; types[i] = types[j]; types[j] = tmp;
    }

    var spans = types.map(this.spanFor, this);
    var total = spans.reduce(function (a, b) { return a + b; }, 0);
    var count = types.length;
    var slack = TAU - total - count * minGap;

    /* If the archetypes cannot fit with gaps, shrink them proportionally. */
    if (slack < 0) {
      var scale = (TAU - count * minGap) / total;
      spans = spans.map(function (s) { return s * scale; });
      slack = 0;
    }

    /* Split the leftover circle into random gap portions. */
    var weights = types.map(function () { return this.rng.range(0.35, 1); }, this);
    var weightSum = weights.reduce(function (a, b) { return a + b; }, 0);
    var gaps = weights.map(function (w) { return minGap + slack * (w / weightSum); });

    /* Lay out gap, sector, gap, sector... The run of sectors closes the circle
     * exactly, so the arrangement has to START a little BEFORE angle 0 for the
     * marker to sit inside the first gap rather than inside the last sector.
     * The random setback keeps openings varied while holding a clear margin on
     * both sides of the marker. */
    var margin = minGap * 0.4;
    var setback = this.rng.range(margin, Math.max(margin, gaps[0] - margin));
    var cursor = -setback;
    for (var k = 0; k < types.length; k++) {
      cursor += gaps[k];
      this.sectors.push(this.make(types[k], cursor, spans[k], 'live'));
      cursor += spans[k];
    }
    return this.sectors;
  };

  /* Advance spawn/despawn transitions. dt is simulation milliseconds. */
  Ring.prototype.update = function (dt, ringAngle) {
    var rules = this.rules();
    var kept = [];
    for (var i = 0; i < this.sectors.length; i++) {
      var s = this.sectors[i];
      s.phaseAge += dt;
      if (s.phase === 'in' && s.phaseAge >= rules.spawnMs) {
        s.phase = 'live';
        s.phaseAge = 0;
      }
      if (s.phase === 'out' && s.phaseAge >= rules.despawnMs) continue;
      kept.push(s);
    }
    this.sectors = kept;

    /* Try to place anything that had no room last time. */
    if (this.pending.length) {
      var stillPending = [];
      for (var p = 0; p < this.pending.length; p++) {
        if (!this.spawn(this.pending[p], ringAngle)) stillPending.push(this.pending[p]);
      }
      this.pending = stillPending;
    }
  };

  /* Sectors that can currently be struck. */
  Ring.prototype.liveSectors = function () {
    return this.sectors.filter(function (s) { return s.phase === 'live'; });
  };

  /* Which live sector is under the fixed marker right now? */
  Ring.prototype.hitTest = function (ringAngle) {
    var marker = this.config.geometry.markerAngle || 0;
    var live = this.liveSectors();
    for (var i = 0; i < live.length; i++) {
      var abs = G.norm(ringAngle + live[i].start);
      if (G.arcContains(abs, live[i].span, marker)) return live[i];
    }
    return null;
  };

  Ring.prototype.hasType = function (type) {
    return this.sectors.some(function (s) { return s.id === type && s.phase !== 'out'; });
  };

  /* Absolute (screen) start angle of a sector for a given ring rotation. */
  Ring.prototype.absoluteStart = function (sector, ringAngle) {
    return G.norm(ringAngle + sector.start);
  };

  /* Remove a struck sector and queue a replacement that keeps the composition
   * close to the reference: roughly one yellow, one blue, one green alive. */
  Ring.prototype.consume = function (sector, ringAngle) {
    sector.phase = 'out';
    sector.phaseAge = 0;
    if (!sector.heals) {
      var replacement = this.chooseReplacementType();
      if (!this.spawn(replacement, ringAngle)) this.pending.push(replacement);
    }
  };

  Ring.prototype.chooseReplacementType = function () {
    var counts = {};
    var self = this;
    this.baseTypes.forEach(function (t) { counts[t] = 0; });
    this.sectors.forEach(function (s) {
      if (s.phase !== 'out' && counts[s.id] !== undefined) counts[s.id]++;
    });
    var fewest = Infinity;
    this.baseTypes.forEach(function (t) { if (counts[t] < fewest) fewest = counts[t]; });
    var candidates = this.baseTypes.filter(function (t) { return counts[t] === fewest; });
    return candidates[self.rng.int(0, candidates.length - 1)];
  };

  /* Occasional orange collectible; never more than one at a time. */
  Ring.prototype.maybeSpawnHeart = function (ringAngle) {
    var rules = this.rules();
    if (this.hasType('orange')) return false;
    if (!this.rng.chance(rules.heartSpawnChancePerSuccess)) return false;
    return this.spawn('orange', ringAngle);
  };

  /* Find a legal absolute start angle for a sector of `span`. Returns null
   * when the ring is momentarily too crowded; the caller retries next frame
   * rather than forcing an overlapping or unreachable target. */
  Ring.prototype.findPlacement = function (span, ringAngle, leadRad) {
    var rules = this.rules();
    var minGap = G.degToRad(rules.minGapDeg);
    var clear = G.degToRad(rules.spawnClearDeg);
    var self = this;

    /* Band of legal start angles A, measured from the marker at 0. Which edge
     * of the sector leads depends on which way the ring is currently turning,
     * so the band mirrors when the direction flips.
     *
     *   clockwise (+1): A grows; the far edge A+span reaches the marker
     *   anticlockwise (-1): A shrinks; A itself reaches the marker
     *
     * The TRAILING side needs a margin too, not just `clear`. Every press
     * reverses the ring, and a press can land while this sector is still
     * fading in — at which point the trailing edge becomes the leading one.
     * Without the floor, a sector placed just past the marker would swing
     * straight back onto it and turn collidable right there. */
    var behind = Math.max(clear, this.minLead());
    var lo, hi;
    if (this.direction >= 0) {
      lo = behind;
      hi = TAU - leadRad - span;
    } else {
      lo = leadRad;
      hi = TAU - behind - span;
    }
    if (hi <= lo) return null;

    var blocked = this.sectors.map(function (s) {
      return {
        start: self.absoluteStart(s, ringAngle) - minGap,
        span: s.span + 2 * minGap
      };
    });

    var free = G.freeIntervals(blocked);
    var candidates = [];
    free.forEach(function (interval) {
      /* Unwrap the circular interval into linear pieces on [0, TAU). */
      var pieces = [];
      var end = interval.start + interval.span;
      if (end <= TAU) pieces.push([interval.start, end]);
      else { pieces.push([interval.start, TAU]); pieces.push([0, end - TAU]); }

      pieces.forEach(function (piece) {
        var a0 = Math.max(piece[0], lo);
        var a1 = Math.min(piece[1] - span, hi);
        if (a1 > a0) candidates.push({ lo: a0, hi: a1, weight: a1 - a0 });
      });
    });

    if (!candidates.length) return null;

    var totalWeight = candidates.reduce(function (a, c) { return a + c.weight; }, 0);
    var roll = this.rng() * totalWeight;
    for (var i = 0; i < candidates.length; i++) {
      roll -= candidates[i].weight;
      if (roll <= 0 || i === candidates.length - 1) {
        return this.rng.range(candidates[i].lo, candidates[i].hi);
      }
    }
    return null;
  };

  /* How much travel a new sector needs before it reaches the marker.
   *
   * A fixed angle is wrong: the ring speeds up as the score climbs, so the
   * same 70 degrees buys less and less time, and at the top speed a sector
   * would still be fading in — uncollidable — as it passed the marker. The
   * lead is therefore measured in TIME and converted with the current speed:
   * long enough to finish fading in, plus a grace period where it is live and
   * visible before it can be struck.
   */
  Ring.prototype.leadFor = function () {
    var rules = this.rules();
    var speed = Math.max(0.1, this.speed || rules.speedStartRadPerSec);
    var byTime = speed * (rules.spawnMs + rules.spawnGraceMs) / 1000;
    return Math.max(G.degToRad(rules.spawnLeadDeg), byTime);
  };

  /* The absolute floor: a sector must at minimum be fully faded in, with
   * margin, before it can arrive. Never place one closer than this. */
  Ring.prototype.minLead = function () {
    var rules = this.rules();
    var speed = Math.max(0.1, this.speed || rules.speedStartRadPerSec);
    return speed * (rules.spawnMs * 1.8) / 1000;
  };

  Ring.prototype.spawn = function (type, ringAngle) {
    var span = this.spanFor(type);
    var preferred = this.leadFor();
    var floor = this.minLead();

    /* Prefer a comfortable lead, accept a tighter one when the ring is busy,
     * but never go below the fade-in floor: the caller retries next frame
     * instead of producing a target that pops in on top of the marker. */
    var absStart = this.findPlacement(span, ringAngle, preferred);
    if (absStart === null) {
      absStart = this.findPlacement(span, ringAngle, Math.max(floor, preferred * 0.7));
    }
    if (absStart === null) absStart = this.findPlacement(span, ringAngle, floor);
    if (absStart === null) return false;

    this.sectors.push(this.make(type, absStart - ringAngle, span, 'in'));
    return true;
  };

  /* Re-roll every visible sector's width, keeping each one centred where it
   * already is so the ring reshapes in place rather than jumping.
   *
   * Widths are relaxed against their neighbours afterwards: two sectors whose
   * new widths would close the dark gap between them are scaled back together
   * until the minimum gap holds again. Centres never move, so this cannot
   * push a sector onto the marker or reorder the ring.
   */
  Ring.prototype.resizeAll = function (ringAngle) {
    var rules = this.rules();
    var minGap = G.degToRad(rules.minGapDeg);
    var minSpan = G.degToRad(rules.minSpanDeg);
    var self = this;

    var items = this.sectors
      .filter(function (s) { return s.phase !== 'out'; })
      .map(function (s) {
        return {
          sector: s,
          center: G.norm(ringAngle + s.start + s.span / 2),
          span: self.spanFor(s.id)
        };
      });
    if (!items.length) return;

    if (items.length === 1) {
      items[0].span = Math.min(items[0].span, TAU - 2 * minGap);
    } else {
      items.sort(function (a, b) { return a.center - b.center; });
      for (var pass = 0; pass < 10; pass++) {
        var changed = false;
        for (var i = 0; i < items.length; i++) {
          var a = items[i];
          var b = items[(i + 1) % items.length];
          var between = G.cwDelta(a.center, b.center);
          var halves = a.span / 2 + b.span / 2;
          if (halves + minGap > between + 1e-9) {
            var room = Math.max(0, between - minGap);
            var scale = halves > 1e-9 ? room / halves : 0;
            a.span = Math.max(minSpan, a.span * scale);
            b.span = Math.max(minSpan, b.span * scale);
            changed = true;
          }
        }
        if (!changed) break;
      }
    }

    items.forEach(function (it) {
      it.sector.span = it.span;
      it.sector.start = G.norm(it.center - it.span / 2 - ringAngle);
    });
  };

  /* Render-facing snapshot: absolute angles plus transition progress. */
  Ring.prototype.snapshot = function (ringAngle) {
    var rules = this.rules();
    var self = this;
    return this.sectors.map(function (s) {
      var progress = 1;
      if (s.phase === 'in') progress = Math.min(1, s.phaseAge / rules.spawnMs);
      else if (s.phase === 'out') progress = 1 - Math.min(1, s.phaseAge / rules.despawnMs);
      return {
        uid: s.uid,
        id: s.id,
        color: s.color,
        start: self.absoluteStart(s, ringAngle),
        span: s.span,
        phase: s.phase,
        progress: progress,
        heals: s.heals
      };
    });
  };

  var api = { Ring: Ring };
  global.CP = global.CP || {};
  global.CP.Ring = Ring;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
