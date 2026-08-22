import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  BookOpen, 
  Download, 
  ExternalLink, 
  FileText, 
  FileCode, 
  Calendar, 
  User, 
  HardDrive, 
  Loader2, 
  Globe, 
  ArrowLeft 
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatClassLabel } from '../utils/helpers';

export const PublicMaterialView = () => {
  const { shareToken } = useParams();

  const [material, setMaterial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (shareToken) {
      fetchPublicMaterial(shareToken);
    } else {
      setErrorMsg('Thiếu mã liên kết tài liệu công khai.');
      setLoading(false);
    }
  }, [shareToken]);

  const fetchPublicMaterial = async (token) => {
    setLoading(true);
    setErrorMsg('');
    try {
      // 1. Gọi Edge Function bảo mật get-public-learning-material (Cấp Signed URL từ Server-side)
      const { data, error } = await supabase.functions.invoke('get-public-learning-material', {
        body: { share_token: token }
      });

      if (error) {
        throw new Error(error.message || 'Không thể kết nối đến máy chủ.');
      }

      if (!data?.success || !data?.data) {
        throw new Error(data?.message || 'Tài liệu không tồn tại hoặc đã ngừng chia sẻ công khai.');
      }

      setMaterial(data.data);

    } catch (err) {
      console.error('Public material error:', err);
      setErrorMsg(err.message || 'Không thể tải thông tin bài giảng công khai.');
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleDownload = async () => {
    if (!material || material.allow_download === false) return;

    if (material.external_url) {
      window.open(material.external_url, '_blank', 'noopener,noreferrer');
      return;
    }

    const downloadUrl = material.signed_url;
    if (!downloadUrl) return;

    setDownloading(true);
    try {
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = material.file_name || material.title;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setDownloading(false);
    }
  };

  const renderContent = () => {
    if (!material) return null;
    const type = material.file_type?.toLowerCase();
    const isDownloadAllowed = material.allow_download !== false;
    const targetUrl = material.signed_url || material.external_url;

    // 1. HÌNH ẢNH
    if (type === 'image' && targetUrl) {
      return (
        <div className="flex flex-col items-center justify-center p-3 bg-slate-900/90 rounded-3xl overflow-hidden min-h-[350px]">
          <img 
            src={targetUrl} 
            alt={material.title} 
            className="max-h-[65vh] max-w-full object-contain rounded-2xl shadow-xl"
          />
        </div>
      );
    }

    // 2. VIDEO
    if (type === 'video' && targetUrl) {
      return (
        <div className="flex flex-col items-center justify-center bg-black rounded-3xl overflow-hidden min-h-[350px]">
          <video 
            src={targetUrl} 
            controls 
            controlsList={!isDownloadAllowed ? "nodownload" : undefined}
            autoPlay={false}
            className="w-full max-h-[65vh] rounded-2xl"
          >
            Trình duyệt của bạn không hỗ trợ xem video trực tiếp.
          </video>
        </div>
      );
    }

    // 3. PDF
    if (type === 'pdf' && targetUrl) {
      return (
        <div className="w-full h-[65vh] bg-slate-100 rounded-3xl overflow-hidden border-4 border-amber-200 shadow-inner">
          <iframe
            src={`${targetUrl}#toolbar=${isDownloadAllowed ? 1 : 0}`}
            title={material.title}
            className="w-full h-full rounded-2xl"
          />
        </div>
      );
    }

    // 4. WORD, POWERPOINT, LINK
    return (
      <div className="p-8 sm:p-12 bg-amber-50/80 border-4 border-amber-200 rounded-3xl text-center flex flex-col items-center justify-center min-h-[300px]">
        <div className="w-20 h-20 bg-amber-100 rounded-3xl border-4 border-amber-300 flex items-center justify-center mb-4 text-amber-800 shadow-md">
          {type === 'word' && <FileText className="w-10 h-10 text-blue-600" />}
          {type === 'powerpoint' && <FileCode className="w-10 h-10 text-orange-600" />}
          {type === 'link' && <ExternalLink className="w-10 h-10 text-cyan-600" />}
          {!['word', 'powerpoint', 'link'].includes(type) && <BookOpen className="w-10 h-10 text-amber-700" />}
        </div>

        <h4 className="text-xl font-black text-amber-950 mb-2">{material.title}</h4>
        <p className="text-xs font-bold text-slate-500 mb-6 max-w-md">
          {type === 'link' 
            ? 'Đường liên kết bài giảng trực tuyến bên ngoài.'
            : `Tài liệu dạng tệp ${type?.toUpperCase()}. Bấm nút bên dưới để mở xem.`}
        </p>

        {targetUrl && (
          <a
            href={targetUrl}
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
    <div className="min-h-screen bg-amber-50/70 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* HEADER QUAY LẠI TRANG CHỦ */}
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white rounded-2xl border-2 border-amber-200 text-amber-900 font-black text-xs hover:bg-amber-100/60 shadow-sm transition-all"
          >
            <ArrowLeft className="w-4 h-4" /> Về Trang Chủ
          </Link>

          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-xl font-black text-xs">
            <Globe className="w-3.5 h-3.5 text-emerald-600" /> Bài Giảng Chia Sẻ Công Khai
          </span>
        </div>

        {/* TRẠNG THÁI LOADING */}
        {loading && (
          <div className="p-12 bg-white rounded-3xl border-4 border-amber-200 text-center shadow-lg space-y-3">
            <Loader2 className="w-10 h-10 text-amber-600 animate-spin mx-auto" />
            <p className="text-sm font-black text-amber-950">Đang tải bài giảng công khai...</p>
          </div>
        )}

        {/* TRẠNG THÁI ERROR */}
        {!loading && errorMsg && (
          <div className="p-8 sm:p-12 bg-white rounded-3xl border-4 border-rose-200 text-center shadow-lg space-y-4">
            <div className="w-16 h-16 bg-rose-100 rounded-3xl border-4 border-rose-300 flex items-center justify-center mx-auto text-3xl">
              🚫
            </div>
            <h3 className="text-xl font-black text-rose-950">Không Thể Truy Cập Tài Liệu</h3>
            <p className="text-xs sm:text-sm font-bold text-slate-600 max-w-md mx-auto leading-relaxed">
              {errorMsg}
            </p>
            <div className="pt-2">
              <Link
                to="/"
                className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-xl shadow-md inline-block"
              >
                Về Trang Chủ Học Tập
              </Link>
            </div>
          </div>
        )}

        {/* NỘI DUNG TÀI LIỆU CÔNG KHAI */}
        {!loading && material && (
          <div className="bg-white rounded-3xl border-4 border-amber-300 p-5 sm:p-8 shadow-2xl space-y-6">
            
            {/* THÔNG TIN BÀI HỌC */}
            <div className="border-b-2 border-amber-100 pb-4">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="px-3 py-1 bg-amber-100 text-amber-900 font-black text-xs rounded-xl border border-amber-300 uppercase">
                  📖 {material.subject}
                </span>
                {material.class_name && (
                  <span className="px-3 py-1 bg-sky-100 text-sky-900 font-black text-xs rounded-xl border border-sky-300">
                    🏫 {formatClassLabel(material.class_name)}
                  </span>
                )}
              </div>

              <h1 className="text-xl sm:text-2xl font-black text-amber-950">
                {material.title}
              </h1>
            </div>

            {/* VIEWER CHÍNH */}
            <div>
              {renderContent()}
            </div>

            {/* MÔ TẢ & THÔNG TIN TÁC GIẢ */}
            <div className="p-4 bg-amber-50/70 border-2 border-amber-200 rounded-2xl space-y-3">
              <div>
                <p className="text-xs font-black text-amber-950 uppercase mb-1">Mô tả bài giảng:</p>
                <p className="text-xs font-bold text-slate-600 leading-relaxed">
                  {material.description || 'Chưa có mô tả chi tiết cho bài giảng này.'}
                </p>
              </div>

              <div className="pt-2 border-t border-amber-200 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-slate-500">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="flex items-center gap-1.5 text-slate-700">
                    <User className="w-3.5 h-3.5 text-amber-600" /> {material.author_name}
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

                {/* NÚT TẢI XUỐNG CÔNG KHAI */}
                {material.allow_download !== false && material.signed_url && (
                  <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs rounded-xl border-b-2 border-emerald-700 shadow-sm flex items-center gap-1.5 active:translate-y-0.5"
                  >
                    {downloading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    Tải Tệp Về Máy
                  </button>
                )}
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
};
