import { Lock, Globe, GraduationCap, HelpCircle } from 'lucide-react';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidUuid = (val) => {
  return typeof val === 'string' && UUID_REGEX.test(val.trim());
};

/**
 * Định dạng ngày giờ theo múi giờ Việt Nam (Asia/Ho_Chi_Minh)
 * Chuẩn định dạng: HH:mm:ss dd/MM/yyyy
 * Không sử dụng updated_at thay thế created_at
 * Nếu thiếu hoặc không hợp lệ, trả về ký tự "—" an toàn
 *
 * @param {string|null|undefined} dateStr
 * @returns {string}
 */
export const formatVietnamDateTime = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string' || dateStr.trim() === '') {
    return '—';
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    return '—';
  }
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(d);
  } catch (_err) {
    return '—';
  }
};

/**
 * Xác định thông tin nguồn gốc câu hỏi (Bản sao vs Câu gốc)
 * - Nếu có forked_from_version_id hợp lệ (chuỗi không rỗng): hiển thị "Bản sao"
 * - Nếu xác minh được câu hỏi không có nguồn fork (forked_from_version_id === null): hiển thị "Câu gốc"
 * - Nếu API không cung cấp đủ dữ liệu (undefined / thiếu trường): trả về null,
 *   tuyệt đối KHÔNG suy đoán dựa trên tên hoặc hậu tố "(Bản sao)"
 *
 * @param {Object} item
 * @returns {{ type: 'clone'|'original'|'unknown', label: string|null, forkedFromVersionId: string|null, isClone: boolean, isOriginal: boolean }}
 */
export const getQuestionOriginInfo = (item) => {
  if (!item || typeof item !== 'object') {
    return {
      type: 'unknown',
      label: null,
      forkedFromVersionId: null,
      isClone: false,
      isOriginal: false
    };
  }

  // 1. Ưu tiên cao nhất: Thuộc tính origin_status tường minh từ Tri-State API Contract
  if (item.origin_status === 'clone') {
    const validForkId = isValidUuid(item.forked_from_version_id) ? item.forked_from_version_id.trim() : null;
    return {
      type: 'clone',
      label: 'Bản sao',
      forkedFromVersionId: validForkId,
      isClone: true,
      isOriginal: false
    };
  }

  if (item.origin_status === 'original') {
    return {
      type: 'original',
      label: 'Câu gốc',
      forkedFromVersionId: null,
      isClone: false,
      isOriginal: true
    };
  }

  if (item.origin_status === 'unknown') {
    return {
      type: 'unknown',
      label: null,
      forkedFromVersionId: null,
      isClone: false,
      isOriginal: false
    };
  }

  // 2. Fallback tương thích ngược (khi API hoặc mock data chưa có origin_status)
  const hasDirectFork = Object.prototype.hasOwnProperty.call(item, 'forked_from_version_id');
  const hasMetaFork = Boolean(
    item.metadata &&
    typeof item.metadata === 'object' &&
    Object.prototype.hasOwnProperty.call(item.metadata, 'forked_from_version_id')
  );

  let rawForkId = undefined;
  if (hasMetaFork) {
    rawForkId = item.metadata.forked_from_version_id;
  } else if (hasDirectFork) {
    rawForkId = item.forked_from_version_id;
  }

  // Có forkId hợp lệ chuẩn UUID
  if (isValidUuid(rawForkId)) {
    return {
      type: 'clone',
      label: 'Bản sao',
      forkedFromVersionId: rawForkId.trim(),
      isClone: true,
      isOriginal: false
    };
  }

  // Fail-closed: Nếu metadata có trường fork nhưng dữ liệu hỏng/chuỗi rác/object/null -> UNKNOWN
  if (hasMetaFork || (hasDirectFork && rawForkId !== null && rawForkId !== undefined)) {
    return {
      type: 'unknown',
      label: null,
      forkedFromVersionId: null,
      isClone: false,
      isOriginal: false
    };
  }

  // Xác minh rõ ràng không có nguồn fork (giá trị là null chuẩn)
  if (rawForkId === null) {
    return {
      type: 'original',
      label: 'Câu gốc',
      forkedFromVersionId: null,
      isClone: false,
      isOriginal: true
    };
  }

  // Thiếu dữ liệu: Tuyệt đối không đoán dựa theo title
  return {
    type: 'unknown',
    label: null,
    forkedFromVersionId: null,
    isClone: false,
    isOriginal: false
  };
};

/**
 * Xác định nhãn và icon hiển thị phạm vi trong Modal xác nhận sao chép
 * - visibility = 'private': "Riêng tư" + icon Lock
 * - visibility = 'public' | 'public_template': "Mẫu công khai" + icon Globe
 * - visibility = 'school' | 'school_shared': "Nội bộ trường" + icon GraduationCap
 * - Giá trị không xác định: hiển thị trung tính, tuyệt đối không tự gắn "Mẫu công khai"
 *
 * @param {string|null|undefined} visibility
 * @returns {{ label: string, icon: any, className: string }}
 */
export const getModalVisibilityDisplay = (visibility) => {
  switch (visibility) {
    case 'private':
      return {
        label: 'Riêng tư',
        icon: Lock,
        className: 'text-slate-700 bg-slate-100 border border-slate-200'
      };
    case 'public':
    case 'public_template':
      return {
        label: 'Mẫu công khai',
        icon: Globe,
        className: 'text-emerald-700 bg-emerald-50 border border-emerald-200'
      };
    case 'school':
    case 'school_shared':
      return {
        label: 'Nội bộ trường',
        icon: GraduationCap,
        className: 'text-indigo-700 bg-indigo-50 border border-indigo-200'
      };
    default:
      return {
        label: (typeof visibility === 'string' && visibility.trim() !== '') ? visibility : 'Chưa xác định',
        icon: HelpCircle,
        className: 'text-slate-500 bg-slate-100 border border-slate-200'
      };
  }
};
