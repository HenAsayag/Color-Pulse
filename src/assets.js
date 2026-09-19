/* SVG image preloading. The kit SVGs are the real artwork used by the game;
 * the project copies carry explicit width/height on the root element so that
 * drawImage() has an intrinsic size in every browser. */
(function (global) {
  'use strict';

  var SVGS = [
    'heart-full', 'heart-empty', 'heart-pickup',
    'icon-play', 'icon-pause', 'icon-restart', 'icon-close', 'icon-sound', 'icon-muted',
    'icon-fullscreen', 'icon-exit-fullscreen',
    'spark', 'particle'
  ];

  function loadImage(name) {
    return new Promise(function (resolve) {
      var img = new Image();
      var done = function (ok) { resolve({ name: name, img: ok ? img : null }); };
      img.onload = function () { done(true); };
      img.onerror = function () { done(false); };
      img.src = 'assets/svg/' + name + '.svg';
    });
  }

  function loadAll() {
    return Promise.all(SVGS.map(loadImage)).then(function (results) {
      var out = {};
      var missing = [];
      results.forEach(function (r) {
        if (r.img) out[r.name] = r.img; else missing.push(r.name);
      });
      out.__missing = missing;
      return out;
    });
  }

  global.CP = global.CP || {};
  global.CP.assets = { loadAll: loadAll, names: SVGS };
})(window);
