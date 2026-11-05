// src/services/wiseBeeClient.js
// Wise Bee Gemini V1 (R1) — Pure Local Mock Provider & Role/Input Safety Guard
// R1 Constraint: 100% Frontend Mock Only. Zero network calls, zero Gemini SDK, zero Edge Functions, zero storage persistence.

export const VALID_WISE_BEE_ROLES = Object.freeze(['student', 'teacher', 'admin']);

export const WISE_BEE_MOCK_IDENTITY_LABEL = 'Bản mô phỏng — chưa kết nối Gemini';

export const MAX_QUESTION_LENGTH_BY_ROLE = Object.freeze({
  student: 400,
  teacher: 1000,
  admin: 1000,
});

export const MAX_TURNS_PER_SESSION = 8;

const ROLE_CONFIG_MAP = Object.freeze({
  student: Object.freeze({
    role: 'student',
    badgeText: '🎒 Chế độ Học sinh',
    headerTitle: '🐝 Ong Thông Thái',
    roleSubtitle: '🎒 Chế độ Học sinh • Bạn học Tiểu học',
    title: '🐝 Ong Thông Thái',
    subtitle: '🎒 Chế độ Học sinh • Giải thích từng bước',
    greeting:
      'Chào em! 🐝 Mình là **Ong Thông Thái** (bản mô phỏng). Mình sẽ gợi ý từng bước để em tự hiểu bài thật sâu nhé. Em đang muốn hỏi bài môn gì nào?',
    safetyNotice:
      'Không nhập mật khẩu, mã PIN, SĐT, địa chỉ hoặc dữ liệu cá nhân. Câu trả lời chỉ mang tính hỗ trợ và có thể sai — em hãy hỏi thêm Thầy Cô nhé!',
    disclaimerText:
      '⚠️ Gợi ý mô phỏng (chưa kết nối Gemini) chỉ mang tính hỗ trợ và có thể sai.',
    promptChips: Object.freeze([
      'Ong ơi, giải thích giúp em cách tính chu vi hình chữ nhật.',
      'Ong ơi, giúp em đặt câu với từ chăm chỉ.',
      'Ong ơi, giải thích phép chia cho em.',
    ]),
  }),
  teacher: Object.freeze({
    role: 'teacher',
    badgeText: '👩‍🏫 Chế độ Giáo viên',
    headerTitle: '🐝 Ong Thông Thái',
    roleSubtitle: '👩‍🏫 Chế độ Giáo viên • Trợ lý Sư phạm',
    title: '🐝 Ong Thông Thái',
    subtitle: '👩‍🏫 Chế độ Giáo viên • Trợ lý Sư phạm',
    greeting:
      'Kính chào Thầy/Cô! 🐝 Đây là **Ong Thông Thái** (bản mô phỏng dành cho Giáo viên). Em hỗ trợ gợi ý mẫu câu hỏi ôn tập, phương pháp giảng dạy và lời nhận xét học sinh.',
    safetyNotice:
      'Không đưa dữ liệu cá nhân/điểm số học sinh, mật khẩu hoặc mã PIN vào AI. Gợi ý chỉ mang tính hỗ trợ, có thể sai — cần Thầy/Cô duyệt trước khi dùng.',
    disclaimerText:
      '⚠️ Nội dung mô phỏng (chưa kết nối Gemini) có thể sai và không tự tạo bài tập/chấm điểm thật.',
    promptChips: Object.freeze([
      'Gợi ý 5 câu hỏi Toán lớp 3.',
      'Gợi ý cách giảng phép nhân cho học sinh lớp 2.',
      'Viết mẫu lời nhận xét khích lệ học sinh.',
    ]),
  }),
  admin: Object.freeze({
    role: 'admin',
    badgeText: '🛡️ Chế độ Quản trị',
    headerTitle: '🐝 Ong Thông Thái',
    roleSubtitle: '🛡️ Chế độ Quản trị • Cố vấn Hệ thống',
    title: '🐝 Ong Thông Thái',
    subtitle: '🛡️ Chế độ Quản trị • Cố vấn Hệ thống',
    greeting:
      'Kính chào Quản trị viên! 🐝 Đây là **Ong Thông Thái** (bản mô phỏng dành cho Admin). Em cung cấp hướng dẫn minh họa về phân quyền, quản lý lớp và kiểm tra thông báo.',
    safetyNotice:
      'Không nhập mật khẩu, mã PIN, khóa bí mật hoặc dữ liệu cá nhân. Nội dung mô phỏng chỉ mang tính hỗ trợ, có thể sai và không tự thực thi lệnh hệ thống.',
    disclaimerText:
      '⚠️ Hướng dẫn mô phỏng (chưa kết nối Gemini) có thể sai và không thao tác cơ sở dữ liệu thật.',
    promptChips: Object.freeze([
      'Hướng dẫn phân quyền giáo viên.',
      'Giải thích cách quản lý lớp.',
      'Hướng dẫn kiểm tra thông báo hệ thống.',
    ]),
  }),
});

/**
 * Xác định vai trò hợp lệ từ AuthContext (user + profile).
 * Chỉ chấp nhận 'student', 'teacher', 'admin' khi tài khoản đang hoạt động (is_disabled !== true).
 */
export function resolveWiseBeeRole(user, profile) {
  if (!user || typeof user.id !== 'string' || !user.id.trim()) {
    return null;
  }
  if (!profile || typeof profile !== 'object') {
    return null;
  }
  if (profile.is_disabled === true) {
    return null;
  }
  const rawRole = typeof profile.role === 'string' ? profile.role.trim() : '';
  if (!VALID_WISE_BEE_ROLES.includes(rawRole)) {
    return null;
  }
  return rawRole;
}

/**
 * Lấy cấu hình giao diện và gợi ý theo vai trò đã xác thực.
 */
export function getWiseBeeRoleConfig(role) {
  if (!VALID_WISE_BEE_ROLES.includes(role)) {
    return null;
  }
  return ROLE_CONFIG_MAP[role];
}

export const WISE_BEE_PRODUCTION_GATE_DEFAULT = false;

/**
 * Kiểm tra công tắc tính năng (Feature Gate) cho Wise Bee R1 Mock.
 * Mặc định TẮT (false) trên mọi bản build triển khai (Production/Preview).
 * Chỉ cho phép khi chạy Vite DEV hoặc khi cờ build-time được bật tường minh.
 */
export function isWiseBeeMockFeatureEnabled(env) {
  if (!env || typeof env !== 'object') {
    return WISE_BEE_PRODUCTION_GATE_DEFAULT;
  }
  return Boolean(env.DEV === true || env.VITE_ENABLE_WISE_BEE_MOCK === 'true');
}

/**
 * Kiểm tra chỉ cho phép trang kiểm thử cục bộ hoạt động khi chạy Vite DEV trên localhost/127.0.0.1
 */
export function isLocalDevHarnessAllowed(isDevEnv, hostname) {
  if (isDevEnv !== true) return false;
  if (typeof hostname !== 'string') return false;
  const cleanHost = hostname.trim().toLowerCase();
  return cleanHost === 'localhost' || cleanHost === '127.0.0.1';
}

/**
 * Kiểm tra đường dẫn hiện tại có thuộc vùng cần ẩn nút Ong Thông Thái không
 * (Đấu trường Competition, màn hình đang chơi Game/SCORM, trang Đăng nhập, Test Harness)
 */
export function isWiseBeeSuppressedRoute(pathname) {
  if (typeof pathname !== 'string') return true;
  const cleanPath = pathname.trim().toLowerCase();
  if (
    cleanPath.startsWith('/auth') ||
    cleanPath.startsWith('/reset-password') ||
    cleanPath.startsWith('/competition') ||
    cleanPath.startsWith('/play/') ||
    cleanPath.startsWith('/phase2-device-test')
  ) {
    return true;
  }
  return false;
}

/**
 * Kiểm tra trong DOM hiện tại có modal/drawer toàn màn hình hoặc chế độ Fullscreen đang mở không
 * (Bỏ qua chính Portal của Ong Thông Thái `data-wise-bee-portal="true"`)
 */
export function detectExternalBlockingOverlay(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return false;

  if (doc.fullscreenElement) {
    return true;
  }

  if (typeof doc.querySelectorAll !== 'function') {
    return false;
  }

  const fixedOverlays = doc.querySelectorAll('.fixed.inset-0');
  for (let i = 0; i < fixedOverlays.length; i += 1) {
    const el = fixedOverlays[i];
    if (el && typeof el.closest === 'function' && !el.closest('[data-wise-bee-portal="true"]')) {
      return true;
    }
  }

  return false;
}

/**
 * Tách các cụm in đậm `**văn bản**` trong 1 dòng thành mảng token thuần dữ liệu (Text / Bold).
 * Tuyệt đối không phân tích hay cho phép thẻ HTML (chống XSS 100%).
 */
export function tokenizeWiseBeeInlineBold(lineText) {
  if (typeof lineText !== 'string' || lineText.length === 0) {
    return [];
  }

  const segments = [];
  const boldRegex = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match = boldRegex.exec(lineText);

  while (match !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        value: lineText.slice(lastIndex, match.index),
      });
    }
    segments.push({
      type: 'bold',
      value: match[1],
    });
    lastIndex = match.index + match[0].length;
    match = boldRegex.exec(lineText);
  }

  if (lastIndex < lineText.length) {
    segments.push({
      type: 'text',
      value: lineText.slice(lastIndex),
    });
  }

  return segments.length > 0 ? segments : [{ type: 'text', value: lineText }];
}

/**
 * Phân tích văn bản nhiều dòng của Ong Thông Thái thành các dòng có cấu trúc:
 * - paragraph: đoạn văn thường
 * - bullet: dòng danh sách đầu dòng (•, -, *)
 * - numbered: dòng danh sách đánh số (1., 2., 1️⃣, 2️⃣...)
 */
export function tokenizeWiseBeeFormattedText(rawText) {
  if (typeof rawText !== 'string' || !rawText) {
    return [];
  }

  const lines = rawText.split(/\r?\n/);
  return lines.map((rawLine) => {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      return { type: 'empty', marker: '', segments: [] };
    }

    // Dòng danh sách kiểu bullet: • ..., - ..., * ...
    const bulletMatch = trimmed.match(/^([•\-*])\s+(.+)$/);
    if (bulletMatch) {
      return {
        type: 'bullet',
        marker: '•',
        segments: tokenizeWiseBeeInlineBold(bulletMatch[2]),
      };
    }

    // Dòng danh sách đánh số hoặc emoji số: 1. ..., 1️⃣ ...
    const numberedMatch = trimmed.match(/^((?:\d+\.)|(?:[1-9]️⃣))\s+(.+)$/);
    if (numberedMatch) {
      return {
        type: 'numbered',
        marker: numberedMatch[1],
        segments: tokenizeWiseBeeInlineBold(numberedMatch[2]),
      };
    }

    return {
      type: 'paragraph',
      marker: '',
      segments: tokenizeWiseBeeInlineBold(trimmed),
    };
  });
}

// Các mẫu kiểm tra an toàn cục bộ (Heuristic Pre-flight Filters — Hỗ trợ đầy đủ Tiếng Việt Unicode)
const PHONE_REGEX = /(?:\+?84|0)[35789]\d{8}(?!\d)/;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const SECRET_OR_PIN_REGEX =
  /(?<![\p{L}\p{N}])(?:mật\s*khẩu|mat\s*khau|password|mã\s*pin|ma\s*pin|api\s*key|service_role|secret\s*key|địa\s*chỉ\s*nhà|dia\s*chi\s*nha|số\s*điện\s*thoại|so\s*dien\s*thoai)(?![\p{L}\p{N}])/iu;
const PROMPT_INJECTION_REGEX =
  /(?:ignore\s+(?:all\s+|previous\s+)?instructions|bỏ\s+qua\s+(?:mọi\s+|tất\s+cả\s+)?(?:hướng\s+dẫn|quy\s+tắc)|system\s*prompt|đóng\s+vai\s+admin|cấp\s+quyền\s+admin|drop\s+table|select\s+\*\s+from)/iu;
const HARMFUL_OR_DISTRESS_REGEX =
  /(?<![\p{L}\p{N}])(?:tự\s*tử|tự\s*làm\s*đau|muốn\s*chết|đánh\s*bạn|bạo\s*lực|vũ\s*khí|ma\s*túy|cá\s*độ|đánh\s*bạc)(?![\p{L}\p{N}])/iu;
const EXAM_CHEATING_REGEX =
  /(?:cho\s+(?:em|tôi|mình)\s+(?:toàn\s+bộ\s+)?đáp\s+án\s+đề\s+(?:thi|kiểm\s+tra)|giải\s+hộ\s+(?:toàn\s+bộ\s+)?bài\s+kiểm\s+tra)/iu;

/**
 * Kiểm tra an toàn câu hỏi đầu vào (cục bộ, không ghi log nội dung câu hỏi).
 */
export function inspectQuestionSafety(rawQuestion, role) {
  if (!VALID_WISE_BEE_ROLES.includes(role)) {
    return {
      allowed: false,
      reasonCode: 'INVALID_ROLE',
      userMessage: 'Phiên vai trò chưa hợp lệ để sử dụng Ong Thông Thái.',
    };
  }

  if (typeof rawQuestion !== 'string') {
    return {
      allowed: false,
      reasonCode: 'EMPTY_INPUT',
      userMessage: 'Vui lòng nhập nội dung câu hỏi.',
    };
  }

  const trimmed = rawQuestion.trim();
  if (!trimmed) {
    return {
      allowed: false,
      reasonCode: 'EMPTY_INPUT',
      userMessage: 'Vui lòng nhập câu hỏi hoặc chọn một gợi ý bên trên.',
    };
  }

  const maxLen = MAX_QUESTION_LENGTH_BY_ROLE[role] || 400;
  if (trimmed.length > maxLen) {
    return {
      allowed: false,
      reasonCode: 'MAX_LENGTH_EXCEEDED',
      userMessage: `Câu hỏi vượt quá giới hạn ${maxLen} ký tự. Vui lòng rút gọn câu hỏi nhé!`,
    };
  }

  if (HARMFUL_OR_DISTRESS_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reasonCode: 'SAFETY_DISTRESS_OR_HARMFUL',
      userMessage:
        '🐝 Ong Thông Thái rất quan tâm đến sự an toàn của bạn. Với nội dung này, bạn hãy dừng lại và trò chuyện ngay với Thầy Cô giáo, Cha Mẹ hoặc người lớn đáng tin cậy để được giúp đỡ nhé!',
    };
  }

  if (PHONE_REGEX.test(trimmed) || EMAIL_REGEX.test(trimmed) || SECRET_OR_PIN_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reasonCode: 'PRIVACY_PII_DETECTED',
      userMessage:
        '🔒 Để bảo vệ an toàn thông tin cá nhân, vui lòng KHÔNG nhập số điện thoại, email, địa chỉ nhà, mật khẩu, mã PIN hoặc khóa bí mật vào khung trò chuyện.',
    };
  }

  if (PROMPT_INJECTION_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reasonCode: 'PROMPT_INJECTION_BLOCKED',
      userMessage:
        '🛡️ Ong Thông Thái chỉ hỗ trợ giải đáp học tập và hướng dẫn sử dụng theo đúng vai trò tài khoản hiện tại, không thực hiện lệnh thay đổi quy tắc hệ thống.',
    };
  }

  if (role === 'student' && EXAM_CHEATING_REGEX.test(trimmed)) {
    return {
      allowed: false,
      reasonCode: 'ACADEMIC_INTEGRITY_NOTICE',
      userMessage:
        '🐝 Ong Thông Thái không đưa sẵn toàn bộ đáp án của bài kiểm tra đâu nhé! Em hãy cho Ong biết em đang vướng ở bước nào, Ong sẽ gợi ý quy tắc để em tự làm được bài.',
    };
  }

  return {
    allowed: true,
    reasonCode: 'OK',
    sanitizedQuestion: trimmed,
  };
}

/**
 * Bộ câu trả lời mẫu thuần cục bộ theo đúng vai trò (R1 Mock Provider).
 */
function buildMockReplyForRole(role, question) {
  const qLower = question.toLowerCase();

  if (role === 'student') {
    if (qLower.includes('chu vi') && qLower.includes('hình chữ nhật')) {
      return [
        '🐝 Tuyệt vời! Để tính **chu vi hình chữ nhật**, chúng mình cùng nhớ quy tắc rất dễ này nhé:',
        '1️⃣ Bước 1: Kiểm tra xem chiều dài và chiều rộng đã cùng đơn vị đo (như cm, dm, m) chưa.',
        '2️⃣ Bước 2: Lấy **(Chiều dài + Chiều rộng)** rồi **nhân với 2**.',
        '💡 Ví dụ nhỏ: Một hình chữ nhật có chiều dài 8 cm và chiều rộng 4 cm.',
        '• Tổng chiều dài và chiều rộng là: 8 + 4 = 12 (cm).',
        '• Chu vi hình chữ nhật là: 12 × 2 = 24 (cm).',
        '❓ Bây giờ em thử tính giúp Ong: Nếu hình chữ nhật có chiều dài 10 cm và chiều rộng 5 cm thì chu vi bằng bao nhiêu nào?',
      ].join('\n');
    }

    if (qLower.includes('chăm chỉ')) {
      return [
        '🐝 Từ **"chăm chỉ"** dùng để chỉ tính nết siêng năng, chịu khó làm việc hoặc học tập đều đặn đó em!',
        'Để đặt câu thật hay, em có thể ghép theo 2 phần: **Ai (con gì)** + **chăm chỉ làm việc gì**:',
        '• Mẫu 1 (về học tập): "Bạn Lan rất chăm chỉ nghe giảng và làm bài tập mỗi ngày."',
        '• Mẫu 2 (về loài vật): "Những chú ong vàng chăm chỉ đi tìm mật từ sáng sớm."',
        '❓ Em thích đặt câu về một người bạn trong lớp hay về một con vật đáng yêu? Em thử viết một câu của riêng mình nhé!',
      ].join('\n');
    }

    if (qLower.includes('phép chia')) {
      return [
        '🐝 **Phép chia** chính là cách chúng mình chia đều một số đồ vật thành các phần bằng nhau đó em!',
        '🌟 Ví dụ gần gũi nhé: Em có **12 chiếc kẹo**, muốn chia đều cho **3 bạn**.',
        '• Nếu phát mỗi lượt 1 chiếc cho từng bạn, sau 4 lượt thì vừa hết 12 chiếc kẹo.',
        '• Vậy mỗi bạn nhận được **4 chiếc kẹo**. Ta viết phép tính: **12 : 3 = 4**.',
        '💡 Mẹo nhỏ của Ong: Phép chia là người bạn ngược lại của phép nhân! Vì 3 × 4 = 12 nên 12 : 3 = 4.',
        '❓ Đố em: Nếu có 10 quả táo chia đều vào 2 đĩa thì mỗi đĩa có mấy quả táo nhỉ?',
      ].join('\n');
    }

    return [
      '🐝 Ong Thông Thái (bản mô phỏng) đã nhận được câu hỏi của em!',
      'Để tự giải quyết bài học này, em hãy thử làm theo 3 bước nhỏ sau nhé:',
      '1️⃣ Đọc kỹ đề bài xem bài đã cho biết những gì và hỏi điều gì.',
      '2️⃣ Nhớ lại quy tắc hoặc công thức Thầy Cô đã dạy trên lớp.',
      '3️⃣ Tự nháp từng bước rồi kiểm tra lại kết quả.',
      '💬 Nếu chỗ nào vẫn còn khó hiểu, em hãy hỏi Thầy Cô giáo hoặc bấm vào các gợi ý mẫu phía trên nhé!',
    ].join('\n');
  }

  if (role === 'teacher') {
    if (qLower.includes('5 câu hỏi toán lớp 3') || (qLower.includes('toán') && qLower.includes('lớp 3'))) {
      return [
        '👩‍🏫 **[Bản mẫu tham khảo — Toán Lớp 3 (GDPT 2018)]**',
        'Dưới đây là 5 câu hỏi ôn tập gợi ý theo mức độ từ Nhận biết đến Vận dụng:',
        '1. [Nhận biết] Số gồm 4 nghìn, 0 trăm, 5 chục và 8 đơn vị được viết là số nào?',
        '2. [Nhận biết] Kết quả của phép tính 215 × 4 là bao nhiêu?',
        '3. [Thông hiểu] Tìm x, biết: x : 6 = 124 (dư 3).',
        '4. [Thông hiểu] Một hình chữ nhật có chiều dài 14 cm, chiều rộng bằng nửa chiều dài. Tính chu vi hình chữ nhật đó.',
        '5. [Vận dụng] Có 45 lít mật ong rót đều vào 5 can. Hỏi nếu có 72 lít mật ong thì cần mấy can như thế?',
        '📌 Lưu ý: Đây là nội dung mô phỏng. Hệ thống KHÔNG tự động lưu vào Ngân hàng câu hỏi; Thầy/Cô vui lòng kiểm duyệt trước khi sử dụng.',
      ].join('\n');
    }

    if (qLower.includes('phép nhân') && qLower.includes('lớp 2')) {
      return [
        '👩‍🏫 **[Gợi ý phương pháp giảng dạy — Phép nhân Lớp 2]**',
        '1️⃣ Khởi động trực quan (Cộng các số hạng bằng nhau):',
        '• Cho học sinh quan sát 3 đĩa cam, mỗi đĩa có 2 quả: 2 + 2 + 2 = 6.',
        '• Nhấn mạnh: "2 được lấy 3 lần", từ đó giới thiệu ký hiệu gọn hơn là phép nhân: 2 × 3 = 6.',
        '2️⃣ Hoạt động nhóm nhỏ:',
        '• Phát thẻ hình (hoặc que tính) để học sinh tự xếp "5 được lấy 2 lần" và đọc to phép nhân tương ứng.',
        '3️⃣ Củng cố bằng trò chơi Học Vui:',
        '• Kết hợp trò chơi ghép cặp tổng các số hạng bằng nhau với phép nhân tương ứng để học sinh nhớ bản chất thay vì học vẹt.',
      ].join('\n');
    }

    if (qLower.includes('nhận xét') || qLower.includes('khích lệ')) {
      return [
        '👩‍🏫 **[Mẫu lời nhận xét khích lệ học sinh tiểu học (Chuẩn Thông tư 27)]**',
        '• Mẫu 1 (Học sinh hoàn thành tốt): "Cô khen em trình bày bài cẩn thận, nắm vững kiến thức và tính toán rất chính xác. Em hãy tiếp tục phát huy nhé! 🌟"',
        '• Mẫu 2 (Học sinh có tiến bộ): "Dạo này em đã chú ý đọc kỹ đề và làm bài tiến bộ hơn nhiều rồi đó! Ở câu cuối em chỉ cần kiểm tra lại bước đặt tính một chút nữa là tuyệt vời."',
        '• Mẫu 3 (Cần rèn luyện thêm): "Em đã cố gắng hoàn thành bài tập. Cô đã khoanh tròn bước cần lưu ý trên ảnh bài làm, em xem lại gợi ý của Cô và thử làm lại nhé, Cô tin em sẽ làm được!"',
      ].join('\n');
    }

    return [
      '👩‍🏫 **[Phản hồi mô phỏng — Chế độ Giáo viên]**',
      'Trong phiên bản mô phỏng R1 (chưa kết nối Gemini thật), Ong Thông Thái cung cấp các mẫu cấu trúc sư phạm để Thầy/Cô trải nghiệm giao diện.',
      '• Thầy/Cô có thể nhấn vào 3 nút gợi ý mẫu phía trên để xem ví dụ soạn câu hỏi Toán lớp 3, phương pháp giảng phép nhân lớp 2 và mẫu lời phê khích lệ học sinh.',
      '• Mọi nội dung chỉ hiển thị tại khung chat này, hoàn toàn không tự động tạo bài tập hay chỉnh sửa điểm số trên hệ thống.',
    ].join('\n');
  }

  // role === 'admin'
  if (qLower.includes('phân quyền') || qLower.includes('giáo viên')) {
    return [
      '🛡️ **[Hướng dẫn minh họa — Phân quyền Giáo viên trên Học Vui]**',
      '1️⃣ Truy cập trang Quản trị (`/admin?tab=users` — Quản lý người dùng).',
      '2️⃣ Tạo hoặc kiểm tra tài khoản Giáo viên với vai trò `teacher` trong bảng hồ sơ.',
      '3️⃣ Để gán Giáo viên phụ trách lớp: Mở mục quản lý Lớp học hoặc nhấn nút "Phân công lớp" trên dòng tài khoản giáo viên.',
      '4️⃣ Sau khi được gán lớp (`classes.teacher_id`), Giáo viên chỉ được xem/quản lý học sinh, bài tập học thuật và thông báo thuộc phạm vi lớp mình phụ trách (được bảo vệ bởi RLS ở Backend).',
      '📌 Lưu ý: Ong Thông Thái chỉ hướng dẫn quy trình, tuyệt đối không tự thực thi lệnh cấp quyền.',
    ].join('\n');
  }

  if (qLower.includes('quản lý lớp')) {
    return [
      '🛡️ **[Hướng dẫn minh họa — Quy trình Quản lý Lớp học]**',
      '1️⃣ Khởi tạo & Danh sách lớp: Quản trị viên tạo lớp theo khối (`grade_level` từ 1 đến 5) và phân công giáo viên chủ nhiệm.',
      '2️⃣ Thành viên lớp (`class_members`): Học sinh được xếp vào lớp hoạt động (`is_active = true`).',
      '3️⃣ Bộ lọc lớp toàn cục (Header Filter): Trên thanh điều hướng phía trên, Admin và Giáo viên có thể lọc nhanh theo từng lớp để kiểm tra bài giao, bảng xếp hạng và danh sách học sinh.',
    ].join('\n');
  }

  if (qLower.includes('thông báo')) {
    return [
      '🛡️ **[Hướng dẫn minh họa — Kiểm tra Hệ thống Thông báo (Notifications V1)]**',
      '1️⃣ Mở tab **Quản lý Thông báo** trên bảng điều khiển Admin (`/admin?tab=notifications`).',
      '2️⃣ Kiểm tra trạng thái các thông báo: Bản nháp (`draft`), Đã xuất bản (`published`), hoặc Đã thu hồi (`recalled`).',
      '3️⃣ Khi xuất bản thông báo toàn trường (`school`), theo khối (`grade`), theo lớp (`class`) hoặc cá nhân (`individual`), hệ thống tự động tạo bản ghi người nhận và hiển thị số chưa đọc trên biểu tượng chuông 🔔 của Giáo viên/Học sinh.',
    ].join('\n');
  }

  return [
    '🛡️ **[Phản hồi mô phỏng — Chế độ Quản trị viên]**',
    'Đây là giao diện mô phỏng R1 của Ong Thông Thái dành cho Admin (chưa kết nối Gemini API).',
    '• Quản trị viên có thể chọn các nút gợi ý mẫu phía trên để xem hướng dẫn phân quyền giáo viên, quản lý lớp học và kiểm tra thông báo hệ thống.',
    '• Hệ thống cam kết không nhận quyền Database Admin, không chứa khóa bí mật và không chạy câu lệnh SQL/RPC từ khung chat này.',
  ].join('\n');
}

/**
 * Xử lý câu hỏi bằng Mock Provider thuần cục bộ (R1).
 * Tuyệt đối không gọi mạng (Zero network calls), không dùng Gemini SDK, không ghi log nội dung chat.
 */
export async function requestWiseBeeMockReply({
  role,
  question,
  simulatedDelayMs = 150,
  simulateError = false,
  featureEnabled = typeof import.meta !== 'undefined' && import.meta.env
    ? Boolean(import.meta.env.DEV)
    : true,
} = {}) {
  if (!featureEnabled) {
    return {
      ok: false,
      error: {
        code: 'FEATURE_DISABLED_IN_PRODUCTION',
        message: 'Tính năng Ong Thông Thái (bản mô phỏng R1) hiện đang tắt trên môi trường triển khai.',
      },
    };
  }

  const validRole = VALID_WISE_BEE_ROLES.includes(role) ? role : null;
  if (!validRole) {
    return {
      ok: false,
      error: {
        code: 'UNAUTHORIZED_ROLE',
        message: 'Tài khoản hiện tại không có quyền sử dụng Ong Thông Thái.',
      },
    };
  }

  const safetyCheck = inspectQuestionSafety(question, validRole);
  if (!safetyCheck.allowed) {
    return {
      ok: false,
      error: {
        code: safetyCheck.reasonCode,
        message: safetyCheck.userMessage,
      },
    };
  }

  const delay = typeof simulatedDelayMs === 'number' && simulatedDelayMs >= 0 ? Math.min(simulatedDelayMs, 1000) : 150;
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  if (simulateError) {
    return {
      ok: false,
      error: {
        code: 'MOCK_TEMPORARY_ERROR',
        message: 'Không thể lấy phản hồi mô phỏng lúc này. Vui lòng nhấn "Thử lại" nhé!',
      },
    };
  }

  const replyText = buildMockReplyForRole(validRole, safetyCheck.sanitizedQuestion);

  return {
    ok: true,
    data: {
      role: validRole,
      reply: replyText,
      isMock: true,
      mockLabel: WISE_BEE_MOCK_IDENTITY_LABEL,
    },
  };
}
