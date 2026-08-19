import React, { useState, useEffect } from 'react';
import { Award, Star, BookOpen, Sparkles, Save, X, AlertCircle, CheckCircle2, Plus, MessageSquare } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export function StudentPeriodSummaryModal({ isOpen, onClose, periodId, studentId, canManage }) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [teacherComment, setTeacherComment] = useState('');
  const [autoSuggestion, setAutoSuggestion] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Adjustment state
  const [showAdjust, setShowAdjust] = useState(false);
  const [deltaStars, setDeltaStars] = useState(0);
  const [adjustReason, setAdjustReason] = useState('');

  useEffect(() => {
    if (isOpen && periodId && studentId) {
      fetchSummary();
    }
  }, [isOpen, periodId, studentId]);

  const fetchSummary = async () => {
    try {
      setLoading(true);
      setErrorMessage('');
      const { data, error } = await supabase.rpc('get_student_period_summary', {
        p_period_id: periodId,
        p_student_id: studentId
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.message);

      setSummary(data);
      setTeacherComment(data.teacher_comment || '');
      setAutoSuggestion(data.auto_suggestion || '');
    } catch (err) {
      setErrorMessage('Lỗi khi tải thông tin tổng kết: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApplySuggestion = () => {
    setTeacherComment(autoSuggestion);
    setSuccessMessage('Đã điền gợi ý nhận xét. Vui lòng kiểm tra và chỉnh sửa trước khi bấm Lưu.');
  };

  const handleSaveComment = async () => {
    try {
      setIsSaving(true);
      setErrorMessage('');
      setSuccessMessage('');

      const { data, error } = await supabase.rpc('save_ranking_period_student_comment', {
        p_period_id: periodId,
        p_student_id: studentId,
        p_teacher_comment: teacherComment.trim(),
        p_auto_suggestion: autoSuggestion
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.message);

      setSuccessMessage('Đã lưu nhận xét học sinh thành công!');
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddAdjustment = async (e) => {
    e.preventDefault();
    if (deltaStars === 0) {
      setErrorMessage('Số sao điều chỉnh phải khác 0.');
      return;
    }
    if (!adjustReason.trim()) {
      setErrorMessage('Vui lòng cung cấp lý do điều chỉnh.');
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage('');
      setSuccessMessage('');

      const { data, error } = await supabase.rpc('add_ranking_period_adjustment', {
        p_period_id: periodId,
        p_student_id: studentId,
        p_delta_stars: Number(deltaStars),
        p_reason: adjustReason.trim()
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.message);

      setSuccessMessage('Đã cộng/trừ sao xếp hạng kỳ thành công (Tổng tích lũy không đổi).');
      setShowAdjust(false);
      setDeltaStars(0);
      setAdjustReason('');
      await fetchSummary();
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-xl rounded-3xl shadow-2xl border-4 border-indigo-200 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* HEADER */}
        <div className="p-5 bg-gradient-to-r from-indigo-600 to-indigo-800 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Award className="w-6 h-6 text-amber-300" />
            <div>
              <h2 className="text-base font-black tracking-wide">📋 Tổng Kết Kỳ Xếp Hạng</h2>
              <p className="text-[11px] font-bold text-indigo-100">{summary?.full_name || 'Học sinh'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-2xl transition-all"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* MESSAGES */}
        {errorMessage && (
          <div className="mx-5 mt-4 p-3 bg-rose-50 border-2 border-rose-200 rounded-2xl text-xs font-black text-rose-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mx-5 mt-4 p-3 bg-emerald-50 border-2 border-emerald-200 rounded-2xl text-xs font-black text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* BODY CONTENT */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {loading ? (
            <div className="text-center py-8 text-xs font-bold text-slate-500">Đang tải dữ liệu tổng kết...</div>
          ) : summary ? (
            <>
              {/* STATS CARDS GRID */}
              <div className="grid grid-cols-2 gap-3">
                
                {/* GAME STARS IN PERIOD */}
                <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200">
                  <div className="flex items-center gap-1.5 text-xs font-black text-amber-900 mb-1">
                    <Star className="w-4 h-4 text-amber-500 fill-amber-500" /> Trò Chơi Trong Kỳ
                  </div>
                  <div className="text-xl font-black text-amber-700">{summary.game_stars} ⭐</div>
                  <div className="text-[10px] font-bold text-slate-500 mt-0.5">
                    Đã hoàn thành {summary.game_completed_count} nhiệm vụ
                  </div>
                </div>

                {/* ACADEMIC AVERAGE % */}
                <div className="p-3 bg-indigo-50 rounded-2xl border border-indigo-200">
                  <div className="flex items-center gap-1.5 text-xs font-black text-indigo-900 mb-1">
                    <BookOpen className="w-4 h-4 text-indigo-600" /> Học Thuật Trong Kỳ
                  </div>
                  <div className="text-xl font-black text-indigo-700">{summary.academic_average_percent}%</div>
                  <div className="text-[10px] font-bold text-slate-500 mt-0.5">
                    Đã hoàn thành {summary.academic_completed_count} / {summary.academic_assigned_count} bài
                  </div>
                </div>

              </div>

              {/* TOTAL ACCUMULATED STARS REFERENCE */}
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs font-bold text-slate-700 flex items-center justify-between">
                <span>Tổng Sao Tích Lũy Hồ Sơ (Tham khảo):</span>
                <span className="font-black text-slate-900">{summary.total_accumulated_stars} ⭐</span>
              </div>

              {/* ADJUSTMENT SECTION FOR TEACHER */}
              {canManage && (
                <div className="p-3 bg-indigo-50/50 rounded-2xl border border-indigo-100">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-indigo-950">Điều chỉnh Sao kỳ này:</span>
                    <button
                      type="button"
                      onClick={() => setShowAdjust(!showAdjust)}
                      className="text-[11px] font-black text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> {showAdjust ? 'Ẩn form' : 'Thêm điều chỉnh'}
                    </button>
                  </div>

                  {showAdjust && (
                    <form onSubmit={handleAddAdjustment} className="mt-3 space-y-2 pt-2 border-t border-indigo-100">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-black text-slate-700 mb-0.5">Số sao (+/-):</label>
                          <input
                            type="number"
                            placeholder="Ví dụ: 5 hoặc -3"
                            value={deltaStars}
                            onChange={(e) => setDeltaStars(e.target.value)}
                            className="w-full p-2 bg-white border border-indigo-200 rounded-xl text-xs font-bold"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-slate-700 mb-0.5">Lý do:</label>
                          <input
                            type="text"
                            placeholder="Ví dụ: Thưởng thi đua tuần"
                            value={adjustReason}
                            onChange={(e) => setAdjustReason(e.target.value)}
                            className="w-full p-2 bg-white border border-indigo-200 rounded-xl text-xs font-bold"
                            required
                          />
                        </div>
                      </div>
                      <button
                        type="submit"
                        disabled={isSaving}
                        className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black"
                      >
                        Lưu điều chỉnh Sao kỳ
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* AUTO SUGGESTION SECTION */}
              <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-amber-950 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-600" /> Gợi Ý Nhận Xét Tự Động:
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      onClick={handleApplySuggestion}
                      className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-[11px] font-black shadow-sm"
                    >
                      Dùng gợi ý này
                    </button>
                  )}
                </div>
                <p className="text-xs font-bold text-slate-700 italic bg-white/80 p-2.5 rounded-xl border border-amber-100">
                  "{summary.auto_suggestion}"
                </p>
              </div>

              {/* TEACHER COMMENT TEXTAREA */}
              <div className="space-y-1.5">
                <label className="block text-xs font-black text-indigo-950 flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4 text-indigo-600" /> Nhận Xét Tổng Kết Giáo Viên:
                </label>
                {canManage ? (
                  <textarea
                    rows={4}
                    placeholder="Nhập nhận xét tổng kết cho học sinh..."
                    value={teacherComment}
                    onChange={(e) => setTeacherComment(e.target.value)}
                    className="w-full p-3 bg-white border-2 border-indigo-200 rounded-2xl text-xs font-bold text-slate-900 focus:outline-none focus:border-indigo-500"
                  />
                ) : (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-800">
                    {summary.teacher_comment ? summary.teacher_comment : 'Chưa có nhận xét tổng kết.'}
                  </div>
                )}
              </div>

              {/* SAVE BUTTON FOR TEACHER */}
              {canManage && (
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={handleSaveComment}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-md flex items-center gap-1.5"
                  >
                    <Save className="w-4 h-4" /> {isSaving ? 'Đang lưu...' : 'Lưu Nhận Xét Tổng Kết'}
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>

      </div>
    </div>
  );
}
