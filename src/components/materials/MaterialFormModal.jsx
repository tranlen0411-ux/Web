import React, { useState, useEffect } from 'react';
import { 
  X, 
  UploadCloud, 
  Link as LinkIcon, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  BookOpen, 
  GraduationCap, 
  Lock,
  HardDrive,
  Loader2
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

export const MaterialFormModal = ({ isOpen, onClose, materialToEdit, classesList = [], onSaved }) => {
  const { profile } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('Toán');
  const [classId, setClassId] = useState('');
  const [fileType, setFileType] = useState('pdf');
  const [sourceType, setSourceType] = useState('file'); // 'file' | 'link'
  const [externalUrl, setExternalUrl] = useState('');
  const [allowDownload, setAllowDownload] = useState(true);

  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const subjects = [
    'Toán',
    'Tiếng Việt',
    'Tiếng Anh',
    'Tự nhiên & Xã hội',
    'Khoa học',
    'Lịch sử & Địa lý',
    'Tin học',
    'Đạo đức',
    'Âm nhạc',
    'Mỹ thuật',
    'Hoạt động trải nghiệm'
  ];

  // Danh sách các MIME type và Extension hợp lệ (Đã loại bỏ SVG để an toàn)
  const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'
  ];

  const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mov'];

  useEffect(() => {
    if (isOpen) {
      if (materialToEdit) {
        setTitle(materialToEdit.title || '');
        setDescription(materialToEdit.description || '');
        setSubject(materialToEdit.subject || 'Toán');
        setClassId(materialToEdit.class_id || '');
        setFileType(materialToEdit.file_type || 'pdf');
        setSourceType(materialToEdit.external_url ? 'link' : 'file');
        setExternalUrl(materialToEdit.external_url || '');
        setAllowDownload(materialToEdit.allow_download !== false);
        setFile(null);
      } else {
        setTitle('');
        setDescription('');
        setSubject('Toán');
        setClassId('');
        setFileType('pdf');
        setSourceType('file');
        setExternalUrl('');
        setAllowDownload(true);
        setFile(null);
      }
      setErrorMsg('');
    }
  }, [isOpen, materialToEdit]);

  if (!isOpen) return null;

  // Kiểm tra định dạng Extension và MIME Type của file
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setErrorMsg('');
    if (!selectedFile) return;

    // 1. Kiểm tra dung lượng (Tối đa 50MB)
    const MAX_SIZE = 50 * 1024 * 1024;
    if (selectedFile.size > MAX_SIZE) {
      setErrorMsg('Dung lượng tệp tin vượt quá 50MB. Vui lòng chọn tệp nhỏ hơn.');
      e.target.value = '';
      return;
    }

    // 2. Kiểm tra Extension (Bảo mật: Từ chối SVG)
    const ext = selectedFile.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setErrorMsg(`Định dạng tệp .${ext} không hợp lệ. Hệ thống chấp nhận PDF, Word, PowerPoint, Hình ảnh (PNG, JPG, GIF, WEBP) và Video (MP4, WEBM).`);
      e.target.value = '';
      return;
    }

    // 3. Kiểm tra MIME Type thực tế từ header của trình duyệt
    if (selectedFile.type && !ALLOWED_MIME_TYPES.includes(selectedFile.type)) {
      setErrorMsg(`Loại tệp tin (${selectedFile.type}) không phù hợp danh mục định dạng được phép.`);
      e.target.value = '';
      return;
    }

    // Tự động gán fileType tương ứng
    if (['pdf'].includes(ext)) {
      setFileType('pdf');
    } else if (['doc', 'docx'].includes(ext)) {
      setFileType('word');
    } else if (['ppt', 'pptx'].includes(ext)) {
      setFileType('powerpoint');
    } else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
      setFileType('image');
    } else if (['mp4', 'webm', 'mov'].includes(ext)) {
      setFileType('video');
    }

    setFile(selectedFile);
  };

  // Validation đường liên kết HTTPS bên ngoài
  const validateHttpsUrl = (urlStr) => {
    if (!urlStr) return false;
    try {
      const parsed = new URL(urlStr);
      return parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!title.trim()) {
      setErrorMsg('Vui lòng nhập tên bài giảng / tài liệu.');
      return;
    }

    if (sourceType === 'link') {
      if (!externalUrl.trim()) {
        setErrorMsg('Vui lòng nhập đường liên kết bài giảng bên ngoài.');
        return;
      }
      if (!validateHttpsUrl(externalUrl.trim())) {
        setErrorMsg('Đường liên kết bài giảng phải là địa chỉ HTTPS hợp lệ (bắt đầu bằng https://...).');
        return;
      }
    }

    if (sourceType === 'file' && !file && !materialToEdit?.file_path) {
      setErrorMsg('Vui lòng chọn tệp tài liệu để tải lên.');
      return;
    }

    setLoading(true);

    let newlyUploadedPath = null;
    const oldFilePath = materialToEdit?.file_path;

    try {
      let finalFilePath = oldFilePath || null;
      let finalFileName = materialToEdit?.file_name || null;
      let finalFileSize = materialToEdit?.file_size || 0;

      // 1. NẾU CÓ CHỌN FILE MỚI -> UPLOAD VÀO THƯ MỤC THUỘC SỞ HỮU {created_by}/{file}
      if (sourceType === 'file' && file) {
        const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const userFolder = profile.id;
        const storagePath = `${userFolder}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${cleanName}`;

        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('learning-materials')
          .upload(storagePath, file, {
            cacheControl: '3600',
            upsert: false
          });

        if (uploadErr) {
          console.error('Storage upload error:', uploadErr);
          throw new Error('Lỗi khi tải file lên Storage: ' + uploadErr.message);
        }

        newlyUploadedPath = storagePath;
        finalFilePath = storagePath;
        finalFileName = file.name;
        finalFileSize = file.size;
      }

      // 2. TẠO HOẶC CẬP NHẬT RECORD TRONG DATABASE
      const payload = {
        title: title.trim(),
        description: description.trim(),
        subject: subject,
        class_id: classId ? classId : null,
        file_name: sourceType === 'file' ? finalFileName : null,
        file_path: sourceType === 'file' ? finalFilePath : null,
        file_type: fileType,
        file_size: sourceType === 'file' ? finalFileSize : 0,
        external_url: sourceType === 'link' ? externalUrl.trim() : null,
        allow_download: allowDownload,
        updated_at: new Date().toISOString()
      };

      if (materialToEdit) {
        const { error: updateErr } = await supabase
          .from('learning_materials')
          .update(payload)
          .eq('id', materialToEdit.id);

        if (updateErr) {
          throw updateErr;
        }
      } else {
        payload.created_by = profile.id;
        const { error: insertErr } = await supabase
          .from('learning_materials')
          .insert([payload]);

        if (insertErr) {
          throw insertErr;
        }
      }

      // 3. DATABASE UPDATE/INSERT THÀNH CÔNG -> TIẾN HÀNH DỌN DẸP FILE CŨ NẾU CÓ THAY THẾ FILE
      if (oldFilePath && oldFilePath !== finalFilePath) {
        const { error: removeErr } = await supabase.storage
          .from('learning-materials')
          .remove([oldFilePath]);

        if (removeErr) {
          console.warn('Cảnh báo: Không thể xóa file cũ trên Storage:', removeErr.message);
        }
      }

      onSaved?.();
      onClose();

    } catch (err) {
      console.error('Save material error:', err);

      // ROLLBACK: Nếu Database thất bại và đã lỡ upload file mới -> Xóa file mới upload để tránh tạo rác
      if (newlyUploadedPath) {
        try {
          await supabase.storage.from('learning-materials').remove([newlyUploadedPath]);
        } catch (rbException) {
          console.error('Rollback exception:', rbException);
        }
      }

      setErrorMsg(err.message || 'Lỗi khi lưu thông tin tài liệu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-white rounded-3xl border-4 border-amber-300 p-6 sm:p-8 shadow-2xl max-h-[92vh] overflow-y-auto custom-scrollbar">
        
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-black text-amber-950 mb-1 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-amber-600" />
          {materialToEdit ? 'Sửa Thông Tin Bài Giảng / Tài Liệu' : 'Thêm Bài Giảng / Tài Liệu Mới'}
        </h3>
        <p className="text-xs font-bold text-slate-500 mb-5">
          Đăng bài giảng, tệp tài liệu hoặc liên kết trực tuyến HTTPS cho học sinh.
        </p>

        {errorMsg && (
          <div className="mb-4 p-3 bg-rose-100 border-2 border-rose-300 text-rose-800 text-xs font-bold rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* TÊN BÀI GIẢNG / TÀI LIỆU */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">
              Tên Bài Giảng / Tài Liệu <span className="text-rose-500">*</span>:
            </label>
            <input
              type="text"
              placeholder="Ví dụ: Bài giảng Toán Lớp 1 — Phép cộng trong phạm vi 10..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-3 bg-amber-50/80 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800 focus:outline-none focus:border-amber-400"
              required
            />
          </div>

          {/* MÔ TẢ NẮN */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">Mô tả ngắn / Hướng dẫn học sinh:</label>
            <textarea
              rows={3}
              placeholder="Nhập ghi chú hoặc dặn dò học sinh khi xem tài liệu..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-3 bg-amber-50/80 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* MÔ N HỌC & LỚP HỌC */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">
                Môn Học <span className="text-rose-500">*</span>:
              </label>
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full p-3 bg-amber-50/80 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800"
              >
                {subjects.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">Lớp Học Áp Dụng:</label>
              <select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                className="w-full p-3 bg-amber-50/80 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800"
              >
                <option value="">🌐 Dành cho Tất cả các lớp</option>
                {classesList.map(c => (
                  <option key={c.id} value={c.id}>
                    🏫 {c.name} (Khối {c.grade_level})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* LOẠI TÀI LIỆU & NGUỒN TẢI UP */}
          <div className="p-4 bg-amber-100/50 rounded-2xl border-2 border-amber-200 space-y-3">
            <label className="block text-xs font-black text-amber-950 uppercase">Nguồn tài liệu bài giảng:</label>
            
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs font-black text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="sourceType"
                  value="file"
                  checked={sourceType === 'file'}
                  onChange={() => setSourceType('file')}
                  className="w-4 h-4 text-amber-600"
                />
                <UploadCloud className="w-4 h-4 text-amber-600" /> Tải tệp từ máy tính
              </label>

              <label className="flex items-center gap-2 text-xs font-black text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="sourceType"
                  value="link"
                  checked={sourceType === 'link'}
                  onChange={() => { setSourceType('link'); setFileType('link'); }}
                  className="w-4 h-4 text-sky-600"
                />
                <LinkIcon className="w-4 h-4 text-sky-600" /> Đường liên kết bài giảng (HTTPS)
              </label>
            </div>

            {sourceType === 'file' ? (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">Loại Tệp Tin:</label>
                  <select
                    value={fileType}
                    onChange={(e) => setFileType(e.target.value)}
                    className="w-full p-2.5 bg-white border-2 border-amber-200 rounded-xl font-bold text-xs"
                  >
                    <option value="pdf">📄 PDF (Tài liệu bài giảng)</option>
                    <option value="word">📝 Word (.doc, .docx)</option>
                    <option value="powerpoint">📊 PowerPoint (.ppt, .pptx)</option>
                    <option value="image">🖼️ Hình Ảnh (PNG, JPG...)</option>
                    <option value="video">🎥 Video (MP4...)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">Chọn Tệp Tin Tải Lên (Tối đa 50MB, không hỗ trợ SVG):</label>
                  <input
                    type="file"
                    onChange={handleFileChange}
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mov"
                    className="w-full text-xs font-bold text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-amber-400 file:text-amber-950 hover:file:bg-amber-500 cursor-pointer"
                  />
                  {materialToEdit?.file_name && !file && (
                    <p className="text-[11px] font-extrabold text-emerald-700 mt-1">
                      📄 File hiện tại: {materialToEdit.file_name} (Chọn file mới nếu muốn thay thế)
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="pt-2">
                <label className="block text-xs font-black text-slate-700 mb-1">Đường Liên Kết Bài Giảng (Bắt buộc địa chỉ HTTPS):</label>
                <input
                  type="url"
                  placeholder="https://youtube.com/watch?... hoặc https://drive.google.com/..."
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                  className="w-full p-3 bg-white border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800"
                />
              </div>
            )}
          </div>

          {/* QUYỀN TẢI VỀ CỦA HỌC SINH */}
          <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-700" />
              <div>
                <p className="text-xs font-black text-amber-950">Cho phép học sinh tải tài liệu về máy:</p>
                <p className="text-[10px] font-bold text-slate-500">Nếu tắt, hệ thống sẽ ẩn nút tải và không phát hành Signed URL tải về.</p>
              </div>
            </div>

            <input
              type="checkbox"
              checked={allowDownload}
              onChange={(e) => setAllowDownload(e.target.checked)}
              className="w-5 h-5 text-amber-600 rounded cursor-pointer"
            />
          </div>

          {/* TRẠNG THÁI TẢI LÊN */}
          {loading && (
            <div className="p-3 bg-amber-100 rounded-2xl border border-amber-300 flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-amber-700 animate-spin shrink-0" />
              <p className="text-xs font-bold text-amber-950">
                Đang xử lý định dạng tệp tin & lưu bài giảng vào hệ thống... Vui lòng chờ trong giây lát.
              </p>
            </div>
          )}

          {/* FOOTER NÚT LƯU */}
          <div className="pt-3 flex justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-xl"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs sm:text-sm rounded-xl border-b-4 border-amber-700 shadow-md active:translate-y-0.5 flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Đang Tải Lên...
                </>
              ) : materialToEdit ? (
                '💾 CẬP NHẬT TÀI LIỆU'
              ) : (
                '🚀 ĐĂNG BÀI GIẢNG / TÀI LIỆU'
              )}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
