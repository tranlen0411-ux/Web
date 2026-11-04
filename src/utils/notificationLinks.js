// src/utils/notificationLinks.js
// Tiện ích phân tích và kiểm định URL an toàn trong nội dung thông báo (Notifications V1 R5-B)
// Tuân thủ Zero-Trust: Chỉ cho phép giao thức HTTP/HTTPS hợp lệ qua WHATWG URL parser,
// kiểm tra ranh giới token, tách dấu câu thông minh, chặn thông tin đăng nhập (user:pass) và chống XSS tuyệt đối.

const MAX_URL_LENGTH = 2048;

// Nhận diện ứng viên bắt đầu bằng http:// hoặc https://, không chứa khoảng trắng và các dấu ngắt thẻ HTML
const URL_CANDIDATE_REGEX = /https?:\/\/[^\s<>"'`]+/gi;

// Các ký tự mở ngoặc/trích dẫn hợp lệ được phép đứng liền trước http(s):// trong cùng một cụm từ
const ALLOWED_LEADING_PREFIX_REGEX = /^[([{"'“‘«]+$/u;

// Các dấu câu kết thúc câu thường gặp ở cuối URL trong văn bản Tiếng Việt
const TRAILING_SENTENCE_PUNCTUATION = new Set([
  '.',
  ',',
  '!',
  '?',
  ';',
  ':',
  '…',
  "'",
  '"',
  '”',
  '’',
  '»'
]);

// Cặp dấu ngoặc đóng -> mở tương ứng để kiểm tra độ cân bằng ngoặc bên trong URL
const CLOSING_TO_OPENING_BRACKET = new Map([
  [')', '('],
  [']', '['],
  ['}', '{']
]);

/**
 * Đếm số lần xuất hiện của một ký tự trong chuỗi
 * @param {string} str
 * @param {string} charToCount
 * @returns {number}
 */
function countChar(str, charToCount) {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === charToCount) count++;
  }
  return count;
}

/**
 * Tách phần dấu câu kết thúc câu hoặc dấu đóng ngoặc dư thừa ở cuối ứng viên URL
 * Bảo toàn dấu đóng ngoặc nếu nó cân bằng với dấu mở ngoặc bên trong URL (ví dụ link Wikipedia)
 *
 * @param {string} rawCandidate
 * @returns {{ cleanUrl: string, trailingPunctuation: string }}
 */
export function stripTrailingUrlPunctuation(rawCandidate) {
  if (typeof rawCandidate !== 'string' || rawCandidate.length === 0) {
    return { cleanUrl: '', trailingPunctuation: '' };
  }

  let endIdx = rawCandidate.length;

  while (endIdx > 0) {
    const lastChar = rawCandidate[endIdx - 1];

    if (TRAILING_SENTENCE_PUNCTUATION.has(lastChar)) {
      endIdx--;
      continue;
    }

    if (CLOSING_TO_OPENING_BRACKET.has(lastChar)) {
      const openingChar = CLOSING_TO_OPENING_BRACKET.get(lastChar);
      const currentSlice = rawCandidate.slice(0, endIdx);
      const openCount = countChar(currentSlice, openingChar);
      const closeCount = countChar(currentSlice, lastChar);

      // Nếu số dấu đóng nhiều hơn số dấu mở trong bản thân URL -> dấu đóng này thuộc về câu bao ngoài
      if (closeCount > openCount) {
        endIdx--;
        continue;
      }
    }

    break;
  }

  return {
    cleanUrl: rawCandidate.slice(0, endIdx),
    trailingPunctuation: rawCandidate.slice(endIdx)
  };
}

/**
 * Kiểm tra hostname hợp lệ để loại bỏ các URL giả mạo hoặc rỗng (như https://. hoặc https://---)
 * @param {string} hostname
 * @returns {boolean}
 */
function isValidUrlHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const normalized = hostname.trim().toLowerCase();
  if (!normalized || normalized.length > 253) return false;

  // Chấp nhận localhost cho môi trường phát triển/kiểm thử nội bộ
  if (normalized === 'localhost') return true;

  // Chấp nhận IPv6 đặt trong ngoặc vuông
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    return normalized.length > 2;
  }

  // Không được bắt đầu hoặc kết thúc bằng dấu chấm hoặc gạch ngang, không có hai dấu chấm liên tiếp
  if (
    normalized.startsWith('.') ||
    normalized.endsWith('.') ||
    normalized.startsWith('-') ||
    normalized.endsWith('-') ||
    normalized.includes('..')
  ) {
    return false;
  }

  // Kiểm tra IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) {
    const octets = normalized.split('.').map(Number);
    return octets.every((n) => n >= 0 && n <= 255);
  }

  // Tên miền chuẩn phải có ít nhất 1 dấu chấm và TLD từ 2 ký tự trở lên
  const parts = normalized.split('.');
  if (parts.length < 2) return false;

  const tld = parts[parts.length - 1];
  if (!/^[a-z0-9-]{2,}$/i.test(tld) || tld.startsWith('-') || tld.endsWith('-')) {
    return false;
  }

  return parts.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      !label.startsWith('-') &&
      !label.endsWith('-') &&
      /^[a-z0-9-]+$/i.test(label)
  );
}

/**
 * Kiểm định một chuỗi ứng viên có phải là URL HTTP/HTTPS tuyệt đối, an toàn hay không
 * - Sử dụng WHATWG URL parser (`new URL()`)
 * - Whitelist duy nhất `http:` và `https:`
 * - Chặn URL chứa thông tin xác thực (`username` hoặc `password` kiểu `https://admin:pass@evil.com`)
 * - Chặn ký tự điều khiển ASCII và khoảng trắng
 *
 * @param {string} candidate
 * @returns {boolean}
 */
export function isSafeHttpUrl(candidate) {
  if (typeof candidate !== 'string') return false;

  const trimmed = candidate.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) {
    return false;
  }

  // Chặn mọi ký tự điều khiển ASCII hoặc khoảng trắng ẩn bên trong URL
  if (/[\u0000-\u001F\u007F\s]/.test(trimmed)) {
    return false;
  }

  // Bắt buộc phải bắt đầu bằng http:// hoặc https://
  if (!/^https?:\/\//i.test(trimmed)) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);

    // Whitelist giao thức nghiêm ngặt
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }

    // Chặn tuyệt đối URL chứa username hoặc password (chống lừa đảo giả mạo tên miền)
    if (parsed.username || parsed.password) {
      return false;
    }

    // Kiểm tra hostname hợp lệ
    if (!isValidUrlHostname(parsed.hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Phân tách nội dung văn bản thông báo thành mảng các token văn bản thuần ('text')
 * và liên kết an toàn ('link').
 * Tuyệt đối không tạo HTML thô, bảo toàn 100% ký tự xuống dòng, dấu câu và tiếng Việt.
 *
 * @param {string} content
 * @returns {Array<{ type: 'text', value: string } | { type: 'link', value: string, href: string }>}
 */
export function tokenizeTextWithSafeLinks(content) {
  if (content === null || content === undefined) {
    return [];
  }

  const text = String(content);
  if (text.length === 0) {
    return [];
  }

  const rawTokens = [];
  let cursor = 0;

  URL_CANDIDATE_REGEX.lastIndex = 0;
  let match;

  while ((match = URL_CANDIDATE_REGEX.exec(text)) !== null) {
    const matchStart = match.index;
    const rawCandidate = match[0];

    // Kiểm tra ranh giới phía trước ứng viên URL (chống javascript:https://... hoặc dính liền chữ)
    let tokenStart = matchStart;
    while (tokenStart > 0 && !/\s/.test(text[tokenStart - 1])) {
      tokenStart--;
    }
    const leadingPrefix = text.slice(tokenStart, matchStart);
    const hasValidBoundary =
      leadingPrefix.length === 0 || ALLOWED_LEADING_PREFIX_REGEX.test(leadingPrefix);

    if (!hasValidBoundary) {
      continue;
    }

    const { cleanUrl, trailingPunctuation } = stripTrailingUrlPunctuation(rawCandidate);

    if (!cleanUrl || !isSafeHttpUrl(cleanUrl)) {
      continue;
    }

    // Đẩy phần văn bản đứng trước URL
    if (matchStart > cursor) {
      rawTokens.push({
        type: 'text',
        value: text.slice(cursor, matchStart)
      });
    }

    // Đẩy token liên kết đã xác thực an toàn
    rawTokens.push({
      type: 'link',
      value: cleanUrl,
      href: cleanUrl
    });

    // Cập nhật con trỏ tới ngay sau phần cleanUrl (để phần trailingPunctuation được giữ lại làm text)
    cursor = matchStart + cleanUrl.length;

    // Nếu có trailingPunctuation và bên trong nó không thể chứa URL khác thì tiếp tục từ sau cleanUrl
    if (trailingPunctuation.length > 0) {
      URL_CANDIDATE_REGEX.lastIndex = cursor;
    }
  }

  // Đẩy phần văn bản còn lại sau URL cuối cùng
  if (cursor < text.length) {
    rawTokens.push({
      type: 'text',
      value: text.slice(cursor)
    });
  }

  // Gộp các token 'text' liền kề (nếu có) để cây React gọn sạch nhất
  const mergedTokens = [];
  for (const token of rawTokens) {
    if (!token.value) continue;
    const prev = mergedTokens[mergedTokens.length - 1];
    if (token.type === 'text' && prev && prev.type === 'text') {
      prev.value += token.value;
    } else {
      mergedTokens.push({ ...token });
    }
  }

  return mergedTokens;
}

