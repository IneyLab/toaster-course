/**
 * state.js — состояние курса и геймификация → Course.state.
 *
 * Формат v2 (JSON, VERSION = 2; любая другая версия при загрузке игнорируется):
 *   { v: 2, awarded: { "2": 2, "5": 4 }, completedBlocks: [1, 2], snapshots: { "<interactive>": data },
 *     opened: 1, location: "block-N", finished: false, bestScore: 0 }
 *   opened — номер последнего открытого блока: следующий открывает только «Дальше» пройденного блока (openNext).
 *   crumbs не хранится — это сумма awarded; одна активность = один блок (повтор не удваивает).
 * В LMS — через Course.scorm (cmi.suspend_data + cmi.location, читается только при cmi.entry = 'resume'),
 * иначе — localStorage в try/catch (на file:// он может быть недоступен — курс работает и без него).
 *
 * Слушает (на document):
 *   course:crumbs { block, amount } — принять, если блока ещё нет в awarded и 0 < amount ≤ Course.config.rewards[block];
 *   course:block-complete { block } — засчитать открытый блок; когда выполнены все задания, открывается
 *     и засчитывается блок 9, один раз диспатчится course:finished { score, max };
 *   course:snapshot { interactive, data } — последний вид интерактива (отдаётся в init(root, saved)).
 *   Лишнее (повтор, чужой блок, закрытый блок, сверх максимума, во время восстановления) — игнор
 *   и console.warn при ?debug=1.
 * Сохранение — после каждого изменения, частые вызовы объединяются (SAVE_DELAY); перед scorm.finish
 * и при pagehide / уходе вкладки в фон — немедленно.
 *
 * Открытие блоков: видны блоки 1…opened, остальные закрыты. Задание выполнено → «Дальше» активна (это делает интерактив),
 * но следующий блок открывается только по её нажатию: main.js вызывает openNext(block). Открытие блока 9 засчитывает
 * его и один раз диспатчит course:finished. Применяет к DOM main.js (подписка Course.state.subscribe).
 * Интерактивы этот файл не используют — только события (см. CLAUDE.md).
 */
(function (window, document) {
  'use strict';

  var Course = window.Course;
  var VERSION = 2;
  var STORAGE_KEY = 'toaster-course:v' + VERSION;
  var SAVE_DELAY = 300; // мс: объединение частых сохранений
  var FINAL_BLOCK = Course.config.blocksTotal;

  function warn() {
    if (Course.debug && window.console) console.warn.apply(console, ['[state]'].concat([].slice.call(arguments)));
  }

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function isBlock(n) {
    return Number.isInteger(n) && n >= 1 && n <= Course.config.blocksTotal;
  }

  function createInitial(bestScore) {
    return {
      v: VERSION,
      awarded: {},
      completedBlocks: [],
      snapshots: {},
      opened: 1,
      location: '',
      finished: false,
      bestScore: Math.max(0, Number(bestScore) || 0),
    };
  }

  /** Приводит прочитанные данные к формату v2; чужая версия или мусор → null. */
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return null;
    var state = createInitial(Math.min(Number(raw.bestScore) || 0, Course.config.crumbsMax));
    if (raw.awarded && typeof raw.awarded === 'object') {
      Object.keys(raw.awarded).forEach(function (key) {
        var max = Course.config.rewards[key];
        var amount = Number(raw.awarded[key]);
        if (max && Number.isInteger(amount) && amount > 0 && amount <= max) state.awarded[key] = amount;
      });
    }
    if (Array.isArray(raw.completedBlocks)) {
      raw.completedBlocks.forEach(function (n) {
        if (isBlock(n) && state.completedBlocks.indexOf(n) === -1) state.completedBlocks.push(n);
      });
      state.completedBlocks.sort(function (a, b) { return a - b; });
    }
    if (raw.snapshots && typeof raw.snapshots === 'object') state.snapshots = raw.snapshots;
    if (typeof raw.location === 'string') state.location = raw.location;
    state.finished = raw.finished === true;
    var opened = Number(raw.opened);
    // состояние, сохранённое до появления opened (этап 7, черновик): открыто до первого невыполненного задания
    if (!Number.isInteger(opened)) opened = legacyOpened(state.completedBlocks);
    state.opened = Math.max(1, Math.min(opened, Course.config.blocksTotal));
    return state;
  }

  function legacyOpened(done) {
    var gates = [1].concat(Course.config.taskBlocks);
    for (var i = 0; i < gates.length; i += 1) {
      if (done.indexOf(gates[i]) === -1) return gates[i];
    }
    return Course.config.blocksTotal;
  }

  function parse(str) {
    if (!str) return null;
    try {
      return normalize(JSON.parse(str));
    } catch (e) {
      return null;
    }
  }

  var storage = {
    read: function () {
      try {
        return window.localStorage.getItem(STORAGE_KEY);
      } catch (e) {
        return null;
      }
    },
    write: function (str) {
      try {
        window.localStorage.setItem(STORAGE_KEY, str);
        return true;
      } catch (e) {
        return false;
      }
    },
  };

  var current = createInitial();
  var muted = false; // восстановление: события интерактивов не принимаются
  var listeners = [];
  var saveTimer = 0;
  var dirty = false;
  var lastProgress = -1;

  // ---------- вычисляемое ----------

  function crumbs() {
    return Object.keys(current.awarded).reduce(function (sum, key) {
      return sum + current.awarded[key];
    }, 0);
  }

  function isDone(block) {
    return current.completedBlocks.indexOf(block) !== -1;
  }

  function isUnlocked(block) {
    return Number(block) <= current.opened;
  }

  /**
   * Прогресс 0…1 растёт по нажатию «Дальше»: пройдены блоки 1 … opened − 1; блок 9 (без «Дальше») — когда открыт.
   * Выполненное, но не подтверждённое «Дальше» задание прогресс не двигает.
   */
  function progress() {
    var total = Course.config.blocksTotal;
    return (current.opened >= total ? total : current.opened - 1) / total;
  }

  function snapshotFor(name) {
    return has(current.snapshots, name) ? current.snapshots[name] : null;
  }

  // ---------- подписка ----------

  /** fn(state, change): change = { type: 'load' | 'crumbs' | 'block' | 'open' | 'reset', block?, amount? }. */
  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (l) { return l !== fn; });
    };
  }

  function notify(change) {
    listeners.forEach(function (fn) {
      try {
        fn(current, change);
      } catch (e) {
        console.error('[state] ошибка подписчика', e);
      }
    });
  }

  // ---------- сохранение ----------

  /** Немедленное сохранение туда, откуда состояние читается. */
  function save() {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    dirty = false;
    var str = JSON.stringify(current);
    if (str.length > Course.scorm.SUSPEND_LIMIT) warn('состояние длиннее ' + Course.scorm.SUSPEND_LIMIT + ' символов:', str.length);
    Course.scorm.setResumable(!current.finished);
    if (Course.scorm.isConnected()) {
      var p = progress();
      if (p !== lastProgress) {
        lastProgress = p;
        Course.scorm.setProgress(p);
      }
      if (current.location) Course.scorm.setLocation(current.location);
      return Course.scorm.saveState(str);
    }
    return storage.write(str);
  }

  /** Сохранение с объединением частых вызовов. */
  function scheduleSave() {
    dirty = true;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(save, SAVE_DELAY);
  }

  function flush() {
    if (dirty) save();
  }

  // ---------- события курса ----------

  function finish() {
    var score = crumbs();
    current.finished = true;
    current.bestScore = Math.max(current.bestScore, score);
    save(); // до course:finished: итог LMS пишет поверх сохранённого состояния
    Course.emit('course:finished', { score: score, max: Course.config.crumbsMax });
  }

  Course.on('course:crumbs', function (detail) {
    var block = Number(detail.block);
    var amount = Number(detail.amount);
    var max = Course.config.rewards[block];
    if (muted) return warn('course:crumbs во время восстановления — игнор', detail);
    if (!max) return warn('course:crumbs: у блока нет крошек — игнор', detail);
    if (has(current.awarded, block)) return warn('course:crumbs: блок уже начислен — игнор', detail);
    if (!Number.isInteger(amount) || amount <= 0 || amount > max) return warn('course:crumbs: amount вне 1…' + max + ' — игнор', detail);
    current.awarded[block] = amount;
    scheduleSave();
    notify({ type: 'crumbs', block: block, amount: amount });
  });

  Course.on('course:block-complete', function (detail) {
    var block = Number(detail.block);
    if (muted) return warn('course:block-complete во время восстановления — игнор', detail);
    if (!isBlock(block)) return warn('course:block-complete: нет такого блока — игнор', detail);
    if (isDone(block)) return; // повтор (например, «Дальше» после ползунка) — молча
    if (!isUnlocked(block)) return warn('course:block-complete: блок ещё закрыт — игнор', detail);
    current.completedBlocks.push(block);
    current.completedBlocks.sort(function (a, b) { return a - b; });
    scheduleSave();
    notify({ type: 'block', block: block });
    // Блок 9 засчитывается при открытии, затем — итог (один раз)
    if (block === FINAL_BLOCK && !current.finished) finish();
  });

  Course.on('course:snapshot', function (detail) {
    if (muted || !detail.interactive) return;
    current.snapshots[detail.interactive] = detail.data;
    scheduleSave();
  });

  // ---------- API ----------

  /** Загрузка: LMS (только при resume) → localStorage (вне LMS) → начальное состояние. */
  function load() {
    var loaded = null;
    if (Course.scorm.isConnected()) {
      var saved = Course.scorm.loadState();
      if (saved) {
        loaded = parse(saved.data);
        if (loaded && saved.location) loaded.location = saved.location;
      }
    } else {
      loaded = parse(storage.read());
    }
    current = loaded || createInitial();
    Course.scorm.setResumable(!current.finished);
    lastProgress = Course.scorm.isConnected() && loaded ? progress() : -1;
    if (Course.debug) {
      var sum = Object.keys(Course.config.rewards).reduce(function (s, k) { return s + Course.config.rewards[k]; }, 0);
      if (sum !== Course.config.crumbsMax) warn('сумма Course.config.rewards (' + sum + ') ≠ crumbsMax (' + Course.config.crumbsMax + ')');
      console.info('[state] загружено', JSON.stringify(current), '· ' + JSON.stringify(current).length + ' симв.');
    }
    notify({ type: 'load' });
    return current;
  }

  function get() {
    return current;
  }

  function setLocation(id) {
    if (current.location === String(id)) return;
    current.location = String(id);
    scheduleSave();
  }

  /**
   * «Дальше» пройденного блока: открыть следующий. Блок должен быть засчитан (main.js засчитывает блоки без задания
   * перед вызовом; у блоков с заданием «Дальше» до выполнения неактивна). Открытие блока 9 засчитывает его → итог.
   * @returns {boolean} следующий блок открыт
   */
  function openNext(block) {
    block = Number(block);
    if (!isDone(block)) {
      warn('openNext: блок ' + block + ' не пройден — следующий не открывается');
      return false;
    }
    var next = block + 1;
    if (next > Course.config.blocksTotal || current.opened >= next) return true;
    current.opened = next;
    scheduleSave();
    notify({ type: 'open', block: next });
    if (next === FINAL_BLOCK) Course.emit('course:block-complete', { block: FINAL_BLOCK });
    return true;
  }

  /** Восстановление интерактивов: пока true, их события не принимаются. */
  function mute(flag) {
    muted = !!flag;
  }

  /**
   * «Пройти курс заново»: начальное состояние (лучший результат сохраняется), место — block-1, сохранить сразу.
   * В LMS это та же попытка: completion_status остаётся completed (его пишет только reportCompletion).
   */
  function reset() {
    current = createInitial(current.bestScore);
    current.location = 'block-1';
    save();
    notify({ type: 'reset' });
    return current;
  }

  // Состояние — в LMS до Terminate; вне LMS — при закрытии вкладки и уходе в фон
  Course.scorm.onBeforeFinish(flush);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });

  Course.state = {
    VERSION: VERSION,
    createInitial: createInitial,
    load: load,
    save: save,
    flush: flush,
    get: get,
    crumbs: crumbs,
    progress: progress,
    isUnlocked: isUnlocked,
    openNext: openNext,
    isDone: isDone,
    snapshotFor: snapshotFor,
    setLocation: setLocation,
    mute: mute,
    reset: reset,
    subscribe: subscribe,
  };
})(window, document);
