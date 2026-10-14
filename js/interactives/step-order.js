/**
 * step-order.js — «Расставь шаги по порядку», блок 5 (data-interactive="step-order").
 *
 * Разметка и тексты — в index.html (контракт — docs/interactives-contract.md).
 * Единственный источник правды о порядке — порядок li[data-order] в [data-order-list]
 * (data-order — правильное место карточки). Два способа:
 *   а) тап / Enter / Space (основной): карточкам по очереди присваиваются номера 1…6 (aria-pressed,
 *      цифра в [data-order-num]); повторный тап снимает номер у карточки и у всех следующих;
 *      когда пронумерованы все 6 — список переставляется по номерам (FLIP, при reduced-motion — сразу);
 *   б) перетаскивание на Pointer Events: мышью — за всю карточку, пальцем/пером — за ручку [data-drag-handle]
 *      (остальная карточка прокручивает страницу). Порог 6px, захват указателя, плейсхолдер на месте карточки,
 *      автопрокрутка у краёв окна, Esc — отмена. После отпускания номера всех карточек = их позиции.
 * «Проверить» активна, когда пронумерованы все 6 (и после ошибки — когда порядок изменён).
 * 1-я попытка верно → correct, +4; ошибка → is-correct/is-wrong на карточках, retry; подсветка снимается
 * при первом изменении; 2-я верно → correct, тоже +4 (решение 14.10.2026: верный ответ — полная награда);
 * ошибка → solution, крошек нет. После верного или solution —
 * карточки заблокированы, «Дальше», course:block-complete.
 * Снимок: { order: [3,5,…], picked: [3,5], attempts: 1, marked: true, result: 'retry', done: false }
 * (значения data-order: порядок в DOM и порядок нумерации).
 */
(function (window, document) {
  'use strict';

  var Course = window.Course;
  var DRAG_THRESHOLD = 6; // px до старта перетаскивания
  var SCROLL_EDGE = 72; // px от края окна, где включается автопрокрутка
  var SCROLL_MAX = 14; // px за кадр
  var REWARD = 4; // верный порядок с 1-й или 2-й попытки = Course.config.rewards[5]

  function init(root, saved) {
    var block = Number(root.getAttribute('data-block'));
    var list = root.querySelector('[data-order-list]');
    var check = root.querySelector('[data-check]');
    if (!list) return;
    var restoreDom = Course.ui.captureInitial(root, [Course.ui.nextLink(root)]);

    var picked = []; // li в порядке нумерации
    var attempts = 0;
    var marked = false; // показаны is-correct / is-wrong
    var result = null; // 'correct' | 'retry' | 'solution'
    var locked = false;
    var pending = null; // нажатие, ещё не ставшее перетаскиванием
    var drag = null;
    var justDragged = false;

    function items() {
      return Array.prototype.filter.call(list.children, function (el) {
        return el.hasAttribute('data-order');
      });
    }
    function total() {
      return items().length;
    }
    function orderOf(li) {
      return Number(li.getAttribute('data-order'));
    }
    function cardOf(li) {
      return li.querySelector('button');
    }

    // ---------- вид ----------

    function renderNums() {
      items().forEach(function (li) {
        var k = picked.indexOf(li);
        cardOf(li).setAttribute('aria-pressed', String(k !== -1));
        var num = li.querySelector('[data-order-num]');
        if (num) num.textContent = k === -1 ? '' : String(k + 1);
      });
    }

    function setCheck() {
      if (!check) return;
      var ready = !locked && !marked && picked.length === total();
      if (ready) check.removeAttribute('aria-disabled');
      else check.setAttribute('aria-disabled', 'true');
    }

    function mark() {
      var ok = true;
      items().forEach(function (li, i) {
        var right = orderOf(li) === i + 1;
        li.classList.toggle('is-correct', right);
        li.classList.toggle('is-wrong', !right);
        if (!right) ok = false;
      });
      marked = true;
      return ok;
    }

    function clearMarks() {
      items().forEach(function (li) {
        li.classList.remove('is-correct', 'is-wrong');
      });
      marked = false;
    }

    /** FLIP: tops — позиции до перестановки (по li); анимирует li из старого места в новое. */
    function flip(lis, tops) {
      if (Course.ui.prefersReducedMotion()) return;
      var moved = [];
      lis.forEach(function (li, i) {
        var dy = tops[i] - li.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) return;
        li.style.transition = 'none';
        li.style.transform = 'translateY(' + dy + 'px)';
        moved.push(li);
      });
      if (!moved.length) return;
      list.getBoundingClientRect(); // reflow: начальное смещение применено, дальше — анимация к нулю
      moved.forEach(function (li) {
        li.style.transition = 'transform var(--duration-slow) var(--ease-standard)';
        li.style.transform = '';
        li.addEventListener('transitionend', function done(event) {
          if (event.target !== li) return; // всплытие от переходов карточки внутри
          li.removeEventListener('transitionend', done);
          if (!li.classList.contains('is-dragging')) li.removeAttribute('style');
        });
      });
    }

    /** Переставить li в заданном порядке, сохранив фокус. */
    function reorder(order) {
      var lis = items();
      var tops = lis.map(function (li) { return li.getBoundingClientRect().top; });
      var focused = document.activeElement;
      order.forEach(function (li) { list.appendChild(li); });
      if (focused && list.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
      flip(lis, tops);
    }

    function snapshot() {
      Course.ui.snapshot(root, {
        order: items().map(orderOf),
        picked: picked.map(orderOf),
        attempts: attempts,
        marked: marked,
        result: result,
        done: locked,
      });
    }

    /** Любое изменение порядка или нумерации пользователем. */
    function changed() {
      if (marked) clearMarks();
      renderNums();
      setCheck();
      snapshot();
    }

    function finish(silent) {
      locked = true;
      items().forEach(function (li) {
        cardOf(li).setAttribute('aria-disabled', 'true');
      });
      setCheck();
      Course.ui.enableNext(root);
      if (Course.ui.once(root, 'complete') && !silent) Course.emit('course:block-complete', { block: block });
    }

    function showResult() {
      if (result === 'correct') {
        Course.ui.showFeedback(root, 'correct');
        Course.ui.setReward(root, REWARD);
      } else {
        Course.ui.showFeedback(root, result);
      }
    }

    // ---------- тап / клавиатура ----------

    function tap(li) {
      if (locked) return;
      var k = picked.indexOf(li);
      if (k !== -1) picked = picked.slice(0, k);
      else picked.push(li);
      if (picked.length === total()) reorder(picked);
      changed();
    }

    list.addEventListener('click', function (event) {
      if (justDragged) return;
      var card = event.target.closest('button');
      var li = card && card.closest('[data-order]');
      if (li && li.parentNode === list) tap(li);
    });

    if (check) {
      check.addEventListener('click', function () {
        if (locked || check.getAttribute('aria-disabled') === 'true') return;
        attempts += 1;
        if (mark()) {
          result = 'correct';
          showResult();
          if (Course.ui.once(root, 'crumbs')) {
            Course.emit('course:crumbs', { block: block, amount: REWARD, reason: 'correct' });
          }
          finish(false);
        } else if (attempts === 1) {
          result = 'retry';
          showResult();
        } else {
          result = 'solution';
          showResult();
          finish(false);
        }
        setCheck();
        snapshot();
      });
    }

    // ---------- перетаскивание (Pointer Events) ----------

    function startDrag() {
      var li = pending.li;
      var rect = li.getBoundingClientRect();
      var placeholder = document.createElement('li');
      placeholder.className = 'is-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.style.height = rect.height + 'px';
      var origin = li.nextSibling;
      list.insertBefore(placeholder, li);
      try {
        list.setPointerCapture(pending.id);
      } catch (e) {
        // указатель уже отпущен — перетаскивание просто не захватит его
      }
      li.classList.add('is-dragging');
      li.style.position = 'fixed';
      li.style.left = rect.left + 'px';
      li.style.top = rect.top + 'px';
      li.style.width = rect.width + 'px';
      li.style.margin = '0';
      li.style.zIndex = 'var(--z-overlay)';
      li.style.pointerEvents = 'none';
      drag = { li: li, id: pending.id, placeholder: placeholder, origin: origin, offsetY: pending.y - rect.top, y: pending.y, frame: 0, hadMarks: marked };
      pending = null;
      if (marked) clearMarks();
      drag.frame = window.requestAnimationFrame(autoScroll);
    }

    /** Плейсхолдер — перед первой карточкой, чья середина ниже указателя. */
    function placePlaceholder() {
      var others = items().filter(function (li) { return li !== drag.li; });
      var before = null;
      for (var i = 0; i < others.length; i += 1) {
        var r = others[i].getBoundingClientRect();
        if (drag.y < r.top + r.height / 2) {
          before = others[i];
          break;
        }
      }
      if (before) {
        if (drag.placeholder.nextElementSibling !== before) list.insertBefore(drag.placeholder, before);
      } else if (others.length) {
        var last = others[others.length - 1];
        if (last.nextElementSibling !== drag.placeholder) list.insertBefore(drag.placeholder, last.nextSibling);
      }
    }

    function moveDrag(y) {
      drag.y = y;
      drag.li.style.top = (y - drag.offsetY) + 'px';
      placePlaceholder();
    }

    function autoScroll() {
      if (!drag) return;
      var top = parseFloat(window.getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      var speed = 0;
      if (drag.y < top + SCROLL_EDGE) speed = -SCROLL_MAX * Math.min(1, (top + SCROLL_EDGE - drag.y) / SCROLL_EDGE);
      else if (drag.y > window.innerHeight - SCROLL_EDGE) speed = SCROLL_MAX * Math.min(1, (drag.y - window.innerHeight + SCROLL_EDGE) / SCROLL_EDGE);
      if (speed) {
        window.scrollBy({ top: speed, behavior: 'instant' }); // не smooth из base.css: кадры шли бы друг другу наперерез
        placePlaceholder();
      }
      drag.frame = window.requestAnimationFrame(autoScroll);
    }

    /** drop — оставить на месте плейсхолдера (иначе вернуть); reset — отмена при course:restart. */
    function endDrag(drop, reset) {
      var d = drag;
      drag = null;
      window.cancelAnimationFrame(d.frame);
      try {
        list.releasePointerCapture(d.id);
      } catch (e) {
        // захват уже снят
      }
      var from = d.li.getBoundingClientRect().top;
      if (drop) list.insertBefore(d.li, d.placeholder);
      else list.insertBefore(d.li, d.origin);
      list.removeChild(d.placeholder);
      d.li.classList.remove('is-dragging');
      d.li.removeAttribute('style');
      if (reset) return;
      flip([d.li], [from]);
      var card = cardOf(d.li);
      if (document.activeElement !== card) card.focus({ preventScroll: true });
      justDragged = true; // клик, который браузер пришлёт после отпускания, — не тап
      window.setTimeout(function () { justDragged = false; }, 0);
      if (drop) {
        picked = items();
        changed();
      } else if (d.hadMarks) {
        // отмена: порядок не изменился — вернуть подсветку, снятую при старте
        mark();
        setCheck();
      }
    }

    list.addEventListener('pointerdown', function (event) {
      if (locked || drag || pending || event.button !== 0 || !event.isPrimary) return;
      var li = event.target.closest('[data-order]');
      if (!li || li.parentNode !== list) return;
      var onHandle = !!event.target.closest('[data-drag-handle]');
      if (event.pointerType !== 'mouse' && !onHandle) return; // палец по карточке — прокрутка и тап
      pending = { li: li, id: event.pointerId, x: event.clientX, y: event.clientY };
    });

    list.addEventListener('pointermove', function (event) {
      if (pending && event.pointerId === pending.id) {
        if (Math.abs(event.clientX - pending.x) + Math.abs(event.clientY - pending.y) < DRAG_THRESHOLD) return;
        startDrag();
      }
      if (drag && event.pointerId === drag.id) {
        event.preventDefault();
        moveDrag(event.clientY);
      }
    });

    function release(event) {
      if (pending && event.pointerId === pending.id) pending = null;
      if (drag && event.pointerId === drag.id) endDrag(event.type === 'pointerup');
    }
    list.addEventListener('pointerup', release);
    list.addEventListener('pointercancel', release);
    list.addEventListener('lostpointercapture', function (event) {
      // только сам список: у касания неявный захват на ручке, и его потеря при переносе захвата
      // на список тоже всплывает сюда (этап 6: иначе drag пальцем обрывался на первом движении)
      if (drag && event.pointerId === drag.id && event.target === list) endDrag(true);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && drag) {
        event.preventDefault();
        endDrag(false);
      }
    });

    // ---------- сброс и восстановление ----------

    Course.on('course:restart', function () {
      if (drag) endDrag(false, true);
      pending = null;
      picked = [];
      attempts = 0;
      marked = false;
      result = null;
      locked = false;
      restoreDom();
    });

    if (saved && Array.isArray(saved.order) && saved.order.length === total()) {
      var byOrder = {};
      items().forEach(function (li) { byOrder[orderOf(li)] = li; });
      var order = saved.order.map(function (n) { return byOrder[n]; });
      if (order.every(Boolean)) {
        order.forEach(function (li) { list.appendChild(li); });
        picked = (saved.picked || []).map(function (n) { return byOrder[n]; }).filter(Boolean);
        attempts = Math.max(0, Math.min(2, Number(saved.attempts) || 0));
        result = saved.result || null;
        renderNums();
        if (saved.marked) mark();
        if (result) showResult();
        if (saved.done) {
          Course.ui.once(root, 'crumbs');
          finish(true);
        }
      }
    }
    setCheck();
  }

  Course.interactives.register('step-order', init);
})(window, document);
