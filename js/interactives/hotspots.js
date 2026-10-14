/**
 * hotspots.js — схема тостера с точками, блок 2 (data-interactive="hotspots").
 *
 * Разметка и тексты — в index.html (контракт — docs/interactives-contract.md). Открыта максимум одна подсказка:
 * точка (клик / Enter / Space) — открыть свою, повторно — закрыть; Esc, [data-tip-close] — закрыть с возвратом
 * фокуса на точку; клик вне подсказки и точек — закрыть. При открытии фокус переходит на подсказку
 * (tabindex="-1"), чтобы экранный диктор прочитал её текст. Изученная точка — is-done; все 6 —
 * [data-feedback="complete"], «Дальше», course:crumbs (2) + course:block-complete — один раз.
 * Снимок: { opened: [1, 3] } — номера изученных точек.
 */
(function (window, document) {
  'use strict';

  var Course = window.Course;
  var CRUMBS = 2;

  function init(root, saved) {
    var block = Number(root.getAttribute('data-block'));
    var points = Array.prototype.slice.call(root.querySelectorAll('[data-hotspot]'));
    if (!points.length) return;
    var restoreDom = Course.ui.captureInitial(root, [Course.ui.nextLink(root)]);
    var opened = [];
    var current = null; // номер открытой точки

    function point(n) {
      return root.querySelector('[data-hotspot="' + n + '"]');
    }
    function tip(n) {
      return root.querySelector('[data-tip="' + n + '"]');
    }

    function close(returnFocus) {
      if (current === null) return;
      var n = current;
      current = null;
      point(n).setAttribute('aria-expanded', 'false');
      var t = tip(n);
      if (t) t.hidden = true;
      if (returnFocus) point(n).focus();
    }

    function markDone(n) {
      point(n).classList.add('is-done');
      if (opened.indexOf(n) === -1) opened.push(n);
    }

    function complete(silent) {
      Course.ui.showFeedback(root, 'complete');
      Course.ui.enableNext(root);
      if (silent) {
        Course.ui.once(root, 'complete'); // восстановлено: начислено в прошлой сессии
        return;
      }
      if (Course.ui.once(root, 'complete')) {
        Course.emit('course:crumbs', { block: block, amount: CRUMBS, reason: 'hotspots' });
        Course.emit('course:block-complete', { block: block });
      }
    }

    function open(n) {
      close(false);
      current = n;
      point(n).setAttribute('aria-expanded', 'true');
      var t = tip(n);
      if (t) {
        // стрелка тултипа — над своей точкой: --x берём у точки (в разметке у части подсказок он устарел)
        var x = point(n).style.getPropertyValue('--x');
        if (x) t.style.setProperty('--x', x);
        t.hidden = false;
        t.setAttribute('tabindex', '-1');
        t.focus();
      }
      var isNew = opened.indexOf(n) === -1;
      markDone(n);
      if (isNew) {
        Course.ui.snapshot(root, { opened: opened.slice().sort(function (a, b) { return a - b; }) });
        if (opened.length === points.length) complete(false);
      }
    }

    points.forEach(function (p) {
      // button: Enter и Space дают click нативно
      p.addEventListener('click', function () {
        var n = Number(p.getAttribute('data-hotspot'));
        if (current === n) close(false);
        else open(n);
      });
    });

    root.addEventListener('click', function (event) {
      if (event.target.closest('[data-tip-close]')) close(true);
    });

    root.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || current === null) return;
      var t = tip(current);
      if (event.target === point(current) || (t && t.contains(event.target))) {
        event.preventDefault();
        close(true);
      }
    });

    // Клик вне подсказки и точек — закрыть (фокус не трогаем)
    document.addEventListener('click', function (event) {
      if (current === null) return;
      var t = tip(current);
      if (event.target.closest('[data-hotspot]') && root.contains(event.target)) return;
      if (t && t.contains(event.target)) return;
      close(false);
    });

    Course.on('course:restart', function () {
      current = null;
      opened = [];
      restoreDom();
    });

    // Восстановление вида без повторных начислений
    if (saved && Array.isArray(saved.opened)) {
      saved.opened.forEach(function (n) {
        if (point(n)) markDone(Number(n));
      });
      if (opened.length === points.length) complete(true);
    }
  }

  Course.interactives.register('hotspots', init);
})(window, document);
