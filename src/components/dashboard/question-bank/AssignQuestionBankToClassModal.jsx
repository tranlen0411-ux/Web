import React, { useState, useEffect } from 'react';
import {
  X,
  Send,
  Calendar,
  Award,
  Layers,
  CheckSquare,
  Square,
  AlertCircle,
  RefreshCw,
  Sparkles,
  BookOpen,
  GraduationCap,
  CheckCircle2,
  Lock
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { formatClassLabel } from '../../../utils/helpers';
import { getQuestionAuthoringDetail } from '../../../services/questionBankService';
import { transformQuestionBankToAcademicExercise } from '../../../utils/questionBankAdapters';

export const AssignQuestionBankToClassModal = ({
  isOpen,
  onClose,
  onSuccess,
  item,
  classes: propClasses
}) => {
  const { profile } = useAuth();

  const [classesList, setClassesList] = useState([]);
  const [selectedClassIds, setSelectedClassIds] = useState([]);
  const [exerciseTitle, setExerciseTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [rewardStars, setRewardStars] = useState(10);
  const [countsTowardRanking, setCountsTowardRanking] = useState(true);

  const [isLoadingDetail, setIsLoadingDetail] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [authoringDetail, setAuthoringDetail] = useState(null);

  useEffect(() => {
    if (!isOpen || !item) {
      setAuthoringDetail(null);
      setSelectedClassIds([]);
      setErrorMsg('');
      setIsSubmitting(false);
      return;
    }

    let isMounted = true;
    setIsLoadingDetail(true);
    setErrorMsg('');

    // Thiết lập tiêu đề bài tập mặc định
    const defaultTitle = item.title || item.prompt || 'Bài tập câu hỏi trắc nghiệm';
    setExerciseTitle(defaultTitle);
    setRewardStars(10);
    setDueDate('');
    setCountsTowardRanking(true);

    // 1. Tải danh sách lớp học giáo viên phụ trách
    const loadClasses = async () => {
      if (Array.isArray(propClasses) && propClasses.length > 0) {
        if (isMounted) setClassesList(propClasses);
        return;
      }
      try {
        let query = supabase.from('classes').select('id, name, grade_level');
        if (profile?.role === 'teacher' && profile?.id) {
          query = query.eq('teacher_id', profile.id);
        }
        query = query.order('grade_level');
        const { data, error } = await query;
        if (!error && Array.isArray(data) && isMounted) {
          setClassesList(data);
        }
      } catch (err) {
        console.warn('[AssignQuestionBankToClassModal] Không thể tải danh sách lớp học:', err);
      }
    };

    // 2. Tải snapshot version & answer key từ authoring detail
    const loadDetail = async () => {
      if (!item.current_version_id) {
        if (isMounted) {
          setErrorMsg('Lỗi: Câu hỏi thiếu thông tin phiên bản hiện tại (current_version_id). Không thể giao bài.');
          setIsLoadingDetail(false);
        }
        return;
      }

      try {
        const detail = await getQuestionAuthoringDetail(item.id, item.current_version_id);
        if (!isMounted) return;
        setAuthoringDetail(detail);
      } catch (err) {
        if (!isMounted) return;
        console.error('[AssignQuestionBankToClassModal] Lỗi lấy chi tiết câu hỏi:', err);
        setErrorMsg(err?.message || 'Không thể tải chi tiết phiên bản câu hỏi. Vui lòng thử lại.');
      } finally {
        if (isMounted) setIsLoadingDetail(false);
      }
    };

    loadClasses();
    loadDetail();

    return () => { isMounted = false; };
  }, [isOpen, item, profile?.id, propClasses]);

  if (!isOpen || !item) return null;

  const handleToggleClass = (classId) => {
    setSelectedClassIds((prev) =>
      prev.includes(classId)
        ? prev.filter((id) => id !== classId)
        : [...prev, classId]
    );
  };

  const handleSelectAllClasses = () => {
    if (selectedClassIds.length === classesList.length) {
      setSelectedClassIds([]);
    } else {
      setSelectedClassIds(classesList.map((c) => c.id));
    }
  };

  const handleConfirmAssign = async () => {
    if (isSubmitting) return;

    if (!item.current_version_id) {
      setErrorMsg('Lỗi: Không tìm thấy phiên bản snapshot hiện tại của câu hỏi.');
      return;
    }

    if (selectedClassIds.length === 0) {
      setErrorMsg('Vui lòng chọn ít nhất 1 Lớp học để giao bài.');
      return;
    }

    if (!authoringDetail || !authoringDetail.version) {
      setErrorMsg('Dữ liệu phiên bản câu hỏi chưa sẵn sàng. Vui lòng thử lại sau giây lát.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      // 1. Chuyển đổi Snapshot Question Bank sang Academic Exercise & Question Payload
      // V1 lineage persistence is stored in description metadata tags.
      const { exercise: exercisePayload, questions: questionsPayload } = transformQuestionBankToAcademicExercise(
        authoringDetail.item || item,
        authoringDetail.version,
        authoringDetail.answer_key,
        {
          title: exerciseTitle.trim(),
          due_date: dueDate,
          reward_stars: rewardStars
        }
      );

      // Gắn lớp đầu tiên vào class_id của exercise (để tương thích ngược schema cũ)
      exercisePayload.class_id = selectedClassIds[0] || null;

      // 2. Tạo bài tập học thuật qua RPC save_exercise_with_questions_and_keys
      const { data: saveRes, error: saveErr } = await supabase.rpc('save_exercise_with_questions_and_keys', {
        p_exercise: exercisePayload,
        p_questions: questionsPayload
      });

      if (saveErr || !saveRes?.success) {
        const errorText = saveErr?.message || saveRes?.message || 'Lỗi khi tạo bài tập từ câu hỏi.';
        setErrorMsg(errorText);
        setIsSubmitting(false);
        return;
      }

      const createdExerciseId = saveRes.exercise_id;
      if (!createdExerciseId) {
        setErrorMsg('Không thể nhận diện mã bài tập đã tạo.');
        setIsSubmitting(false);
        return;
      }

      // 3. Giao bài tập cho các lớp được chọn qua RPC assign_exercise_to_classes
      const { data: assignRes, error: assignErr } = await supabase.rpc('assign_exercise_to_classes', {
        p_exercise_id: createdExerciseId,
        p_class_ids: selectedClassIds,
        p_counts_toward_ranking: countsTowardRanking
      });

      if (assignErr) {
        setErrorMsg(assignErr.message || 'Lỗi hệ thống khi giao bài tập cho các lớp.');
        setIsSubmitting(false);
        return;
      }

      if (!assignRes || !assignRes.success) {
        setErrorMsg(assignRes?.message || 'Không thể hoàn tất việc giao bài cho các lớp.');
        setIsSubmitting(false);
        return;
      }

      // 4. Hoàn tất thành công
      const classCount = selectedClassIds.length;
      const successToast = `Đã giao bài tập cho ${classCount} lớp thành công!`;
      onSuccess(successToast);
      onClose();
    } catch (err) {
      console.error('[AssignQuestionBankToClassModal] Lỗi thực hiện giao bài:', err);
      setErrorMsg(err?.message || 'Lỗi không xác định khi giao bài tập.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isAllSelected = classesList.length > 0 && selectedClassIds.length === classesList.length;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-xl w-full max-h-[90dvh] shadow-2xl border-4 border-indigo-200 flex flex-col overflow-hidden animate-scaleUp">
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-indigo-100 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-100 flex items-center justify-center text-indigo-700 shrink-0">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900">
                Giao câu hỏi cho lớp
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Tạo bài tập học thuật tự động từ phiên bản snapshot câu hỏi hiện tại
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODAL BODY */}
        <div className="p-6 overflow-y-auto space-y-5 text-left text-xs font-medium text-slate-700">
          {/* THÔNG BÁO LỖI NẾU CÓ */}
          {errorMsg && (
            <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-3.5 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-700 font-bold">{errorMsg}</p>
            </div>
          )}

          {/* CARD THÔNG TIN CÂU HỎI SNAPSHOT */}
          <div className="bg-indigo-50/60 border-2 border-indigo-100 rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase text-indigo-900 tracking-wider">
                Câu hỏi nguồn trong Question Bank
              </span>
              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-md font-bold text-[10px]">
                {authoringDetail?.version ? `Phiên bản #${authoringDetail.version.version_number}` : 'Đang tải version...'}
              </span>
            </div>

            <div className="font-bold text-slate-900 text-sm line-clamp-2">
              {item.title || item.prompt || '(Không có tiêu đề)'}
            </div>

            <div className="flex items-center gap-2 flex-wrap text-[11px] font-bold text-slate-600 pt-1 border-t border-indigo-100/80">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-indigo-100">
                <BookOpen className="w-3 h-3 text-indigo-600" />
                Môn: <strong className="text-slate-900">{item.subject || 'Chung'}</strong>
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-indigo-100">
                <GraduationCap className="w-3 h-3 text-indigo-600" />
                Khối: <strong className="text-slate-900">{item.grade_level ? `Lớp ${item.grade_level}` : '—'}</strong>
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-indigo-100">
                <Layers className="w-3 h-3 text-indigo-600" />
                Dạng câu: <strong className="text-slate-900">{item.question_type || 'Trắc nghiệm'}</strong>
              </span>
            </div>
          </div>

          {isLoadingDetail ? (
            <div className="py-8 text-center">
              <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin mx-auto mb-2" />
              <p className="text-xs text-slate-500 font-bold">Đang tải dữ liệu phiên bản câu hỏi...</p>
            </div>
          ) : (
            <>
              {/* TÊN BÀI TẬP HIỂN THỊ */}
              <div>
                <label className="block text-xs font-black text-slate-800 mb-1.5">
                  Tên bài tập hiển thị cho học sinh <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={exerciseTitle}
                  onChange={(e) => setExerciseTitle(e.target.value)}
                  placeholder="Nhập tên bài tập..."
                  className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              {/* CHỌN LỚP HỌC GIAO BÀI */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <span>Chọn lớp học giao bài</span>
                    <span className="text-rose-500">*</span>
                    <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                      Đã chọn: {selectedClassIds.length} lớp
                    </span>
                  </label>
                  {classesList.length > 0 && (
                    <button
                      type="button"
                      onClick={handleSelectAllClasses}
                      className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 underline"
                    >
                      {isAllSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                    </button>
                  )}
                </div>

                {classesList.length === 0 ? (
                  <div className="bg-slate-50 p-4 rounded-xl text-center text-slate-500 border border-slate-200">
                    Không tìm thấy lớp học nào do bạn phụ trách.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-1">
                    {classesList.map((c) => {
                      const isSelected = selectedClassIds.includes(c.id);
                      return (
                        <div
                          key={c.id}
                          onClick={() => handleToggleClass(c.id)}
                          className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-indigo-50/80 border-indigo-300 text-indigo-950 font-black shadow-xs'
                              : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700 font-bold'
                          }`}
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-indigo-600 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <div className="truncate">
                            <span>{c.name ? formatClassLabel(c.name) : `Lớp ID: ${c.id.slice(0, 6)}`}</span>
                            {c.grade_level && (
                              <span className="text-[10px] text-slate-400 font-normal ml-1.5">
                                (Khối {c.grade_level})
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* HẠN NỘP & SỐ SAO THƯỞNG */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-black text-slate-800 mb-1 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    <span>Hạn nộp bài (Tùy chọn)</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-800 mb-1 flex items-center gap-1">
                    <Award className="w-3.5 h-3.5 text-amber-500" />
                    <span>Sao thưởng hoàn thành</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={rewardStars}
                    onChange={(e) => setRewardStars(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* TÍNH ĐIỂM XẾP HẠNG */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={countsTowardRanking}
                    onChange={(e) => setCountsTowardRanking(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-black text-slate-900 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      Tính điểm vào Bảng xếp hạng học sinh
                    </span>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Điểm làm bài của học sinh sẽ được ghi nhận vào Bảng xếp hạng lớp học.
                    </p>
                  </div>
                </label>
              </div>
            </>
          )}
        </div>

        {/* MODAL FOOTER */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50/80 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-black rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors disabled:opacity-50"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleConfirmAssign}
            disabled={isSubmitting || isLoadingDetail || selectedClassIds.length === 0}
            className="px-5 py-2 text-xs font-black rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Đang giao bài...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Giao bài ngay</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssignQuestionBankToClassModal;
