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

  // 6. Nạp bài giảng vào Content Frame & Diagnostic Instrumentation
  const RUN_ID = 'run_' + Math.random().toString(36).substring(2, 9);
  let hasSentStuckMessage = false;

  function logDiagnosticState(stage, frameDoc, frameWin) {
    const playerWidth = window.innerWidth;
    const playerHeight = window.innerHeight;

    if (!frameDoc || !frameWin) {
      console.log(`[SCORM_DIAG] RUN_ID=${RUN_ID} STAGE=${stage} PLAYER_INNER_WIDTH=${playerWidth} PLAYER_INNER_HEIGHT=${playerHeight} NO_FRAME_DOC`);
      return;
    }

    // 1. .slideView analysis
    const slideViews = frameDoc.querySelectorAll('.slideView');
    const slideViewCount = slideViews ? slideViews.length : 0;
    let visibleSlideViewCount = 0;
    const slideViewDetails = [];

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

        slideViewDetails.push(
          `[#${i}: class="${sv.className}" display="${s.display}" vis="${s.visibility}" opacity="${s.opacity}" aria-hidden="${ariaHidden}" rect=${Math.round(r.width)}x${Math.round(r.height)} offset=${sv.offsetWidth}x${sv.offsetHeight}]`
        );
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
        if (cs.display !== 'none' && cs.visibility !== 'hidden' && (cr.width > 0 || cr.height > 0)) {
          visibleQuizCanvasCount++;
        }
      }
    }

    // 3. Button analysis (Submit, Next, Prev, Previous)
    const allButtons = frameDoc.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a.btn, [class*="button"], [class*="btn"]');
    const buttonCount = allButtons ? allButtons.length : 0;
    const relevantButtons = [];

    const navPatterns = /submit|nộp|next|tiếp|prev|previous|quay lại|trước/i;

    if (allButtons && allButtons.length > 0) {
      for (let i = 0; i < allButtons.length; i++) {
        const btn = allButtons[i];
        const text = (btn.innerText || btn.textContent || btn.value || '').trim().substring(0, 30);
        const ariaLabel = (btn.getAttribute('aria-label') || btn.getAttribute('title') || '').trim();
        const combined = `${text} ${ariaLabel} ${btn.className}`;

        if (navPatterns.test(combined)) {
          const bs = frameWin.getComputedStyle(btn);
          const br = btn.getBoundingClientRect();
          const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
          const label = ariaLabel || text || btn.className;
          relevantButtons.push(
            `[btn="${label}" display="${bs.display}" vis="${bs.visibility}" disabled=${disabled} size=${Math.round(br.width)}x${Math.round(br.height)}]`
          );
        }
      }
    }

    console.log(
      `[SCORM_DIAG] RUN_ID=${RUN_ID} STAGE=${stage} PLAYER_INNER_WIDTH=${playerWidth} PLAYER_INNER_HEIGHT=${playerHeight} SLIDEVIEW_COUNT=${slideViewCount} VISIBLE_SLIDEVIEW_COUNT=${visibleSlideViewCount} QUIZ_CANVAS_COUNT=${quizCanvasCount} VISIBLE_QUIZ_CANVAS_COUNT=${visibleQuizCanvasCount} BUTTON_COUNT=${buttonCount}`
    );
    if (slideViewDetails.length > 0) {
      console.log(`[SCORM_DIAG_SLIDEVIEWS] RUN_ID=${RUN_ID} STAGE=${stage} ${slideViewDetails.join(' | ')}`);
    }
    if (relevantButtons.length > 0) {
      console.log(`[SCORM_DIAG_BUTTONS] RUN_ID=${RUN_ID} STAGE=${stage} ${relevantButtons.join(' | ')}`);
    }
  }

  function getSlideViewState(frameDoc, frameWin) {
    if (!frameDoc || !frameWin) return 'NO_DOC';
    const svList = frameDoc.querySelectorAll('.slideView');
    if (!svList || svList.length === 0) return 'NOT_FOUND';
    const firstSv = svList[0];
    const s = frameWin.getComputedStyle(firstSv);
    const r = firstSv.getBoundingClientRect();
    const ariaHidden = firstSv.getAttribute('aria-hidden');
    return `count=${svList.length} class="${firstSv.className}" display="${s.display}" vis="${s.visibility}" aria-hidden="${ariaHidden}" rect=${Math.round(r.width)}x${Math.round(r.height)}`;
  }

  function checkIsQuizVisible(frameDoc) {
    if (!frameDoc) return false;
    const canvas = frameDoc.querySelector('canvas.quizCanvas, canvas, [class*="quiz"]');
    if (!canvas) return false;
    const r = canvas.getBoundingClientRect();
    return r.width > 10 && r.height > 10;
  }

  // Lắng nghe sự kiện resize của window do outer iframe thay đổi geometry
  window.addEventListener('resize', () => {
    const frameWin = contentFrame?.contentWindow;
    const frameDoc = contentFrame?.contentDocument || frameWin?.document;

    logDiagnosticState('WINDOW_RESIZE_EVENT', frameDoc, frameWin);
    console.log(`[SCORM Player] PLAYER_WINDOW_INNER_WIDTH_DURING=${window.innerWidth}`);

    requestAnimationFrame(() => {
      logDiagnosticState('RESIZE_RAF1', frameDoc, frameWin);
      requestAnimationFrame(() => {
        logDiagnosticState('RESIZE_RAF2', frameDoc, frameWin);
        console.log(`[SCORM Player] PLAYER_WINDOW_INNER_WIDTH_AFTER=${window.innerWidth}`);
        const stateAfter = getSlideViewState(frameDoc, frameWin);
        const quizVis = checkIsQuizVisible(frameDoc);
        console.log(`[SCORM Player] SLIDEVIEW_STATE_AFTER=${stateAfter}`);
        console.log(`[SCORM Player] QUIZ_VISIBLE_AFTER=${quizVis ? 'YES' : 'NO'}`);

        setTimeout(() => {
          logDiagnosticState('RESIZE_AFTER_100MS', frameDoc, frameWin);
        }, 100);
      });
    });
  });

  if (contentFrame) {
    contentFrame.onload = () => {
      console.log('🎯 [SCORM Player] SCO Content loaded successfully into frame from Same-Origin Gateway.');
      if (loadingOverlay) loadingOverlay.style.display = 'none';

      const frameWin = contentFrame.contentWindow;
      const frameDoc = contentFrame.contentDocument || frameWin?.document;
      logDiagnosticState('SCO_ONLOAD', frameDoc, frameWin);

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

          logDiagnosticState(`POLL_${pollCount}`, currentFrameDoc, currentFrameWin);

          if (!currentFrameDoc || !currentFrameWin) {
            if (pollCount < maxPolls) {
              setTimeout(checkResumeStuck, pollInterval);
            }
            return;
          }

          // Query tất cả .slideView (chính xác selector .slideView, không dùng [class*="slide"])
          const slideViews = currentFrameDoc.querySelectorAll('.slideView');
          if (!slideViews || slideViews.length === 0) {
            // Chưa có .slideView trong DOM, tiếp tục kiểm tra trong khoảng thời gian hữu hạn
            if (pollCount < maxPolls) {
              setTimeout(checkResumeStuck, pollInterval);
            }
            return;
          }

          // Kiểm tra xem có ít nhất một .slideView visible và kích thước > 0 hay không
          let hasVisibleSlideView = false;
          for (let i = 0; i < slideViews.length; i++) {
            const sv = slideViews[i];
            const s = currentFrameWin.getComputedStyle(sv);
            const r = sv.getBoundingClientRect();
            const ariaHidden = sv.getAttribute('aria-hidden');

            const isHidden = (
              s.display === 'none' ||
              s.visibility === 'hidden' ||
              ariaHidden === 'true' ||
              (r.width === 0 && r.height === 0) ||
              sv.offsetWidth === 0 ||
              sv.offsetHeight === 0
            );

            if (!isHidden) {
              hasVisibleSlideView = true;
              break;
            }
          }

          if (hasVisibleSlideView) {
            // Đã có ít nhất một .slideView visible và kích thước > 0 -> Layout hoạt động tốt, KHÔNG pulse
            logDiagnosticState('DECISION_VISIBLE_NO_PULSE', currentFrameDoc, currentFrameWin);
            console.log('[SCORM Player] Visible .slideView detected, layout active. No pulse needed.');
            return;
          }

          // Đã có .slideView nhưng TẤT CẢ đều bị ẩn (display:none, visibility:hidden, aria-hidden=true hoặc 0x0)
          // -> Gửi SCORM_RESUME_LAYOUT_STUCK một lần duy nhất (one-shot guard)
          hasSentStuckMessage = true;
          logDiagnosticState('DECISION_SEND_STUCK', currentFrameDoc, currentFrameWin);
          console.log(`[SCORM Player] PLAYER_WINDOW_INNER_WIDTH_BEFORE=${window.innerWidth}`);
          console.log(`[SCORM Player] SLIDEVIEW_STATE_BEFORE=${getSlideViewState(currentFrameDoc, currentFrameWin)}`);
          console.log('[SCORM Player] Resume stuck detected (all .slideView hidden/0x0). Sending SCORM_RESUME_LAYOUT_STUCK to parent...');

          if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
            window.parent.postMessage({ type: 'SCORM_RESUME_LAYOUT_STUCK' }, parentOrigin);
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
