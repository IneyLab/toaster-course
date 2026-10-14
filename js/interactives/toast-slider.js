/**
 * toast-slider.js — симулятор степени поджаривания, блок 4 (data-interactive="toast-slider").
 *
 * Разметка и тексты — в index.html (контракт — docs/interactives-contract.md). Состояние — только
 * root.dataset.value (1–6): стрелку регулятора, цвет ломтика и заливку ползунка пересчитывает CSS.
 * JS: показывает подпись, чей диапазон data-min…data-max содержит значение, пишет aria-valuetext
 * (текст <b> подписи) и <title> ломтика (data-slice-title). Клавиатура (стрелки, Home/End) — нативная.
 * Крошек нет. course:block-complete — один раз: при первом изменении значения или клике по «Дальше» блока.
 * Снимок: { value: 4, done: true }.
 */
(function (window, document) {
  'use strict';

  var Course = window.Course;

  function init(root, saved) {
    var block = Number(root.getAttribute('data-block'));
    var input = root.querySelector('input[type="range"]');
    if (!input) return;
    var states = Array.prototype.slice.call(root.querySelectorAll('[data-range-state]'));
    // <title> ломтика — тот, чей текст совпадает с data-slice-title одной из подписей (у регулятора свой <title>)
    var sliceTitles = states.map(function (state) { return state.getAttribute('data-slice-title'); });
    var sliceTitle = Array.prototype.filter.call(root.querySelectorAll('svg title'), function (title) {
      return sliceTitles.indexOf(title.textContent) !== -1;
    })[0];
    var next = Course.ui.nextLink(root);
    var restoreDom = Course.ui.captureInitial(root, [next]);
    var done = false;

    function render(value) {
      root.setAttribute('data-value', String(value));
      states.forEach(function (state) {
        var active = value >= Number(state.getAttribute('data-min')) && value <= Number(state.getAttribute('data-max'));
        state.hidden = !active;
        if (!active) return;
        var label = state.querySelector('b');
        if (label) input.setAttribute('aria-valuetext', label.textContent);
        if (sliceTitle && state.hasAttribute('data-slice-title')) sliceTitle.textContent = state.getAttribute('data-slice-title');
      });
    }

    function snapshot() {
      Course.ui.snapshot(root, { value: Number(input.value), done: done });
    }

    function complete() {
      if (done) return;
      done = true;
      if (Course.ui.once(root, 'complete')) Course.emit('course:block-complete', { block: block });
    }

    input.addEventListener('input', function () {
      render(Number(input.value));
    });
    // change — значение отпущено: снимок и завершение блока (не на каждый шаг перетаскивания)
    input.addEventListener('change', function () {
      complete();
      snapshot();
    });
    if (next) {
      next.addEventListener('click', function () {
        if (done) return;
        complete();
        snapshot();
      });
    }

    Course.on('course:restart', function () {
      done = false;
      restoreDom();
      render(Number(input.value));
    });

    if (saved && saved.value >= Number(input.min) && saved.value <= Number(input.max)) {
      input.value = String(saved.value);
      if (saved.done) {
        done = true;
        Course.ui.once(root, 'complete');
      }
    }
    render(Number(input.value));
  }

  Course.interactives.register('toast-slider', init);
})(window, document);
