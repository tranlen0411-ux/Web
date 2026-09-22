import React, { useState, useEffect } from 'react';
import { X, Plus, GraduationCap, Copy, Check, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useSound } from '../../context/SoundContext';

export const ClassManageModal = ({ isOpen, onClose, onCreated }) => {
  const { triggerSound } = useSound();
  const [className, setClassName] = useState('');
  const [gradeLevel, setGradeLevel] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [createdClass, setCreatedClass] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setClassName('');
      setGradeLevel(1);
      setLoading(false);
      setErrorMessage('');
      setCreatedClass(null);
      setCopiedCode(false);
    }
  }, [isOpen]);

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
    const trimmedName = (className || '').trim();
    if (!trimmedName) {
      setErrorMessage('Vui lòng nhập Tên Lớp Học.');
      return;
    }

    const parsedGrade = parseInt(gradeLevel, 10);
    if (isNaN(parsedGrade) || parsedGrade < 1 || parsedGrade > 5) {
      setErrorMessage('Khối lớp phải từ 1 đến 5.');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    const code = generateClassCode();

    try {
      // Create new class with teacher_id explicitly set to null
      const { data, error } = await supabase
        .from('classes')
        .insert({
          name: trimmedName,
          grade_level: parsedGrade,
          code,
          teacher_id: null
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new Error(`Mã lớp (${code}) bị trùng lặp. Vui lòng bấm tạo lại để sinh mã mới.`);
        }
        throw error;
      }

      triggerSound('victory');
      setCreatedClass(data);
      if (onCreated) {
        onCreated(data);
      }
    } catch (err) {
      triggerSound('error');
      console.error('Create class error:', err);
      setErrorMessage(err.message || 'Không thể tạo lớp học. Vui lòng thử lại sau.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (!createdClass?.code) return;
    navigator.clipboard.writeText(createdClass.code);
    setCopiedCode(true);
    triggerSound('click');
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleFinish = () => {
    triggerSound('click');
    setCreatedClass(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-md bg-white rounded-3xl border-4 border-amber-300 p-6 shadow-2xl overflow-hidden">
        
        <button
          onClick={() => {
            if (loading) return;
            triggerSound('click');
            onClose();
          }}
          disabled={loading}
          className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500 transition-colors disabled:opacity-50"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-black text-amber-900 mb-1 flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-amber-600" /> Tạo Lớp Học Mới
        </h3>
        <p className="text-xs font-bold text-slate-500 mb-4">
          Tạo lớp học mới trong hệ thống. Lớp sẽ ở trạng thái chờ phân công giáo viên.
        </p>

        {errorMessage && (
          <div className="mb-4 p-3.5 rounded-2xl bg-rose-50 border-2 border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2.5 animate-fadeIn">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
        )}

        {createdClass ? (
          <div className="bg-amber-50 p-5 rounded-2xl border-2 border-amber-300 text-center space-y-4 animate-fadeIn">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 className="w-7 h-7" />
            </div>

            <div className="space-y-1">
              <p className="text-sm font-black text-emerald-900">
                Tạo lớp học thành công!
              </p>
              <p className="text-xs font-semibold text-slate-600">
                Bạn có thể phân công giáo viên cho lớp này bất kỳ lúc nào.
              </p>
            </div>

            <div className="bg-white p-3.5 rounded-2xl border-2 border-amber-200 text-left space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 font-bold">Tên Lớp:</span>
                <span className="font-black text-slate-800">{createdClass.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-bold">Khối:</span>
                <span className="font-bold text-slate-700">Khối {createdClass.grade_level}</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <span className="text-slate-500 font-bold">Mã Lớp Học:</span>
                <div className="flex items-center gap-2">
                  <span className="font-black text-sky-600 tracking-wider bg-sky-50 px-2.5 py-1 rounded-lg border border-sky-200">
                    {createdClass.code}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors cursor-pointer"
                    title="Sao chép mã lớp"
                  >
                    {copiedCode ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleFinish}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm rounded-2xl border-b-4 border-emerald-700 shadow-md transition-all active:translate-y-0.5 cursor-pointer"
            >
              Hoàn Tất
            </button>
          </div>
        ) : (
          <form onSubmit={handleCreateClass} className="space-y-4">
            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">
                Tên Lớp Học <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Ví dụ: Lớp 1A, Lớp 2A, Lớp 3B..."
                value={className}
                onChange={(e) => {
                  setClassName(e.target.value);
                  setErrorMessage('');
                }}
                disabled={loading}
                className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800 focus:bg-white focus:border-amber-500 outline-none transition-colors disabled:opacity-50"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">
                Khối Lớp <span className="text-rose-500">*</span>
              </label>
              <select
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                disabled={loading}
                className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800 focus:bg-white focus:border-amber-500 outline-none transition-colors disabled:opacity-50"
              >
                <option value="1">Khối Lớp 1</option>
                <option value="2">Khối Lớp 2</option>
                <option value="3">Khối Lớp 3</option>
                <option value="4">Khối Lớp 4</option>
                <option value="5">Khối Lớp 5</option>
              </select>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading || !className.trim()}
                className="w-full py-3 bg-sky-500 hover:bg-sky-600 text-white font-black text-sm rounded-2xl border-b-4 border-sky-700 shadow-md flex items-center justify-center gap-2 transition-all active:translate-y-0.5 cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Đang Tạo Lớp...
                  </>
                ) : (
                  <>
                    <Plus className="w-5 h-5" /> TẠO LỚP HỌC NGAY
                  </>
                )}
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
};
