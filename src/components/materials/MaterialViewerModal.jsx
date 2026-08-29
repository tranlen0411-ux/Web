import React, { useState, useEffect, useRef } from 'react';
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
  AlertCircle,
  Play,
  Layers,
  Copy,
  Check
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatClassLabel } from '../../utils/helpers';
import { createScormLaunchSession, getScormPlayerOrigin } from '../../services/scormLaunchService';

export const MaterialViewerModal = ({ isOpen, onClose, material }) => {
  const [signedUrl, setSignedUrl] = useState(null);
  const [scormPlayerUrl, setScormPlayerUrl] = useState(null);
  const [scormVersion, setScormVersion] = useState('1.2');
  const [scormSession, setScormSession] = useState(null);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [isClosing, setIsClosing] = useState(false);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  const scormIframeRef = useRef(null);
  const closeTimeoutRef = useRef(null);
  const scormTrackingRef = useRef(null);
  const commitDebounceRef = useRef(null);

  // Cleanup timeout khi component unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      if (commitDebounceRef.current) {
        clearTimeout(commitDebounceRef.current);
        commitDebounceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isOpen && material) {
      const type = material.file_type?.toLowerCase();

      if (type === 'scorm') {
        loadScormPackage(material.id);
      } else if (material.file_path) {
        generateSignedUrl(material.file_path);
      } else if (material.external_url) {
        setSignedUrl(material.external_url);
        setLoadingUrl(false);
      } else {
        setSignedUrl(null);
        setLoadingUrl(false);
      }
    } else {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      if (commitDebounceRef.current) {
        clearTimeout(commitDebounceRef.current);
        commitDebounceRef.current = null;
      }
      scormTrackingRef.current = null;
      setSignedUrl(null);
      setScormPlayerUrl(null);
      setScormSession(null);
      setSaveStatus('idle');
      setIsClosing(false);
      setUrlError('');
      setCopiedLink(false);
    }
  }, [isOpen, material]);

  // Lắng nghe và xử lý sự kiện đồng bộ trạng thái CMI từ SCORM Player qua postMessage
  useEffect(() => {
    if (!isOpen || material?.file_type?.toLowerCase() !== 'scorm') return;

    let playerOrigin = null;
    try {
      playerOrigin = getScormPlayerOrigin();
    } catch {
      // Player origin chưa được cấu hình -> không đăng ký / xử lý postMessage
      return;
    }

    const executeSaveCmi = async (cmiData, isCloseSnapshot = false, sourceEvent = null) => {
      if (!cmiData || !scormSession?.packageId || !scormSession?.sessionToken) return;

      try {
        setSaveStatus('saving');
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('save_scorm_cmi_state', {
          p_package_id: scormSession.packageId,
          p_cmi_payload: cmiData,
          p_session_token: scormSession.sessionToken,
        });

        if (rpcErr || !rpcRes || rpcRes.success !== true) {
          console.warn('[MaterialViewerModal] Save SCORM CMI state failed:', rpcErr || rpcRes?.message);
          setSaveStatus('error');
          if (isCloseSnapshot) {
            if (closeTimeoutRef.current) {
              clearTimeout(closeTimeoutRef.current);
              closeTimeoutRef.current = null;
            }
            setIsClosing(false);
          }
          if (sourceEvent && typeof sourceEvent.postMessage === 'function') {
            sourceEvent.postMessage(
              {
                type: 'SCORM_CMI_SAVE_FAILED',
                payload: { success: false, reason: rpcErr?.message || rpcRes?.message || 'SAVE_FAILED' },
              },
              playerOrigin
            );
          }
        } else {
          setSaveStatus('saved');
          if (scormTrackingRef.current) {
            scormTrackingRef.current = {
              ...scormTrackingRef.current,
              cmi_data: cmiData,
            };
          }
          if (isCloseSnapshot) {
            if (closeTimeoutRef.current) {
              clearTimeout(closeTimeoutRef.current);
              closeTimeoutRef.current = null;
            }
            setIsClosing(false);
            onClose();
          }
          if (sourceEvent && typeof sourceEvent.postMessage === 'function') {
            sourceEvent.postMessage(
              {
                type: 'SCORM_CMI_SAVED',
                payload: { success: true, timestamp: new Date().toISOString() },
              },
              playerOrigin
            );
          }
        }
      } catch (err) {
        console.error('[MaterialViewerModal] Exception saving SCORM CMI:', err);
        setSaveStatus('error');
        if (isCloseSnapshot) {
          if (closeTimeoutRef.current) {
            clearTimeout(closeTimeoutRef.current);
            closeTimeoutRef.current = null;
          }
          setIsClosing(false);
        }
      }
    };

    const handleMessage = async (event) => {
      // 1. Kiểm tra ranh giới Origin & Source Window nghiêm ngặt (Chặn đứng mọi origin/iframe khác)
      if (!playerOrigin || event.origin !== playerOrigin) {
        return;
      }

      if (scormIframeRef.current?.contentWindow && event.source !== scormIframeRef.current.contentWindow) {
        return;
      }

      const { type: msgType, payload } = event.data || {};

      // Phản hồi PING hoặc SCORM_LOADED để hydrate lại dữ liệu nếu Player yêu cầu
      if (msgType === 'PING' || msgType === 'SCORM_LOADED') {
        if (scormTrackingRef.current && scormIframeRef.current?.contentWindow) {
          scormIframeRef.current.contentWindow.postMessage(
            {
              type: 'RESTORE_CMI',
              payload: {
                tracking: scormTrackingRef.current,
              },
            },
            playerOrigin
          );
        }
        return;
      }

      if (msgType === 'SCORM_CLOSE_SNAPSHOT_FAILED') {
        console.warn('[MaterialViewerModal] SCORM Player snapshot before close failed:', payload?.error);
        if (closeTimeoutRef.current) {
          clearTimeout(closeTimeoutRef.current);
          closeTimeoutRef.current = null;
        }
        setSaveStatus('error');
        setIsClosing(false);
        return;
      }

      if (
        msgType === 'SCORM_CMI_COMMIT' ||
        msgType === 'SCORM_CMI_FINISH' ||
        msgType === 'SCORM_CMI_TERMINATE'
      ) {
        if (!payload || !payload.cmi || !scormSession?.packageId) return;

        const isCloseSnapshot = payload.event === 'PARENT_CLOSE_SNAPSHOT';
        const isUrgent = isCloseSnapshot || msgType === 'SCORM_CMI_FINISH' || msgType === 'SCORM_CMI_TERMINATE';

        if (isUrgent) {
          if (commitDebounceRef.current) {
            clearTimeout(commitDebounceRef.current);
            commitDebounceRef.current = null;
          }
          await executeSaveCmi(payload.cmi, isCloseSnapshot, event.source);
        } else {
          // Debounce 1.5s cho auto-commit trong lúc học sinh làm bài
          if (commitDebounceRef.current) {
            clearTimeout(commitDebounceRef.current);
          }
          commitDebounceRef.current = setTimeout(() => {
            commitDebounceRef.current = null;
            executeSaveCmi(payload.cmi, false, event.source);
          }, 1500);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [isOpen, material, scormSession, onClose]);

  // Tạo Signed URL cho file thường
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

  // Nạp thông tin SCORM Package và tạo Player Launch Session
  const loadScormPackage = async (materialId) => {
    setLoadingUrl(true);
    setUrlError('');
    try {
      // 1. Kiểm tra cấu hình Player Origin trước
      try {
        getScormPlayerOrigin();
      } catch (originErr) {
        if (originErr?.message === 'SCORM_PLAYER_ORIGIN_NOT_CONFIGURED') {
          setUrlError('Trình phát SCORM chưa được cấu hình trên môi trường này.');
          setScormPlayerUrl(null);
          setScormSession(null);
          return;
        }
        throw originErr;
      }

      const { data: scormPkg, error: pkgErr } = await supabase
        .from('scorm_packages')
        .select('*')
        .eq('material_id', materialId)
        .maybeSingle();

      if (pkgErr || !scormPkg) {
        console.warn('Không tìm thấy thông tin scorm_packages:', pkgErr);
        setUrlError('Không tìm thấy dữ liệu gói SCORM trong hệ thống.');
        setScormPlayerUrl(null);
        setScormSession(null);
        return;
      }

      setScormVersion(scormPkg.scorm_version || '1.2');

      // Khởi tạo Player URL từ Service với đúng materialId
      const session = await createScormLaunchSession({
        materialId: materialId,
        studentName: 'Học sinh',
      });

      // Gọi RPC load_scorm_cmi_state để lấy tiến độ học tập đã lưu (nếu có)
      try {
        const { data: loadRes, error: loadErr } = await supabase.rpc('load_scorm_cmi_state', {
          p_package_id: scormPkg.id,
          p_session_token: session.sessionToken,
        });

        if (!loadErr && loadRes && loadRes.success && loadRes.tracking) {
          scormTrackingRef.current = loadRes.tracking;
          console.log('[MaterialViewerModal] Loaded persisted SCORM CMI tracking:', loadRes.tracking);
        } else {
          scormTrackingRef.current = null;
        }
      } catch (loadExc) {
        console.warn('[MaterialViewerModal] load_scorm_cmi_state caught exception:', loadExc);
        scormTrackingRef.current = null;
      }

      setScormSession({
        sessionToken: session.sessionToken,
        packageId: scormPkg.id,
      });
      setScormPlayerUrl(session.playerUrl);
    } catch (err) {
      console.error('SCORM player init error:', err);
      if (err?.message === 'SCORM_PLAYER_ORIGIN_NOT_CONFIGURED') {
        setUrlError('Trình phát SCORM chưa được cấu hình trên môi trường này.');
      } else {
        setUrlError('Lỗi khi khởi chạy bài học SCORM: ' + (err.message || 'Không xác định'));
      }
      setScormPlayerUrl(null);
      setScormSession(null);
      scormTrackingRef.current = null;
    } finally {
      setLoadingUrl(false);
    }
  };

  const handleCopyShareLink = () => {
    if (!material?.share_token) return;
    const shareUrl = `${window.location.origin}/materials/public/${material.share_token}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleSafeClose = () => {
    if (isClosing) return;

    const isScorm = material?.file_type?.toLowerCase() === 'scorm';
    if (!isScorm || !scormPlayerUrl || !scormIframeRef.current) {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      onClose();
      return;
    }

    // Đang mở bài SCORM -> Gửi yêu cầu lưu tiến độ trước khi đóng
    setIsClosing(true);
    setSaveStatus('saving');

    let playerOrigin = '';
    try {
      playerOrigin = getScormPlayerOrigin();
    } catch {
      playerOrigin = '';
    }

    if (scormIframeRef.current?.contentWindow && playerOrigin) {
      scormIframeRef.current.contentWindow.postMessage(
        { type: 'SCORM_REQUEST_SAVE_BEFORE_CLOSE' },
        playerOrigin
      );
    }

    // Timeout phòng vệ khoảng 5 giây: nếu Player không trả lời hoặc lỗi, không tự đóng
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => {
      console.warn('[MaterialViewerModal] Save before close timed out after 5s');
      setSaveStatus('error');
      setIsClosing(false);
    }, 5000);
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
  const type = material.file_type?.toLowerCase();

  const renderViewerContent = () => {
    if (loadingUrl) {
      return (
        <div className="flex flex-col items-center justify-center p-12 bg-amber-50/50 rounded-2xl border-2 border-amber-200 min-h-[300px]">
          <Loader2 className="w-8 h-8 text-amber-600 animate-spin mb-2" />
          <p className="text-xs font-bold text-amber-900">
            {type === 'scorm' ? 'Đang khởi tạo môi trường bài học SCORM...' : 'Đang khởi tạo đường dẫn xem an toàn (Signed URL)...'}
          </p>
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

    // 1. XEM GÓI SCORM 1.2 / 2004
    if (type === 'scorm' && scormPlayerUrl) {
      return (
        <div className="w-full h-[68vh] bg-slate-900 rounded-2xl overflow-hidden border-4 border-amber-400 relative shadow-inner flex flex-col">
          <div className="bg-amber-500 px-4 py-2 flex items-center justify-between text-amber-950 font-black text-xs">
            <span className="flex items-center gap-1.5">
              <Layers className="w-4 h-4" /> Khung bài học SCORM (Chuẩn {scormVersion})
            </span>
            <div className="flex items-center gap-2">
              {saveStatus === 'saving' && (
                <span className="text-[10px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded font-bold flex items-center gap-1 animate-pulse">
                  <Loader2 className="w-3 h-3 animate-spin" /> Đang lưu tiến độ...
                </span>
              )}
              {saveStatus === 'saved' && (
                <span className="text-[10px] bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded font-bold flex items-center gap-1">
                  <Check className="w-3 h-3 text-emerald-600" /> Đã lưu tiến độ
                </span>
              )}
              {saveStatus === 'error' && (
                <span className="text-[10px] bg-rose-100 text-rose-900 px-2 py-0.5 rounded font-bold flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 text-rose-600" /> Lỗi lưu tiến độ
                </span>
              )}
              <span className="text-[10px] bg-amber-100/90 px-2 py-0.5 rounded font-bold">
                Isolated Origin Sandbox
              </span>
            </div>
          </div>

          <iframe
            ref={scormIframeRef}
            src={scormPlayerUrl}
            title={material.title}
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
            allow="fullscreen; autoplay"
            className="w-full flex-1 border-none bg-white"
          />
        </div>
      );
    }

    // 2. XEM FILE HÌNH ẢNH
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

    // 3. XEM FILE VIDEO
    if (type === 'video' && signedUrl) {
      return (
        <div className="flex flex-col items-center justify-center bg-black rounded-2xl overflow-hidden min-h-[350px]">
          <video
            src={signedUrl}
            controls
            controlsList={!isDownloadAllowed ? 'nodownload' : undefined}
            autoPlay={false}
            className="w-full max-h-[60vh] rounded-xl"
          >
            Trình duyệt của bạn không hỗ trợ xem video trực tiếp.
          </video>
        </div>
      );
    }

    // 4. XEM FILE PDF TRỰC TIẾP
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

    // 5. WORD, POWERPOINT, LINK HOẶC FILE KHÁC
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
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="px-3 py-0.5 bg-amber-100 text-amber-900 text-[11px] font-black rounded-xl border border-amber-300 uppercase inline-block">
                📖 {material.subject} {material.className ? `• ${formatClassLabel(material.className)}` : ''}
              </span>

              {material.visibility === 'public' && (
                <span className="px-2.5 py-0.5 bg-sky-100 text-sky-800 text-[10px] font-black rounded-lg border border-sky-300">
                  🌐 Công khai
                </span>
              )}
              {material.visibility === 'school' && (
                <span className="px-2.5 py-0.5 bg-indigo-100 text-indigo-800 text-[10px] font-black rounded-lg border border-indigo-300">
                  🏫 Toàn trường
                </span>
              )}
              {type === 'scorm' && (
                <span className="px-2.5 py-0.5 bg-purple-100 text-purple-800 text-[10px] font-black rounded-lg border border-purple-300 flex items-center gap-1">
                  <Layers className="w-3 h-3" /> SCORM {scormVersion}
                </span>
              )}
            </div>

            <h3 className="text-lg sm:text-xl font-black text-amber-950 line-clamp-1">{material.title}</h3>
          </div>

          <button
            onClick={handleSafeClose}
            disabled={isClosing}
            className={`p-2 rounded-full text-slate-500 transition-colors shrink-0 ${
              isClosing ? 'opacity-50 cursor-not-allowed bg-slate-100' : 'bg-slate-100 hover:bg-slate-200'
            }`}
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
                  <Calendar className="w-3.5 h-3.5 text-sky-600" />{' '}
                  {new Date(material.created_at).toLocaleDateString('vi-VN')}
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
                    <Lock className="w-3 h-3" /> Chỉ xem trực tiếp
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* FOOTER MODAL & NÚT DOWNLOAD / SHARE */}
        <div className="pt-3 border-t-2 border-amber-100 flex items-center justify-between gap-3">
          <button
            onClick={handleSafeClose}
            disabled={isClosing}
            className={`px-5 py-2.5 font-bold text-xs rounded-xl transition-all ${
              isClosing
                ? 'bg-amber-100 text-amber-800 cursor-not-allowed opacity-80 flex items-center gap-1.5'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            {isClosing && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />}
            {isClosing ? 'Đang lưu...' : 'Đóng'}
          </button>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Nút Copy Link nếu là Public Material */}
            {material.visibility === 'public' && material.share_token && (
              <button
                type="button"
                onClick={handleCopyShareLink}
                className="px-4 py-2.5 bg-sky-100 hover:bg-sky-200 text-sky-800 font-black text-xs rounded-xl flex items-center gap-1.5 transition-all"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedLink ? 'Đã Sao Chép Link!' : 'Sao Chép Link'}
              </button>
            )}

            {/* Nút Download cho các tệp thông thường */}
            {isDownloadAllowed && signedUrl && type !== 'scorm' && (
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
