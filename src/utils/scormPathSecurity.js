/**
 * MIME Types Map cho SCORM Assets Delivery
 */
export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
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
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Lấy phần mở rộng tệp tin thuần JavaScript (không phụ thuộc node:path)
 * @param {string} filePath
 * @returns {string}
 */
function getFileExtension(filePath) {
  if (!filePath) return '';
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const fileName = lastSlash !== -1 ? filePath.substring(lastSlash + 1) : filePath;
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0) return '';
  return fileName.substring(lastDot).toLowerCase();
}

/**
 * Lấy MIME Type phù hợp từ tên tệp
 * @param {string} filePath
 * @returns {string}
 */
export function getMimeTypeForAsset(filePath) {
  if (!filePath) return 'application/octet-stream';
  const ext = getFileExtension(filePath);
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Thuật toán SHA-256 thuần túy (Pure Isomorphic JavaScript)
 * Tương thích 100% cả môi trường Browser Client, Vite Bundle và Node.js Server
 * @param {string} ascii
 * @returns {string} Hex SHA-256
 */
function sha256Pure(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let lengthProperty = 'length';
  let i, j;
  let result = '';

  const words = [];
  const asciiBitLength = ascii[lengthProperty] * 8;

  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let currentBitLength = 0;
  for (i = 0; i < ascii[lengthProperty]; i++) {
    const charCode = ascii.charCodeAt(i);
    words[currentBitLength >> 5] |= (charCode & 0xff) << (24 - (currentBitLength % 32));
    currentBitLength += 8;
  }

  words[asciiBitLength >> 5] |= 0x80 << (24 - (asciiBitLength % 32));
  words[(((asciiBitLength + 64) >> 9) << 4) + 15] = asciiBitLength;

  for (i = 0; i < words[lengthProperty]; i += 16) {
    const w = [];
    for (j = 0; j < 16; j++) {
      w[j] = words[i + j] | 0;
    }
    for (j = 16; j < 64; j++) {
      const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }

    let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
    let e = hash[4], f = hash[5], g = hash[6], h = hash[7];

    for (j = 0; j < 64; j++) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[j] + w[j]) | 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }

  return result;
}

/**
 * Băm Session Token thành chuỗi SHA-256 Hex
 * @param {string} token
 * @returns {string}
 */
export function hashSessionToken(token) {
  if (!token || typeof token !== 'string') return '';
  return sha256Pure(token.trim());
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

  // 2. Decode percent-encoding nhiều lớp để chặn double/triple encoding (ví dụ %252e%252e)
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
