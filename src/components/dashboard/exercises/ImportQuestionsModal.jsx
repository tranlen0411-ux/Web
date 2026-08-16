import React, { useState, useRef } from 'react';
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

  if (!isOpen) return null;

  const handleReset = () => {
    setSelectedFile(null);
    setParseResult(null);
    setGeneralError('');
    setIsAdding(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setGeneralError('');
    setParseResult(null);

    // 1. Kiểm tra kích thước file (Tối đa 5MB)
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setGeneralError('Dung lượng tệp vượt quá 5MB. Vui lòng chọn tệp nhỏ hơn.');
      return;
    }

    // 2. Kiểm tra phần mở rộng file
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

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fadeIn">
      <div className="bg-white w-full max-w-4xl rounded-3xl border-4 border-amber-300 shadow-2xl p-5 sm:p-7 flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* HEADER */}
        <div className="flex items-center justify-between pb-3 border-b-2 border-amber-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-800 rounded-2xl border border-amber-300">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-slate-800">
                Nhập Câu Hỏi Từ Tệp (Excel / Word)
              </h2>
              <p className="text-xs font-bold text-slate-500">
                Tải tệp .xlsx, .csv hoặc .docx để tạo câu hỏi tự động. Bắt buộc kiểm tra trước khi thêm vào bài.
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* NÚT TẢI FILE MẪU */}
        <div className="mt-3.5 p-3 bg-amber-50/80 rounded-2xl border border-amber-200 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <div className="text-xs font-bold text-amber-950">
            💡 Tải tệp mẫu chuẩn để chuẩn bị nội dung đúng cú pháp:
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={downloadExcelTemplate}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-sm flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> File Mẫu Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={downloadWordTemplate}
              className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white font-black text-xs rounded-xl shadow-sm flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Mẫu Cấu Trúc Word (.docx)
            </button>
          </div>
        </div>

        {/* KHU VỰC TẢI TỆP */}
        {!parseResult && (
          <div className="my-4 flex flex-col items-center justify-center border-2 border-dashed border-amber-300 rounded-3xl p-8 bg-amber-50/30 hover:bg-amber-50/70 transition-all text-center">
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
              id="questionFileInput"
            />
            
            <label
              htmlFor="questionFileInput"
              className="cursor-pointer px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-2xl shadow-md transition-all flex items-center gap-2"
            >
              {isParsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              {isParsing ? 'Đang đọc và phân tích tệp...' : 'Chọn Tệp Từ Máy Tính'}
            </label>
          </div>
        )}

        {/* THÔNG BÁO LỖI CHUNG */}
        {generalError && (
          <div className="my-3 p-3 bg-rose-50 border-2 border-rose-300 rounded-2xl text-rose-900 text-xs font-bold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{generalError}</span>
          </div>
        )}

        {/* KẾT QUẢ PARSE & BẢNG XEM TRƯỚC */}
        {parseResult && (
          <div className="flex-1 overflow-y-auto my-3 pr-1 space-y-3">
            
            {/* THANH THỐNG KÊ */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-200 shrink-0">
              <div className="flex items-center gap-3 text-xs font-bold">
                <span className="text-slate-800">
                  📁 Tệp: <strong>{selectedFile?.name}</strong>
                </span>
                {parseResult.success ? (
                  <span className="text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-lg font-black flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Hợp lệ ({parseResult.questions.length} câu)
                  </span>
                ) : (
                  <span className="text-rose-700 bg-rose-100 px-2.5 py-0.5 rounded-lg font-black flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> Có {parseResult.errors.length} lỗi
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {!parseResult.success && parseResult.errors.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDownloadErrorReport}
                    className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl flex items-center gap-1"
                  >
                    <Download className="w-3 h-3" /> Tải Báo Cáo Lỗi
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> Chọn Tệp Khác
                </button>
              </div>
            </div>

            {/* DANH SÁCH LỖI NẾU CÓ */}
            {!parseResult.success && parseResult.errors.length > 0 && (
              <div className="p-3.5 bg-rose-50 border-2 border-rose-300 rounded-2xl text-xs space-y-1.5">
                <p className="font-black text-rose-950 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  Vui lòng chỉnh sửa tệp và tải lại để khắc phục các lỗi sau:
                </p>
                <div className="max-h-36 overflow-y-auto space-y-1 pl-5 list-disc">
                  {parseResult.errors.map((err, idx) => (
                    <p key={idx} className="text-rose-800 font-bold">
                      • <strong>{err.row > 0 ? `Dòng/Khối ${err.row}` : 'Tệp'}:</strong> {err.message}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* BẢNG XEM TRƯỚC CÂU HỎI (PREVIEW TABLE) */}
            {parseResult.questions.length > 0 && (
              <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-black border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="p-2.5 w-10 text-center">STT</th>
                        <th className="p-2.5 w-28">Loại Câu</th>
                        <th className="p-2.5">Nội Dung Đề Bài</th>
                        <th className="p-2.5 w-36">Lựa Chọn (Nếu có)</th>
                        <th className="p-2.5 w-36">Đáp Án</th>
                        <th className="p-2.5 w-16 text-center">Điểm</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-bold text-slate-800">
                      {parseResult.questions.map((q, idx) => (
                        <tr key={idx} className="hover:bg-amber-50/50">
                          <td className="p-2.5 text-center font-black text-slate-500">{idx + 1}</td>
                          <td className="p-2.5">
                            {q.question_type === 'single_choice' && (
                              <span className="px-2 py-0.5 bg-sky-100 text-sky-800 rounded-lg text-[10px] font-black">
                                Trắc nghiệm
                              </span>
                            )}
                            {q.question_type === 'fill_blank' && (
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-lg text-[10px] font-black">
                                Điền khuyết
                              </span>
                            )}
                            {q.question_type === 'essay' && (
                              <span className="px-2 py-0.5 bg-amber-100 text-amber-900 rounded-lg text-[10px] font-black">
                                Tự luận
                              </span>
                            )}
                          </td>
                          <td className="p-2.5">{q.prompt}</td>
                          <td className="p-2.5 text-[11px] text-slate-600">
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
                          <td className="p-2.5 text-[11px] font-black text-emerald-700">
                            {q.correct_answer}
                          </td>
                          <td className="p-2.5 text-center font-black text-amber-600">
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

        {/* FOOTER ACTIONS */}
        <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
          >
            Đóng
          </button>

          <button
            type="button"
            onClick={handleConfirmImport}
            disabled={!parseResult?.success || isAdding}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {isAdding ? 'Đang thêm vào bài...' : `Thêm ${parseResult?.questions?.length || 0} Câu Hỏi Vào Bài Tập`}
          </button>
        </div>

      </div>
    </div>
  );
};
