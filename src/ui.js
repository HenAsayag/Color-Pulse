/* Screens, settings, persistence and the practice coach.
 * Everything here is DOM: the canvas layer knows nothing about it. */
(function (global) {
  'use strict';

  var FADE_MS = 200;

  /* localStorage with a safe in-memory fallback (private mode, blocked
   * storage, file:// quirks). */
  function Storage(key) {
    this.key = key;
    this.memory = {};
    this.available = false;
    try {
      var probe = '__cp__';
      global.localStorage.setItem(probe, '1');
      global.localStorage.removeItem(probe);
      this.available = true;
    } catch (e) {
      this.available = false;
    }
  }

  Storage.prototype.read = function () {
    if (!this.available) return Object.assign({}, this.memory);
    try {
      return JSON.parse(global.localStorage.getItem(this.key) || '{}') || {};
    } catch (e) {
      return {};
    }
  };

  Storage.prototype.write = function (data) {
    this.memory = Object.assign({}, this.memory, data);
    if (!this.available) return false;
    try {
      global.localStorage.setItem(this.key, JSON.stringify(this.memory));
      return true;
    } catch (e) {
      return false;
    }
  };

  function UI(config) {
    this.config = config;
    this.storage = new Storage(config.storageKey);
    this.el = {};
    this.currentScreen = null;   /* set to the loading screen below, so the
                                  * first showScreen() fades it back out */
    this.hideTimer = null;
    this.liveTimer = null;
    this.practice = null;

    var ids = [
      'app', 'playfield', 'hud-controls', 'btn-pause', 'btn-mute', 'mute-icon',
      'btn-fullscreen', 'fullscreen-icon',
      'tap-button', 'countdown-overlay', 'countdown-value',
      'practice-banner', 'practice-text', 'practice-exit',
      'screen-loading', 'screen-menu', 'screen-howto', 'screen-paused', 'screen-gameover',
      'menu-best', 'btn-play', 'btn-howto', 'btn-practice',
      'opt-sound', 'opt-reduced-motion', 'opt-reduced-flash', 'opt-decorative-timer',
      'btn-howto-back', 'btn-howto-practice', 'howto-timer',
      'btn-resume', 'btn-restart-paused', 'btn-mute-paused', 'btn-menu-paused',
      'final-score', 'gameover-best', 'new-best', 'btn-restart', 'btn-menu',
      'stat-hits', 'stat-misses', 'stat-timeouts', 'stat-hearts',
      'live-region'
    ];
    var self = this;
    ids.forEach(function (id) {
      self.el[id] = document.getElementById(id);
    });

    this.currentScreen = this.el['screen-loading'];
    this.settings = this.loadSettings();
  }

  /* ---- settings --------------------------------------------------------- */

  UI.prototype.loadSettings = function () {
    var saved = this.storage.read();
    var prefersReduced = false;
    try {
      prefersReduced = global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {}

    return {
      sound: saved.sound !== undefined ? !!saved.sound : true,
      /* Honour the OS preference unless the player has chosen for themselves. */
      reducedMotion: saved.reducedMotion !== undefined ? !!saved.reducedMotion : prefersReduced,
      reducedFlash: saved.reducedFlash !== undefined ? !!saved.reducedFlash : prefersReduced,
      decorativeTimer: !!saved.decorativeTimer,
      best: Number(saved.best) || 0
    };
  };

  UI.prototype.saveSettings = function () {
    this.storage.write({
      sound: this.settings.sound,
      reducedMotion: this.settings.reducedMotion,
      reducedFlash: this.settings.reducedFlash,
      decorativeTimer: this.settings.decorativeTimer,
      best: this.settings.best
    });
  };

  UI.prototype.syncSettingInputs = function () {
    this.el['opt-sound'].checked = this.settings.sound;
    this.el['opt-reduced-motion'].checked = this.settings.reducedMotion;
    this.el['opt-reduced-flash'].checked = this.settings.reducedFlash;
    this.el['opt-decorative-timer'].checked = this.settings.decorativeTimer;
    this.el['howto-timer'].textContent = String(this.config.rules.timerSeconds);
    this.updateBest();
  };

  UI.prototype.updateBest = function () {
    this.el['menu-best'].textContent = String(this.settings.best);
    this.el['gameover-best'].textContent = String(this.settings.best);
  };

  UI.prototype.recordBest = function (score) {
    if (score > this.settings.best) {
      this.settings.best = score;
      this.saveSettings();
      this.updateBest();
      return true;
    }
    return false;
  };

  /* ---- screens ---------------------------------------------------------- */

  UI.prototype.showScreen = function (name) {
    var target = name ? this.el['screen-' + name] : null;
    if (this.currentScreen === target) return;

    /* Cancel any pending hide so rapid transitions cannot strand a screen. */
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }

    var previous = this.currentScreen;
    if (previous) {
      previous.classList.remove('is-visible');
      this.hideTimer = setTimeout(function () { previous.hidden = true; }, FADE_MS);
    }

    if (target) {
      target.hidden = false;
      /* Force layout so the opacity transition actually runs. */
      void target.offsetWidth;
      target.classList.add('is-visible');
      var focusable = target.querySelector('button, input');
      if (focusable && previous) {
        try { focusable.focus({ preventScroll: true }); } catch (e) { focusable.focus(); }
      }
    }
    this.currentScreen = target;
  };

  /* Pause, mute and TAP belong to a live run. The full-screen button does not:
   * it stays reachable from the menus too, so a phone can be set up before
   * play starts. */
  UI.prototype.setGameplayChromeVisible = function (visible) {
    this.el['btn-pause'].hidden = !visible;
    this.el['btn-mute'].hidden = !visible;
    this.el['tap-button'].hidden = !visible;
    var fullscreenShown = !this.el['btn-fullscreen'].hidden;
    this.el['hud-controls'].style.display = (visible || fullscreenShown) ? 'flex' : 'none';
  };

  UI.prototype.syncFullscreenButton = function (supported, active) {
    var button = this.el['btn-fullscreen'];
    button.hidden = !supported;
    this.el['fullscreen-icon'].src = active
      ? 'assets/svg/icon-exit-fullscreen.svg'
      : 'assets/svg/icon-fullscreen.svg';
    button.setAttribute('aria-label', active ? 'Exit full screen' : 'Enter full screen');
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  };

  /* ---- countdown -------------------------------------------------------- */

  UI.prototype.showCountdown = function (value) {
    this.el['countdown-value'].textContent = value > 0 ? String(value) : '';
    this.el['countdown-overlay'].classList.toggle('is-visible', value > 0);
  };

  UI.prototype.hideCountdown = function () {
    this.el['countdown-overlay'].classList.remove('is-visible');
    this.el['countdown-value'].textContent = '';
  };

  /* ---- mute button ------------------------------------------------------ */

  UI.prototype.syncMuteButton = function () {
    var on = this.settings.sound;
    this.el['mute-icon'].src = on ? 'assets/svg/icon-sound.svg' : 'assets/svg/icon-muted.svg';
    this.el['btn-mute'].setAttribute('aria-label', on ? 'Mute sound' : 'Unmute sound');
    this.el['btn-mute'].setAttribute('aria-pressed', on ? 'false' : 'true');
    this.el['btn-mute-paused'].textContent = 'Sound: ' + (on ? 'on' : 'off');
    this.el['opt-sound'].checked = on;
  };

  /* ---- game over -------------------------------------------------------- */

  UI.prototype.showGameOver = function (stats, isNewBest) {
    this.el['final-score'].textContent = String(stats.score);
    this.el['stat-hits'].textContent = String(stats.hits);
    this.el['stat-misses'].textContent = String(stats.misses);
    this.el['stat-timeouts'].textContent = String(stats.timeouts);
    this.el['stat-hearts'].textContent = String(stats.hearts);
    this.el['new-best'].hidden = !isNewBest;
    this.updateBest();
    this.showScreen('gameover');
    this.announce('Run over. Score ' + stats.score + '.' + (isNewBest ? ' New best.' : ''));
  };

  /* ---- accessibility ---------------------------------------------------- */

  /* Throttled so a fast run does not flood a screen reader. */
  UI.prototype.announce = function (text) {
    var el = this.el['live-region'];
    if (!el) return;
    if (this.liveTimer) clearTimeout(this.liveTimer);
    var self = this;
    this.liveTimer = setTimeout(function () {
      el.textContent = text;
      self.liveTimer = null;
    }, 220);
  };

  /* ---- practice coach --------------------------------------------------- */

  var PRACTICE_STEPS = [
    {
      text: 'The white marker at the top never moves. The ring turns underneath it.',
      advanceAfterMs: 4200
    },
    {
      text: 'Press when a colour sits under the marker. Try yellow (+1) or blue (+2).',
      completeOn: function (e) { return e.type === 'hit' && (e.sector === 'yellow' || e.sector === 'blue'); },
      advanceAfterMs: 22000
    },
    {
      text: 'Notice the ring turned the other way. Every press reverses it.',
      completeOn: function (e) { return e.type === 'hit' || e.type === 'heal' || e.type === 'miss'; },
      advanceAfterMs: 9000
    },
    {
      text: 'The small green sector is worth +5. It is narrow, so time it carefully.',
      completeOn: function (e) { return e.type === 'hit' && e.sector === 'green'; },
      advanceAfterMs: 26000
    },
    {
      text: 'An orange heart sometimes appears: +3 points and one heart back.',
      completeOn: function (e) { return e.type === 'heal'; },
      advanceAfterMs: 26000
    },
    {
      text: 'Striking a dark gap costs a heart — and so does the inner ring emptying. Hearts are safe in practice.',
      completeOn: function (e) { return e.type === 'miss'; },
      advanceAfterMs: 20000
    },
    {
      text: 'That is everything. Ready for a real run?',
      final: true
    }
  ];

  UI.prototype.startPractice = function () {
    this.practice = { index: -1, elapsed: 0 };
    this.el['practice-banner'].hidden = false;
    this.el['practice-exit'].textContent = 'End practice';
    this.nextPracticeStep();
  };

  UI.prototype.stopPractice = function () {
    this.practice = null;
    this.el['practice-banner'].hidden = true;
  };

  UI.prototype.nextPracticeStep = function () {
    if (!this.practice) return;
    this.practice.index++;
    this.practice.elapsed = 0;
    var step = PRACTICE_STEPS[this.practice.index];
    if (!step) { this.stopPractice(); return; }
    this.el['practice-text'].textContent = step.text;
    if (step.final) this.el['practice-exit'].textContent = 'Start a real run';
    this.announce(step.text);
  };

  /* Called every frame with the simulation delta while practising. */
  UI.prototype.updatePractice = function (dt) {
    if (!this.practice) return;
    var step = PRACTICE_STEPS[this.practice.index];
    if (!step || step.final) return;
    this.practice.elapsed += dt;
    if (step.advanceAfterMs && this.practice.elapsed >= step.advanceAfterMs) {
      this.nextPracticeStep();
    }
  };

  UI.prototype.practiceEvent = function (event) {
    if (!this.practice) return;
    var step = PRACTICE_STEPS[this.practice.index];
    if (!step || step.final || !step.completeOn) return;
    if (step.completeOn(event)) this.nextPracticeStep();
  };

  UI.prototype.isPracticeFinished = function () {
    if (!this.practice) return false;
    var step = PRACTICE_STEPS[this.practice.index];
    return !!(step && step.final);
  };

  global.CP = global.CP || {};
  global.CP.UI = UI;
  global.CP.Storage = Storage;
})(window);
