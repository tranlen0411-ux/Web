// src/services/notificationClient.js
// Notifications V1 Frontend API Client Service
// Tương thích kiến trúc Clean Code & Supabase Client

import { supabase as defaultSupabase } from '../lib/supabase.js';

/**
 * Bản đồ ánh xạ mã lỗi RPC / PostgreSQL sang thông báo Tiếng Việt rõ ràng
 */
export const NOTIFICATION_ERROR_MAP = {
  UNAUTHENTICATED: 'Vui lòng đăng nhập để thực hiện thao tác này.',
  FORBIDDEN_ACCOUNT_DISABLED: 'Tài khoản của bạn đã bị khóa hoặc vô hiệu hóa.',
  FORBIDDEN_ROLE: 'Bạn không có quyền thực hiện chức năng thông báo này.',
  FORBIDDEN_TARGET_SCOPE: 'Chỉ Quản trị viên mới có quyền gửi thông báo toàn trường hoặc theo khối.',
  FORBIDDEN_CLASS: 'Bạn chỉ có quyền gửi thông báo cho các lớp học do mình trực tiếp phụ trách.',
  INVALID_GRADE_LEVEL: 'Khối lớp được chọn không hợp lệ (chỉ chấp nhận từ khối 1 đến 5).',
  EMPTY_CLASSES: 'Vui lòng chọn ít nhất một lớp học nhận thông báo.',
  MISSING_TITLE_OR_CONTENT: 'Tiêu đề và nội dung thông báo không được để trống.',
  NOT_FOUND: 'Không tìm thấy thông báo tương ứng trong hệ thống.',
  FORBIDDEN_PUBLISH_RECALLED: 'Thông báo đã bị thu hồi, không thể xuất bản hoặc xuất bản lại.',
  FORBIDDEN_NOT_PUBLISHED: 'Không thể đánh dấu đọc thông báo chưa được xuất bản.',
  FORBIDDEN_RECALLED: 'Thông báo này đã bị thu hồi.',
  FORBIDDEN_NOT_RECIPIENT: 'Bạn không nằm trong danh sách người nhận của thông báo này.',
  FORBIDDEN_REVERT_READ: 'Không thể chuyển trạng thái thông báo từ đã đọc về chưa đọc.',
  FORBIDDEN_UNPUBLISH: 'Thông báo đã xuất bản không thể chuyển về bản nháp. Vui lòng sử dụng tính năng thu hồi.',
  FORBIDDEN_MODIFICATION_PUBLISHED: 'Không thể sửa đổi nội dung thông báo đã xuất bản. Vui lòng thu hồi và tạo thông báo mới.',
  MISSING_TITLE_OR_CONTENT: 'Tiêu đề và nội dung thông báo không được để trống.',
  INVALID_TARGET: 'Vui lòng chọn đối tượng hoặc học sinh nhận thông báo.',
  INVALID_STUDENT: 'Học sinh được chọn không tồn tại trong hệ thống.',
  INVALID_STUDENT_ROLE: 'Đối tượng được chọn không phải là học sinh.',
  FORBIDDEN_STUDENT_DISABLED: 'Tài khoản học sinh này đã bị khóa hoặc vô hiệu hóa.',
  FORBIDDEN_STUDENT_NOT_IN_TEACHER_CLASSES: 'Thầy/Cô chỉ có thể gửi thông báo cá nhân cho học sinh thuộc lớp mình được phân công phụ trách.',
  NETWORK_ERROR: 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền mạng.',
};

/**
 * Chuẩn hóa lỗi từ Supabase RPC / PostgREST thành Error object với thông điệp Tiếng Việt
 * @param {any} rawError Lỗi thô trả về từ Supabase
 * @returns {Error} Error đã chuẩn hóa message và code
 */
export function formatNotificationError(rawError) {
  if (!rawError) return new Error('Lỗi không xác định.');

  const rawMessage = typeof rawError === 'string' ? rawError : rawError.message || rawError.error_description || '';

  // Tìm mã lỗi trong message
  for (const [code, vietnameseMsg] of Object.entries(NOTIFICATION_ERROR_MAP)) {
    if (rawMessage.includes(code)) {
      const err = new Error(vietnameseMsg);
      err.code = code;
      err.originalMessage = rawMessage;
      return err;
    }
  }

  // Lỗi mạng hoặc lỗi kết nối client
  if (
    rawMessage.includes('Failed to fetch') ||
    rawMessage.includes('NetworkError') ||
    rawMessage.includes('Network request failed') ||
    rawError.name === 'AbortError'
  ) {
    const err = new Error(NOTIFICATION_ERROR_MAP.NETWORK_ERROR);
    err.code = 'NETWORK_ERROR';
    err.originalMessage = rawMessage;
    return err;
  }

  // Fallback giữ nguyên lỗi nhưng đảm bảo không nuốt lỗi
  const fallback = new Error(rawMessage || 'Đã xảy ra lỗi trong quá trình xử lý thông báo.');
  fallback.code = rawError.code || 'UNKNOWN_NOTIFICATION_ERROR';
  fallback.originalMessage = rawMessage;
  return fallback;
}

/**
 * Lấy Supabase client (cho phép truyền mock client phục vụ Unit Testing)
 */
function getClient(clientOverride) {
  return clientOverride || defaultSupabase;
}

/**
 * 1. RPC: Tạo thông báo mới (Bản nháp hoặc Xuất bản ngay)
 * @param {Object} params
 * @param {string} params.title Tiêu đề thông báo (bắt buộc)
 * @param {string} params.content Nội dung thông báo (bắt buộc)
 * @param {('normal'|'high'|'urgent')} [params.priority='normal'] Độ ưu tiên
 * @param {('general'|'exercise'|'material'|'exam'|'system')} [params.category='general'] Phân loại
 * @param {('classes'|'grade'|'all')} [params.targetType='classes'] Đối tượng nhận
 * @param {number|null} [params.targetGradeLevel=null] Khối lớp (1-5) nếu targetType='grade'
 * @param {string[]} [params.targetClassIds=[]] Mảng UUID các lớp nhận tin nếu targetType='classes'
 * @param {string|null} [params.linkedResourceType=null] Phân loại liên kết ('exercise' | 'exam' | 'game')
 * @param {string|null} [params.linkedResourceId=null] UUID tài nguyên liên kết
 * @param {string|null} [params.linkUrl=null] Đường dẫn URL trực tiếp
 * @param {boolean} [params.publishNow=false] Xuất bản ngay sau khi tạo
 * @param {Object} [clientOverride] Mock client dùng cho testing
 * @returns {Promise<{ ok: boolean, data?: string, error?: Error }>}
 */
export async function createNotification(params = {}, clientOverride = null) {
  const client = getClient(clientOverride);

  const title = (params.title || '').trim();
  const content = (params.content || '').trim();

  if (!title || !content) {
    return {
      ok: false,
      error: formatNotificationError(new Error('MISSING_TITLE_OR_CONTENT')),
    };
  }

  try {
    const { data, error } = await client.rpc('rpc_create_notification', {
      p_title: title,
      p_content: content,
      p_priority: params.priority || 'normal',
      p_category: params.category || 'general',
      p_target_type: params.targetType || 'classes',
      p_target_grade_level: params.targetGradeLevel ?? null,
      p_target_class_ids: Array.isArray(params.targetClassIds) ? params.targetClassIds : [],
      p_linked_resource_type: params.linkedResourceType || null,
      p_linked_resource_id: params.linkedResourceId || null,
      p_link_url: params.linkUrl || null,
      p_publish_now: Boolean(params.publishNow),
    });

    if (error) {
      return { ok: false, error: formatNotificationError(error) };
    }

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: formatNotificationError(err) };
  }
}

/**
 * 2. RPC: Xuất bản một thông báo đang ở trạng thái bản nháp
 * @param {string} notificationId UUID thông báo cần phát hành
 * @param {Object} [clientOverride] Mock client dùng cho testing
 * @returns {Promise<{ ok: boolean, data?: boolean, error?: Error }>}
 */
export async function publishNotification(notificationId, clientOverride = null) {
  if (!notificationId) {
    return {
      ok: false,
      data: false,
      error: formatNotificationError(new Error('NOT_FOUND: Thiếu ID thông báo.')),
    };
  }

  const client = getClient(clientOverride);

  try {
    const { data, error } = await client.rpc('rpc_publish_notification', {
      p_notification_id: notificationId,
    });

    if (error) {
      return { ok: false, data: false, error: formatNotificationError(error) };
    }

    if (data === true) {
      return { ok: true, data: true };
    }

    return {
      ok: false,
      data: false,
      error: formatNotificationError(
        new Error('Máy chủ chưa xác nhận xuất bản thông báo thành công. Vui lòng kiểm tra lại trạng thái thông báo.')
      ),
    };
  } catch (err) {
    return { ok: false, data: false, error: formatNotificationError(err) };
  }
}

/**
 * 3. RPC: Thu hồi một thông báo đã xuất bản
 * @param {string} notificationId UUID thông báo cần thu hồi
 * @param {string|null} [reason=null] Lý do thu hồi thông báo
 * @param {Object} [clientOverride] Mock client dùng cho testing
 * @returns {Promise<{ ok: boolean, data?: boolean, error?: Error }>}
 */
export async function recallNotification(notificationId, reason = null, clientOverride = null) {
  if (!notificationId) {
    return {
      ok: false,
      data: false,
      error: formatNotificationError(new Error('NOT_FOUND: Thiếu ID thông báo.')),
    };
  }

  const client = getClient(clientOverride);

  try {
    const { data, error } = await client.rpc('rpc_recall_notification', {
      p_notification_id: notificationId,
      p_reason: reason ? String(reason).trim() : null,
    });

    if (error) {
      return { ok: false, data: false, error: formatNotificationError(error) };
    }

    if (data === true) {
      return { ok: true, data: true };
    }

    return {
      ok: false,
      data: false,
      error: formatNotificationError(
        new Error('Máy chủ chưa xác nhận thu hồi thông báo thành công. Vui lòng kiểm tra lại trạng thái thông báo.')
      ),
    };
  } catch (err) {
    return { ok: false, data: false, error: formatNotificationError(err) };
  }
}

/**
 * 4. RPC: Lấy danh sách thông báo của người nhận hiện tại (Học sinh / Người nhận)
 * @param {Object} [options={}]
 * @param {number} [options.limit=20] Giới hạn số lượng (1 - 100)
 * @param {number} [options.offset=0] Vị trí bắt đầu
 * @param {boolean} [options.unreadOnly=false] Chỉ lấy thông báo chưa đọc
 * @param {Object} [clientOverride] Mock client dùng cho testing
 * @returns {Promise<{ ok: boolean, data?: Array, error?: Error }>}
 */
export async function getMyNotifications(options = {}, clientOverride = null) {
  const client = getClient(clientOverride);

  const limit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
  const offset = Math.max(0, Number(options.offset) || 0);
  const unreadOnly = Boolean(options.unreadOnly);

  try {
    const { data, error } = await client.rpc('rpc_get_my_notifications', {
      p_limit: limit,
      p_offset: offset,
      p_unread_only: unreadOnly,
    });

    if (error) {
      return { ok: false, error: formatNotificationError(error) };
    }

    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err) {
    return { ok: false, error: formatNotificationError(err) };
  }
}

/**
 * 5. RPC: Đếm số lượng thông báo chưa đọc của người dùng hiện tại
 * @param {Object} [clientOverride] Mock client dùng cho testing
 * @returns {Promise<{ ok: boolean, data: number, error?: Error }>}
 */
export async function getUnreadNotificationCount(clientOverride = null) {
  const client = getClient(clientOverride);

  try {
    const { data, error } = await client.rpc('rpc_get_unread_notification_count');

    if (error) {
      return { ok: false, data: 0, error: formatNotificationError(error) };
    }

    return { ok: true, data: typeof data === 'number' ? data : Number(data) || 0 };
  } catch (err) {
    return { ok: false, data: 0, error: formatNotificationError(err) };
  }
}

/**
 * 6. RPC: Đánh dấu một thông báo là đã đọc
 * @param {string} notificationId UUID thông báo cần đánh dấu
 * @param {Object} [clientOverride] Mock client dùng cho testing
 * @returns {Promise<{ ok: boolean, data?: boolean, error?: Error }>}
 */
export async function markNotificationAsRead(notificationId, clientOverride = null) {
  if (!notificationId) {
    return {
      ok: false,
      data: false,
      error: formatNotificationError(new Error('NOT_FOUND: Thiếu ID thông báo.')),
    };
  }

  const client = getClient(clientOverride);

  try {
    const { data, error } = await client.rpc('rpc_mark_notification_as_read', {
      p_notification_id: notificationId,
    });

    if (error) {
      return { ok: false, data: false, error: formatNotificationError(error) };
    }

    if (data === true) {
      return { ok: true, data: true };
    }

    return {
      ok: false,
      data: false,
      error: formatNotificationError(
        new Error('Máy chủ chưa xác nhận đánh dấu đã đọc thành công. Vui lòng thử lại.')
      ),
    };
  } catch (err) {
    return { ok: false, data: false, error: formatNotificationError(err) };
  }
}

/**
 * 7. Truy vấn trực tiếp danh sách thông báo đã gửi / bản nháp (Dành cho Admin & Giáo viên)
 * Sử dụng RLS database tự động:
 * - Admin: Thấy tất cả thông báo hệ thống.
 * - Giáo viên: Chỉ thấy thông báo do chính mình tạo (sender_id = auth.uid()).
 *
 * @param {Object} [options={}]
 * @param {number} [options.limit=20] Giới hạn số lượng bản ghi
 * @param {number} [options.offset=0] Vị trí bắt đầu
 * @param {('all'|'draft'|'published'|'recalled')} [options.status='all'] Lọc trạng thái
 * @param {Object} [clientOverride] Mock client dùng cho testing
 * @returns {Promise<{ ok: boolean, data?: Array, count?: number, error?: Error }>}
 */
export async function getSentNotifications(options = {}, clientOverride = null) {
  const client = getClient(clientOverride);

  const limit = Math.max(1, Math.min(Number(options.limit) || 20, 100));
  const offset = Math.max(0, Number(options.offset) || 0);
  const status = options.status || 'all';

  try {
    let query = client
      .from('notifications')
      .select(
        `
        id,
        sender_id,
        sender_name_snapshot,
        title,
        content,
        priority,
        category,
        target_type,
        target_grade_level,
        target_class_ids,
        target_student_id,
        target_student_name_snapshot,
        linked_resource_type,
        linked_resource_id,
        link_url,
        is_published,
        published_at,
        is_recalled,
        recalled_at,
        recall_reason,
        created_at,
        updated_at
      `,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status === 'draft') {
      query = query.eq('is_published', false);
    } else if (status === 'published') {
      query = query.eq('is_published', true).eq('is_recalled', false);
    } else if (status === 'recalled') {
      query = query.eq('is_recalled', true);
    }

    const { data, count, error } = await query;

    if (error) {
      return { ok: false, error: formatNotificationError(error) };
    }

    return { ok: true, data: Array.isArray(data) ? data : [], count: count || 0 };
  } catch (err) {
    return { ok: false, error: formatNotificationError(err) };
  }
}

/**
 * 8. Xóa bản nháp thông báo chưa xuất bản
 * Database RLS rls_notifications_delete bảo vệ chỉ cho phép xóa khi is_published = FALSE
 * @param {string} notificationId UUID thông báo bản nháp cần xóa
 * @param {Object} [clientOverride] Mock client dùng cho testing
 * @returns {Promise<{ ok: boolean, error?: Error }>}
 */
export async function deleteDraftNotification(notificationId, clientOverride = null) {
  if (!notificationId) {
    return { ok: false, error: formatNotificationError(new Error('NOT_FOUND: Thiếu ID thông báo.')) };
  }

  const client = getClient(clientOverride);

  try {
    const { error } = await client
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('is_published', false);

    if (error) {
      return { ok: false, error: formatNotificationError(error) };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatNotificationError(err) };
  }
}

/**
 * 9. Lấy thông tin chi tiết một thông báo theo ID (Truy vấn đọc an toàn)
 * Dùng cho các modal xác nhận trước khi Publish/Recall để đối chiếu dữ liệu mới nhất
 * @param {string} notificationId UUID thông báo cần đọc
 * @param {Object} [clientOverride] Mock client dùng cho testing
 * @returns {Promise<{ ok: boolean, data?: Object, error?: Error }>}
 */
export async function getNotificationById(notificationId, clientOverride = null) {
  if (!notificationId) {
    return { ok: false, error: formatNotificationError(new Error('NOT_FOUND: Thiếu ID thông báo.')) };
  }

  const client = getClient(clientOverride);

  try {
    const { data, error } = await client
      .from('notifications')
      .select(
        `
        id,
        sender_id,
        sender_name_snapshot,
        title,
        content,
        priority,
        category,
        target_type,
        target_grade_level,
        target_class_ids,
        target_student_id,
        target_student_name_snapshot,
        linked_resource_type,
        linked_resource_id,
        link_url,
        is_published,
        published_at,
        is_recalled,
        recalled_at,
        recall_reason,
        created_at,
        updated_at
      `
      )
      .eq('id', notificationId)
      .maybeSingle();

    if (error) {
      return { ok: false, error: formatNotificationError(error) };
    }

    if (!data) {
      return { ok: false, error: formatNotificationError(new Error('NOT_FOUND: Không tìm thấy thông báo tương ứng.')) };
    }

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: formatNotificationError(err) };
  }
}

/**
 * 10. RPC: Tạo thông báo riêng cho một học sinh cá nhân (Individual Notification)
 * @param {Object} params
 * @param {string} params.title Tiêu đề thông báo (bắt buộc)
 * @param {string} params.content Nội dung thông báo (bắt buộc)
 * @param {string} params.targetStudentId UUID học sinh nhận thông báo (bắt buộc)
 * @param {('normal'|'high'|'urgent')} [params.priority='normal'] Độ ưu tiên
 * @param {('general'|'exercise'|'material'|'exam'|'system')} [params.category='general'] Phân loại
 * @param {string|null} [params.linkedResourceType=null] Loại tài nguyên
 * @param {string|null} [params.linkedResourceId=null] UUID tài nguyên
 * @param {string|null} [params.linkUrl=null] Đường dẫn URL
 * @param {boolean} [params.publishNow=false] Xuất bản ngay
 * @param {Object} [clientOverride] Mock client dùng cho testing
 * @returns {Promise<{ ok: boolean, data?: string, error?: Error }>}
 */
export async function createIndividualNotification(params = {}, clientOverride = null) {
  const client = getClient(clientOverride);

  const title = (params.title || '').trim();
  const content = (params.content || '').trim();
  const targetStudentId = params.targetStudentId || null;

  if (!title || !content) {
    return {
      ok: false,
      error: formatNotificationError(new Error('MISSING_TITLE_OR_CONTENT')),
    };
  }

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!targetStudentId || typeof targetStudentId !== 'string' || !UUID_REGEX.test(targetStudentId.trim())) {
    return {
      ok: false,
      error: formatNotificationError(new Error('INVALID_TARGET: Mã định danh học sinh nhận tin không hợp lệ.')),
    };
  }

  try {
    const { data, error } = await client.rpc('rpc_create_individual_notification', {
      p_title: title,
      p_content: content,
      p_target_student_id: targetStudentId,
      p_priority: params.priority || 'normal',
      p_category: params.category || 'general',
      p_linked_resource_type: params.linkedResourceType || null,
      p_linked_resource_id: params.linkedResourceId || null,
      p_link_url: params.linkUrl || null,
      p_publish_now: Boolean(params.publishNow),
    });

    if (error) {
      return { ok: false, error: formatNotificationError(error) };
    }

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: formatNotificationError(err) };
  }
}

/**
 * 11. RPC: Tìm kiếm học sinh có kiểm soát quyền từ backend và phân trang
 * - Admin: Tìm kiếm học sinh toàn trường, có thể lọc theo lớp hoặc khối
 * - Teacher: Chỉ tìm kiếm học sinh thuộc các lớp mình trực tiếp quản lý
 * @param {Object} [params={}]
 * @param {string} [params.query=''] Từ khóa tìm kiếm (Tên hoặc Mã học sinh)
 * @param {string|null} [params.classId=null] Lọc theo UUID lớp học
 * @param {number|null} [params.gradeLevel=null] Lọc theo khối lớp (1-5)
 * @param {number} [params.limit=20] Giới hạn số lượng (1-50)
 * @param {number} [params.offset=0] Vị trí bắt đầu
 * @param {Object} [clientOverride] Mock client dùng cho testing
 * @returns {Promise<{ ok: boolean, data?: Array, error?: Error }>}
 */
export async function searchStudentsForNotification(params = {}, clientOverride = null) {
  const client = getClient(clientOverride);

  const query = (params.query || '').trim();
  const classId = params.classId || null;
  const gradeLevel = params.gradeLevel ? Number(params.gradeLevel) : null;
  const limit = Math.max(1, Math.min(Number(params.limit) || 20, 50));
  const offset = Math.max(0, Number(params.offset) || 0);

  try {
    const { data, error } = await client.rpc('rpc_search_students_for_notification', {
      p_query: query || null,
      p_class_id: classId,
      p_grade_level: gradeLevel,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      return { ok: false, error: formatNotificationError(error) };
    }

    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (err) {
    return { ok: false, error: formatNotificationError(err) };
  }
}
