import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, X, AlertCircle, CheckCircle2, RefreshCw, Image as ImageIcon } from 'lucide-react';

const QR_ID_REGEX = /^qr_sec_[0-9a-f]{64}$/;

export const StudentQrScannerModal = ({ isOpen = true, onClose, onScanSuccess }) => {
  const [scanStatus, setScanStatus] = useState('idle'); // 'idle' | 'scanning' | 'success' | 'invalid' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const [scannedQrId, setScannedQrId] = useState(null);

  const qrRegionId = 'student-qr-reader-region';
  const html5QrCodeRef = useRef(null);
  const isScanningRef = useRef(false);
  const isMountedRef = useRef(false);
  const stopPromiseRef = useRef(null);
  const startPromiseRef = useRef(null);
  const startSucceededRef = useRef(false);
  const hasLoggedDecodeFailureRef = useRef(false);
  const fileInputRef = useRef(null);

  const stopCameraSafe = async () => {
    // Nếu đang có tiến trình dừng scanner, dùng chung Promise để tránh double stop/clear
    if (stopPromiseRef.current) {
      return stopPromiseRef.current;
    }

    const stopExecution = async () => {
      console.log('[QR-DIAG] scanner_stop_called');
      // 1. Chờ start() pending settle trước nếu có
      if (startPromiseRef.current) {
        try {
          await startPromiseRef.current;
        } catch {
          // Bỏ qua lỗi từ startPromise nếu start thất bại
        }
      }

      const scanner = html5QrCodeRef.current;
      if (!scanner) {
        console.log('[QR-DIAG] scanner_stop_resolved');
        return;
      }

      try {
        // 2. Không chỉ dựa vào scanner.isScanning, mà gọi stop() nếu start đã từng thành công hoặc đang scanning
        if (startSucceededRef.current || isScanningRef.current || scanner.isScanning) {
          startSucceededRef.current = false;
          isScanningRef.current = false;
          try {
            await scanner.stop();
          } catch {
            // Safe fallback cho scanner stop, không throw ra UI
          }
        }
        // 3. Chỉ gọi clear khi container còn tồn tại trong DOM
        if (document.getElementById(qrRegionId)) {
          try {
            scanner.clear();
          } catch {
            // Safe fallback cho clear
          }
        }
      } catch {
        // Safe fallback cho toàn bộ quá trình stop/clear
      } finally {
        html5QrCodeRef.current = null;
        startSucceededRef.current = false;
        isScanningRef.current = false;
        stopPromiseRef.current = null;
        console.log('[QR-DIAG] scanner_stop_resolved');
      }
    };

    stopPromiseRef.current = stopExecution();
    return stopPromiseRef.current;
  };

  useEffect(() => {
    isMountedRef.current = true;

    if (!isOpen) {
      stopCameraSafe().catch(() => {});
      setScanStatus('idle');
      setErrorMsg('');
      setScannedQrId(null);
      return;
    }

    let isEffectActive = true;
    setScanStatus('scanning');
    setErrorMsg('');
    setScannedQrId(null);

    const startScanner = async () => {
      try {
        await stopCameraSafe();
        if (!isEffectActive || !isMountedRef.current) return;

        const html5QrCode = new Html5Qrcode(qrRegionId, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          verbose: false,
        });
        html5QrCodeRef.current = html5QrCode;

        const config = {
          fps: 15,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const size = Math.floor(minEdge * 0.75);
            return { width: size, height: size };
          },
        };

        const qrCodeSuccessCallback = async (decodedText) => {
          if (!isEffectActive || !isMountedRef.current) return;

          console.log('[QR-DIAG] decode_success_callback_fired');
          const normalizedQrId = decodedText?.trim();
          const isValid = Boolean(normalizedQrId && QR_ID_REGEX.test(normalizedQrId));
          console.log(`[QR-DIAG] decoded_value_format_valid=${isValid}`);

          // Kiểm tra định dạng qrId hợp lệ theo regex
          if (isValid) {
            await stopCameraSafe();
            if (isEffectActive && isMountedRef.current) {
              setScannedQrId(normalizedQrId);
              setScanStatus('success');
              if (onScanSuccess) {
                onScanSuccess(normalizedQrId);
              }
            }
          } else {
            if (isEffectActive && isMountedRef.current) {
              setScanStatus('invalid');
              setErrorMsg('Mã QR không đúng định dạng thẻ học sinh.');
            }
          }
        };

        const qrCodeErrorCallback = () => {
          if (!hasLoggedDecodeFailureRef.current) {
            hasLoggedDecodeFailureRef.current = true;
            console.log('[QR-DIAG] decode_failure_callback_seen');
          }
        };

        hasLoggedDecodeFailureRef.current = false;
        console.log('[QR-DIAG] scanner_start_called');
        const startPromise = html5QrCode.start(
          { facingMode: 'environment' },
          config,
          qrCodeSuccessCallback,
          qrCodeErrorCallback
        );
        startPromiseRef.current = startPromise;

        try {
          await startPromise;
          startSucceededRef.current = true;
          isScanningRef.current = true;
          console.log('[QR-DIAG] scanner_start_resolved');
        } finally {
          if (startPromiseRef.current === startPromise) {
            startPromiseRef.current = null;
          }
        }

        // POST-AWAIT CANCEL CHECK: Modal đã đóng hoặc unmount trong lúc start() đang chạy
        if (!isEffectActive || !isMountedRef.current) {
          await stopCameraSafe();
          return;
        }
      } catch (err) {
        startSucceededRef.current = false;
        isScanningRef.current = false;
        if (isEffectActive && isMountedRef.current) {
          setScanStatus('error');
          setErrorMsg(err?.message || 'Không thể truy cập camera. Vui lòng cấp quyền truy cập camera.');
        }
      }
    };

    startScanner();

    return () => {
      isEffectActive = false;
      isMountedRef.current = false;
      stopCameraSafe().catch(() => {});
    };
  }, [isOpen]);

  const handleClose = async () => {
    await stopCameraSafe();
    onClose();
  };

  const handleRetryScan = async () => {
    await stopCameraSafe();
    if (!isMountedRef.current) return;

    setScanStatus('scanning');
    setErrorMsg('');
    setScannedQrId(null);
    try {
      const html5QrCode = new Html5Qrcode(qrRegionId, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });
      html5QrCodeRef.current = html5QrCode;

      const config = {
        fps: 15,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const size = Math.floor(minEdge * 0.75);
          return { width: size, height: size };
        },
      };

      hasLoggedDecodeFailureRef.current = false;
      console.log('[QR-DIAG] scanner_start_called');
      const startPromise = html5QrCode.start(
        { facingMode: 'environment' },
        config,
        async (decodedText) => {
          if (!isMountedRef.current) return;
          console.log('[QR-DIAG] decode_success_callback_fired');
          const normalizedQrId = decodedText?.trim();
          const isValid = Boolean(normalizedQrId && QR_ID_REGEX.test(normalizedQrId));
          console.log(`[QR-DIAG] decoded_value_format_valid=${isValid}`);

          if (isValid) {
            await stopCameraSafe();
            if (isMountedRef.current) {
              setScannedQrId(normalizedQrId);
              setScanStatus('success');
              if (onScanSuccess) {
                onScanSuccess(normalizedQrId);
              }
            }
          } else {
            if (isMountedRef.current) {
              setScanStatus('invalid');
              setErrorMsg('Mã QR không đúng định dạng thẻ học sinh.');
            }
          }
        },
        () => {
          if (!hasLoggedDecodeFailureRef.current) {
            hasLoggedDecodeFailureRef.current = true;
            console.log('[QR-DIAG] decode_failure_callback_seen');
          }
        }
      );
      startPromiseRef.current = startPromise;

      try {
        await startPromise;
        startSucceededRef.current = true;
        isScanningRef.current = true;
        console.log('[QR-DIAG] scanner_start_resolved');
      } finally {
        if (startPromiseRef.current === startPromise) {
          startPromiseRef.current = null;
        }
      }

      // POST-AWAIT CANCEL CHECK
      if (!isMountedRef.current) {
        await stopCameraSafe();
        return;
      }
    } catch (err) {
      startSucceededRef.current = false;
      isScanningRef.current = false;
      if (isMountedRef.current) {
        setScanStatus('error');
        setErrorMsg(err?.message || 'Không thể khởi động camera.');
      }
    }
  };

  const handleImageFileSelect = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset input value để cho phép chọn lại cùng 1 file
    event.target.value = '';

    setScanStatus('scanning');
    setErrorMsg('');

    try {
      // Dừng camera an toàn trước khi scan file
      await stopCameraSafe();
      if (!isMountedRef.current) return;

      const html5QrCode = new Html5Qrcode(qrRegionId, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });
      html5QrCodeRef.current = html5QrCode;

      // scanFile hoàn toàn cục bộ trên trình duyệt (không upload lên server)
      const decodedText = await html5QrCode.scanFile(file, false);
      if (!isMountedRef.current) return;

      const normalizedQrId = decodedText?.trim();

      if (normalizedQrId && QR_ID_REGEX.test(normalizedQrId)) {
        await stopCameraSafe();
        if (isMountedRef.current) {
          setScannedQrId(normalizedQrId);
          setScanStatus('success');
          if (onScanSuccess) {
            onScanSuccess(normalizedQrId);
          }
        }
      } else {
        await stopCameraSafe();
        if (isMountedRef.current) {
          setScanStatus('invalid');
          setErrorMsg('Ảnh không chứa thẻ QR hợp lệ.');
        }
      }
    } catch {
      await stopCameraSafe();
      if (isMountedRef.current) {
        setScanStatus('invalid');
        setErrorMsg('Ảnh không chứa thẻ QR hợp lệ.');
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl border-4 border-amber-400 p-6 max-w-md w-full shadow-2xl relative">
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="text-center mb-4">
          <div className="w-12 h-12 bg-amber-100 rounded-2xl border-2 border-amber-300 flex items-center justify-center mx-auto mb-2 text-amber-700">
            <Camera className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-black text-slate-800">Quét Thẻ QR Học Sinh</h3>
          <p className="text-xs text-slate-500 font-bold mt-0.5">
            Hướng camera về phía mã QR hoặc chọn ảnh thẻ QR
          </p>
        </div>

        {/* Hidden input file để chọn ảnh QR từ máy */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImageFileSelect}
          accept="image/*"
          className="hidden"
        />

        {/* Viewport quét camera */}
        {scanStatus !== 'success' && (
          <div className="relative rounded-2xl overflow-hidden border-2 border-amber-200 bg-black aspect-square flex items-center justify-center mb-4">
            <div id={qrRegionId} className="w-full h-full" />
            {scanStatus === 'scanning' && (
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                <div className="w-48 h-48 border-2 border-dashed border-amber-400 rounded-2xl animate-pulse" />
                <span className="mt-3 px-3 py-1 bg-black/60 text-amber-300 text-xs font-black rounded-full backdrop-blur-sm">
                  Đang quét mã QR...
                </span>
              </div>
            )}
          </div>
        )}

        {/* Trạng thái quét thành công */}
        {scanStatus === 'success' && (
          <div className="p-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl text-center mb-4">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
            <h4 className="font-black text-emerald-900 text-base">Đã nhận mã QR</h4>
            <p className="text-xs font-bold text-emerald-700 mt-1">
              Mã QR hợp lệ. Chuyển sang bước nhập mã PIN.
            </p>
          </div>
        )}

        {/* Thông báo lỗi nếu quét sai hoặc lỗi camera */}
        {errorMsg && (
          <div className="p-3 bg-rose-50 border-2 border-rose-200 rounded-xl text-rose-700 text-xs font-bold flex items-center gap-2 mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Nút hành động */}
        <div className="space-y-2">
          {scanStatus !== 'success' && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 bg-amber-100 hover:bg-amber-200 text-amber-900 font-black text-xs rounded-xl border-2 border-amber-300 flex items-center justify-center gap-2 transition-all shadow-sm active:translate-y-0.5"
            >
              <ImageIcon className="w-4 h-4 text-amber-700" /> Chọn ảnh chứa thẻ QR
            </button>
          )}

          <div className="flex gap-2">
            {scanStatus === 'invalid' && (
              <button
                type="button"
                onClick={handleRetryScan}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-xl flex items-center justify-center gap-2 transition-all"
              >
                <RefreshCw className="w-4 h-4" /> Quét Lại
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-xl transition-all"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

