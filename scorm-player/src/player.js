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
    let hasLoggedBeforeNative = false;
    let hasLoggedResizeEntry = false;
    let lastWinSize = `${window.innerWidth}x${window.innerHeight}`;
    let callSeq = 0;

    // 1. Hàm chụp chi tiết toàn bộ Geometry & Media Parameters (In trực tiếp từng dòng Plain Text)
    function logGeometrySnapshot(stageLabel) {
      try {
        const frameWin = contentFrame ? contentFrame.contentWindow : null;
        const frameDoc = contentFrame ? (contentFrame.contentDocument || frameWin?.document) : null;

        // MAIN
        const winInner = `${window.innerWidth != null ? window.innerWidth : 'NA'}x${window.innerHeight != null ? window.innerHeight : 'NA'}`;
        const winOuter = `${window.outerWidth != null ? window.outerWidth : 'NA'}x${window.outerHeight != null ? window.outerHeight : 'NA'}`;
        const dpr = window.devicePixelRatio != null ? window.devicePixelRatio : 'NA';
        console.log(`[SCORM GEOMETRY] ${stageLabel} MAIN inner=${winInner} outer=${winOuter} dpr=${dpr}`);

        // VISUAL VIEWPORT
        const vv = window.visualViewport
          ? `viewport=${Math.round(window.visualViewport.width)}x${Math.round(window.visualViewport.height)} scale=${window.visualViewport.scale.toFixed(2)}`
          : 'viewport=NA scale=NA';
        console.log(`[SCORM GEOMETRY] ${stageLabel} VISUAL ${vv}`);

        // IFRAME
        let ifrRectStr = 'rect=NA';
        let ifrClient = 'client=NA';
        let ifrOffset = 'offset=NA';
        if (contentFrame) {
          const r = contentFrame.getBoundingClientRect();
          ifrRectStr = `rect=[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}]`;
          ifrClient = `client=${contentFrame.clientWidth != null ? contentFrame.clientWidth : 'NA'}x${contentFrame.clientHeight != null ? contentFrame.clientHeight : 'NA'}`;
          ifrOffset = `offset=${contentFrame.offsetWidth != null ? contentFrame.offsetWidth : 'NA'}x${contentFrame.offsetHeight != null ? contentFrame.offsetHeight : 'NA'}`;
        }
        console.log(`[SCORM GEOMETRY] ${stageLabel} IFRAME ${ifrRectStr} ${ifrClient} ${ifrOffset}`);

        // SCO
        const scoInner = frameWin ? `inner=${frameWin.innerWidth != null ? frameWin.innerWidth : 'NA'}x${frameWin.innerHeight != null ? frameWin.innerHeight : 'NA'}` : 'inner=NA';
        const scoDocClient = frameDoc && frameDoc.documentElement ? `docClient=${frameDoc.documentElement.clientWidth != null ? frameDoc.documentElement.clientWidth : 'NA'}x${frameDoc.documentElement.clientHeight != null ? frameDoc.documentElement.clientHeight : 'NA'}` : 'docClient=NA';
        console.log(`[SCORM GEOMETRY] ${stageLabel} SCO ${scoInner} ${scoDocClient}`);

        // ELEMENTS
        function getElRectStr(selector) {
          if (!frameDoc) return 'NA';
          const el = frameDoc.querySelector(selector);
          if (!el) return 'NA';
          const r = el.getBoundingClientRect();
          return `[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}]`;
        }
        const playerViewRect = getElRectStr('.playerView, [class*="playerView"], [class*="player"]');
        const framesLayerRect = getElRectStr('.framesLayerContent, [class*="framesLayer"]');
        const slidesBgRect = getElRectStr('#slidesBackground, [id*="slidesBackground"]');
        console.log(`[SCORM GEOMETRY] ${stageLabel} ELEMENTS playerView=${playerViewRect} framesLayer=${framesLayerRect} slidesBg=${slidesBgRect}`);

        // MEDIA
        const isLandscape = window.matchMedia ? window.matchMedia('(orientation: landscape)').matches : 'NA';
        const isMin768 = window.matchMedia ? window.matchMedia('(min-width: 768px)').matches : 'NA';
        console.log(`[SCORM GEOMETRY] ${stageLabel} MEDIA landscape=${isLandscape} min768=${isMin768}`);
      } catch (geomErr) {
        console.warn(`[SCORM GEOMETRY] ${stageLabel} error:`, geomErr.message);
      }
    }

    // 2. Quét đệ quy tất cả nested iframe/frame
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
        } catch {
          // ignore
        }
      });
      return results;
    }

    // 3. Khảo sát bề mặt hiển thị (Render Surfaces: Canvas, SVG, Matrix, Slide Roots)
    function inspectRenderSurfaces(stagePrefix, doc, win) {
      if (!doc || !doc.body) return;

      try {
        console.log(`--------------------------------------------------------`);
        console.log(`[SCORM RENDER] === RENDER SURFACES: ${stagePrefix} ===`);

        // Canvas inspection
        const canvases = Array.from(doc.querySelectorAll('canvas'));
        console.log(`[SCORM RENDER] ${stagePrefix} Total canvases: ${canvases.length}`);
        canvases.slice(0, 4).forEach((cv, idx) => {
          const r = cv.getBoundingClientRect();
          const s = win ? win.getComputedStyle(cv) : {};
          console.log(`[SCORM RENDER] ${stagePrefix} canvas#${idx + 1} attr=[${cv.width}x${cv.height}] client=[${cv.clientWidth}x${cv.clientHeight}] rect=[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}] vis=${s.visibility} disp=${s.display} op=${s.opacity}`);
        });

        // SVG inspection
        const svgs = Array.from(doc.querySelectorAll('svg'));
        console.log(`[SCORM RENDER] ${stagePrefix} Total SVGs: ${svgs.length}`);
        svgs.slice(0, 4).forEach((svg, idx) => {
          const r = svg.getBoundingClientRect();
          const s = win ? win.getComputedStyle(svg) : {};
          console.log(`[SCORM RENDER] ${stagePrefix} svg#${idx + 1} attr=[${svg.getAttribute('width')}x${svg.getAttribute('height')}] viewBox="${svg.getAttribute('viewBox') || '-'}" rect=[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}] vis=${s.visibility} disp=${s.display}`);
        });

        // Slide view children
        const playerView = doc.querySelector('.playerView') || doc.querySelector('[class*="playerView"]') || doc.body;
        if (playerView && playerView.children) {
          Array.from(playerView.children).slice(0, 5).forEach((ch, idx) => {
            const r = ch.getBoundingClientRect();
            const s = win ? win.getComputedStyle(ch) : {};
            console.log(`[SCORM RENDER] ${stagePrefix} playerView.child#${idx + 1} <${ch.tagName.toLowerCase()} id="${ch.id || '-'}" cls="${(ch.className || '').toString().substring(0, 25)}"> rect=[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}] transform="${s.transform || 'none'}" vis=${s.visibility}`);
          });
        }
        console.log(`--------------------------------------------------------`);
      } catch (rErr) {
        console.warn(`[SCORM RENDER] ${stagePrefix} note:`, rErr.message);
      }
    }

    // 4. Hook an toàn Read-Only Call Chain Tracer cho tất cả iSpring Methods
    function hookIspringCallTracer(win, contextLabel = 'SCO Window') {
      if (!win || win.__scorm_call_tracer_attached) return;
      win.__scorm_call_tracer_attached = true;

      try {
        function wrapMethod(obj, objName, methodName) {
          if (!obj || typeof obj[methodName] !== 'function' || obj[methodName].__traced) return;
          const original = obj[methodName];
          obj[methodName] = function (...args) {
            callSeq++;
            const argSummary = args.map((a) => (typeof a === 'object' ? (a ? Object.keys(a).slice(0, 3).join(',') : 'null') : String(a))).join(', ');
            console.log(`[SCORM RESIZE CALL CHAIN] #${callSeq} [${contextLabel}] ${objName}.${methodName}(${argSummary.substring(0, 35)})`);
            
            const res = original.apply(this, args);

            if (methodName === 'invalidatePlayerSize' || methodName === 'invalidateSize') {
              logGeometrySnapshot('AFTER_INVALIDATE');
            }

            return res;
          };
          obj[methodName].__traced = true;
        }

        // Global functions
        ['invalidatePlayerSize', 'setPlayerSize', 'updatePlayerSize', 'resizePlayer', 'onResize'].forEach((m) => {
          wrapMethod(win, 'window', m);
        });

        // Global objects
        ['player', 'quizPlayer', 'ispringCourse', 'presentation', 'quiz', 'PresentationPlayer'].forEach((key) => {
          const obj = win[key];
          if (obj && typeof obj === 'object') {
            const methodNames = ['invalidateSize', 'setPlayerSize', 'resize', 'updateLayout', 'render', 'draw', 'renderSlide', 'updateView', 'refresh', 'update', 'redraw', 'layout', 'fitToWindow', 'scaleToFit'];
            methodNames.forEach((m) => wrapMethod(obj, key, m));
          }
        });
      } catch (hookErr) {
        console.warn(`[SCORM RESIZE TRACE] Hook note:`, hookErr.message);
      }
    }

    // 5. Diagnostic MutationObserver (Chỉ quan sát thay đổi DOM quanh Native Resize)
    function attachDiagnosticMutationObserver(doc, win) {
      if (!doc || !doc.body || doc.__scorm_observer_attached || typeof MutationObserver === 'undefined') return;
      doc.__scorm_observer_attached = true;

      try {
        let mutationCount = 0;
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((m) => {
            if (mutationCount < 15) {
              mutationCount++;
              const target = m.target;
              const tag = target.tagName ? target.tagName.toLowerCase() : 'node';
              const id = target.id || '-';
              const cls = typeof target.className === 'string' ? target.className.substring(0, 25) : '-';

              if (m.type === 'attributes') {
                const newVal = target.getAttribute(m.attributeName) || (m.attributeName === 'style' ? target.style.cssText : '');
                console.log(`[SCORM MUTATION] #${mutationCount} attr: <${tag} id="${id}" cls="${cls}"> [${m.attributeName}] -> "${(newVal || '').substring(0, 35)}"`);
              } else if (m.type === 'childList') {
                console.log(`[SCORM MUTATION] #${mutationCount} childList: <${tag} id="${id}"> added=${m.addedNodes.length} removed=${m.removedNodes.length}`);
              }
            }
          });
        });

        const targetEl = doc.querySelector('.playerView') || doc.body;
        observer.observe(targetEl, { attributes: true, childList: true, subtree: true, attributeOldValue: true });
      } catch (obsErr) {
        console.warn('[SCORM MUTATION] Observer note:', obsErr.message);
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

        if (frameWin && !frameWin.__scorm_diag_attached) {
          frameWin.__scorm_diag_attached = true;
          hookIspringCallTracer(frameWin, 'SCO Top Window');
          attachDiagnosticMutationObserver(frameDoc, frameWin);

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
            const currentWinSize = `${frameWin.innerWidth}x${frameWin.innerHeight}`;
            console.log(`[SCORM RESIZE TRACE] native SCO frame resize event innerSize=${currentWinSize}`);
          });
        }
      } catch (inspectErr) {
        console.warn('[SCORM DIAG] Frame inspection note:', inspectErr.message);
      }
    }

    // Lắng nghe sự kiện resize tự nhiên của người dùng trên player window
    window.addEventListener('resize', () => {
      const currentWinSize = `${window.innerWidth}x${window.innerHeight}`;
      console.log(`[SCORM RESIZE TRACE] native browser resize BEGIN: window size ${lastWinSize} -> ${currentWinSize}`);
      lastWinSize = currentWinSize;

      // Log ngay đầu resize event BEFORE iSpring handler
      logGeometrySnapshot('RESIZE_EVENT_ENTRY');

      const frameDoc = contentFrame.contentDocument || contentFrame.contentWindow?.document;
      const frameWin = contentFrame.contentWindow;

      if (frameWin) {
        hookIspringCallTracer(frameWin, 'SCO Top Window');
      }

      // Schedule log sau khi render hoàn tất
      requestAnimationFrame(() => {
        logGeometrySnapshot('CONTENT_VISIBLE');
        if (frameDoc) inspectRenderSurfaces('CONTENT_VISIBLE', frameDoc, frameWin);
      });
    });

    // Lắng nghe visualViewport resize nếu trình duyệt hỗ trợ
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        console.log(`[SCORM RESIZE TRACE] visualViewport resize: w=${window.visualViewport.width}, h=${window.visualViewport.height}, scale=${window.visualViewport.scale}`);
      });
    }

    contentFrame.onload = () => {
      console.log('🎯 [SCORM Player] SCO Content loaded successfully into frame from Same-Origin Gateway.');
      inspectFrameState('onload');

      if (loadingOverlay) loadingOverlay.style.display = 'none';

      if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
        window.parent.postMessage({ type: 'SCORM_LOADED', payload: { scoUrl: finalScoUrl } }, parentOrigin);
      }

      // Chụp snapshot trạng thái trước resize
      setTimeout(() => {
        if (!hasLoggedBeforeNative) {
          hasLoggedBeforeNative = true;
          logGeometrySnapshot('BEFORE_NATIVE');
          const frameDoc = contentFrame.contentDocument || contentFrame.contentWindow?.document;
          const frameWin = contentFrame.contentWindow;
          if (frameDoc) inspectRenderSurfaces('BEFORE_NATIVE', frameDoc, frameWin);
        }
      }, 1200);
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
