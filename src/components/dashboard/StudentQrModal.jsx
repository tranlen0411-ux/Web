import React, { useState, useEffect } from 'react';
import {
  X,
  QrCode,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Trash2,
  Clock,
  Sparkles,
  Info,
  Download
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../../lib/supabase';

export const StudentQrModal = ({ isOpen, onClose, student, onStatusChange }) => {
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [qrStatus, setQrStatus] = useState(null);
  const [rawQrCredential, setRawQrCredential] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmReissue, setConfirmReissue] = useState(false);

  // Xóa toàn bộ raw credential khỏi bộ nhớ (Memory only) khi đóng hoặc reset
  const clearSensitiveState = () => {
    setRawQrCredential('');
    setErrorMsg('');
    setSuccessMsg('');
    setConfirmRevoke(false);
    setConfirmReissue(false);
  };

  useEffect(() => {
    if (isOpen && student?.id) {
      clearSensitiveState();
      fetchQrStatus();
    } else {
      clearSensitiveState();
      setQrStatus(null);
    }
  }, [isOpen, student?.id]);

  const handleClose = () => {
    clearSensitiveState();
    setQrStatus(null);
    onClose();
  };

  // Tải ảnh QR Code trực tiếp ở Client-side không gọi service ngoài
  const handleDownloadQrImage = () => {
    if (!rawQrCredential) return;

    try {
      const svgElement = document.getElementById('student-qr-svg-node');
      if (!svgElement) return;

      const svgData = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const URL = window.URL || window.webkitURL || window;
      const blobURL = URL.createObjectURL(svgBlob);

      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = 2; // Độ phân giải 2x (560x560px) sắc nét khi in
        canvas.width = 280 * scale;
        canvas.height = 280 * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Vẽ nền trắng
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Vẽ ảnh QR lên canvas
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        const pngUrl = canvas.toDataURL('image/png');
        const cleanCode = student.student_code ? student.student_code.trim().replace(/[^a-zA-Z0-9_-]/g, '') : 'hoc-sinh';
        const fileName = `QR-${cleanCode}.png`;

        const downloadLink = document.createElement('a');
        downloadLink.href = pngUrl;
        downloadLink.download = fileName;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(blobURL);
      };
      image.src = blobURL;
    } catch {
      // Safe fallback: Tải file SVG nếu canvas không hỗ trợ
      const svgElement = document.getElementById('student-qr-svg-node');
      if (!svgElement) return;
      const svgData = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const blobURL = window.URL.createObjectURL(svgBlob);
      const cleanCode = student.student_code ? student.student_code.trim().replace(/[^a-zA-Z0-9_-]/g, '') : 'hoc-sinh';
      const downloadLink = document.createElement('a');
      downloadLink.href = blobURL;
      downloadLink.download = `QR-${cleanCode}.svg`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      window.URL.revokeObjectURL(blobURL);
    }
  };

  // 1. Kiểm tra trạng thái thẻ QR hiện tại qua RPC get_student_qr_status
  const fetchQrStatus = async () => {
    setChecking(true);
    setErrorMsg('');
    try {
      const { data, error } = await supabase.rpc('get_student_qr_status', {
        p_student_id: student.id
      });

      if (error) {
        throw error;
      }

      setQrStatus(data || { has_active_qr: false });
    } catch {
      setErrorMsg('Không thể kiểm tra trạng thái Thẻ QR. Vui lòng thử lại sau.');
      setQrStatus({ has_active_qr: false });
    } finally {
      setChecking(false);
    }
  };

  // 2. Cấp mới / Cấp lại thẻ QR qua RPC generate_student_qr_card
  const handleGenerateQr = async () => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    setRawQrCredential('');
    setConfirmReissue(false);
    try {
      const { data, error } = await supabase.rpc('generate_student_qr_card', {
        p_student_id: student.id
      });

      if (error) {
        throw error;
      }

      if (data && data.raw_qr_id) {
        // Lưu raw_qr_id DUY NHẤT trong React state của component, không lưu Storage/Cookie/Log/URL
        setRawQrCredential(data.raw_qr_id);
        setQrStatus({
          has_active_qr: true,
          card_id: data.card_id,
          card_version: data.card_version,
          issued_at: data.issued_at
        });

        setSuccessMsg(
          qrStatus?.has_active_qr
            ? 'Đã cấp lại Thẻ QR mới thành công! Thẻ cũ đã tự động bị vô hiệu hóa.'
            : 'Đã tạo Thẻ QR ban đầu thành công!'
        );

        if (onStatusChange) {
          onStatusChange(student.id, true);
        }
      } else {
        throw new Error('Mã QR không hợp lệ');
      }
    } catch {
      setErrorMsg('Không thể tạo Thẻ QR cho học sinh. Vui lòng thử lại sau.');
    } finally {
      setLoading(false);
    }
  };

  // 3. Thu hồi thẻ QR qua RPC revoke_student_qr_card
  const handleRevokeQr = async () => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const { data, error } = await supabase.rpc('revoke_student_qr_card', {
        p_student_id: student.id
      });

      if (error) {
        throw error;
      }

      if (data && data.success) {
        setRawQrCredential('');
        setQrStatus({ has_active_qr: false });
        setConfirmRevoke(false);
        setSuccessMsg('Đã thu hồi Thẻ QR thành công. Học sinh sẽ không thể dùng thẻ này để đăng nhập.');

        if (onStatusChange) {
          onStatusChange(student.id, false);
        }
      } else {
        throw new Error('Thu hồi không thành công');
      }
    } catch {
      setErrorMsg('Không thể thu hồi Thẻ QR. Vui lòng thử lại sau.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !student) return null;

  const hasActiveQr = Boolean(qrStatus?.has_active_qr);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg bg-white rounded-3xl border-4 border-sky-300 p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
        {/* Nút đóng */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Tiêu đề modal */}
        <div className="flex items-center gap-2.5 mb-1">
          <div className="p-2 bg-sky-100 rounded-2xl text-sky-700">
            <QrCode className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-black text-slate-900">Quản Lý Thẻ QR Đăng Nhập</h3>
            <p className="text-xs font-bold text-slate-500">
              Học sinh: <span className="text-sky-900 font-extrabold">{student.full_name}</span>{' '}
              {student.student_code ? (
                <span className="text-purple-700 font-mono font-black">({student.student_code})</span>
              ) : null}
            </p>
          </div>
        </div>

        {/* Thông báo lỗi / thành công */}
        {errorMsg && (
          <div className="mt-4 p-3 bg-rose-50 border-2 border-rose-200 text-rose-800 text-xs font-bold rounded-2xl flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mt-4 p-3 bg-emerald-50 border-2 border-emerald-300 text-emerald-900 text-xs font-bold rounded-2xl flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {checking ? (
          <div className="py-12 text-center text-xs font-bold text-slate-500 flex flex-col items-center gap-2">
            <RefreshCw className="w-6 h-6 animate-spin text-sky-600" />
            <span>Đang kiểm tra trạng thái Thẻ QR...</span>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {/* Trạng thái Thẻ hiện hành */}
            <div className="p-4 rounded-2xl border-2 bg-slate-50 border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-600">Trạng thái thẻ QR:</span>
                {hasActiveQr ? (
                  <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-xs rounded-xl flex items-center gap-1">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" /> Đang Hoạt Động (v{qrStatus.card_version})
                  </span>
                ) : (
                  <span className="px-2.5 py-1 bg-slate-200 text-slate-700 font-extrabold text-xs rounded-xl">
                    ⚪ Chưa Có Thẻ Active
                  </span>
                )}
              </div>

              {hasActiveQr && (
                <div className="pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-bold text-slate-600">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Cấp ngày: {qrStatus.issued_at ? new Date(qrStatus.issued_at).toLocaleString('vi-VN') : '—'}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span>Dùng gần nhất: {qrStatus.last_used_at ? new Date(qrStatus.last_used_at).toLocaleString('vi-VN') : 'Chưa sử dụng'}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Khối hiển thị Thẻ QR Mới (Chỉ xuất hiện sau khi Generate, in-memory) */}
            {rawQrCredential && (
              <div className="p-5 bg-amber-50 border-2 border-amber-300 rounded-3xl space-y-3.5 animate-fadeIn flex flex-col items-center text-center">
                <div className="flex items-center gap-1.5 text-xs font-black text-amber-950">
                  <Sparkles className="w-4 h-4 text-amber-600" />
                  <span>Thẻ QR Đăng Nhập Mới (Hiển thị 1 lần duy nhất)</span>
                </div>

                {/* Render vector SVG QR Code client-side với vùng an toàn (margin trắng) và kích thước lớn dễ quét */}
                <div className="p-4 bg-white rounded-3xl shadow-md border-2 border-amber-200 inline-flex items-center justify-center">
                  <QRCodeSVG
                    id="student-qr-svg-node"
                    value={rawQrCredential}
                    size={280}
                    level="M"
                    bgColor="#FFFFFF"
                    fgColor="#000000"
                    includeMargin={true}
                  />
                </div>

                {/* Nút lưu ảnh QR về máy client-side */}
                <button
                  type="button"
                  onClick={handleDownloadQrImage}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-2xl border-b-4 border-emerald-800 shadow-md active:translate-y-0.5 flex items-center gap-2 transition-all"
                >
                  <Download className="w-4 h-4" /> 💾 Lưu Ảnh QR Về Máy (.PNG)
                </button>

                <div className="p-3 bg-amber-100/80 rounded-2xl text-xs font-bold text-amber-950 flex items-start gap-2 text-left w-full">
                  <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <span>
                    <strong>Lưu ý quan trọng:</strong> Mã QR này chỉ hiển thị một lần. Hãy in hoặc lưu bản in trước khi đóng.
                  </span>
                </div>
              </div>
            )}

            {/* Cảnh báo phân tách PIN và QR */}
            <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl text-[11px] font-bold text-sky-900 flex items-center gap-2">
              <Info className="w-4 h-4 text-sky-600 shrink-0" />
              <span>
                Mã QR và Mã PIN hoạt động độc lập (2 lớp). Mã PIN không bao giờ hiển thị cùng với QR.
              </span>
            </div>

            {/* Xác nhận cấp lại (Reissue) */}
            {confirmReissue && (
              <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl space-y-3 animate-fadeIn">
                <p className="text-xs font-black text-amber-950">
                  ⚠️ Cảnh báo: Cấp lại Thẻ QR mới sẽ tự động vô hiệu hóa Thẻ QR hiện tại của học sinh. Học sinh chỉ có thể đăng nhập bằng Thẻ QR mới sau khi cấp lại. Thầy/Cô có chắc chắn muốn cấp lại?
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setConfirmReissue(false)}
                    className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-100"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleGenerateQr}
                    className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-black text-xs rounded-xl shadow-sm flex items-center gap-1.5"
                  >
                    {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {loading ? 'Đang xử lý...' : 'Xác nhận cấp lại'}
                  </button>
                </div>
              </div>
            )}

            {/* Xác nhận thu hồi (Revoke) */}
            {confirmRevoke && (
              <div className="p-4 bg-rose-50 border-2 border-rose-300 rounded-2xl space-y-3 animate-fadeIn">
                <p className="text-xs font-black text-rose-900">
                  ⚠️ Thầy/Cô có chắc chắn muốn thu hồi Thẻ QR của học sinh này? Sau khi thu hồi, học sinh sẽ không thể đăng nhập bằng mã QR cũ.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setConfirmRevoke(false)}
                    className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 font-bold text-xs rounded-xl hover:bg-slate-100"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleRevokeQr}
                    className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-xl shadow-sm"
                  >
                    {loading ? 'Đang xử lý...' : 'Xác nhận thu hồi'}
                  </button>
                </div>
              </div>
            )}

            {/* Các nút hành động chính */}
            <div className="pt-2 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2.5 bg-slate-100 text-slate-600 font-bold text-xs rounded-xl hover:bg-slate-200 transition-colors"
              >
                Đóng
              </button>

              {hasActiveQr && !confirmRevoke && !confirmReissue && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setConfirmRevoke(true);
                    setConfirmReissue(false);
                  }}
                  className="px-4 py-2.5 bg-rose-100 hover:bg-rose-200 text-rose-800 font-black text-xs rounded-xl flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Thu hồi Thẻ QR
                </button>
              )}

              {!confirmReissue && !confirmRevoke && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    if (hasActiveQr) {
                      setConfirmReissue(true);
                      setConfirmRevoke(false);
                    } else {
                      handleGenerateQr();
                    }
                  }}
                  className="px-5 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-black text-xs rounded-xl border-b-4 border-sky-700 shadow-md active:translate-y-0.5 flex items-center gap-1.5 transition-colors"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> Đang xử lý...
                    </>
                  ) : hasActiveQr ? (
                    <>
                      <RefreshCw className="w-4 h-4" /> Cấp Lại Thẻ Mới (Reissue)
                    </>
                  ) : (
                    <>
                      <QrCode className="w-4 h-4" /> Cấp Thẻ QR Ban Đầu
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

