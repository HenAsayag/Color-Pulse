/* WebGL renderer.
 *
 * The whole playfield — flash background, ring track, every colour sector, the
 * inner countdown arc, the ripples and the fixed marker — is one fullscreen
 * quad whose fragment shader evaluates the ring analytically in polar
 * coordinates. Nothing is stroked or rasterised on the CPU, and every edge is
 * anti-aliased in the shader against its own pixel-space distance, so the arcs
 * stay clean at any device pixel ratio.
 *
 * Sprites (the heart artwork and the text glyphs) are textured quads drawn in
 * a second pass, always ON TOP of the ring, so a heart can never be covered by
 * a colour.
 *
 * Angles arrive in the design convention (0 = twelve o'clock, clockwise) and
 * the shader works in that convention directly: atan(x, -y).
 */
(function (global) {
  'use strict';

  var GL = global.CP.gl;
  var Layout = global.CP.layout;
  var Color = global.CP.color;
  var G = global.CP.geometry;
  var TAU = G.TAU;

  var MAX_SECTORS = 8;
  var MAX_RIPPLES = 4;

  /* ---- shaders ---------------------------------------------------------- */

  var QUAD_VS = [
    'attribute vec2 a_pos;',
    'uniform vec2 u_res;',
    'varying vec2 v_px;',
    'void main() {',
    /* unit quad -> clip space, and a pixel coord with y growing downward */
    '  vec2 clip = a_pos * 2.0 - 1.0;',
    '  v_px = vec2(a_pos.x * u_res.x, (1.0 - a_pos.y) * u_res.y);',
    '  gl_Position = vec4(clip.x, clip.y, 0.0, 1.0);',
    '}'
  ].join('\n');

  var SCENE_FS = [
    'precision highp float;',
    'varying vec2 v_px;',
    'const float TAU = 6.283185307179586;',
    'uniform vec2 u_center;',
    'uniform vec2 u_shake;',
    'uniform vec3 u_bg;',
    'uniform vec3 u_track;',
    'uniform float u_radius;',
    'uniform float u_ringWidth;',
    'uniform int u_sectorCount;',
    /* x: start, y: span, z: widthScale, w: alpha */
    'uniform vec4 u_sectors[' + MAX_SECTORS + '];',
    'uniform vec3 u_sectorColor[' + MAX_SECTORS + '];',
    /* x: start, y: sweep, z: radius, w: width */
    'uniform vec4 u_inner;',
    'uniform vec3 u_innerColor;',
    'uniform int u_rippleCount;',
    /* x: radius, y: lineWidth, z: alpha */
    'uniform vec3 u_ripples[' + MAX_RIPPLES + '];',
    'uniform vec3 u_rippleColor[' + MAX_RIPPLES + '];',
    /* x: halfWidth, y: topY, z: bottomY */
    'uniform vec3 u_marker;',
    'uniform vec3 u_markerColor;',
    '',
    /* coverage of a radial band, anti-aliased over one pixel */
    'float bandMask(float r, float center, float halfWidth) {',
    '  float d = halfWidth - abs(r - center);',
    '  return clamp(d + 0.5, 0.0, 1.0);',
    '}',
    '',
    /* coverage of an angular wedge, measured in pixels at radius r */
    'float wedgeMask(float ang, float start, float span, float r) {',
    '  float halfSpan = span * 0.5;',   /* "half" is a reserved word in GLSL */
    '  float d = mod(ang - start, TAU);',
    '  float centered = abs(d - halfSpan);',
    '  float insidePx = (halfSpan - centered) * max(r, 1.0);',
    '  return clamp(insidePx + 0.5, 0.0, 1.0);',
    '}',
    '',
    'void main() {',
    '  vec3 col = u_bg;',
    '',
    /* the ring group carries the miss shake; the background does not */
    '  vec2 p = (v_px - u_shake) - u_center;',
    '  float r = length(p);',
    '  float ang = atan(p.x, -p.y);',
    '  if (ang < 0.0) ang += TAU;',
    '',
    '  float trackHalf = u_ringWidth * 0.5;',
    '  col = mix(col, u_track, bandMask(r, u_radius, trackHalf));',
    '',
    '  for (int i = 0; i < ' + MAX_SECTORS + '; i++) {',
    '    if (i < u_sectorCount) {',
    '      vec4 s = u_sectors[i];',
    '      float m = bandMask(r, u_radius, trackHalf * s.z) * wedgeMask(ang, s.x, s.y, r);',
    '      col = mix(col, u_sectorColor[i], m * s.w);',
    '    }',
    '  }',
    '',
    '  float innerMask = bandMask(r, u_inner.z, u_inner.w * 0.5)',
    '                  * wedgeMask(ang, u_inner.x, u_inner.y, r);',
    '  col = mix(col, u_innerColor, innerMask);',
    '',
    /* the marker is a fixed vertical tick, drawn over the track */
    '  float mx = clamp(u_marker.x - abs(p.x) + 0.5, 0.0, 1.0);',
    '  float py = v_px.y - u_shake.y;',
    '  float my = clamp(py - u_marker.y + 0.5, 0.0, 1.0)',
    '           * clamp(u_marker.z - py + 0.5, 0.0, 1.0);',
    '  col = mix(col, u_markerColor, mx * my);',
    '',
    /* ripples expand from the inner ring and are not shaken */
    '  float rr = length(v_px - u_center);',
    '  for (int i = 0; i < ' + MAX_RIPPLES + '; i++) {',
    '    if (i < u_rippleCount) {',
    '      vec3 rp = u_ripples[i];',
    '      col = mix(col, u_rippleColor[i], bandMask(rr, rp.x, rp.y * 0.5) * rp.z);',
    '    }',
    '  }',
    '',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var SPRITE_VS = [
    'attribute vec2 a_pos;',
    'uniform vec2 u_res;',
    'uniform vec4 u_rect;',   /* x, y, w, h in CSS px, y down */
    'uniform vec4 u_uv;',     /* u0, v0, u1, v1 */
    'varying vec2 v_uv;',
    'void main() {',
    '  vec2 px = u_rect.xy + a_pos * u_rect.zw;',
    '  vec2 clip = vec2(px.x / u_res.x, 1.0 - px.y / u_res.y) * 2.0 - 1.0;',
    '  v_uv = mix(u_uv.xy, u_uv.zw, a_pos);',
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '}'
  ].join('\n');

  var SPRITE_FS = [
    'precision mediump float;',
    'varying vec2 v_uv;',
    'uniform sampler2D u_tex;',
    'uniform float u_alpha;',
    'uniform vec3 u_tint;',
    'uniform float u_useTint;',
    'void main() {',
    '  vec4 c = texture2D(u_tex, v_uv);',
    /* textures are premultiplied, so tint the colour with the alpha intact */
    '  vec3 rgb = mix(c.rgb, u_tint * c.a, u_useTint);',
    '  gl_FragColor = vec4(rgb, c.a) * u_alpha;',
    '}'
  ].join('\n');

  /* ---- renderer --------------------------------------------------------- */

  function RendererGL(canvas, config, images) {
    this.canvas = canvas;
    this.config = config;
    this.images = images || {};
    this.layout = null;
    this.dpr = 1;
    this.backend = 'webgl';

    var gl = GL.createContext(canvas);
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;

    this.scene = GL.createProgram(gl, QUAD_VS, SCENE_FS);
    this.sprite = GL.createProgram(gl, SPRITE_VS, SPRITE_FS);
    this.quad = GL.createQuad(gl);
    this.atlas = new GL.TextAtlas(gl, Layout.FONT);
    this.textures = {};
    this.atlasSizes = null;

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    /* premultiplied-alpha blending, matching the texture upload */
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    /* Scratch arrays reused every frame so drawing allocates nothing. */
    this.sectorData = new Float32Array(MAX_SECTORS * 4);
    this.sectorColors = new Float32Array(MAX_SECTORS * 3);
    this.rippleData = new Float32Array(MAX_RIPPLES * 3);
    this.rippleColors = new Float32Array(MAX_RIPPLES * 3);

    this.handleContextLost = this.handleContextLost.bind(this);
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
  }

  RendererGL.prototype.handleContextLost = function (event) {
    /* Nothing to restore automatically; report it rather than drawing garbage. */
    event.preventDefault();
    this.lost = true;
    console.warn('COLOR PULSE: WebGL context lost');
  };

  RendererGL.prototype.texture = function (name) {
    if (this.textures[name]) return this.textures[name];
    var image = this.images[name];
    if (!image) return null;
    this.textures[name] = GL.createTexture(this.gl, image);
    return this.textures[name];
  };

  /* ---- layout ----------------------------------------------------------- */

  RendererGL.prototype.computeLayout = function (cssW, cssH) {
    this.layout = Layout.compute(this.config, cssW, cssH);
    return this.layout;
  };

  RendererGL.prototype.resize = function (cssW, cssH) {
    var gl = this.gl;
    var dpr = Math.min(global.devicePixelRatio || 1, this.config.layout.maxDpr);
    var pw = Math.max(1, Math.round(cssW * dpr));
    var ph = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.dpr = dpr;
    this.computeLayout(cssW, cssH);
    gl.viewport(0, 0, pw, ph);
    this.rebuildAtlas();
    return this.layout;
  };

  /* Glyphs are rasterised at the exact device-pixel size in use. */
  RendererGL.prototype.rebuildAtlas = function () {
    var l = this.layout;
    var score = Math.max(8, Math.round(l.scoreFont * this.dpr));
    var label = Math.max(8, Math.round(l.labelFont * this.dpr));
    var key = score + ':' + label;
    if (this.atlasSizes === key) return;
    this.atlasSizes = key;
    this.atlas.build([
      { key: 'score', px: score },
      { key: 'label', px: label }
    ]);
  };

  RendererGL.prototype.heartSlot = function (index) {
    return Layout.heartSlot(this.config, this.layout, index);
  };

  RendererGL.prototype.ringPoint = function (designAngle, radius) {
    var l = this.layout;
    return G.pointAt(l.cx, l.cy, radius === undefined ? l.radius : radius, designAngle);
  };

  /* ---- drawing ---------------------------------------------------------- */

  RendererGL.prototype.draw = function (snapshot, fx, displayScore) {
    if (this.lost || !this.layout) return;
    var gl = this.gl;
    var l = this.layout;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.drawScene(snapshot, fx);
    this.drawSprites(snapshot, fx, displayScore);
  };

  RendererGL.prototype.drawScene = function (snapshot, fx) {
    var gl = this.gl;
    var l = this.layout;
    var p = this.scene;
    var palette = this.config.palette;

    gl.useProgram(p.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(p.a.a_pos);
    gl.vertexAttribPointer(p.a.a_pos, 2, gl.FLOAT, false, 0, 0);

    var shake = fx.offset();
    gl.uniform2f(p.u.u_res, l.W, l.H);
    gl.uniform2f(p.u.u_center, l.cx, l.cy);
    gl.uniform2f(p.u.u_shake, shake[0], shake[1]);
    gl.uniform3fv(p.u.u_bg, Color.unit(fx.backgroundColor()));
    gl.uniform3fv(p.u.u_track, Color.unit(palette.track));
    gl.uniform1f(p.u.u_radius, l.radius);
    gl.uniform1f(p.u.u_ringWidth, l.ringWidth);

    /* sectors */
    var sectors = snapshot.sectors;
    var count = 0;
    for (var i = 0; i < sectors.length && count < MAX_SECTORS; i++) {
      var s = sectors[i];
      if (s.progress <= 0.001) continue;
      var rgb = Color.unit(s.color);
      this.sectorData[count * 4 + 0] = s.start;
      this.sectorData[count * 4 + 1] = s.span;
      this.sectorData[count * 4 + 2] = 0.55 + 0.45 * s.progress;
      this.sectorData[count * 4 + 3] = s.progress;
      this.sectorColors[count * 3 + 0] = rgb[0];
      this.sectorColors[count * 3 + 1] = rgb[1];
      this.sectorColors[count * 3 + 2] = rgb[2];
      count++;
    }
    gl.uniform1i(p.u.u_sectorCount, count);
    gl.uniform4fv(p.u.u_sectors, this.sectorData);
    gl.uniform3fv(p.u.u_sectorColor, this.sectorColors);

    /* inner countdown arc */
    var inner = this.innerArc(snapshot, fx);
    gl.uniform4f(p.u.u_inner, inner.start, inner.sweep, l.innerRadius, inner.width);
    gl.uniform3fv(p.u.u_innerColor, Color.unit(inner.color));

    /* marker */
    gl.uniform3f(p.u.u_marker, l.markerWidth * 0.5, l.markerTopY, l.markerBottomY);
    gl.uniform3fv(p.u.u_markerColor, Color.unit(palette.white));

    /* ripples */
    var ripples = fx.rippleList(l.innerRadius, l.radius);
    var rc = Math.min(ripples.length, MAX_RIPPLES);
    for (var j = 0; j < rc; j++) {
      var rp = ripples[j];
      var rgbR = Color.unit(rp.color);
      this.rippleData[j * 3 + 0] = rp.radius;
      this.rippleData[j * 3 + 1] = rp.lineWidth;
      this.rippleData[j * 3 + 2] = rp.alpha;
      this.rippleColors[j * 3 + 0] = rgbR[0];
      this.rippleColors[j * 3 + 1] = rgbR[1];
      this.rippleColors[j * 3 + 2] = rgbR[2];
    }
    gl.uniform1i(p.u.u_rippleCount, rc);
    gl.uniform3fv(p.u.u_ripples, this.rippleData);
    gl.uniform3fv(p.u.u_rippleColor, this.rippleColors);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  /* Thin inner meter. Keeps a visible gap and a drifting start angle, matching
   * the clip; its LENGTH encodes the countdown (see ASSUMPTIONS.md). */
  RendererGL.prototype.innerArc = function (snapshot, fx) {
    var l = this.layout;
    var rules = this.config.rules;
    var palette = this.config.palette;

    var gap = G.degToRad(rules.innerGapDeg);
    var available = TAU - gap;
    var fraction = rules.timerMode === 'countdown' ? snapshot.timerFraction : 0.88;
    var sweep = Math.max(0.0001, available * fraction);
    var base = G.norm(snapshot.simTime / 1000 * rules.innerRotateRadPerSec + gap / 2);

    /* green -> lime -> yellow as the interval runs out */
    var color = fraction > 0.5
      ? Color.mix(palette.lime, palette.green, (fraction - 0.5) / 0.5)
      : Color.mix(palette.yellow, palette.lime, fraction / 0.5);

    var pulse = fx.timerPulseAmount();
    if (pulse > 0) color = Color.mix(color, '#DFFFE4', pulse * 0.75);

    return {
      start: base,
      sweep: sweep,
      width: l.innerWidth * (1 + pulse * 0.5),
      color: color
    };
  };

  /* ---- sprite pass ------------------------------------------------------ */

  RendererGL.prototype.beginSprites = function () {
    var gl = this.gl;
    var p = this.sprite;
    gl.useProgram(p.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(p.a.a_pos);
    gl.vertexAttribPointer(p.a.a_pos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(p.u.u_res, this.layout.W, this.layout.H);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(p.u.u_tex, 0);
  };

  RendererGL.prototype.blit = function (texture, x, y, w, h, uv, alpha, tint) {
    if (!texture) return;
    var gl = this.gl;
    var p = this.sprite;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform4f(p.u.u_rect, x, y, w, h);
    gl.uniform4f(p.u.u_uv, uv[0], uv[1], uv[2], uv[3]);
    gl.uniform1f(p.u.u_alpha, alpha === undefined ? 1 : alpha);
    if (tint) {
      gl.uniform3fv(p.u.u_tint, tint);
      gl.uniform1f(p.u.u_useTint, 1);
    } else {
      gl.uniform1f(p.u.u_useTint, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  var FULL_UV = [0, 0, 1, 1];

  RendererGL.prototype.drawSprites = function (snapshot, fx, displayScore) {
    var l = this.layout;
    this.beginSprites();

    /* Heart badges ride the orange collectible. Drawn in the sprite pass, so
     * they sit above EVERY arc: a heart is never covered by a colour. */
    var shake = fx.offset();
    var badge = this.texture('heart-pickup');
    for (var i = 0; i < snapshot.sectors.length; i++) {
      var s = snapshot.sectors[i];
      if (!s.heals || s.progress <= 0.001) continue;
      var point = G.pointAt(l.cx + shake[0], l.cy + shake[1], l.radius, s.start + s.span / 2);
      var size = l.ringWidth * 0.86 * (0.6 + 0.4 * s.progress);
      this.blit(badge, point.x - size / 2, point.y - size / 2, size, size, FULL_UV, s.progress);
    }

    /* HUD: score, hearts, labels. Never shaken, so the digits stay readable. */
    this.drawScore(displayScore, fx.scoreScale());
    this.drawHearts(snapshot.lives, fx);
    this.drawLabels(fx);

    /* The collected heart lands last of all, so nothing can cover it. */
    var flights = fx.flightList(this.heartSlot.bind(this), l.heartSize);
    var heartTex = this.texture('heart-full');
    for (var f = 0; f < flights.length; f++) {
      var fl = flights[f];
      this.blit(heartTex, fl.x - fl.size / 2, fl.y - fl.size / 2, fl.size, fl.size, FULL_UV, fl.alpha);
    }
  };

  /* Text is drawn glyph by glyph from the atlas, on a fixed tabular advance so
   * a count-up never shifts the number sideways. */
  RendererGL.prototype.drawText = function (text, key, centerX, centerY, color, alpha, scale) {
    var set = this.atlas.sets[key];
    if (!set) return;
    scale = scale === undefined ? 1 : scale;
    var toCss = scale / this.dpr;
    var total = this.atlas.measure(key, text) * toCss;
    var x = centerX - total / 2;
    var tint = Color.unit(color);
    var texture = this.atlas.texture;

    for (var i = 0; i < text.length; i++) {
      var g = set.glyphs[text[i]];
      if (!g) continue;
      var w = g.w * toCss;
      var h = g.h * toCss;
      /* the glyph was drawn `pad` in from its cell, centred vertically */
      this.blit(texture, x - g.pad * toCss, centerY - h / 2, w, h,
                [g.u0, g.v0, g.u1, g.v1], alpha, tint);
      x += g.advance * toCss;
    }
  };

  RendererGL.prototype.drawScore = function (value, scale) {
    var l = this.layout;
    this.drawText(String(Math.max(0, Math.round(value))), 'score',
                  l.cx, l.scoreY, this.config.palette.white, 1, scale);
  };

  RendererGL.prototype.drawLabels = function (fx) {
    var l = this.layout;
    var labels = fx.labelList();
    for (var i = 0; i < labels.length; i++) {
      var lb = labels[i];
      this.drawText(lb.text, 'label', l.cx + lb.dx, l.labelY - lb.rise, lb.color, lb.alpha, 1);
    }
  };

  RendererGL.prototype.drawHearts = function (lives, fx) {
    var l = this.layout;
    var count = this.config.rules.maxLives;
    for (var i = 0; i < count; i++) {
      var filled = i < lives;
      var texture = this.texture(filled ? 'heart-full' : 'heart-empty');
      var slot = this.heartSlot(i);
      var size = l.heartSize * fx.heartScale(i);
      this.blit(texture, slot.x - size / 2, slot.y - size / 2, size, size, FULL_UV, 1);
    }
  };

  global.CP = global.CP || {};
  global.CP.RendererGL = RendererGL;
})(window);
