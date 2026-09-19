/* Viewport fitting, shared by both renderers.
 *
 * Builds the portrait composition the way the reference frames are built:
 * score high in the playfield, hearts directly under it, a band for the
 * floating labels, then the ring centred in whatever height is left. The ring
 * shrinks until it fits, so 320px wide and short landscape boxes stay usable.
 *
 * All values are CSS pixels. Device pixel ratio is handled separately by the
 * renderer, so a DPR change never alters the composition.
 */
(function (global) {
  'use strict';

  var DESIGN_CENTER = 256;   /* the kit's 512 viewBox centre */

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function stackMetrics(config, d, cssW, cssH) {
    var L = config.layout;
    var scoreFont = clamp(d * L.scoreToRing, L.scoreMin, L.scoreMax);
    var heartSize = clamp(d * L.heartToRing, L.heartMin, L.heartMax);
    var topPad = Math.max(10, cssH * 0.045);
    var gap1 = scoreFont * 0.18;
    var labelBand = scoreFont * 0.72;
    /* Room at the foot for the labelled TAP button, which CSS hides on short
     * screens; keep the two rules in step. */
    var tapVisible = cssH > 560 && cssW >= 300;
    var bottomPad = tapVisible ? 76 : Math.max(10, cssH * 0.02);
    var headerHeight = topPad + scoreFont + gap1 + heartSize + labelBand;
    return {
      scoreFont: scoreFont,
      heartSize: heartSize,
      topPad: topPad,
      gap1: gap1,
      labelBand: labelBand,
      bottomPad: bottomPad,
      headerHeight: headerHeight,
      available: Math.max(40, cssH - headerHeight - bottomPad)
    };
  }

  function compute(config, cssW, cssH) {
    var L = config.layout;
    var geo = config.geometry;

    var d = Math.min(cssW * L.ringWidthFraction, L.maxRingDiameter);
    var metrics = stackMetrics(config, d, cssW, cssH);

    for (var pass = 0; pass < 6; pass++) {
      metrics = stackMetrics(config, d, cssW, cssH);
      if (d <= metrics.available || d <= L.minRingDiameter) break;
      d = Math.max(L.minRingDiameter, metrics.available);
    }

    var scoreY = metrics.topPad + metrics.scoreFont / 2;
    var heartY = scoreY + metrics.scoreFont / 2 + metrics.gap1 + metrics.heartSize / 2;
    var labelY = heartY + metrics.heartSize / 2 + metrics.labelBand * 0.55;
    var cy = metrics.headerHeight + Math.max(d, metrics.available) * L.verticalBias;
    var cx = cssW / 2;

    /* Design units -> CSS px. d is the OUTER EDGE diameter of the thick ring,
     * whose design radius is outerRadius + outerWidth / 2. */
    var s = (d / 2) / (geo.outerRadius + geo.outerWidth / 2);

    return {
      W: cssW,
      H: cssH,
      scale: s,
      ringDiameter: d,
      cx: cx,
      cy: cy,
      radius: geo.outerRadius * s,
      ringWidth: geo.outerWidth * s,
      innerRadius: geo.innerRadius * s,
      innerWidth: geo.innerWidth * s,
      markerTopY: cy - (DESIGN_CENTER - geo.markerTop) * s,
      markerBottomY: cy - (DESIGN_CENTER - geo.markerBottom) * s,
      markerWidth: Math.max(2, geo.markerWidth * s),
      scoreY: scoreY,
      scoreFont: metrics.scoreFont,
      heartY: heartY,
      heartSize: metrics.heartSize,
      heartSpacing: metrics.heartSize * 1.35,
      labelY: labelY,
      labelFont: clamp(metrics.scoreFont * 0.31, 13, 24)
    };
  }

  function heartSlot(config, layout, index) {
    var count = config.rules.maxLives;
    return {
      x: layout.cx + (index - (count - 1) / 2) * layout.heartSpacing,
      y: layout.heartY
    };
  }

  global.CP = global.CP || {};
  global.CP.layout = {
    compute: compute,
    stackMetrics: stackMetrics,
    heartSlot: heartSlot,
    FONT: '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'
  };
})(window);
