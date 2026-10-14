/**
 * load-scene.js — карусель шагов блока 5 «4 шага = 4 кадра» (data-interactive="load-scene").
 *
 * Разметка и тексты — в index.html (контракт — docs/interactives-contract.md). Лента — горизонтальный
 * скроллер со scroll-snap: свайп и прокрутка работают нативно, JS только прокручивает ленту по кнопкам
 * и синхронизирует состояние: data-current на корне, aria-current="step" у номера, aria-disabled у крайних стрелок.
 * Ни крошек, ни завершения блока здесь нет (блок 5 завершает step-order).
 */
(function (window, document) {
  'use strict';

  var Course = window.Course;

  function init(root) {
    var track = root.querySelector('[data-carousel-track]');
    if (!track) return;
    var slides = track.querySelectorAll('[data-slide]');
    var total = slides.length;
    var prev = root.querySelector('[data-carousel-prev]');
    var next = root.querySelector('[data-carousel-next]');
    var dots = root.querySelectorAll('[data-carousel-to]');
    var current = 0;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function setState(n) {
      if (n === current) return;
      current = n;
      root.setAttribute('data-current', String(n));
      for (var i = 0; i < dots.length; i += 1) {
        if (Number(dots[i].getAttribute('data-carousel-to')) === n) dots[i].setAttribute('aria-current', 'step');
        else dots[i].removeAttribute('aria-current');
      }
      if (prev) prev.setAttribute('aria-disabled', String(n <= 1));
      if (next) next.setAttribute('aria-disabled', String(n >= total));
    }

    // Позиция слайда внутри ленты (не зависит от offsetParent)
    function slideLeft(n) {
      return slides[n - 1].getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft;
    }

    function go(n) {
      n = Math.max(1, Math.min(total, n));
      track.scrollTo({ left: slideLeft(n), behavior: reduce ? 'auto' : 'smooth' });
      setState(n); // сразу, не дожидаясь конца прокрутки
    }

    // Свайп / прокрутка ленты → текущий слайд
    var frame = 0;
    track.addEventListener('scroll', function () {
      if (frame) return;
      frame = window.requestAnimationFrame(function () {
        frame = 0;
        var step = total > 1 ? slideLeft(2) - slideLeft(1) : 1;
        setState(Math.max(1, Math.min(total, Math.round(track.scrollLeft / step) + 1)));
      });
    }, { passive: true });

    if (prev) prev.addEventListener('click', function () { if (current > 1) go(current - 1); });
    if (next) next.addEventListener('click', function () { if (current < total) go(current + 1); });
    for (var i = 0; i < dots.length; i += 1) {
      dots[i].addEventListener('click', function (event) {
        go(Number(event.currentTarget.getAttribute('data-carousel-to')));
      });
    }

    // ← / → на любой кнопке карусели и на самой ленте
    root.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.target === track) return; // лента-скроллер прокручивается стрелками сама
      event.preventDefault();
      go(current + (event.key === 'ArrowRight' ? 1 : -1));
    });

    setState(Number(root.getAttribute('data-current')) || 1);
  }

  Course.interactives.register('load-scene', init);
})(window, document);
