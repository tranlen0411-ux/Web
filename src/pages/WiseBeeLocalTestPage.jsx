// src/pages/WiseBeeLocalTestPage.jsx
// Trang kiểm thử trực quan cục bộ cho Ong Thông Thái (WISE BEE R1 — LOCAL MOCK VISUAL HARNESS)
// Ràng buộc: Chỉ hoạt động trên Vite Development Server (localhost / 127.0.0.1), loại bỏ hoàn toàn khỏi Production build.
// Tuyệt đối không kết nối Supabase, không gọi Gemini API, không dùng dữ liệu thật.

import React, { useState } from 'react';
import {
  FlaskConical,
  GraduationCap,
  BookOpen,
  ShieldCheck,
  Bell,
  Layers,
  Ban,
  UserX,
  CheckCircle2,
  X,
} from 'lucide-react';
import {
  isLocalDevHarnessAllowed,
  getWiseBeeRoleConfig,
  WISE_BEE_MOCK_IDENTITY_LABEL,
} from '../services/wiseBeeClient.js';
import { WiseBeeLauncher } from '../components/wise-bee/WiseBeeLauncher.jsx';

export const MOCK_HARNESS_PROFILES = Object.freeze({
  student: Object.freeze({
    key: 'student',
    label: '🎒 Học sinh (Student)',
    user: Object.freeze({ id: 'local-mock-student-001' }),
    profile: Object.freeze({
      id: 'local-mock-student-001',
      full_name: '[MOCK] Học Sinh Tiểu Học Lớp 3A',
      role: 'student',
      grade_level: 3,
      is_disabled: false,
    }),
  }),
  teacher: Object.freeze({
    key: 'teacher',
    label: '👩‍🏫 Giáo viên (Teacher)',
    user: Object.freeze({ id: 'local-mock-teacher-001' }),
    profile: Object.freeze({
      id: 'local-mock-teacher-001',
      full_name: '[MOCK] Giáo Viên Chủ Nhiệm',
      role: 'teacher',
      is_disabled: false,
    }),
  }),
  admin: Object.freeze({
    key: 'admin',
    label: '🛡️ Quản trị viên (Admin)',
    user: Object.freeze({ id: 'local-mock-admin-001' }),
    profile: Object.freeze({
      id: 'local-mock-admin-001',
      full_name: '[MOCK] Quản Trị Viên Hệ Thống',
      role: 'admin',
      is_disabled: false,
    }),
  }),
  disabled: Object.freeze({
    key: 'disabled',
    label: '🚫 Tài khoản bị khóa (is_disabled = true)',
    user: Object.freeze({ id: 'local-mock-disabled-001' }),
    profile: Object.freeze({
      id: 'local-mock-disabled-001',
      full_name: '[MOCK] Tài Khoản Đã Khóa',
      role: 'student',
      is_disabled: true,
    }),
  }),
  anonymous: Object.freeze({
    key: 'anonymous',
    label: '👤 Chưa đăng nhập (Anonymous)',
    user: null,
    profile: null,
  }),
});

export const WiseBeeLocalTestPage = () => {
  const [selectedMode, setSelectedMode] = useState('student');
  const [isMockNotificationOpen, setIsMockNotificationOpen] = useState(false);
  const [isMockExerciseModalOpen, setIsMockExerciseModalOpen] = useState(false);

  const isAllowed = isLocalDevHarnessAllowed(
    Boolean(import.meta.env?.DEV),
    typeof window !== 'undefined' ? window.location.hostname : ''
  );

  // Fail-closed: Nếu không phải môi trường DEV trên localhost/127.0.0.1 -> không hiển thị bất kỳ nội dung nào
  if (!isAllowed) {
    return null;
  }

  const currentActor = MOCK_HARNESS_PROFILES[selectedMode] || MOCK_HARNESS_PROFILES.student;
  const activeRoleConfig = currentActor.profile && !currentActor.profile.is_disabled
    ? getWiseBeeRoleConfig(currentActor.profile.role)
    : null;

  const mockAuthOverride = {
    user: currentActor.user,
    profile: currentActor.profile,
    loading: false,
  };

  return (
    <div className="min-h-screen bg-amber-50/70 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Khung tiêu đề & Nhãn nhận diện Local Mock Harness */}
        <section className="bg-white rounded-3xl border-4 border-amber-300 p-6 shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <span className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-amber-100 border-2 border-amber-400 text-amber-950 text-xs font-black">
              <FlaskConical className="w-4 h-4 text-amber-700" aria-hidden="true" />
              <span>LOCALHOST DEV ONLY • {WISE_BEE_MOCK_IDENTITY_LABEL}</span>
            </span>

            <span className="text-xs font-extrabold text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-300">
              🔒 Zero Network • Zero Supabase • Zero Gemini API
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-black text-amber-950 flex items-center gap-2.5">
            <span aria-hidden="true">🐝</span>
            <span>Bàn Kiểm Thử Trực Quan Ong Thông Thái (R1 Mock Harness)</span>
          </h1>
          <p className="mt-2 text-sm font-semibold text-slate-600 leading-relaxed">
            Trang này chỉ tồn tại trên máy chủ phát triển cục bộ (<code>localhost</code>) để kiểm tra trực tiếp
            nút nổi 🐝 ở góc dưới bên phải, cửa sổ Drawer, câu hỏi mẫu theo 3 vai trò, phím <code>ESC</code>,
            cơ chế xóa hội thoại tạm thời trong RAM và khả năng tự ẩn khi mở hộp thư thông báo/modal.
          </p>
        </section>

        {/* Bảng điều khiển 1: Chuyển đổi Vai trò Giả lập */}
        <section className="bg-white rounded-3xl border-2 border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-base font-black text-amber-950">
              1. Chọn Vai Trò Giả Lập (Độc lập 100% với Supabase Auth)
            </h2>
            <span className="text-xs font-bold text-slate-500">
              Khi đổi vai trò, hội thoại tạm trong RAM sẽ tự động xóa sạch
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setSelectedMode('student')}
              className={`p-4 rounded-2xl border-2 text-left transition-all flex items-start gap-3 ${
                selectedMode === 'student'
                  ? 'bg-amber-100/80 border-amber-500 shadow-sm'
                  : 'bg-slate-50 border-slate-200 hover:bg-amber-50/50'
              }`}
            >
              <GraduationCap className="w-6 h-6 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <div className="text-sm font-black text-amber-950">🎒 Học sinh</div>
                <div className="text-xs font-semibold text-slate-600 mt-0.5">
                  Gợi mở Toán & Tiếng Việt tiểu học • Giới hạn 400 ký tự
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setSelectedMode('teacher')}
              className={`p-4 rounded-2xl border-2 text-left transition-all flex items-start gap-3 ${
                selectedMode === 'teacher'
                  ? 'bg-sky-100/80 border-sky-500 shadow-sm'
                  : 'bg-slate-50 border-slate-200 hover:bg-sky-50/50'
              }`}
            >
              <BookOpen className="w-6 h-6 text-sky-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <div className="text-sm font-black text-slate-900">👩‍🏫 Giáo viên</div>
                <div className="text-xs font-semibold text-slate-600 mt-0.5">
                  Gợi ý 5 câu hỏi Toán 3, cách giảng phép nhân, mẫu lời phê
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setSelectedMode('admin')}
              className={`p-4 rounded-2xl border-2 text-left transition-all flex items-start gap-3 ${
                selectedMode === 'admin'
                  ? 'bg-emerald-100/80 border-emerald-500 shadow-sm'
                  : 'bg-slate-50 border-slate-200 hover:bg-emerald-50/50'
              }`}
            >
              <ShieldCheck className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <div className="text-sm font-black text-slate-900">🛡️ Quản trị (Admin)</div>
                <div className="text-xs font-semibold text-slate-600 mt-0.5">
                  Hướng dẫn phân quyền giáo viên, quản lý lớp, thông báo
                </div>
              </div>
            </button>
          </div>

          {/* Hai nút kiểm tra trạng thái bị chặn (Disabled / Anonymous) */}
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-extrabold text-slate-600">
              Kiểm tra trường hợp bị từ chối hiển thị:
            </span>
            <button
              type="button"
              onClick={() => setSelectedMode('disabled')}
              className={`px-3.5 py-2 rounded-xl text-xs font-black border-2 inline-flex items-center gap-1.5 transition-all ${
                selectedMode === 'disabled'
                  ? 'bg-rose-100 border-rose-500 text-rose-950'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-rose-50'
              }`}
            >
              <Ban className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
              <span>Giả lập Tài khoản bị khóa (is_disabled = true)</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedMode('anonymous')}
              className={`px-3.5 py-2 rounded-xl text-xs font-black border-2 inline-flex items-center gap-1.5 transition-all ${
                selectedMode === 'anonymous'
                  ? 'bg-rose-100 border-rose-500 text-rose-950'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-rose-50'
              }`}
            >
              <UserX className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
              <span>Giả lập Chưa đăng nhập (Anonymous)</span>
            </button>
          </div>

          {/* Trạng thái hiện tại */}
          <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div>
              <span className="font-bold text-slate-600">Trạng thái giả lập hiện tại: </span>
              <span className="font-black text-amber-950">{currentActor.label}</span>
            </div>
            <div>
              {activeRoleConfig ? (
                <span className="inline-flex items-center gap-1 font-black text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                  <span>Nút nổi 🐝 Ong Thông Thái đang HIỂN THỊ ở góc dưới bên phải</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-black text-rose-800">
                  <Ban className="w-4 h-4 text-rose-600" aria-hidden="true" />
                  <span>Nút nổi 🐝 Ong Thông Thái đã TỰ ĐỘNG ẨN theo quy tắc bảo mật</span>
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Bảng điều khiển 2: Kiểm tra xung đột với Notifications Drawer & Modal */}
        <section className="bg-white rounded-3xl border-2 border-slate-200 p-6 shadow-xs space-y-4">
          <h2 className="text-base font-black text-amber-950">
            2. Kiểm Tra Chống Xung Đột Giao Diện (Notifications Drawer & Fullscreen Modal)
          </h2>
          <p className="text-xs font-semibold text-slate-600 leading-relaxed">
            Nhấn các nút bên dưới để mở lớp phủ giả lập (không gọi API thông báo hay bài tập thật). Khi lớp phủ
            mở lên, <code>WiseBeeLauncher</code> sẽ tự động phát hiện và ẩn nút 🐝 / đóng Drawer Ong Thông Thái.
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setIsMockNotificationOpen(true)}
              className="px-4 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-amber-950 font-black text-xs border-2 border-amber-700 shadow-xs inline-flex items-center gap-2 transition-all active:scale-95"
            >
              <Bell className="w-4 h-4" aria-hidden="true" />
              <span>Bật thử Hộp thư Thông báo giả lập (Mock Notification Drawer)</span>
            </button>

            <button
              type="button"
              onClick={() => setIsMockExerciseModalOpen(true)}
              className="px-4 py-2.5 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white font-black text-xs border-2 border-sky-800 shadow-xs inline-flex items-center gap-2 transition-all active:scale-95"
            >
              <Layers className="w-4 h-4" aria-hidden="true" />
              <span>Bật thử Modal Bài tập / Chấm bài giả lập (Mock Modal)</span>
            </button>
          </div>
        </section>

        {/* Bảng hướng dẫn kịch bản nghiệm thu nhanh */}
        <section className="bg-white rounded-3xl border-2 border-slate-200 p-6 shadow-xs space-y-2.5">
          <h2 className="text-base font-black text-amber-950">
            3. Danh Mục Kiểm Tra Nhanh Dành Cho Thầy/Cô
          </h2>
          <ul className="text-xs font-semibold text-slate-700 space-y-1.5 list-disc list-inside leading-relaxed">
            <li>
              <strong>Bước 1:</strong> Nhìn góc dưới bên phải màn hình, nhấn nút nổi <strong>🐝 Ong Thông Thái</strong> để mở cửa sổ Drawer.
            </li>
            <li>
              <strong>Bước 2:</strong> Nhấn thử vào các nút <strong>Gợi ý câu hỏi mẫu</strong> để xem phản hồi tiếng Việt theo từng vai trò.
            </li>
            <li>
              <strong>Bước 3 (Kiểm tra chặn PII):</strong> Thử nhập <code>Số điện thoại của em là 0912345678</code> hoặc <code>Mã PIN là 1234</code> để kiểm tra bộ lọc bảo vệ thông tin cá nhân.
            </li>
            <li>
              <strong>Bước 4 (Kiểm tra phím ESC & Xóa RAM):</strong> Nhấn phím <code>ESC</code> để đóng Drawer, sau đó mở lại — toàn bộ tin nhắn cũ đã được xóa sạch khỏi bộ nhớ tạm.
            </li>
          </ul>
        </section>
      </div>

      {/* Lớp phủ giả lập 1: Mock Notification Drawer (.fixed.inset-0) */}
      {isMockNotificationOpen && (
        <div
          className="fixed inset-0 z-50 overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Hộp thư thông báo giả lập"
        >
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
            onClick={() => setIsMockNotificationOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <aside className="w-screen max-w-md bg-white shadow-2xl border-l-4 border-amber-300 flex flex-col justify-between p-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <span className="text-base font-black text-amber-950 flex items-center gap-2">
                    <Bell className="w-5 h-5 text-amber-600" aria-hidden="true" />
                    <span>Hộp Thư Thông Báo (Giả Lập)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsMockNotificationOpen(false)}
                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
                <p className="text-xs font-semibold text-slate-600 leading-relaxed">
                  Khi Hộp thư Thông báo này đang mở (sử dụng lớp phủ <code>.fixed.inset-0</code>), nút nổi 🐝
                  Ong Thông Thái đã tự động ẩn đi để không bao giờ đè lên danh sách thông báo!
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsMockNotificationOpen(false)}
                className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-amber-950 font-black text-xs border-2 border-amber-700"
              >
                Đóng Hộp Thư Giả Lập (Nút 🐝 sẽ hiện lại)
              </button>
            </aside>
          </div>
        </div>
      )}

      {/* Lớp phủ giả lập 2: Mock Exercise/Exam Modal (.fixed.inset-0) */}
      {isMockExerciseModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Modal bài tập giả lập"
        >
          <div className="bg-white rounded-3xl border-4 border-sky-400 max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-black text-slate-900">
              📋 Modal Làm Bài / Chấm Bài (Giả Lập)
            </h3>
            <p className="text-xs font-semibold text-slate-600 leading-relaxed">
              Trong lúc Modal quan trọng này đang mở trên màn hình, nút 🐝 Ong Thông Thái đã tự động ẩn để
              không che nút Nộp bài hay Lưu điểm.
            </p>
            <button
              type="button"
              onClick={() => setIsMockExerciseModalOpen(false)}
              className="w-full py-2.5 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white font-black text-xs"
            >
              Đóng Modal Giả Lập
            </button>
          </div>
        </div>
      )}

      {/* Mount trực tiếp đúng Component WiseBeeLauncher R1 với mockAuthOverride */}
      <WiseBeeLauncher mockAuthOverride={mockAuthOverride} />
    </div>
  );
};

export default WiseBeeLocalTestPage;
