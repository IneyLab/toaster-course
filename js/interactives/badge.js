/**
 * badge.js — итог курса и бейдж, блок 9 (data-interactive="badge").
 *
 * Разметка и тексты — в index.html (контракт — docs/interactives-contract.md). Данные — только событие
 * course:finished { score, max } (диспатчит state.js) и Course.config.masterThreshold:
 *   score ≥ порога → [data-badge="master"] + конфетти; иначе → [data-badge="not-yet"].
 * Конфетти — свои DOM-частицы без текста (aria-hidden), цвета --toast-* и движение — CSS (c-confetti),
 * запускаются, когда карточка итога видна на экране, ≤ 2 с и удаляются; при reduced-motion — нет.
 * Счёт «N из 13» ([data-crumbs-value]) пишет main.js. Снимок: { score }; init(root, saved) — бейдж без конфетти.
 */
(function (window, document) {
  'use strict';

  var Course = window.Course;
  var BITS = 28;
  var CLEANUP = 2200; // мс: страховка, если animationend не пришёл (анимация в CSS ≤ 2 с)

  function init(root, saved) {
    var master = root.querySelector('[data-badge="master"]');
    var notYet = root.querySelector('[data-badge="not-yet"]');
    if (!master || !notYet) return;
    var restoreDom = Course.ui.captureInitial(root);
    var observer = null;
    var layer = null;

    function stopConfetti() {
      if (observer) observer.disconnect();
      observer = null;
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
      layer = null;
    }

    function burst() {
      stopConfetti();
      layer = document.createElement('div');
      layer.className = 'c-confetti';
      layer.setAttribute('aria-hidden', 'true');
      for (var i = 0; i < BITS; i += 1) {
        var bit = document.createElement('i');
        bit.className = 'c-confetti__bit';
        var angle = (i / BITS) * Math.PI * 2 + Math.random() * 0.4;
        bit.style.setProperty('--dx', (Math.cos(angle) * (0.5 + Math.random() * 0.5)).toFixed(3));
        bit.style.setProperty('--dy', (Math.sin(angle) * (0.4 + Math.random() * 0.4) - 0.3).toFixed(3));
        bit.style.setProperty('--spin', (Math.random() * 2 - 1).toFixed(3));
        bit.style.setProperty('--delay', Math.random().toFixed(3));
        layer.appendChild(bit);
      }
      root.appendChild(layer);
      var left = BITS;
      var own = layer;
      own.addEventListener('animationend', function () {
        left -= 1;
        if (left <= 0 && own === layer) stopConfetti();
      });
      window.setTimeout(function () {
        if (own === layer) stopConfetti();
      }, CLEANUP);
    }

    /** Конфетти — когда карточка итога на экране (state.js открывает блок 9, пока пользователь ещё на блоке 8). */
    function celebrate() {
      if (Course.ui.prefersReducedMotion()) return;
      if (!('IntersectionObserver' in window)) {
        burst();
        return;
      }
      stopConfetti();
      observer = new IntersectionObserver(function (entries) {
        if (!entries.some(function (e) { return e.isIntersecting; })) return;
        observer.disconnect();
        observer = null;
        burst();
      }, { threshold: 0.35 });
      observer.observe(root);
    }

    function show(score) {
      var isMaster = score >= Course.config.masterThreshold;
      master.hidden = !isMaster;
      notYet.hidden = isMaster;
      return isMaster;
    }

    Course.on('course:finished', function (detail) {
      var score = Number(detail.score) || 0;
      if (show(score)) celebrate();
      Course.ui.snapshot(root, { score: score });
    });

    Course.on('course:restart', function () {
      stopConfetti();
      restoreDom();
    });

    // Восстановление: бейдж по сохранённому счёту, без конфетти и событий
    if (saved && typeof saved.score === 'number') show(saved.score);
  }

  Course.interactives.register('badge', init);
})(window, document);
