/**
 * main.js — точка входа курса (подключается последним <script defer>).
 *
 * Порядок: has-js → LMS → Course.state.load() → закрыть неоткрытые блоки → init(root, saved) интерактивов
 * (saved = Course.state.snapshotFor(name); на время восстановления state не принимает их события) →
 * шапка и счётчики → прокрутка к сохранённому месту (только к открытому блоку, иначе — к последнему открытому).
 *
 * Дальше:
 *   — подписка на Course.state: шапка (прогресс, крошки, «+N»), открытие блоков с плавным появлением;
 *   — «Дальше» (a[data-next], у бл. 1 — «Включаем!») — единственный способ открыть следующий блок: засчитывает блок
 *     без задания (1, 3, 4), Course.state.openNext(блок), прокрутка к следующему блоку и фокус на его заголовок.
 *     У блока с заданием «Дальше» активна только после выполнения (это делает интерактив); бл. 9 засчитывает state.js;
 *     ссылка на закрытый блок ведёт к последнему открытому;
 *   — «Пройти курс заново» (a[data-restart]): state.reset() → course:restart → блоки закрыты → к блоку 1;
 *   — course:finished → Course.scorm.reportCompletion с лучшим результатом попытки (bestScore).
 * Без JS (нет has-js) блоки не закрываются — видно всё содержание.
 */
(function (window, document) {
  'use strict';

  var Course = window.Course;
  var root = document.documentElement;

  root.classList.add('has-js');

  // ?debug=1: все события курса — в консоль (проверка начислений). Фаза захвата — раньше слушателей state.js,
  // поэтому вложенные события (бл. 9 и course:finished внутри завершения бл. 8) идут в журнале в порядке диспатча.
  if (Course.debug) {
    ['course:crumbs', 'course:block-complete', 'course:snapshot', 'course:restart', 'course:finished'].forEach(function (name) {
      document.addEventListener(name, function (event) {
        console.info('[course]', name, JSON.stringify(event.detail || {}));
      }, true);
    });
  }

  // «Дальше» с aria-disabled="true" не переходит
  Course.ui.guardNext();

  var blocks = Array.prototype.slice.call(document.querySelectorAll('section[data-block]'));
  var tasks = Course.config.taskBlocks;

  function numOf(section) {
    return Number(section.getAttribute('data-block'));
  }
  function isTask(n) {
    return tasks.indexOf(n) !== -1;
  }
  function openBlocks() {
    return blocks.filter(function (s) { return !s.hidden; });
  }
  function lastOpen() {
    var open = openBlocks();
    return open[open.length - 1] || blocks[0];
  }
  function reducedMotion() {
    return Course.ui.prefersReducedMotion();
  }

  // ---------- открытие блоков ----------

  /** hidden + is-locked у закрытых; reveal — плавное появление только что открытых. */
  function applyLocks(reveal) {
    blocks.forEach(function (section) {
      var locked = !Course.state.isUnlocked(numOf(section));
      if (locked === section.hidden) return;
      section.hidden = locked;
      section.classList.toggle('is-locked', locked);
      if (!locked && reveal && !reducedMotion()) {
        section.classList.add('is-revealing');
        section.addEventListener('animationend', function end(event) {
          if (event.target !== section) return;
          section.removeEventListener('animationend', end);
          section.classList.remove('is-revealing');
        });
      }
    });
  }

  /** Заголовок блока — цель фокуса после перехода. */
  function titleOf(section) {
    var title = document.getElementById(section.getAttribute('aria-labelledby'));
    if (title && !title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
    return title;
  }

  /**
   * Прокрутить свой документ так, чтобы верх блока встал под шапку (scroll-padding-top).
   * Не scrollIntoView: в iframe LMS он прокручивает и страницу LMS вокруг курса.
   */
  function scrollToBlock(section, instant) {
    var pad = parseFloat(window.getComputedStyle(root).scrollPaddingTop) || 0;
    // offsetTop, а не getBoundingClientRect: только что открытый блок ещё сдвинут анимацией появления (transform)
    var y = 0;
    for (var el = section; el; el = el.offsetParent) y += el.offsetTop;
    var top = Math.max(0, y - pad);
    window.scrollTo({ top: top, behavior: instant || reducedMotion() ? 'instant' : 'smooth' });
  }

  /** Перейти к блоку: прокрутка (плавно, при reduced-motion — сразу) и фокус на заголовок. */
  function goTo(section, instant) {
    if (!section || section.hidden) section = lastOpen();
    var title = titleOf(section);
    if (title) title.focus({ preventScroll: true });
    scrollToBlock(section, instant);
    trackLocation(); // место — и без событий scroll (их нет, например, в скрытой вкладке)
  }

  // ---------- шапка ----------

  var progressEl = document.querySelector('.c-header [role="progressbar"]');
  var progressLabel = progressEl && progressEl.querySelector('.c-progress__label');
  var crumbsBox = document.querySelector('.c-header [data-crumbs-delta]');
  crumbsBox = crumbsBox && crumbsBox.parentNode;
  var crumbsDelta = crumbsBox && crumbsBox.querySelector('[data-crumbs-delta]');

  /**
   * Прогресс p = блоков, пройденных нажатием «Дальше» (бл. 9 — при открытии) / 9 → --progress = p, подпись и aria-valuenow = round(p × 100),
   * data-stage = floor(p × 4): 0 (0–2 блока) · 1 (3–4) · 2 (5–6) · 3 (7–8) · 4 — только 9 из 9 (--toast-4).
   */
  function renderProgress() {
    if (!progressEl) return;
    var p = Course.state.progress();
    var pct = Math.round(p * 100);
    progressEl.style.setProperty('--progress', String(Number(p.toFixed(4))));
    progressEl.setAttribute('data-stage', String(Math.min(4, Math.floor(p * 4 + 1e-9))));
    progressEl.setAttribute('aria-valuenow', String(pct));
    if (progressLabel) progressLabel.textContent = pct + '%';
  }

  function renderCrumbs() {
    var value = String(Course.state.crumbs());
    Array.prototype.forEach.call(document.querySelectorAll('[data-crumbs-value]'), function (el) {
      if (el.textContent !== value) el.textContent = value;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-crumbs-max]'), function (el) {
      el.textContent = String(Course.config.crumbsMax);
    });
  }

  /** «+N» у счётчика шапки (декоративно, aria-hidden; живой регион читает новое значение). */
  function bump(amount) {
    if (!crumbsBox || !crumbsDelta || reducedMotion()) return;
    crumbsDelta.textContent = '+' + amount;
    crumbsDelta.hidden = false;
    crumbsBox.classList.remove('is-bumped');
    void crumbsBox.offsetWidth; // перезапуск анимации при подряд идущих начислениях
    crumbsBox.classList.add('is-bumped');
  }
  if (crumbsDelta) {
    crumbsDelta.addEventListener('animationend', function () {
      crumbsDelta.hidden = true;
      crumbsBox.classList.remove('is-bumped');
    });
  }

  Course.state.subscribe(function (state, change) {
    if (change.type === 'load') return;
    renderProgress();
    renderCrumbs();
    if (change.type === 'crumbs') bump(change.amount);
    if (change.type === 'open') applyLocks(true);
    if (change.type === 'reset') applyLocks(false);
  });

  // ---------- загрузка и восстановление ----------

  Course.scorm.init();
  var state = Course.state.load();
  applyLocks(false);

  // Интерактивы: корни по data-interactive, init(root, saved) из реестра. На время восстановления state
  // их события не принимает: начисления и завершения уже учтены в сохранённом состоянии.
  Course.state.mute(true);
  Array.prototype.forEach.call(document.querySelectorAll('[data-interactive]'), function (el) {
    var name = el.getAttribute('data-interactive');
    var init = Course.interactives.get(name);
    if (!init) {
      if (Course.debug) console.warn('[main] интерактив не зарегистрирован:', name);
      return;
    }
    try {
      init(el, Course.state.snapshotFor(name));
    } catch (e) {
      console.error('[main] ошибка инициализации интерактива ' + name, e);
    }
  });
  Course.state.mute(false);

  renderProgress();
  renderCrumbs();

  // Место в курсе: сохранённый блок, если открыт, иначе — последний открытый. #block-N в адресе — так же.
  (function restorePlace() {
    var hash = window.location.hash.slice(1);
    var target = /^block-\d+$/.test(hash) ? document.getElementById(hash) : null;
    if (!target && state.location) target = document.getElementById(state.location) || lastOpen();
    if (!target || !target.hasAttribute('data-block')) return;
    if (target.hidden) target = lastOpen();
    scrollToBlock(target, true);
    // Картинки и шрифт догружаются позже и сдвигают вёрстку — выровнять ещё раз, если пользователь не начал сам
    var touched = false;
    var mark = function () { touched = true; };
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function (type) {
      window.addEventListener(type, mark, { once: true, passive: true });
    });
    if (document.readyState !== 'complete') {
      window.addEventListener('load', function () {
        if (!touched) scrollToBlock(target, true);
      }, { once: true });
    }
  })();

  // ---------- итог → LMS ----------

  Course.on('course:finished', function (detail) {
    Course.scorm.reportCompletion({
      score: Math.max(Number(detail.score) || 0, Course.state.get().bestScore),
      max: Number(detail.max) || Course.config.crumbsMax,
    });
  });

  // ---------- навигация ----------

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target.closest && event.target.closest('a[href^="#block-"]');
    if (!link || link.hasAttribute('data-restart')) return;
    if (link.getAttribute('aria-disabled') === 'true') return; // guardNext
    var target = document.getElementById(link.getAttribute('href').slice(1));
    if (!target || !target.hasAttribute('data-block')) return;
    if (link.hasAttribute('data-next')) {
      var from = link.closest('section[data-block]');
      if (from) {
        // блок без задания пройден нажатием; затем — открыть следующий (только так он и открывается)
        if (!isTask(numOf(from)) && !Course.state.isDone(numOf(from))) Course.emit('course:block-complete', { block: numOf(from) });
        Course.state.openNext(numOf(from));
      }
    } else if (!target.hidden) {
      return; // обычный якорь к открытому блоку — как в браузере
    }
    event.preventDefault();
    goTo(target);
  });

  // «Пройти курс заново» — без перезагрузки страницы (в LMS перезагрузка SCO завершила бы сессию)
  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[data-restart]');
    if (!link) return;
    event.preventDefault();
    Course.state.reset();
    Course.emit('course:restart');
    goTo(document.getElementById('block-1'), true);
  });

  // ---------- место в курсе ----------

  // Текущий блок — тот, чей верх под шапкой (линия — низ шапки, scroll-padding-top: то же место, куда блок
  // встаёт при возобновлении). Не IntersectionObserver: в iframe LMS он игнорирует rootMargin.
  var locationTimer = 0;
  function trackLocation() {
    window.clearTimeout(locationTimer);
    locationTimer = window.setTimeout(function () {
      var open = openBlocks();
      if (!open.length) return;
      var current = open[0]; // в самом верху — первый блок, даже если он короче полэкрана
      var line = (parseFloat(window.getComputedStyle(root).scrollPaddingTop) || 0) + 8;
      for (var j = 0; window.pageYOffset >= 1 && j < open.length; j += 1) {
        var rect = open[j].getBoundingClientRect();
        if (rect.top <= line && rect.bottom > line) {
          current = open[j];
          break;
        }
        if (rect.top > line) break; // линия между блоками — оставляем предыдущий
        current = open[j];
      }
      if (window.pageYOffset >= 1 && window.pageYOffset + window.innerHeight >= root.scrollHeight - 1) {
        current = open[open.length - 1]; // в самом низу — последний открытый блок, даже если он короткий
      }
      Course.state.setLocation(current.id);
    }, 300);
  }
  if (blocks.length) {
    window.addEventListener('scroll', trackLocation, { passive: true });
    trackLocation();
  }
})(window, document);
