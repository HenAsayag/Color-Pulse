/* Sound playback for the kit WAVs.
 *
 * These are the kit's own synthesized effects. Nothing from the reference
 * recording (including its music) is used.
 *
 * Primary path: Web Audio. The AudioContext is created only on the first real
 * user gesture, as required by every current browser autoplay policy. Files
 * are prefetched as raw bytes beforehand and decoded at unlock, so the first
 * hit does not have to wait on the network.
 *
 * Fallback path: when fetch cannot read the files - which is what happens if
 * index.html is opened directly from disk over file:// - the engine switches
 * to pooled HTMLAudioElements, which the same origin rules do allow.
 */
(function (global) {
  'use strict';

  var POOL_SIZE = 3;
  var ATTACK = 0.004;
  var RELEASE = 0.03;

  function AudioEngine(config) {
    this.config = config;
    this.files = config.audio.files;
    this.mode = 'buffer';        /* 'buffer' | 'element' | 'off' */
    this.unlocked = false;
    this.muted = false;
    this.volume = config.audio.masterGain;
    this.raw = {};               /* name -> ArrayBuffer, before decode */
    this.buffers = {};           /* name -> AudioBuffer */
    this.pools = {};             /* name -> [HTMLAudioElement] */
    this.voices = [];
    this.ctx = null;
    this.master = null;
    this.failed = [];
  }

  /* Pull the bytes down early. Never throws: a failure just selects the
   * element fallback. */
  AudioEngine.prototype.prefetch = function () {
    var self = this;
    if (typeof fetch !== 'function') {
      this.mode = 'element';
      return Promise.resolve(this.buildPools());
    }
    var names = Object.keys(this.files);
    return Promise.all(names.map(function (name) {
      return fetch(self.files[name])
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.arrayBuffer();
        })
        .then(function (buf) { self.raw[name] = buf; return true; })
        .catch(function () { return false; });
    })).then(function (results) {
      var ok = results.filter(Boolean).length;
      if (ok === 0) {
        /* file:// or blocked: use audio elements instead. */
        self.mode = 'element';
        self.buildPools();
      } else if (ok < results.length) {
        self.failed = names.filter(function (n) { return !self.raw[n]; });
      }
      return self.mode;
    });
  };

  AudioEngine.prototype.buildPools = function () {
    var self = this;
    Object.keys(this.files).forEach(function (name) {
      var pool = [];
      for (var i = 0; i < POOL_SIZE; i++) {
        var el = new Audio();
        el.preload = 'auto';
        el.src = self.files[name];
        el.volume = self.volume;
        pool.push(el);
      }
      self.pools[name] = { items: pool, next: 0 };
    });
    return this.mode;
  };

  /* Must be called from inside a real user gesture. */
  AudioEngine.prototype.unlock = function () {
    if (this.unlocked) return Promise.resolve(true);
    this.unlocked = true;
    var self = this;

    if (this.mode === 'element') {
      /* Touch one element inside the gesture to satisfy autoplay policy. */
      var any = this.pools[Object.keys(this.pools)[0]];
      if (any) {
        var el = any.items[0];
        var prior = el.volume;
        el.volume = 0;
        var p = el.play();
        if (p && p.catch) p.catch(function () {});
        try { el.pause(); el.currentTime = 0; } catch (e) {}
        el.volume = prior;
      }
      return Promise.resolve(true);
    }

    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) { this.mode = 'element'; this.buildPools(); return Promise.resolve(true); }

    try {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    } catch (e) {
      this.mode = 'element';
      this.buildPools();
      return Promise.resolve(true);
    }

    if (this.ctx.state === 'suspended') this.ctx.resume().catch(function () {});

    var names = Object.keys(this.raw);
    return Promise.all(names.map(function (name) {
      return new Promise(function (resolve) {
        var done = false;
        var ok = function (buf) { if (!done) { done = true; self.buffers[name] = buf; resolve(true); } };
        var bad = function () { if (!done) { done = true; resolve(false); } };
        try {
          /* Both the promise and the callback forms, for older Safari. */
          var maybe = self.ctx.decodeAudioData(self.raw[name].slice(0), ok, bad);
          if (maybe && maybe.then) maybe.then(ok, bad);
        } catch (e) { bad(); }
      });
    })).then(function () { self.raw = {}; return true; });
  };

  AudioEngine.prototype.setMuted = function (muted) {
    this.muted = !!muted;
    if (this.master && this.ctx) {
      var now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, now, 0.015);
    }
    if (this.muted) this.stopAll();
  };

  AudioEngine.prototype.setVolume = function (volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master && !this.muted) this.master.gain.value = this.volume;
    var self = this;
    Object.keys(this.pools).forEach(function (name) {
      self.pools[name].items.forEach(function (el) { el.volume = self.volume; });
    });
  };

  AudioEngine.prototype.stopAll = function () {
    this.voices.forEach(function (v) {
      try { v.source.stop(); } catch (e) {}
    });
    this.voices = [];
    var self = this;
    Object.keys(this.pools).forEach(function (name) {
      self.pools[name].items.forEach(function (el) {
        try { el.pause(); el.currentTime = 0; } catch (e) {}
      });
    });
  };

  AudioEngine.prototype.play = function (name) {
    if (this.muted || this.mode === 'off' || !this.unlocked) return false;

    if (this.mode === 'buffer') {
      var buffer = this.buffers[name];
      if (!buffer || !this.ctx) return false;

      /* Cap simultaneous voices; drop the oldest rather than clipping. */
      this.voices = this.voices.filter(function (v) { return v.endsAt > performance.now(); });
      var cap = this.config.audio.maxVoices;
      while (this.voices.length >= cap) {
        var oldest = this.voices.shift();
        try { oldest.source.stop(); } catch (e) {}
      }

      var now = this.ctx.currentTime;
      var source = this.ctx.createBufferSource();
      var gain = this.ctx.createGain();
      source.buffer = buffer;
      /* Short attack/release ramps keep rapid retriggers from clicking. */
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + ATTACK);
      gain.gain.setValueAtTime(1, now + Math.max(ATTACK, buffer.duration - RELEASE));
      gain.gain.linearRampToValueAtTime(0, now + buffer.duration);
      source.connect(gain);
      gain.connect(this.master);
      source.start(now);
      this.voices.push({ source: source, endsAt: performance.now() + buffer.duration * 1000 });
      return true;
    }

    var pool = this.pools[name];
    if (!pool) return false;
    var el = pool.items[pool.next];
    pool.next = (pool.next + 1) % pool.items.length;
    try {
      el.currentTime = 0;
      el.volume = this.volume;
      var promise = el.play();
      if (promise && promise.catch) promise.catch(function () {});
    } catch (e) { return false; }
    return true;
  };

  /* Quieten gameplay audio without changing the player's mute preference. */
  AudioEngine.prototype.suspendGameplay = function () { this.stopAll(); };

  global.CP = global.CP || {};
  global.CP.AudioEngine = AudioEngine;
})(window);
