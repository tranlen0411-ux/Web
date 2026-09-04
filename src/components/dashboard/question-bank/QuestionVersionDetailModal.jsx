import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  FileText,
  AlertCircle,
  RefreshCw,
  Lock,
  Globe,
  Sparkles,
  HelpCircle,
  Calendar,
  User,
  Lightbulb,
  Check
} from 'lucide-react';
import { getQuestionAuthoringDetail } from '../../../services/questionBankService';

const DIFFICULTY_LABELS = {
  easy: { label: 'Nhận biết', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  medium: { label: 'Thông hiểu', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  hard: { label: 'Vận dụng', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  expert: { label: 'Vận dụng cao', color: 'bg-rose-50 text-rose-700 border-rose-200' }
};

const TYPE_LABELS = {
  single_choice: 'Trắc nghiệm một đáp án',
  multiple_choice: 'Trắc nghiệm nhiều đáp án',
  fill_blank: 'Điền khuyết',
  short_answer: 'Trả lời ngắn',
  essay: 'Tự luận',
  image_upload: 'Tải ảnh',
  file_upload: 'Tải tệp'
};

const VISIBILITY_LABELS = {
  private: { label: 'Cá nhân', icon: Lock, color: 'text-slate-500 bg-slate-100' },
  school_shared: { label: 'Toàn trường', icon: Globe, color: 'text-indigo-600 bg-indigo-50' },
  public_template: { label: 'Mẫu công khai', icon: Globe, color: 'text-emerald-600 bg-emerald-50' }
};

export const QuestionVersionDetailModal = ({
  isOpen,
  onClose,
  onBackToHistory,
  item,
  version
}) => {
  const [detailData, setDetailData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const itemId = item?.id || item?.item_id;
  const versionId = version?.id;

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const fetchDetail = async () => {
    if (!itemId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getQuestionAuthoringDetail(itemId, versionId);
      setDetailData(data);
    } catch (err) {
      console.error('[QuestionVersionDetailModal] Lỗi tải chi tiết phiên bản:', err);
      setError(err?.message || 'Không thể tải chi tiết nội dung của phiên bản này.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && itemId) {
      fetchDetail();
    } else {
      setDetailData(null);
      setError(null);
    }
  }, [isOpen, itemId, versionId]);

  if (!isOpen || typeof document === 'undefined') return null;

  const itemMeta = detailData?.item || item || {};
  const versionDetail = detailData?.version || version || {};
  const answerKey = detailData?.answer_key || null;

  const diffInfo = DIFFICULTY_LABELS[itemMeta.difficulty] || { label: itemMeta.difficulty || 'Chưa phân loại', color: 'bg-slate-100 text-slate-700 border-slate-200' };
  const typeLabel = TYPE_LABELS[versionDetail.question_type || itemMeta.question_type] || versionDetail.question_type || itemMeta.question_type || 'Trắc nghiệm';
  const visInfo = VISIBILITY_LABELS[itemMeta.visibility] || { label: itemMeta.visibility || 'Cá nhân', color: 'text-slate-500 bg-slate-100' };
  const VisIcon = visInfo.icon || Lock;

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return dateStr;
    }
  };

  const isOptionCorrect = (optId) => {
    if (!answerKey || !optId) return false;
    if (answerKey.correct_option_id) {
      return String(answerKey.correct_option_id) === String(optId);
    }
    if (Array.isArray(answerKey.correct_option_ids)) {
      return answerKey.correct_option_ids.map(String).includes(String(optId));
    }
    return false;
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl border-4 border-indigo-200 animate-scaleUp overflow-hidden">
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between p-5 border-b border-indigo-100 bg-gradient-to-r from-indigo-50/80 to-purple-50/50">
          <div className="flex items-center gap-3">
            {onBackToHistory && (
              <button
                type="button"
                onClick={onBackToHistory}
                className="p-2 rounded-xl text-indigo-700 hover:bg-indigo-100 transition-colors mr-1"
                title="Quay lại danh sách phiên bản"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-sm shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-indigo-950">
                  Nội Dung Phiên Bản v{versionDetail.version_number || version?.version_number || '—'}
                </h3>
                <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                  Chỉ đọc (Read-only)
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium line-clamp-1 max-w-lg mt-0.5">
                {itemMeta.title || versionDetail.prompt || `ID: ${itemId}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            title="Đóng modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODAL BODY */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-5">
          {loading ? (
            <div className="py-20 text-center">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-3" />
              <p className="text-sm font-black text-slate-700">Đang tải nội dung phiên bản...</p>
              <p className="text-xs text-slate-400 mt-1">Đang trích xuất nội dung an toàn từ máy chủ</p>
            </div>
          ) : error ? (
            <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-xs sm:text-sm font-black text-rose-800">Không thể tải nội dung câu hỏi</h4>
                <p className="text-xs text-rose-600 font-medium mt-0.5">{error}</p>
                <button
                  onClick={fetchDetail}
                  className="mt-2 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-black rounded-lg transition-colors"
                >
                  Thử lại
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* METADATA CHIPS BAR */}
              <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs">
                <span className="font-black px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {itemMeta.subject || 'Chung'}
                </span>
                {itemMeta.grade_level && (
                  <span className="font-black px-2.5 py-1 rounded-lg bg-slate-200 text-slate-800">
                    Lớp {itemMeta.grade_level}
                  </span>
                )}
                <span className={`font-black px-2.5 py-1 rounded-lg border ${diffInfo.color}`}>
                  {diffInfo.label}
                </span>
                <span className="font-bold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700">
                  {typeLabel}
                </span>
                <span className={`inline-flex items-center gap-1 font-bold px-2.5 py-1 rounded-lg ${visInfo.color}`}>
                  <VisIcon className="w-3.5 h-3.5" />
                  {visInfo.label}
                </span>
              </div>

              {/* GHI CHÚ PHIÊN BẢN */}
              <div className="bg-indigo-50/50 rounded-2xl p-3.5 border border-indigo-100 text-xs space-y-1">
                <div className="flex items-center justify-between text-slate-500 text-[11px] font-medium">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Thời gian tạo: <strong className="text-slate-700">{formatDateTime(versionDetail.created_at)}</strong></span>
                  </div>
                  {versionDetail.id && (
                    <span className="font-mono text-[10px] text-slate-400">
                      Version ID: {versionDetail.id.slice(0, 8)}...
                    </span>
                  )}
                </div>
                {versionDetail.change_log && (
                  <div className="text-slate-700 pt-1">
                    <strong className="text-indigo-900">Ghi chú thay đổi: </strong>
                    <span>{versionDetail.change_log}</span>
                  </div>
                )}
              </div>

              {/* NỘI DUNG ĐỀ BÀI (PROMPT) */}
              <div className="space-y-2">
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider">
                  Nội dung đề bài
                </label>
                <div className="p-4 rounded-2xl bg-white border-2 border-slate-200 text-sm font-bold text-slate-900 leading-relaxed whitespace-pre-wrap shadow-inner">
                  {versionDetail.prompt || '(Không có nội dung)'}
                </div>
              </div>

              {/* DANH SÁCH LỰA CHỌN ĐÁP ÁN (OPTIONS CHO TRẮC NGHIỆM) */}
              {Array.isArray(versionDetail.options) && versionDetail.options.length > 0 && (
                <div className="space-y-2.5">
                  <label className="block text-xs font-black text-slate-700 uppercase tracking-wider">
                    Lựa chọn đáp án
                  </label>
                  <div className="grid grid-cols-1 gap-2.5">
                    {versionDetail.options.map((opt, idx) => {
                      const optText = typeof opt === 'string' ? opt : opt?.text || opt?.content || '';
                      const optId = typeof opt === 'object' && opt?.id ? opt.id : `opt_${idx + 1}`;
                      const isCorrect = isOptionCorrect(optId);

                      return (
                        <div
                          key={optId || idx}
                          className={`p-3.5 rounded-2xl border-2 flex items-center justify-between gap-3 transition-all ${
                            isCorrect
                              ? 'bg-emerald-50/70 border-emerald-400 text-emerald-950 font-bold shadow-xs'
                              : 'bg-slate-50/50 border-slate-200 text-slate-800'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={`w-7 h-7 rounded-xl flex items-center justify-center font-black text-xs shrink-0 ${
                                isCorrect
                                  ? 'bg-emerald-600 text-white shadow-xs'
                                  : 'bg-slate-200 text-slate-700'
                              }`}
                            >
                              {String.fromCharCode(65 + idx)}
                            </span>
                            <span className="text-xs sm:text-sm font-semibold">{optText}</span>
                          </div>
                          {isCorrect && (
                            <span className="inline-flex items-center gap-1 text-xs font-black text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-xl shrink-0">
                              <Check className="w-3.5 h-3.5" />
                              Đáp án đúng
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ĐÁP ÁN ĐÚNG CHO DẠNG ĐIỀN KHUYẾT / TRẢ LỜI NGẮN */}
              {answerKey && Array.isArray(answerKey.correct_answers) && answerKey.correct_answers.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-black text-slate-700 uppercase tracking-wider">
                    Đáp án đúng (Điền khuyết / Trả lời ngắn)
                  </label>
                  <div className="p-3.5 rounded-2xl bg-emerald-50 border-2 border-emerald-300 text-xs sm:text-sm font-black text-emerald-900 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>{answerKey.correct_answers.join(' | ')}</span>
                  </div>
                </div>
              )}

              {/* LỜI GIẢI CHI TIẾT (EXPLANATION) */}
              {versionDetail.explanation && (
                <div className="space-y-2">
                  <label className="block text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                    <span>Lời giải chi tiết / Hướng dẫn chấm</span>
                  </label>
                  <div className="p-3.5 rounded-2xl bg-amber-50/60 border border-amber-200 text-xs text-slate-800 leading-relaxed whitespace-pre-wrap font-medium">
                    {versionDetail.explanation}
                  </div>
                </div>
              )}

              {/* GỢI Ý (HINTS) */}
              {Array.isArray(versionDetail.hints) && versionDetail.hints.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-black text-slate-700 uppercase tracking-wider">
                    Gợi ý làm bài
                  </label>
                  <ul className="list-disc pl-5 text-xs text-slate-600 space-y-1 font-medium">
                    {versionDetail.hints.map((hint, hIdx) => (
                      <li key={hIdx}>{typeof hint === 'string' ? hint : JSON.stringify(hint)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* MODAL FOOTER */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500 font-medium">
          {onBackToHistory ? (
            <button
              type="button"
              onClick={onBackToHistory}
              className="px-4 py-2 text-xs font-black rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 transition-colors flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Quay lại lịch sử</span>
            </button>
          ) : (
            <span className="text-[11px] text-slate-400">
              Chỉ đọc: Không thể chỉnh sửa trực tiếp.
            </span>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-black rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default QuestionVersionDetailModal;
