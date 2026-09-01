// src/services/questionBankService.js
// Question Bank Client Service V1 (Read-Only API Integration)

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
 * Lấy danh sách câu hỏi từ Question Bank BFF API (Read-Only)
 * @param {Object} filters
 * @returns {Promise<{ items: Array, total_count: number, page: number, page_size: number }>}
 */
export const listQuestions = async (filters = {}) => {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.access_token) {
    throw new Error('Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.');
  }

  const accessToken = sessionData.session.access_token;
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

export const questionBankService = {
  listQuestions
};

export default questionBankService;
