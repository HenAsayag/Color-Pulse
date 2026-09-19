/* Ring geometry and the single authoritative angle convention.
 *
 * DESIGN ANGLES: 0 rad = twelve o'clock, positive = clockwise, radians.
 * This matches the SVG kit (ASSET_GUIDE.md) and is the only convention used
 * for gameplay state and collision. Canvas needs its own frame, so rendering
 * converts once, at the boundary, with toCanvasAngle().
 *
 * A sector occupies [start, start + span) in design angles. The marker sits at
 * angle 0 and never moves. A sector is "under the marker" when the clockwise
 * distance from its start to 0 is less than its span. Membership is inclusive
 * at the start edge and exclusive at the end edge, which makes two touching
 * sectors unambiguous.
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

  /* Normalise any angle into [0, TAU). */
  function norm(angle) {
    var a = angle % TAU;
    return a < 0 ? a + TAU : a;
  }

  /* Clockwise distance from `from` to `to`, always in [0, TAU). */
  function cwDelta(from, to) {
    return norm(to - from);
  }

  /* Shortest signed distance from `from` to `to`, in (-PI, PI]. */
  function shortestDelta(from, to) {
    var d = norm(to - from);
    return d > Math.PI ? d - TAU : d;
  }

  function degToRad(deg) { return deg * Math.PI / 180; }
  function radToDeg(rad) { return rad * 180 / Math.PI; }

  /* Design frame -> canvas frame. Canvas 0 rad points right and grows
   * clockwise on screen (y axis points down), so top is -PI/2. */
  function toCanvasAngle(designAngle) {
    return designAngle - Math.PI / 2;
  }

  /* Point on a circle for a design angle. */
  function pointAt(cx, cy, radius, designAngle) {
    return {
      x: cx + radius * Math.sin(designAngle),
      y: cy - radius * Math.cos(designAngle)
    };
  }

  /* Does [start, start + span) contain `angle`? Wrap-safe for any input. */
  function arcContains(start, span, angle) {
    if (span <= 0) return false;
    if (span >= TAU) return true;
    return cwDelta(start, angle) < span;
  }

  /* Do [aStart, aStart + aSpan) and [bStart, bStart + bSpan) overlap? */
  function arcsOverlap(aStart, aSpan, bStart, bSpan) {
    if (aSpan <= 0 || bSpan <= 0) return false;
    if (aSpan + bSpan >= TAU) return true;
    return cwDelta(aStart, bStart) < aSpan || cwDelta(bStart, aStart) < bSpan;
  }

  /* Free intervals on the circle once `blocked` ({start, span}) is removed.
   * Returns a list of {start, span} in design angles; order is not meaningful,
   * callers weight by span themselves.
   *
   * The blocked intervals may OVERLAP and may wrap past 0 — which is exactly
   * what happens when sectors are padded by a minimum gap on both sides — so
   * they have to be merged before the complement is taken. Treating them as
   * disjoint produces phantom free space spanning other sectors.
   */
  function freeIntervals(blocked) {
    var EPS = 1e-9;

    /* Cut every interval at the 0/TAU seam so they are all plain segments. */
    var segments = [];
    for (var i = 0; i < blocked.length; i++) {
      var span = Math.min(Math.max(blocked[i].span, 0), TAU);
      if (span <= EPS) continue;
      var start = norm(blocked[i].start);
      var end = start + span;
      if (end <= TAU) {
        segments.push([start, end]);
      } else {
        segments.push([start, TAU]);
        segments.push([0, end - TAU]);
      }
    }
    if (!segments.length) return [{ start: 0, span: TAU }];

    segments.sort(function (a, b) { return a[0] - b[0]; });

    var merged = [segments[0].slice()];
    for (var j = 1; j < segments.length; j++) {
      var last = merged[merged.length - 1];
      if (segments[j][0] <= last[1] + EPS) {
        if (segments[j][1] > last[1]) last[1] = segments[j][1];
      } else {
        merged.push(segments[j].slice());
      }
    }

    var free = [];
    var cursor = 0;
    for (var k = 0; k < merged.length; k++) {
      if (merged[k][0] - cursor > 1e-6) free.push([cursor, merged[k][0]]);
      if (merged[k][1] > cursor) cursor = merged[k][1];
    }
    if (TAU - cursor > 1e-6) free.push([cursor, TAU]);

    /* A free run touching both ends of the cut is really one wrapping run. */
    if (free.length > 1 && free[0][0] <= EPS && free[free.length - 1][1] >= TAU - EPS) {
      var head = free.shift();
      var tail = free.pop();
      free.push([tail[0], tail[1] + (head[1] - head[0])]);
    }

    return free.map(function (f) { return { start: norm(f[0]), span: f[1] - f[0] }; });
  }

  /* Intersect a free interval with an allowed band, both {start, span}. */
  function intersectInterval(a, b) {
    var out = [];
    if (a.span <= 0 || b.span <= 0) return out;
    if (a.span >= TAU) return [{ start: b.start, span: b.span }];
    if (b.span >= TAU) return [{ start: a.start, span: a.span }];
    /* Walk `a` and clip against `b`. */
    var offset = cwDelta(b.start, a.start);
    var startInB = offset < b.span;
    var aEndOffset = offset + a.span;
    if (startInB) {
      var span = Math.min(a.span, b.span - offset);
      if (span > 1e-6) out.push({ start: a.start, span: span });
      /* `a` may re-enter `b` after wrapping all the way round. */
      if (aEndOffset > TAU) {
        var wrapped = Math.min(aEndOffset - TAU, b.span);
        if (wrapped > 1e-6) out.push({ start: b.start, span: wrapped });
      }
    } else {
      var toB = cwDelta(a.start, b.start);
      if (toB < a.span) {
        var span2 = Math.min(b.span, a.span - toB);
        if (span2 > 1e-6) out.push({ start: b.start, span: span2 });
      }
    }
    return out;
  }

  var api = {
    TAU: TAU,
    norm: norm,
    cwDelta: cwDelta,
    shortestDelta: shortestDelta,
    degToRad: degToRad,
    radToDeg: radToDeg,
    toCanvasAngle: toCanvasAngle,
    pointAt: pointAt,
    arcContains: arcContains,
    arcsOverlap: arcsOverlap,
    freeIntervals: freeIntervals,
    intersectInterval: intersectInterval
  };

  global.CP = global.CP || {};
  global.CP.geometry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
