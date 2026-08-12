import React, { useState } from 'react';
import { X, Plus, GraduationCap, Copy, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

export const ClassManageModal = ({ isOpen, onClose, onCreated }) => {
  const { user } = useAuth();
  const [className, setClassName] = useState('');
  const [gradeLevel, setGradeLevel] = useState(1);
  const [loading, setLoading] = useState(false);
  const [createdCode, setCreatedCode] = useState('');

  const generateClassCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'LOP';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const handleCreateClass = async (e) => {
    e.preventDefault();
    if (!className || !user?.id) return;

    setLoading(true);
    const code = generateClassCode();
    try {
      const { data, error } = await supabase.from('classes').insert({
        name: className,
        grade_level: parseInt(gradeLevel),
        code,
        teacher_id: user.id
      }).select().single();

      if (error) throw error;

      setCreatedCode(code);
      if (onCreated) onCreated(data);
    } catch (err) {
      console.error('Create class error:', err);
      alert('Không thể tạo lớp: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-md bg-white rounded-3xl border-4 border-amber-300 p-6 shadow-2xl">
        
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-black text-amber-900 mb-1 flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-amber-600" /> Tạo Lớp Học Mới
        </h3>
        <p className="text-xs font-bold text-slate-500 mb-4">
          Tạo lớp để quản lý danh sách học sinh và giao bài tập trò chơi.
        </p>

        {createdCode ? (
          <div className="bg-amber-50 p-4 rounded-2xl border-2 border-amber-300 text-center space-y-3">
            <p className="text-sm font-bold text-amber-900">Mã Gia Nhập Lớp Học Của Thầy/Cô:</p>
            <div className="text-3xl font-black text-sky-600 tracking-widest bg-white py-2 px-4 rounded-xl border-2 border-sky-300 inline-block shadow-sm">
              {createdCode}
            </div>
            <p className="text-xs text-slate-500 font-semibold">
              Hãy gửi Mã Lớp này cho Học sinh để các bé bấm "Gia nhập Lớp Học" trên giao diện Học Sinh nhé!
            </p>
            <button
              onClick={() => {
                setCreatedCode('');
                onClose();
              }}
              className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm rounded-xl"
            >
              Hoàn Tất
            </button>
          </div>
        ) : (
          <form onSubmit={handleCreateClass} className="space-y-4">
            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">
                Tên Lớp Học:
              </label>
              <input
                type="text"
                placeholder="Ví dụ: Lớp 1A - Chăm Chỉ"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">
                Khối Lớp:
              </label>
              <select
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800"
              >
                <option value="1">Khối Lớp 1</option>
                <option value="2">Khối Lớp 2</option>
                <option value="3">Khối Lớp 3</option>
                <option value="4">Khối Lớp 4</option>
                <option value="5">Khối Lớp 5</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-sky-500 hover:bg-sky-600 text-white font-black text-sm rounded-2xl border-b-4 border-sky-700 shadow-md flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" /> {loading ? 'Đang Tạo...' : 'TẠO LỚP HỌC NGAY'}
            </button>
          </form>
        )}

      </div>
    </div>
  );
};
