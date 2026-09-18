// src/services/submissionAnnotationClient.js
// Client API Service cho tính năng Nộp nhiều ảnh bài làm & Chấm điểm Annotation (Phase 1)
// Tương thích kiến trúc Clean Code & Supabase Client

import { supabase } from '../lib/supabase';

/**
 * Khởi tạo lượt đính kèm tệp cho học sinh
 * @param {Object} params
 * @param {string} params.submissionId - UUID bài nộp draft
 * @param {string} params.questionId - UUID câu hỏi
 * @param {string} params.originalFileName - Tên tệp gốc
 * @param {string} params.mimeType - 'image/jpeg' | 'image/png' | 'image/webp'
 * @param {number} params.byteSize - Dung lượng (bytes, max 10MB)
 * @param {number} [params.sortOrder=0] - Thứ tự ảnh
 * @returns {Promise<{ ok: boolean, data?: any, error?: any }>}
 */
export async function prepareSubmissionAttachment({
  submissionId,
  questionId,
  originalFileName,
  mimeType,
  byteSize,
  sortOrder = 0,
}) {
  try {
    const { data, error } = await supabase.rpc('prepare_academic_submission_attachment', {
      p_submission_id: submissionId,
      p_question_id: questionId,
      p_original_file_name: originalFileName,
      p_mime_type: mimeType,
      p_byte_size: byteSize,
      p_sort_order: sortOrder,
    });

    if (error) return { ok: false, error };
    if (!data?.success) return { ok: false, error: new Error(data?.message || 'Lỗi khởi tạo tệp đính kèm') };

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err };
  }
}

/**
 * Hoàn tất xác nhận tệp đã upload thành công vào Storage
 * @param {Object} params
 * @param {string} params.attachmentId - UUID attachment
 * @param {number} [params.width] - Chiều rộng ảnh (pixels)
 * @param {number} [params.height] - Chiều cao ảnh (pixels)
 * @param {string} [params.sha256] - Hash kiểm tra toàn vẹn
 * @returns {Promise<{ ok: boolean, data?: any, error?: any }>}
 */
export async function finalizeSubmissionAttachment({
  attachmentId,
  width = null,
  height = null,
  sha256 = null,
}) {
  try {
    const { data, error } = await supabase.rpc('finalize_academic_submission_attachment', {
      p_attachment_id: attachmentId,
      p_width: width,
      p_height: height,
      p_sha256: sha256,
    });

    if (error) return { ok: false, error };
    if (!data?.success) return { ok: false, error: new Error(data?.message || 'Lỗi hoàn tất tệp đính kèm') };

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err };
  }
}

/**
 * Lấy toàn bộ không gian làm việc chấm bài (Workspace) cho giáo viên/admin
 * @param {Object} params
 * @param {string} params.submissionId - UUID bài nộp
 * @returns {Promise<{ ok: boolean, data?: any, error?: any }>}
 */
export async function getGradingWorkspace({ submissionId }) {
  try {
    const { data, error } = await supabase.rpc('get_academic_submission_grading_workspace', {
      p_submission_id: submissionId,
    });

    if (error) return { ok: false, error };
    if (!data?.success) return { ok: false, error: new Error(data?.message || 'Lỗi tải workspace chấm bài') };

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err };
  }
}

/**
 * Lưu bản nháp Annotation (Optimistic Concurrency Control)
 * @param {Object} params
 * @param {string} params.attachmentId - UUID attachment
 * @param {Object} params.annotationJson - Dữ liệu vector/JSON nét vẽ
 * @param {number} params.expectedVersion - Version kỳ vọng (bắt buộc để chống ghi đè)
 * @param {string} params.idempotencyKey - UUID chống trùng lặp
 * @param {number} [params.schemaVersion=1] - Version cấu trúc annotation
 * @param {string} [params.renderedPreviewPath=null] - Đường dẫn preview nếu có
 * @returns {Promise<{ ok: boolean, data?: any, error?: any, isConflict?: boolean }>}
 */
export async function saveAnnotationDraft({
  attachmentId,
  annotationJson,
  expectedVersion,
  idempotencyKey,
  schemaVersion = 1,
  renderedPreviewPath = null,
}) {
  try {
    const { data, error } = await supabase.rpc('save_academic_submission_annotation_draft', {
      p_attachment_id: attachmentId,
      p_annotation_json: annotationJson,
      p_expected_version: expectedVersion,
      p_idempotency_key: idempotencyKey,
      p_schema_version: schemaVersion,
      p_rendered_preview_path: renderedPreviewPath,
    });

    if (error) return { ok: false, error };
    if (!data?.success) {
      const isConflict = data?.error === 'VERSION_CONFLICT';
      return { ok: false, error: new Error(data?.message || 'Lỗi lưu bản nháp annotation'), isConflict, data };
    }

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err };
  }
}

/**
 * Hoàn tất chấm điểm bài nộp và lưu các phiên bản annotation chính thức (Atomic Finalize)
 * @param {Object} params
 * @param {string} params.submissionId - UUID bài nộp
 * @param {Array<{ question_id: string, points_earned: number, teacher_comment?: string }>} params.manualGrades
 * @param {Array<{ attachment_id: string, annotation_json: Object, expected_version?: number, idempotency_key?: string }>} [params.annotations=[]]
 * @param {string} [params.teacherFeedback=''] - Nhận xét chung
 * @param {boolean} [params.requestRevision=false] - Yêu cầu sửa bài
 * @returns {Promise<{ ok: boolean, data?: any, error?: any }>}
 */
export async function finalizeGradingWithAnnotations({
  submissionId,
  manualGrades,
  annotations = [],
  teacherFeedback = '',
  requestRevision = false,
}) {
  try {
    const { data, error } = await supabase.rpc('finalize_academic_submission_grading_with_annotations', {
      p_submission_id: submissionId,
      p_manual_grades: manualGrades,
      p_annotations: annotations,
      p_teacher_feedback: teacherFeedback,
      p_request_revision: requestRevision,
    });

    if (error) return { ok: false, error };
    if (!data?.success) return { ok: false, error: new Error(data?.message || 'Lỗi hoàn tất chấm bài') };

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err };
  }
}

/**
 * Học sinh lấy kết quả bài đã chấm (chỉ xem các annotation final)
 * @param {Object} params
 * @param {string} params.submissionId - UUID bài nộp
 * @returns {Promise<{ ok: boolean, data?: any, error?: any }>}
 */
export async function getStudentGradedSubmission({ submissionId }) {
  try {
    const { data, error } = await supabase.rpc('get_student_graded_submission', {
      p_submission_id: submissionId,
    });

    if (error) return { ok: false, error };
    if (!data?.success) return { ok: false, error: new Error(data?.message || 'Lỗi tải bài đã chấm') };

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err };
  }
}
