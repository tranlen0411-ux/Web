import React, { useState, useEffect } from 'react';
import { X, Calendar, Award, GraduationCap, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

export const AssignGameModal = ({ isOpen, onClose, game }) => {
  const { user } = useAuth();
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [rewardStars, setRewardStars] = useState(15);
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (isOpen && user?.id) {
      fetchTeacherClasses();
    }
  }, [isOpen, user?.id]);

  const fetchTeacherClasses = async () => {
    try {
      const { data, error } = await supabase
        .from('classes')
        .select('*')
        .eq('teacher_id', user.id);
      
      if (!error && data) {
        setClasses(data);
        if (data.length > 0) setSelectedClass(data[0].id);
      }
    } catch (err) {
      console.error('Error fetching classes:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedClass || !game?.id) return;

    setLoading(true);
    try {
      const { error } = await supabase.from('assignments').insert({
        game_id: game.id,
        class_id: selectedClass,
        reward_stars: parseInt(rewardStars),
        due_date: dueDate ? new Date(dueDate).toISOString() : null
      });

      if (error) throw error;

      setSuccessMsg('Giao bài tập thành công cho lớp học!');
      setTimeout(() => {
        setSuccessMsg('');
        onClose();
      }, 1500);
    } catch (err) {
      console.error('Assign error:', err);
      alert('Không thể giao bài: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !game) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg bg-white rounded-3xl border-4 border-amber-300 p-6 shadow-2xl">
        
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-black text-amber-900 mb-1 flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-amber-600" /> Giao Bài Tập Game
        </h3>
        <p className="text-xs font-bold text-slate-500 mb-4">
          Game: <span className="text-amber-600 font-extrabold">{game.title}</span>
        </p>

        {successMsg ? (
          <div className="p-4 bg-emerald-100 border-2 border-emerald-400 text-emerald-900 rounded-2xl text-center font-black flex items-center justify-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-600" /> {successMsg}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">
                Chọn Lớp Học Cần Giao:
              </label>
              {classes.length > 0 ? (
                <select
                  value={selectedClass}
                  onChange={(e) => setSelectedClass(e.target.value)}
                  className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800 focus:outline-none focus:border-amber-400"
                  required
                >
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name} (Khối {cls.grade_level} - Mã: {cls.code})
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs font-bold text-rose-500 p-3 bg-rose-50 rounded-xl border border-rose-200">
                  ⚠️ Thầy/Cô chưa có lớp học nào. Vui lòng tạo Lớp Học mới trong Bảng Quản Lý trước khi giao bài!
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 mb-1 flex items-center gap-1">
                <Award className="w-4 h-4 text-amber-500" /> Sao Thưởng Hoàn Thành (Stars):
              </label>
              <input
                type="number"
                min="5"
                max="100"
                value={rewardStars}
                onChange={(e) => setRewardStars(e.target.value)}
                className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 mb-1 flex items-center gap-1">
                <Calendar className="w-4 h-4 text-sky-500" /> Hạn Chót Hoàn Thành:
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 bg-slate-100 text-slate-600 font-bold text-sm rounded-xl hover:bg-slate-200"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={loading || classes.length === 0}
                className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-sm rounded-xl border-b-4 border-amber-700 shadow-md active:translate-y-0.5"
              >
                {loading ? 'Đang giao...' : '🚀 XÁC NHẬN GIAO BÀI'}
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
};
