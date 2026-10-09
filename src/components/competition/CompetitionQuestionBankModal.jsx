// src/components/competition/CompetitionQuestionBankModal.jsx
// Modal Chọn Câu Hỏi từ Ngân Hàng Câu Hỏi vào Đấu Trường (Competition V1 R14)

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Search,
  Check,
  BookOpen,
  Layers,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Tag,
  ChevronLeft,
  ChevronRight,
  Plus
} from 'lucide-react';
import { listQuestions } from '../../services/questionBankService.js';
import {
  normalizeQuestionBankItemToCompetitionQuestion,
  isDuplicateQuestion
} from '../../utils/competitionQuestionAdapters.js';

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

const DIFFICULTY_LABELS = {
  easy: { label: 'Nhận biết', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  medium: { label: 'Thông hiểu', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  hard: { label: 'Vận dụng', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  expert: { label: 'Vận dụng cao', color: 'bg-rose-50 text-rose-700 border-rose-200' }
};

export function CompetitionQuestionBankModal({
  isOpen,
  onClose,
  onImportQuestions,
  existingQuestions = [],
  maxAllowed = 5
}) {
  const [questions, setQuestions] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filters
  const [searchText, setSearchText] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedDifficulty, setSelectedDifficulty] = useState('');

  // Selected Map (id -> item)
  const [selectedMap, setSelectedMap] = useState(new Map());

  const remainingSlots = Math.max(0, maxAllowed - existingQuestions.length);

  // Lock background scroll when modal opens
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setSelectedMap(new Map());
      setError(null);
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Fetch Questions from Question Bank BFF
  const fetchQuestions = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    try {
      const filters = {
        page,
        page_size: pageSize,
        question_type: 'single_choice', // R14 Phase 1: single_choice only
        status: 'published'
      };

      if (appliedSearch) filters.search = appliedSearch;
      if (selectedSubject) filters.subject = selectedSubject;
      if (selectedGrade) filters.grade_level = selectedGrade;
      if (selectedDifficulty) filters.difficulty = selectedDifficulty;

      const res = await listQuestions(filters);
      setQuestions(res.items || []);
      setTotalCount(res.total_count || 0);
    } catch (err) {
      console.error('[CompetitionQuestionBankModal] Lỗi tải câu hỏi:', err);
      setError(err.message || 'Không thể tải danh sách câu hỏi từ Ngân hàng.');
      setQuestions([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [isOpen, page, pageSize, appliedSearch, selectedSubject, selectedGrade, selectedDifficulty]);

  useEffect(() => {
    if (isOpen) {
      fetchQuestions();
    }
  }, [isOpen, fetchQuestions]);

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
    setSelectedDifficulty('');
    setPage(1);
  };

  const handleToggleSelect = (item) => {
    const newMap = new Map(selectedMap);
    if (newMap.has(item.id)) {
      newMap.delete(item.id);
      setSelectedMap(newMap);
      setError(null);
    } else {
      if (newMap.size >= remainingSlots) {
        setError(`Phòng thi chỉ còn trống ${remainingSlots} chỗ (tối đa ${maxAllowed} câu). Vui lòng bỏ chọn bớt hoặc tiếp tục với số câu đã chọn.`);
        return;
      }
      newMap.set(item.id, item);
      setSelectedMap(newMap);
      setError(null);
    }
  };

  const handleConfirmImport = () => {
    const selectedItems = Array.from(selectedMap.values());
    if (selectedItems.length === 0) return;

    if (selectedItems.length > remainingSlots) {
      setError(`Bạn chỉ được chọn tối đa ${remainingSlots} câu hỏi.`);
      return;
    }

    try {
      const normalizedList = [];
      for (let i = 0; i < selectedItems.length; i++) {
        const item = selectedItems[i];
        const nextOrder = existingQuestions.length + i + 1;
        const normalizedQ = normalizeQuestionBankItemToCompetitionQuestion(item, nextOrder);
        normalizedList.push(normalizedQ);
      }

      onImportQuestions(normalizedList);
      onClose();
    } catch (err) {
      setError(err.message || 'Có lỗi xảy ra khi chuẩn hóa câu hỏi từ Ngân hàng.');
    }
  };

  if (!isOpen || typeof document === 'undefined') return null;

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const selectedCount = selectedMap.size;

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-scaleUp">
        {/* HEADER */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 bg-gradient-to-r from-amber-50 to-orange-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-md shadow-amber-500/20">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                Chọn câu hỏi từ Ngân hàng
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                  Trắc nghiệm 1 đáp án
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                Còn trống <strong className="text-amber-600">{remainingSlots}</strong> / {maxAllowed} câu hỏi trong đấu trường
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* SEARCH & FILTERS BAR */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 space-y-3">
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Tìm kiếm nội dung câu hỏi..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent shadow-xs"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold text-xs rounded-xl shadow-xs transition"
            >
              Tìm kiếm
            </button>
            {(appliedSearch || selectedSubject || selectedGrade || selectedDifficulty) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-3 py-2 text-slate-600 hover:bg-slate-200 text-xs font-semibold rounded-xl border border-slate-300 transition"
              >
                Đặt lại
              </button>
            )}
          </form>

          {/* Filter Dropdowns */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select
              value={selectedSubject}
              onChange={(e) => {
                setSelectedSubject(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">Tất cả môn học</option>
              {SUBJECT_OPTIONS.map((sub) => (
                <option key={sub} value={sub}>{sub}</option>
              ))}
            </select>

            <select
              value={selectedGrade}
              onChange={(e) => {
                setSelectedGrade(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">Tất cả khối lớp</option>
              {[1, 2, 3, 4, 5].map((g) => (
                <option key={g} value={g}>Lớp {g}</option>
              ))}
            </select>

            <select
              value={selectedDifficulty}
              onChange={(e) => {
                setSelectedDifficulty(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">Tất cả độ khó</option>
              <option value="easy">Nhận biết</option>
              <option value="medium">Thông hiểu</option>
              <option value="hard">Vận dụng</option>
              <option value="expert">Vận dụng cao</option>
            </select>
          </div>
        </div>

        {/* ERROR BANNER */}
        {error && (
          <div className="p-3 mx-4 mt-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* QUESTIONS LIST */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
              <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
              <p className="text-sm font-medium">Đang tải câu hỏi từ Ngân hàng...</p>
            </div>
          ) : questions.length === 0 ? (
            <div className="py-12 text-center text-slate-500 space-y-2">
              <BookOpen className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-medium">Không tìm thấy câu hỏi phù hợp trong Ngân hàng.</p>
              <p className="text-xs text-slate-400">Vui lòng thử thay đổi từ khóa hoặc bộ lọc tìm kiếm.</p>
            </div>
          ) : (
            questions.map((item) => {
              const isSelected = selectedMap.has(item.id);
              const isAlreadyAdded = isDuplicateQuestion({ _sourceBankId: item.id, question_text: item.prompt || item.title }, existingQuestions);
              const promptText = item.prompt || item.title || '(Không có nội dung)';
              const rawOpts = item.options || item.options_json || [];

              return (
                <div
                  key={item.id}
                  onClick={() => !isAlreadyAdded && handleToggleSelect(item)}
                  className={`p-4 rounded-2xl border transition text-left relative ${
                    isAlreadyAdded
                      ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
                      : isSelected
                      ? 'bg-amber-50/70 border-amber-400 ring-2 ring-amber-400/30 cursor-pointer shadow-xs'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50 cursor-pointer shadow-xs'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <div className="pt-0.5">
                      <div
                        className={`w-5 h-5 rounded-lg flex items-center justify-center border transition ${
                          isAlreadyAdded
                            ? 'bg-slate-200 border-slate-300 text-slate-400'
                            : isSelected
                            ? 'bg-amber-500 border-amber-500 text-white'
                            : 'bg-white border-slate-300'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        {isAlreadyAdded && <Check className="w-3.5 h-3.5 stroke-[2]" />}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 space-y-2 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        {item.subject && (
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 font-semibold text-slate-700">
                            {item.subject}
                          </span>
                        )}
                        {item.grade_level && (
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 font-medium text-slate-600">
                            Lớp {item.grade_level}
                          </span>
                        )}
                        {item.difficulty && DIFFICULTY_LABELS[item.difficulty] && (
                          <span className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${DIFFICULTY_LABELS[item.difficulty].color}`}>
                            {DIFFICULTY_LABELS[item.difficulty].label}
                          </span>
                        )}
                        {isAlreadyAdded && (
                          <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-600 font-bold text-[10px]">
                            ĐÃ CÓ TRONG PHÒNG
                          </span>
                        )}
                      </div>

                      <p className="text-sm font-semibold text-slate-800 leading-snug">
                        {promptText}
                      </p>

                      {/* Options Preview */}
                      {Array.isArray(rawOpts) && rawOpts.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                          {rawOpts.slice(0, 4).map((opt, idx) => {
                            const optText = typeof opt === 'string' ? opt : (opt?.text || String(opt || ''));
                            const letter = String.fromCharCode(65 + idx);
                            return (
                              <div key={idx} className="flex items-center gap-2 text-xs text-slate-600 truncate bg-slate-50/80 px-2.5 py-1 rounded-lg border border-slate-100">
                                <span className="font-bold text-slate-400">{letter}.</span>
                                <span className="truncate">{optText}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* FOOTER ACTIONS & PAGINATION */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Pagination */}
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>
              Trang {page} / {totalPages} ({totalCount} câu)
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage(page - 1)}
                className="p-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => setPage(page + 1)}
                className="p-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 transition"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-semibold transition"
            >
              Hủy bỏ
            </button>
            <button
              type="button"
              disabled={selectedCount === 0 || selectedCount > remainingSlots}
              onClick={handleConfirmImport}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white text-xs font-bold shadow-xs transition disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              Thêm {selectedCount} câu vào đấu trường
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
