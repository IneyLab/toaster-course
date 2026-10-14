/**
 * flip-cards.js — переворотные карточки «Без паники!», блок 7 (data-interactive="flip-cards").
 *
 * Разметка и тексты — в index.html (контракт — docs/interactives-contract.md). Клик / Enter / Space по кнопке
 * карточки (button.c-flip__btn — прозрачный слой поверх неё) переключает is-flipped на li[data-flip] и aria-expanded
 * на кнопке; повторно — обратно. 3D-переворот и видимость сторон — CSS (оборот до is-flipped — visibility: hidden,
 * диктор его не читает; при reduced-motion длительности обнулены — стороны меняются мгновенно). Фокус остаётся
 * на кнопке. Перевёрнутая хотя бы раз — is-done (галочка), [data-flip-count] — число таких; все 4 → complete, +3,
 * «Дальше», course:crumbs (3) + course:block-complete — один раз.
 * Снимок: { flipped: [1, 3], open: [3] } — перевёрнутые хотя бы раз / открытые сейчас (номера по возрастанию).
 */
(function (window, document) {
  'use strict';

  var Course = window.Course;
  var CRUMBS = 3;

  function init(root, saved) {
    var block = Number(root.getAttribute('data-block'));
    var cards = Array.prototype.slice.call(root.querySelectorAll('[data-flip]'));
    var count = root.querySelector('[data-flip-count]');
    if (!cards.length) return;
    var restoreDom = Course.ui.captureInitial(root, [Course.ui.nextLink(root)]);
    var flipped = [];

    function numOf(card) {
      return Number(card.getAttribute('data-flip'));
    }
    function card(n) {
      return root.querySelector('[data-flip="' + n + '"]');
    }
    function sorted(list) {
      return list.slice().sort(function (a, b) { return a - b; });
    }

    function setOpen(li, open) {
      li.classList.toggle('is-flipped', open);
      var btn = li.querySelector('button');
      if (btn) btn.setAttribute('aria-expanded', String(open));
    }

    function markDone(n) {
      card(n).classList.add('is-done');
      if (flipped.indexOf(n) === -1) flipped.push(n);
      if (count) count.textContent = String(flipped.length);
    }

    function snapshot() {
      Course.ui.snapshot(root, {
        flipped: sorted(flipped),
        open: cards.filter(function (li) { return li.classList.contains('is-flipped'); }).map(numOf),
      });
    }

    function complete(silent) {
      Course.ui.showFeedback(root, 'complete');
      Course.ui.enableNext(root);
      if (silent) {
        Course.ui.once(root, 'complete'); // восстановлено: начислено в прошлой сессии
        return;
      }
      if (Course.ui.once(root, 'complete')) {
        Course.emit('course:crumbs', { block: block, amount: CRUMBS, reason: 'all-flipped' });
        Course.emit('course:block-complete', { block: block });
      }
    }

    root.addEventListener('click', function (event) {
      var btn = event.target.closest('button');
      var li = btn && btn.closest('[data-flip]');
      if (!li || !root.contains(li)) return;
      var open = !li.classList.contains('is-flipped');
      setOpen(li, open);
      var n = numOf(li);
      var isNew = open && flipped.indexOf(n) === -1;
      if (isNew) markDone(n);
      snapshot();
      if (isNew && flipped.length === cards.length) complete(false);
    });

    Course.on('course:restart', function () {
      flipped = [];
      restoreDom();
    });

    // Восстановление вида без повторных начислений
    if (saved && Array.isArray(saved.flipped)) {
      saved.flipped.forEach(function (n) {
        if (card(n)) markDone(Number(n));
      });
      (saved.open || []).forEach(function (n) {
        if (card(n)) setOpen(card(n), true);
      });
      if (flipped.length === cards.length) complete(true);
    }
  }

  Course.interactives.register('flip-cards', init);
})(window, document);
