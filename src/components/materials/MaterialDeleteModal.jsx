import React, { useState } from 'react';
import { AlertTriangle, Trash2, X, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { cleanupScormPackageStorage } from '../../services/scormLaunchService';

export const MaterialDeleteModal = ({ isOpen, onClose, material, DELETED_CALLBACK }) => {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [warningMsg, setWarningMsg] = useState('');

  if (!isOpen || !material) return null;

  const handleDelete = async () => {
    setLoading(true);
    setErrorMsg('');
    setWarningMsg('');

    try {
      // 1. Xóa bản ghi trong Database trước
      const { error: dbErr } = await supabase
        .from('learning_materials')
        .delete()
        .eq('id', material.id);

      if (dbErr) {
        throw new Error('Lỗi khi xóa dữ liệu bài giảng khỏi Database: ' + dbErr.message);
      }

      // 2. Nếu Database xóa thành công và có tệp đính kèm -> Xóa file tương ứng khỏi Storage
      let storageFailed = false;
      if (material.file_type === 'scorm') {
        try {
          // Lấy thông tin scorm package để xóa
          const { data: pkg } = await supabase
            .from('scorm_packages')
            .select('content_root, original_zip_path')
            .eq('material_id', material.id)
            .maybeSingle();

          if (pkg?.content_root) {
            await cleanupScormPackageStorage(pkg.content_root, pkg.original_zip_path || material.file_path);
          } else if (material.file_path) {
            await supabase.storage.from('learning-materials').remove([material.file_path]);
          }
        } catch (scormErr) {
          console.warn('Lỗi dọn dẹp storage scorm:', scormErr);
        }
      } else if (material.file_path) {
        const { error: storageErr } = await supabase.storage
          .from('learning-materials')
          .remove([material.file_path]);

        if (storageErr) {
          console.error('Lỗi khi xóa tệp tin trong Storage:', storageErr);
          storageFailed = true;
          setWarningMsg(`⚠️ Đã xóa bài giảng khỏi CSDL, nhưng tệp tin trên Storage không thể tự động dọn dẹp (Lỗi: ${storageErr.message}). Tệp rác này cần được dọn dẹp thủ công.`);
        }
      }

      // Nếu xóa Storage lỗi -> Không thông báo thành công hoàn toàn mà giữ hiển thị cảnh báo cho người dùng
      if (storageFailed) {
        DELETED_CALLBACK?.(); // Cập nhật lại danh sách ở giao diện
        setLoading(false);
        return;
      }

      DELETED_CALLBACK?.();
      onClose();

    } catch (err) {
      console.error('Delete material error:', err);
      setErrorMsg(err.message || 'Lỗi khi xóa bài giảng / tài liệu.');
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
          Bài giảng <span className="text-rose-700 font-extrabold">"{material.title}"</span> và tệp đính kèm sẽ bị xóa khỏi hệ thống.
        </p>

        {errorMsg && (
          <div className="mb-4 p-3 bg-rose-100 border border-rose-300 text-rose-800 text-xs font-bold rounded-xl text-center">
            ⚠️ {errorMsg}
          </div>
        )}

        {warningMsg && (
          <div className="mb-4 p-3 bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold rounded-xl text-left space-y-2">
            <div className="flex items-center gap-1.5 font-black text-amber-950">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" /> Cảnh Báo Xóa Storage
            </div>
            <p>{warningMsg}</p>
            <button
              onClick={onClose}
              className="w-full py-1.5 bg-amber-500 text-white font-black rounded-lg text-xs hover:bg-amber-600 mt-1"
            >
              Đã Nhận Thông Tin & Đóng
            </button>
          </div>
        )}

        {!warningMsg && (
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
        )}

      </div>
    </div>
  );
};
