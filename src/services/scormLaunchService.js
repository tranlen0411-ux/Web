import { supabase } from '../lib/supabase.js';

/**
 * SCORM Launch & Session Contract Service (Phase 2B-1 Final Security Hardened)
 * Quản lý khởi tạo Secure Launch Sessions (Server-Generated Tokens & Authority),
 * và chuyển tiếp an toàn tới Isolated SCORM Player (Port 4174)
 */

/**
 * Lấy Base URL của SCORM Player độc lập (Tách biệt Origin với Main App)
 * - Chỉ cho phép localhost:4174 khi chạy ở môi trường Local Development (import.meta.env.DEV === true)
 * - Trên môi trường Preview / Production: Bắt buộc cấu hình VITE_SCORM_PLAYER_ORIGIN hợp lệ
 *
 * @returns {string} Origin chuẩn hóa (ví dụ: 'https://scorm.example.com' hoặc 'http://localhost:4174')
 * @throws {Error} với mã/thông báo 'SCORM_PLAYER_ORIGIN_NOT_CONFIGURED' nếu thiếu hoặc sai định dạng ngoài DEV
 */
export function getScormPlayerOrigin() {
  const isDev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV === true;

  let rawOrigin = '';
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    rawOrigin = import.meta.env.VITE_SCORM_PLAYER_ORIGIN;
  }

  if (typeof rawOrigin === 'string' && rawOrigin.trim() !== '') {
    const trimmed = rawOrigin.trim().replace(/\/+$/, '');
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      throw new Error('SCORM_PLAYER_ORIGIN_NOT_CONFIGURED');
    }
  }

  // 1. Chỉ cho phép fallback localhost:4174 khi ở môi trường Local Development
  if (isDev) {
    return 'http://localhost:4174';
  }

  // 2. Trên Preview/Production: Chặn tuyệt đối localhost fallback & chặn tự đoán domain
  throw new Error('SCORM_PLAYER_ORIGIN_NOT_CONFIGURED');
}

/**
 * Khởi tạo Secure Launch Session cho bài học SCORM (Server-side Token Generation & Authorization)
 *
 * @param {Object} params
 * @param {string} [params.materialId] - ID tài liệu học tập (dành cho authenticated user)
 * @param {string} [params.shareToken] - Mã chia sẻ công khai (dành cho public/anon user)
 * @param {string} [params.studentName] - Tên học sinh hiển thị trong bài học
 * @returns {Promise<{ success: boolean, sessionToken: string, playerUrl: string, expiresAt: string, scormVersion: string }>}
 */
export async function createScormLaunchSession({
  materialId = null,
  shareToken = null,
  studentName = 'Học sinh',
}) {
  if (!materialId && !shareToken) {
    throw new Error('Cần cung cấp material_id (nếu đã đăng nhập) hoặc share_token (nếu học công khai).');
  }

  // 1. Kiểm tra cấu hình Player Origin trước khi cấp phát session token
  const playerOrigin = getScormPlayerOrigin();

  let rpcName = '';
  let rpcParams = {};

  if (materialId) {
    // 2. Luồng Authenticated: Gọi RPC tạo session người dùng đã đăng nhập
    rpcName = 'create_scorm_launch_session_authenticated';
    rpcParams = { p_material_id: materialId };
  } else {
    // 3. Luồng Public: Gọi RPC tạo session công khai
    rpcName = 'create_public_scorm_launch_session';
    rpcParams = { p_share_token: shareToken };
  }

  const { data: rpcData, error: rpcErr } = await supabase.rpc(rpcName, rpcParams);

  if (rpcErr) {
    throw new Error(rpcErr.message || 'Lỗi khi khởi tạo phiên học SCORM.');
  }

  if (!rpcData || !rpcData.success || !rpcData.session_token) {
    throw new Error('Không thể khởi tạo phiên học SCORM.');
  }

  const sessionToken = rpcData.session_token;
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';

  // 3. Xây dựng URL chuyển tiếp sang Isolated SCORM Player (Origin B: Port 4174)
  const queryParams = new URLSearchParams({
    session: sessionToken,
    studentName: studentName,
    parentOrigin: currentOrigin,
  });

  const playerUrl = `${playerOrigin}/index.html?${queryParams.toString()}`;

  // 4. Trả về sanitized response (Tuyệt đối không để lộ storage path hay credentials)
  return {
    success: true,
    sessionToken: sessionToken,
    playerUrl: playerUrl,
    expiresAt: rpcData.expires_at,
    scormVersion: rpcData.scorm_version || '1.2',
  };
}

/**
 * Thu hồi phiên học SCORM (Revoke Session)
 * @param {string} sessionId - ID của session cần thu hồi
 * @returns {Promise<boolean>}
 */
export async function revokeScormLaunchSession(sessionId) {
  if (!sessionId) return false;
  try {
    const { data, error } = await supabase.rpc('revoke_scorm_launch_session', {
      p_session_id: sessionId,
    });
    if (error) throw error;
    return !!data;
  } catch (err) {
    console.warn('Lỗi khi thu hồi phiên SCORM:', err);
    return false;
  }
}

/**
 * Xóa sạch toàn bộ assets của package trong Storage khi xóa hoặc cập nhật bài giảng
 * @param {string} contentRoot - Đường dẫn root dạng <user-id>/<package-id>
 * @param {string} [originalZipPath] - Đường dẫn file zip gốc
 */
export async function cleanupScormPackageStorage(contentRoot, originalZipPath) {
  if (!contentRoot) return;

  try {
    if (originalZipPath) {
      await supabase.storage.from('learning-materials').remove([originalZipPath]);
    }

    const { data: fileList } = await supabase.storage
      .from('scorm-content')
      .list(contentRoot, { limit: 1000 });

    if (fileList && fileList.length > 0) {
      const pathsToDelete = fileList.map((f) => `${contentRoot}/${f.name}`);
      await supabase.storage.from('scorm-content').remove(pathsToDelete);
    }
  } catch (err) {
    console.warn('Lỗi trong quá trình dọn dẹp storage SCORM package:', err);
  }
}
