/* Canvas 2D renderer — the fallback used when WebGL cannot be created.
 *
 * Same public API and same visual result as the WebGL renderer, drawn with
 * stroked arcs instead of a shader. It reads exactly the same effects state,
 * so behaviour cannot drift between the two.
 *
 * Draw order matters and follows the reference clip: the colour flash is the
 * BACKGROUND, with the ring and its colours still drawn on top of it. Hearts
 * are drawn after every arc, so a heart is never covered by a colour.
 */
(function (global) {
  'use strict';

  var Layout = global.CP.layout;
  var Color = global.CP.color;
  var G = global.CP.geometry;
  var TAU = G.TAU;

  function Renderer2D(canvas, config, images) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = config;
    this.images = images || {};
    this.layout = null;
    this.dpr = 1;
    this.backend = 'canvas2d';
    this._digitWidth = {};
  }

  Renderer2D.prototype.computeLayout = function (cssW, cssH) {
    this.layout = Layout.compute(this.config, cssW, cssH);
    return this.layout;
  };

  Renderer2D.prototype.resize = function (cssW, cssH) {
    var dpr = Math.min(global.devicePixelRatio || 1, this.config.layout.maxDpr);
    var pw = Math.max(1, Math.round(cssW * dpr));
    var ph = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.dpr = dpr;
    this._digitWidth = {};
    return this.computeLayout(cssW, cssH);
  };

  Renderer2D.prototype.heartSlot = function (index) {
    return Layout.heartSlot(this.config, this.layout, index);
  };

  Renderer2D.prototype.ringPoint = function (designAngle, radius) {
    var l = this.layout;
    return G.pointAt(l.cx, l.cy, radius === undefined ? l.radius : radius, designAngle);
  };

  Renderer2D.prototype.draw = function (snapshot, fx, displayScore) {
    var ctx = this.ctx;
    var l = this.layout;
    if (!l) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    /* 1. Playfield background, tinted by any active flash. */
    ctx.fillStyle = Color.css(fx.backgroundColor());
    ctx.fillRect(0, 0, l.W, l.H);

    /* 2. The ring group, with visual-only shake. */
    var shake = fx.offset();
    ctx.save();
    ctx.translate(shake[0], shake[1]);
    this.drawTrack(ctx);
    this.drawSectors(ctx, snapshot.sectors);
    this.drawInnerArc(ctx, snapshot, fx);
    this.drawMarker(ctx);
    ctx.restore();

    /* 3. Heart badges, after every arc so a colour can never cover them. */
    this.drawHeartBadges(ctx, snapshot.sectors, shake);

    /* 4. Ripples above the ring. */
    this.drawRipples(ctx, fx);

    /* 5. HUD, never shaken. */
    this.drawScore(ctx, displayScore, fx.scoreScale());
    this.drawHearts(ctx, snapshot.lives, fx);
    this.drawLabels(ctx, fx);
    this.drawFlights(ctx, fx);
  };

  Renderer2D.prototype.drawTrack = function (ctx) {
    var l = this.layout;
    ctx.save();
    ctx.strokeStyle = this.config.palette.track;
    ctx.lineWidth = l.ringWidth;
    ctx.beginPath();
    ctx.arc(l.cx, l.cy, l.radius, 0, TAU);
    ctx.stroke();
    ctx.restore();
  };

  Renderer2D.prototype.drawSectors = function (ctx, sectors) {
    var l = this.layout;
    ctx.save();
    ctx.lineCap = 'butt';           /* flat radial ends, as in the clip */
    for (var i = 0; i < sectors.length; i++) {
      var s = sectors[i];
      if (s.progress <= 0.001) continue;
      ctx.globalAlpha = s.progress;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = l.ringWidth * (0.55 + 0.45 * s.progress);
      ctx.beginPath();
      ctx.arc(l.cx, l.cy, l.radius, G.toCanvasAngle(s.start), G.toCanvasAngle(s.start + s.span));
      ctx.stroke();
    }
    ctx.restore();
  };

  /* The white heart riding the orange collectible, centred on its arc. */
  Renderer2D.prototype.drawHeartBadges = function (ctx, sectors, shake) {
    var img = this.images['heart-pickup'];
    if (!img) return;
    var l = this.layout;
    for (var i = 0; i < sectors.length; i++) {
      var s = sectors[i];
      if (!s.heals || s.progress <= 0.001) continue;
      var point = G.pointAt(l.cx + shake[0], l.cy + shake[1], l.radius, s.start + s.span / 2);
      var size = l.ringWidth * 0.86 * (0.6 + 0.4 * s.progress);
      ctx.save();
      ctx.globalAlpha = s.progress;
      ctx.drawImage(img, point.x - size / 2, point.y - size / 2, size, size);
      ctx.restore();
    }
  };

  Renderer2D.prototype.drawInnerArc = function (ctx, snapshot, fx) {
    var l = this.layout;
    var rules = this.config.rules;
    var palette = this.config.palette;

    var gap = G.degToRad(rules.innerGapDeg);
    var available = TAU - gap;
    var fraction = rules.timerMode === 'countdown' ? snapshot.timerFraction : 0.88;
    var sweep = Math.max(0.0001, available * fraction);
    var base = G.norm(snapshot.simTime / 1000 * rules.innerRotateRadPerSec + gap / 2);

    var color = fraction > 0.5
      ? Color.mix(palette.lime, palette.green, (fraction - 0.5) / 0.5)
      : Color.mix(palette.yellow, palette.lime, fraction / 0.5);

    var pulse = fx.timerPulseAmount();
    if (pulse > 0) color = Color.mix(color, '#DFFFE4', pulse * 0.75);

    ctx.save();
    ctx.lineCap = 'butt';
    ctx.strokeStyle = Color.css(color);
    ctx.lineWidth = l.innerWidth * (1 + pulse * 0.5);
    ctx.beginPath();
    ctx.arc(l.cx, l.cy, l.innerRadius, G.toCanvasAngle(base), G.toCanvasAngle(base + sweep));
    ctx.stroke();
    ctx.restore();
  };

  /* Fixed strike marker at twelve o'clock. Never rotated. */
  Renderer2D.prototype.drawMarker = function (ctx) {
    var l = this.layout;
    ctx.save();
    ctx.strokeStyle = this.config.palette.white;
    ctx.lineWidth = l.markerWidth;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(l.cx, l.markerTopY);
    ctx.lineTo(l.cx, l.markerBottomY);
    ctx.stroke();
    ctx.restore();
  };

  Renderer2D.prototype.drawRipples = function (ctx, fx) {
    var l = this.layout;
    var ripples = fx.rippleList(l.innerRadius, l.radius);
    for (var i = 0; i < ripples.length; i++) {
      var r = ripples[i];
      ctx.save();
      ctx.globalAlpha = r.alpha;
      ctx.strokeStyle = Color.css(r.color);
      ctx.lineWidth = r.lineWidth;
      ctx.beginPath();
      ctx.arc(l.cx, l.cy, r.radius, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  };

  /* Fixed advance per digit, which is what tabular numerals would give us. */
  Renderer2D.prototype.digitWidth = function (ctx, fontPx) {
    var key = String(fontPx);
    if (this._digitWidth[key]) return this._digitWidth[key];
    var max = 0;
    for (var i = 0; i < 10; i++) max = Math.max(max, ctx.measureText(String(i)).width);
    this._digitWidth[key] = max;
    return max;
  };

  Renderer2D.prototype.drawScore = function (ctx, value, scale) {
    var l = this.layout;
    var text = String(Math.max(0, Math.round(value)));
    ctx.save();
    ctx.translate(l.cx, l.scoreY);
    ctx.scale(scale, scale);
    ctx.font = '700 ' + Math.round(l.scoreFont) + 'px ' + Layout.FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.config.palette.white;
    var dw = this.digitWidth(ctx, Math.round(l.scoreFont));
    var startX = -(dw * text.length) / 2;
    for (var i = 0; i < text.length; i++) {
      ctx.fillText(text[i], startX + dw * i + dw / 2, 0);
    }
    ctx.restore();
  };

  Renderer2D.prototype.drawLabels = function (ctx, fx) {
    var l = this.layout;
    var labels = fx.labelList();
    ctx.save();
    ctx.font = '700 ' + Math.round(l.labelFont) + 'px ' + Layout.FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var margin = 18;
    for (var i = 0; i < labels.length; i++) {
      var lb = labels[i];
      ctx.globalAlpha = lb.alpha;
      ctx.fillStyle = Color.css(lb.color);
      /* final guard: a label can never be drawn off the playfield */
      var x = Math.max(margin, Math.min(l.W - margin, l.cx + lb.dx));
      ctx.fillText(lb.text, x, l.labelY - lb.rise);
    }
    ctx.restore();
  };

  Renderer2D.prototype.drawHearts = function (ctx, lives, fx) {
    var l = this.layout;
    var count = this.config.rules.maxLives;
    for (var i = 0; i < count; i++) {
      var filled = i < lives;
      var img = this.images[filled ? 'heart-full' : 'heart-empty'];
      var slot = this.heartSlot(i);
      var size = l.heartSize * fx.heartScale(i);
      ctx.save();
      if (img) {
        ctx.drawImage(img, slot.x - size / 2, slot.y - size / 2, size, size);
      } else {
        /* Vector fallback keeps lives readable if an SVG failed to load. */
        ctx.fillStyle = filled ? this.config.palette.heart : this.config.palette.emptyHeart;
        ctx.beginPath();
        ctx.arc(slot.x, slot.y, size / 2, 0, TAU);
        if (filled) ctx.fill(); else ctx.stroke();
      }
      ctx.restore();
    }
  };

  /* Drawn last, so the collected heart is never covered. */
  Renderer2D.prototype.drawFlights = function (ctx, fx) {
    var img = this.images['heart-full'];
    if (!img) return;
    var l = this.layout;
    var flights = fx.flightList(this.heartSlot.bind(this), l.heartSize);
    for (var i = 0; i < flights.length; i++) {
      var f = flights[i];
      ctx.save();
      ctx.globalAlpha = f.alpha;
      ctx.drawImage(img, f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
      ctx.restore();
    }
  };

  global.CP = global.CP || {};
  global.CP.Renderer2D = Renderer2D;
})(window);
