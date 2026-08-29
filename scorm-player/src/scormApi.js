/**
 * SCORM 1.2 and SCORM 2004 In-Memory Runtime API Bridge with CMI Persistence Support
 * Tương thích tiêu chuẩn ADL SCORM, hỗ trợ nạp lại trạng thái (Resume) và lưu trữ tiến độ (Commit).
 */

export function createScorm12Api(initialData = {}, onCommitCallback = null) {
  let isInitialized = false;
  let isTerminated = false;
  let lastError = '0';

  const persisted = initialData.tracking || initialData.persistedState || {};

  // Khởi tạo CMI Data Model mặc định cho SCORM 1.2
  const cmi = {
    'cmi.core.student_id': initialData.studentId || 'STUDENT_001',
    'cmi.core.student_name': initialData.studentName || 'Học sinh',
    'cmi.core.lesson_location': persisted.lesson_location || persisted['cmi.core.lesson_location'] || '',
    'cmi.core.credit': 'credit',
    'cmi.core.lesson_status': persisted.lesson_status || persisted['cmi.core.lesson_status'] || 'not attempted',
    'cmi.core.entry': (persisted.lesson_location || persisted.suspend_data) ? 'resume' : 'ab-initio',
    'cmi.core.score.raw': persisted.score_raw !== undefined && persisted.score_raw !== null ? String(persisted.score_raw) : (persisted['cmi.core.score.raw'] || ''),
    'cmi.core.score.min': persisted.score_min !== undefined && persisted.score_min !== null ? String(persisted.score_min) : (persisted['cmi.core.score.min'] || '0'),
    'cmi.core.score.max': persisted.score_max !== undefined && persisted.score_max !== null ? String(persisted.score_max) : (persisted['cmi.core.score.max'] || '100'),
    'cmi.core.total_time': persisted.total_time || persisted['cmi.core.total_time'] || '0000:00:00',
    'cmi.core.lesson_mode': 'normal',
    'cmi.core.exit': '',
    'cmi.core.session_time': '00:00:00',
    'cmi.suspend_data': persisted.suspend_data || persisted['cmi.suspend_data'] || '',
    'cmi.launch_data': '',
    'cmi.comments': '',
    'cmi.comments_from_lms': '',
  };

  // Nạp thêm các trường bổ sung từ cmi_data nếu có (giữ lại suspend_data, location, score, interactions...)
  if (persisted.cmi_data && typeof persisted.cmi_data === 'object') {
    Object.assign(cmi, persisted.cmi_data);
  }

  // Tái thiết lập các trường vòng đời cho phiên học mới (Session Lifecycle Reset)
  const hasProgress12 = Boolean(
    cmi['cmi.core.lesson_location'] ||
    cmi['cmi.suspend_data'] ||
    persisted.lesson_location ||
    persisted.suspend_data
  );
  cmi['cmi.core.entry'] = hasProgress12 ? 'resume' : 'ab-initio';
  cmi['cmi.core.exit'] = '';
  cmi['cmi.core.session_time'] = '00:00:00';

  const errorMessages = {
    '0': 'No error',
    '101': 'General exception',
    '201': 'Invalid argument error',
    '301': 'Not initialized',
    '401': 'Not implemented error',
    '402': 'Invalid set value, element is a keyword',
    '403': 'Element is read only',
    '404': 'Element is write only',
    '405': 'Incorrect Data Type',
  };

  function triggerCommit(eventType) {
    if (typeof onCommitCallback === 'function') {
      try {
        const snapshot = { ...cmi };
        onCommitCallback(snapshot, eventType);
      } catch (err) {
        console.warn('[SCORM 1.2 API] Background commit notification caught error:', err.message);
      }
    }
  }

  return {
    LMSInitialize(param = '') {
      if (isInitialized) {
        lastError = '101';
        return 'false';
      }
      isInitialized = true;
      isTerminated = false;
      lastError = '0';
      console.log('[SCORM 1.2 API] LMSInitialize called. Entry mode:', cmi['cmi.core.entry']);
      return 'true';
    },

    LMSFinish(param = '') {
      if (!isInitialized || isTerminated) {
        lastError = '301';
        return 'false';
      }
      isTerminated = true;
      lastError = '0';
      console.log('[SCORM 1.2 API] LMSFinish called. Final CMI status:', cmi['cmi.core.lesson_status']);
      triggerCommit('FINISH');
      return 'true';
    },

    LMSGetValue(element) {
      if (!isInitialized || isTerminated) {
        lastError = '301';
        return '';
      }
      lastError = '0';
      if (element in cmi) {
        return cmi[element] !== undefined && cmi[element] !== null ? String(cmi[element]) : '';
      }
      return '';
    },

    LMSSetValue(element, value) {
      if (!isInitialized || isTerminated) {
        lastError = '301';
        return 'false';
      }
      lastError = '0';
      cmi[element] = String(value);
      return 'true';
    },

    LMSCommit(param = '') {
      if (!isInitialized || isTerminated) {
        lastError = '301';
        return 'false';
      }
      lastError = '0';
      console.log('[SCORM 1.2 API] LMSCommit state triggered');
      triggerCommit('COMMIT');
      return 'true';
    },

    LMSGetLastError() {
      return lastError;
    },

    LMSGetErrorString(errorCode) {
      return errorMessages[errorCode] || 'Unknown error';
    },

    LMSGetDiagnostic(errorCode) {
      return `SCORM 1.2 Diagnostic: Error ${errorCode} - ${errorMessages[errorCode] || 'No diagnostic info'}`;
    },

    _getCmi() {
      return { ...cmi };
    },

    _restoreCmi(newTracking) {
      if (!newTracking || typeof newTracking !== 'object') return;
      const t = newTracking;
      if (t.lesson_location || t['cmi.core.lesson_location']) {
        cmi['cmi.core.lesson_location'] = t.lesson_location || t['cmi.core.lesson_location'];
      }
      if (t.suspend_data || t['cmi.suspend_data']) {
        cmi['cmi.suspend_data'] = t.suspend_data || t['cmi.suspend_data'];
      }
      if (t.lesson_status || t['cmi.core.lesson_status']) {
        cmi['cmi.core.lesson_status'] = t.lesson_status || t['cmi.core.lesson_status'];
      }
      if (t.score_raw !== undefined && t.score_raw !== null) {
        cmi['cmi.core.score.raw'] = String(t.score_raw);
      }
      if (t.score_min !== undefined && t.score_min !== null) {
        cmi['cmi.core.score.min'] = String(t.score_min);
      }
      if (t.score_max !== undefined && t.score_max !== null) {
        cmi['cmi.core.score.max'] = String(t.score_max);
      }
      if (t.total_time || t['cmi.core.total_time']) {
        cmi['cmi.core.total_time'] = t.total_time || t['cmi.core.total_time'];
      }
      if (t.cmi_data && typeof t.cmi_data === 'object') {
        Object.assign(cmi, t.cmi_data);
      }
      const hasProgress = Boolean(
        cmi['cmi.core.lesson_location'] ||
        cmi['cmi.suspend_data'] ||
        t.lesson_location ||
        t.suspend_data
      );
      cmi['cmi.core.entry'] = hasProgress ? 'resume' : 'ab-initio';
      cmi['cmi.core.exit'] = '';
      cmi['cmi.core.session_time'] = '00:00:00';
    },
  };
}

export function createScorm2004Api(initialData = {}, onCommitCallback = null) {
  let isInitialized = false;
  let isTerminated = false;
  let lastError = '0';

  const persisted = initialData.tracking || initialData.persistedState || {};

  // Khởi tạo CMI Data Model mặc định cho SCORM 2004 (v3 / v4)
  const cmi = {
    'cmi._version': '1.0',
    'cmi.learner_id': initialData.studentId || 'STUDENT_001',
    'cmi.learner_name': initialData.studentName || 'Học sinh',
    'cmi.location': persisted.lesson_location || persisted.location || persisted['cmi.location'] || '',
    'cmi.completion_status': persisted.completion_status || persisted['cmi.completion_status'] || 'unknown',
    'cmi.completion_threshold': '1.0',
    'cmi.success_status': persisted.success_status || persisted['cmi.success_status'] || 'unknown',
    'cmi.score.raw': persisted.score_raw !== undefined && persisted.score_raw !== null ? String(persisted.score_raw) : (persisted['cmi.score.raw'] || ''),
    'cmi.score.min': persisted.score_min !== undefined && persisted.score_min !== null ? String(persisted.score_min) : (persisted['cmi.score.min'] || '0'),
    'cmi.score.max': persisted.score_max !== undefined && persisted.score_max !== null ? String(persisted.score_max) : (persisted['cmi.score.max'] || '100'),
    'cmi.score.scaled': '',
    'cmi.total_time': persisted.total_time || persisted['cmi.total_time'] || 'PT0H0M0S',
    'cmi.session_time': 'PT0H0M0S',
    'cmi.mode': 'normal',
    'cmi.credit': 'credit',
    'cmi.entry': (persisted.lesson_location || persisted.location || persisted.suspend_data) ? 'resume' : 'ab-initio',
    'cmi.exit': '',
    'cmi.suspend_data': persisted.suspend_data || persisted['cmi.suspend_data'] || '',
    'cmi.launch_data': '',
  };

  // Nạp thêm các trường bổ sung từ cmi_data nếu có (giữ lại suspend_data, location, score, interactions...)
  if (persisted.cmi_data && typeof persisted.cmi_data === 'object') {
    Object.assign(cmi, persisted.cmi_data);
  }

  // Tái thiết lập các trường vòng đời cho phiên học mới (Session Lifecycle Reset)
  const hasProgress2004 = Boolean(
    cmi['cmi.location'] ||
    cmi['cmi.suspend_data'] ||
    persisted.lesson_location ||
    persisted.location ||
    persisted.suspend_data
  );
  cmi['cmi.entry'] = hasProgress2004 ? 'resume' : 'ab-initio';
  cmi['cmi.exit'] = '';
  cmi['cmi.session_time'] = 'PT0H0M0S';

  const errorMessages = {
    '0': 'No error',
    '101': 'General exception',
    '102': 'General Initialization Failure',
    '103': 'Already Initialized',
    '111': 'General Termination Failure',
    '112': 'Termination Before Initialization',
    '113': 'Termination After Termination',
    '122': 'Retrieve Data Before Initialization',
    '123': 'Retrieve Data After Termination',
    '132': 'Store Data Before Initialization',
    '133': 'Store Data After Termination',
    '142': 'Commit Before Initialization',
    '143': 'Commit After Termination',
    '401': 'Undefined Data Model',
    '402': 'Unimplemented Data Model',
  };

  function triggerCommit(eventType) {
    if (typeof onCommitCallback === 'function') {
      try {
        const snapshot = { ...cmi };
        onCommitCallback(snapshot, eventType);
      } catch (err) {
        console.warn('[SCORM 2004 API] Background commit notification caught error:', err.message);
      }
    }
  }

  return {
    Initialize(param = '') {
      if (isInitialized) {
        lastError = '103';
        return 'false';
      }
      isInitialized = true;
      isTerminated = false;
      lastError = '0';
      console.log('[SCORM 2004 API] Initialize called. Entry mode:', cmi['cmi.entry']);
      console.log(`[SCORM DIAG] Initialize entry=${cmi['cmi.entry']}`);
      return 'true';
    },

    Terminate(param = '') {
      if (!isInitialized) {
        lastError = '112';
        return 'false';
      }
      if (isTerminated) {
        lastError = '113';
        return 'false';
      }
      isTerminated = true;
      lastError = '0';
      console.log('[SCORM 2004 API] Terminate called. Final completion_status:', cmi['cmi.completion_status']);
      triggerCommit('TERMINATE');
      return 'true';
    },

    GetValue(element) {
      if (!isInitialized) {
        lastError = '122';
        return '';
      }
      if (isTerminated) {
        lastError = '123';
        return '';
      }
      lastError = '0';
      let val = '';
      if (element in cmi) {
        val = cmi[element] !== undefined && cmi[element] !== null ? String(cmi[element]) : '';
      }

      if (element === 'cmi.entry') {
        console.log(`[SCORM DIAG] GetValue cmi.entry=${val}`);
      } else if (element === 'cmi.suspend_data') {
        console.log(`[SCORM DIAG] GetValue cmi.suspend_data length=${val.length}`);
      } else if (element === 'cmi.location') {
        console.log(`[SCORM DIAG] GetValue cmi.location=${val}`);
      }

      return val;
    },

    SetValue(element, value) {
      if (!isInitialized) {
        lastError = '132';
        return 'false';
      }
      if (isTerminated) {
        lastError = '133';
        return 'false';
      }
      lastError = '0';
      cmi[element] = String(value);
      return 'true';
    },

    Commit(param = '') {
      if (!isInitialized) {
        lastError = '142';
        return 'false';
      }
      if (isTerminated) {
        lastError = '143';
        return 'false';
      }
      lastError = '0';
      console.log('[SCORM 2004 API] Commit state triggered');
      triggerCommit('COMMIT');
      return 'true';
    },

    GetLastError() {
      return lastError;
    },

    GetErrorString(errorCode) {
      return errorMessages[errorCode] || 'Unknown error';
    },

    GetDiagnostic(errorCode) {
      return `SCORM 2004 Diagnostic: Error ${errorCode} - ${errorMessages[errorCode] || 'No diagnostic info'}`;
    },

    _getCmi() {
      return { ...cmi };
    },

    _restoreCmi(newTracking) {
      if (!newTracking || typeof newTracking !== 'object') return;
      const t = newTracking;
      if (t.lesson_location || t.location || t['cmi.location']) {
        cmi['cmi.location'] = t.lesson_location || t.location || t['cmi.location'];
      }
      if (t.suspend_data || t['cmi.suspend_data']) {
        cmi['cmi.suspend_data'] = t.suspend_data || t['cmi.suspend_data'];
      }
      if (t.completion_status || t['cmi.completion_status']) {
        cmi['cmi.completion_status'] = t.completion_status || t['cmi.completion_status'];
      }
      if (t.success_status || t['cmi.success_status']) {
        cmi['cmi.success_status'] = t.success_status || t['cmi.success_status'];
      }
      if (t.score_raw !== undefined && t.score_raw !== null) {
        cmi['cmi.score.raw'] = String(t.score_raw);
      }
      if (t.score_min !== undefined && t.score_min !== null) {
        cmi['cmi.score.min'] = String(t.score_min);
      }
      if (t.score_max !== undefined && t.score_max !== null) {
        cmi['cmi.score.max'] = String(t.score_max);
      }
      if (t.total_time || t['cmi.total_time']) {
        cmi['cmi.total_time'] = t.total_time || t['cmi.total_time'];
      }
      if (t.cmi_data && typeof t.cmi_data === 'object') {
        Object.assign(cmi, t.cmi_data);
      }
      const hasProgress = Boolean(
        cmi['cmi.location'] ||
        cmi['cmi.suspend_data'] ||
        t.lesson_location ||
        t.location ||
        t.suspend_data
      );
      cmi['cmi.entry'] = hasProgress ? 'resume' : 'ab-initio';
      cmi['cmi.exit'] = '';
      cmi['cmi.session_time'] = 'PT0H0M0S';
    },
  };
}
