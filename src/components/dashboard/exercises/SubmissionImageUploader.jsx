import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Image as ImageIcon, X, Loader2, CheckCircle2, AlertCircle, Eye 
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { 
  prepareSubmissionAttachment, 
  finalizeSubmissionAttachment 
} from '../../../services/submissionAnnotationClient';
import {
  validateImageFile,
  optimizeImageBeforeUpload,
  MAX_ALLOWED_IMAGE_BYTES
} from '../../../utils/imageOptimizer';

/**
 * Giới hạn tối đa số lượng ảnh trên mỗi câu hỏi (Hardened Cap)
 */
export const MAX_IMAGES_PER_QUESTION = 10;

/**
 * Format bytes to readable string (e.g. 1.2 MB, 450 KB)
 */
function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Helper to read image dimensions on browser client
 */
function getImageDimensions(file) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        const dims = { 
          width: img.naturalWidth || null, 
          height: img.naturalHeight || null 
        };
        URL.revokeObjectURL(objectUrl);
        resolve(dims);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ width: null, height: null });
      };
      img.src = objectUrl;
    } catch {
      resolve({ width: null, height: null });
    }
  });
}

/**
 * Component SubmissionImageUploader
 * Phase 1 Multi-Image Uploader tuân thủ kiến trúc bảo mật 3 bước:
 * 1. prepareSubmissionAttachment -> nhận attachment_id, storage_path chuẩn
 * 2. Upload nhị phân lên Supabase Storage với upsert: false
 * 3. finalizeSubmissionAttachment -> xác thực metadata trên backend
 *
 * Failure Policy:
 * - Khi xảy ra lỗi ở bất kỳ bước nào, hiển thị thông báo lỗi rõ ràng trên UI.
 * - Không retry tự động vô hạn; không tự động tạo thêm attachment pending mới.
 * - Không coi item lỗi là ready/finalized.
 * - Không tự ý gọi raw DELETE trên CSDL (tuân thủ RLS).
 */
export const SubmissionImageUploader = ({
  submissionId,
  questionId,
  studentId,
  attachments = [],
  onAttachmentsChange,
  disabled = false
}) => {
  const [activeUploads, setActiveUploads] = useState([]);
  const [globalError, setGlobalError] = useState('');
  const fileInputRef = useRef(null);

  const validateFile = (file) => {
    return validateImageFile(file);
  };

  // Cleanup preview URLs on component unmount
  useEffect(() => {
    return () => {
      activeUploads.forEach(u => {
        if (u.previewUrl) {
          try { URL.revokeObjectURL(u.previewUrl); } catch {}
        }
      });
    };
  }, []);

  const uploadSingleFile = async (rawFile, tempId, sortOrder) => {
    let file = rawFile;
    try {
      // Tự động tối ưu/nén ảnh phía client nếu cần thiết
      file = await optimizeImageBeforeUpload(rawFile);
    } catch (optErr) {
      console.warn('Tối ưu hóa ảnh không thành công, sử dụng file gốc:', optErr);
      file = rawFile;
    }

    const objectUrl = URL.createObjectURL(file);

    try {
      // BƯỚC 1: PREPARE ATTACHMENT
      setActiveUploads(prev => prev.map(u => 
        u.tempId === tempId ? { ...u, status: 'preparing', byteSize: file.size } : u
      ));

      const prepRes = await prepareSubmissionAttachment({
        submissionId,
        questionId,
        originalFileName: file.name || rawFile.name,
        mimeType: file.type,
        byteSize: file.size,
        sortOrder
      });

      if (!prepRes.ok || !prepRes.data?.attachment_id) {
        throw new Error(prepRes.error?.message || prepRes.data?.message || 'Lỗi khởi tạo tệp đính kèm.');
      }

      const { attachment_id, storage_path } = prepRes.data;

      // BƯỚC 2: UPLOAD BINARY LÊN STORAGE (NEW STANDARDIZED PATH)
      setActiveUploads(prev => prev.map(u => 
        u.tempId === tempId ? { ...u, status: 'uploading', attachmentId: attachment_id, storagePath: storage_path } : u
      ));

      const { error: storageErr } = await supabase.storage
        .from('exercise-submissions')
        .upload(storage_path, file, { upsert: false });

      if (storageErr) {
        throw new Error(storageErr.message || 'Lỗi tải tệp lên máy chủ lưu trữ.');
      }

      // BƯỚC 3: ĐỌC KÍCH THƯỚC ẢNH & FINALIZE ATTACHMENT
      setActiveUploads(prev => prev.map(u => 
        u.tempId === tempId ? { ...u, status: 'finalizing' } : u
      ));

      const { width, height } = await getImageDimensions(file);

      const finRes = await finalizeSubmissionAttachment({
        attachmentId: attachment_id,
        width,
        height
      });

      if (!finRes.ok || !finRes.data?.success) {
        throw new Error(finRes.error?.message || finRes.data?.message || 'Lỗi xác thực tệp đính kèm.');
      }

      // BƯỚC 4: TẠO SIGNED URL XEM TRƯỚC
      const { data: signData } = await supabase.storage
        .from('exercise-submissions')
        .createSignedUrl(storage_path, 900);

      const signedUrl = signData?.signedUrl || objectUrl;

      const finalizedItem = {
        id: attachment_id,
        submission_id: submissionId,
        question_id: questionId,
        storage_path,
        signedUrl,
        original_file_name: file.name,
        mime_type: file.type,
        byte_size: file.size,
        width,
        height,
        sort_order: sortOrder,
        status: 'ready',
        upload_status: 'finalized'
      };

      // Xóa khỏi activeUploads, thu hồi previewUrl và đẩy vào danh sách attachments chính thức
      setActiveUploads(prev => {
        const item = prev.find(u => u.tempId === tempId);
        if (item?.previewUrl && item.previewUrl !== signedUrl) {
          try { URL.revokeObjectURL(item.previewUrl); } catch {}
        }
        return prev.filter(u => u.tempId !== tempId);
      });

      if (onAttachmentsChange) {
        onAttachmentsChange(currentList => {
          const base = Array.isArray(currentList) ? currentList : [];
          // Tránh duplicate nếu đã có
          if (base.some(a => a.id === attachment_id)) return base;
          return [...base, finalizedItem];
        });
      }

    } catch (err) {
      console.error('Upload single image failed:', err);
      setActiveUploads(prev => prev.map(u => 
        u.tempId === tempId ? { 
          ...u, 
          status: 'error', 
          errorMsg: err.message || 'Tải ảnh thất bại' 
        } : u
      ));
    }
  };

  const handleFileSelect = async (e) => {
    setGlobalError('');
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    if (!submissionId) {
      setGlobalError('Chưa có mã bài làm hợp lệ. Vui lòng tải lại trang.');
      return;
    }

    // KIỂM SOÁT GIỚI HẠN TỐI ĐA 10 ẢNH / CÂU HỎI (CAP ENFORCED BEFORE PREPARE)
    const finalizedCount = (attachments || []).filter(
      a => a.status === 'ready' || a.upload_status === 'finalized'
    ).length;
    const pendingCount = activeUploads.length;
    const currentCount = finalizedCount + pendingCount;

    if (currentCount >= MAX_IMAGES_PER_QUESTION) {
      setGlobalError(`Tối đa ${MAX_IMAGES_PER_QUESTION} ảnh cho mỗi câu hỏi.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const availableSlots = MAX_IMAGES_PER_QUESTION - currentCount;
    let filesToProcess = files;

    if (files.length > availableSlots) {
      setGlobalError(`Chỉ có thể tải thêm tối đa ${availableSlots} ảnh (Giới hạn ${MAX_IMAGES_PER_QUESTION} ảnh/câu hỏi).`);
      filesToProcess = files.slice(0, availableSlots);
    }

    const newUploadQueue = [];
    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];
      const validationError = validateFile(file);
      const tempId = `temp_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 7)}`;
      const objectUrl = URL.createObjectURL(file);

      if (validationError) {
        newUploadQueue.push({
          tempId,
          file,
          originalFileName: file.name,
          byteSize: file.size,
          previewUrl: objectUrl,
          status: 'error',
          errorMsg: validationError
        });
      } else {
        newUploadQueue.push({
          tempId,
          file,
          originalFileName: file.name,
          byteSize: file.size,
          previewUrl: objectUrl,
          status: 'preparing',
          errorMsg: null,
          sortOrder: currentCount + i
        });
      }
    }

    setActiveUploads(prev => [...prev, ...newUploadQueue]);

    // Reset input value để user có thể chọn lại cùng file nếu muốn
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // Tiến hành upload các file hợp lệ
    for (const item of newUploadQueue) {
      if (item.status !== 'error') {
        uploadSingleFile(item.file, item.tempId, item.sortOrder);
      }
    }
  };

  const handleRemoveFailedUpload = (tempId) => {
    setActiveUploads(prev => {
      const item = prev.find(u => u.tempId === tempId);
      if (item?.previewUrl) {
        try { URL.revokeObjectURL(item.previewUrl); } catch {}
      }
      return prev.filter(u => u.tempId !== tempId);
    });
  };

  return (
    <div className="space-y-4">
      {/* KHU VỰC CHỌN NHIỀU ẢNH (CHỈ KHI CHƯA DISABLED) */}
      {!disabled && (
        <div>
          <label className="flex flex-col items-center justify-center p-5 bg-white border-2 border-dashed border-amber-300 rounded-2xl cursor-pointer hover:bg-amber-50/70 transition-all group shadow-sm">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 mb-2 group-hover:scale-110 transition-transform">
              <Upload className="w-6 h-6" />
            </div>
            <span className="text-xs font-black text-amber-950">
              Nhấp để chọn một hoặc nhiều ảnh bài làm
            </span>
            <span className="text-[11px] font-bold text-slate-500 mt-0.5">
              Hỗ trợ định dạng JPG, PNG, WEBP (Tối đa 10MB mỗi ảnh, tối đa {MAX_IMAGES_PER_QUESTION} ảnh/câu hỏi)
            </span>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              disabled={disabled}
              className="hidden"
              onChange={handleFileSelect}
            />
          </label>
        </div>
      )}

      {globalError && (
        <div className="p-3 bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-xs font-bold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{globalError}</span>
        </div>
      )}

      {/* DANH SÁCH HÌNH ẢNH ĐÃ TẢI LÊN & ĐANG XỬ LÝ (GALLERY THUMBNAILS) */}
      {((attachments && attachments.length > 0) || activeUploads.length > 0) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4 text-amber-600" /> 
              Ảnh bài làm đã đính kèm ({attachments.length + activeUploads.length}/{MAX_IMAGES_PER_QUESTION})
            </span>
            <span className="text-[10px] font-bold text-slate-400">
              {disabled ? 'Chế độ xem lịch sử' : 'Ảnh đã được bảo toàn'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {/* 1. HIỂN THỊ CÁC ATTACHMENTS ĐÃ FINALIZED (READY) */}
            {attachments.map((att, idx) => (
              <div 
                key={att.id || `att_${idx}`} 
                className="bg-white p-3 rounded-2xl border-2 border-amber-200 shadow-sm flex flex-col justify-between space-y-2 relative overflow-hidden group"
              >
                <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">
                  {att.signedUrl ? (
                    <img 
                      src={att.signedUrl} 
                      alt={att.original_file_name || `Ảnh ${idx + 1}`}
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-slate-400" />
                  )}
                  <span className="absolute top-2 left-2 px-2 py-0.5 bg-slate-900/70 backdrop-blur-sm text-white text-[10px] font-black rounded-lg">
                    Trang {idx + 1}
                  </span>
                </div>

                <div className="min-w-0">
                  <p className="text-xs font-black text-slate-800 truncate" title={att.original_file_name}>
                    {att.original_file_name || `Ảnh ${idx + 1}`}
                  </p>
                  <p className="text-[10px] font-bold text-slate-400">
                    {formatFileSize(att.byte_size)}
                    {att.width && att.height ? ` • ${att.width}x${att.height}px` : ''}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                  <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Sẵn sàng
                  </span>

                  {att.signedUrl && (
                    <a
                      href={att.signedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 font-black text-[10px] rounded-lg transition-colors flex items-center gap-1 border border-amber-200"
                    >
                      <Eye className="w-3 h-3 text-amber-600" /> Xem ảnh
                    </a>
                  )}
                </div>
              </div>
            ))}

            {/* 2. HIỂN THỊ CÁC TIẾN TRÌNH ĐANG UPLOAD / LỖI (ACTIVE UPLOADS) */}
            {activeUploads.map((item) => (
              <div 
                key={item.tempId} 
                className={`bg-white p-3 rounded-2xl border-2 shadow-sm flex flex-col justify-between space-y-2 relative overflow-hidden ${
                  item.status === 'error' ? 'border-rose-300 bg-rose-50/20' : 'border-amber-300 animate-pulse'
                }`}
              >
                <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">
                  {item.previewUrl ? (
                    <img 
                      src={item.previewUrl} 
                      alt={item.originalFileName}
                      className="w-full h-full object-cover opacity-70"
                    />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-slate-400" />
                  )}

                  <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] flex flex-col items-center justify-center p-2 text-center">
                    {item.status === 'preparing' && (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin text-amber-300 mb-1" />
                        <span className="text-[10px] font-black text-white">Đang khởi tạo...</span>
                      </>
                    )}
                    {item.status === 'uploading' && (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin text-sky-300 mb-1" />
                        <span className="text-[10px] font-black text-white">Đang tải ảnh lên...</span>
                      </>
                    )}
                    {item.status === 'finalizing' && (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin text-emerald-300 mb-1" />
                        <span className="text-[10px] font-black text-white">Đang xác thực...</span>
                      </>
                    )}
                    {item.status === 'error' && (
                      <>
                        <AlertCircle className="w-6 h-6 text-rose-400 mb-1" />
                        <span className="text-[10px] font-black text-rose-200">{item.errorMsg}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="min-w-0">
                  <p className="text-xs font-black text-slate-800 truncate" title={item.originalFileName}>
                    {item.originalFileName}
                  </p>
                  <p className="text-[10px] font-bold text-slate-400">
                    {formatFileSize(item.byteSize)}
                  </p>
                </div>

                {item.status === 'error' && (
                  <div className="pt-1 border-t border-rose-100 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleRemoveFailedUpload(item.tempId)}
                      className="px-2 py-1 bg-rose-100 hover:bg-rose-200 text-rose-800 font-black text-[10px] rounded-lg transition-colors flex items-center gap-1"
                    >
                      <X className="w-3 h-3" /> Bỏ qua
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
