import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Video,
  FileCode,
  Calendar,
  User,
  BookOpen,
  HardDrive,
  Lock,
  Maximize2,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatClassLabel } from '../../utils/helpers';

export const MaterialViewerModal = ({ isOpen, onClose, material }) => {
  const [signedUrl, setSignedUrl] = useState(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [urlError, setUrlError] = useState('');

  useEffect(() => {
    if (isOpen && material) {
      if (material.file_path) {
        generateSignedUrl(material.file_path);
      } else if (material.external_url) {
        setSignedUrl(material.external_url);
        setLoadingUrl(false);
      } else {
        setSignedUrl(null);
        setLoadingUrl(false);
      }
    } else {
      setSignedUrl(null);
      setUrlError('');
    }
  }, [isOpen, material]);

  // Tạo Signed URL có thời hạn ngắn (300 giây) từ Supabase Storage Private Bucket để xem trực tiếp
  const generateSignedUrl = async (filePath) => {
    setLoadingUrl(true);
    setUrlError('');
    try {
      const { data, error } = await supabase.storage
        .from('learning-materials')
        .createSignedUrl(filePath, 300);

      if (error) {
        console.error('Error generating signed URL:', error);
        setUrlError('Không thể khởi tạo đường dẫn xem tài liệu an toàn: ' + error.message);
        setSignedUrl(null);
      } else {
        setSignedUrl(data?.signedUrl || null);
      }
    } catch (err) {
      console.error('Signed URL exception:', err);
      setUrlError('Lỗi khi tải đường dẫn xem tài liệu.');
    } finally {
      setLoadingUrl(false);
    }
  };

  if (!isOpen || !material) return null;

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isDownloadAllowed = material.allow_download !== false;

  const renderViewerContent = () => {
    if (loadingUrl) {
      return (
        <div className="flex flex-col items-center justify-center p-12 bg-amber-50/50 rounded-2xl border-2 border-amber-200 min-h-[300px]">
          <Loader2 className="w-8 h-8 text-amber-600 animate-spin mb-2" />
          <p className="text-xs font-bold text-amber-900">Đang khởi tạo đường dẫn xem tài liệu tạm thời (Signed URL)...</p>
        </div>
      );
    }

    if (urlError) {
      return (
        <div className="p-6 bg-rose-50 border-2 border-rose-200 rounded-2xl text-center space-y-2">
          <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
          <p className="text-xs font-black text-rose-900">{urlError}</p>
        </div>
      );
    }

    const type = material.file_type?.toLowerCase();

    // 1. XEM FILE HÌNH ẢNH
    if (type === 'image' && signedUrl) {
      return (
        <div className="flex flex-col items-center justify-center p-2 bg-slate-900/90 rounded-2xl overflow-hidden min-h-[350px]">
          <img
            src={signedUrl}
            alt={material.title}
            className="max-h-[60vh] max-w-full object-contain rounded-xl shadow-lg"
          />
        </div>
      );
    }

    // 2. XEM FILE VIDEO
    if (type === 'video' && signedUrl) {
      return (
        <div className="flex flex-col items-center justify-center bg-black rounded-2xl overflow-hidden min-h-[350px]">
          <video
            src={signedUrl}
            controls
            controlsList={!isDownloadAllowed ? "nodownload" : undefined}
            autoPlay={false}
            className="w-full max-h-[60vh] rounded-xl"
          >
            Trình duyệt của bạn không hỗ trợ xem video trực tiếp.
          </video>
        </div>
      );
    }

    // 3. XEM FILE PDF TRỰC TIẾP
    if (type === 'pdf' && signedUrl) {
      return (
        <div className="w-full h-[60vh] bg-slate-100 rounded-2xl overflow-hidden border-2 border-slate-200 relative">
          <iframe
            src={`${signedUrl}#toolbar=${isDownloadAllowed ? 1 : 0}`}
            title={material.title}
            className="w-full h-full rounded-2xl"
          />
        </div>
      );
    }

    // 4. WORD, POWERPOINT, LINK HOẶC FILE KHÁC
    return (
      <div className="p-8 bg-amber-50/80 border-2 border-amber-200 rounded-3xl text-center flex flex-col items-center justify-center min-h-[260px]">
        <div className="w-20 h-20 bg-amber-100 rounded-3xl border-4 border-amber-300 flex items-center justify-center mb-4 text-amber-800 shadow-md">
          {type === 'word' && <FileText className="w-10 h-10 text-blue-600" />}
          {type === 'powerpoint' && <FileCode className="w-10 h-10 text-orange-600" />}
          {type === 'link' && <ExternalLink className="w-10 h-10 text-cyan-600" />}
          {!['word', 'powerpoint', 'link'].includes(type) && <BookOpen className="w-10 h-10 text-amber-700" />}
        </div>

        <h4 className="text-lg font-black text-amber-950 mb-1">{material.title}</h4>
        <p className="text-xs font-bold text-slate-500 mb-6 max-w-md">
          {type === 'link'
            ? 'Đường liên kết bài giảng trực tuyến bên ngoài.'
            : `Tài liệu dạng tệp ${type?.toUpperCase()}. Bấm nút bên dưới để xem tệp.`}
        </p>

        {/* Nút xem đường dẫn bên ngoài hoặc mở tab mới chỉ khi được phép */}
        {signedUrl && (isDownloadAllowed || type === 'link') && (
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white font-black text-xs sm:text-sm rounded-2xl border-b-4 border-indigo-800 shadow-md flex items-center gap-2 active:translate-y-0.5 transition-all"
          >
            <ExternalLink className="w-4 h-4" />
            {type === 'link' ? 'Mở Đường Liên Kết Bài Giảng ↗' : 'Mở Xem Tài Liệu Trong Tab Mới ↗'}
          </a>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/70 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-4xl bg-white rounded-3xl border-4 border-amber-300 p-5 sm:p-7 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">

        {/* HEADER MODAL */}
        <div className="flex items-center justify-between border-b-2 border-amber-100 pb-4 mb-4">
          <div className="pr-8">
            <span className="px-3 py-1 bg-amber-100 text-amber-900 text-[11px] font-black rounded-xl border border-amber-300 uppercase inline-block mb-1">
              📖 {material.subject} {material.className ? `• ${formatClassLabel(material.className)}` : ''}
            </span>
            <h3 className="text-lg sm:text-xl font-black text-amber-950 line-clamp-1">
              {material.title}
            </h3>
          </div>

          <button
            onClick={onClose}
            className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-500 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* NỘI DUNG XEM CHÍNH */}
        <div className="flex-1 overflow-y-auto mb-4 custom-scrollbar">
          {renderViewerContent()}

          {/* MÔ TẢ & THÔNG TIN CHI TIẾT */}
          <div className="mt-4 p-4 bg-amber-50/60 border-2 border-amber-200 rounded-2xl space-y-3">
            <div>
              <p className="text-xs font-black text-amber-950 uppercase mb-1">Mô tả bài giảng / tài liệu:</p>
              <p className="text-xs font-bold text-slate-600 leading-relaxed">
                {material.description || 'Chưa có mô tả chi tiết cho bài giảng này.'}
              </p>
            </div>

            <div className="pt-2 border-t border-amber-200 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-slate-500">
              <div className="flex items-center gap-4 flex-wrap">
                <span className="flex items-center gap-1.5 text-slate-700">
                  <User className="w-3.5 h-3.5 text-amber-600" /> {material.authorName || 'Giáo viên'}
                </span>
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-sky-600" /> {new Date(material.created_at).toLocaleDateString('vi-VN')}
                </span>
                {material.file_size > 0 && (
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-emerald-600" /> {formatFileSize(material.file_size)}
                  </span>
                )}
              </div>

              <div>
                {isDownloadAllowed ? (
                  <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-lg text-[11px] font-black">
                    🟢 Cho phép tải về
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 bg-rose-100 text-rose-800 rounded-lg text-[11px] font-black flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Chỉ xem trực tiếp (Không cho phép tải xuống)
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* FOOTER MODAL & NÚT DOWNLOAD */}
        <div className="pt-3 border-t-2 border-amber-100 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
          >
            Đóng
          </button>

          <div className="flex items-center gap-2">
            {/* KHI ALLOW_DOWNLOAD = FALSE: KHÔNG HIỂN THỊ NÚT MỞ TAB MỚI VÀ KHÔNG HIỂN THỊ NÚT TẢI XUỐNG */}
            {isDownloadAllowed && signedUrl && (
              <>
                <a
                  href={signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-black text-xs rounded-xl flex items-center gap-1.5"
                >
                  <Maximize2 className="w-3.5 h-3.5" /> Mở Tab Mới
                </a>

                <a
                  href={signedUrl}
                  download={material.file_name || material.title}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs rounded-xl border-b-4 border-emerald-700 shadow-md flex items-center gap-2 active:translate-y-0.5 transition-all"
                >
                  <Download className="w-4 h-4" /> Tải Xuống Tài Liệu
                </a>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
