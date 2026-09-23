import { supabase, supabaseUrl } from '../lib/supabase';

/**
 * Service kiểm tra trạng thái an toàn của biến môi trường backend ALLOW_PRODUCTION_BULK_CREATE.
 * Chỉ Admin mới có quyền gọi endpoint này.
 *
 * @returns {Promise<{ success: boolean, enabled: boolean | null, error?: string }>}
 */
export async function getBulkImportBackendStatus() {
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.access_token) {
      return {
        success: false,
        enabled: null,
        error: 'Phiên làm việc hết hạn hoặc chưa đăng nhập.',
      };
    }

    const response = await fetch(
      `${supabaseUrl}/functions/v1/admin-bulk-create-students?action=status`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      }
    );

    if (!response.ok) {
      return {
        success: false,
        enabled: null,
        error: `Server phản hồi mã lỗi HTTP ${response.status}`,
      };
    }

    const data = await response.json();
    if (data && typeof data.enabled === 'boolean') {
      return {
        success: true,
        enabled: data.enabled,
      };
    }

    return {
      success: false,
      enabled: null,
      error: 'Cấu trúc dữ liệu trả về từ server không hợp lệ.',
    };
  } catch (err) {
    return {
      success: false,
      enabled: null,
      error: err.message || 'Không thể kết nối đến máy chủ.',
    };
  }
}
