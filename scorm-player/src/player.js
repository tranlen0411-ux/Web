import { createScorm12Api, createScorm2004Api } from './scormApi.js';

/**
 * SCORM Player Bootstrap (Isolated Origin App - Port 4174)
 * Khởi tạo môi trường runtime và nạp SCO Content qua Authorized Asset Gateway (/session/<token>/...)
 */
(async function initScormPlayer() {
  console.log('🎮 [SCORM Player] Initializing Isolated Player Module (Port 4174)...');

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

  // 2. Truy vấn thông tin phiên học từ Gateway
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

  // 3. Khởi tạo và gắn SCORM API vào Window của Player
  const initialData = { studentName, tracking: persistedTracking };
  const api12 = createScorm12Api(initialData);
  const api2004 = createScorm2004Api(initialData);

  window.API = api12;
  window.API_1484_11 = api2004;

  console.log(`✅ [SCORM Player] Attached window.API (1.2) and window.API_1484_11 (2004). Target: ${scormVersion}`);

  // 4. Lắng nghe thông điệp postMessage từ parent một cách an toàn
  window.addEventListener('message', (event) => {
    if (parentOrigin && event.origin !== parentOrigin && parentOrigin !== '*') {
      console.warn('[SCORM Player] Blocked unauthorized postMessage origin:', event.origin);
      return;
    }

    const { type } = event.data || {};
    if (type === 'PING') {
      if (event.source && event.origin) {
        event.source.postMessage({ type: 'PONG', payload: { status: 'READY', version: scormVersion } }, event.origin);
      }
    }
  });

  // 5. Nạp bài giảng vào Content Frame & Cơ chế kích hoạt Resume Stuck
  let hasSentStuckMessage = false;

  function getSlideViewState(frameDoc, frameWin) {
    if (!frameDoc || !frameWin) return 'NO_DOC';
    const sv = frameDoc.querySelector('.slideView, [class*="slideView"], [class*="slide"]');
    if (!sv) return 'NOT_FOUND';
    const s = frameWin.getComputedStyle(sv);
    const r = sv.getBoundingClientRect();
    const ariaHidden = sv.getAttribute('aria-hidden');
    return `class="${sv.className}" display="${s.display}" vis="${s.visibility}" aria-hidden="${ariaHidden}" rect=${Math.round(r.width)}x${Math.round(r.height)}`;
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

    console.log(`[SCORM Player] PLAYER_WINDOW_INNER_WIDTH_DURING=${window.innerWidth}`);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        console.log(`[SCORM Player] PLAYER_WINDOW_INNER_WIDTH_AFTER=${window.innerWidth}`);
        const stateAfter = getSlideViewState(frameDoc, frameWin);
        const quizVis = checkIsQuizVisible(frameDoc);
        console.log(`[SCORM Player] SLIDEVIEW_STATE_AFTER=${stateAfter}`);
        console.log(`[SCORM Player] QUIZ_VISIBLE_AFTER=${quizVis ? 'YES' : 'NO'}`);
      });
    });
  });

  if (contentFrame) {
    contentFrame.onload = () => {
      console.log('🎯 [SCORM Player] SCO Content loaded successfully into frame from Same-Origin Gateway.');
      if (loadingOverlay) loadingOverlay.style.display = 'none';

      if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
        window.parent.postMessage({ type: 'SCORM_LOADED', payload: { scoUrl: finalScoUrl } }, parentOrigin);
      }

      // Kiểm tra trạng thái Resume Stuck sau 1 giây
      const is2004 = scormVersion === '2004' || String(scormVersion).startsWith('2004');
      const activeApi = is2004 ? window.API_1484_11 : window.API;
      const initialEntry = activeApi?._getCmi ? (activeApi._getCmi()['cmi.entry'] || activeApi._getCmi()['cmi.core.entry']) : '';
      const isResume = (initialEntry === 'resume' || (persistedTracking && Object.keys(persistedTracking).length > 0));

      if (isResume) {
        setTimeout(() => {
          if (hasSentStuckMessage) return;

          const frameWin = contentFrame.contentWindow;
          const frameDoc = contentFrame.contentDocument || frameWin?.document;
          if (!frameDoc || !frameWin) return;

          const sv = frameDoc.querySelector('.slideView, [class*="slideView"], [class*="slide"]');
          if (sv) {
            const s = frameWin.getComputedStyle(sv);
            const r = sv.getBoundingClientRect();
            const ariaHidden = sv.getAttribute('aria-hidden');
            const isStuck = (s.display === 'none' || ariaHidden === 'true' || r.width === 0 || r.height === 0);

            if (isStuck) {
              hasSentStuckMessage = true;
              console.log(`[SCORM Player] PLAYER_WINDOW_INNER_WIDTH_BEFORE=${window.innerWidth}`);
              console.log(`[SCORM Player] SLIDEVIEW_STATE_BEFORE=${getSlideViewState(frameDoc, frameWin)}`);
              console.log('[SCORM Player] Sending SCORM_RESUME_LAYOUT_STUCK to parent...');

              if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
                window.parent.postMessage({ type: 'SCORM_RESUME_LAYOUT_STUCK' }, parentOrigin);
              }
            }
          }
        }, 1000);
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
