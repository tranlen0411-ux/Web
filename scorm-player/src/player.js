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
  const isDiagFresh = urlParams.get('scormDiagFresh') === '1';

  if (isDiagFresh) {
    console.log('[SCORM DIAG FRESH MODE] ENABLED');
    console.log('[SCORM DIAG FRESH MODE] persisted tracking intentionally ignored in-memory only');
    console.log('[SCORM DIAG FRESH MODE] database writes disabled');
  }

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
      persistedTracking = isDiagFresh ? null : (infoData.tracking || null);

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

  // 4. ZERO-RACE DETERMINISTIC LIFECYCLE: Chờ nhận persisted CMI state TRƯỚC KHI tạo API & mount SCO
  console.log('[SCORM RESTORE] SCORM_RESTORE_START');

  async function resolveInitialTracking() {
    // Nếu chạy độc lập không có parent hoặc parentOrigin không thiết lập
    if (!window.parent || window.parent === window || !parentOrigin || parentOrigin === '*') {
      const standaloneTracking = (persistedTracking && !isDiagFresh) ? persistedTracking : null;
      console.log(`[SCORM RESTORE] INITIAL_CMI_STATE_RECEIVED hasTracking=${Boolean(standaloneTracking)}`);
      return standaloneTracking;
    }

    return new Promise((resolve) => {
      let resolved = false;

      const messageListener = (event) => {
        if (event.origin !== parentOrigin && parentOrigin !== '*') return;
        if (event.source !== window.parent) return;

        const { type, payload } = event.data || {};
        if (type === 'INITIAL_CMI_STATE') {
          if (!resolved) {
            resolved = true;
            window.removeEventListener('message', messageListener);
            const receivedTracking = (payload && payload.tracking && !isDiagFresh) ? payload.tracking : null;
            console.log(`[SCORM RESTORE] INITIAL_CMI_STATE_RECEIVED hasTracking=${Boolean(receivedTracking)}`);
            resolve(receivedTracking);
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

      // Phòng vệ timeout tối đa 2000ms nếu parent không phản hồi (fallback session-info)
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('message', messageListener);
          const fallbackTracking = (persistedTracking && !isDiagFresh) ? persistedTracking : null;
          console.warn('[SCORM RESTORE] Handshake timeout (2s), fallback to session-info tracking');
          console.log(`[SCORM RESTORE] INITIAL_CMI_STATE_RECEIVED hasTracking=${Boolean(fallbackTracking)}`);
          resolve(fallbackTracking);
        }
      }, 2000);
    });
  }

  const initialTracking = await resolveInitialTracking();

  // 5. Khởi tạo và gắn SCORM API vào Window của Player với Initial Tracking đã có ngay từ đầu
  const initialData = {
    studentName,
    tracking: initialTracking,
  };

  const api12 = createScorm12Api(initialData, handleCmiCommit);
  const api2004 = createScorm2004Api(initialData, handleCmiCommit);

  window.API = api12;
  window.API_1484_11 = api2004;

  console.log(`✅ [SCORM Player] Attached window.API (1.2) and window.API_1484_11 (2004). Target: ${scormVersion}`);

  const is2004 = scormVersion === '2004' || String(scormVersion).startsWith('2004');
  const activeApi = is2004 ? window.API_1484_11 : window.API;
  const initialCmi = activeApi && typeof activeApi._getCmi === 'function' ? activeApi._getCmi() : {};
  const initialEntry = is2004 ? (initialCmi['cmi.entry'] || '') : (initialCmi['cmi.core.entry'] || '');
  const initialLoc = is2004 ? (initialCmi['cmi.location'] || '') : (initialCmi['cmi.core.lesson_location'] || '');
  const initialSusData = initialCmi['cmi.suspend_data'] || '';

  // 6. SCORM RESTORE READY: Xác nhận CMI state đã sẵn sàng 100%
  console.log(`[SCORM RESTORE] SCORM_RESTORE_READY entry=${initialEntry} suspendLength=${initialSusData.length} location=${initialLoc}`);

  // 7. Lắng nghe các lệnh điều khiển từ parent (Save before close, Ping)
  window.addEventListener('message', (event) => {
    if (parentOrigin && event.origin !== parentOrigin && parentOrigin !== '*') {
      return;
    }

    if (window.parent && window.parent !== window && event.source !== window.parent) {
      return;
    }

    const { type, payload } = event.data || {};
    if (type === 'PING') {
      if (event.source && event.origin) {
        event.source.postMessage({ type: 'PONG', payload: { status: 'READY', version: scormVersion } }, event.origin);
      }
    } else if (type === 'SCORM_REQUEST_SAVE_BEFORE_CLOSE') {
      try {
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

  // 8. SCO MOUNT START: Mount Content Frame an toàn sau khi SCORM_RESTORE_READY
  let hasScoMounted = false;

  // 7. Nạp bài giảng vào Content Frame và kích hoạt bộ chẩn đoán Comprehensive Geometry & Resize Tracker
  if (contentFrame) {
    let callSeq = 0;
    let lastWinSize = `${window.innerWidth}x${window.innerHeight}`;
    let hasLoggedT4 = false;

    // Hàm chụp chi tiết toàn bộ Geometry & Media Parameters theo các mốc T0 -> T6
    function logComprehensiveGeometry(stageLabel) {
      try {
        const frameWin = contentFrame ? contentFrame.contentWindow : null;
        const frameDoc = contentFrame ? (contentFrame.contentDocument || frameWin?.document) : null;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()).toFixed(1);

        console.log(`========================================================`);
        console.log(`[SCORM GEOMETRY STAGE] ${stageLabel} (time=${now}ms)`);

        // 1. PLAYER WINDOW & OUTER IFRAME
        const pInner = `${window.innerWidth}x${window.innerHeight}`;
        const pOuter = `${window.outerWidth}x${window.outerHeight}`;
        const dpr = window.devicePixelRatio || 1;
        console.log(`  PLAYER_WIN: inner=${pInner} outer=${pOuter} dpr=${dpr}`);

        // 2. CONTENT FRAME (IFRAME CỦA SCO)
        let ifrRect = 'NA', ifrClient = 'NA', ifrOffset = 'NA';
        if (contentFrame) {
          const r = contentFrame.getBoundingClientRect();
          ifrRect = `[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}]`;
          ifrClient = `${contentFrame.clientWidth}x${contentFrame.clientHeight}`;
          ifrOffset = `${contentFrame.offsetWidth}x${contentFrame.offsetHeight}`;
        }
        console.log(`  CONTENT_FRAME: rect=${ifrRect} client=${ifrClient} offset=${ifrOffset}`);

        // 3. SCO WINDOW
        const scoInner = frameWin ? `${frameWin.innerWidth}x${frameWin.innerHeight}` : 'NA';
        console.log(`  SCO_WIN: inner=${scoInner}`);

        // 4. SCO DOCUMENT ELEMENT & BODY
        if (frameDoc && frameDoc.documentElement) {
          const de = frameDoc.documentElement;
          const deR = de.getBoundingClientRect();
          const deRect = `[${Math.round(deR.left)},${Math.round(deR.top)},${Math.round(deR.width)}x${Math.round(deR.height)}]`;
          const deClient = `${de.clientWidth}x${de.clientHeight}`;
          const deScroll = `${de.scrollWidth}x${de.scrollHeight}`;
          console.log(`  SCO_DOC_EL: rect=${deRect} client=${deClient} scroll=${deScroll}`);
        }

        if (frameDoc && frameDoc.body) {
          const b = frameDoc.body;
          const bR = b.getBoundingClientRect();
          const bRect = `[${Math.round(bR.left)},${Math.round(bR.top)},${Math.round(bR.width)}x${Math.round(bR.height)}]`;
          const bClient = `${b.clientWidth}x${b.clientHeight}`;
          const bScroll = `${b.scrollWidth}x${b.scrollHeight}`;
          console.log(`  SCO_BODY: rect=${bRect} client=${bClient} scroll=${bScroll}`);
        }

        // 5. ISPRING ELEMENTS (playerView, framesLayer, slidesBackground, containers)
        if (frameDoc) {
          function getElInfo(selector) {
            const el = frameDoc.querySelector(selector);
            if (!el) return 'missing';
            const r = el.getBoundingClientRect();
            const style = frameWin ? frameWin.getComputedStyle(el) : {};
            const tf = style.transform && style.transform !== 'none' ? ` tf="${style.transform}"` : '';
            const vis = style.visibility !== 'visible' ? ` vis=${style.visibility}` : '';
            const disp = style.display !== 'block' ? ` disp=${style.display}` : '';
            return `[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}] client=${el.clientWidth}x${el.clientHeight}${tf}${vis}${disp}`;
          }

          console.log(`  playerView: ${getElInfo('.playerView, [class*="playerView"]')}`);
          console.log(`  framesLayer: ${getElInfo('.framesLayerContent, [class*="framesLayer"]')}`);
          console.log(`  slidesBg: ${getElInfo('#slidesBackground, [id*="slidesBackground"]')}`);
          console.log(`  quizRoot: ${getElInfo('.quizView, [class*="quizView"], [id*="quiz"]')}`);
          console.log(`  slideContainer: ${getElInfo('.slideView, [class*="slideView"], [class*="slide"]')}`);

          const svgs = frameDoc.querySelectorAll('svg');
          const canvases = frameDoc.querySelectorAll('canvas');
          console.log(`  SURFACES: svgs=${svgs.length} canvases=${canvases.length}`);
        }
        console.log(`========================================================`);
      } catch (geomErr) {
        console.warn(`[SCORM GEOMETRY STAGE] ${stageLabel} error:`, geomErr.message);
      }
    }

    // Gắn vào window để scormApi.js hoặc các module có thể gọi log mốc T2
    window.__logComprehensiveGeometry = logComprehensiveGeometry;

    // Gắn ResizeObserver chuyên sâu theo dõi biến đổi kích thước từng element
    function attachAllResizeObservers() {
      if (typeof ResizeObserver === 'undefined') return;

      try {
        const ro = new ResizeObserver((entries) => {
          entries.forEach((entry) => {
            const target = entry.target;
            const tag = target.tagName ? target.tagName.toLowerCase() : 'el';
            const id = target.id ? `#${target.id}` : '';
            const cls = typeof target.className === 'string' && target.className ? `.${target.className.substring(0, 20)}` : '';
            const cr = entry.contentRect;
            const sizeStr = `${Math.round(cr.width)}x${Math.round(cr.height)}`;
            console.log(`[SCORM RESIZEOBSERVER] target=<${tag}${id}${cls}> size=${sizeStr}`);
          });
        });

        if (contentFrame) ro.observe(contentFrame);

        const frameDoc = contentFrame?.contentDocument || contentFrame?.contentWindow?.document;
        if (frameDoc) {
          if (frameDoc.documentElement) ro.observe(frameDoc.documentElement);
          if (frameDoc.body) ro.observe(frameDoc.body);
          const pv = frameDoc.querySelector('.playerView, [class*="playerView"]');
          if (pv) ro.observe(pv);
          const fl = frameDoc.querySelector('.framesLayerContent, [class*="framesLayer"]');
          if (fl) ro.observe(fl);
          const sb = frameDoc.querySelector('#slidesBackground, [id*="slidesBackground"]');
          if (sb) ro.observe(sb);
        }
      } catch (roErr) {
        console.warn('[SCORM RESIZEOBSERVER] error:', roErr.message);
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

    let lastMin768 = window.innerWidth >= 768;

    // 6. Hàm đo và chẩn đoán Breakpoint 768px Causality
    function logBreakpointState(triggerLabel = '') {
      try {
        const frameWin = contentFrame ? contentFrame.contentWindow : null;
        const frameDoc = contentFrame ? (contentFrame.contentDocument || frameWin?.document) : null;
        const currentWidth = window.innerWidth;
        const currentMin768 = currentWidth >= 768;
        const transition = `${lastMin768 ? 'true' : 'false'}->${currentMin768 ? 'true' : 'false'}`;
        lastMin768 = currentMin768;

        let slidesBgRect = 'missing';
        let framesLayerRect = 'missing';
        let playerViewRect = 'missing';
        let svgCount = 0;
        let contentVisible = 'false';

        if (frameDoc) {
          const slidesBg = frameDoc.querySelector('#slidesBackground, [id*="slidesBackground"]');
          const framesLayer = frameDoc.querySelector('.framesLayerContent, [class*="framesLayer"]');
          const playerView = frameDoc.querySelector('.playerView, [class*="playerView"]');
          const svgs = frameDoc.querySelectorAll('svg');
          svgCount = svgs.length;

          function rStr(el) {
            if (!el) return 'missing';
            const r = el.getBoundingClientRect();
            return `[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}]`;
          }

          slidesBgRect = rStr(slidesBg);
          framesLayerRect = rStr(framesLayer);
          playerViewRect = rStr(playerView);
          contentVisible = (slidesBg && slidesBg.getBoundingClientRect().width > 10) ? 'true' : 'false';

          console.log(`[SCORM BREAKPOINT] transition ${transition} (${triggerLabel})`);
          console.log(`[SCORM BREAKPOINT] width=${currentWidth} min768=${currentMin768} contentVisible=${contentVisible} svgCount=${svgCount} slidesBg=${slidesBgRect} framesLayer=${framesLayerRect} playerView=${playerViewRect}`);

          // Trace CSS / layout state
          const pvStyle = playerView && frameWin ? frameWin.getComputedStyle(playerView) : {};
          const bodyCls = frameDoc.body?.className || '-';
          const pvCls = playerView?.className || '-';
          const flCls = framesLayer?.className || '-';
          console.log(`[SCORM BREAKPOINT CSS] bodyCls="${bodyCls}" playerViewCls="${pvCls}" framesLayerCls="${flCls}" transform="${pvStyle.transform || 'none'}" disp=${pvStyle.display || 'unknown'} vis=${pvStyle.visibility || 'unknown'}`);
        } else {
          console.log(`[SCORM BREAKPOINT] transition ${transition} width=${currentWidth} min768=${currentMin768} (${triggerLabel}, frameDoc not ready)`);
        }
      } catch (bpErr) {
        console.warn('[SCORM BREAKPOINT] Error:', bpErr.message);
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

    // Lắng nghe sự kiện resize tự nhiên của người dùng hoặc outer iframe trên player window
    window.addEventListener('resize', () => {
      const currentWinSize = `${window.innerWidth}x${window.innerHeight}`;
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()).toFixed(1);
      console.log(`[SCORM GEOMETRY] WINDOW_RESIZE target=PLAYER innerWidth=${window.innerWidth} innerHeight=${window.innerHeight} time=${now}`);
      console.log(`[SCORM RESIZE TRACE] native browser resize BEGIN: window size ${lastWinSize} -> ${currentWinSize}`);
      lastWinSize = currentWinSize;

      logComprehensiveGeometry('T6_AFTER_RESIZE_PLAYER_WIN');
      logBreakpointState('RESIZE_EVENT_ENTRY');

      const frameDoc = contentFrame.contentDocument || contentFrame.contentWindow?.document;
      const frameWin = contentFrame.contentWindow;

      if (frameWin) {
        hookIspringCallTracer(frameWin, 'SCO Top Window');
      }

      // Schedule log sau khi render hoàn tất
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          logComprehensiveGeometry('T6_AFTER_RESIZE_rAF2');
          logBreakpointState('CONTENT_VISIBLE_rAF2');
          if (frameDoc) inspectRenderSurfaces('CONTENT_VISIBLE', frameDoc, frameWin);
        });
      });
    });

    // Lắng nghe visualViewport resize nếu trình duyệt hỗ trợ
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        console.log(`[SCORM RESIZE TRACE] visualViewport resize: w=${window.visualViewport.width}, h=${window.visualViewport.height}, scale=${window.visualViewport.scale}`);
      });
    }

    // 7. Bộ chẩn đoán chuyên biệt FRESH QUIZ (Chỉ đọc, thụ động, không can thiệp DOM)
    function inspectFreshQuizState(triggerLabel = '') {
      try {
        const frameWin = contentFrame ? contentFrame.contentWindow : null;
        const frameDoc = contentFrame ? (contentFrame.contentDocument || frameWin?.document) : null;
        if (!frameDoc) return;

        const slidesBg = frameDoc.querySelector('#slidesBackground, [id*="slidesBackground"]');
        const framesLayer = frameDoc.querySelector('.framesLayerContent, [class*="framesLayer"]');
        const quizRoot = frameDoc.querySelector('.quizView, [class*="quizView"], [id*="quiz"], [class*="quiz"]');
        const questionRoot = frameDoc.querySelector('.questionView, [class*="question"], [id*="question"]');
        const svgs = frameDoc.querySelectorAll('svg');
        const canvases = frameDoc.querySelectorAll('canvas');

        function rStr(el) {
          if (!el) return 'missing';
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return 'zero-size';
          return `[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}]`;
        }

        function btnState(selectorList) {
          for (const s of selectorList) {
            const btn = frameDoc.querySelector(s);
            if (btn) {
              const r = btn.getBoundingClientRect();
              if (r.width === 0 && r.height === 0) return 'zero-size';
              if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return 'disabled';
              return 'visible';
            }
          }
          return 'missing';
        }

        const submitState = btnState(['button[id*="submit"]', 'button[class*="submit"]', '[data-control="submit"]', '.submitButton', '#submitButton']);
        const nextState = btnState(['button[id*="next"]', 'button[class*="next"]', '[data-control="next"]', '.nextButton', '#nextButton', '.control-next']);
        const prevState = btnState(['button[id*="prev"]', 'button[class*="prev"]', '[data-control="prev"]', '.prevButton', '#prevButton', '.control-prev']);

        const isQuizVisible = (slidesBg && slidesBg.getBoundingClientRect().width > 10) || svgs.length > 0;

        console.log(`[SCORM FRESH QUIZ] ${triggerLabel}`);
        console.log(`  quizVisible=${isQuizVisible ? 'YES' : 'NO'}`);
        console.log(`  svgCount=${svgs.length}`);
        console.log(`  canvasCount=${canvases.length}`);
        console.log(`  slidesBg=${rStr(slidesBg)}`);
        console.log(`  quizRoot=${quizRoot ? 'present' : 'missing'}`);
        console.log(`  questionRoot=${questionRoot ? 'present' : 'missing'}`);
        console.log(`  submit=${submitState}`);
        console.log(`  next=${nextState}`);
        console.log(`  previous=${prevState}`);
      } catch (err) {
        console.warn('[SCORM FRESH QUIZ] Error inspecting quiz state:', err.message);
      }
    }

    // Hook EventTarget addEventListener và window.onresize để xác định chính xác handler iSpring đăng ký
    function hookResizeListeners(win) {
      if (!win || win.__resize_hooked) return;
      win.__resize_hooked = true;

      try {
        const origAddEventListener = win.addEventListener;
        win.addEventListener = function (type, listener, options) {
          if (type === 'resize') {
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()).toFixed(1);
            const listenerName = listener?.name || (typeof listener === 'function' ? 'anonymous' : String(listener));
            const fnStr = typeof listener === 'function' ? listener.toString().substring(0, 120).replace(/\s+/g, ' ') : '';
            console.log(`[ISPRING RESIZE TRACE] listener_registered type=resize name="${listenerName}" fn="${fnStr}" time=${now}ms`);
            
            if (!win.__registeredResizeHandlers) win.__registeredResizeHandlers = [];
            win.__registeredResizeHandlers.push(listener);
          }
          return origAddEventListener.apply(this, arguments);
        };

        let _onresize = win.onresize;
        Object.defineProperty(win, 'onresize', {
          get() { return _onresize; },
          set(fn) {
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()).toFixed(1);
            console.log(`[ISPRING RESIZE TRACE] onresize_assigned time=${now}ms fn="${fn?.toString().substring(0, 120).replace(/\s+/g, ' ')}"`);
            _onresize = fn;
            if (!win.__registeredResizeHandlers) win.__registeredResizeHandlers = [];
            win.__registeredResizeHandlers.push(fn);
          },
          configurable: true,
        });
      } catch (hookErr) {
        console.warn('[ISPRING RESIZE TRACE] hook error:', hookErr.message);
      }
    }

    // Bộ thực thi kiểm chứng khoa học Root-Cause (R1: Synthetic, R2: Direct API, R3: Real 1px Delta)
    async function runRootCauseProof(frameWin, frameDoc) {
      if (!frameDoc || window.__r_proof_has_run) return;
      window.__r_proof_has_run = true;

      function takeSnapshot(label) {
        const sb = frameDoc.querySelector('#slidesBackground, [id*="slidesBackground"]');
        const fl = frameDoc.querySelector('.framesLayerContent, [class*="framesLayer"]');
        const pv = frameDoc.querySelector('.playerView, [class*="playerView"]');
        const qr = frameDoc.querySelector('.quizView, [class*="quizView"], [id*="quiz"]');
        const svgs = frameDoc.querySelectorAll('svg').length;
        const canvases = frameDoc.querySelectorAll('canvas').length;

        function r(el) {
          if (!el) return 'missing';
          const b = el.getBoundingClientRect();
          if (b.width === 0 && b.height === 0) return '0x0';
          return `[${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.width)}x${Math.round(b.height)}]`;
        }

        return {
          label,
          inner: frameWin ? `${frameWin.innerWidth}x${frameWin.innerHeight}` : 'NA',
          playerView: r(pv),
          framesLayer: r(fl),
          slidesBg: r(sb),
          quizRoot: r(qr),
          svgs,
          canvases,
          isVisible: (sb && sb.getBoundingClientRect().width > 10) || svgs > 0,
        };
      }

      console.log('========================================================');
      console.log('🔬 [ROOT-CAUSE PROOF] BẮT ĐẦU THỬ NGHIỆM CHẨN ĐOÁN R1, R2, R3');
      console.log('========================================================');

      const beforeAll = takeSnapshot('INITIAL_BLANK_T5');
      console.log(`[PROOF T5 BEFORE] inner=${beforeAll.inner} playerView=${beforeAll.playerView} framesLayer=${beforeAll.framesLayer} slidesBg=${beforeAll.slidesBg} svgs=${beforeAll.svgs} isVisible=${beforeAll.isVisible}`);

      // ----------------------------------------------------
      // TEST R1: Synthetic Resize Event trên SCO Window (Same Geometry)
      // ----------------------------------------------------
      console.log('🧪 [TEST R1] Dispatching synthetic Event("resize") on scoWindow...');
      try {
        frameWin.dispatchEvent(new Event('resize'));
      } catch (r1Err) {
        console.warn('[TEST R1] dispatchEvent error:', r1Err.message);
      }

      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const afterR1 = takeSnapshot('AFTER_R1_SYNTHETIC');
      const r1Fixed = afterR1.isVisible;
      console.log(`[TEST R1 RESULT] synthetic resize same geometry = ${r1Fixed ? 'FIXED (PASS)' : 'NOT_FIXED (FAIL)'}`);
      console.log(`  BEFORE R1: framesLayer=${beforeAll.framesLayer} slidesBg=${beforeAll.slidesBg} svgs=${beforeAll.svgs}`);
      console.log(`  AFTER  R1: framesLayer=${afterR1.framesLayer} slidesBg=${afterR1.slidesBg} svgs=${afterR1.svgs}`);

      if (r1Fixed) {
        console.log('🎉 [ROOT-CAUSE PROOF] R1 SUCCEEDED: Synthetic resize event kích hoạt được layout pipeline!');
        return;
      }

      // ----------------------------------------------------
      // TEST R2: Direct Layout / Invalidate API Call
      // ----------------------------------------------------
      console.log('🧪 [TEST R2] Searching for real iSpring internal layout / invalidate methods...');
      let foundApiName = null;
      let r2Fixed = false;

      const candidates = [
        { obj: frameWin, name: 'window.invalidatePlayerSize' },
        { obj: frameWin, name: 'window.setPlayerSize' },
        { obj: frameWin, name: 'window.updatePlayerSize' },
        { obj: frameWin?.player, name: 'player.invalidateSize' },
        { obj: frameWin?.player, name: 'player.updateLayout' },
        { obj: frameWin?.player, name: 'player.setPlayerSize' },
        { obj: frameWin?.player, name: 'player.resize' },
        { obj: frameWin?.PresentationPlayer, name: 'PresentationPlayer.invalidateSize' },
        { obj: frameWin?.ispringCourse, name: 'ispringCourse.updateLayout' },
        { obj: frameWin?.quizPlayer, name: 'quizPlayer.updateLayout' },
      ];

      for (const c of candidates) {
        if (c.obj) {
          const parts = c.name.split('.');
          const mName = parts[1];
          if (typeof c.obj[mName] === 'function') {
            foundApiName = c.name;
            console.log(`[TEST R2] Found active layout API: ${foundApiName}. Calling directly...`);
            try {
              if (mName === 'setPlayerSize') {
                c.obj[mName](frameWin.innerWidth, frameWin.innerHeight);
              } else {
                c.obj[mName]();
              }
            } catch (callErr) {
              console.warn(`[TEST R2] Error calling ${foundApiName}:`, callErr.message);
            }
            break;
          }
        }
      }

      // Nếu có registered resize handlers từ iSpring, thử gọi trực tiếp handler đó
      if (!foundApiName && frameWin.__registeredResizeHandlers && frameWin.__registeredResizeHandlers.length > 0) {
        console.log(`[TEST R2] Calling ${frameWin.__registeredResizeHandlers.length} registered resize handler(s) directly...`);
        frameWin.__registeredResizeHandlers.forEach((h, i) => {
          try {
            h.call(frameWin, new UIEvent('resize'));
            foundApiName = `registeredHandler#${i}`;
          } catch (hErr) {
            console.warn(`[TEST R2] registeredHandler#${i} call error:`, hErr.message);
          }
        });
      }

      if (foundApiName) {
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const afterR2 = takeSnapshot('AFTER_R2_DIRECT_CALL');
        r2Fixed = afterR2.isVisible;
        console.log(`[TEST R2 RESULT] direct layout call (${foundApiName}) = ${r2Fixed ? 'FIXED (PASS)' : 'NOT_FIXED (FAIL)'}`);
        console.log(`  BEFORE R2: framesLayer=${beforeAll.framesLayer} slidesBg=${beforeAll.slidesBg} svgs=${beforeAll.svgs}`);
        console.log(`  AFTER  R2: framesLayer=${afterR2.framesLayer} slidesBg=${afterR2.slidesBg} svgs=${afterR2.svgs}`);

        if (r2Fixed) {
          console.log(`🎉 [ROOT-CAUSE PROOF] R2 SUCCEEDED: Direct API call (${foundApiName}) đã kích hoạt render thành công!`);
          return;
        }
      } else {
        console.log('[TEST R2 RESULT] direct layout API = NOT AVAILABLE');
      }

      // ----------------------------------------------------
      // TEST R3: Real Geometry Delta (733 -> 732 -> 733)
      // ----------------------------------------------------
      console.log('🧪 [TEST R3] Testing Real 1px Geometry Delta on Content Frame (733 -> 732 -> restore)...');
      const originalWidthStyle = contentFrame.style.width || '100%';
      contentFrame.style.width = 'calc(100% - 1px)';

      await new Promise((res) => requestAnimationFrame(res));
      contentFrame.style.width = originalWidthStyle;

      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const afterR3 = takeSnapshot('AFTER_R3_GEOMETRY_DELTA');
      const r3Fixed = afterR3.isVisible;
      console.log(`[TEST R3 RESULT] real 1px geometry delta = ${r3Fixed ? 'FIXED (PASS)' : 'NOT_FIXED (FAIL)'}`);
      console.log(`  BEFORE R3: framesLayer=${beforeAll.framesLayer} slidesBg=${beforeAll.slidesBg} svgs=${beforeAll.svgs}`);
      console.log(`  AFTER  R3: framesLayer=${afterR3.framesLayer} slidesBg=${afterR3.slidesBg} svgs=${afterR3.svgs}`);

      console.log('========================================================');
      console.log('📊 [ROOT-CAUSE PROOF SUMMARY]');
      console.log(`  R1 (Synthetic Resize):   ${r1Fixed ? 'PASS' : 'FAIL'}`);
      console.log(`  R2 (Direct Layout API):  ${foundApiName ? (r2Fixed ? 'PASS' : 'FAIL') : 'NOT AVAILABLE'}`);
      console.log(`  R3 (Real 1px Delta):     ${r3Fixed ? 'PASS' : 'FAIL'}`);
      console.log('========================================================');
    }

    contentFrame.onload = () => {
      console.log('🎯 [SCORM Player] SCO Content loaded successfully into frame from Same-Origin Gateway.');
      logComprehensiveGeometry('T1_CONTENT_FRAME_ONLOAD');
      attachAllResizeObservers();
      inspectFrameState('onload');

      const frameWin = contentFrame.contentWindow;
      const frameDoc = contentFrame.contentDocument || frameWin?.document;

      if (frameWin) {
        hookResizeListeners(frameWin);
      }

      if (frameWin && !frameWin.__scorm_t3_attached) {
        frameWin.__scorm_t3_attached = true;
        frameWin.addEventListener('DOMContentLoaded', () => {
          logComprehensiveGeometry('T3_SCO_DOM_LOADED');
        });
        frameWin.addEventListener('load', () => {
          logComprehensiveGeometry('T3_SCO_WINDOW_LOAD');
        });
        frameWin.addEventListener('resize', () => {
          const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()).toFixed(1);
          console.log(`[SCORM GEOMETRY] WINDOW_RESIZE target=SCO innerWidth=${frameWin.innerWidth} innerHeight=${frameWin.innerHeight} time=${now}`);
          logComprehensiveGeometry('T6_AFTER_RESIZE_SCO_WIN');
        });
      }

      if (loadingOverlay) loadingOverlay.style.display = 'none';

      if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
        window.parent.postMessage({ type: 'SCORM_LOADED', payload: { scoUrl: finalScoUrl } }, parentOrigin);
      }

      // Mốc T4 (250ms sau render), T5 (trước khi người dùng resize) và thực thi ROOT-CAUSE PROOF R1, R2, R3
      setTimeout(async () => {
        logComprehensiveGeometry('T4_POST_RENDER_250MS');
        logComprehensiveGeometry('T5_BEFORE_USER_RESIZE');
        logBreakpointState('BEFORE_NATIVE');
        if (frameDoc) {
          inspectRenderSurfaces('BEFORE_NATIVE', frameDoc, frameWin);
          inspectFreshQuizState('INITIAL_LOAD');

          // Thực hiện thử nghiệm khoa học R1, R2, R3 tự động tại mốc T5
          await runRootCauseProof(frameWin, frameDoc);

          // Gắn listener lắng nghe người dùng tương tác với Quiz (chọn đáp án / bấm nút)
          try {
            frameDoc.addEventListener('click', () => {
              setTimeout(() => {
                inspectFreshQuizState('AFTER_CLICK_INTERACTION');
              }, 300);
            }, true);
          } catch {}
        }
      }, 350);
    };

    contentFrame.onerror = (err) => {
      console.error('❌ [SCORM Player] Failed to load SCO content frame:', err);
      inspectFrameState('onerror');
      showError('Không thể tải nội dung bài giảng qua Gateway.');
    };

    // Nạp đường dẫn cùng Origin B (Chỉ mount đúng 1 lần sau khi SCORM_RESTORE_READY)
    if (!hasScoMounted) {
      hasScoMounted = true;
      console.log(`[SCORM RESTORE] SCO_MOUNT_START url=${finalScoUrl}`);
      logComprehensiveGeometry('T0_BEFORE_SCO_MOUNT');
      contentFrame.src = finalScoUrl;
    }
  }
})();
