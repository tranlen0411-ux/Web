import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  History,
  Clock,
  CheckCircle2,
  Eye,
  AlertCircle,
  RefreshCw,
  User,
  FileText,
  Calendar,
  Layers
} from 'lucide-react';
import { listQuestionVersions } from '../../../services/questionBankService';

export const QuestionVersionHistoryModal = ({
  isOpen,
  onClose,
  item,
  onSelectVersionDetail,
  authorProfilesById = {}
}) => {
  const [versions, setVersions] = useState([]);
  const [currentVersionId, setCurrentVersionId] = useState(null);
  const [totalVersions, setTotalVersions] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const itemId = item?.id || item?.item_id;

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

  const fetchVersions = async () => {
    if (!itemId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listQuestionVersions(itemId);
      setVersions(data?.versions || []);
      setCurrentVersionId(data?.current_version_id || null);
      setTotalVersions(data?.total_versions || 0);
    } catch (err) {
      console.error('[QuestionVersionHistoryModal] Lỗi tải lịch sử phiên bản:', err);
      setError(err?.message || 'Không thể tải danh sách phiên bản của câu hỏi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && itemId) {
      fetchVersions();
    } else {
      setVersions([]);
      setCurrentVersionId(null);
      setTotalVersions(0);
      setError(null);
    }
  }, [isOpen, itemId]);

  if (!isOpen || typeof document === 'undefined') return null;

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (_) {
      return dateStr;
    }
  };

  const getCreatorDisplay = (creatorId) => {
    if (!creatorId) return 'Hệ thống';
    const profile = authorProfilesById[creatorId];
    if (profile?.full_name?.trim()) return profile.full_name.trim();
    if (profile?.email?.trim()) return profile.email.trim();
    return `ID: ${creatorId.slice(0, 8)}...`;
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border-4 border-indigo-200 animate-scaleUp overflow-hidden">
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between p-5 border-b border-indigo-100 bg-gradient-to-r from-indigo-50/70 to-purple-50/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-indigo-950">
                  Lịch Sử Phiên Bản Câu Hỏi
                </h3>
                <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200">
                  {totalVersions} phiên bản
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium line-clamp-1 max-w-md mt-0.5" title={item?.title || item?.prompt}>
                {item?.title || item?.prompt || `ID: ${itemId}`}
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
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {loading ? (
            <div className="py-16 text-center">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-3" />
              <p className="text-sm font-black text-slate-700">Đang tải lịch sử phiên bản...</p>
              <p className="text-xs text-slate-400 mt-1">Đang đồng bộ danh sách phiên bản từ kho lưu trữ</p>
            </div>
          ) : error ? (
            <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-xs sm:text-sm font-black text-rose-800">Không thể tải lịch sử phiên bản</h4>
                <p className="text-xs text-rose-600 font-medium mt-0.5">{error}</p>
                <button
                  onClick={fetchVersions}
                  className="mt-2 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-black rounded-lg transition-colors"
                >
                  Thử lại
                </button>
              </div>
            </div>
          ) : versions.length === 0 ? (
            <div className="py-12 text-center bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
              <Clock className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-black text-slate-700">Chưa có phiên bản nào được ghi nhận</p>
              <p className="text-xs text-slate-400 mt-1">Câu hỏi này chưa có dữ liệu lịch sử chỉnh sửa.</p>
            </div>
          ) : (
            <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-indigo-100">
              {versions.map((v, idx) => {
                const isCurrent = Boolean(v.is_current || (currentVersionId && v.id === currentVersionId));

                return (
                  <div key={v.id || idx} className="relative group">
                    {/* TIMELINE NODE */}
                    <div
                      className={`absolute -left-6 top-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                        isCurrent
                          ? 'bg-emerald-500 border-emerald-200 text-white shadow-xs'
                          : 'bg-white border-slate-300 text-slate-400 group-hover:border-indigo-400'
                      }`}
                    >
                      {isCurrent ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      )}
                    </div>

                    {/* CARD NỘI DUNG PHIÊN BẢN */}
                    <div
                      className={`p-4 rounded-2xl border transition-all ${
                        isCurrent
                          ? 'bg-emerald-50/40 border-emerald-200 shadow-xs'
                          : 'bg-slate-50/70 border-slate-200 hover:bg-white hover:border-indigo-200 hover:shadow-xs'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-200/70">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs sm:text-sm font-black text-slate-900">
                            Phiên bản v{v.version_number}
                          </span>
                          {isCurrent ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Bản hiện tại
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600">
                              Bản cũ
                            </span>
                          )}
                        </div>

                        {/* NÚT XEM NỘI DUNG PHIÊN BẢN (READ ONLY) */}
                        <button
                          type="button"
                          onClick={() => onSelectVersionDetail && onSelectVersionDetail(item, v)}
                          className="self-start sm:self-auto px-3 py-1.5 text-xs font-black rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center gap-1.5 shadow-xs"
                          title="Xem chi tiết nội dung phiên bản này"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Xem nội dung</span>
                        </button>
                      </div>

                      {/* GHI CHÚ THAY ĐỔI & THÔNG TIN TÁC GIẢ */}
                      <div className="pt-2.5 space-y-1.5 text-xs">
                        <div className="flex items-start gap-1.5 text-slate-700">
                          <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                          <span className="font-semibold text-slate-800">
                            {v.change_log || '(Không có ghi chú thay đổi)'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 font-medium pt-1">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            <span>{formatDateTime(v.created_at)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3 text-slate-400" />
                            <span>Tạo bởi: <strong className="text-slate-700 font-bold">{getCreatorDisplay(v.created_by)}</strong></span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* MODAL FOOTER */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500 font-medium">
          <span className="text-[11px] text-slate-400">
            Chế độ lịch sử: Chỉ hỗ trợ xem chi tiết phiên bản (Read-only).
          </span>
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

export default QuestionVersionHistoryModal;
