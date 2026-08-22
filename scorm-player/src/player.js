import { createScorm12Api, createScorm2004Api } from './scormApi.js';

/**
 * SCORM Player Bootstrap (Isolated Origin App)
 * Khởi tạo môi trường runtime và nạp SCO Content vào Frame cách ly
 */
(function initScormPlayer() {
  console.log('🎮 [SCORM Player] Initializing Isolated Player Module (Port 4174)...');

  // 1. Phân tích tham số khởi chạy từ Query Params
  const urlParams = new URLSearchParams(window.location.search);
  const scormVersion = urlParams.get('version') || '1.2';
  const launchUrl = urlParams.get('launch') || '';
  const studentName = urlParams.get('studentName') || 'Học sinh';
  const parentOrigin = urlParams.get('parentOrigin') || '';

  // 2. Khởi tạo và gắn SCORM API vào Window của Player
  // Cung cấp API trên window để iframe SCO (cùng Origin B) có thể tìm thấy qua window.parent.API hoặc window.API
  const initialData = { studentName };
  const api12 = createScorm12Api(initialData);
  const api2004 = createScorm2004Api(initialData);

  window.API = api12;
  window.API_1484_11 = api2004;

  console.log(`✅ [SCORM Player] Attached window.API (1.2) and window.API_1484_11 (2004). Target: ${scormVersion}`);

  // 3. Thiết lập Content Frame
  const contentFrame = document.getElementById('scorm-content-frame');
  const loadingOverlay = document.getElementById('loading-overlay');
  const errorOverlay = document.getElementById('error-overlay');
  const errorMessage = document.getElementById('error-message');

  if (!launchUrl) {
    if (errorOverlay && errorMessage) {
      errorMessage.textContent = 'Không có đường dẫn khởi chạy bài học (Launch URL).';
      errorOverlay.style.display = 'flex';
    }
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    return;
  }

  // 4. Lắng nghe thông điệp postMessage từ parent một cách an toàn
  window.addEventListener('message', (event) => {
    // Validate origin nếu được cấu hình
    if (parentOrigin && event.origin !== parentOrigin && parentOrigin !== '*') {
      console.warn('[SCORM Player] Blocked unauthorized postMessage origin:', event.origin);
      return;
    }

    const { type, payload } = event.data || {};
    if (type === 'PING') {
      if (event.source && event.origin) {
        event.source.postMessage({ type: 'PONG', payload: { status: 'READY', version: scormVersion } }, event.origin);
      }
    }
  });

  // 5. Nạp bài giảng vào Content Frame
  if (contentFrame) {
    contentFrame.onload = () => {
      console.log('🎯 [SCORM Player] SCO Content loaded successfully into frame.');
      if (loadingOverlay) loadingOverlay.style.display = 'none';

      // Thông báo cho Parent Window qua postMessage (nếu có)
      if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
        window.parent.postMessage({ type: 'SCORM_LOADED', payload: { launchUrl } }, parentOrigin);
      }
    };

    contentFrame.onerror = (err) => {
      console.error('❌ [SCORM Player] Failed to load SCO content:', err);
      if (loadingOverlay) loadingOverlay.style.display = 'none';
      if (errorOverlay && errorMessage) {
        errorMessage.textContent = 'Không thể tải nội dung bài giảng.';
        errorOverlay.style.display = 'flex';
      }
    };

    // Thiết lập URL cho frame
    contentFrame.src = decodeURIComponent(launchUrl);
  }
})();
