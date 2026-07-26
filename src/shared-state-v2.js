(function (global) {
  'use strict';

  const CLASSROOM_CACHE = 'ysb_shared_v2_classroom_settings';
  const WORKBOOK_CACHE = 'ysb_shared_v2_workbooks';
  const ZONES = new Set(['silent_forest', 'desert_wasteland', 'spooky_swamp']);

  class SharedStateV2Error extends Error {
    constructor(code, message) { super(message); this.name = 'SharedStateV2Error'; this.code = code; }
  }
  const messages = {
    OFFLINE:'인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
    FORBIDDEN:'이 공유 설정을 사용할 권한이 없어요.',
    INVALID_SHARED_STATE:'문제집 또는 수업 설정 형식이 올바르지 않아요.',
    LOAD_FAILED:'공유 수업 정보를 불러오지 못했어요.',
    SAVE_FAILED:'공유 수업 정보를 저장하지 못했어요.',
  };
  const fail = (code) => new SharedStateV2Error(code, messages[code]);
  const isNetwork = (value) => {
    const text = `${value?.code || ''} ${value?.message || value || ''}`.toLowerCase();
    return value instanceof TypeError || text.includes('failed to fetch') || text.includes('network');
  };
  const mapError = (value, fallback) => {
    const text = `${value?.code || ''} ${value?.message || ''}`.toLowerCase();
    const status = Number(value?.status || value?.context?.status || 0);
    if (isNetwork(value)) return fail('OFFLINE');
    if (status === 401 || status === 403 || text.includes('42501') || text.includes('permission') || text.includes('jwt')) return fail('FORBIDDEN');
    return fail(fallback);
  };
  const text = (value, max, required = false) => {
    if (typeof value !== 'string') { if (required) throw fail('INVALID_SHARED_STATE'); return ''; }
    const clean = value.normalize('NFKC').trim();
    if ((required && !clean) || clean.length > max || /[\u0000-\u001f\u007f-\u009f]/.test(clean)) throw fail('INVALID_SHARED_STATE');
    return clean;
  };
  const integer = (value) => Number.isSafeInteger(Number(value)) ? Number(value) : 0;

  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }

  function validateClassroom(value) {
    if (!value || value.version !== 1 || typeof value.serverOpen !== 'boolean') throw fail('INVALID_SHARED_STATE');
    return freeze({ version:1, serverOpen:value.serverOpen });
  }

  function validateWorkbooks(value) {
    const items = Array.isArray(value) ? value : value?.version === 1 ? value.items : null;
    if (!Array.isArray(items) || items.length > 50) throw fail('INVALID_SHARED_STATE');
    const workbookIds = new Set();
    const result = items.map((book) => {
      const id = text(book?.id, 80, true);
      if (workbookIds.has(id)) throw fail('INVALID_SHARED_STATE');
      workbookIds.add(id);
      const zone = text(book?.zone || 'silent_forest', 40, true);
      if (!ZONES.has(zone)) throw fail('INVALID_SHARED_STATE');
      if (!Array.isArray(book?.questions) || book.questions.length > 200) throw fail('INVALID_SHARED_STATE');
      const questionIds = new Set();
      const questions = book.questions.map((question) => {
        const questionId = text(question?.id, 80, true);
        if (questionIds.has(questionId)) throw fail('INVALID_SHARED_STATE');
        questionIds.add(questionId);
        const questionZone = text(question?.zone || zone, 40, true);
        if (!ZONES.has(questionZone)) throw fail('INVALID_SHARED_STATE');
        let choices = null;
        if (question?.choices != null) {
          if (!Array.isArray(question.choices) || question.choices.length > 4) throw fail('INVALID_SHARED_STATE');
          choices = question.choices.map((choice) => text(String(choice), 200));
        }
        return {
          id:questionId, workbookId:id, zone:questionZone,
          q:text(question?.q ?? question?.question, 500, true),
          answer:text(String(question?.answer ?? ''), 200, true),
          choices,
          source:text(question?.source || book?.name || '', 100),
        };
      });
      return {
        id, name:text(book?.name, 100, true), zone,
        subject:text(book?.subject || '', 80),
        prompt:text(book?.prompt || '', 500),
        enabled:book?.enabled !== false,
        createdAt:Math.max(0, integer(book?.createdAt)),
        questions,
      };
    });
    return freeze(result);
  }

  function create({ client, storage, schedule, cancelSchedule, defaultWorkbooks } = {}) {
    if (!client || typeof client.from !== 'function') throw new TypeError('shared state v2 requires a Supabase client');
    if (!storage?.getItem || !storage?.setItem) throw new TypeError('shared state v2 requires storage');
    const defaults = validateWorkbooks(defaultWorkbooks || []);
    const scheduleFn = typeof schedule === 'function' ? schedule : (fn, ms) => global.setInterval(fn, ms);
    const cancelFn = typeof cancelSchedule === 'function' ? cancelSchedule : (id) => global.clearInterval(id);
    let classroom = freeze({ version:1, serverOpen:true });
    let workbooks = defaults;
    let timer = null;

    function readCache(key, validate, fallback) {
      try {
        const raw = storage.getItem(key);
        return raw ? validate(JSON.parse(raw)) : fallback;
      } catch (_) { return fallback; }
    }
    function commit(key, value) { storage.setItem(key, JSON.stringify(value)); }
    async function readRemote(key) {
      const { data, error } = await client.from('shared_state_v2').select('data,updated_at').eq('key', key).maybeSingle();
      if (error) throw mapError(error, 'LOAD_FAILED');
      return data?.data ?? null;
    }
    async function refreshClassroomSettings() {
      try {
        const remote = await readRemote('classroom_settings');
        if (remote == null) {
          classroom = readCache(CLASSROOM_CACHE, validateClassroom, classroom);
          return freeze({ serverOpen:classroom.serverOpen, source:storage.getItem(CLASSROOM_CACHE) ? 'cache' : 'default' });
        }
        classroom = validateClassroom(remote);
        commit(CLASSROOM_CACHE, classroom);
        return freeze({ serverOpen:classroom.serverOpen, source:'remote' });
      } catch (error) {
        if (error?.code !== 'OFFLINE') throw error;
        const cached = readCache(CLASSROOM_CACHE, validateClassroom, null);
        if (cached) { classroom = cached; return freeze({ serverOpen:classroom.serverOpen, source:'cache' }); }
        classroom = freeze({ version:1, serverOpen:true });
        return freeze({ serverOpen:true, source:'default' });
      }
    }
    async function refreshWorkbooks() {
      try {
        const remote = await readRemote('workbooks');
        if (remote == null) {
          workbooks = readCache(WORKBOOK_CACHE, validateWorkbooks, defaults);
          return freeze({ workbooks, source:storage.getItem(WORKBOOK_CACHE) ? 'cache' : 'default' });
        }
        workbooks = validateWorkbooks(remote);
        commit(WORKBOOK_CACHE, { version:1, items:workbooks });
        return freeze({ workbooks, source:'remote' });
      } catch (error) {
        if (error?.code !== 'OFFLINE') throw error;
        workbooks = readCache(WORKBOOK_CACHE, validateWorkbooks, defaults);
        return freeze({ workbooks, source:storage.getItem(WORKBOOK_CACHE) ? 'cache' : 'default' });
      }
    }
    async function write(key, data) {
      const { error } = await client.from('shared_state_v2').upsert({ key, data }, { onConflict:'key' });
      if (error) throw mapError(error, 'SAVE_FAILED');
    }
    async function setServerOpen(open) {
      if (typeof open !== 'boolean') throw fail('INVALID_SHARED_STATE');
      const next = validateClassroom({ version:1, serverOpen:open });
      await write('classroom_settings', next);
      classroom = next; commit(CLASSROOM_CACHE, classroom);
    }
    async function saveWorkbooks(items) {
      const next = validateWorkbooks(items);
      await write('workbooks', { version:1, items:next });
      workbooks = next; commit(WORKBOOK_CACHE, { version:1, items:workbooks });
    }
    function setLocalWorkbooks(items) {
      workbooks = validateWorkbooks(items);
    }
    function startPolling({ onClassroomChange, onWorkbooksChange, includeWorkbooks = true } = {}) {
      if (timer !== null) return;
      timer = scheduleFn(async () => {
        const beforeOpen = classroom.serverOpen;
        const beforeBooks = JSON.stringify(workbooks);
        try {
          await refreshClassroomSettings();
          if (beforeOpen !== classroom.serverOpen) onClassroomChange?.(classroom.serverOpen);
          if (includeWorkbooks) {
            await refreshWorkbooks();
            if (beforeBooks !== JSON.stringify(workbooks)) onWorkbooksChange?.(workbooks);
          }
        } catch (_) {}
      }, 15000);
    }
    function stopPolling() { if (timer !== null) { cancelFn(timer); timer = null; } }
    return freeze({
      refreshClassroomSettings, refreshWorkbooks,
      getServerOpen:() => classroom.serverOpen,
      getWorkbooks:() => workbooks,
      saveWorkbooks, setLocalWorkbooks, setServerOpen, startPolling, stopPolling,
    });
  }

  global.YuksamSharedStateV2 = freeze({ SharedStateV2Error, validateWorkbooks, create });
})(window);
