/* Boot and orchestration: one animation loop, one simulation clock, one set
 * of event listeners for the lifetime of the page. */
(function (global) {
  'use strict';

  var CP = global.CP;
  var CONFIG = CP.CONFIG;

  var ui, game, renderer, fx, audio, input, images;
  var displayScore = 0;
  var lastFrame = 0;
  var gameOverAt = 0;
  var gameOverStats = null;
  var GAME_OVER_SETTLE_MS = 700;
  var booted = false;
  var suppressBlurUntil = 0;
  var fullscreenBlocked = false;

  var HIT_SOUND = { yellow: 'hit-yellow', blue: 'hit-blue', green: 'hit-green' };

  /* ---- config ----------------------------------------------------------- */

  /* Tuning can live in config/game-config.json when the game is served over
   * http(s). Opened from file:// the fetch fails and the built-in defaults
   * (identical values) are used instead. */
  function loadConfigOverrides() {
    if (typeof fetch !== 'function') return Promise.resolve();
    return fetch('config/game-config.json')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) { if (json) CP.applyKitJson(CONFIG, json); })
      .catch(function () { /* defaults already loaded */ });
  }

  /* ---- settings --------------------------------------------------------- */

  function applySettings() {
    var s = ui.settings;
    audio.setMuted(!s.sound);
    fx.reducedMotion = s.reducedMotion;
    fx.reducedFlash = s.reducedFlash || s.reducedMotion;
    CONFIG.rules.timerMode = s.decorativeTimer ? 'decorative' : 'countdown';
    ui.syncMuteButton();
  }

  /* ---- game events ------------------------------------------------------ */

  function onGameEvent(type, payload) {
    switch (type) {
      case 'hit':
        fx.onHit(payload);
        audio.play(HIT_SOUND[payload.sector] || 'hit-green');
        ui.announce('Plus ' + payload.points + '. Score ' + payload.score + '.');
        ui.practiceEvent(payload);
        break;

      case 'heal':
        fx.onHeal(payload);
        audio.play('heal');
        if (payload.healed) {
          var slotIndex = payload.lives - 1;
          var point = renderer.ringPoint(payload.angle);
          fx.heartFlight(point.x, point.y, slotIndex);
          fx.heartPop(slotIndex);
        }
        ui.announce('Plus ' + payload.points + (payload.healed ? ', heart restored.' : '.'));
        ui.practiceEvent(payload);
        break;

      case 'miss':
        fx.onMiss(payload);
        audio.play('miss');
        ui.announce(payload.cause === 'timeout' ? 'Out of time.' : 'Missed.');
        ui.practiceEvent(payload);
        break;

      case 'countdown-start':
        ui.showCountdown(CONFIG.rules.countdownSeconds);
        input.setEnabled(false);
        break;

      case 'countdown-tick':
        ui.showCountdown(payload.value);
        audio.play('countdown');
        break;

      case 'countdown-end':
        ui.hideCountdown();
        input.setEnabled(true);
        break;

      case 'gameover':
        gameOverStats = payload;
        gameOverAt = performance.now();
        input.setEnabled(false);
        audio.play('game-over');
        break;
    }
  }

  /* ---- run control ------------------------------------------------------ */

  function startRun(options) {
    options = options || {};
    /* Clear every transient: effects, tweens, latches, HUD chrome. */
    fx.clear();
    displayScore = 0;
    gameOverStats = null;
    gameOverAt = 0;
    ui.hideCountdown();
    ui.showScreen(null);
    ui.setGameplayChromeVisible(true);

    if (options.practice) ui.startPractice(); else ui.stopPractice();

    game.practice = !!options.practice;
    game.start(performance.now(), {
      practice: !!options.practice,
      seed: CONFIG.rules.seed || undefined
    });
  }

  function toMenu() {
    input.setEnabled(false);
    fx.clear();
    ui.stopPractice();
    ui.hideCountdown();
    ui.setGameplayChromeVisible(false);
    game.state = 'idle';
    audio.suspendGameplay();
    ui.showScreen('menu');
  }

  function pauseGame(reason) {
    if (!game.isLive()) return;
    if (!game.pause(performance.now(), reason)) return;
    input.setEnabled(false);
    ui.hideCountdown();
    audio.suspendGameplay();
    audio.play('pause');
    ui.showScreen('paused');
  }

  function resumeGame() {
    if (game.state !== 'paused') return;
    ui.showScreen(null);
    audio.play('resume');
    game.resume(performance.now());   /* re-enters the 3-2-1 countdown */
  }

  function togglePause() {
    if (game.state === 'paused') resumeGame();
    else if (game.isLive()) pauseGame('manual');
  }

  /* ---- loop ------------------------------------------------------------- */

  function frame(now) {
    global.requestAnimationFrame(frame);

    var realDelta = lastFrame ? Math.min(100, now - lastFrame) : 0;
    lastFrame = now;

    game.advanceTo(now);

    /* Effects run on the simulation: they stop dead while paused, and keep
     * settling for a moment after the final miss. */
    var fxDelta = game.state === 'paused' ? 0 : realDelta;
    fx.update(fxDelta);
    if (game.state === 'playing' && ui.practice) ui.updatePractice(realDelta);

    /* Score count-up. The authoritative score already changed; this only
     * chases it, and always converges, so no award can be lost. */
    var target = game.score;
    if (displayScore !== target) {
      var tau = Math.max(1, CONFIG.effects.scoreCountUpMs / 3);
      displayScore += (target - displayScore) * (1 - Math.exp(-fxDelta / tau));
      if (Math.abs(target - displayScore) < 0.5) displayScore = target;
    }

    var snapshot = game.snapshot();
    renderer.draw(snapshot, fx, displayScore);

    /* Reveal the game-over screen only once the last flash has settled. */
    if (gameOverStats && now - gameOverAt >= GAME_OVER_SETTLE_MS) {
      var stats = gameOverStats;
      gameOverStats = null;
      displayScore = stats.score;
      ui.setGameplayChromeVisible(false);
      ui.showGameOver(stats, ui.recordBest(stats.score));
    }
  }

  /* ---- sizing ----------------------------------------------------------- */

  function resize() {
    var app = ui.el.app;
    var rect = app.getBoundingClientRect();
    var styles = global.getComputedStyle(app);
    var w = rect.width - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
    var h = rect.height - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
    renderer.resize(Math.max(1, w), Math.max(1, h));
  }

  /* ---- wiring ----------------------------------------------------------- */

  function wireControls() {
    var el = ui.el;

    var click = function (node, handler, silent) {
      if (!node) return;
      node.addEventListener('click', function (event) {
        event.preventDefault();
        if (!silent) audio.play('tap');
        handler(event);
      });
    };

    click(el['btn-play'], function () { startRun({}); });
    click(el['btn-howto'], function () { ui.showScreen('howto'); });
    click(el['btn-howto-back'], function () { ui.showScreen('menu'); });
    click(el['btn-practice'], function () { startRun({ practice: true }); });
    click(el['btn-howto-practice'], function () { startRun({ practice: true }); });

    click(el['btn-pause'], function () { pauseGame('manual'); }, true);
    click(el['btn-resume'], resumeGame, true);
    click(el['btn-restart-paused'], function () { startRun({}); });
    click(el['btn-menu-paused'], toMenu);
    click(el['btn-restart'], function () { startRun({}); });
    click(el['btn-menu'], toMenu);

    click(el['practice-exit'], function () {
      if (ui.isPracticeFinished()) startRun({});
      else toMenu();
    });

    /* The TAP button is a labelled alias for striking the playfield. */
    el['tap-button'].addEventListener('pointerdown', function (event) {
      if (event.isPrimary === false) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      onStrike(CP.eventTime(event));
    });

    var toggleMute = function () {
      ui.settings.sound = !ui.settings.sound;
      ui.saveSettings();
      applySettings();
    };
    click(el['btn-fullscreen'], toggleFullscreen, true);
    click(el['btn-mute'], toggleMute, true);
    click(el['btn-mute-paused'], toggleMute, true);

    el['opt-sound'].addEventListener('change', function (e) {
      ui.settings.sound = e.target.checked;
      ui.saveSettings();
      applySettings();
    });
    el['opt-reduced-motion'].addEventListener('change', function (e) {
      ui.settings.reducedMotion = e.target.checked;
      ui.saveSettings();
      applySettings();
    });
    el['opt-reduced-flash'].addEventListener('change', function (e) {
      ui.settings.reducedFlash = e.target.checked;
      ui.saveSettings();
      applySettings();
    });
    el['opt-decorative-timer'].addEventListener('change', function (e) {
      ui.settings.decorativeTimer = e.target.checked;
      ui.saveSettings();
      applySettings();
    });
  }

  function onStrike(timeStamp) {
    if (game.state !== 'playing') return;
    /* Advance to the instant of the press, then judge against that angle, so
     * feedback starts on the same frame as the input. */
    var clamped = Math.max(game.lastNow, Math.min(timeStamp, performance.now()));
    game.advanceTo(clamped);
    game.press(clamped);
  }

  /* ---- full screen ------------------------------------------------------ */

  /* Mostly for phones: a browser's address bar eats a good part of a portrait
   * viewport, and the playfield is sized to what is actually visible. iOS
   * Safari on iPhone has no element full-screen API, so the button stays
   * hidden there rather than offering something that cannot work. */
  function fullscreenSupported() {
    if (fullscreenBlocked) return false;
    var el = document.documentElement;
    if (!(el.requestFullscreen || el.webkitRequestFullscreen)) return false;
    /* False inside an iframe without allowfullscreen, and on some embedded
     * webviews. Not every host reports it honestly, hence fullscreenBlocked
     * below as the second line of defence. */
    var enabled = document.fullscreenEnabled;
    if (enabled === undefined) enabled = document.webkitFullscreenEnabled;
    return enabled !== false;
  }

  function fullscreenActive() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  /* Shown on touch devices and narrow windows, where it actually helps. */
  function fullscreenRelevant() {
    if (!fullscreenSupported()) return false;
    var coarse = false;
    try { coarse = global.matchMedia('(pointer: coarse)').matches; } catch (e) {}
    return coarse || global.innerWidth < 900;
  }

  function syncFullscreen() {
    ui.syncFullscreenButton(fullscreenRelevant(), fullscreenActive());
    ui.setGameplayChromeVisible(game.isLive() || game.state === 'paused');
  }

  /* A host that refuses the request (an embedded webview, a restrictive
   * permissions policy) should not leave a dead button on screen. */
  function onFullscreenRefused() {
    fullscreenBlocked = true;
    syncFullscreen();
  }

  function toggleFullscreen() {
    /* Some browsers fire blur when the fullscreen element changes; do not let
     * that auto-pause a live run. */
    suppressBlurUntil = performance.now() + 700;
    try {
      if (fullscreenActive()) {
        var exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) exit.call(document);
        return;
      }
      var el = document.documentElement;
      var request = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!request) { onFullscreenRefused(); return; }
      var result = request.call(el);
      if (result && result.catch) result.catch(onFullscreenRefused);
    } catch (e) {
      onFullscreenRefused();
    }
  }

  function wireLifecycle() {
    /* A hidden tab or a lost focus pauses instead of quietly eating lives. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pauseGame('hidden');
    });
    global.addEventListener('blur', function () {
      if (performance.now() < suppressBlurUntil) return;
      pauseGame('blur');
    });

    ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (name) {
      document.addEventListener(name, function () {
        syncFullscreen();
        resize();
      });
    });
    global.addEventListener('pagehide', function () { pauseGame('hidden'); });

    var onResize = function () { resize(); syncFullscreen(); };
    global.addEventListener('resize', onResize);
    global.addEventListener('orientationchange', onResize);
    if (global.ResizeObserver) {
      new ResizeObserver(onResize).observe(ui.el.app);
    }
  }

  /* Prefer WebGL; fall back to Canvas 2D if a context cannot be created.
   * Both renderers share the layout module and read the same effects state, so
   * the two paths cannot drift apart visually. */
  function createRenderer(loadedImages) {
    /* ?renderer=2d forces the fallback, which makes it testable and gives a
     * way out if a device's WebGL driver misbehaves. */
    var forced = /[?&]renderer=2d\b/.test(global.location.search);
    try {
      if (forced) throw new Error('forced by ?renderer=2d');
      return new CP.RendererGL(ui.el.playfield, CONFIG, loadedImages);
    } catch (err) {
      console.warn('COLOR PULSE: WebGL unavailable, falling back to Canvas 2D.', err && err.message);
      /* A canvas is bound to the first context type it hands out, and the
       * attempt above may already have taken a WebGL one — in which case
       * getContext('2d') would return null. Swap in a clean element first.
       * Input listeners live on #app, not the canvas, so this is safe. */
      var stale = ui.el.playfield;
      var fresh = stale.cloneNode(false);
      stale.parentNode.replaceChild(fresh, stale);
      ui.el.playfield = fresh;
      return new CP.Renderer2D(fresh, CONFIG, loadedImages);
    }
  }

  /* ---- start ------------------------------------------------------------ */

  function boot() {
    if (booted) return;
    booted = true;

    ui = new CP.UI(CONFIG);
    fx = new CP.Effects(CONFIG);
    audio = new CP.AudioEngine(CONFIG);

    game = new CP.Game(CONFIG, { onEvent: onGameEvent });

    input = new CP.InputController(ui.el.app, {
      onStrike: onStrike,
      onPauseKey: togglePause,
      onGesture: function () {
        if (!audio.unlocked) audio.unlock();
      }
    });

    Promise.resolve()
      .then(loadConfigOverrides)
      .then(function () { return CP.assets.loadAll(); })
      .then(function (loaded) {
        images = loaded;
        if (loaded.__missing && loaded.__missing.length) {
          console.warn('COLOR PULSE: missing SVG assets', loaded.__missing);
        }
        renderer = createRenderer(images);
        return audio.prefetch();
      })
      .then(function () {
        ui.syncSettingInputs();
        applySettings();
        wireControls();
        wireLifecycle();
        resize();
        ui.setGameplayChromeVisible(false);
        syncFullscreen();
        ui.showScreen('menu');
        global.requestAnimationFrame(frame);
      })
      .catch(function (err) {
        console.error('COLOR PULSE failed to start', err);
        var loading = document.getElementById('screen-loading');
        if (loading) loading.querySelector('.loading-text').textContent = 'Failed to load.';
      });
  }

  /* Exposed for the browser test hooks in tests/. */
  global.COLOR_PULSE = {
    get game() { return game; },
    get ui() { return ui; },
    get fx() { return fx; },
    get audio() { return audio; },
    get renderer() { return renderer; },
    startRun: function (options) { startRun(options || {}); },
    pause: pauseGame,
    resume: resumeGame,
    strike: function () { onStrike(performance.now()); },
    /* Test hook: jump the count-up straight to a value. */
    setDisplayScore: function (value) { displayScore = value; },
    get backend() { return renderer && renderer.backend; },
    toggleFullscreen: toggleFullscreen,
    config: CONFIG
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
