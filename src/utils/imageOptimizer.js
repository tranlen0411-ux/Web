/**
 * src/utils/imageOptimizer.js
 * Utility kiểm soát và tối ưu hóa ảnh bài nộp phía Client (Client-side Image Optimization & Validation)
 * 
 * - Giới hạn dung lượng tối đa 10MB.
 * - Chỉ chấp nhận PNG, JPG, JPEG, WEBP.
 * - Tự động tối ưu/nén ảnh lớn phía Client bằng HTML5 Canvas thuần (Zero dependencies).
 * - Giữ trọn vẹn độ sắc nét của chữ viết tay và công thức bài làm (maxDimension: 2048px, quality: 0.88).
 * - Tự động bỏ qua nén với file đã nhỏ (<= 400KB) hoặc khi môi trường không hỗ trợ Canvas.
 */

export const MAX_ALLOWED_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB (10,485,760 bytes)
export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
export const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Kiểm tra tính hợp lệ của file ảnh bài làm
 * @param {File} file - Đối tượng file cần kiểm tra
 * @returns {string|null} - Chuỗi thông báo lỗi tiếng Việt nếu không hợp lệ, null nếu hoàn toàn hợp lệ
 */
export function validateImageFile(file) {
  if (!file) {
    return 'Không tìm thấy tệp tin.';
  }

  const nameLower = (file.name || '').toLowerCase();

  // 1. Chặn tuyệt đối SVG và các file thực thi / script nguy hiểm (kể cả double extension)
  if (
    nameLower.endsWith('.svg') ||
    (file.type && file.type.includes('svg')) ||
    nameLower.endsWith('.exe') ||
    nameLower.includes('.exe.') ||
    nameLower.endsWith('.bat') ||
    nameLower.includes('.bat.') ||
    nameLower.endsWith('.sh') ||
    nameLower.includes('.sh.') ||
    nameLower.endsWith('.html') ||
    nameLower.includes('.html.') ||
    nameLower.endsWith('.js') ||
    nameLower.includes('.js.') ||
    nameLower.endsWith('.php') ||
    nameLower.includes('.php.')
  ) {
    return 'Chặn định dạng SVG và tệp thực thi để bảo đảm an toàn hệ thống.';
  }

  // 2. Kiểm tra đuôi file & MIME type
  const hasValidExt = ALLOWED_IMAGE_EXTENSIONS.some(ext => nameLower.endsWith(ext));
  if (!hasValidExt) {
    return 'Chỉ chấp nhận định dạng ảnh PNG, JPG, JPEG hoặc WebP.';
  }

  if (file.type && !ALLOWED_IMAGE_MIMES.includes(file.type)) {
    return 'Định dạng MIME không hợp lệ. Chỉ chấp nhận ảnh PNG, JPG, JPEG hoặc WebP.';
  }

  // 3. Kiểm tra dung lượng (1 byte <= size <= 10MB)
  if (file.size <= 0) {
    return 'Tệp tin rỗng không hợp lệ.';
  }

  if (file.size > MAX_ALLOWED_IMAGE_BYTES) {
    return 'Dung lượng ảnh vượt quá giới hạn 10MB. Vui lòng chọn ảnh nhỏ hơn hoặc chụp lại.';
  }

  return null;
}

/**
 * Tự động tối ưu hóa và giảm dung lượng ảnh phía Client trước khi upload
 * @param {File} file - File ảnh gốc
 * @param {Object} options - Tùy chọn nén
 * @param {number} [options.maxDimension=2048] - Kích thước cạnh dài tối đa (px)
 * @param {number} [options.quality=0.88] - Chất lượng nén ảnh JPEG/WebP (0..1)
 * @param {number} [options.skipThresholdBytes=409600] - Ngưỡng dung lượng bỏ qua nén (400KB)
 * @returns {Promise<File>} - File đã được tối ưu hoặc file gốc an toàn
 */
export async function optimizeImageBeforeUpload(file, options = {}) {
  const {
    maxDimension = 2048,
    quality = 0.88,
    skipThresholdBytes = 400 * 1024 // 400KB
  } = options;

  // 1. Nếu file đã nhỏ hơn ngưỡng (<= 400KB), giữ nguyên file gốc
  if (!file || file.size <= skipThresholdBytes) {
    return file;
  }

  // 2. Kiểm tra môi trường trình duyệt hỗ trợ Image và Canvas
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    !window.Image
  ) {
    return file;
  }

  return new Promise((resolve) => {
    let objectUrl = null;
    try {
      const img = new Image();
      objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;

        if (!width || !height) {
          resolve(file);
          return;
        }

        // 3. Tính toán kích thước thu nhỏ nếu vượt quá maxDimension
        let targetWidth = width;
        let targetHeight = height;

        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          targetWidth = Math.max(1, Math.round(width * ratio));
          targetHeight = Math.max(1, Math.round(height * ratio));
        } else if (file.size <= 800 * 1024) {
          // Kích thước chuẩn và dung lượng dưới 800KB thì giữ nguyên
          resolve(file);
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          resolve(file);
          return;
        }

        // Bật thuật toán làm mịn chất lượng cao để giữ rõ nét chữ viết tay
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Điền nền trắng để chống đen nền nếu ảnh là PNG trong suốt
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        // Định dạng xuất: WebP nếu file gốc là WebP, còn lại dùng JPEG chất lượng cao
        const outputMime = file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';

        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(file);
            return;
          }

          // Chỉ lấy file nén nếu dung lượng thực sự giảm so với file gốc
          if (blob.size < file.size) {
            let fileName = file.name || 'submission_image.jpg';
            if (outputMime === 'image/jpeg' && !fileName.toLowerCase().endsWith('.jpg') && !fileName.toLowerCase().endsWith('.jpeg')) {
              fileName = fileName.replace(/\.[^.]+$/, '.jpg');
            } else if (outputMime === 'image/webp' && !fileName.toLowerCase().endsWith('.webp')) {
              fileName = fileName.replace(/\.[^.]+$/, '.webp');
            }

            const optimizedFile = new File([blob], fileName, {
              type: outputMime,
              lastModified: Date.now()
            });
            resolve(optimizedFile);
          } else {
            resolve(file);
          }
        }, outputMime, quality);
      };

      img.onerror = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve(file);
      };

      img.src = objectUrl;
    } catch (err) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      console.warn('optimizeImageBeforeUpload fallback to original:', err);
      resolve(file);
    }
  });
}
