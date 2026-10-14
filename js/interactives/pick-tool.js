/**
 * pick-tool.js — «Чем достать тост?», блок 6 (data-interactive="pick-tool").
 *
 * Разметка и тексты — в index.html (контракт — docs/interactives-contract.md). Множественный выбор, попытка одна:
 * тап / Enter / Space по варианту [data-option] переключает aria-pressed; «Проверить» активна, когда отмечен
 * хотя бы один. После проверки на всех четырёх карточках — ключ (data-correct="true" → is-correct, остальные →
 * is-incorrect), отметка пользователя остаётся (aria-pressed); [data-choices] — is-answered; варианты и «Проверить» —
 * aria-disabled. Выбраны ровно безопасные → correct, +2, course:crumbs (2); иначе — wrong. После любой проверки —
 * «Дальше» и course:block-complete. Фокус не переносится (остаётся на «Проверить»), сообщение читает живой регион.
 * Снимок: { picked: ['tongs', 'fingers'], checked: true } — отмеченные варианты в порядке разметки.
 */
(function (window, document) {
  'use strict';

  var Course = window.Course;
  var CRUMBS = 2;

  function init(root, saved) {
    var block = Number(root.getAttribute('data-block'));
    var choices = root.querySelector('[data-choices]');
    var options = Array.prototype.slice.call(root.querySelectorAll('[data-option]'));
    var check = root.querySelector('[data-check]');
    if (!options.length) return;
    var restoreDom = Course.ui.captureInitial(root, [Course.ui.nextLink(root)]);
    var checked = false;

    function isPicked(option) {
      return option.getAttribute('aria-pressed') === 'true';
    }
    function picked() {
      return options.filter(isPicked).map(function (o) { return o.getAttribute('data-option'); });
    }
    /** Выбор совпал с эталоном: отмечены ровно варианты с data-correct="true". */
    function exact() {
      return options.every(function (o) {
        return isPicked(o) === (o.getAttribute('data-correct') === 'true');
      });
    }

    function setCheck() {
      if (!check) return;
      if (!checked && picked().length) check.removeAttribute('aria-disabled');
      else check.setAttribute('aria-disabled', 'true');
    }

    function snapshot() {
      Course.ui.snapshot(root, { picked: picked(), checked: checked });
    }

    /** Показать ключ и результат; silent — восстановление без событий. */
    function showResult(silent) {
      checked = true;
      options.forEach(function (o) {
        var right = o.getAttribute('data-correct') === 'true';
        o.classList.toggle('is-correct', right);
        o.classList.toggle('is-incorrect', !right);
        o.setAttribute('aria-disabled', 'true');
      });
      if (choices) choices.classList.add('is-answered');
      var ok = exact();
      Course.ui.showFeedback(root, ok ? 'correct' : 'wrong');
      Course.ui.setReward(root, ok ? CRUMBS : null);
      setCheck();
      Course.ui.enableNext(root);
      if (silent) {
        Course.ui.once(root, 'crumbs');
        Course.ui.once(root, 'complete');
        return;
      }
      if (ok && Course.ui.once(root, 'crumbs')) {
        Course.emit('course:crumbs', { block: block, amount: CRUMBS, reason: 'correct' });
      }
      if (Course.ui.once(root, 'complete')) Course.emit('course:block-complete', { block: block });
    }

    options.forEach(function (o) {
      // button: Enter и Space дают click нативно
      o.addEventListener('click', function () {
        if (checked) return;
        o.setAttribute('aria-pressed', String(!isPicked(o)));
        setCheck();
        snapshot();
      });
    });

    if (check) {
      check.addEventListener('click', function () {
        if (checked || check.getAttribute('aria-disabled') === 'true') return;
        showResult(false);
        snapshot();
      });
    }

    Course.on('course:restart', function () {
      checked = false;
      restoreDom();
    });

    // Восстановление вида без повторных начислений
    if (saved && Array.isArray(saved.picked)) {
      options.forEach(function (o) {
        o.setAttribute('aria-pressed', String(saved.picked.indexOf(o.getAttribute('data-option')) !== -1));
      });
      if (saved.checked) showResult(true);
    }
    setCheck();
  }

  Course.interactives.register('pick-tool', init);
})(window, document);
