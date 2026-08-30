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

    if (window.parent && window.parent !== window && event.source !== window.parent) {
      console.warn('[SCORM Player] Blocked unauthorized postMessage source (not window.parent)');
      return;
    }

    const { type, payload } = event.data || {};
    if (type === 'PING') {
      if (event.source && event.origin) {
        event.source.postMessage({ type: 'PONG', payload: { status: 'READY', version: scormVersion } }, event.origin);
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

  // 6. Chờ nhận persisted CMI state từ Parent (nếu có nhúng trong iframe) TRƯỚC KHI nạp SCO content
  async function waitForInitialCmiState() {
    // Nếu chạy độc lập không có parent hoặc parentOrigin không thiết lập
    if (!window.parent || window.parent === window || !parentOrigin || parentOrigin === '*') {
      if (persistedTracking) {
        console.log('[SCORM DIAG] persisted state received');
        const is2004 = scormVersion === '2004' || String(scormVersion).startsWith('2004');
        const activeApi = is2004 ? window.API_1484_11 : window.API;
        if (activeApi && typeof activeApi._restoreCmi === 'function') {
          activeApi._restoreCmi(persistedTracking);
        }
        console.log('[SCORM DIAG] persisted state applied before SCO load');
      }
      return;
    }

    return new Promise((resolve) => {
      let resolved = false;

      const messageListener = (event) => {
        if (event.origin !== parentOrigin && parentOrigin !== '*') return;
        if (event.source !== window.parent) return;

        const { type, payload } = event.data || {};
        if (type === 'INITIAL_CMI_STATE' || type === 'RESTORE_CMI') {
          if (!resolved) {
            resolved = true;
            window.removeEventListener('message', messageListener);
            console.log('[SCORM DIAG] persisted state received');

            if (payload && payload.tracking) {
              const is2004 = scormVersion === '2004' || String(scormVersion).startsWith('2004');
              const activeApi = is2004 ? window.API_1484_11 : window.API;
              if (activeApi && typeof activeApi._restoreCmi === 'function') {
                activeApi._restoreCmi(payload.tracking);
              }
              console.log('[SCORM DIAG] persisted state applied before SCO load');
            } else {
              console.log('[SCORM DIAG] persisted state applied before SCO load (ab-initio)');
            }
            resolve();
          }
        }
      };

      window.addEventListener('message', messageListener);

      // Gửi tín hiệu sẵn sàng nhận initial state lên parent
      window.parent.postMessage(
        {
          type: 'PLAYER_READY_FOR_INITIAL_STATE',
          payload: { version: scormVersion },
        },
        parentOrigin
      );

      // Phòng vệ timeout tối đa 800ms nếu parent không phản hồi (ví dụ standalone hoặc parent cũ)
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('message', messageListener);
          if (persistedTracking) {
            console.log('[SCORM DIAG] persisted state received');
            const is2004 = scormVersion === '2004' || String(scormVersion).startsWith('2004');
            const activeApi = is2004 ? window.API_1484_11 : window.API;
            if (activeApi && typeof activeApi._restoreCmi === 'function') {
              activeApi._restoreCmi(persistedTracking);
            }
            console.log('[SCORM DIAG] persisted state applied before SCO load');
          } else {
            console.log('[SCORM DIAG] persisted state applied before SCO load (ab-initio)');
          }
          resolve();
        }
      }, 800);
    });
  }

  await waitForInitialCmiState();

  const is2004 = scormVersion === '2004' || String(scormVersion).startsWith('2004');
  const activeApi = is2004 ? window.API_1484_11 : window.API;
  const initialCmi = activeApi && typeof activeApi._getCmi === 'function' ? activeApi._getCmi() : {};
  const initialLoc = is2004 ? (initialCmi['cmi.location'] || '') : (initialCmi['cmi.core.lesson_location'] || '');
  const initialSusData = initialCmi['cmi.suspend_data'] || '';

  console.log(`[SCORM DIAG] initial cmi.location=${initialLoc}`);
  console.log(`[SCORM DIAG] initial suspend_data length=${initialSusData.length}`);
  console.log('[SCORM DIAG] SCO load allowed');

  // Bắt lỗi tài nguyên mạng và ngoại lệ JavaScript toàn cục trên Player Window
  window.addEventListener('error', (event) => {
    if (event.target && event.target !== window && (event.target.src || event.target.href)) {
      console.warn(`[SCORM DIAG] Resource load failed: <${event.target.tagName.toLowerCase()}> ${event.target.src || event.target.href}`);
    } else if (event.message) {
      console.error(`[SCORM DIAG] JS Exception: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`);
    }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[SCORM DIAG] Unhandled Rejection:', event.reason);
  });

  // 7. Nạp bài giảng vào Content Frame và kích hoạt bộ chẩn đoán Quiz Controls & Repaint Monitor
  if (contentFrame) {
    function diagnoseQuizDom(triggerLabel = 'Snapshot') {
      try {
        const frameWin = contentFrame.contentWindow;
        const frameDoc = contentFrame.contentDocument || frameWin?.document;
        const vpSize = `${window.innerWidth}x${window.innerHeight}`;
        const frameClient = `${contentFrame.clientWidth}x${contentFrame.clientHeight}`;
        const frameOffset = `${contentFrame.offsetWidth}x${contentFrame.offsetHeight}`;

        console.log(`[SCORM DIAG] [${triggerLabel}] viewport/frame size=viewport:${vpSize} frameClient:${frameClient} frameOffset:${frameOffset}`);

        if (!frameDoc || !frameDoc.body) {
          console.log(`[SCORM DIAG] [${triggerLabel}] frameDoc body not yet available`);
          return;
        }

        // Tìm tất cả các candidate elements trong frame
        const allElements = Array.from(frameDoc.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a, div, span, canvas, svg'));

        function inspectElementRole(keywords, roleName) {
          const candidates = allElements.filter((el) => {
            const text = (el.innerText || el.textContent || el.value || '').toLowerCase().trim();
            const aria = (el.getAttribute('aria-label') || '').toLowerCase().trim();
            const id = (el.id || '').toLowerCase();
            const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
            const title = (el.getAttribute('title') || '').toLowerCase();
            return keywords.some((k) => text.includes(k) || aria.includes(k) || id.includes(k) || cls.includes(k) || title.includes(k));
          });

          if (candidates.length === 0) {
            return { status: 'missing', summary: 'none found' };
          }

          // Lấy candidate nổi bật nhất
          const target = candidates[0];
          const style = frameWin ? frameWin.getComputedStyle(target) : {};
          const rect = target.getBoundingClientRect();
          const disabled = target.disabled === true || target.getAttribute('aria-disabled') === 'true' || (typeof target.className === 'string' && target.className.includes('disabled'));
          const display = style.display || 'unknown';
          const visibility = style.visibility || 'unknown';
          const opacity = style.opacity || '1';
          const pointerEvents = style.pointerEvents || 'auto';
          const zIndex = style.zIndex || 'auto';

          let status = 'normal';
          if (display === 'none' || visibility === 'hidden' || opacity === '0') {
            status = 'hidden';
          } else if (disabled) {
            status = 'disabled';
          } else if (rect.width === 0 || rect.height === 0) {
            status = 'zero-size';
          } else if (rect.bottom <= 0 || rect.top >= (contentFrame.clientHeight || window.innerHeight) || rect.right <= 0 || rect.left >= (contentFrame.clientWidth || window.innerWidth)) {
            status = 'offscreen';
          }

          const rectStr = `[${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}]`;
          const summary = `tag=<${target.tagName.toLowerCase()}> id=${target.id || '-'} text="${(target.innerText || target.textContent || '').trim().substring(0, 15)}" display=${display} vis=${visibility} op=${opacity} pe=${pointerEvents} zIndex=${zIndex} disabled=${disabled} rect=${rectStr}`;

          return { status, summary, target, disabled };
        }

        const submitDiag = inspectElementRole(['submit', 'nộp bài', 'gửi', 'trả lời', 'check', 'xác nhận', 'send'], 'submit');
        const nextDiag = inspectElementRole(['next', 'tiếp', 'sau', 'forward', 'continue', 'chevron-right', 'arrow-right'], 'next');
        const prevDiag = inspectElementRole(['prev', 'trước', 'lùi', 'back', 'chevron-left', 'arrow-left'], 'prev');

        console.log(`[SCORM DIAG] [${triggerLabel}] quiz controls DOM submit=<${submitDiag.status}> next=<${nextDiag.status}> prev=<${prevDiag.status}>`);
        console.log(`[SCORM DIAG] control computedStyle submit: ${submitDiag.summary}`);
        console.log(`[SCORM DIAG] control computedStyle next: ${nextDiag.summary}`);
        console.log(`[SCORM DIAG] control computedStyle prev: ${prevDiag.summary}`);

        // iSpring Object Inspector
        if (frameWin) {
          const ispringKeys = Object.keys(frameWin).filter((k) => /ispring|player|quiz|presentation|course/i.test(k));
          if (ispringKeys.length > 0) {
            console.log(`[SCORM DIAG] iSpring globals detected: ${ispringKeys.join(', ')}`);
          }
        }
      } catch (domErr) {
        console.warn(`[SCORM DIAG] [${triggerLabel}] DOM inspection note:`, domErr.message);
      }
    }

    function inspectFrameState(eventLabel = 'Frame event') {
      try {
        const frameWin = contentFrame.contentWindow;
        const frameDoc = contentFrame.contentDocument || frameWin?.document;
        const currentSrc = contentFrame.src || '';
        const currentHref = frameWin?.location?.href || 'unknown';
        const readyState = frameDoc?.readyState || 'unknown';

        console.log(`[SCORM DIAG] [${eventLabel}] frame.src=${currentSrc} frame.href=${currentHref} readyState=${readyState}`);

        if (currentHref === 'about:blank') {
          console.warn('[SCORM DIAG] WARNING: Frame has navigated or reset to about:blank!');
        }

        if (frameWin && !frameWin.__scorm_diag_attached) {
          frameWin.__scorm_diag_attached = true;

          frameWin.addEventListener('error', (e) => {
            if (e.target && e.target !== frameWin && (e.target.src || e.target.href)) {
              console.warn(`[SCORM DIAG] [Frame Resource Fail] <${e.target.tagName.toLowerCase()}> ${e.target.src || e.target.href}`);
            } else if (e.message) {
              console.error(`[SCORM DIAG] [Frame JS Exception] ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`);
            }
          }, true);

          frameWin.addEventListener('unhandledrejection', (e) => {
            console.error('[SCORM DIAG] [Frame Unhandled Rejection]', e.reason);
          });

          frameWin.addEventListener('beforeunload', () => {
            console.log(`[SCORM DIAG] Frame beforeunload: transitioning from ${frameWin.location.href}`);
          });

          frameWin.addEventListener('unload', () => {
            console.log('[SCORM DIAG] Frame unload triggered');
          });

          frameWin.addEventListener('resize', () => {
            console.log(`[SCORM DIAG] [Frame resize event] innerSize=${frameWin.innerWidth}x${frameWin.innerHeight}`);
            diagnoseQuizDom('Frame resize');
          });

          frameWin.addEventListener('focus', () => {
            console.log('[SCORM DIAG] [Frame focus event]');
            diagnoseQuizDom('Frame focus');
          });

          frameWin.addEventListener('click', () => {
            setTimeout(() => diagnoseQuizDom('Frame click + 300ms'), 300);
            setTimeout(() => diagnoseQuizDom('Frame click + 1000ms'), 1000);
          });
        }
      } catch (inspectErr) {
        console.warn('[SCORM DIAG] Frame inspection note:', inspectErr.message);
      }
    }

    // Lắng nghe các sự kiện repaint/resize/visibility trên player window
    window.addEventListener('resize', () => {
      console.log(`[SCORM DIAG] [Window resize event] size=${window.innerWidth}x${window.innerHeight}`);
      diagnoseQuizDom('Window resize');
    });

    document.addEventListener('visibilitychange', () => {
      console.log(`[SCORM DIAG] [VisibilityChange event] state=${document.visibilityState}`);
      diagnoseQuizDom(`Visibility ${document.visibilityState}`);
    });

    window.addEventListener('focus', () => {
      console.log('[SCORM DIAG] [Window focus event]');
      diagnoseQuizDom('Window focus');
    });

    window.addEventListener('click', () => {
      setTimeout(() => diagnoseQuizDom('Window click + 300ms'), 300);
      setTimeout(() => diagnoseQuizDom('Window click + 1000ms'), 1000);
    });

    contentFrame.onload = () => {
      console.log('🎯 [SCORM Player] SCO Content loaded successfully into frame from Same-Origin Gateway.');
      inspectFrameState('onload');
      diagnoseQuizDom('onload T+0');

      if (loadingOverlay) loadingOverlay.style.display = 'none';

      if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
        window.parent.postMessage({ type: 'SCORM_LOADED', payload: { scoUrl: finalScoUrl } }, parentOrigin);
      }

      // Schedule interval diagnostics để bắt trạng thái sau khi user bấm YES Resume
      setTimeout(() => diagnoseQuizDom('Post-load T+1s'), 1000);
      setTimeout(() => diagnoseQuizDom('Post-load T+2s'), 2000);
      setTimeout(() => diagnoseQuizDom('Post-load T+4s'), 4000);
      setTimeout(() => diagnoseQuizDom('Post-load T+7s'), 7000);
    };

    contentFrame.onerror = (err) => {
      console.error('❌ [SCORM Player] Failed to load SCO content frame:', err);
      inspectFrameState('onerror');
      showError('Không thể tải nội dung bài giảng qua Gateway.');
    };

    // Nạp đường dẫn cùng Origin B
    contentFrame.src = finalScoUrl;
  }
})();
