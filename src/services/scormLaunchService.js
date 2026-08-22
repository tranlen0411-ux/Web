import { supabase } from '../lib/supabase.js';

/**
 * SCORM Launch & Session Contract Service
 * Quản lý phiên khởi chạy, cấu hình origin tách biệt (Port 4174 / Production Origin)
 * và tương tác an toàn với SCORM Player độc lập
 */

/**
 * Lấy Base URL của SCORM Player độc lập (Tách biệt Origin với Main App)
 */
export function getScormPlayerOrigin() {
  const customOrigin = import.meta.env.VITE_SCORM_PLAYER_ORIGIN;
  if (customOrigin && typeof customOrigin === 'string' && customOrigin.trim() !== '') {
    return customOrigin.replace(/\/$/, '');
  }
  // Môi trường Local Development: SCORM Player chạy riêng tại cổng 4174
  return 'http://localhost:4174';
}

/**
 * Khởi tạo Session khởi chạy bài học SCORM (Contract chuẩn hóa)
 * @param {Object} params
 * @param {string} params.packageId - ID gói SCORM
 * @param {string} params.launchPath - Đường dẫn tệp entry bên trong gói
 * @param {string} params.contentRoot - Đường dẫn gốc trong storage (<user-id>/<package-id>)
 * @param {string} [params.scormVersion] - Phiên bản SCORM (1.2 / 2004)
 * @param {string} [params.studentName] - Tên học sinh hiển thị trong bài học
 * @returns {Promise<{ sessionId: string, packageId: string, playerOrigin: string, contentBaseUrl: string, launchPath: string, playerUrl: string, expiresAt: string }>}
 */
export async function createScormLaunchSession({
  packageId,
  launchPath,
  contentRoot,
  scormVersion = '1.2',
  studentName = 'Học sinh',
}) {
  if (!packageId || !launchPath) {
    throw new Error('Thiếu thông tin package_id hoặc launch_path để khởi chạy SCORM.');
  }

  const rootPrefix = contentRoot || packageId;
  const fullStoragePath = `${rootPrefix}/${launchPath}`;

  // 1. Tạo Signed URL cho launch file từ Storage Private Bucket 'scorm-content'
  const { data: signData, error: signErr } = await supabase.storage
    .from('scorm-content')
    .createSignedUrl(fullStoragePath, 3600); // 1 giờ

  let resolvedLaunchUrl = '';
  if (!signErr && signData?.signedUrl) {
    resolvedLaunchUrl = signData.signedUrl;
  } else {
    // Fallback cho môi trường test local
    resolvedLaunchUrl = fullStoragePath;
  }

  // 2. Tạo Session ID ngẫu nhiên trong bộ nhớ
  const sessionId = 'scorm_sess_' + Math.random().toString(36).substring(2, 15);
  const playerOrigin = getScormPlayerOrigin();
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const contentBaseUrl = resolvedLaunchUrl.substring(0, resolvedLaunchUrl.lastIndexOf('/') + 1);

  // 3. Ghép Player URL chuyển tới SCORM Player Isolated Origin
  const queryParams = new URLSearchParams({
    version: scormVersion,
    launch: resolvedLaunchUrl,
    studentName: studentName,
    parentOrigin: currentOrigin,
    sessionId: sessionId,
    packageId: packageId,
  });

  const playerUrl = `${playerOrigin}/index.html?${queryParams.toString()}`;
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

  return {
    sessionId,
    packageId,
    playerOrigin,
    contentBaseUrl,
    launchPath,
    playerUrl,
    expiresAt,
  };
}

/**
 * Xóa sạch toàn bộ assets của package trong Storage khi xóa hoặc cập nhật bài giảng
 * @param {string} contentRoot - Đường dẫn root dạng <user-id>/<package-id> hoặc <package-id>
 * @param {string} [originalZipPath] - Đường dẫn file zip gốc
 */
export async function cleanupScormPackageStorage(contentRoot, originalZipPath) {
  if (!contentRoot) return;

  try {
    // 1. Xóa file ZIP gốc trong bucket learning-materials (nếu có)
    if (originalZipPath) {
      await supabase.storage.from('learning-materials').remove([originalZipPath]);
    }

    // 2. Liệt kê và xóa toàn bộ files trong thư mục package của bucket scorm-content
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
