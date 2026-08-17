import React, { useState, useEffect } from 'react';
import { X, FileSpreadsheet, CheckCircle2, AlertTriangle, Download, RefreshCw, Users, ShieldAlert, Sparkles } from 'lucide-react';
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
  const [currentStep, setCurrentStep] = useState(1); // 1: Input & Preview, 2: Executing, 3: Results & CSV Download

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [executionResult, setExecutionResult] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchClasses();
      parseInput(rawInputText);
      setCurrentStep(1);
      setErrorMsg('');
      setExecutionResult(null);
    }
  }, [isOpen]);

  const fetchClasses = async () => {
    try {
      const { data, error } = await supabase
        .from('classes')
        .select('id, name, grade_level, code, teacher_id')
        .order('grade_level', { ascending: true })
        .order('name', { ascending: true });

      if (!error && data && data.length > 0) {
        setClassesList(data);
        // Ưu tiên tự động chọn Lớp 2.12 nếu có trong danh sách
        const class212 = data.find(c => c.name.toLowerCase().includes('2.12'));
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
      // Loại bỏ số thứ tự ở đầu dòng nếu có (ví dụ "1. Trần Lê Hoàng An" -> "Trần Lê Hoàng An")
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
  };

  const handleConfirmImport = async () => {
    if (!selectedClassId) {
      setErrorMsg('Vui lòng chọn Lớp học đích.');
      return;
    }

    if (parsedStudents.length === 0) {
      setErrorMsg('Vui lòng nhập ít nhất 1 học sinh.');
      return;
    }

    setLoading(true);
    setCurrentStep(2);
    setErrorMsg('');

    try {
      // Gọi Edge Function admin-bulk-create-students với JWT auth header
      const { data, error } = await supabase.functions.invoke('admin-bulk-create-students', {
        body: {
          classId: selectedClassId,
          students: parsedStudents,
        },
      });

      if (error) {
        throw new Error(error.message || 'Lỗi khi kết nối Edge Function admin-bulk-create-students');
      }

      if (!data?.success) {
        throw new Error(data?.message || 'Quá trình nhập danh sách học sinh thất bại.');
      }

      setExecutionResult(data);
      setCurrentStep(3);
      triggerSound('win');
      if (onImportCompleted) onImportCompleted();

    } catch (err) {
      console.error('Bulk import error:', err);
      setErrorMsg(err.message || 'Có lỗi xảy ra trong quá trình nhập danh sách.');
      setCurrentStep(1);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadCSV = () => {
    if (!executionResult || !executionResult.results) return;

    const selectedClass = classesList.find(c => c.id === selectedClassId);
    const className = selectedClass ? selectedClass.name : '2.12';

    // Đặt BOM UTF-8 để Excel hiển thị đúng tiếng Việt có dấu
    let csvContent = '\uFEFF';
    csvContent += 'STT,Họ và Tên,Mã Học Sinh,Mã PIN Đăng Nhập,Lớp Gán,Trạng Thái,Ghi Chú\n';

    executionResult.results.forEach((item) => {
      const stt = item.stt;
      const name = `"${(item.fullName || '').replace(/"/g, '""')}"`;
      const code = `"${item.studentCode || '-'}"`;
      const pin = `"${item.pin || '-'}"`;
      const cName = `"${className}"`;
      const status = `"${item.status}"`;
      const note = `"${(item.note || '').replace(/"/g, '""')}"`;

      csvContent += `${stt},${name},${code},${pin},${cName},${status},${note}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `DANH_SACH_TAI_KHOAN_${className.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    triggerSound('click');
  };

  if (!isOpen) return null;

  const targetClassObj = classesList.find((c) => c.id === selectedClassId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fadeIn overflow-y-auto">
      <div className="bg-white w-full max-w-3xl rounded-3xl border-4 border-amber-300 shadow-2xl overflow-hidden flex flex-col my-8 max-h-[90vh]">
        
        {/* MODAL HEADER */}
        <div className="bg-gradient-to-r from-indigo-700 via-purple-700 to-amber-600 p-5 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center border border-white/30">
              <FileSpreadsheet className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h3 className="font-black text-lg sm:text-xl leading-tight">
                Nhập Danh Sách Học Sinh Hàng Loạt
              </h3>
              <p className="text-xs text-indigo-100 font-bold">
                Tạo tài khoản Auth & gán trực tiếp vào Lớp 2.12 theo quy trình an toàn
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
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
                <p className="font-black">Đã xảy ra lỗi:</p>
                <p>{errorMsg}</p>
              </div>
            </div>
          )}

          {/* BƯỚC 1: DÁN DANH SÁCH & BẢN XEM TRƯỚC */}
          {currentStep === 1 && (
            <div className="space-y-6">
              
              {/* LỌC LỚP ĐÍCH */}
              <div className="bg-amber-50/80 p-4 rounded-2xl border-2 border-amber-200 space-y-2">
                <label className="block text-xs font-black text-amber-950 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-amber-600" /> 1. Chọn Lớp Học Đích Để Nhập:
                </label>
                <select
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="w-full p-3 bg-white border-2 border-amber-300 rounded-xl font-black text-xs sm:text-sm text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                >
                  {classesList.map((c) => (
                    <option key={c.id} value={c.id}>
                      🏫 {c.name} (Khối {c.grade_level}) - Mã lớp: {c.code}
                    </option>
                  ))}
                </select>
                {targetClassObj && (
                  <p className="text-[11px] font-bold text-amber-800 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Đã chọn: <span className="font-black text-amber-950">{targetClassObj.name}</span> (Khối {targetClassObj.grade_level} - Mã: {targetClassObj.code})
                  </p>
                )}
              </div>

              {/* DÁN DANH SÁCH HỌC SINH */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <FileSpreadsheet className="w-4 h-4 text-indigo-600" /> 2. Danh Sách Họ & Tên Học Sinh ({parsedStudents.length} học sinh):
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setRawInputText(DEFAULT_34_STUDENTS_TEXT);
                      parseInput(DEFAULT_34_STUDENTS_TEXT);
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

              {/* BẢN XEM TRƯỚC (PREVIEW TABLE) */}
              <div>
                <h4 className="text-xs font-black text-slate-800 mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-500" /> Bản Xem Trước Đối Chiếu ({parsedStudents.length} học sinh sẽ được tạo):
                </h4>

                <div className="max-h-48 overflow-y-auto border-2 border-slate-200 rounded-2xl">
                  <table className="w-full text-left text-xs font-bold">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="p-2.5 w-16 text-center">STT</th>
                        <th className="p-2.5">Họ và Tên Học Sinh</th>
                        <th className="p-2.5">Lớp Đích</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsedStudents.map((st) => (
                        <tr key={st.stt} className="hover:bg-amber-50/50">
                          <td className="p-2 text-center text-slate-500">{st.stt}</td>
                          <td className="p-2 font-extrabold text-slate-800">{st.fullName}</td>
                          <td className="p-2 text-indigo-700 font-black">{targetClassObj?.name || 'Lớp 2.12'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* BƯỚC 2: ĐANG THỰC THI (LOADING STEP) */}
          {currentStep === 2 && (
            <div className="py-12 text-center space-y-4">
              <RefreshCw className="w-12 h-12 text-indigo-600 animate-spin mx-auto" />
              <h4 className="text-lg font-black text-slate-800">Đang Thực Thi Tạo Tài Khoản & Gán Lớp...</h4>
              <p className="text-xs font-bold text-slate-600 max-w-md mx-auto">
                Hệ thống đang khởi tạo Auth Users, Profile, Mã học sinh, Mã PIN Hash và phân lớp an toàn. Vui lòng không đóng cửa sổ này.
              </p>
            </div>
          )}

          {/* BƯỚC 3: KẾT QUẢ & XUẤT CSV */}
          {currentStep === 3 && executionResult && (
            <div className="space-y-6 animate-fadeIn">
              
              {/* KẾT QUẢ TỔNG QUAN */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-2xl text-center">
                  <span className="text-2xl font-black text-emerald-600">{executionResult.summary?.created || 0}</span>
                  <p className="text-[11px] font-bold text-emerald-800">Tạo mới thành công</p>
                </div>
                <div className="bg-sky-50 border border-sky-200 p-3 rounded-2xl text-center">
                  <span className="text-2xl font-black text-sky-600">{executionResult.summary?.alreadyExists || 0}</span>
                  <p className="text-[11px] font-bold text-sky-800">Đã có tài khoản</p>
                </div>
                <div className="bg-rose-50 border border-rose-200 p-3 rounded-2xl text-center">
                  <span className="text-2xl font-black text-rose-600">{executionResult.summary?.failed || 0}</span>
                  <p className="text-[11px] font-bold text-rose-800">Thất bại</p>
                </div>
                <div className="bg-purple-50 border border-purple-200 p-3 rounded-2xl text-center">
                  <span className="text-2xl font-black text-purple-600">{executionResult.summary?.total || 0}</span>
                  <p className="text-[11px] font-bold text-purple-800">Tổng đã xử lý</p>
                </div>
              </div>

              {/* BẢNG CHI TIẾT TỪNG HỌC SINH */}
              <div>
                <h4 className="text-xs font-black text-slate-800 mb-2 flex items-center justify-between">
                  <span>Chi Tiết Xử Lý ({executionResult.results?.length || 0} học sinh):</span>
                  <span className="text-[11px] text-emerald-700 font-bold">Lớp: {executionResult.className}</span>
                </h4>

                <div className="max-h-60 overflow-y-auto border-2 border-slate-200 rounded-2xl">
                  <table className="w-full text-left text-xs font-bold">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="p-2 w-12 text-center">STT</th>
                        <th className="p-2">Họ tên</th>
                        <th className="p-2">Mã HS</th>
                        <th className="p-2">Mã PIN</th>
                        <th className="p-2">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {executionResult.results?.map((r) => (
                        <tr key={r.stt} className="hover:bg-slate-50">
                          <td className="p-2 text-center text-slate-500">{r.stt}</td>
                          <td className="p-2 font-extrabold text-slate-800">{r.fullName}</td>
                          <td className="p-2 font-mono text-indigo-700 font-black">{r.studentCode || '-'}</td>
                          <td className="p-2 font-mono text-amber-700 font-black">{r.pin || '••••'}</td>
                          <td className="p-2">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                              r.status === 'CREATED_AND_ASSIGNED' ? 'bg-emerald-100 text-emerald-800' :
                              r.status === 'ALREADY_EXISTS' ? 'bg-sky-100 text-sky-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {r.status}
                            </span>
                          </td>
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
                      Vui lòng bấm nút bên dưới để **tải xuống file CSV chứa thông tin đăng nhập (Mã HS + Mã PIN)** về máy Admin. Vì lý do bảo mật, mã PIN đã được mã hóa 1 chiều trên hệ thống và **không thể hiển thị lại** sau khi đóng cửa sổ này!
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadCSV}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm rounded-xl border-b-4 border-emerald-800 shadow-md flex items-center justify-center gap-2"
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
                onClick={onClose}
                className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs sm:text-sm rounded-xl"
              >
                Hủy bỏ
              </button>

              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={loading || parsedStudents.length === 0}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs sm:text-sm rounded-xl border-b-4 border-indigo-800 shadow-md flex items-center gap-2 disabled:opacity-50"
              >
                🚀 Xác Nhận Tạo {parsedStudents.length} Tài Khoản & Gán Lớp
              </button>
            </>
          )}

          {currentStep === 3 && (
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-black text-xs sm:text-sm rounded-xl"
            >
              Đóng Cửa Sổ Hoàn Thành
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
