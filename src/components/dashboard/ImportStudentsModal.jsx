import React, { useState, useEffect } from 'react';
import { X, FileSpreadsheet, CheckCircle2, AlertTriangle, Download, RefreshCw, Users, ShieldAlert, Sparkles, Eye, Lock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useSound } from '../../context/SoundContext';

const DEFAULT_34_STUDENTS_TEXT = `Trần Lê Hoàng An
Đỗ Hoài Anh
Nguyễn Đình Ân
Hà Gia Bảo
Phạm Ngọc Minh Châu
Nguyễn Công Minh Dương
Nguyễn Võ Khả Hân
Huỳnh Minh Hùng
Phạm Bùi Bảo Khang
Nguyễn Ngọc An Khánh
Nguyễn Phúc Đăng Khoa
Nguyễn Minh Khôi
Nguyễn Trung Kiên
Phạm Thị Hoàng Lâm
Võ Thiên Long
Trần Thị Quỳnh Mai
Lê Thị Tú My
Trần Ngọc Nga
Trần Thị Kim Ngọc
Võ Nguyễn Đăng Nguyên
Nguyễn Ngọc Yến Nhi
Nguyễn Thanh Nhi
Nguyễn An Nhiên
Võ Bảo Như
Lưu Đình Tấn Phát
Nguyễn Trần Mạnh Phi
Nguyễn Ngọc An Phúc
Nguyễn Thanh Phúc
Nguyễn Trí Phúc
Huỳnh Trương Tiến Thành
Hồ Lê Trường Thịnh
Phan Ngọc Bảo Trâm
Phạm Đỗ Anh Tú
Đặng Yến Vy`;

export const ImportStudentsModal = ({ isOpen, onClose, onImportCompleted }) => {
  const { triggerSound } = useSound();
  const [classesList, setClassesList] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [rawInputText, setRawInputText] = useState(DEFAULT_34_STUDENTS_TEXT);
  const [parsedStudents, setParsedStudents] = useState([]);
  
  // Trạng thái từng bước: 
  // Step 1: Input & Run Dry-Run Preview
  // Step 2: Display Dry-Run Preview Result (Must succeed before Production execution)
  // Step 3: Executing Production Batch Creation
  // Step 4: Final Results & Download CSV (PINs cleared upon closing)
  const [currentStep, setCurrentStep] = useState(1);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [dryRunResult, setDryRunResult] = useState(null);
  const [productionResult, setProductionResult] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchClasses();
      parseInput(DEFAULT_34_STUDENTS_TEXT);
      resetAllState();
    }
  }, [isOpen]);

  const resetAllState = () => {
    setCurrentStep(1);
    setErrorMsg('');
    setDryRunResult(null);
    setProductionResult(null);
    setLoading(false);
  };

  const handleCloseModal = () => {
    // XÓA NGAY TOÀN BỘ BỘ NHỚ CHỨA PIN TRONG STATE THEO YÊU CẦU BẢO MẬT
    setDryRunResult(null);
    setProductionResult(null);
    setParsedStudents([]);
    setErrorMsg('');
    onClose();
  };

  const fetchClasses = async () => {
    try {
      const { data, error } = await supabase
        .from('classes')
        .select('id, name, grade_level, code, teacher_id')
        .order('grade_level', { ascending: true })
        .order('name', { ascending: true });

      if (!error && data && data.length > 0) {
        setClassesList(data);
        const class212 = data.find(c => c.name.toLowerCase().includes('2.12') && c.grade_level === 2);
        if (class212) {
          setSelectedClassId(class212.id);
        } else {
          setSelectedClassId(data[0].id);
        }
      }
    } catch (err) {
      console.error('Fetch classes error:', err);
    }
  };

  const parseInput = (text) => {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const list = lines.map((line, index) => {
      const cleanName = line.replace(/^\d+[\.\-\s]+/, '').trim();
      return {
        stt: index + 1,
        fullName: cleanName,
      };
    });

    setParsedStudents(list);
  };

  const handleInputChange = (e) => {
    const text = e.target.value;
    setRawInputText(text);
    parseInput(text);
    setDryRunResult(null);
    if (currentStep > 1) setCurrentStep(1);
  };

  // CHẠY KIỂM TRA DRY-RUN PREVIEW TRƯỚC KHI CHO PHÉP CHẠY PRODUCTION
  const handleRunDryRun = async () => {
    if (!selectedClassId) {
      setErrorMsg('Vui lòng chọn Lớp học đích (Lớp 2.12).');
      return;
    }

    if (parsedStudents.length === 0) {
      setErrorMsg('Vui lòng nhập ít nhất 1 học sinh.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const { data, error } = await supabase.functions.invoke('admin-bulk-create-students', {
        body: {
          classId: selectedClassId,
          students: parsedStudents,
          dryRun: true, // KIỂM TRA DRY-RUN KHÔNG TẠO DỮ LIỆU
        },
      });

      if (error) {
        throw new Error(error.message || 'Lỗi khi gọi Edge Function admin-bulk-create-students');
      }

      if (!data?.success) {
        throw new Error(data?.message || 'Kiểm tra Dry-Run thất bại.');
      }

      setDryRunResult(data);
      setCurrentStep(2);
      triggerSound('click');

    } catch (err) {
      console.error('Dry-Run error:', err);
      setErrorMsg(err.message || 'Có lỗi khi thực hiện kiểm tra Dry-Run.');
    } finally {
      setLoading(false);
    }
  };

  // THỰC THI TẠO TÀI KHOẢN PRODUCTION THẬT (CHỈ SAU KHI DRY-RUN THÀNH CÔNG)
  const handleConfirmProductionImport = async () => {
    if (!dryRunResult || !dryRunResult.success) {
      setErrorMsg('Vui lòng hoàn tất kiểm tra Dry-Run thành công trước khi chạy Production.');
      return;
    }

    setLoading(true);
    setCurrentStep(3);
    setErrorMsg('');

    try {
      const { data, error } = await supabase.functions.invoke('admin-bulk-create-students', {
        body: {
          classId: selectedClassId,
          students: parsedStudents,
          dryRun: false, // THỰC THI THẬT TRÊN PRODUCTION
        },
      });

      if (error) {
        throw new Error(error.message || 'Lỗi khi kết nối Edge Function admin-bulk-create-students');
      }

      if (!data?.success) {
        throw new Error(data?.message || 'Quá trình nhập danh sách học sinh Production thất bại.');
      }

      setProductionResult(data);
      setCurrentStep(4);
      triggerSound('win');
      if (onImportCompleted) onImportCompleted();

    } catch (err) {
      console.error('Production import error:', err);
      setErrorMsg(err.message || 'Có lỗi xảy ra trong quá trình nhập danh sách Production.');
      setCurrentStep(2);
    } finally {
      setLoading(false);
    }
  };

  // NÚT TẢI CSV AN TOÀN - CHỐNG CSV FORMULA INJECTION
  const handleDownloadCSV = () => {
    if (!productionResult || !productionResult.results) return;

    const selectedClass = classesList.find(c => c.id === selectedClassId);
    const className = selectedClass ? selectedClass.name : '2.12';

    // Đặt BOM UTF-8 để Excel hiển thị đúng tiếng Việt có dấu
    let csvContent = '\uFEFF';
    csvContent += 'STT,Họ và Tên,Mã Học Sinh,Mã PIN Đăng Nhập,Lớp Gán,Trạng Thái,Ghi Chú\n';

    // Hàm chống CSV Formula Injection (Nguồn an toàn OWASP)
    const sanitizeCsvCell = (val) => {
      if (val === null || val === undefined) return '""';
      let str = String(val).trim();
      if (/^[=\+\-@\t\r]/.test(str)) {
        str = "'" + str; // Thêm dấu nháy đơn bảo vệ cell
      }
      return `"${str.replace(/"/g, '""')}"`;
    };

    productionResult.results.forEach((item) => {
      // Chỉ tải PIN cho các dòng thành công CREATED_AND_ASSIGNED
      const isSuccess = item.status === 'CREATED_AND_ASSIGNED';
      const stt = item.stt;
      const name = sanitizeCsvCell(item.fullName);
      const code = sanitizeCsvCell(item.studentCode || '-');
      const pin = isSuccess ? sanitizeCsvCell(item.pin || '-') : '""';
      const cName = sanitizeCsvCell(className);
      const status = sanitizeCsvCell(item.status);
      const note = sanitizeCsvCell(item.note || '');

      csvContent += `${stt},${name},${code},${pin},${cName},${status},${note}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `THONG_TIN_DANG_NHAP_${className.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    triggerSound('click');
  };

  if (!isOpen) return null;

  const targetClassObj = classesList.find((c) => c.id === selectedClassId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/75 backdrop-blur-sm animate-fadeIn overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-3xl border-4 border-amber-300 shadow-2xl overflow-hidden flex flex-col my-6 max-h-[92vh]">
        
        {/* MODAL HEADER */}
        <div className="bg-gradient-to-r from-indigo-800 via-purple-800 to-amber-600 p-5 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center border border-white/30">
              <FileSpreadsheet className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h3 className="font-black text-lg sm:text-xl leading-tight">
                Nhập Danh Sách Học Sinh Hàng Loạt (Lớp 2.12)
              </h3>
              <p className="text-xs text-indigo-100 font-bold flex items-center gap-2">
                <span>Khối 2 • Lớp 2.12 • LOP212-3A5818</span>
                <span className="px-2 py-0.5 bg-amber-400 text-amber-950 rounded-full font-black text-[10px]">
                  {currentStep === 1 ? '1. Chuẩn bị danh sách' : currentStep === 2 ? '2. Bản xem trước Dry-Run' : currentStep === 3 ? '3. Đang thực thi' : '4. Tải CSV thông tin'}
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={handleCloseModal}
            className="p-1.5 hover:bg-white/20 rounded-full text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODAL BODY */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          
          {errorMsg && (
            <div className="p-4 bg-rose-50 border-2 border-rose-300 rounded-2xl flex items-start gap-3 text-rose-800 text-xs font-bold animate-shake">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-black">Thông báo lỗi:</p>
                <p>{errorMsg}</p>
              </div>
            </div>
          )}

          {/* BƯỚC 1: DÁN DANH SÁCH & NÚT CHẠY DRY-RUN */}
          {currentStep === 1 && (
            <div className="space-y-6">
              
              {/* LỌC XÁC NHẬN LỚP ĐÍCH CHÍNH XÁC */}
              <div className="bg-amber-50 p-4 rounded-2xl border-2 border-amber-300 space-y-2">
                <label className="block text-xs font-black text-amber-950 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-amber-600" /> Chọn Lớp Học Đích (Bắt buộc đúng Lớp 2.12):
                </label>
                <select
                  value={selectedClassId}
                  onChange={(e) => {
                    setSelectedClassId(e.target.value);
                    setDryRunResult(null);
                  }}
                  className="w-full p-3 bg-white border-2 border-amber-300 rounded-xl font-black text-xs sm:text-sm text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                >
                  {classesList.map((c) => (
                    <option key={c.id} value={c.id}>
                      🏫 {c.name} (Khối {c.grade_level}) - Mã lớp: {c.code}
                    </option>
                  ))}
                </select>
                {targetClassObj && (
                  <div className="p-2.5 bg-emerald-100/60 border border-emerald-300 rounded-xl text-xs font-bold text-emerald-900 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      Lớp đã chọn: <strong className="font-black">{targetClassObj.name}</strong> (Khối {targetClassObj.grade_level})
                    </span>
                    <span className="font-mono bg-emerald-200 px-2 py-0.5 rounded text-emerald-950 text-[11px] font-black">
                      Mã: {targetClassObj.code}
                    </span>
                  </div>
                )}
              </div>

              {/* DÁN DANH SÁCH HỌC SINH */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <FileSpreadsheet className="w-4 h-4 text-indigo-600" /> Danh Sách Họ & Tên ({parsedStudents.length} học sinh):
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setRawInputText(DEFAULT_34_STUDENTS_TEXT);
                      parseInput(DEFAULT_34_STUDENTS_TEXT);
                      setDryRunResult(null);
                    }}
                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 underline"
                  >
                    Dán lại 34 học sinh Lớp 2.12 chuẩn
                  </button>
                </div>

                <textarea
                  rows={6}
                  value={rawInputText}
                  onChange={handleInputChange}
                  placeholder="Dán danh sách mỗi dòng 1 họ tên..."
                  className="w-full p-3 bg-slate-50 border-2 border-slate-300 rounded-2xl font-mono text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-2xl text-xs font-bold text-indigo-900 flex items-center gap-3">
                <Eye className="w-5 h-5 text-indigo-600 shrink-0" />
                <p>
                  Vui lòng bấm <strong>"🔍 Kiểm Tra Dry-Run Bản Xem Trước"</strong>. Hệ thống sẽ đối chiếu dữ liệu hiện tại trên CSDL Production <strong>mà không tạo hay thay đổi bất kỳ bản ghi nào</strong> trước khi mở nút xác nhận thật.
                </p>
              </div>

            </div>
          )}

          {/* BƯỚC 2: BẢN XEM TRƯỚC DRY-RUN KẾT QUẢ PREVIEW */}
          {currentStep === 2 && dryRunResult && (
            <div className="space-y-5 animate-fadeIn">
              
              {/* KẾT QUẢ DRY-RUN TỔNG QUAN */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-2xl text-center">
                  <span className="text-2xl font-black text-emerald-600">{dryRunResult.summary?.readyToCreate || 0}</span>
                  <p className="text-[11px] font-bold text-emerald-800">Sẵn sàng tạo mới</p>
                </div>
                <div className="bg-sky-50 border border-sky-200 p-3 rounded-2xl text-center">
                  <span className="text-2xl font-black text-sky-600">{dryRunResult.summary?.alreadyInClass || 0}</span>
                  <p className="text-[11px] font-bold text-sky-800">Đã ở trong Lớp 2.12</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 p-3 rounded-2xl text-center">
                  <span className="text-2xl font-black text-amber-600">{dryRunResult.summary?.reviewRequired || 0}</span>
                  <p className="text-[11px] font-bold text-amber-800">Trùng tên cần xem xét</p>
                </div>
                <div className="bg-purple-50 border border-purple-200 p-3 rounded-2xl text-center">
                  <span className="text-2xl font-black text-purple-600">{dryRunResult.summary?.total || 0}</span>
                  <p className="text-[11px] font-bold text-purple-800">Tổng kiểm tra</p>
                </div>
              </div>

              {/* BẢNG BÁO CÁO PREVIEW DRY-RUN 34 DÒNG */}
              <div>
                <h4 className="text-xs font-black text-slate-800 mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-500" /> Kết Quả Đối Chiếu Dry-Run Xem Trước:
                  </span>
                  <span className="text-[11px] text-emerald-700 font-bold">Lớp: {dryRunResult.className} (Mã: {dryRunResult.classCode})</span>
                </h4>

                <div className="max-h-64 overflow-y-auto border-2 border-slate-200 rounded-2xl">
                  <table className="w-full text-left text-xs font-bold whitespace-nowrap">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="p-2.5 text-center w-12">STT</th>
                        <th className="p-2.5">Họ và Tên Đầu Vào</th>
                        <th className="p-2.5">Trạng Thái Dry-Run</th>
                        <th className="p-2.5">Ghi Chú Chi Tiết</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dryRunResult.results?.map((r) => (
                        <tr key={r.stt} className="hover:bg-amber-50/50">
                          <td className="p-2 text-center text-slate-500">{r.stt}</td>
                          <td className="p-2 font-extrabold text-slate-800">{r.fullName}</td>
                          <td className="p-2">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                              r.status === 'READY_TO_CREATE' ? 'bg-emerald-100 text-emerald-800' :
                              r.status === 'EXISTING_USER_READY_TO_ASSIGN' ? 'bg-sky-100 text-sky-800' :
                              r.status === 'ALREADY_IN_CLASS_212' ? 'bg-indigo-100 text-indigo-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="p-2 text-slate-600 text-[11px]">{r.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="p-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl text-xs font-bold text-emerald-950 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  Đã hoàn tất kiểm tra Dry-Run. Thầy/Cô có thể bấm nút **"🚀 Xác Nhận Tạo Tài Khoản Production"** bên dưới.
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl text-xs"
                >
                  Sửa danh sách
                </button>
              </div>

            </div>
          )}

          {/* BƯỚC 3: ĐANG THỰC THI THẬT TRÊN PRODUCTION */}
          {currentStep === 3 && (
            <div className="py-12 text-center space-y-4">
              <RefreshCw className="w-12 h-12 text-indigo-600 animate-spin mx-auto" />
              <h4 className="text-lg font-black text-slate-800">Đang Khởi Tạo Batch Trên Production...</h4>
              <p className="text-xs font-bold text-slate-600 max-w-md mx-auto">
                Hệ thống đang khởi tạo Auth Users, Profile, Mã học sinh, PIN Hash và gán Lớp 2.12 an toàn. Vui lòng không đóng cửa sổ này.
              </p>
            </div>
          )}

          {/* BƯỚC 4: KẾT QUẢ PRODUCTION & XUẤT FILE CSV AN TOÀN */}
          {currentStep === 4 && productionResult && (
            <div className="space-y-6 animate-fadeIn">
              
              {/* KẾT QUẢ TỔNG QUAN */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-2xl text-center">
                  <span className="text-2xl font-black text-emerald-600">{productionResult.summary?.created || 0}</span>
                  <p className="text-[11px] font-bold text-emerald-800">Tạo mới thành công</p>
                </div>
                <div className="bg-sky-50 border border-sky-200 p-3 rounded-2xl text-center">
                  <span className="text-2xl font-black text-sky-600">{productionResult.summary?.assignedExisting || 0}</span>
                  <p className="text-[11px] font-bold text-sky-800">Đã gán tài khoản cũ</p>
                </div>
                <div className="bg-rose-50 border border-rose-200 p-3 rounded-2xl text-center">
                  <span className="text-2xl font-black text-rose-600">{productionResult.summary?.failed || 0}</span>
                  <p className="text-[11px] font-bold text-rose-800">Thất bại / Bỏ qua</p>
                </div>
                <div className="bg-purple-50 border border-purple-200 p-3 rounded-2xl text-center">
                  <span className="text-2xl font-black text-purple-600">{productionResult.summary?.total || 0}</span>
                  <p className="text-[11px] font-bold text-purple-800">Tổng đã xử lý</p>
                </div>
              </div>

              {/* BẢNG CHI TIẾT TỪNG HỌC SINH */}
              <div>
                <h4 className="text-xs font-black text-slate-800 mb-2 flex items-center justify-between">
                  <span>Chi Tiết Xử Lý Production ({productionResult.results?.length || 0} học sinh):</span>
                  <span className="text-[11px] text-emerald-700 font-bold">Lớp: {productionResult.className}</span>
                </h4>

                <div className="max-h-60 overflow-y-auto border-2 border-slate-200 rounded-2xl">
                  <table className="w-full text-left text-xs font-bold whitespace-nowrap">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="p-2 w-12 text-center">STT</th>
                        <th className="p-2">Họ tên</th>
                        <th className="p-2">Mã HS</th>
                        <th className="p-2">Mã PIN</th>
                        <th className="p-2">Trạng thái</th>
                        <th className="p-2">Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {productionResult.results?.map((r) => (
                        <tr key={r.stt} className="hover:bg-slate-50">
                          <td className="p-2 text-center text-slate-500">{r.stt}</td>
                          <td className="p-2 font-extrabold text-slate-800">{r.fullName}</td>
                          <td className="p-2 font-mono text-indigo-700 font-black">{r.studentCode || '-'}</td>
                          <td className="p-2 font-mono text-amber-700 font-black">{r.pin || '••••'}</td>
                          <td className="p-2">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                              r.status === 'CREATED_AND_ASSIGNED' ? 'bg-emerald-100 text-emerald-800' :
                              r.status.includes('ALREADY') ? 'bg-sky-100 text-sky-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="p-2 text-[11px] text-slate-600">{r.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* CẢNH BÁO BẢO MẬT & NÚT TẢI CSV */}
              <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl space-y-3">
                <div className="flex items-start gap-2.5 text-amber-900 text-xs font-bold">
                  <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-black text-amber-950">LƯU Ý BẢO MẬT QUAN TRỌNG:</p>
                    <p>
                      Vui lòng bấm nút bên dưới để **tải xuống file CSV chứa thông tin đăng nhập (Mã HS & PIN)** về máy Admin. Vì lý do bảo mật, mã PIN đã được mã hóa 1 chiều trên máy chủ và **sẽ bị xóa sạch khỏi bộ nhớ màn hình sau khi đóng cửa sổ này**!
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadCSV}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm rounded-xl border-b-4 border-emerald-800 shadow-md flex items-center justify-center gap-2 active:translate-y-0.5"
                >
                  <Download className="w-4 h-4 text-amber-300" /> TẢI FILE CSV THÔNG TIN ĐĂNG NHẬP (MÃ HS & PIN)
                </button>
              </div>

            </div>
          )}

        </div>

        {/* MODAL FOOTER */}
        <div className="bg-slate-50 p-4 border-t border-slate-200 flex items-center justify-between shrink-0">
          {currentStep === 1 && (
            <>
              <button
                type="button"
                onClick={handleCloseModal}
                className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs sm:text-sm rounded-xl"
              >
                Hủy bỏ
              </button>

              <button
                type="button"
                onClick={handleRunDryRun}
                disabled={loading || parsedStudents.length === 0}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs sm:text-sm rounded-xl border-b-4 border-indigo-800 shadow-md flex items-center gap-2 disabled:opacity-50"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4 text-amber-300" />}
                🔍 Kiểm Tra Dry-Run Bản Xem Trước (Read-Only)
              </button>
            </>
          )}

          {currentStep === 2 && (
            <>
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs sm:text-sm rounded-xl"
              >
                Quay lại sửa danh sách
              </button>

              <button
                type="button"
                onClick={handleConfirmProductionImport}
                disabled={loading}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm rounded-xl border-b-4 border-emerald-800 shadow-md flex items-center gap-2 disabled:opacity-50 active:translate-y-0.5"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4 text-amber-300" />}
                🚀 Xác Nhận Tạo Tài Khoản Production (Tạo Thật)
              </button>
            </>
          )}

          {currentStep === 4 && (
            <button
              type="button"
              onClick={handleCloseModal}
              className="w-full py-3 bg-slate-800 hover:bg-slate-900 text-white font-black text-xs sm:text-sm rounded-xl"
            >
              🔒 Đóng Cửa Sổ & Xóa Mã PIN Khỏi Bộ Nhớ State
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
