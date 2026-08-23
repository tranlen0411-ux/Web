/**
 * MIME Types Map cho SCORM Assets Delivery (Isolated Player Utility)
 */
export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.wasm': 'application/wasm',
};

/**
 * Lấy phần mở rộng tệp tin thuần JavaScript
 * @param {string} filePath
 * @returns {string}
 */
function getFileExtension(filePath) {
  if (!filePath) return '';
  const clean = filePath.split('?')[0].split('#')[0];
  const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  const fileName = lastSlash !== -1 ? clean.substring(lastSlash + 1) : clean;
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0) return '';
  return fileName.substring(lastDot).toLowerCase();
}

/**
 * Lấy MIME Type phù hợp từ tên tệp và tùy chọn upstream MIME
 * @param {string} filePath
 * @param {string} [upstreamContentType]
 * @returns {string}
 */
export function getMimeTypeForAsset(filePath, upstreamContentType) {
  const cleanPath = filePath ? filePath.split('?')[0].split('#')[0] : '';
  const effectivePath = (!cleanPath || cleanPath.endsWith('/')) ? 'index.html' : cleanPath;
  const ext = getFileExtension(effectivePath);

  if (ext && MIME_TYPES[ext]) {
    return MIME_TYPES[ext];
  }

  if (
    upstreamContentType &&
    upstreamContentType !== 'application/octet-stream' &&
    upstreamContentType !== 'text/plain' &&
    upstreamContentType !== 'text/plain; charset=utf-8'
  ) {
    return upstreamContentType;
  }

  return 'application/octet-stream';
}

/**
 * Chuẩn hóa path tương đối thuần túy theo chuẩn POSIX
 * @param {string} p
 * @returns {string}
 */
function normalizePosixPath(p) {
  const parts = p.split('/');
  const stack = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length > 0) {
        stack.pop();
      } else {
        return '../'; // Escaped root
      }
    } else {
      stack.push(part);
    }
  }
  return stack.join('/');
}

/**
 * Kiểm tra và chuẩn hóa đường dẫn tương đối của tài nguyên SCORM (Asset Sanitization)
 * Ngăn chặn tuyệt đối mọi hình thức Path Traversal, Double Encoding, Null Bytes, Drive Prefix.
 * 
 * @param {string} rawRelativePath - Đường dẫn tương đối nhận từ URL
 * @returns {{ valid: boolean, normalizedPath?: string, reason?: string }}
 */
export function sanitizeScormRelativePath(rawRelativePath) {
  if (typeof rawRelativePath !== 'string' || !rawRelativePath.trim()) {
    return { valid: false, reason: 'EMPTY_PATH' };
  }

  if (rawRelativePath.length > 1024) {
    return { valid: false, reason: 'EXCESSIVE_PATH_LENGTH' };
  }

  let decoded = rawRelativePath.trim();

  // 1. Kiểm tra Null Byte trước và sau khi decode
  if (decoded.includes('\0') || decoded.includes('%00')) {
    return { valid: false, reason: 'NULL_BYTE_DETECTED' };
  }

  // 2. Decode percent-encoding nhiều lớp để chặn double/triple encoding
  let prevDecoded = '';
  let decodeAttempts = 0;
  while (decoded !== prevDecoded && decodeAttempts < 5) {
    prevDecoded = decoded;
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return { valid: false, reason: 'MALFORMED_URI_ENCODING' };
    }
    decodeAttempts++;
  }

  if (decoded.includes('\0') || decoded.includes('%00')) {
    return { valid: false, reason: 'NULL_BYTE_DETECTED' };
  }

  // 3. Chặn Windows drive letter prefix (C:, D:, etc.)
  if (/^[a-zA-Z]:/.test(decoded)) {
    return { valid: false, reason: 'DRIVE_PREFIX_DETECTED' };
  }

  // 4. Chuyển đổi mọi backslash sang slash
  const normalizedSlashes = decoded.replace(/\\/g, '/');

  // 5. Chặn các chuỗi traversal tường minh
  if (
    normalizedSlashes.includes('../') ||
    normalizedSlashes.includes('/..') ||
    normalizedSlashes === '..' ||
    normalizedSlashes.includes('..\\') ||
    normalizedSlashes.includes('..')
  ) {
    return { valid: false, reason: 'PATH_TRAVERSAL_DETECTED' };
  }

  // 6. Chặn absolute paths bắt đầu bằng /
  if (normalizedSlashes.startsWith('/')) {
    return { valid: false, reason: 'ABSOLUTE_PATH_DETECTED' };
  }

  // 7. Chuẩn hóa path
  const normalized = normalizePosixPath(normalizedSlashes);

  // 8. Đảm bảo kết quả normalize không vượt ra ngoài root
  if (
    normalized.startsWith('../') ||
    normalized === '..' ||
    normalized.startsWith('/') ||
    normalized === '.' ||
    !normalized
  ) {
    return { valid: false, reason: 'ESCAPED_PACKAGE_ROOT' };
  }

  return {
    valid: true,
    normalizedPath: normalized,
  };
}
