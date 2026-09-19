/* COLOR PULSE — central tuning configuration.
 * Every value here is a RECONSTRUCTION DEFAULT unless marked "observed".
 * config/game-config.json mirrors these values; when the game is served over
 * http(s) that file is fetched and deep-merged on top, so it can be tuned
 * without touching code. Opened from file:// the fetch fails harmlessly and
 * these built-in defaults are used.
 */
(function (global) {
  'use strict';

  var CONFIG = {
    meta: {
      title: 'COLOR PULSE',
      credit: 'Hen Asayag',
      status: 'Reconstruction defaults, not recovered original source values'
    },

    /* observed: palette sampled from the reference clip */
    palette: {
      background: '#080909',
      track: '#111212',
      yellow: '#FFDA00',
      blue: '#2467F5',
      green: '#19D538',
      orange: '#F56B08',
      lime: '#BCF128',
      heart: '#EF4E73',
      white: '#FFFFFF',
      emptyHeart: '#67716B',
      ripple: '#9AFFB5'
    },

    /* observed: taken from the supplied SVG kit (512 viewBox, centre 256,256) */
    geometry: {
      viewBox: 512,
      center: [256, 256],
      outerRadius: 204,
      outerWidth: 44,
      innerRadius: 170,
      innerWidth: 12,
      markerTop: 13,
      markerBottom: 62,
      markerWidth: 6,
      /* design angles: 0 = twelve o'clock, positive = clockwise, radians. */
      markerAngle: 0
    },

    layout: {
      ringWidthFraction: 0.82,   /* ring outer diameter as a share of canvas width */
      maxRingDiameter: 360,
      minRingDiameter: 150,
      scoreToRing: 0.205,        /* score font size / ring diameter, ~66px at 320 */
      scoreMin: 34,
      scoreMax: 76,
      heartToRing: 0.062,        /* HUD heart size / ring diameter, ~20px at 320 */
      heartMin: 12,
      heartMax: 22,
      verticalBias: 0.47,        /* ring centre within the space under the HUD */
      maxDpr: 2.5
    },

    /* Sector archetypes. spanDeg/points are kit defaults; only the existence of
     * yellow / blue / small green / occasional orange segments is observed. */
    sectors: [
      { id: 'yellow', color: '#FFDA00', spanDeg: 65, spanJitterDeg: 10, points: 1, heals: 0 },
      { id: 'blue',   color: '#2467F5', spanDeg: 48, spanJitterDeg: 8,  points: 2, heals: 0 },
      { id: 'green',  color: '#19D538', spanDeg: 14, spanJitterDeg: 3,  points: 5, heals: 0 },
      { id: 'orange', color: '#F56B08', spanDeg: 23, spanJitterDeg: 4,  points: 3, heals: 1 }
    ],

    rules: {
      initialLives: 3,
      maxLives: 3,
      emptyTapCosts: 1,          /* lives lost for pressing in a dark gap */
      missScorePenalty: 0,       /* no negative score unless configured */
      timeoutCosts: 1,
      timerSeconds: 6,
      timerMode: 'countdown',    /* 'countdown' | 'decorative' (see ASSUMPTIONS.md) */
      speedStartRadPerSec: 2.8,
      speedMaxRadPerSec: 5.2,
      speedPerPoint: 0.012,
      speedRampMs: 600,          /* easing window so speed never steps visibly */
      heartSpawnChancePerSuccess: 0.18,
      baseSectorCount: 3,        /* one yellow, one blue, one green kept alive */
      minGapDeg: 26,             /* minimum dark gap between two sectors */
      spawnLeadDeg: 70,          /* new sector must be this far before the marker */
      spawnClearDeg: 10,         /* new sector may not straddle the marker */
      spawnMs: 130,              /* fade/scale in; collision OFF until complete */
      despawnMs: 130,            /* fade/scale out; collision OFF immediately */
      inputCooldownMs: 110,      /* swallows duplicated pointer/key events only */
      reverseOnPress: true,      /* every press flips the direction of rotation */
      countdownSeconds: 3,
      innerRotateRadPerSec: 0.55,  /* slow drift of the inner arc gap */
      innerGapDeg: 42,             /* matches inner-ring-*.svg */
      seed: 0                    /* 0 = random seed per run; set for repeatable layouts */
    },

    effects: {
      success:  { flashMs: 240, maxAlpha: 0.80, pulseMs: 280, scoreScale: 1.15, scorePopMs: 180 },
      miss:     { flashMs: 300, maxAlpha: 0.95, shakeMs: 160, shakePx: 5 },
      heal:     { flashMs: 320, maxAlpha: 0.85, heartScale: 1.3, heartPopMs: 300, flightMs: 420 },
      floatingScore: { durationMs: 650, risePx: 26, gapPx: 40 },
      scoreCountUpMs: 140,
      timerPulseMs: 260,
      reducedMotion: { flashAlpha: 0.12, shakePx: 0, disableZoom: true },
      flashCooldownMs: 350,
      maxEvents: 24
    },

    audio: {
      masterGain: 0.5,
      maxVoices: 6,
      unlockOnFirstGesture: true,
      files: {
        'hit-yellow': 'assets/audio/hit-yellow.wav',
        'hit-blue': 'assets/audio/hit-blue.wav',
        'hit-green': 'assets/audio/hit-green.wav',
        'heal': 'assets/audio/heal.wav',
        'miss': 'assets/audio/miss.wav',
        'game-over': 'assets/audio/game-over.wav',
        'countdown': 'assets/audio/countdown.wav',
        'tap': 'assets/audio/tap.wav',
        'pause': 'assets/audio/pause.wav',
        'resume': 'assets/audio/resume.wav'
      }
    },

    storageKey: 'color-pulse.v1'
  };

  /* Deep-merge plain objects; arrays and scalars are replaced wholesale. */
  function merge(target, source) {
    if (!source || typeof source !== 'object') return target;
    Object.keys(source).forEach(function (key) {
      var value = source[key];
      if (value && typeof value === 'object' && !Array.isArray(value) &&
          target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        merge(target[key], value);
      } else if (value !== undefined) {
        target[key] = value;
      }
    });
    return target;
  }

  /* config/game-config.json uses the kit shape; map it onto CONFIG. */
  function applyKitJson(config, json) {
    if (!json) return config;
    merge(config.palette, json.palette);
    merge(config.geometry, json.geometry);
    merge(config.rules, json.rules);
    if (json.effects) {
      merge(config.effects.success, json.effects.success);
      merge(config.effects.miss, json.effects.miss);
      merge(config.effects.heal, json.effects.heal);
      merge(config.effects.floatingScore, json.effects.floatingScore);
      merge(config.effects.reducedMotion, json.effects.reducedMotion);
      if (typeof json.effects.flashCooldownMs === 'number') {
        config.effects.flashCooldownMs = json.effects.flashCooldownMs;
      }
    }
    if (json.audio && typeof json.audio.masterGain === 'number') {
      config.audio.masterGain = json.audio.masterGain;
    }
    if (Array.isArray(json.sectors)) {
      json.sectors.forEach(function (entry) {
        var target = config.sectors.filter(function (s) { return s.id === entry.id; })[0];
        if (!target) return;
        if (typeof entry.spanDeg === 'number') target.spanDeg = entry.spanDeg;
        if (typeof entry.points === 'number') target.points = entry.points;
        if (typeof entry.heals === 'number') target.heals = entry.heals;
      });
    }
    /* The kit JSON names colours only in palette; keep sector colours in sync. */
    config.sectors.forEach(function (s) {
      if (config.palette[s.id]) s.color = config.palette[s.id];
    });
    return config;
  }

  var api = { CONFIG: CONFIG, merge: merge, applyKitJson: applyKitJson };
  global.CP = global.CP || {};
  global.CP.CONFIG = CONFIG;
  global.CP.mergeConfig = merge;
  global.CP.applyKitJson = applyKitJson;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
