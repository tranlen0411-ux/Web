import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Upload,
  FileSpreadsheet,
  FileText,
  Download,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  Lock,
  Globe,
  Layers,
  Save
} from 'lucide-react';
import {
  parseExcelQuestions,
  parseWordQuestions,
  downloadExcelTemplate,
  downloadWordTemplate,
  normalizeImportedQuestion
} from '../../../utils/questionFileParsers';
import {
  downloadQuestionBankExcelTemplate,
  downloadQuestionBankWordTemplate
} from '../../../utils/questionBankTemplateGenerators';
import {
  toQuestionBankPayload,
  findDuplicatesInQuestionList
} from '../../../utils/questionBankAdapters';
import { createQuestion } from '../../../services/questionBankService';

export const ImportQuestionBankModal = ({ isOpen, onClose, onSuccess, role = 'teacher' }) => {
  const fileInputRef = useRef(null);

  const [step, setStep] = useState(1); // 1: Upload, 2: Preview & Config, 3: Importing, 4: Summary
  const [file, setFile] = useState(null);
  const [parsedQuestions, setParsedQuestions] = useState([]);
  const [parsingErrors, setParsingErrors] = useState([]);
  const [isParsing, setIsParsing] = useState(false);

  // Global Config for imported batch
  const [batchSubject, setBatchSubject] = useState('Toán');
  const [batchGrade, setBatchGrade] = useState('1');
  const [batchDifficulty, setBatchDifficulty] = useState('medium');
  const [batchVisibility, setBatchVisibility] = useState('private');

  // Selected questions indices to import
  const [selectedIndices, setSelectedIndices] = useState(new Set());

  // Import Progress & Results
  const [progressCount, setProgressCount] = useState(0);
  const [importResults, setImportResults] = useState({
    successCount: 0,
    failedCount: 0,
    errors: []
  });
  const [copiedErrors, setCopiedErrors] = useState(false);

  const resetImportState = () => {
    setStep(1);
    setFile(null);
    setParsedQuestions([]);
    setParsingErrors([]);
    setIsParsing(false);
    setSelectedIndices(new Set());
    setProgressCount(0);
    setImportResults({
      successCount: 0,
      failedCount: 0,
      errors: []
    });
    setCopiedErrors(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    if (step === 3) return;
    resetImportState();
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && step !== 3) {
        handleClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, step, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleFileSelect = async (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setIsParsing(true);
    setParsingErrors([]);

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const fileName = selectedFile.name.toLowerCase();
      let rawResult;

      if (fileName.endsWith('.xlsx') || fileName.endsWith('.csv')) {
        rawResult = await parseExcelQuestions(arrayBuffer, selectedFile.name);
      } else if (fileName.endsWith('.docx')) {
        rawResult = await parseWordQuestions(arrayBuffer, selectedFile.name);
      } else {
        throw new Error('Định dạng tệp không được hỗ trợ. Vui lòng tải lên file Excel (.xlsx, .csv) hoặc Word (.docx).');
      }

      if (rawResult.errors && rawResult.errors.length > 0) {
        setParsingErrors(rawResult.errors);
      }

      const questionsList = (rawResult.questions || []).map((q, idx) => normalizeImportedQuestion(q, idx));

      if (questionsList.length === 0) {
        throw new Error('Không tìm thấy câu hỏi hợp lệ nào trong tệp tin.');
      }

      setParsedQuestions(questionsList);

      // Khử trùng lặp: Mặc định CHỈ chọn các câu KHÔNG bị trùng lặp
      const duplicatesSet = findDuplicatesInQuestionList(questionsList);
      const initialSelected = new Set(
        questionsList
          .map((_, idx) => idx)
          .filter(idx => !duplicatesSet.has(idx))
      );
      setSelectedIndices(initialSelected);

      setStep(2);
    } catch (err) {
      console.error('Lỗi khi phân tích tệp:', err);
      setParsingErrors([err.message || 'Lỗi khi đọc file.']);
    } finally {
      setIsParsing(false);
    }
  };

  const duplicates = findDuplicatesInQuestionList(parsedQuestions);

  const handleToggleSelectAll = () => {
    const nonDuplicateIndices = parsedQuestions
      .map((_, idx) => idx)
      .filter(idx => !duplicates.has(idx));

    if (selectedIndices.size === nonDuplicateIndices.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(nonDuplicateIndices));
    }
  };

  const handleToggleIndex = (idx) => {
    // Không cho phép chọn câu trùng lặp
    if (duplicates.has(idx)) return;

    const next = new Set(selectedIndices);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    setSelectedIndices(next);
  };

  const handleStartImport = async () => {
    if (selectedIndices.size === 0) return;

    setStep(3);
    setProgressCount(0);

    // Defense-in-depth: lọc nghiêm ngặt selectedIndices && !duplicates.has
    const questionsToImport = parsedQuestions
      .map((q, idx) => ({ q, originalIndex: idx }))
      .filter(({ originalIndex }) => selectedIndices.has(originalIndex) && !duplicates.has(originalIndex));

    let successCount = 0;
    let failedCount = 0;
    const errors = [];

    const isDocx = file?.name ? file.name.toLowerCase().endsWith('.docx') : false;

    // Chạy batch import tuần tự / concurrency <= 2 để đảm bảo độ tin cậy
    const concurrency = 2;
    for (let i = 0; i < questionsToImport.length; i += concurrency) {
      const chunk = questionsToImport.slice(i, i + concurrency);
      await Promise.all(
        chunk.map(async ({ q, originalIndex }) => {
          try {
            const payload = toQuestionBankPayload(
              {
                ...q,
                subject: q.subject || batchSubject,
                grade_level: q.grade_level || batchGrade,
                difficulty: q.difficulty || batchDifficulty,
                visibility: role === 'admin' ? batchVisibility : 'private'
              },
              {
                role,
                defaultSubject: batchSubject,
                defaultGrade: batchGrade,
                defaultDifficulty: batchDifficulty,
                defaultVisibility: role === 'admin' ? batchVisibility : 'private',
                metadata: {
                  source: isDocx ? 'word_import' : 'excel_import',
                  imported_at: new Date().toISOString()
                }
              }
            );

            await createQuestion(payload);
            successCount++;
          } catch (err) {
            failedCount++;
            errors.push({
              index: originalIndex + 1,
              prompt: q.prompt ? (q.prompt.length > 50 ? q.prompt.slice(0, 47) + '...' : q.prompt) : `Câu số ${originalIndex + 1}`,
              message: err.message || 'Lỗi không xác định khi lưu câu hỏi.'
            });
          } finally {
            setProgressCount((prev) => prev + 1);
          }
        })
      );
    }

    setImportResults({
      successCount,
      failedCount,
      errors
    });

    setStep(4);
  };

  const handleCopyErrors = () => {
    const errorText = importResults.errors
      .map((e) => `[Câu ${e.index}] ${e.prompt}: ${e.message}`)
      .join('\n');
    navigator.clipboard.writeText(errorText);
    setCopiedErrors(true);
    setTimeout(() => setCopiedErrors(false), 2000);
  };

  const handleFinish = () => {
    if (importResults.successCount > 0 && typeof onSuccess === 'function') {
      onSuccess(`Đã nhập thành công ${importResults.successCount} câu hỏi vào Ngân hàng câu hỏi!`);
    }
    handleClose();
  };

  const nonDuplicateTotal = parsedQuestions.length - duplicates.size;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-3xl rounded-3xl border-4 border-amber-300 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-amber-100 bg-amber-50/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-2xl border border-indigo-200">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-800">Nhập Câu Hỏi Từ File</h2>
              <p className="text-xs text-slate-500 font-bold">Import câu hỏi hàng loạt từ Excel (.xlsx, .csv) hoặc Word (.docx)</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={step === 3}
            className="p-2 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY THEO TỪNG BƯỚC */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          {/* BƯỚC 1: TẢI FILE & MẪU */}
          {step === 1 && (
            <div className="space-y-6">
              {parsingErrors.length > 0 && (
                <div className="p-4 bg-rose-50 border-2 border-rose-200 text-rose-800 rounded-2xl text-xs font-bold space-y-1">
                  <div className="flex items-center gap-2 text-rose-900 font-black">
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                    <span>Lỗi khi đọc tệp tin:</span>
                  </div>
                  {parsingErrors.map((err, i) => (
                    <p key={i} className="pl-6">• {err}</p>
                  ))}
                </div>
              )}

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-3 border-dashed border-indigo-300 hover:border-indigo-500 bg-indigo-50/40 hover:bg-indigo-50/80 rounded-3xl p-8 text-center cursor-pointer transition-colors"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.csv,.docx"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-indigo-100 flex items-center justify-center mx-auto mb-3 text-indigo-600">
                  <Upload className="w-8 h-8" />
                </div>
                <h3 className="text-sm font-black text-slate-800 mb-1">
                  {isParsing ? 'Đang phân tích dữ liệu tệp tin...' : 'Chọn file Excel (.xlsx, .csv) hoặc Word (.docx)'}
                </h3>
                <p className="text-xs font-semibold text-slate-500 max-w-sm mx-auto">
                  Kéo thả hoặc nhấn vào đây để duyệt tệp từ máy tính của bạn (.xlsx, .csv, .docx).
                </p>
                {isParsing && (
                  <div className="mt-4 flex items-center justify-center gap-2 text-xs font-black text-indigo-600">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Đang xử lý...
                  </div>
                )}
              </div>

              {/* TẢI MẪU FILE */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                <h4 className="text-xs font-black text-slate-700 flex items-center gap-2">
                  <Download className="w-4 h-4 text-indigo-600" /> Tải tệp mẫu chuẩn:
                </h4>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={downloadQuestionBankExcelTemplate}
                    className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 transition-colors flex items-center gap-2 shadow-xs cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                    Tải mẫu Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={downloadQuestionBankWordTemplate}
                    className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 transition-colors flex items-center gap-2 shadow-xs cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-blue-600" />
                    Tải mẫu Word (.docx)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* BƯỚC 2: CẤU HÌNH & XEM TRƯỚC DANH SÁCH */}
          {step === 2 && (
            <div className="space-y-5">
              {/* THÔNG TIN TỆP & CẤU HÌNH MẶC ĐỊNH */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 pb-2 border-b border-slate-200">
                  <span>Tệp: <strong className="text-indigo-700">{file?.name}</strong></span>
                  <span>Tổng số: <strong className="text-slate-900">{parsedQuestions.length}</strong> câu hỏi (Khả dụng: <strong className="text-emerald-700">{nonDuplicateTotal}</strong>)</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-bold text-slate-700">
                  <div>
                    <label className="block text-[11px] font-black text-slate-500 mb-1">Môn học mặc định</label>
                    <select
                      value={batchSubject}
                      onChange={(e) => setBatchSubject(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs focus:border-indigo-500"
                    >
                      <option value="Toán">Toán</option>
                      <option value="Tiếng Việt">Tiếng Việt</option>
                      <option value="Tiếng Anh">Tiếng Anh</option>
                      <option value="Khoa học">Khoa học</option>
                      <option value="Lịch sử & Địa lý">Lịch sử & Địa lý</option>
                      <option value="Tin học">Tin học</option>
                      <option value="Đạo đức">Đạo đức</option>
                      <option value="Tự nhiên & Xã hội">Tự nhiên & Xã hội</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-slate-500 mb-1">Khối lớp mặc định</label>
                    <select
                      value={batchGrade}
                      onChange={(e) => setBatchGrade(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs focus:border-indigo-500"
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
                        <option key={g} value={g}>Lớp {g}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-slate-500 mb-1">Độ khó mặc định</label>
                    <select
                      value={batchDifficulty}
                      onChange={(e) => setBatchDifficulty(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs focus:border-indigo-500"
                    >
                      <option value="easy">Nhận biết (Easy)</option>
                      <option value="medium">Thông hiểu (Medium)</option>
                      <option value="hard">Vận dụng (Hard)</option>
                      <option value="expert">Vận dụng cao (Expert)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-slate-500 mb-1">Phạm vi lưu</label>
                    {role === 'admin' ? (
                      <select
                        value={batchVisibility}
                        onChange={(e) => setBatchVisibility(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs focus:border-indigo-500"
                      >
                        <option value="private">🔒 Cá nhân</option>
                        <option value="public_template">🌐 Mẫu công khai</option>
                      </select>
                    ) : (
                      <div className="py-1.5 px-2 bg-slate-100 rounded-xl text-xs font-bold text-slate-600 flex items-center gap-1">
                        <Lock className="w-3.5 h-3.5" /> Cá nhân
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* BẢNG XEM TRƯỚC */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs font-black text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIndices.size === nonDuplicateTotal && nonDuplicateTotal > 0}
                      onChange={handleToggleSelectAll}
                      className="w-4 h-4 text-indigo-600 rounded"
                    />
                    <span>Chọn tất cả câu hợp lệ ({selectedIndices.size}/{nonDuplicateTotal} câu đã chọn)</span>
                  </label>

                  {duplicates.size > 0 && (
                    <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Loại bỏ {duplicates.size} câu trùng lặp
                    </span>
                  )}
                </div>

                <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-72 overflow-y-auto custom-scrollbar">
                  <table className="w-full text-left text-xs font-semibold">
                    <thead className="bg-slate-100 text-slate-700 font-black text-[10px] uppercase sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3 w-10 text-center">#</th>
                        <th className="py-2.5 px-3">Nội dung câu hỏi</th>
                        <th className="py-2.5 px-3 w-28">Dạng câu</th>
                        <th className="py-2.5 px-3 w-24">Đáp án</th>
                        <th className="py-2.5 px-3 w-28 text-center">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-800">
                      {parsedQuestions.map((q, idx) => {
                        const isDuplicate = duplicates.has(idx);
                        const isSelected = selectedIndices.has(idx) && !isDuplicate;

                        return (
                          <tr
                            key={idx}
                            className={`hover:bg-indigo-50/30 transition-colors ${isDuplicate ? 'bg-amber-50/60 opacity-80' : ''}`}
                          >
                            <td className="py-2.5 px-3 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={isDuplicate}
                                onChange={() => handleToggleIndex(idx)}
                                className="w-4 h-4 text-indigo-600 rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              />
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-bold text-slate-900 line-clamp-1">{q.prompt}</div>
                              {isDuplicate && (
                                <span className="text-[10px] font-bold text-amber-700">
                                  ⚠️ Trùng lặp nội dung với câu khác trong tệp
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span className="text-[11px] font-bold text-slate-600">{q.question_type}</span>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span className="text-[11px] font-mono text-indigo-700 font-bold">
                                {Array.isArray(q.correct_answers) ? q.correct_answers.join(', ') : q.correct_answer || '—'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center whitespace-nowrap">
                              {isDuplicate ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-200">
                                  <AlertTriangle className="w-3 h-3 text-amber-600" /> Trùng — không nhập
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                  <CheckCircle2 className="w-3 h-3" /> Hợp lệ
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* NÚT THAO TÁC */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black rounded-xl"
                >
                  Chọn lại file khác
                </button>
                <button
                  type="button"
                  onClick={handleStartImport}
                  disabled={selectedIndices.size === 0}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Bắt đầu lưu ({selectedIndices.size} câu)
                </button>
              </div>
            </div>
          )}

          {/* BƯỚC 3: ĐANG XỬ LÝ IMPORT BATCH */}
          {step === 3 && (
            <div className="py-12 text-center space-y-4">
              <RefreshCw className="w-10 h-10 text-indigo-600 animate-spin mx-auto" />
              <div>
                <h3 className="text-base font-black text-slate-800">Đang lưu dữ liệu vào Ngân hàng câu hỏi...</h3>
                <p className="text-xs font-bold text-slate-500 mt-1">
                  Đã xử lý: {progressCount} / {selectedIndices.size} câu hỏi
                </p>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-3 max-w-md mx-auto overflow-hidden">
                <div
                  className="bg-indigo-600 h-3 transition-all duration-300"
                  style={{ width: `${(progressCount / (selectedIndices.size || 1)) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* BƯỚC 4: BÁO CÁO TỔNG HỢP SAU KHI LƯU */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
                  <span className="text-2xl font-black text-emerald-700 block">{importResults.successCount}</span>
                  <span className="text-xs font-bold text-emerald-800">Lưu thành công</span>
                </div>
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl">
                  <span className="text-2xl font-black text-rose-700 block">{importResults.failedCount}</span>
                  <span className="text-xs font-bold text-rose-800">Lỗi không thể lưu</span>
                </div>
              </div>

              {importResults.errors.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black text-rose-800">Chi tiết lỗi ({importResults.errors.length} câu):</h4>
                    <button
                      type="button"
                      onClick={handleCopyErrors}
                      className="text-xs text-indigo-600 font-bold flex items-center gap-1 hover:underline"
                    >
                      {copiedErrors ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedErrors ? 'Đã sao chép' : 'Sao chép danh sách lỗi'}
                    </button>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 max-h-48 overflow-y-auto text-xs space-y-1 font-mono">
                    {importResults.errors.map((err, i) => (
                      <div key={i} className="text-rose-700">
                        • [Câu {err.index}] {err.prompt}: {err.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-slate-200 flex justify-end">
                <button
                  type="button"
                  onClick={handleFinish}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl transition-colors shadow-sm"
                >
                  Hoàn Tất
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ImportQuestionBankModal;
