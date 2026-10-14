/**
 * scorm.js — адаптер SCORM 2004 4th Edition (API_1484_11) → Course.scorm.
 *
 * Ищет API LMS в родительских окнах (до 10 уровней) и в opener. Если LMS нет
 * (file://, Vercel, локальный сервер) — все методы молча ничего не делают.
 * Ошибки LMS пишутся в console.warn только при ?debug=1.
 *
 * При закрытии: onBeforeFinish-обработчики (сохранение state.js) → session_time, exit (normal — только когда
 * курс завершён и не начат заново, см. setResumable; иначе suspend) → Commit → Terminate.
 *
 * Интерактивы этот файл не используют: с ним работают только state.js и main.js.
 */
(function (window) {
  'use strict';

  var Course = window.Course;
  var MAX_PARENT_DEPTH = 10;
  var SUSPEND_LIMIT = 64000; // cmi.suspend_data, SPM в SCORM 2004 4th Ed.
  var LOCATION_LIMIT = 1000; // cmi.location

  var api = null;
  var initialized = false;
  var terminated = false;
  var startedAt = 0;
  var entry = '';
  var beforeFinish = [];
  var resumable = true;

  function warn() {
    if (Course.debug && window.console) console.warn.apply(console, ['[scorm]'].concat([].slice.call(arguments)));
  }

  function findApiIn(win) {
    var current = win;
    for (var depth = 0; current && depth <= MAX_PARENT_DEPTH; depth += 1) {
      try {
        if (current.API_1484_11) return current.API_1484_11;
        if (!current.parent || current.parent === current) break;
        current = current.parent;
      } catch (e) {
        break; // окно другого origin — выше не подняться
      }
    }
    return null;
  }

  function findApi() {
    var found = findApiIn(window);
    if (found) return found;
    try {
      if (window.opener && !window.opener.closed) return findApiIn(window.opener);
    } catch (e) {
      // opener недоступен
    }
    return null;
  }

  function lastError(method, args) {
    try {
      var code = String(api.GetLastError());
      if (code !== '0') warn(method, args, '→ ошибка ' + code + ': ' + api.GetErrorString(code));
    } catch (e) {
      warn(method, args, e);
    }
  }

  function call(method, args) {
    if (!api || typeof api[method] !== 'function') return '';
    try {
      var result = String(api[method].apply(api, args || []));
      if (method !== 'GetValue' && result !== 'true') lastError(method, args);
      else if (method === 'GetValue') lastError(method, args);
      return result;
    } catch (e) {
      warn(method, args, e);
      return '';
    }
  }

  function getValue(key) {
    return initialized && !terminated ? call('GetValue', [key]) : '';
  }

  function setValue(key, value) {
    return initialized && !terminated ? call('SetValue', [key, String(value)]) === 'true' : false;
  }

  function commit() {
    return initialized && !terminated ? call('Commit', ['']) === 'true' : false;
  }

  /** Число в строку без экспоненты, не более digits знаков после точки. */
  function decimal(value, digits) {
    return String(Number(Number(value).toFixed(digits)));
  }

  function clamp01(value) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) return 0;
    return n > 1 ? 1 : n;
  }

  /** Длительность в ISO 8601 для cmi.session_time: PT#H#M#S. */
  function isoDuration(ms) {
    var total = Math.max(0, Math.round(ms / 10)) / 100; // сотые доли секунды
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = Number((total % 60).toFixed(2));
    return 'PT' + hours + 'H' + minutes + 'M' + seconds + 'S';
  }

  /** Подключение к LMS. Безопасно вызывать вне LMS и повторно. */
  function init() {
    if (initialized) return true;
    api = findApi();
    if (!api) return false;

    initialized = call('Initialize', ['']) === 'true';
    if (!initialized) {
      api = null;
      return false;
    }
    startedAt = Date.now();
    entry = getValue('cmi.entry');

    var status = getValue('cmi.completion_status');
    if (status === 'unknown' || status === 'not attempted' || status === '') {
      setValue('cmi.completion_status', 'incomplete');
      commit();
    }

    window.addEventListener('pagehide', finish);
    window.addEventListener('beforeunload', finish);
    return true;
  }

  function isConnected() {
    return initialized && !terminated;
  }

  /**
   * Сохранённое состояние и место — только при возобновлении попытки (cmi.entry = 'resume').
   * @returns {{ data: string, location: string } | null}
   */
  function loadState() {
    if (!isConnected() || entry !== 'resume') return null;
    return { data: getValue('cmi.suspend_data'), location: getValue('cmi.location') };
  }

  /** Сохранение строки состояния в cmi.suspend_data (≤ 64 000 символов). */
  function saveState(data) {
    if (!isConnected()) return false;
    var str = String(data);
    if (str.length > SUSPEND_LIMIT) {
      warn('suspend_data длиннее ' + SUSPEND_LIMIT + ' символов (' + str.length + ') — не сохранено');
      return false;
    }
    var ok = setValue('cmi.suspend_data', str);
    commit();
    return ok;
  }

  /** Текущее место в курсе (id блока, например 'block-3'). */
  function setLocation(id) {
    if (!isConnected()) return false;
    return setValue('cmi.location', String(id).slice(0, LOCATION_LIMIT));
  }

  /** Прогресс 0..1 (пройденные блоки / 9), не более 7 знаков. */
  function setProgress(ratio) {
    if (!isConnected()) return false;
    var ok = setValue('cmi.progress_measure', decimal(clamp01(ratio), 7));
    commit();
    return ok;
  }

  /**
   * Итог курса: балл в крошках, completed + passed (курс не «проваливается»).
   * @param {{ score: number, max: number }} result
   */
  function reportCompletion(result) {
    if (!isConnected()) return false;
    var max = Number(result && result.max) > 0 ? Number(result.max) : Course.config.crumbsMax;
    var raw = Math.min(Math.max(Number(result && result.score) || 0, 0), max);
    setValue('cmi.score.min', 0);
    setValue('cmi.score.max', max);
    setValue('cmi.score.raw', raw);
    setValue('cmi.score.scaled', decimal(raw / max, 4));
    setValue('cmi.progress_measure', 1);
    setValue('cmi.completion_status', 'completed');
    setValue('cmi.success_status', 'passed');
    return commit();
  }

  /** fn() — перед завершением сессии (state.js дописывает отложенное сохранение до Terminate). */
  function onBeforeFinish(fn) {
    if (typeof fn === 'function') beforeFinish.push(fn);
  }

  /**
   * false — курс дошёл до итога: при закрытии exit = normal. true (по умолчанию и после «Пройти курс заново») —
   * exit = suspend, даже если completion_status уже completed: та же попытка продолжится с сохранённого места.
   */
  function setResumable(flag) {
    resumable = !!flag;
  }

  /** Завершение сессии — один раз, автоматически при pagehide / beforeunload. */
  function finish() {
    if (!initialized || terminated) return;
    beforeFinish.forEach(function (fn) {
      try {
        fn();
      } catch (e) {
        warn('onBeforeFinish', e);
      }
    });
    var completed = getValue('cmi.completion_status') === 'completed';
    setValue('cmi.session_time', isoDuration(Date.now() - startedAt));
    setValue('cmi.exit', completed && !resumable ? 'normal' : 'suspend');
    commit();
    call('Terminate', ['']);
    terminated = true;
    window.removeEventListener('pagehide', finish);
    window.removeEventListener('beforeunload', finish);
  }

  Course.scorm = {
    isConnected: isConnected,
    init: init,
    loadState: loadState,
    saveState: saveState,
    setLocation: setLocation,
    setProgress: setProgress,
    reportCompletion: reportCompletion,
    finish: finish,
    onBeforeFinish: onBeforeFinish,
    setResumable: setResumable,
    // для отладки и стенда
    getValue: getValue,
    setValue: setValue,
    commit: commit,
    isoDuration: isoDuration,
    SUSPEND_LIMIT: SUSPEND_LIMIT,
  };
})(window);
