// src/services/questionBankService.js
// Question Bank Client Service V2A (Read-Only + Authoring Create Integration)

import { supabase } from '../lib/supabase';

const QUESTION_BANK_BASE_URL = 'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/question-bank-api';

const ALLOWED_LIST_PARAMS = [
  'page',
  'page_size',
  'subject',
  'grade_level',
  'question_type',
  'difficulty',
  'status',
  'visibility',
  'search'
];

/**
 * Lấy Bearer Token an toàn từ phiên đăng nhập Supabase OLD
 * @returns {Promise<string>}
 */
export const getOldAccessToken = async () => {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.access_token) {
    throw new Error('Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.');
  }
  return sessionData.session.access_token;
};

/**
 * Lấy danh sách câu hỏi từ Question Bank BFF API (Read-Only)
 * @param {Object} filters
 * @returns {Promise<{ items: Array, total_count: number, page: number, page_size: number }>}
 */
export const listQuestions = async (filters = {}) => {
  const accessToken = await getOldAccessToken();
  const searchParams = new URLSearchParams();

  for (const key of ALLOWED_LIST_PARAMS) {
    const val = filters[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      searchParams.append(key, String(val).trim());
    }
  }

  const queryString = searchParams.toString();
  const requestUrl = `${QUESTION_BANK_BASE_URL}/qb/questions${queryString ? `?${queryString}` : ''}`;

  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  let jsonResult;
  try {
    jsonResult = await response.json();
  } catch (_err) {
    throw new Error(`Lỗi kết nối máy chủ Question Bank (HTTP ${response.status})`);
  }

  if (!response.ok || !jsonResult || jsonResult.success !== true) {
    const errorMsg = jsonResult?.message || jsonResult?.error || `Lỗi tải danh sách câu hỏi (${response.status})`;
    throw new Error(errorMsg);
  }

  return jsonResult.data || { items: [], total_count: 0, page: 1, page_size: 20 };
};

/**
 * Tạo mới một câu hỏi trong Question Bank (Authoring Create V2A)
 * @param {Object} payload Question Bank compliant payload
 * @returns {Promise<{ item_id: string, version_id: string, version_number: number }>}
 */
export const createQuestion = async (payload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Dữ liệu câu hỏi không hợp lệ.');
  }

  const accessToken = await getOldAccessToken();
  const requestUrl = `${QUESTION_BANK_BASE_URL}/qb/questions`;

  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  let jsonResult;
  try {
    jsonResult = await response.json();
  } catch (_err) {
    throw new Error(`Lỗi kết nối máy chủ khi tạo câu hỏi (HTTP ${response.status})`);
  }

  if (!response.ok || !jsonResult || jsonResult.success !== true) {
    const errorMsg = jsonResult?.message || jsonResult?.error || `Lỗi tạo câu hỏi (${response.status})`;
    throw new Error(errorMsg);
  }

  return jsonResult.data;
};

/**
 * Ẩn câu hỏi (Soft Delete / Archive) khỏi Ngân hàng câu hỏi
 * @param {string} itemId UUID của câu hỏi cần ẩn
 * @returns {Promise<{ item_id: string, status: string, message: string }>}
 */
export const archiveQuestion = async (itemId) => {
  if (!itemId || typeof itemId !== 'string') {
    throw new Error('ID câu hỏi không hợp lệ.');
  }

  const accessToken = await getOldAccessToken();
  const requestUrl = `${QUESTION_BANK_BASE_URL}/qb/questions/${encodeURIComponent(itemId)}/archive`;

  const response = await fetch(requestUrl, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  let jsonResult;
  try {
    jsonResult = await response.json();
  } catch (_err) {
    throw new Error(`Lỗi kết nối máy chủ khi ẩn câu hỏi (HTTP ${response.status})`);
  }

  if (!response.ok || !jsonResult || jsonResult.success !== true) {
    const errorMsg = jsonResult?.message || jsonResult?.error || `Lỗi khi ẩn câu hỏi (${response.status})`;
    throw new Error(errorMsg);
  }

  return jsonResult.data;
};

/**
 * Khôi phục câu hỏi đã ẩn (Archived -> Draft) trong Ngân hàng câu hỏi
 * @param {string} itemId UUID của câu hỏi cần khôi phục
 * @returns {Promise<{ item_id: string, status: string, message: string }>}
 */
export const restoreQuestion = async (itemId) => {
  if (!itemId || typeof itemId !== 'string') {
    throw new Error('ID câu hỏi không hợp lệ.');
  }

  const accessToken = await getOldAccessToken();
  const requestUrl = `${QUESTION_BANK_BASE_URL}/qb/questions/${encodeURIComponent(itemId)}/restore`;

  const response = await fetch(requestUrl, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  let jsonResult;
  try {
    jsonResult = await response.json();
  } catch (_err) {
    throw new Error(`Lỗi kết nối máy chủ khi khôi phục câu hỏi (HTTP ${response.status})`);
  }

  if (!response.ok || !jsonResult || jsonResult.success !== true) {
    const errorMsg = jsonResult?.message || jsonResult?.error || `Lỗi khi khôi phục câu hỏi (${response.status})`;
    throw new Error(errorMsg);
  }

  return jsonResult.data;
};

/**
 * Xuất bản câu hỏi (Draft -> Published) trong Ngân hàng câu hỏi
 * @param {string} itemId UUID của câu hỏi cần xuất bản
 * @returns {Promise<{ item_id: string, status: string, message: string }>}
 */
export const publishQuestion = async (itemId) => {
  if (!itemId || typeof itemId !== 'string') {
    const err = new Error('ID câu hỏi không hợp lệ.');
    err.status = 400;
    err.errorCode = 'INVALID_INPUT';
    throw err;
  }

  const accessToken = await getOldAccessToken();
  const requestUrl = `${QUESTION_BANK_BASE_URL}/qb/questions/${encodeURIComponent(itemId)}/publish`;

  const response = await fetch(requestUrl, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  let jsonResult;
  try {
    jsonResult = await response.json();
  } catch (_err) {
    const networkErr = new Error(`Lỗi kết nối máy chủ khi xuất bản câu hỏi (HTTP ${response.status})`);
    networkErr.status = response.status;
    networkErr.errorCode = null;
    throw networkErr;
  }

  if (!response.ok || !jsonResult || jsonResult.success !== true) {
    const errorMsg = jsonResult?.message || jsonResult?.error || `Lỗi khi xuất bản câu hỏi (${response.status})`;
    const structuredErr = new Error(errorMsg);
    structuredErr.status = response.status;
    structuredErr.errorCode = jsonResult?.error_code || null;
    throw structuredErr;
  }

  return jsonResult.data;
};

/**
 * Lấy lịch sử phiên bản của một câu hỏi (Version History V2.1)
 * @param {string} itemId UUID của câu hỏi
 * @returns {Promise<{ item_id: string, current_version_id: string, total_versions: number, versions: Array }>}
 */
export const listQuestionVersions = async (itemId) => {
  if (!itemId || typeof itemId !== 'string') {
    const err = new Error('ID câu hỏi không hợp lệ.');
    err.status = 400;
    err.errorCode = 'INVALID_INPUT';
    throw err;
  }

  const accessToken = await getOldAccessToken();
  const requestUrl = `${QUESTION_BANK_BASE_URL}/qb/questions/${encodeURIComponent(itemId)}/versions`;

  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  let jsonResult;
  try {
    jsonResult = await response.json();
  } catch (_err) {
    const networkErr = new Error(`Lỗi kết nối máy chủ khi tải lịch sử phiên bản (HTTP ${response.status})`);
    networkErr.status = response.status;
    networkErr.errorCode = null;
    throw networkErr;
  }

  if (!response.ok || !jsonResult || jsonResult.success !== true) {
    const errorMsg = jsonResult?.message || jsonResult?.error || `Lỗi tải lịch sử phiên bản (${response.status})`;
    const structuredErr = new Error(errorMsg);
    structuredErr.status = response.status;
    structuredErr.errorCode = jsonResult?.error_code || null;
    throw structuredErr;
  }

  return jsonResult.data;
};

/**
 * Lấy chi tiết soạn thảo câu hỏi theo phiên bản cụ thể hoặc phiên bản hiện tại (Authoring Safe Detail)
 * @param {string} itemId UUID của câu hỏi
 * @param {string} [versionId] UUID của phiên bản cụ thể (tùy chọn)
 * @returns {Promise<{ projection: string, item: Object, version: Object, answer_key: Object }>}
 */
export const getQuestionAuthoringDetail = async (itemId, versionId) => {
  if (!itemId || typeof itemId !== 'string') {
    const err = new Error('ID câu hỏi không hợp lệ.');
    err.status = 400;
    err.errorCode = 'INVALID_INPUT';
    throw err;
  }

  const accessToken = await getOldAccessToken();
  const searchParams = new URLSearchParams();
  if (versionId && typeof versionId === 'string' && versionId.trim() !== '') {
    searchParams.append('version_id', versionId.trim());
  }

  const queryString = searchParams.toString();
  const requestUrl = `${QUESTION_BANK_BASE_URL}/qb/authoring/questions/${encodeURIComponent(itemId)}${queryString ? `?${queryString}` : ''}`;

  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  let jsonResult;
  try {
    jsonResult = await response.json();
  } catch (_err) {
    const networkErr = new Error(`Lỗi kết nối máy chủ khi lấy chi tiết câu hỏi (HTTP ${response.status})`);
    networkErr.status = response.status;
    networkErr.errorCode = null;
    throw networkErr;
  }

  if (!response.ok || !jsonResult || jsonResult.success !== true) {
    const errorMsg = jsonResult?.message || jsonResult?.error || `Lỗi lấy chi tiết câu hỏi (${response.status})`;
    const structuredErr = new Error(errorMsg);
    structuredErr.status = response.status;
    structuredErr.errorCode = jsonResult?.error_code || null;
    throw structuredErr;
  }

  return jsonResult.data;
};

/**
 * Cập nhật chế độ hiển thị / chia sẻ của câu hỏi (Teacher Publish Sharing Hotfix V1)
 * @param {string} itemId UUID của câu hỏi
 * @param {'private' | 'public_template'} visibility Chế độ hiển thị cho phép
 * @returns {Promise<{ item_id: string, message: string }>}
 */
export const updateQuestionVisibility = async (itemId, visibility) => {
  if (!itemId || typeof itemId !== 'string') {
    const err = new Error('ID câu hỏi không hợp lệ.');
    err.status = 400;
    err.errorCode = 'INVALID_INPUT';
    throw err;
  }

  if (visibility !== 'private' && visibility !== 'public_template') {
    const err = new Error('Chế độ hiển thị không hợp lệ. Chỉ chấp nhận private hoặc public_template.');
    err.status = 400;
    err.errorCode = 'INVALID_INPUT';
    throw err;
  }

  const accessToken = await getOldAccessToken();
  const requestUrl = `${QUESTION_BANK_BASE_URL}/qb/questions/${encodeURIComponent(itemId)}/metadata`;

  const response = await fetch(requestUrl, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ visibility })
  });

  let jsonResult;
  try {
    jsonResult = await response.json();
  } catch (_err) {
    const networkErr = new Error(`Lỗi kết nối máy chủ khi cập nhật chế độ hiển thị (HTTP ${response.status})`);
    networkErr.status = response.status;
    networkErr.errorCode = null;
    throw networkErr;
  }

  if (!response.ok || !jsonResult || jsonResult.success !== true) {
    const errorMsg = jsonResult?.message || jsonResult?.error || `Lỗi khi cập nhật chế độ hiển thị (${response.status})`;
    const structuredErr = new Error(errorMsg);
    structuredErr.status = response.status;
    structuredErr.errorCode = jsonResult?.error_code || null;
    throw structuredErr;
  }

  return jsonResult.data;
};

export const questionBankService = {
  getOldAccessToken,
  listQuestions,
  createQuestion,
  archiveQuestion,
  restoreQuestion,
  publishQuestion,
  updateQuestionVisibility,
  listQuestionVersions,
  getQuestionAuthoringDetail
};

export default questionBankService;


