// src/services/examManagementClient.js
// Exam Builder V1 Management API Client (Admin & Teacher Authoring + Assignment BFF Transport)

async function getDefaultSupabaseClient() {
  try {
    const mod = await import('../lib/supabase.js');
    return mod.supabase;
  } catch (_) {
    return null;
  }
}

export const EXAM_MANAGEMENT_API_BASE_URL =
  'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/exam-management-api';

export const EXAM_GRADE_MANUAL_BASE_URL =
  'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/exam-grade-manual-attempt';

export const EXAM_UPDATE_GRADED_FEEDBACK_BASE_URL =
  'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/exam-update-graded-feedback';

export class ExamManagementClient {
  constructor(options = {}) {
    this.supabase = options.supabase || null;
    this.baseUrl = options.baseUrl || EXAM_MANAGEMENT_API_BASE_URL;
    this.gradeManualUrl = options.gradeManualUrl || EXAM_GRADE_MANUAL_BASE_URL;
    this.updateFeedbackUrl = options.updateFeedbackUrl || EXAM_UPDATE_GRADED_FEEDBACK_BASE_URL;
    this.invokeFunction = options.invokeFunction || null;
  }


  /**
   * Lấy Bearer Access Token an toàn từ Supabase session
   */
  async getAccessToken() {
    let client = this.supabase;
    if (!client) {
      client = await getDefaultSupabaseClient();
    }
    if (!client || !client.auth) {
      throw new Error('Supabase client chưa được khởi tạo.');
    }
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.access_token) {
      throw new Error('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    }
    return data.session.access_token;
  }

  /**
   * Thực hiện HTTP request đến Edge Function BFF
   */
  async dispatch(action, method = 'POST', payload = null, queryParams = {}) {
    try {
      // 1. Kiểm tra nếu có mock transport được inject (dành cho Unit Testing)
      if (typeof this.invokeFunction === 'function') {
        const result = await this.invokeFunction({
          action,
          method,
          payload,
          queryParams,
        });
        return result;
      }

      // 2. Lấy Token xác thực CORE JWT
      const token = await this.getAccessToken();

      // 3. Xây dựng URL
      const url = new URL(`${this.baseUrl}/${action}`);
      Object.entries(queryParams).forEach(([key, val]) => {
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          url.searchParams.set(key, String(val).trim());
        }
      });

      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      };

      const options = {
        method,
        headers,
      };

      if (method !== 'GET' && method !== 'HEAD' && payload) {
        options.body = JSON.stringify(payload);
      }

      const response = await fetch(url.toString(), options);
      let jsonResult;
      try {
        jsonResult = await response.json();
      } catch (_) {
        return {
          ok: false,
          error: {
            status: response.status,
            errorCode: 'INVALID_JSON_RESPONSE',
            message: 'Phản hồi từ máy chủ không phải là JSON hợp lệ.',
          },
        };
      }

      if (!response.ok || jsonResult?.success === false) {
        return {
          ok: false,
          error: {
            status: response.status,
            errorCode: jsonResult?.error_code || 'REQUEST_FAILED',
            message: jsonResult?.message || 'Yêu cầu không thành công.',
          },
        };
      }

      return {
        ok: true,
        data: jsonResult?.data,
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          status: 0,
          errorCode: 'NETWORK_ERROR',
          message: err?.message || 'Không thể kết nối đến máy chủ quản lý đề thi.',
        },
      };
    }
  }

  /**
   * Lấy danh sách đề thi (Admin: toàn trường; Teacher: đề do mình tạo)
   */
  async listTests() {
    return await this.dispatch('list-tests', 'GET');
  }

  /**
   * Lấy chi tiết đề thi & phiên bản câu hỏi để phục vụ soạn thảo
   */
  async getTestDetail({ examId, versionId }) {
    return await this.dispatch('get-test-detail', 'GET', null, {
      exam_id: examId,
      version_id: versionId,
    });
  }

  /**
   * Tạo mới đề thi container & draft version v1
   */
  async createTest(payload) {
    return await this.dispatch('create-test', 'POST', payload);
  }

  /**
   * Xóa vĩnh viễn đề thi nháp hoặc Lưu trữ (Archive) an toàn đề thi đã dùng/xuất bản
   * @param {{ examId: string }} params
   */
  async deleteTest({ examId }) {
    return await this.dispatch('delete-test', 'POST', {
      exam_id: examId,
    });
  }

  /**
   * Lưu bản nháp đề thi kèm câu hỏi & lịch thi linh hoạt
   */
  async saveDraft(payload) {
    return await this.dispatch('save-draft', 'POST', payload);
  }

  /**
   * Xuất bản phiên bản đề thi
   */
  async publishVersion(payload) {
    return await this.dispatch('publish', 'POST', payload);
  }

  /**
   * Giao đề thi đã xuất bản cho lớp học (Server-Side kiểm tra quyền sở hữu lớp)
   */
  async createAssignment(payload) {
    return await this.dispatch('create-assignment', 'POST', payload);
  }

  /**
   * Tải danh sách lượt làm bài của đề thi/phiên bản (Admin hoặc Giáo viên có quyền)
   */
  async listExamAttempts({ examId, versionId, classId } = {}) {
    return await this.dispatch('list-exam-attempts', 'GET', null, {
      exam_id: examId,
      version_id: versionId,
      class_id: classId,
    });
  }

  /**
   * Tải chi tiết bài làm của một lượt thi để phục vụ chấm bài / xem chi tiết
   */
  async getAttemptDetail({ attemptId } = {}) {
    return await this.dispatch('get-attempt-detail', 'GET', null, {
      attempt_id: attemptId,
    });
  }

  /**
   * Chấm điểm thủ công bài thi tự luận thông qua Edge Function exam-grade-manual-attempt
   */
  async gradeManualAttempt(payload) {
    try {
      if (typeof this.invokeFunction === 'function') {
        return await this.invokeFunction({
          action: 'grade-manual-attempt',
          method: 'POST',
          payload,
        });
      }

      const token = await this.getAccessToken();
      const url = this.gradeManualUrl || EXAM_GRADE_MANUAL_BASE_URL;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      let jsonResult;
      try {
        jsonResult = await response.json();
      } catch (_) {
        return {
          ok: false,
          error: {
            status: response.status,
            errorCode: 'INVALID_JSON_RESPONSE',
            message: 'Phản hồi từ máy chủ chấm điểm không phải là JSON hợp lệ.',
          },
        };
      }

      if (!response.ok || jsonResult?.success === false) {
        return {
          ok: false,
          error: {
            status: response.status,
            errorCode: jsonResult?.error_code || 'REQUEST_FAILED',
            message: jsonResult?.message || 'Chấm bài không thành công.',
          },
        };
      }

      return {
        ok: true,
        data: jsonResult?.data,
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          status: 0,
          errorCode: 'NETWORK_ERROR',
          message: err?.message || 'Không thể kết nối đến máy chủ chấm điểm.',
        },
      };
    }
  }

  /**
   * Cập nhật nhận xét cho bài thi đã hoàn tất chấm điểm (status = 'graded')
   */
  async updateGradedFeedback(payload) {
    try {
      if (typeof this.invokeFunction === 'function') {
        return await this.invokeFunction({
          action: 'update-graded-feedback',
          method: 'POST',
          payload,
        });
      }

      const token = await this.getAccessToken();
      const url = this.updateFeedbackUrl || EXAM_UPDATE_GRADED_FEEDBACK_BASE_URL;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      let jsonResult;
      try {
        jsonResult = await response.json();
      } catch (_) {
        return {
          ok: false,
          error: {
            status: response.status,
            errorCode: 'INVALID_JSON_RESPONSE',
            message: 'Phản hồi từ máy chủ cập nhật nhận xét không phải là JSON hợp lệ.',
          },
        };
      }

      if (!response.ok || jsonResult?.success === false) {
        return {
          ok: false,
          error: {
            status: response.status,
            errorCode: jsonResult?.error_code || 'REQUEST_FAILED',
            message: jsonResult?.message || 'Cập nhật nhận xét không thành công.',
          },
        };
      }

      return {
        ok: true,
        data: jsonResult?.data,
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          status: 0,
          errorCode: 'NETWORK_ERROR',
          message: err?.message || 'Không thể kết nối đến máy chủ cập nhật nhận xét.',
        },
      };
    }
  }

  /**
   * Nhập câu hỏi từ Ngân hàng câu hỏi vào bản nháp đề thi
   * @param {Object} params
   * @param {string} [params.versionId]
   * @param {string} [params.examId]
   * @param {string[]} params.questionBankItemIds
   */
  async importQuestionsFromQuestionBank({ versionId, examId, questionBankItemIds }) {
    return await this.dispatch('import-question-bank-items', 'POST', {
      version_id: versionId || null,
      exam_id: examId || null,
      question_bank_item_ids: Array.isArray(questionBankItemIds) ? questionBankItemIds : [],
    });
  }
}

export function createExamManagementClient(options = {}) {
  return new ExamManagementClient(options);
}


