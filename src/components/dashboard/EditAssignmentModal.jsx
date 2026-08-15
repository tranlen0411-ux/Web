import React, { useState, useEffect } from 'react';
import { X, BookOpen, Gamepad2, Calendar, Star, Loader2, AlertCircle, RefreshCw, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useSound } from '../../context/SoundContext';

export const EditAssignmentModal = ({ isOpen, onClose, assignmentToEdit, availableGames, onSaved, onDeleted }) => {
  const { triggerSound } = useSound();

  const [selectedGameId, setSelectedGameId] = useState('');
  const [rewardStars, setRewardStars] = useState(10);
  const [dueDate, setDueDate] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [hasCompletedProgress, setHasCompletedProgress] = useState(false);
  const [checkingProgress, setCheckingProgress] = useState(false);

  useEffect(() => {
    if (assignmentToEdit) {
      setSelectedGameId(assignmentToEdit.game_id || '');
      setRewardStars(assignmentToEdit.reward_stars || 10);
      setDueDate(assignmentToEdit.due_date ? assignmentToEdit.due_date.slice(0, 10) : '');
      setErrorMsg('');

      // Kiểm tra xem đã có học sinh nào làm bài tập này chưa
      checkExistingProgress(assignmentToEdit.id);
    }
  }, [assignmentToEdit, isOpen]);

  const checkExistingProgress = async (assignId) => {
    setCheckingProgress(true);
    try {
      const { count, error } = await supabase
        .from('student_progress')
        .select('id', { count: 'exact', head: true })
        .eq('assignment_id', assignId);

      if (!error && count && count > 0) {
        setHasCompletedProgress(true);
      } else {
        setHasCompletedProgress(false);
      }
    } catch (err) {
      console.error('Error checking progress:', err);
    } finally {
      setCheckingProgress(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedGameId) {
      setErrorMsg('Vui lòng chọn trò chơi muốn giao.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const isGameChanged = selectedGameId !== assignmentToEdit.game_id;

      if (isGameChanged && hasCompletedProgress) {
        // BẢO TOÀN LỊCH SỬ HỌC SINH: Đã có học sinh làm bài tập cũ -> Tạo lượt giao mới cho game mới, giữ lại lịch sử cũ
        const { error: newAssignErr } = await supabase
          .from('assignments')
          .insert({
            game_id: selectedGameId,
            class_id: assignmentToEdit.class_id,
            reward_stars: parseInt(rewardStars),
            due_date: dueDate ? new Date(dueDate).toISOString() : null
          });

        if (newAssignErr) throw newAssignErr;

      } else {
        // Chưa có học sinh nào làm bài cũ HOẶC chỉ đổi ngày/sao -> Cập nhật trực tiếp bản ghi assignments
        const { error: updateErr } = await supabase
          .from('assignments')
          .update({
            game_id: selectedGameId,
            reward_stars: parseInt(rewardStars),
            due_date: dueDate ? new Date(dueDate).toISOString() : null
          })
          .eq('id', assignmentToEdit.id);

        if (updateErr) throw updateErr;
      }

      triggerSound('victory');
      if (onSaved) onSaved();
      onClose();

    } catch (err) {
      console.error('Update assignment error:', err);
      setErrorMsg(err.message || 'Không thể cập nhật lượt giao bài.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAssignment = async () => {
    if (!window.confirm('Thầy/Cô có chắc chắn muốn hủy lượt giao bài này? (Kết quả làm bài cũ của học sinh vẫn được bảo toàn)')) {
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('assignments')
        .delete()
        .eq('id', assignmentToEdit.id);

      if (error) throw error;

      triggerSound('click');
      if (onDeleted) onDeleted();
      onClose();
    } catch (err) {
      console.error('Delete assignment error:', err);
      setErrorMsg('Lỗi khi hủy lượt giao bài: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !assignmentToEdit) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-md bg-white rounded-3xl border-4 border-amber-300 p-6 shadow-2xl">
        
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-black text-amber-950 mb-1 flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-sky-600" /> Quản Lý & Thay Bài Đã Giao
        </h3>
        <p className="text-xs font-bold text-slate-500 mb-4">
          Lớp: <span className="text-sky-700 font-extrabold">{assignmentToEdit.classes?.name || 'Lớp học'}</span>
        </p>

        {errorMsg && (
          <div className="mb-4 p-3 bg-rose-50 border-2 border-rose-200 rounded-2xl text-rose-800 font-bold text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {hasCompletedProgress && (
          <div className="mb-4 p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl text-amber-900 font-bold text-[11px]">
            💡 <strong>Lưu ý bảo toàn lịch sử:</strong> Lượt giao này đã có học sinh hoàn thành. Nếu Thầy/Cô thay sang trò chơi mới, hệ thống sẽ tự động tạo lượt giao mới và giữ nguyên lịch sử điểm thưởng bài cũ của các bé.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* CHỌN TRÒ CHƠI THAY THẾ */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1 flex items-center gap-1">
              <Gamepad2 className="w-4 h-4 text-sky-600" /> Chọn Trò Chơi Mới:
            </label>
            <select
              value={selectedGameId}
              onChange={(e) => setSelectedGameId(e.target.value)}
              className="w-full p-3 bg-amber-50/70 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none"
              required
            >
              {availableGames.map((g) => (
                <option key={g.id} value={g.id}>
                  🎮 {g.title} (Khối {g.grade_level} - {g.subject})
                </option>
              ))}
            </select>
          </div>

          {/* SAO THƯỞNG */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1 flex items-center gap-1">
              <Star className="w-4 h-4 text-amber-500" /> Sao Thưởng Hoàn Thành:
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={rewardStars}
              onChange={(e) => setRewardStars(e.target.value)}
              className="w-full p-3 bg-amber-50/70 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800"
              required
            />
          </div>

          {/* HẠN HOÀN THÀNH */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1 flex items-center gap-1">
              <Calendar className="w-4 h-4 text-purple-600" /> Hạn Hoàn Thành (Tùy chọn):
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full p-3 bg-amber-50/70 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800"
            />
          </div>

          {/* BUTTONS THAO TÁC */}
          <div className="flex flex-col gap-2 pt-2">
            <button
              type="submit"
              disabled={loading || checkingProgress}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs rounded-2xl border-b-4 border-emerald-700 shadow-md flex items-center justify-center gap-2 active:translate-y-0.5 transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {loading ? 'Đang Lưu...' : 'Cập Nhật Bài Giao'}
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-xl"
              >
                Đóng
              </button>

              <button
                type="button"
                onClick={handleDeleteAssignment}
                disabled={loading}
                className="py-2.5 px-4 bg-rose-100 hover:bg-rose-200 text-rose-700 font-black text-xs rounded-xl flex items-center gap-1"
              >
                <Trash2 className="w-4 h-4" /> Hủy Lượt Giao
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
};
