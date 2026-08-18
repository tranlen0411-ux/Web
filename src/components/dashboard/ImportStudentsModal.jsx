import React, { useState, useEffect } from 'react';
import { supabase, supabaseUrl } from '../../lib/supabase';

const OFFICIAL_CLASS_212_STUDENTS = [
  "Trần Lê Hoàng An",
  "Đỗ Hoài Anh",
  "Nguyễn Đình Ân",
  "Hà Gia Bảo",
  "Phạm Ngọc Minh Châu",
  "Nguyễn Công Minh Dương",
  "Nguyễn Võ Khả Hân",
  "Huỳnh Minh Hùng",
  "Phạm Bùi Bảo Khang",
  "Nguyễn Ngọc An Khánh",
  "Nguyễn Phúc Đăng Khoa",
  "Nguyễn Minh Khôi",
  "Nguyễn Trung Kiên",
  "Phạm Thị Hoàng Lâm",
  "Võ Thiên Long",
  "Trần Thị Quỳnh Mai",
  "Lê Thị Tú My",
  "Trần Ngọc Nga",
  "Trần Thị Kim Ngọc",
  "Võ Nguyễn Đăng Nguyên",
  "Nguyễn Ngọc Yến Nhi",
  "Nguyễn Thanh Nhi",
  "Nguyễn An Nhiên",
  "Võ Bảo Như",
  "Lưu Đình Tấn Phát",
  "Nguyễn Trần Mạnh Phi",
  "Nguyễn Ngọc An Phúc",
  "Nguyễn Thanh Phúc",
  "Nguyễn Trí Phúc",
  "Huỳnh Trương Tiến Thành",
  "Hồ Lê Trường Thịnh",
  "Phan Ngọc Bảo Trâm",
  "Phạm Đỗ Anh Tú",
  "Đặng Yến Vy"
];

const parseApiResponse = async (response) => {
  const rawText = await response.text();

  if (!rawText || rawText.trim() === '') {
    throw new Error(
      `Server trả về phản hồi rỗng (HTTP ${response.status}).`
    );
  }

  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(
      `Server trả về dữ liệu không hợp lệ (HTTP ${response.status}).`
    );
  }
};

export function ImportStudentsModal({ isOpen, onClose }) {
  const bulkCreateEnabled = import.meta.env.VITE_ENABLE_BULK_CREATE === 'true';
  const [step, setStep] = useState(1);
  const [classesList, setClassesList] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [rawNamesText, setRawNamesText] = useState(OFFICIAL_CLASS_212_STUDENTS.join('\n'));
  const [lastDryRunNamesText, setLastDryRunNamesText] = useState('');
  const [parsedStudents, setParsedStudents] = useState([]);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [dryRunData, setDryRunData] = useState(null);
  const [prodResult, setProdResult] = useState(null);
  const [isConfirmChecked, setIsConfirmChecked] = useState(false);
  const [hasExecutedProd, setHasExecutedProd] = useState(false);
  const [hasDownloadedCSV, setHasDownloadedCSV] = useState(false);
  const [hasConfirmedDelivery, setHasConfirmedDelivery] = useState(false);

  const [idempotencyKey] = useState(() => `batch_212_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);

  useEffect(() => {
    if (isOpen) {
      fetchTargetClasses();
    } else {
      setStep(1);
      setDryRunData(null);
      setProdResult(null);
      setErrorMessage('');
      setIsConfirmChecked(false);
      setHasExecutedProd(false);
      setHasDownloadedCSV(false);
      setHasConfirmedDelivery(false);
    }
  }, [isOpen]);

  const fetchTargetClasses = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('classes')
        .select('id, name, code, grade_level, teacher_id')
        .order('name');

      if (error) throw error;

      if (data && data.length > 0) {
        setClassesList(data);
        const class212 = data.find(c =>
          c.grade_level === 2 &&
          c.code === 'LOP212-3A5818' &&
          c.name.toLowerCase().replace(/\s+/g, ' ').includes('2.12')
        );
        if (class212) {
          setSelectedClassId(class212.id);
        } else {
          setSelectedClassId(data[0].id);
        }
      }
    } catch (err) {
      setErrorMessage('Không thể tải danh sách lớp học: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleParseNames = () => {
    setErrorMessage('');
    const lines = rawNamesText.split('\n');
    const list = [];
    let count = 1;

    for (const line of lines) {
      const trimmed = line.trim().replace(/\s+/g, ' ');
      if (trimmed) {
        list.push({ stt: count++, fullName: trimmed });
      }
    }

    if (list.length === 0) {
      setErrorMessage('Vui lòng nhập ít nhất 1 họ tên học sinh.');
      return;
    }

    if (list.length > 50) {
      setErrorMessage('Hệ thống chỉ hỗ trợ xử lý tối đa 50 học sinh/lần.');
      return;
    }

    setParsedStudents(list);
    setStep(2);
  };

  const handleRunDryRun = async () => {
    if (!selectedClassId) {
      setErrorMessage('Vui lòng chọn Lớp học.');
      return;
    }
    if (parsedStudents.length === 0) {
      setErrorMessage('Danh sách học sinh không hợp lệ.');
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage('');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Phiên làm việc hết hạn. Vui lòng đăng nhập lại.');
      }

      const response = await fetch(
        `${supabaseUrl}/functions/v1/admin-bulk-create-students`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            classId: selectedClassId,
            students: parsedStudents,
            dryRun: true,
            idempotencyKey: `${idempotencyKey}_dry`,
          }),
        }
      );

      const resData = await parseApiResponse(response);
      if (!response.ok || !resData.success) {
        throw new Error(resData.message || 'Lỗi kiểm tra Dry-Run từ server.');
      }

      setDryRunData(resData);
      setLastDryRunNamesText(rawNamesText);
      setStep(3);
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExecuteProduction = async () => {
    if (!bulkCreateEnabled) {
      setErrorMessage('Chức năng tạo thật đang bị khóa để chờ kiểm thử Runtime.');
      return;
    }
    if (!isConfirmChecked || hasExecutedProd) return;

    if (rawNamesText !== lastDryRunNamesText) {
      setErrorMessage('Danh sách học sinh đã bị thay đổi sau khi chạy Dry-Run. Vui lòng thực hiện Dry-Run lại!');
      setStep(2);
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage('');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Phiên làm việc hết hạn. Vui lòng đăng nhập lại.');
      }

      const response = await fetch(
        `${supabaseUrl}/functions/v1/admin-bulk-create-students`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            classId: selectedClassId,
            students: parsedStudents,
            dryRun: false,
            idempotencyKey,
          }),
        }
      );

      const resData = await parseApiResponse(response);
      if (!response.ok || !resData.success) {
        throw new Error(resData.message || 'Lỗi thực thi nhập danh sách từ server.');
      }

      setProdResult(resData);
      setHasExecutedProd(true);
      setStep(4);
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const escapeCSVField = (val) => {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    return `"${str.replace(/"/g, '""')}"`;
  };

  const handleDownloadCSV = async () => {
    if (!prodResult || !prodResult.results) return;

    const headers = ['STT', 'Họ Và Tên', 'Mã Học Sinh', 'Mã PIN Đăng Nhập', 'Trạng Thái', 'Ghi Chú'];
    const rows = prodResult.results.map(r => [
      r.stt,
      r.fullName,
      r.studentCode || '-',
      r.pin || '',
      r.status,
      r.note
    ]);

    const csvContent = "\uFEFF" + [
      headers.map(escapeCSVField).join(','),
      ...rows.map(row => row.map(escapeCSVField).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Danh_Sach_Hoc_Sinh_Lop_212_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);

    if (!prodResult.batchId) {
      setErrorMessage('Thiếu mã batch nên không thể ghi nhận việc bàn giao thông tin đăng nhập.');
      return;
    }
    if (prodResult.batchId) {
      const { data, error } = await supabase.rpc('initiate_credentials_download', { p_batch_id: prodResult.batchId });
      if (error || data !== true) {
        setErrorMessage('File đã được tạo nhưng chưa ghi nhận được lượt tải. Vui lòng chưa đóng cửa sổ.');
        return;
      }
    }
    setHasDownloadedCSV(true);
  };

  const handleConfirmDelivery = async () => {
    if (!prodResult?.batchId || !hasDownloadedCSV) return;
    const { data, error } = await supabase.rpc('confirm_credentials_delivery', { p_batch_id: prodResult.batchId });
    if (error || data !== true) {
      setErrorMessage('Không thể xác nhận đã lưu thông tin đăng nhập.');
      return;
    }
    setHasConfirmedDelivery(true);
  };

  const handleSafeClose = () => {
    if (step === 4 && hasExecutedProd && !hasConfirmedDelivery) {
      if (!window.confirm('CẢNH BÁO BẢO MẬT: Bạn chưa tải xuống file CSV chứa Mật khẩu PIN của học sinh! Mật khẩu PIN sẽ không thể lấy lại nếu bạn đóng cửa sổ này. Bạn có chắc chắn muốn đóng?')) {
        return;
      }
    }
    onClose();
  };

  if (!isOpen) return null;

  const isProdDisabled = !dryRunData || 
    !bulkCreateEnabled ||
    dryRunData.summary.reviewRequired > 0 || 
    dryRunData.results.length !== parsedStudents.length ||
    rawNamesText !== lastDryRunNamesText ||
    !isConfirmChecked ||
    hasExecutedProd ||
    isLoading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-3xl w-full p-6 border border-slate-200 dark:border-slate-800 transition-all">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <span>📥</span> Nhập Học Sinh Lớp 2.12 Hàng Loạt
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Quy trình 4 bước an toàn: Chuẩn hóa $\rightarrow$ Xem trước Dry-Run $\rightarrow$ Thực thi $\rightarrow$ Tải file CSV
            </p>
          </div>
          <button
            onClick={handleSafeClose}
            disabled={isLoading}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-white text-2xl font-bold px-2 py-1 rounded-lg"
          >
            ✕
          </button>
        </div>

        {errorMessage && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300 rounded-xl text-sm font-medium flex items-center gap-2">
            <span>⚠️</span> {errorMessage}
          </div>
        )}

        {!bulkCreateEnabled && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-sm">
            Tạo tài khoản thật đang khóa. Dry-run vẫn dùng được để kiểm tra danh sách.
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Chọn Lớp Đích (Yêu cầu chính thức: Lớp 2.12):
              </label>
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none"
              >
                {classesList.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} (Khối {c.grade_level}) - Mã: {c.code}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Danh sách 34 Họ tên Học sinh Lớp 2.12 (Mỗi học sinh 1 dòng):
              </label>
              <textarea
                rows={10}
                value={rawNamesText}
                onChange={(e) => setRawNamesText(e.target.value)}
                placeholder="Dán danh sách học sinh vào đây..."
                className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white text-sm font-mono focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={handleSafeClose}
                className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-100 font-semibold text-sm transition-all"
              >
                Hủy
              </button>
              <button
                onClick={handleParseNames}
                className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm shadow-md transition-all flex items-center gap-2"
              >
                Tiếp Tục Đối Chiếu ➔
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-950/30 p-4 rounded-xl border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
              <strong>Đã nhận diện {parsedStudents.length} học sinh.</strong> Vui lòng rà soát lại danh sách trước khi khởi chạy bản xem trước Dry-Run.
            </div>

            <div className="max-h-60 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                <thead className="bg-slate-100 dark:bg-slate-800 font-semibold sticky top-0">
                  <tr>
                    <th className="p-3">STT</th>
                    <th className="p-3">Họ và Tên Chuẩn Hóa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {parsedStudents.map(s => (
                    <tr key={s.stt}>
                      <td className="p-3 font-bold text-slate-500">{s.stt}</td>
                      <td className="p-3 font-medium">{s.fullName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-100 font-semibold text-sm"
              >
                ← Sửa Danh Sách
              </button>
              <button
                onClick={handleRunDryRun}
                disabled={isLoading}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-md transition-all flex items-center gap-2"
              >
                {isLoading ? '⏳ Đang Quét Dry-Run...' : '🔍 Kiểm Tra Dry-Run Bản Xem Trước ➔'}
              </button>
            </div>
          </div>
        )}

        {step === 3 && dryRunData && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-200">
                <span className="block text-xl font-extrabold text-emerald-600">{dryRunData.summary.readyToCreate}</span>
                <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Sẵn Sàng Tạo Mới</span>
              </div>
              <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-200">
                <span className="block text-xl font-extrabold text-blue-600">{dryRunData.summary.alreadyInClass}</span>
                <span className="text-xs font-semibold text-blue-800 dark:text-blue-300">Đã Thuộc Lớp 2.12</span>
              </div>
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200">
                <span className="block text-xl font-extrabold text-amber-600">{dryRunData.summary.reviewRequired}</span>
                <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">Cần Admin Xác Minh</span>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                <thead className="bg-slate-100 dark:bg-slate-800 font-semibold sticky top-0">
                  <tr>
                    <th className="p-2.5">STT</th>
                    <th className="p-2.5">Họ và Tên</th>
                    <th className="p-2.5">Trạng Thái</th>
                    <th className="p-2.5">Ghi Chú Chi Tiết</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {dryRunData.results.map(r => (
                    <tr key={r.stt}>
                      <td className="p-2.5 font-bold text-slate-400">{r.stt}</td>
                      <td className="p-2.5 font-semibold text-slate-800 dark:text-white">{r.fullName}</td>
                      <td className="p-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          r.status === 'READY_TO_CREATE' ? 'bg-emerald-100 text-emerald-800' :
                          r.status === 'ALREADY_IN_CLASS_212' ? 'bg-blue-100 text-blue-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="p-2.5 text-slate-500 dark:text-slate-400">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {dryRunData.summary.reviewRequired > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-semibold flex items-center gap-2">
                <span>🚫</span> Nút thực thi bị khóa vì có {dryRunData.summary.reviewRequired} dòng cần Admin xác minh hoặc bị trùng lặp.
              </div>
            )}

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isConfirmChecked}
                  onChange={(e) => setIsConfirmChecked(e.target.checked)}
                  disabled={dryRunData.summary.reviewRequired > 0 || hasExecutedProd}
                  className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                />
                Tôi đã kiểm tra kỹ bản xem trước Dry-Run và xác nhận chịu trách nhiệm cho thao tác tạo tài khoản thật trên Production.
              </label>
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-100 font-semibold text-sm"
              >
                ← Quay Lại
              </button>
              <button
                onClick={handleExecuteProduction}
                disabled={isProdDisabled}
                className={`px-6 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all flex items-center gap-2 ${
                  isProdDisabled
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
              >
                {isLoading ? '⏳ Đang Tạo Tài Khoản Production...' : '⚡ Xác Nhận Tạo Thật Trên Production ➔'}
              </button>
            </div>
          </div>
        )}

        {step === 4 && prodResult && (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-300 dark:border-emerald-800 text-center">
              <span className="text-3xl">🎉</span>
              <h3 className="text-lg font-bold text-emerald-800 dark:text-emerald-200 mt-1">
                Hoàn Tất Tạo Tài Khoản Lớp 2.12!
              </h3>
              <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                Đã tạo thành công {prodResult.summary.created} tài khoản mới và gán {prodResult.summary.assignedExisting} học sinh có sẵn.
              </p>
            </div>

            {prodResult.replayed && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 font-medium flex items-center gap-2">
                <span>ℹ️</span> 
                <span>
                  <strong>Yêu cầu lặp (Replayed):</strong> Batch này đã hoàn tất từ trước. Mã PIN không được công khai lại để bảo mật.
                  {prodResult.requiresPinReset && " Vui lòng bấm nút 'Cấp lại PIN' bên dưới nếu tài khoản chưa hoàn tất nhận mật khẩu."}
                </span>
              </div>
            )}

            {!prodResult.replayed && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-medium flex items-center gap-2">
                <span>⚠️</span> 
                <span>
                  <strong>Cảnh báo bảo mật:</strong> Mã PIN chỉ hiển thị một lần duy nhất này. Vui lòng bấm Tải CSV bên dưới ngay bây giờ!
                </span>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-3">
              <button
                onClick={handleDownloadCSV}
                disabled={prodResult.replayed || hasConfirmedDelivery}
                className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-lg transition-all flex items-center gap-2"
              >
                <span>💾</span> {hasDownloadedCSV ? '✓ Đã bắt đầu tải CSV' : 'Tải File CSV Mật Khẩu PIN Học Sinh'}
              </button>
              {hasDownloadedCSV && !hasConfirmedDelivery && (
                <button onClick={handleConfirmDelivery}
                  className="px-5 py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm">
                  Tôi xác nhận đã lưu file
                </button>
              )}
              <button
                onClick={handleSafeClose}
                className="px-5 py-3 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white font-bold text-sm"
              >
                Đóng
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
