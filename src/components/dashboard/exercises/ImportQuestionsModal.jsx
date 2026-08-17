import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  UploadCloud,
  FileSpreadsheet,
  FileText,
  Download,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
  Plus
} from 'lucide-react';
import {
  parseExcelQuestions,
  parseWordQuestions,
  downloadExcelTemplate,
  downloadWordTemplate
} from '../../../utils/questionFileParsers';

export const ImportQuestionsModal = ({ isOpen, onClose, onImportQuestions }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileType, setFileType] = useState('excel'); // 'excel' | 'word'
  const [isParsing, setIsParsing] = useState(false);
  const [parseResult, setParseResult] = useState(null);
  const [isAdding, setIsAdding] = useState(false);
  const [generalError, setGeneralError] = useState('');

  const fileInputRef = useRef(null);
  const bodyScrollRef = useRef(null);

  // 1. KHÓA CUỘN TRANG NỀN KHI MỞ MODAL
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      if (bodyScrollRef.current) {
        bodyScrollRef.current.scrollTop = 0;
      }

      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  const handleReset = () => {
    setSelectedFile(null);
    setParseResult(null);
    setGeneralError('');
    setIsAdding(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    if (isParsing || isAdding) return;
    handleReset();
    onClose();
  };

  // 2. PHÍM ESC ĐÓNG MODAL AN TOÀN
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isParsing && !isAdding) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isParsing, isAdding]);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setGeneralError('');
    setParseResult(null);

    // Kiểm tra kích thước file (Tối đa 5MB)
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setGeneralError('Dung lượng tệp vượt quá 5MB. Vui lòng chọn tệp nhỏ hơn.');
      return;
    }

    // Kiểm tra phần mở rộng file
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'csv', 'docx'].includes(ext)) {
      setGeneralError('Định dạng tệp không được hỗ trợ. Hệ thống chỉ chấp nhận .xlsx, .csv hoặc .docx.');
      return;
    }

    if (ext === 'docx') {
      setFileType('word');
    } else {
      setFileType('excel');
    }

    setSelectedFile(file);
    setIsParsing(true);

    try {
      const buffer = await file.arrayBuffer();
      let result;

      if (ext === 'docx') {
        result = await parseWordQuestions(buffer, file.name);
      } else {
        result = await parseExcelQuestions(buffer, file.name);
      }

      setParseResult(result);
    } catch (err) {
      console.error('File parsing error:', err);
      setGeneralError(`Lỗi khi xử lý tệp: ${err.message}`);
    } finally {
      setIsParsing(false);
    }
  };

  const handleConfirmImport = () => {
    if (!parseResult || !parseResult.success || !parseResult.questions || parseResult.questions.length === 0) {
      return;
    }

    if (isAdding) return;
    setIsAdding(true);

    // Truyền danh sách câu hỏi đã parse hợp lệ vào state của CreateExerciseModal
    onImportQuestions(parseResult.questions);
    handleClose();
  };

  const handleDownloadErrorReport = () => {
    if (!parseResult || !parseResult.errors || parseResult.errors.length === 0) return;

    let content = `BÁO CÁO LỖI NHẬP CÂU HỎI TỪ TỆP\n`;
    content += `Tên tệp: ${selectedFile?.name || 'Không xác định'}\n`;
    content += `Thời gian: ${new Date().toLocaleString('vi-VN')}\n`;
    content += `Tổng số lỗi: ${parseResult.errors.length}\n`;
    content += `--------------------------------------------------\n\n`;

    parseResult.errors.forEach((err, idx) => {
      content += `${idx + 1}. [Dòng/Khối ${err.row || 'Chung'}]: ${err.message}\n`;
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Bao_Cao_Loi_${selectedFile?.name || 'import'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  // SỬ DỤNG REACTDOM.CREATEPORTAL ĐỂ RENDER TRỰC TIẾP LÊN DOCUMENT.BODY
  return createPortal(
    <div
      className="fixed inset-0 z-[10000] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-hidden animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-questions-modal-title"
    >
      <div
        className="bg-white w-full max-w-4xl max-h-[92dvh] sm:max-h-[90dvh] rounded-3xl border-4 border-amber-300 shadow-2xl flex flex-col overflow-hidden animate-scaleIn"
      >

        {/* ========================================================= */}
        {/* ZONE A: HEADER (CỐ ĐỊNH, LUÔN NHÌN THẤY) */}
        {/* ========================================================= */}
        <div className="flex items-center justify-between px-5 py-4 sm:px-7 sm:py-5 border-b-2 border-amber-100 bg-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-amber-100 text-amber-800 rounded-2xl border border-amber-300">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 id="import-questions-modal-title" className="text-base sm:text-lg md:text-xl font-black text-slate-800 leading-tight">
                Nhập Câu Hỏi Từ Tệp (Excel / Word)
              </h2>
              <p className="text-xs font-bold text-slate-500">
                Tải tệp .xlsx, .csv hoặc .docx để tạo câu hỏi tự động. Bắt buộc kiểm tra trước khi thêm vào bài.
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            aria-label="Đóng"
            disabled={isParsing || isAdding}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl transition-colors shrink-0 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ========================================================= */}
        {/* ZONE B: BODY (CUỘN ĐỘC LẬP, CHỨA UPLOAD & BẢNG XEM TRƯỚC) */}
        {/* ========================================================= */}
        <div
          ref={bodyScrollRef}
          className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-7 space-y-4 custom-scrollbar"
        >

          {/* NÚT TẢI FILE MẪU CHUẨN */}
          <div className="p-3.5 bg-amber-50/90 rounded-2xl border border-amber-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="text-xs font-black text-amber-950 flex items-center gap-1.5">
              💡 <span>Tải tệp mẫu chuẩn để chuẩn bị nội dung đúng cú pháp:</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={downloadExcelTemplate}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-sm flex items-center gap-1.5 transition-all active:scale-95"
              >
                <Download className="w-3.5 h-3.5" /> File Mẫu Excel (.xlsx)
              </button>
              <button
                type="button"
                onClick={downloadWordTemplate}
                className="px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white font-black text-xs rounded-xl shadow-sm flex items-center gap-1.5 transition-all active:scale-95"
              >
                <Download className="w-3.5 h-3.5" /> Mẫu Cấu Trúc Word (.docx)
              </button>
            </div>
          </div>

          {/* KHU VỰC TẢI TỆP */}
          {!parseResult && (
            <div className="my-2 flex flex-col items-center justify-center border-2 border-dashed border-amber-300 rounded-3xl p-8 sm:p-10 bg-amber-50/30 hover:bg-amber-50/70 transition-all text-center">
              <UploadCloud className="w-12 h-12 text-amber-500 mb-2 animate-bounce" />
              <p className="text-sm font-black text-slate-800 mb-1">
                Kéo thả tệp vào đây hoặc nhấn để chọn tệp
              </p>
              <p className="text-xs font-bold text-slate-500 mb-4">
                Hỗ trợ tệp <strong>.xlsx</strong>, <strong>.csv</strong> hoặc <strong>.docx</strong> (Tối đa 5MB, tối đa 100 câu)
              </p>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".xlsx,.csv,.docx"
                className="hidden"
                id="questionFileInputModal"
              />

              <label
                htmlFor="questionFileInputModal"
                className="cursor-pointer px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs sm:text-sm rounded-2xl shadow-md transition-all flex items-center gap-2 active:scale-95"
              >
                {isParsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                {isParsing ? 'Đang đọc và phân tích tệp...' : 'Chọn Tệp Từ Máy Tính'}
              </label>
            </div>
          )}

          {/* THÔNG BÁO LỖI CHUNG */}
          {generalError && (
            <div className="p-3.5 bg-rose-50 border-2 border-rose-300 rounded-2xl text-rose-900 text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{generalError}</span>
            </div>
          )}

          {/* KẾT QUẢ PARSE & BẢNG XEM TRƯỚC */}
          {parseResult && (
            <div className="space-y-4">

              {/* THANH THỐNG KÊ */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex items-center gap-3 text-xs font-bold flex-wrap">
                  <span className="text-slate-800">
                    📁 Tệp: <strong>{selectedFile?.name}</strong>
                  </span>
                  {parseResult.success ? (
                    <span className="text-emerald-800 bg-emerald-100 px-3 py-1 rounded-xl font-black flex items-center gap-1.5 border border-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Hợp lệ ({parseResult.questions.length} câu)
                    </span>
                  ) : (
                    <span className="text-rose-800 bg-rose-100 px-3 py-1 rounded-xl font-black flex items-center gap-1.5 border border-rose-300">
                      <AlertCircle className="w-4 h-4 text-rose-600" /> Phát hiện {parseResult.errors.length} lỗi
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {!parseResult.success && parseResult.errors.length > 0 && (
                    <button
                      type="button"
                      onClick={handleDownloadErrorReport}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" /> Tải Báo Cáo Lỗi
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleReset}
                    className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Chọn Tệp Khác
                  </button>
                </div>
              </div>

              {/* DANH SÁCH LỖI NẾU CÓ */}
              {!parseResult.success && parseResult.errors.length > 0 && (
                <div className="p-4 bg-rose-50 border-2 border-rose-300 rounded-2xl text-xs space-y-2">
                  <p className="font-black text-rose-950 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    Vui lòng chỉnh sửa tệp và tải lại để khắc phục các lỗi sau:
                  </p>
                  <div className="max-h-36 overflow-y-auto space-y-1 pl-4 custom-scrollbar">
                    {parseResult.errors.map((err, idx) => (
                      <p key={idx} className="text-rose-800 font-bold">
                        • <strong>{err.row > 0 ? `Dòng/Khối ${err.row}` : 'Tệp'}:</strong> {err.message}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* BẢNG XEM TRƯỚC CÂU HỎI (PREVIEW TABLE CÓ MAX-HEIGHT VÀ CUỘN ĐỘC LẬP) */}
              {parseResult.questions.length > 0 && (
                <div className="border-2 border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                  <div className="max-h-64 sm:max-h-72 overflow-y-auto overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left text-xs whitespace-normal">
                      <thead className="bg-slate-100 text-slate-700 font-black border-b-2 border-slate-200 sticky top-0 z-10 shadow-sm">
                        <tr>
                          <th className="p-3 w-12 text-center bg-slate-100">STT</th>
                          <th className="p-3 w-28 bg-slate-100">Loại Câu</th>
                          <th className="p-3 min-w-[200px] bg-slate-100">Nội Dung Đề Bài</th>
                          <th className="p-3 min-w-[150px] bg-slate-100">Lựa Chọn (Nếu có)</th>
                          <th className="p-3 min-w-[150px] bg-slate-100">Đáp Án</th>
                          <th className="p-3 w-16 text-center bg-slate-100">Điểm</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-800">
                        {parseResult.questions.map((q, idx) => (
                          <tr key={idx} className="hover:bg-amber-50/60 transition-colors">
                            <td className="p-3 text-center font-black text-slate-500">{idx + 1}</td>
                            <td className="p-3">
                              {q.question_type === 'single_choice' && (
                                <span className="px-2.5 py-1 bg-sky-100 text-sky-800 rounded-lg text-[10px] font-black inline-block">
                                  Trắc nghiệm
                                </span>
                              )}
                              {q.question_type === 'fill_blank' && (
                                <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-lg text-[10px] font-black inline-block">
                                  Điền khuyết
                                </span>
                              )}
                              {q.question_type === 'essay' && (
                                <span className="px-2.5 py-1 bg-amber-100 text-amber-900 rounded-lg text-[10px] font-black inline-block">
                                  Tự luận
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-slate-900 font-bold">{q.prompt}</td>
                            <td className="p-3 text-[11px] text-slate-600">
                              {q.options && q.options.length > 0 ? (
                                <ul className="list-disc pl-3.5 space-y-0.5">
                                  {q.options.map((opt, oIdx) => (
                                    <li key={oIdx}>{opt}</li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="text-slate-400 italic">Không có</span>
                              )}
                            </td>
                            <td className="p-3 text-[11px] font-black text-emerald-700">
                              {q.correct_answer}
                            </td>
                            <td className="p-3 text-center font-black text-amber-600">
                              {q.points}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>

        {/* ========================================================= */}
        {/* ZONE C: FOOTER (CỐ ĐỊNH, LUÔN NHÌN THẤY) */}
        {/* ========================================================= */}
        <div className="px-5 py-3.5 sm:px-7 sm:py-4 border-t-2 border-slate-200 bg-slate-50/90 flex items-center justify-between gap-3 shrink-0 z-10">
          <button
            type="button"
            onClick={handleClose}
            disabled={isParsing || isAdding}
            className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-bold text-xs rounded-2xl transition-colors shadow-sm"
          >
            Đóng
          </button>

          <button
            type="button"
            onClick={handleConfirmImport}
            disabled={!parseResult?.success || isAdding}
            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm rounded-2xl shadow-md flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
          >
            {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {isAdding ? 'Đang thêm vào bài...' : `Thêm ${parseResult?.questions?.length || 0} Câu Hỏi Vào Bài Tập`}
          </button>
        </div>

      </div>
    </div>,
    document.body
  );
};
