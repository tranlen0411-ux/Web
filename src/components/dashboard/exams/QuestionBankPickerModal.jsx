// src/components/dashboard/exams/QuestionBankPickerModal.jsx
// Modal Chọn và Nhập Câu Hỏi từ Ngân Hàng Câu Hỏi vào Đề Thi Exam V1

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Search,
  Check,
  Filter,
  Layers,
  BookOpen,
  HelpCircle,
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Plus,
  Lock,
  Globe,
  Tag,
  ArrowRight,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { listQuestions } from '../../../services/questionBankService.js';

const TYPE_LABELS = {
  single_choice: 'Trắc nghiệm 1 đáp án',
  multiple_choice: 'Trắc nghiệm nhiều đáp án',
  fill_blank: 'Điền khuyết',
  short_answer: 'Trả lời ngắn',
  essay: 'Tự luận',
  image_upload: 'Tải ảnh',
  file_upload: 'Tải tệp'
};

const DIFFICULTY_LABELS = {
  easy: { label: 'Nhận biết', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  medium: { label: 'Thông hiểu', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  hard: { label: 'Vận dụng', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  expert: { label: 'Vận dụng cao', color: 'bg-rose-50 text-rose-700 border-rose-200' }
};

const SUBJECT_OPTIONS = [
  'Toán',
  'Tiếng Việt',
  'Tiếng Anh',
  'Tự nhiên và Xã hội',
  'Khoa học',
  'Lịch sử và Địa lí',
  'Tin học',
  'Đạo đức'
];

export const QuestionBankPickerModal = ({
  isOpen,
  onClose,
  onImportQuestions,
  existingQuestions = [],
  defaultSubject = '',
  defaultGrade = null,
  role = 'teacher'
}) => {
  const [questions, setQuestions] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);

  // Search & Filter state
  const [searchText, setSearchText] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [selectedSubject, setSelectedSubject] = useState(defaultSubject || '');
  const [selectedGrade, setSelectedGrade] = useState(defaultGrade ? String(defaultGrade) : '');
  const [selectedType, setSelectedType] = useState('');
  const [selectedDifficulty, setSelectedDifficulty] = useState('');

  // Selected questions Map (id -> item)
  const [selectedMap, setSelectedMap] = useState(new Map());

  const fetchSeqRef = useRef(0);

  // Danh sách ID các câu hỏi đã có trong draft hiện tại
  const existingQbItemIds = new Set(
    (existingQuestions || [])
      .map(q => q.source_question_bank_item_id)
      .filter(Boolean)
  );

  // Reset filter when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedMap(new Map());
      setPage(1);
      setError(null);
      if (defaultSubject) setSelectedSubject(defaultSubject);
      if (defaultGrade) setSelectedGrade(String(defaultGrade));
    }
  }, [isOpen, defaultSubject, defaultGrade]);

  // Fetch questions from question-bank BFF API
  const fetchQuestions = useCallback(async () => {
    if (!isOpen) return;

    const currentSeq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);

    try {
      const filters = {
        page,
        page_size: pageSize,
        search: appliedSearch || undefined,
        subject: selectedSubject || undefined,
        grade_level: selectedGrade ? Number(selectedGrade) : undefined,
        question_type: selectedType || undefined,
        difficulty: selectedDifficulty || undefined,
        status: 'published' // Ưu tiên câu đã xuất bản hoặc câu của mình theo policy của backend
      };

      const result = await listQuestions(filters);

      if (currentSeq !== fetchSeqRef.current) return;

      setQuestions(result?.items || []);
      setTotalCount(result?.total_count || 0);
    } catch (err) {
      if (currentSeq !== fetchSeqRef.current) return;
      console.error('[QuestionBankPickerModal] Lỗi tải danh sách câu hỏi:', err);
      setError(err?.message || 'Không thể tải danh sách câu hỏi từ Ngân hàng câu hỏi.');
      setQuestions([]);
      setTotalCount(0);
    } finally {
      if (currentSeq === fetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, [isOpen, page, pageSize, appliedSearch, selectedSubject, selectedGrade, selectedType, selectedDifficulty]);

  useEffect(() => {
    if (isOpen) {
      fetchQuestions();
    }
  }, [isOpen, fetchQuestions]);

  // Keyboard escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !importing) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, importing]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    setAppliedSearch(searchText.trim());
  };

  const handleResetFilters = () => {
    setSearchText('');
    setAppliedSearch('');
    setSelectedSubject('');
    setSelectedGrade('');
    setSelectedType('');
    setSelectedDifficulty('');
    setPage(1);
  };

  const handleToggleSelect = (item) => {
    if (!item?.id) return;
    setSelectedMap(prev => {
      const next = new Map(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.set(item.id, item);
      }
      return next;
    });
  };

  const handleSelectAllOnPage = () => {
    const allPageSelected = questions.length > 0 && questions.every(q => selectedMap.has(q.id));
    setSelectedMap(prev => {
      const next = new Map(prev);
      if (allPageSelected) {
        questions.forEach(q => next.delete(q.id));
      } else {
        questions.forEach(q => next.set(q.id, q));
      }
      return next;
    });
  };

  const handleConfirmImport = async () => {
    const selectedList = Array.from(selectedMap.values());
    if (selectedList.length === 0) return;

    setImporting(true);
    setError(null);
    try {
      const selectedItemIds = selectedList.map(item => item.id);
      await onImportQuestions(selectedItemIds, selectedList);
      onClose();
    } catch (err) {
      console.error('[QuestionBankPickerModal] Lỗi import câu hỏi:', err);
      setError(err?.message || 'Có lỗi xảy ra khi nhập câu hỏi vào đề thi.');
    } finally {
      setImporting(false);
    }
  };

  if (!isOpen || typeof document === 'undefined') return null;

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const isAllPageSelected = questions.length > 0 && questions.every(q => selectedMap.has(q.id));
  const selectedCount = selectedMap.size;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border-4 border-indigo-200 animate-scaleUp overflow-hidden">
        {/* HEADER MODAL */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-indigo-100 bg-gradient-to-r from-indigo-50/90 to-purple-50/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-indigo-950">
                  Lấy Câu Hỏi Từ Ngân Hàng
                </h3>
                <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-700">
                  Exam V1
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">
                Chọn các câu hỏi chuẩn hóa để sao chép độc lập vào bản nháp đề thi
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
            title="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BỘ LỌC VÀ TÌM KIẾM */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/70">
          <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2.5 mb-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Tìm theo nội dung, tiêu đề, mã câu hỏi..."
                className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl transition-colors shadow-xs flex items-center gap-1.5"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Tìm</span>
              </button>
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-3 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 text-xs font-bold rounded-xl transition-colors"
                title="Đặt lại bộ lọc"
              >
                Đặt lại
              </button>
            </div>
          </form>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-semibold text-slate-700">
            {/* Lọc Môn học */}
            <div>
              <select
                value={selectedSubject}
                onChange={(e) => {
                  setSelectedSubject(e.target.value);
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Tất cả môn học</option>
                {SUBJECT_OPTIONS.map((sub) => (
                  <option key={sub} value={sub}>{sub}</option>
                ))}
              </select>
            </div>

            {/* Lọc Khối lớp */}
            <div>
              <select
                value={selectedGrade}
                onChange={(e) => {
                  setSelectedGrade(e.target.value);
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Tất cả khối lớp</option>
                {[1, 2, 3, 4, 5].map((g) => (
                  <option key={g} value={g}>Khối {g}</option>
                ))}
              </select>
            </div>

            {/* Lọc Loại câu hỏi */}
            <div>
              <select
                value={selectedType}
                onChange={(e) => {
                  setSelectedType(e.target.value);
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Tất cả dạng câu</option>
                {Object.entries(TYPE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </div>

            {/* Lọc Độ khó */}
            <div>
              <select
                value={selectedDifficulty}
                onChange={(e) => {
                  setSelectedDifficulty(e.target.value);
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Tất cả mức độ</option>
                {Object.entries(DIFFICULTY_LABELS).map(([k, { label }]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* BODY: DANH SÁCH CÂU HỎI */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {error && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* THANH THAO TÁC NHANH: CHỌN TẤT CẢ TRÊN TRANG */}
          <div className="flex items-center justify-between text-xs font-bold text-slate-600 px-1 py-1">
            <button
              type="button"
              onClick={handleSelectAllOnPage}
              disabled={loading || questions.length === 0}
              className="flex items-center gap-2 hover:text-indigo-600 transition-colors disabled:opacity-50"
            >
              <input
                type="checkbox"
                checked={isAllPageSelected}
                onChange={handleSelectAllOnPage}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
              <span>{isAllPageSelected ? 'Bỏ chọn trang này' : 'Chọn tất cả trên trang này'}</span>
            </button>

            <span className="text-slate-500">
              Tổng cộng: <strong className="text-slate-800">{totalCount}</strong> câu hỏi
            </span>
          </div>

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-indigo-600 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
              <p className="text-xs font-bold text-slate-500">Đang tải danh sách câu hỏi...</p>
            </div>
          ) : questions.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-black text-slate-600">Không tìm thấy câu hỏi phù hợp</p>
              <p className="text-xs font-medium mt-1">Thử thay đổi từ khóa hoặc bộ lọc tìm kiếm.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {questions.map((q) => {
                const isSelected = selectedMap.has(q.id);
                const isAlreadyInExam = existingQbItemIds.has(q.id);
                const typeLabel = TYPE_LABELS[q.question_type] || q.question_type;
                const diffConfig = DIFFICULTY_LABELS[q.difficulty] || { label: q.difficulty || 'Trung bình', color: 'bg-slate-100 text-slate-700 border-slate-200' };

                return (
                  <div
                    key={q.id}
                    onClick={() => handleToggleSelect(q)}
                    className={`p-3.5 sm:p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-start gap-3 select-none ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-50/50 shadow-xs'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                    }`}
                  >
                    {/* CHECKBOX */}
                    <div className="pt-0.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelect(q)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </div>

                    {/* NỘI DUNG VÀ BADGES */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                        {/* Type Badge */}
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-indigo-100 text-indigo-700">
                          {typeLabel}
                        </span>

                        {/* Subject & Grade Badge */}
                        {q.subject && (
                          <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-700">
                            {q.subject}
                          </span>
                        )}
                        {q.grade_level && (
                          <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-700">
                            Lớp {q.grade_level}
                          </span>
                        )}

                        {/* Difficulty Badge */}
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${diffConfig.color}`}>
                          {diffConfig.label}
                        </span>

                        {/* Already in Exam Badge */}
                        {isAlreadyInExam && (
                          <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                            <Check className="w-3 h-3 text-amber-700" />
                            Đã có trong đề
                          </span>
                        )}
                      </div>

                      {/* Tiêu đề & Prompt snippet */}
                      <p className="text-xs sm:text-sm font-bold text-slate-900 leading-snug break-words">
                        {q.prompt_snippet || q.title || 'Câu hỏi'}
                      </p>

                      {/* Thông tin phụ */}
                      <div className="mt-2 flex items-center gap-3 text-[11px] font-medium text-slate-400">
                        {q.code && <span>Mã: #{q.code}</span>}
                        {q.options_count > 0 && <span>{q.options_count} lựa chọn</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* PHÂN TRANG */}
        {totalPages > 1 && (
          <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-600">
            <span>
              Trang {page} / {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors"
                title="Trang trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors"
                title="Trang sau"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* FOOTER MODAL */}
        <div className="p-4 sm:p-5 border-t border-indigo-100 bg-white flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs font-bold text-slate-600 flex items-center gap-2">
            <span>Đã chọn:</span>
            <span className="px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-black text-xs">
              {selectedCount} câu hỏi
            </span>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={importing}
              className="flex-1 sm:flex-none px-4 py-2.5 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleConfirmImport}
              disabled={selectedCount === 0 || importing}
              className="flex-1 sm:flex-none px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl transition-colors shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Đang thêm vào đề...</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>Thêm Vào Đề Thi ({selectedCount})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default QuestionBankPickerModal;
