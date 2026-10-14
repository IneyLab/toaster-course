/**
 * core.js — общий неймспейс курса и шина событий.
 *
 * Подключается первым обычным <script defer> (не ES-модуль — курс должен
 * открываться с file://). Порядок: core → scorm → state → interactives/* → main.
 *
 * window.Course:
 *   Course.config        — константы курса (крошки по блокам rewards, блоки с заданием taskBlocks);
 *   Course.on / emit     — события на document (course:crumbs, course:block-complete, course:snapshot,
 *                          course:restart, course:finished);
 *   Course.interactives  — реестр интерактивов: register(name, init) / get(name) / names();
 *   Course.debug         — true при ?debug=1 в адресе (подробные предупреждения в консоль).
 *   Course.ui            — общие помощники интерактивов (без текста, без state/scorm):
 *     showFeedback(root, key|null) — снять hidden с [data-feedback=key] внутри root, остальным вернуть;
 *     setReward(root, amount|null) — показать только [data-reward=amount] (null — скрыть все);
 *     nextLink(root) / enableNext(root) — «Дальше» (a[data-next]) секции блока / снять с неё aria-disabled;
 *     guardNext()                  — один раз глобально: клик по a[data-next][aria-disabled="true"] не переходит;
 *     prefersReducedMotion()       — true при prefers-reduced-motion: reduce;
 *     once(root, key)              — true только при первом вызове с этой парой (до course:restart):
 *                                    защита от повторного начисления крошек внутри сессии;
 *     captureInitial(root, extra)  — снимок разметки (атрибуты, текст листьев, порядок детей) root и extra[];
 *                                    возвращает restore() — вернуть всё как при загрузке (для course:restart);
 *     snapshot(root, data)         — course:snapshot { block, interactive, data } — вид интерактива для восстановления.
 * Course.scorm и Course.state добавляют свои файлы.
 */
(function (window, document) {
  'use strict';

  var Course = window.Course || {};

  Course.config = Object.freeze({
    blocksTotal: 9,
    crumbsMax: 13,
    masterThreshold: 10,
    // максимум крошек за блок (сумма = crumbsMax; state.js проверяет при ?debug=1)
    rewards: Object.freeze({ 2: 2, 5: 4, 6: 2, 7: 3, 8: 2 }),
    // блоки с заданием: следующий блок открывается, когда задание выполнено
    taskBlocks: Object.freeze([2, 5, 6, 7, 8]),
  });

  Course.debug = (function () {
    try {
      return /(?:^|[?&])debug=1(?:&|$)/.test(window.location.search);
    } catch (e) {
      return false;
    }
  })();

  /** Подписка на событие курса; возвращает функцию отписки. */
  Course.on = function (name, handler) {
    var listener = function (event) {
      handler(event.detail || {}, event);
    };
    document.addEventListener(name, listener);
    return function () {
      document.removeEventListener(name, listener);
    };
  };

  /** Событие курса на document (bubbles: true), как в контракте интерактивов. */
  Course.emit = function (name, detail) {
    document.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail || {} }));
  };

  var registry = {};

  Course.interactives = {
    /** Интерактив регистрирует себя: Course.interactives.register('<name>', init). */
    register: function (name, init) {
      if (typeof init !== 'function') throw new TypeError('Course.interactives.register: init не функция (' + name + ')');
      registry[name] = init;
    },
    get: function (name) {
      return Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : null;
    },
    names: function () {
      return Object.keys(registry);
    },
  };

  // ---------- Course.ui ----------

  function blockOf(root) {
    return Number(root.getAttribute('data-block')) || 0;
  }

  var onceKeys = [];

  /** Секция блока, в которой лежит интерактив (у бл. 4 «Дальше» — вне корня интерактива). */
  function sectionOf(root) {
    return root.closest('section[data-block]') || root;
  }

  Course.ui = {
    showFeedback: function (root, key) {
      var items = root.querySelectorAll('[data-feedback]');
      for (var i = 0; i < items.length; i += 1) {
        items[i].hidden = key == null || items[i].getAttribute('data-feedback') !== String(key);
      }
    },

    setReward: function (root, amount) {
      var items = root.querySelectorAll('[data-reward]');
      for (var i = 0; i < items.length; i += 1) {
        items[i].hidden = amount == null || items[i].getAttribute('data-reward') !== String(amount);
      }
    },

    nextLink: function (root) {
      return sectionOf(root).querySelector('a[data-next]');
    },

    enableNext: function (root) {
      var link = Course.ui.nextLink(root);
      if (link) link.removeAttribute('aria-disabled');
    },

    guardNext: (function () {
      var bound = false;
      return function () {
        if (bound) return;
        bound = true;
        document.addEventListener('click', function (event) {
          var link = event.target.closest && event.target.closest('a[data-next][aria-disabled="true"]');
          if (link) event.preventDefault();
        });
      };
    })(),

    prefersReducedMotion: function () {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    },

    once: function (root, key) {
      for (var i = 0; i < onceKeys.length; i += 1) {
        if (onceKeys[i].root === root && onceKeys[i].key === key) return false;
      }
      onceKeys.push({ root: root, key: key });
      return true;
    },

    captureInitial: function (root, extra) {
      var tops = [root].concat(extra || []).filter(Boolean);
      var records = [];
      tops.forEach(function (top) {
        var els = [top].concat(Array.prototype.slice.call(top.querySelectorAll('*')));
        els.forEach(function (el) {
          var attrs = {};
          for (var i = 0; i < el.attributes.length; i += 1) attrs[el.attributes[i].name] = el.attributes[i].value;
          records.push({
            el: el,
            attrs: attrs,
            children: Array.prototype.slice.call(el.childNodes),
            text: el.children.length ? null : el.textContent,
          });
        });
      });
      return function restore() {
        records.forEach(function (r) {
          var el = r.el;
          var i;
          for (i = el.attributes.length - 1; i >= 0; i -= 1) {
            var name = el.attributes[i].name;
            if (!Object.prototype.hasOwnProperty.call(r.attrs, name)) el.removeAttribute(name);
          }
          Object.keys(r.attrs).forEach(function (name) {
            if (el.getAttribute(name) !== r.attrs[name]) el.setAttribute(name, r.attrs[name]);
          });
          // Порядок детей: переставляем, только если он изменился (иначе не трогаем фокус и выделение)
          var same = el.childNodes.length === r.children.length;
          for (i = 0; same && i < r.children.length; i += 1) same = el.childNodes[i] === r.children[i];
          if (!same) {
            while (el.firstChild) el.removeChild(el.firstChild);
            r.children.forEach(function (child) { el.appendChild(child); });
          }
          if (r.text !== null && el.textContent !== r.text) el.textContent = r.text;
          if (el.tagName === 'INPUT' && 'value' in r.attrs) el.value = r.attrs.value;
        });
      };
    },

    snapshot: function (root, data) {
      Course.emit('course:snapshot', {
        block: blockOf(root),
        interactive: root.getAttribute('data-interactive'),
        data: data,
      });
    },
  };

  // «Пройти курс заново»: начисления снова возможны
  document.addEventListener('course:restart', function () {
    onceKeys = [];
  });

  window.Course = Course;
})(window, document);
