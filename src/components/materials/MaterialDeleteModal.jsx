import React, { useState } from 'react';
import { AlertTriangle, Trash2, X, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export const MaterialDeleteModal = ({ isOpen, onClose, material, DELETED_CALLBACK }) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen || !material) return null;

  const handleDelete = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      // 1. Xóa bản ghi trong Database trước
      const { error: dbErr } = await supabase
        .from('learning_materials')
        .delete()
        .eq('id', material.id);

      if (dbErr) {
        throw new Error('Lỗi khi xóa bản ghi tài liệu trong cơ sở dữ liệu: ' + dbErr.message);
      }

      // 2. Nếu Database xóa thành công và có file_path -> Xóa file tương ứng khỏi Storage
      if (material.file_path) {
        const { error: storageErr } = await supabase.storage
          .from('learning-materials')
          .remove([material.file_path]);

        if (storageErr) {
          console.error('Lỗi khi xóa tệp tin trong Storage:', storageErr);
          // Ghi nhận log nhưng đã xóa DB thành công
        }
      }

      DELETED_CALLBACK?.();
      onClose();
    } catch (err) {
      console.error('Delete material error:', err);
      setErrorMsg(err.message || 'Lỗi khi xóa bài giảng / tài liệu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-md bg-white rounded-3xl border-4 border-rose-300 p-6 shadow-2xl">
        
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-14 h-14 bg-rose-100 rounded-2xl border-4 border-rose-300 flex items-center justify-center text-rose-600 mb-3 mx-auto">
          <AlertTriangle className="w-8 h-8" />
        </div>

        <h3 className="text-lg font-black text-slate-800 text-center mb-1">
          Xác Nhận Xóa Bài Giảng / Tài Liệu?
        </h3>
        <p className="text-xs font-bold text-slate-500 text-center mb-4">
          Bài giảng <span className="text-rose-700 font-extrabold">"{material.title}"</span> và tệp đính kèm sẽ bị xóa hoàn toàn khỏi hệ thống.
        </p>

        {errorMsg && (
          <div className="mb-4 p-3 bg-rose-100 border border-rose-300 text-rose-800 text-xs font-bold rounded-xl text-center">
            ⚠️ {errorMsg}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-slate-100 text-slate-600 font-bold text-xs rounded-xl hover:bg-slate-200"
          >
            Hủy
          </button>

          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-xl shadow-md flex items-center gap-1.5"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Xác Nhận Xóa
          </button>
        </div>

      </div>
    </div>
  );
};
