// src/components/wise-bee/WiseBeeSafetyBanner.jsx
// Thanh cảnh báo an toàn thông tin cá nhân & nhãn nhận diện Bản mô phỏng rút gọn (R1 UI Polish)

import React from 'react';
import { ShieldAlert, FlaskConical } from 'lucide-react';
import { getWiseBeeRoleConfig, WISE_BEE_MOCK_IDENTITY_LABEL } from '../../services/wiseBeeClient.js';

export const WiseBeeSafetyBanner = ({ role }) => {
  const roleConfig = getWiseBeeRoleConfig(role);
  if (!roleConfig) return null;

  return (
    <div
      className="px-3.5 py-2 bg-amber-50/90 border-b border-amber-200 space-y-1"
      role="region"
      aria-label="Cảnh báo an toàn và trạng thái mô phỏng"
    >
      {/* Dòng 1: Nhãn bắt buộc E4 — Bản mô phỏng — chưa kết nối Gemini */}
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-200/80 text-amber-950 border border-amber-400">
          <FlaskConical className="w-3 h-3 text-amber-800 shrink-0" aria-hidden="true" />
          <span>{WISE_BEE_MOCK_IDENTITY_LABEL}</span>
        </span>
      </div>

      {/* Dòng 2: Cảnh báo an toàn rút gọn (bảo toàn nhắc nhở mật khẩu, PIN, dữ liệu cá nhân & khả năng AI sai) */}
      <div className="flex items-start gap-1.5 text-[11px] text-amber-950 leading-snug">
        <ShieldAlert className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="font-semibold">{roleConfig.safetyNotice}</p>
      </div>
    </div>
  );
};
