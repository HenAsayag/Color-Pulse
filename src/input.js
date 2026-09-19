/* Input handling. Registered exactly once at boot, so repeated restarts can
 * never multiply listeners.
 *
 * Pointer Events only — no parallel touchstart + click pair, which is the
 * usual source of one tap scoring twice on a touchscreen.
 */
(function (global) {
  'use strict';

  var ACTION_KEYS = { Space: 1, Enter: 1 };
  var PAUSE_KEYS = { Escape: 1, KeyP: 1 };

  /* A press is stamped with the time of the originating event when the
   * browser reports it on the same clock as performance.now(); otherwise we
   * fall back to now. Epoch-based timeStamps are rejected by the range test. */
  function eventTime(event) {
    var now = performance.now();
    var ts = event && event.timeStamp;
    if (typeof ts === 'number' && ts > 0 && ts <= now + 50) return ts;
    return now;
  }

  function InputController(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.enabled = false;
    this.bound = {};
    this.attach();
  }

  /* Should this event strike the ring, or was it meant for a control? */
  InputController.prototype.isPlayfieldEvent = function (event) {
    var target = event.target;
    if (!target || !target.closest) return true;
    if (target.closest('.no-strike')) return false;
    if (target.closest('.screen')) return false;
    return true;
  };

  InputController.prototype.attach = function () {
    var self = this;

    this.bound.pointerdown = function (event) {
      /* First gesture anywhere unlocks audio, including on menu buttons. */
      self.handlers.onGesture(event);

      if (!self.enabled) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;  /* right/middle click */
      if (event.isPrimary === false) return;                           /* extra fingers */
      if (!self.isPlayfieldEvent(event)) return;
      event.preventDefault();
      self.handlers.onStrike(eventTime(event));
    };

    this.bound.keydown = function (event) {
      if (event.repeat) return;                       /* key auto-repeat never autoplays */
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (PAUSE_KEYS[event.code]) {
        event.preventDefault();
        self.handlers.onPauseKey();
        return;
      }

      if (!ACTION_KEYS[event.code]) return;

      /* When a button or input has focus let the browser activate it instead;
       * that is what Space and Enter mean there. */
      var active = document.activeElement;
      if (active && (active.tagName === 'BUTTON' || active.tagName === 'INPUT' ||
                     active.tagName === 'A' || active.isContentEditable)) {
        self.handlers.onGesture(event);
        return;
      }

      self.handlers.onGesture(event);
      if (!self.enabled) return;
      /* Only swallow the page scroll once we are actually consuming the key. */
      event.preventDefault();
      self.handlers.onStrike(eventTime(event));
    };

    this.bound.contextmenu = function (event) {
      if (self.isPlayfieldEvent(event)) event.preventDefault();
    };

    this.root.addEventListener('pointerdown', this.bound.pointerdown);
    this.root.addEventListener('contextmenu', this.bound.contextmenu);
    global.addEventListener('keydown', this.bound.keydown);
  };

  /* Gameplay strikes are only accepted while the run is actually live. */
  InputController.prototype.setEnabled = function (enabled) {
    this.enabled = !!enabled;
  };

  global.CP = global.CP || {};
  global.CP.InputController = InputController;
  global.CP.eventTime = eventTime;
})(window);
