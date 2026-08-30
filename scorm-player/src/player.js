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

  // 7. Nạp bài giảng vào Content Frame và kích hoạt bộ chẩn đoán Nested Frames & Layout Reflow Monitor
  if (contentFrame) {
    let hasInitialReflowRun = false;
    let hasLoggedBeforeResize = false;
    let hasLoggedAfterResize = false;

    // 1. Quét đệ quy tất cả nested iframe/frame
    function enumerateNestedFrames(doc, depth = 1, prefix = 'nested frame') {
      if (!doc) return [];
      const iframes = Array.from(doc.querySelectorAll('iframe, frame'));
      let results = [];
      iframes.forEach((ifr, idx) => {
        try {
          const ifrWin = ifr.contentWindow;
          const ifrDoc = ifr.contentDocument || ifrWin?.document;
          const style = ifrWin ? ifrWin.getComputedStyle(ifr) : (doc.defaultView?.getComputedStyle(ifr) || {});
          const rect = ifr.getBoundingClientRect();
          const src = ifr.getAttribute('src') || ifr.src || '';
          const href = ifrWin?.location?.href || 'unknown';
          const readyState = ifrDoc?.readyState || 'unknown';
          const rectStr = `[${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}]`;

          results.push({ ifr, ifrWin, ifrDoc, depth, index: idx, rect, src, href });

          if (ifrDoc) {
            const deeper = enumerateNestedFrames(ifrDoc, depth + 1, `${prefix} #${depth}.${idx + 1} > nested frame`);
            results = results.concat(deeper);
          }
        } catch (nestErr) {
          // ignore
        }
      });
      return results;
    }

    // 2. Chụp Snapshot chính xác các Element trọng tâm (Target Elements)
    function logTargetElementSnapshot(stagePrefix, doc, win) {
      if (!doc || !doc.body) return;

      function getElementDetails(el, label) {
        if (!el) return `${label}=missing`;
        const rect = el.getBoundingClientRect();
        const style = win ? win.getComputedStyle(el) : {};
        const rectStr = `[${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}]`;
        const offsetStr = `${el.offsetWidth || 0}x${el.offsetHeight || 0}`;
        const clientStr = `${el.clientWidth || 0}x${el.clientHeight || 0}`;
        return `${label} rect=${rectStr} offset=${offsetStr} client=${clientStr} display=${style.display || 'unknown'} vis=${style.visibility || 'unknown'} op=${style.opacity || '1'} transform=${style.transform || 'none'} pos=${style.position || 'static'} overflow=${style.overflow || 'visible'}`;
      }

      // Quét .playerView
      const playerView = doc.querySelector('.playerView') || doc.querySelector('[class*="playerView"]') || doc.querySelector('[class*="player"]');
      console.log(`[SCORM TARGET] ${stagePrefix} playerView ${getElementDetails(playerView, '')}`);

      // Tìm button thật (loại trừ slidesBackground)
      const allButtons = Array.from(doc.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
      
      const nextBtn = allButtons.find(b => {
        const txt = (b.innerText || b.textContent || b.id || b.className || b.getAttribute('aria-label') || '').toLowerCase();
        return (txt.includes('next') || txt.includes('tiếp')) && !b.id.includes('slidesBackground') && !b.className.includes('slidesBackground');
      });
      console.log(`[SCORM TARGET] ${stagePrefix} next ${getElementDetails(nextBtn, '')}`);

      const prevBtn = allButtons.find(b => {
        const txt = (b.innerText || b.textContent || b.id || b.className || b.getAttribute('aria-label') || '').toLowerCase();
        return (txt.includes('prev') || txt.includes('previous') || txt.includes('back') || txt.includes('trước')) && !b.id.includes('slidesBackground') && !b.className.includes('slidesBackground');
      });
      console.log(`[SCORM TARGET] ${stagePrefix} prev ${getElementDetails(prevBtn, '')}`);

      const submitBtn = allButtons.find(b => {
        const txt = (b.innerText || b.textContent || b.id || b.className || b.getAttribute('aria-label') || '').toLowerCase();
        return (txt.includes('submit') || txt.includes('check') || txt.includes('nộp')) && !b.id.includes('slidesBackground') && !b.className.includes('slidesBackground');
      });
      console.log(`[SCORM TARGET] ${stagePrefix} submit ${getElementDetails(submitBtn, '')}`);
    }

    // 3. One-Shot Reflow an toàn tuyệt đối (Không synthetic event, không ResizeObserver loop, có Guard)
    function executeSafeOneShotReflow(triggerSource = 'rAF2') {
      if (hasInitialReflowRun) return;
      hasInitialReflowRun = true;

      try {
        const frameWin = contentFrame.contentWindow;
        const frameDoc = contentFrame.contentDocument || frameWin?.document;

        console.log(`[SCORM ONE-SHOT] Running safe one-shot reflow (source=${triggerSource}, guard: hasInitialReflowRun=true)`);

        if (frameDoc && !hasLoggedBeforeResize) {
          hasLoggedBeforeResize = true;
          logTargetElementSnapshot('BEFORE_RESIZE', frameDoc, frameWin);
        }

        let reflowMethodCalled = false;

        // Gọi trực tiếp API iSpring nếu có (không wrap, không recursion)
        if (frameWin) {
          if (typeof frameWin.invalidatePlayerSize === 'function') {
            frameWin.invalidatePlayerSize();
            reflowMethodCalled = true;
            console.log('[SCORM ONE-SHOT] invalidatePlayerSize() invoked directly on SCO window');
          }

          if (frameWin.player && typeof frameWin.player.invalidateSize === 'function') {
            frameWin.player.invalidateSize();
            reflowMethodCalled = true;
            console.log('[SCORM ONE-SHOT] player.invalidateSize() invoked directly on SCO player');
          }
        }

        // Quét nested frames nếu có
        if (frameDoc) {
          const nestedFrames = enumerateNestedFrames(frameDoc);
          nestedFrames.forEach((nf) => {
            if (nf.ifrWin) {
              if (typeof nf.ifrWin.invalidatePlayerSize === 'function') {
                nf.ifrWin.invalidatePlayerSize();
                reflowMethodCalled = true;
                console.log(`[SCORM ONE-SHOT] invalidatePlayerSize() invoked on nested frame (#${nf.depth}.${nf.index + 1})`);
              }
              if (nf.ifrWin.player && typeof nf.ifrWin.player.invalidateSize === 'function') {
                nf.ifrWin.player.invalidateSize();
                reflowMethodCalled = true;
              }
            }
          });
        }

        console.log(`[SCORM ONE-SHOT] Reflow execution complete. API called: ${reflowMethodCalled ? 'YES' : 'NO (none available)'}`);

        // Chụp snapshot sau 1 microtask
        requestAnimationFrame(() => {
          if (frameDoc) {
            logTargetElementSnapshot('POST_ONE_SHOT', frameDoc, frameWin);
          }
        });
      } catch (err) {
        console.warn('[SCORM ONE-SHOT] One-shot reflow note:', err.message);
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

          frameWin.addEventListener('resize', () => {
            if (!hasLoggedAfterResize) {
              hasLoggedAfterResize = true;
              logTargetElementSnapshot('AFTER_RESIZE', frameDoc, frameWin);
            }
          });
        }
      } catch (inspectErr) {
        console.warn('[SCORM DIAG] Frame inspection note:', inspectErr.message);
      }
    }

    // Lắng nghe sự kiện resize tự nhiên của người dùng
    window.addEventListener('resize', () => {
      const frameDoc = contentFrame.contentDocument || contentFrame.contentWindow?.document;
      const frameWin = contentFrame.contentWindow;
      if (!hasLoggedAfterResize && frameDoc) {
        hasLoggedAfterResize = true;
        logTargetElementSnapshot('AFTER_RESIZE', frameDoc, frameWin);
      }
    });

    contentFrame.onload = () => {
      console.log('🎯 [SCORM Player] SCO Content loaded successfully into frame from Same-Origin Gateway.');
      inspectFrameState('onload');

      if (loadingOverlay) loadingOverlay.style.display = 'none';

      if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
        window.parent.postMessage({ type: 'SCORM_LOADED', payload: { scoUrl: finalScoUrl } }, parentOrigin);
      }

      // Đợi đúng 2 requestAnimationFrame để DOM ổn định layout thật rồi kích hoạt One-Shot Reflow
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          executeSafeOneShotReflow('2x-requestAnimationFrame');
        });
      });
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
