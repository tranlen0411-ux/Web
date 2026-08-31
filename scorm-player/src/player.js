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

  // 6. Nạp bài giảng vào Content Frame & Resume Stuck Detector (Content-Readiness)
  let hasSentStuckMessage = false;

  function inspectContentState(frameDoc, frameWin) {
    if (!frameDoc || !frameWin) {
      return {
        slideViewCount: 0,
        visibleSlideViewCount: 0,
        quizCanvasCount: 0,
        visibleQuizCanvasCount: 0,
        buttonCount: 0,
        relevantButtonCount: 0,
        navigationShellPresent: false,
      };
    }

    // 1. .slideView analysis
    const slideViews = frameDoc.querySelectorAll('.slideView');
    const slideViewCount = slideViews ? slideViews.length : 0;
    let visibleSlideViewCount = 0;

    if (slideViews && slideViews.length > 0) {
      for (let i = 0; i < slideViews.length; i++) {
        const sv = slideViews[i];
        const s = frameWin.getComputedStyle(sv);
        const r = sv.getBoundingClientRect();
        const ariaHidden = sv.getAttribute('aria-hidden') || 'null';
        const isVisible = (
          s.display !== 'none' &&
          s.visibility !== 'hidden' &&
          ariaHidden !== 'true' &&
          (r.width > 0 || r.height > 0 || sv.offsetWidth > 0 || sv.offsetHeight > 0)
        );
        if (isVisible) visibleSlideViewCount++;
      }
    }

    // 2. Quiz Canvas analysis
    const quizCanvases = frameDoc.querySelectorAll('canvas.quizCanvas, canvas, [class*="quiz"]');
    const quizCanvasCount = quizCanvases ? quizCanvases.length : 0;
    let visibleQuizCanvasCount = 0;
    if (quizCanvases && quizCanvases.length > 0) {
      for (let i = 0; i < quizCanvases.length; i++) {
        const cv = quizCanvases[i];
        const cs = frameWin.getComputedStyle(cv);
        const cr = cv.getBoundingClientRect();
        if (
          cs.display !== 'none' &&
          cs.visibility !== 'hidden' &&
          (cr.width > 0 || cr.height > 0 || cv.offsetWidth > 0 || cv.offsetHeight > 0)
        ) {
          visibleQuizCanvasCount++;
        }
      }
    }

    // 3. Navigation & Button analysis (Submit, Next, Prev, Previous, etc.)
    const allButtons = frameDoc.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a.btn, [class*="button"], [class*="btn"]');
    const buttonCount = allButtons ? allButtons.length : 0;
    const relevantButtons = [];
    const navPatterns = /submit|nộp|next|tiếp|prev|previous|quay lại|trước|start|bắt đầu|finish|hoàn thành/i;

    if (allButtons && allButtons.length > 0) {
      for (let i = 0; i < allButtons.length; i++) {
        const btn = allButtons[i];
        const text = (btn.innerText || btn.textContent || btn.value || '').trim().substring(0, 30);
        const ariaLabel = (btn.getAttribute('aria-label') || btn.getAttribute('title') || '').trim();
        const combined = `${text} ${ariaLabel} ${btn.className}`;

        if (navPatterns.test(combined)) {
          relevantButtons.push(btn);
        }
      }
    }

    const navigationShellPresent = (relevantButtons.length > 0) || (buttonCount >= 2);

    return {
      slideViewCount,
      visibleSlideViewCount,
      quizCanvasCount,
      visibleQuizCanvasCount,
      buttonCount,
      relevantButtonCount: relevantButtons.length,
      navigationShellPresent,
    };
  }

  if (contentFrame) {
    contentFrame.onload = () => {
      console.log('🎯 [SCORM Player] SCO Content loaded successfully into frame from Same-Origin Gateway.');
      if (loadingOverlay) loadingOverlay.style.display = 'none';

      if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
        window.parent.postMessage({ type: 'SCORM_LOADED', payload: { scoUrl: finalScoUrl } }, parentOrigin);
      }

      // Bounded polling kiểm tra trạng thái Resume Stuck (250ms mỗi lần, tối đa 4 giây)
      const is2004 = scormVersion === '2004' || String(scormVersion).startsWith('2004');
      const activeApi = is2004 ? window.API_1484_11 : window.API;
      const initialEntry = activeApi?._getCmi ? (activeApi._getCmi()['cmi.entry'] || activeApi._getCmi()['cmi.core.entry']) : '';
      const isResume = (initialEntry === 'resume' || (persistedTracking && Object.keys(persistedTracking).length > 0));

      if (isResume) {
        let pollCount = 0;
        const maxPolls = 16; // 16 * 250ms = 4000ms (4 seconds max)
        const pollInterval = 250;

        const checkResumeStuck = () => {
          if (hasSentStuckMessage) return;

          pollCount++;
          const currentFrameWin = contentFrame.contentWindow;
          const currentFrameDoc = contentFrame.contentDocument || currentFrameWin?.document;

          if (!currentFrameDoc || !currentFrameWin) {
            if (pollCount < maxPolls) {
              setTimeout(checkResumeStuck, pollInterval);
            }
            return;
          }

          const state = inspectContentState(currentFrameDoc, currentFrameWin);

          // Content được coi là READY nếu có ít nhất một visible .slideView HOẶC visible quiz canvas
          const isContentReady = (state.visibleSlideViewCount > 0 || state.visibleQuizCanvasCount > 0);

          if (isContentReady) {
            // Đã có nội dung visible -> Layout hoạt động tốt, KHÔNG gửi stuck
            return;
          }

          // Chưa có nội dung hiển thị: Tiếp tục poll cho đến khi hết giới hạn bounded polling
          if (pollCount < maxPolls) {
            setTimeout(checkResumeStuck, pollInterval);
            return;
          }

          // Bounded polling kết thúc (pollCount >= maxPolls) mà:
          // isResume = true
          // navigationShellPresent = true
          // visibleSlideViewCount = 0
          // visibleQuizCanvasCount = 0
          // -> Coi là content stuck và gửi SCORM_RESUME_LAYOUT_STUCK đúng 1 lần
          if (isResume && state.navigationShellPresent && state.visibleSlideViewCount === 0 && state.visibleQuizCanvasCount === 0) {
            hasSentStuckMessage = true;
            console.log('🔄 [SCORM Player] Resume stuck detected (navigation shell present, 0 visible content). Sending SCORM_RESUME_LAYOUT_STUCK to parent...');

            if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
              window.parent.postMessage({ type: 'SCORM_RESUME_LAYOUT_STUCK' }, parentOrigin);
            }
          }
        };

        setTimeout(checkResumeStuck, pollInterval);
      }
    };

    contentFrame.onerror = (err) => {
      console.error('❌ [SCORM Player] Failed to load SCO content frame:', err);
      showError('Không thể tải nội dung bài giảng qua Gateway.');
    };

    // Nạp đường dẫn cùng Origin B
    contentFrame.src = finalScoUrl;
  }
})();
