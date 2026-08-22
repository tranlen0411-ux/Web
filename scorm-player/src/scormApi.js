/**
 * SCORM 1.2 and SCORM 2004 In-Memory Runtime API Bridge
 * Tương thích tiêu chuẩn ADL SCORM, lưu trữ trạng thái phiên trong bộ nhớ (RAM/Session)
 */

export function createScorm12Api(initialData = {}) {
  let isInitialized = false;
  let isTerminated = false;
  let lastError = '0';

  // Khởi tạo CMI Data Model mặc định cho SCORM 1.2
  const cmi = {
    'cmi.core.student_id': initialData.studentId || 'STUDENT_001',
    'cmi.core.student_name': initialData.studentName || 'Học sinh',
    'cmi.core.lesson_location': '',
    'cmi.core.credit': 'credit',
    'cmi.core.lesson_status': 'not attempted',
    'cmi.core.entry': 'ab-initio',
    'cmi.core.score.raw': '',
    'cmi.core.score.min': '0',
    'cmi.core.score.max': '100',
    'cmi.core.total_time': '00:00:00',
    'cmi.core.lesson_mode': 'normal',
    'cmi.core.exit': '',
    'cmi.core.session_time': '00:00:00',
    'cmi.suspend_data': '',
    'cmi.launch_data': '',
    'cmi.comments': '',
    'cmi.comments_from_lms': '',
  };

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

  return {
    LMSInitialize(param = '') {
      if (isInitialized) {
        lastError = '101';
        return 'false';
      }
      isInitialized = true;
      isTerminated = false;
      lastError = '0';
      console.log('[SCORM 1.2 API] LMSInitialize called');
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
      return 'true';
    },

    LMSGetValue(element) {
      if (!isInitialized || isTerminated) {
        lastError = '301';
        return '';
      }
      lastError = '0';
      if (element in cmi) {
        return cmi[element] || '';
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
      console.log('[SCORM 1.2 API] LMSCommit state saved to session');
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
  };
}

export function createScorm2004Api(initialData = {}) {
  let isInitialized = false;
  let isTerminated = false;
  let lastError = '0';

  // Khởi tạo CMI Data Model mặc định cho SCORM 2004 (v3 / v4)
  const cmi = {
    'cmi._version': '1.0',
    'cmi.learner_id': initialData.studentId || 'STUDENT_001',
    'cmi.learner_name': initialData.studentName || 'Học sinh',
    'cmi.location': '',
    'cmi.completion_status': 'unknown',
    'cmi.completion_threshold': '1.0',
    'cmi.success_status': 'unknown',
    'cmi.score.raw': '',
    'cmi.score.min': '0',
    'cmi.score.max': '100',
    'cmi.score.scaled': '',
    'cmi.total_time': 'PT0H0M0S',
    'cmi.session_time': 'PT0H0M0S',
    'cmi.mode': 'normal',
    'cmi.credit': 'credit',
    'cmi.entry': 'ab-initio',
    'cmi.exit': '',
    'cmi.suspend_data': '',
    'cmi.launch_data': '',
  };

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

  return {
    Initialize(param = '') {
      if (isInitialized) {
        lastError = '103';
        return 'false';
      }
      isInitialized = true;
      isTerminated = false;
      lastError = '0';
      console.log('[SCORM 2004 API] Initialize called');
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
      if (element in cmi) {
        return cmi[element] || '';
      }
      return '';
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
      console.log('[SCORM 2004 API] Commit state saved to session');
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
  };
}
