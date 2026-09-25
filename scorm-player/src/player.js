import { createScorm12Api, createScorm2004Api } from './scormApi.js';

/**
 * SCORM Player Bootstrap (Isolated Origin App - Port 4174)
 * Khởi tạo môi trường runtime, nạp dữ liệu tiến độ đã lưu (Resume),
 * và đồng bộ trạng thái học tập (CMI Commit/Finish/Terminate) an toàn.
 */
(async function initScormPlayer() {
  console.log('🎮 [SCORM Player] Initializing Isolated Player Module with CMI Persistence (Port 4174)...');

  // 1. Phân tích tham số khởi chạy từ Query Params
  const urlParams = new URLSearchParams(window.location.search);
  const sessionToken = urlParams.get('session') || '';
  const explicitLaunch = urlParams.get('launch') || '';
  const studentName = urlParams.get('studentName') || 'Học sinh';
  const parentOrigin = urlParams.get('parentOrigin') || '';
  let scormVersion = urlParams.get('version') || '1.2';

  const contentFrame = document.getElementById('scorm-content-frame');
  const loadingOverlay = document.getElementById('loading-overlay');
  const errorOverlay = document.getElementById('error-overlay');
  const errorMessage = document.getElementById('error-message');

  function showError(msg) {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    if (errorOverlay && errorMessage) {
      errorMessage.textContent = msg;
      errorOverlay.style.display = 'flex';
    }
  }

  if (!sessionToken && !explicitLaunch) {
    showError('Không tìm thấy phiên học (Session Token) hoặc đường dẫn khởi chạy.');
    return;
  }

  let persistedTracking = null;
  let finalScoUrl = '';

  // 2. Truy vấn thông tin phiên học và trạng thái tiến độ đã lưu
  if (sessionToken) {
    try {
      const infoRes = await fetch(`/session-info?session=${encodeURIComponent(sessionToken)}`);
      if (!infoRes.ok) {
        throw new Error(`Phiên học không hợp lệ hoặc đã hết hạn (HTTP ${infoRes.status})`);
      }
      const infoData = await infoRes.json();
      if (!infoData.valid) {
        throw new Error(infoData.message || 'Phiên học đã hết hạn hoặc bị thu hồi.');
      }

      scormVersion = infoData.scorm_version || scormVersion;
      persistedTracking = infoData.tracking || null;

      const resolvedLaunchPath = (infoData.launch_path || explicitLaunch || 'index.html').replace(/^\/+/, '');
      finalScoUrl = `/session/${encodeURIComponent(sessionToken)}/${resolvedLaunchPath}`;
    } catch (err) {
      if (explicitLaunch) {
        finalScoUrl = `/session/${encodeURIComponent(sessionToken)}/${explicitLaunch.replace(/^\/+/, '')}`;
      } else {
        showError(err.message || 'Lỗi khi xác thực phiên học SCORM với Gateway.');
        return;
      }
    }
  } else {
    finalScoUrl = explicitLaunch;
  }

  // 3. Hàm callback xử lý Commit / Finish / Terminate ngầm
  function handleCmiCommit(cmiSnapshot, eventType) {
    // Thông báo trạng thái học tập về Main Application qua PostMessage an toàn
    if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
      try {
        window.parent.postMessage(
          {
            type: 'SCORM_CMI_COMMIT',
            payload: {
              event: eventType,
              scormVersion,
              cmi: cmiSnapshot,
              timestamp: new Date().toISOString(),
            },
          },
          parentOrigin
        );
      } catch (postErr) {
        console.warn('[SCORM Player] postMessage to parent failed:', postErr.message);
      }
    }
  }

  // 4. Khởi tạo và gắn SCORM API vào Window của Player
  const initialData = {
    studentName,
    tracking: persistedTracking,
  };

  const api12 = createScorm12Api(initialData, handleCmiCommit);
  const api2004 = createScorm2004Api(initialData, handleCmiCommit);

  window.API = api12;
  window.API_1484_11 = api2004;

  console.log(`✅ [SCORM Player] Attached window.API (1.2) and window.API_1484_11 (2004). Target: ${scormVersion}`);

  // 5. Lắng nghe thông điệp postMessage từ parent
  window.addEventListener('message', (event) => {
    if (parentOrigin && event.origin !== parentOrigin && parentOrigin !== '*') {
      console.warn('[SCORM Player] Blocked unauthorized postMessage origin:', event.origin);
      return;
    }

    const { type, payload } = event.data || {};
    if (type === 'PING') {
      if (event.source && event.origin) {
        event.source.postMessage({ type: 'PONG', payload: { status: 'READY', version: scormVersion } }, event.origin);
      }
    } else if (type === 'RESTORE_CMI') {
      if (payload && payload.tracking) {
        console.log('🔄 [SCORM Player] Dynamic CMI state restored via postMessage payload');
      }
    } else if (type === 'SCORM_REQUEST_SAVE_BEFORE_CLOSE') {
      try {
        const is2004 = scormVersion === '2004' || String(scormVersion).startsWith('2004');
        const activeApi = is2004 ? window.API_1484_11 : window.API;

        if (activeApi && typeof activeApi._getCmi === 'function') {
          const snapshot = activeApi._getCmi();
          handleCmiCommit(snapshot, 'PARENT_CLOSE_SNAPSHOT');
        } else {
          if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
            window.parent.postMessage(
              {
                type: 'SCORM_CLOSE_SNAPSHOT_FAILED',
                payload: { error: 'API_GET_CMI_NOT_AVAILABLE', scormVersion },
              },
              parentOrigin
            );
          }
        }
      } catch (snapErr) {
        console.warn('[SCORM Player] Failed to capture snapshot before close:', snapErr.message);
        if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
          window.parent.postMessage(
            {
              type: 'SCORM_CLOSE_SNAPSHOT_FAILED',
              payload: { error: snapErr.message, scormVersion },
            },
            parentOrigin
          );
        }
      }
    }
  });

  // 6. Micro-Geometry Activation Engine (Kích hoạt tính toán layout iSpring 1 lần an toàn)
  let hasGeometryNudgeExecuted = false;
  let layoutObserver = null;
  let rafId1 = null;
  let rafId2 = null;

  function cleanupLayoutActivation() {
    if (layoutObserver) {
      layoutObserver.disconnect();
      layoutObserver = null;
    }
    if (rafId1) {
      cancelAnimationFrame(rafId1);
      rafId1 = null;
    }
    if (rafId2) {
      cancelAnimationFrame(rafId2);
      rafId2 = null;
    }
  }

  function executeMicroGeometryNudge() {
    if (hasGeometryNudgeExecuted || !contentFrame) return;
    hasGeometryNudgeExecuted = true;
    cleanupLayoutActivation();

    const originalWidth = contentFrame.style.width || '';
    const originalMaxWidth = contentFrame.style.maxWidth || '';

    // rAF 1: Tạo độ lệch kích thước thật đúng 1px
    rafId1 = requestAnimationFrame(() => {
      if (!contentFrame) return;
      contentFrame.style.width = 'calc(100% - 1px)';

      // rAF 2: Hoàn trả chính xác 100% style ban đầu sau khi browser trigger viewport resize event
      rafId2 = requestAnimationFrame(() => {
        if (!contentFrame) return;
        contentFrame.style.width = originalWidth;
        contentFrame.style.maxWidth = originalMaxWidth;
        console.log('📐 [SCORM Player] Micro-geometry layout activation completed successfully (1px delta reverted).');
      });
    });
  }

  function scheduleLayoutActivation() {
    if (hasGeometryNudgeExecuted || !contentFrame) return;

    const width = contentFrame.clientWidth;
    const height = contentFrame.clientHeight;

    // Nếu iframe đã có kích thước thực tế hợp lệ (> 1px) -> Thực thi ngay lập tức
    if (width > 1 && height > 0) {
      executeMicroGeometryNudge();
      return;
    }

    // Nếu chưa có kích thước (đang mount hoặc CSS transition) -> Dùng ResizeObserver đợi đo lường hợp lệ đầu tiên
    if (typeof ResizeObserver !== 'undefined') {
      cleanupLayoutActivation();
      layoutObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const cr = entry.contentRect;
          if (cr && cr.width > 1 && cr.height > 0) {
            executeMicroGeometryNudge();
            break;
          }
        }
      });
      layoutObserver.observe(contentFrame);
    } else {
      // Fallback nếu môi trường không có ResizeObserver
      executeMicroGeometryNudge();
    }
  }

  window.addEventListener('pagehide', cleanupLayoutActivation);
  window.addEventListener('beforeunload', cleanupLayoutActivation);

  // 7. Nạp bài giảng vào Content Frame
  if (contentFrame) {
    contentFrame.onload = () => {
      console.log('🎯 [SCORM Player] SCO Content loaded successfully into frame from Same-Origin Gateway.');
      if (loadingOverlay) loadingOverlay.style.display = 'none';

      if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
        window.parent.postMessage({ type: 'SCORM_LOADED', payload: { scoUrl: finalScoUrl } }, parentOrigin);
      }

      // Kích hoạt Micro-Geometry Layout Engine sau khi SCO hoàn tất nạp DOM
      scheduleLayoutActivation();
    };

    contentFrame.onerror = (err) => {
      console.error('❌ [SCORM Player] Failed to load SCO content frame:', err);
      showError('Không thể tải nội dung bài giảng qua Gateway.');
    };

    // Nạp đường dẫn cùng Origin B
    contentFrame.src = finalScoUrl;
  }
})();
