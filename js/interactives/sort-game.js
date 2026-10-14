/**
 * sort-game.js — игра «Можно / Нельзя», блок 8 (data-interactive="sort-game").
 *
 * Разметка и тексты — в index.html (контракт — docs/interactives-contract.md). Видна верхняя (первая) карточка
 * стопки [data-sort-stack]. Три способа ответа — одна логика answer(card, zone):
 *   а) кнопки [data-sort="no|yes"] на карточке (клавиатура, тап, экранный диктор) — основной;
 *   б) мышь: перетаскивание карточки (Pointer Events, порог 6px), зона под указателем — is-drop-target,
 *      отпускание над зоной — ответ, мимо — карточка возвращается;
 *   в) палец/перо: свайп влево = «Нельзя», вправо = «Можно» (≥ 30 % ширины карточки или быстрый флик);
 *      карточка следует за пальцем с наклоном (--drag-x / --drag-y / --drag-rotate), недотяг — возврат.
 *      На карточке touch-action: pan-y — жест захватывается, только если горизонтальное смещение больше
 *      вертикального, иначе страница прокручивается как обычно.
 * Верно — is-correct, пояснение [data-explain], карточка переезжает в [data-zone-list] своей зоны (полёт — FLIP
 * на transform, при reduced-motion — сразу), фокус — на «Нельзя» следующей карточки. Неверно — is-wrong
 * (вспышка, вздрагивание, «— неверно»), пояснение видно, карточка возвращается на верх стопки и ждёт нового
 * ответа: пояснение можно читать сколько нужно, фокус остаётся на нажатой кнопке (решение этапа 6 — в контракте).
 * Неверно разложенная карточка ждёт верного ответа, поэтому к концу все 8 разложены верно: complete, всегда «+2»
 * (решение 14.10.2026), [data-sort-summary], «Дальше», course:crumbs + course:block-complete — один раз.
 * «С первой попытки» (firstTry) и ошибки (missed) учитываются только для вида при восстановлении.
 * Снимок: { placed: { no: [1, 2], yes: [7] }, stack: [3, 4, 8, 5, 6], firstTry: [1, 2, 7], missed: [3], done: false }
 * (missed — ошибались хотя бы раз).
 */
(function (window, document) {
  'use strict';

  var Course = window.Course;
  var DRAG_THRESHOLD = 6; // px до старта перетаскивания мышью
  var SWIPE_LOCK = 10; // px по горизонтали, после которых палец «захватывает» карточку
  var SWIPE_SHARE = 0.3; // доля ширины карточки для свайпа
  var FLICK_SPEED = 0.5; // px/мс — быстрый флик засчитывается и при недотяге
  var FLICK_MIN = 30; // px — но не короче
  var MAX_ROTATE = 12; // град. наклона на ширину карточки
  var REWARD = 2; // все 8 разложены верно (с любой попытки) = Course.config.rewards[8]

  function init(root, saved) {
    var block = Number(root.getAttribute('data-block'));
    var stack = root.querySelector('[data-sort-stack]');
    if (!stack) return;
    var lists = {
      no: root.querySelector('[data-zone-list="no"]'),
      yes: root.querySelector('[data-zone-list="yes"]'),
    };
    var zones = Array.prototype.filter.call(root.querySelectorAll('[data-zone]'), function (el) {
      return !el.hasAttribute('data-card');
    });
    // Сообщение, награда и «Главные запреты» — в разметке после корня (в c-block__body секции): ищем в секции
    var section = root.closest('section[data-block]') || root;
    var summary = section.querySelector('[data-sort-summary]');
    var extra = [Course.ui.nextLink(root), summary].concat(Array.prototype.slice.call(section.querySelectorAll('[data-feedback]')));
    var restoreDom = Course.ui.captureInitial(root, extra);

    var firstTry = [];
    var missed = [];
    var done = false;
    var pending = null; // нажатие, ещё не ставшее жестом
    var drag = null;
    var justDragged = false;

    function numOf(card) {
      return Number(card.getAttribute('data-card'));
    }
    function cardsIn(list) {
      return Array.prototype.filter.call(list.children, function (el) {
        return el.hasAttribute('data-card');
      });
    }
    function top() {
      return cardsIn(stack)[0] || null;
    }
    function byNum(n) {
      return root.querySelector('[data-card="' + n + '"]');
    }
    function explainOf(card) {
      return card.querySelector('[data-explain]');
    }

    // ---------- вид ----------

    /** Перезапустить CSS-анимацию класса (повторная ошибка снова вздрагивает). */
    function flash(card, cls) {
      card.classList.remove('is-correct', 'is-wrong');
      void card.offsetWidth;
      card.classList.add(cls);
    }

    /** FLIP: карточка «летит» из прямоугольника from в своё новое место (transform/opacity). */
    function flyFrom(card, from, fade) {
      if (!from || Course.ui.prefersReducedMotion()) return;
      var to = card.getBoundingClientRect();
      var dx = from.left - to.left;
      var dy = from.top - to.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      card.style.transition = 'none';
      card.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
      if (fade) card.style.opacity = '0.4';
      void card.offsetWidth; // reflow: начальное смещение применено, дальше — анимация к нулю
      card.style.transition = 'transform var(--duration-slow) var(--ease-standard), opacity var(--duration-slow) var(--ease-standard)';
      card.style.transform = '';
      card.style.opacity = '';
      card.addEventListener('transitionend', function end(event) {
        if (event.target !== card || event.propertyName !== 'transform') return;
        card.removeEventListener('transitionend', end);
        card.style.removeProperty('transition');
      });
    }

    function placed() {
      return { no: cardsIn(lists.no).map(numOf), yes: cardsIn(lists.yes).map(numOf) };
    }

    function snapshot() {
      Course.ui.snapshot(root, {
        placed: placed(),
        stack: cardsIn(stack).map(numOf),
        firstTry: firstTry.slice(),
        missed: missed.slice(),
        done: done,
      });
    }

    function finish(silent) {
      done = true;
      Course.ui.showFeedback(section, 'complete');
      Course.ui.setReward(section, REWARD);
      if (summary) summary.hidden = false;
      Course.ui.enableNext(root);
      if (silent) {
        Course.ui.once(root, 'crumbs');
        Course.ui.once(root, 'complete');
        return;
      }
      if (Course.ui.once(root, 'crumbs')) {
        Course.emit('course:crumbs', { block: block, amount: REWARD, reason: 'sort' });
      }
      if (Course.ui.once(root, 'complete')) Course.emit('course:block-complete', { block: block });
    }

    /** Ответ по верхней карточке; from — где карточка была на экране (после жеста), для полёта. */
    function answer(card, zone, from) {
      if (done || card !== top()) return;
      var n = numOf(card);
      var hadFocus = card.contains(document.activeElement);
      var explain = explainOf(card);
      if (explain) explain.hidden = false;

      if (card.getAttribute('data-zone') !== zone) {
        if (missed.indexOf(n) === -1) missed.push(n);
        flash(card, 'is-wrong');
        flyFrom(card, from, false); // возврат на верх стопки
        snapshot();
        return;
      }

      if (missed.indexOf(n) === -1 && firstTry.indexOf(n) === -1) firstTry.push(n);
      if (!from) from = card.getBoundingClientRect();
      lists[zone].appendChild(card);
      flash(card, 'is-correct');
      flyFrom(card, from, true);

      var next = top();
      if (next) {
        if (hadFocus) next.querySelector('[data-sort="no"]').focus({ preventScroll: true });
      } else {
        finish(false);
        if (hadFocus) {
          // кнопки разложенной карточки скрыты — фокус на саму карточку, следующий Tab — «Дальше»
          card.setAttribute('tabindex', '-1');
          card.focus({ preventScroll: true });
        }
      }
      snapshot();
    }

    // ---------- кнопки ----------

    root.addEventListener('click', function (event) {
      if (justDragged) return;
      var btn = event.target.closest('[data-sort]');
      var card = btn && btn.closest('[data-card]');
      if (card && card.parentNode === stack) answer(card, btn.getAttribute('data-sort'));
    });

    // ---------- перетаскивание и свайп (Pointer Events) ----------

    function zoneAt(x, y) {
      for (var i = 0; i < zones.length; i += 1) {
        var r = zones[i].getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return zones[i].getAttribute('data-zone');
      }
      return null;
    }

    function highlight(zone) {
      zones.forEach(function (z) {
        z.classList.toggle('is-drop-target', z.getAttribute('data-zone') === zone);
      });
    }

    function startDrag(mode) {
      var card = pending.card;
      try {
        card.setPointerCapture(pending.id);
      } catch (e) {
        // указатель уже отпущен — жест просто не захватит его
      }
      card.style.removeProperty('transition');
      card.style.removeProperty('transform');
      card.classList.add('is-dragging');
      drag = {
        card: card, id: pending.id, mode: mode, x0: pending.x, y0: pending.y,
        width: card.getBoundingClientRect().width,
        dx: 0, dy: 0, zone: null, samples: [{ x: pending.x, t: pending.t }],
      };
      pending = null;
    }

    function moveDrag(event) {
      var d = drag;
      d.dx = event.clientX - d.x0;
      d.dy = event.clientY - d.y0;
      var y = d.mode === 'swipe' ? d.dy * 0.2 : d.dy; // свайп — почти горизонтально
      var rotate = Math.max(-MAX_ROTATE, Math.min(MAX_ROTATE, d.dx / d.width * MAX_ROTATE));
      d.card.style.setProperty('--drag-x', d.dx + 'px');
      d.card.style.setProperty('--drag-y', y + 'px');
      d.card.style.setProperty('--drag-rotate', rotate + 'deg');
      d.samples.push({ x: event.clientX, t: event.timeStamp });
      while (d.samples.length > 2 && event.timeStamp - d.samples[0].t > 100) d.samples.shift();
      if (d.mode === 'drag') d.zone = zoneAt(event.clientX, event.clientY);
      else d.zone = Math.abs(d.dx) >= d.width * SWIPE_SHARE ? (d.dx < 0 ? 'no' : 'yes') : null;
      highlight(d.zone);
    }

    function swipeZone(d) {
      if (d.zone) return d.zone;
      var first = d.samples[0];
      var last = d.samples[d.samples.length - 1];
      var speed = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
      if (Math.abs(speed) >= FLICK_SPEED && Math.abs(d.dx) >= FLICK_MIN && (speed < 0) === (d.dx < 0)) {
        return d.dx < 0 ? 'no' : 'yes';
      }
      return null;
    }

    /** commit — засчитать ответ по жесту (иначе — возврат); reset — отмена при course:restart. */
    function endDrag(commit, reset) {
      var d = drag;
      drag = null;
      try {
        d.card.releasePointerCapture(d.id);
      } catch (e) {
        // захват уже снят
      }
      highlight(null);
      var from = d.card.getBoundingClientRect();
      var zone = commit ? (d.mode === 'swipe' ? swipeZone(d) : d.zone) : null;
      d.card.classList.remove('is-dragging');
      ['--drag-x', '--drag-y', '--drag-rotate'].forEach(function (p) { d.card.style.removeProperty(p); });
      if (reset) return;
      justDragged = true; // клик, который браузер пришлёт после отпускания, — не нажатие кнопки
      window.setTimeout(function () { justDragged = false; }, 0);
      if (zone) answer(d.card, zone, from);
      else flyFrom(d.card, from, false);
    }

    stack.addEventListener('pointerdown', function (event) {
      if (done || drag || pending || event.button !== 0 || !event.isPrimary) return;
      var card = event.target.closest('[data-card]');
      if (!card || card !== top()) return;
      pending = { card: card, id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY, t: event.timeStamp };
    });

    stack.addEventListener('pointermove', function (event) {
      if (pending && event.pointerId === pending.id) {
        var dx = Math.abs(event.clientX - pending.x);
        var dy = Math.abs(event.clientY - pending.y);
        if (pending.type === 'mouse') {
          if (dx + dy >= DRAG_THRESHOLD) startDrag('drag');
        } else if (dy > dx && dy > DRAG_THRESHOLD) {
          pending = null; // вертикальный жест — прокрутка страницы
        } else if (dx > SWIPE_LOCK && dx > dy) {
          startDrag('swipe');
        }
      }
      if (drag && event.pointerId === drag.id) {
        event.preventDefault();
        moveDrag(event);
      }
    });

    function release(event) {
      if (pending && event.pointerId === pending.id) pending = null;
      if (drag && event.pointerId === drag.id) endDrag(event.type === 'pointerup');
    }
    stack.addEventListener('pointerup', release);
    stack.addEventListener('pointercancel', release);
    stack.addEventListener('lostpointercapture', function (event) {
      // только сама карточка: у касания неявный захват на элементе под пальцем (например, <use> иконки),
      // и его потеря при переносе захвата на карточку тоже всплывает сюда
      if (drag && event.pointerId === drag.id && event.target === drag.card) endDrag(false);
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
      firstTry = [];
      missed = [];
      done = false;
      restoreDom();
    });

    if (saved && saved.placed && Array.isArray(saved.stack)) {
      var ok = true;
      ['no', 'yes'].forEach(function (zone) {
        (saved.placed[zone] || []).forEach(function (n) {
          var card = byNum(n);
          if (!card || card.getAttribute('data-zone') !== zone) { ok = false; return; }
          lists[zone].appendChild(card);
          card.classList.add('is-correct');
          if (explainOf(card)) explainOf(card).hidden = false;
        });
      });
      saved.stack.forEach(function (n) {
        var card = byNum(n);
        if (card && card.parentNode === stack) stack.appendChild(card);
      });
      firstTry = (saved.firstTry || []).map(Number).filter(byNum);
      missed = (saved.missed || []).map(Number).filter(byNum);
      cardsIn(stack).forEach(function (card) {
        if (missed.indexOf(numOf(card)) === -1) return;
        card.classList.add('is-wrong');
        if (explainOf(card)) explainOf(card).hidden = false;
      });
      if (ok && !top()) finish(true);
    }
  }

  Course.interactives.register('sort-game', init);
})(window, document);
