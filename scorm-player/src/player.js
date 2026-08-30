import { createScorm12Api, createScorm2004Api } from './scormApi.js';

/**
 * SCORM Player Bootstrap (Isolated Origin App - Port 4174)
 * Khởi tạo môi trường runtime, nạp dữ liệu tiến độ đã lưu (Resume),
 * và đồng bộ trạng thái học tập (CMI Commit/Finish/Terminate) an toàn.
 */
(async function initScormPlayer() {
  console.log('🎮 [SCORM Player] Initializing Isolated Player Module with CMI Persistence (Port 4174)...');

  // 1. Tạo RUN_ID duy nhất cho mỗi phiên khởi chạy SCO
  const runId = Math.random().toString(36).substring(2, 8);
  window.__SCORM_CURRENT_RUN_ID = runId;

  // 1. Phân tích tham số khởi chạy từ Query Params
  const urlParams = new URLSearchParams(window.location.search);
  const sessionToken = urlParams.get('session') || '';
  const explicitLaunch = urlParams.get('launch') || '';
  const studentName = urlParams.get('studentName') || 'Học sinh';
  const parentOrigin = urlParams.get('parentOrigin') || '';
  let scormVersion = urlParams.get('version') || '1.2';
  const isDiagFresh = urlParams.get('scormDiagFresh') === '1';

  if (isDiagFresh) {
    console.log(`[SCORM RUN ${runId}] [SCORM DIAG FRESH MODE] ENABLED`);
    console.log(`[SCORM RUN ${runId}] [SCORM DIAG FRESH MODE] persisted tracking intentionally ignored in-memory only`);
    console.log(`[SCORM RUN ${runId}] [SCORM DIAG FRESH MODE] database writes disabled`);
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
        console.warn(`[SCORM RUN ${runId}] [SCORM Player] postMessage to parent failed:`, postErr.message);
      }
    }
  }

  // 4. ZERO-RACE DETERMINISTIC LIFECYCLE: Chờ nhận persisted CMI state TRƯỚC KHI tạo API & mount SCO
  console.log(`[SCORM RUN ${runId}] SCORM_RESTORE_START`);

  async function resolveInitialTracking() {
    // Nếu chạy độc lập không có parent hoặc parentOrigin không thiết lập
    if (!window.parent || window.parent === window || !parentOrigin || parentOrigin === '*') {
      const standaloneTracking = (persistedTracking && !isDiagFresh) ? persistedTracking : null;
      console.log(`[SCORM RUN ${runId}] INITIAL_CMI_STATE_RECEIVED hasTracking=${Boolean(standaloneTracking)}`);
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
            console.log(`[SCORM RUN ${runId}] INITIAL_CMI_STATE_RECEIVED hasTracking=${Boolean(receivedTracking)}`);
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
          console.warn(`[SCORM RUN ${runId}] [SCORM RESTORE] Handshake timeout (2s), fallback to session-info tracking`);
          console.log(`[SCORM RUN ${runId}] INITIAL_CMI_STATE_RECEIVED hasTracking=${Boolean(fallbackTracking)}`);
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

  console.log(`[SCORM RUN ${runId}] ✅ Attached window.API (1.2) and window.API_1484_11 (2004). Target: ${scormVersion}`);

  const is2004 = scormVersion === '2004' || String(scormVersion).startsWith('2004');
  const activeApi = is2004 ? window.API_1484_11 : window.API;
  const initialCmi = activeApi && typeof activeApi._getCmi === 'function' ? activeApi._getCmi() : {};
  const initialEntry = is2004 ? (initialCmi['cmi.entry'] || '') : (initialCmi['cmi.core.entry'] || '');
  const initialLoc = is2004 ? (initialCmi['cmi.location'] || '') : (initialCmi['cmi.core.lesson_location'] || '');
  const initialSusData = initialCmi['cmi.suspend_data'] || '';

  // 6. SCORM RESTORE READY: Xác nhận CMI state đã sẵn sàng 100%
  console.log(`[SCORM RUN ${runId}] SCORM_RESTORE_READY entry=${initialEntry} suspendLength=${initialSusData.length} location=${initialLoc}`);

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

    // 9. DEEP VISIBILITY, COMPUTED STYLE, PAINT & OVERLAY INSPECTOR
    let isLayoutSuccess = false;
    let attemptCount = 0;
    let activeContentObserver = null;
    let pendingRafId = null;

    function cleanupContentObserver() {
      if (activeContentObserver) {
        activeContentObserver.disconnect();
        activeContentObserver = null;
      }
      if (pendingRafId) {
        cancelAnimationFrame(pendingRafId);
        pendingRafId = null;
      }
    }

    // 1. Log chi tiết Computed Style, Rect, Z-index, Transform của toàn bộ các tầng
    function logDeepVisibilityAndStyle(stageLabel) {
      const frameWin = contentFrame ? contentFrame.contentWindow : null;
      const frameDoc = contentFrame ? (contentFrame.contentDocument || frameWin?.document) : null;
      if (!frameDoc || !frameWin) return;

      console.log(`========================================================`);
      console.log(`[SCORM RUN ${runId}] 🔬 [DEEP STYLE & VISIBILITY] === ${stageLabel} ===`);

      const targets = [
        { name: 'playerView', sel: '.playerView, [class*="playerView"]' },
        { name: 'framesLayer', sel: '.framesLayerContent, [class*="framesLayer"]' },
        { name: 'slidesBg', sel: '#slidesBackground, [id*="slidesBackground"]' },
        { name: 'slideView', sel: '.slideView, [class*="slideView"], [class*="slide"]' },
        { name: 'quizRoot', sel: '.quizView, [class*="quizView"], [id*="quiz"]' },
        { name: 'firstSvg', sel: 'svg' },
        { name: 'firstCanvas', sel: 'canvas' },
        { name: 'firstImg', sel: 'img' },
      ];

      targets.forEach(({ name, sel }) => {
        const el = frameDoc.querySelector(sel);
        if (!el) {
          console.log(`  ${name.padEnd(12)}: NOT_FOUND in DOM`);
          return;
        }

        const s = frameWin.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const rStr = `[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}]`;
        const clientStr = `${el.clientWidth}x${el.clientHeight}`;
        const offsetStr = `${el.offsetWidth}x${el.offsetHeight}`;
        const tf = s.transform !== 'none' ? ` tf="${s.transform}"` : ' tf=none';
        const z = s.zIndex !== 'auto' ? ` zIndex=${s.zIndex}` : ' zIndex=auto';
        const pos = s.position;
        const bg = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent' ? ` bg="${s.backgroundColor}"` : '';

        console.log(`  ${name.padEnd(12)}: rect=${rStr} client=${clientStr} offset=${offsetStr} disp=${s.display} vis=${s.visibility} op=${s.opacity} pos=${pos}${z} ov=${s.overflow}${tf}${bg}`);
      });
    }

    // 2. Kiểm tra Element From Point (3-5 điểm giữa slide) và Quét Layer Phủ (Overlays)
    function inspectElementFromPointAndOverlays(stageLabel) {
      const frameWin = contentFrame ? contentFrame.contentWindow : null;
      const frameDoc = contentFrame ? (contentFrame.contentDocument || frameWin?.document) : null;
      if (!frameDoc || !frameWin) return;

      console.log(`--------------------------------------------------------`);
      console.log(`[SCORM RUN ${runId}] 🎯 [PAINT & OVERLAY PROOF] === ${stageLabel} ===`);

      const w = frameWin.innerWidth;
      const h = frameWin.innerHeight;
      const points = [
        { name: 'Center', x: Math.round(w / 2), y: Math.round(h / 2) },
        { name: 'Top-Center', x: Math.round(w / 2), y: Math.round(h * 0.25) },
        { name: 'Bottom-Center', x: Math.round(w / 2), y: Math.round(h * 0.75) },
        { name: 'Left-Center', x: Math.round(w * 0.25), y: Math.round(h / 2) },
        { name: 'Right-Center', x: Math.round(w * 0.75), y: Math.round(h / 2) },
      ];

      points.forEach(({ name, x, y }) => {
        try {
          const topEl = frameDoc.elementFromPoint(x, y);
          if (!topEl) {
            console.log(`  [VISIBLE PROOF] point=(${x},${y}) [${name}] topElement=NULL`);
            return;
          }
          const tag = topEl.tagName ? topEl.tagName.toLowerCase() : 'node';
          const id = topEl.id ? `#${topEl.id}` : '';
          const cls = typeof topEl.className === 'string' && topEl.className ? `.${topEl.className.substring(0, 20)}` : '';
          const r = topEl.getBoundingClientRect();
          const s = frameWin.getComputedStyle(topEl);
          console.log(`  [VISIBLE PROOF] point=(${x},${y}) [${name}] topElement=<${tag}${id}${cls}> rect=[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}] bg="${s.backgroundColor}" z=${s.zIndex}`);
        } catch (efpErr) {
          console.warn(`  [VISIBLE PROOF] point=(${x},${y}) error:`, efpErr.message);
        }
      });

      // Quét tất cả các element có khả năng là Overlay trắng che khuất
      try {
        const allEls = Array.from(frameDoc.querySelectorAll('*'));
        let foundOverlays = 0;
        allEls.forEach((el) => {
          const s = frameWin.getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const isLarge = r.width >= (w * 0.5) && r.height >= (h * 0.4);
          const isPositioned = s.position === 'absolute' || s.position === 'fixed';
          const isVisible = s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0;

          if (isLarge && isPositioned && isVisible) {
            foundOverlays++;
            const tag = el.tagName ? el.tagName.toLowerCase() : 'el';
            const id = el.id ? `#${el.id}` : '';
            const cls = typeof el.className === 'string' && el.className ? `.${el.className.substring(0, 25)}` : '';
            console.log(`  [OVERLAY SCAN #${foundOverlays}] target=<${tag}${id}${cls}> rect=[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}] z=${s.zIndex} bg="${s.backgroundColor}" op=${s.opacity} pe=${s.pointerEvents}`);
          }
        });
        if (foundOverlays === 0) {
          console.log(`  [OVERLAY SCAN] No blocking large overlays detected.`);
        }
      } catch (scanErr) {
        console.warn('  [OVERLAY SCAN] scan error:', scanErr.message);
      }

      // Quét các class/attribute kích hoạt slide (active, current, visible, hidden, aria-hidden)
      try {
        const activeEls = frameDoc.querySelectorAll('[class*="active"], [class*="current"], [class*="visible"], [class*="hidden"], [aria-hidden], [data-state]');
        console.log(`  [SLIDE STATE ATTRS] Total matching state nodes: ${activeEls.length}`);
        Array.from(activeEls).slice(0, 5).forEach((el, idx) => {
          const tag = el.tagName ? el.tagName.toLowerCase() : 'el';
          const cls = el.className || '-';
          const ariaH = el.getAttribute('aria-hidden');
          const dataSt = el.getAttribute('data-state');
          console.log(`    stateNode#${idx + 1}: <${tag}> cls="${cls}" aria-hidden=${ariaH} data-state=${dataSt}`);
        });
      } catch (stErr) {
        console.warn('  [SLIDE STATE ATTRS] error:', stErr.message);
      }
      console.log(`========================================================`);
    }

    function checkMeaningfulContentAndGeometry(frameDoc, frameWin) {
      if (!frameDoc) return { hasMeaningfulContent: false, isValidGeometry: false, geomStr: 'no-doc', countsStr: 'no-doc', flW: 0, flH: 0, sbW: 0, sbH: 0 };

      const fl = frameDoc.querySelector('.framesLayerContent, [class*="framesLayer"]');
      const sb = frameDoc.querySelector('#slidesBackground, [id*="slidesBackground"]');
      const svgs = frameDoc.querySelectorAll('svg');
      const canvases = frameDoc.querySelectorAll('canvas');
      const imgs = frameDoc.querySelectorAll('img');
      const videos = frameDoc.querySelectorAll('video');
      const iframes = frameDoc.querySelectorAll('iframe, frame');

      const flW = fl ? Math.round(fl.getBoundingClientRect().width) : 0;
      const flH = fl ? Math.round(fl.getBoundingClientRect().height) : 0;
      const sbW = sb ? Math.round(sb.getBoundingClientRect().width) : 0;
      const sbH = sb ? Math.round(sb.getBoundingClientRect().height) : 0;

      const flCount = fl ? fl.childElementCount : 0;
      const sbCount = sb ? sb.childElementCount : 0;

      const hasMeaningfulContent = (
        svgs.length > 0 ||
        canvases.length > 0 ||
        imgs.length > 0 ||
        videos.length > 0 ||
        iframes.length > 0 ||
        flCount > 0 ||
        sbCount > 0
      );

      const isValidGeometry = (flW > 10 && flH > 10) || (sbW > 10 && sbH > 10);
      const geomStr = `frames=${flW}x${flH} slides=${sbW}x${sbH}`;
      const countsStr = `framesChildren=${flCount} slidesChildren=${sbCount} svg=${svgs.length} canvas=${canvases.length} img=${imgs.length}`;

      return {
        hasMeaningfulContent,
        isValidGeometry,
        flW, flH, sbW, sbH,
        geomStr,
        countsStr,
      };
    }

    function tryContentAwareLayout(source = 'MUTATION') {
      if (isLayoutSuccess) return;

      const frameWin = contentFrame ? contentFrame.contentWindow : null;
      const frameDoc = contentFrame ? (contentFrame.contentDocument || frameWin?.document) : null;
      if (!frameWin || !frameDoc) return;

      const state = checkMeaningfulContentAndGeometry(frameDoc, frameWin);
      if (state.isValidGeometry) {
        isLayoutSuccess = true;
        console.log(`[SCORM RUN ${runId}] [ISPRING LAYOUT] ALREADY_VALID (${state.geomStr})`);
        console.log(`[SCORM RUN ${runId}] [ISPRING LAYOUT] observer=disconnected`);
        cleanupContentObserver();
        logDeepVisibilityAndStyle('ALREADY_VALID');
        inspectElementFromPointAndOverlays('ALREADY_VALID');
        return;
      }

      if (!state.hasMeaningfulContent) return;

      let targetObj = null;
      let targetMethodName = null;

      if (frameWin.player && typeof frameWin.player.updateLayout === 'function') {
        targetObj = frameWin.player;
        targetMethodName = 'player.updateLayout';
      } else if (frameWin.player && typeof frameWin.player.invalidateSize === 'function') {
        targetObj = frameWin.player;
        targetMethodName = 'player.invalidateSize';
      } else if (typeof frameWin.invalidatePlayerSize === 'function') {
        targetObj = frameWin;
        targetMethodName = 'window.invalidatePlayerSize';
      } else if (frameWin.PresentationPlayer && typeof frameWin.PresentationPlayer.invalidateSize === 'function') {
        targetObj = frameWin.PresentationPlayer;
        targetMethodName = 'PresentationPlayer.invalidateSize';
      }

      if (!targetObj || !targetMethodName) return;

      if (pendingRafId) cancelAnimationFrame(pendingRafId);

      pendingRafId = requestAnimationFrame(() => {
        pendingRafId = requestAnimationFrame(() => {
          pendingRafId = null;
          if (isLayoutSuccess) return;

          attemptCount++;
          console.log(`[SCORM RUN ${runId}] [ISPRING LAYOUT] CONTENT_READY_ATTEMPT number=${attemptCount} (source=${source})`);

          try {
            const fnName = targetMethodName.split('.').pop();
            targetObj[fnName]();
          } catch (triggerErr) {
            console.warn(`[SCORM RUN ${runId}] [ISPRING LAYOUT] Error in attempt #${attemptCount}:`, triggerErr.message);
          }

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const afterState = checkMeaningfulContentAndGeometry(frameDoc, frameWin);
              const success = afterState.isValidGeometry;
              console.log(`[SCORM RUN ${runId}] [ISPRING LAYOUT] RESULT number=${attemptCount} frames=${afterState.flW}x${afterState.flH} slides=${afterState.sbW}x${afterState.sbH} success=${success}`);

              // Chụp toàn bộ Computed Style & ElementFromPoint ngay sau attempt
              logDeepVisibilityAndStyle(`AFTER_ATTEMPT_${attemptCount}`);
              inspectElementFromPointAndOverlays(`AFTER_ATTEMPT_${attemptCount}`);

              if (success) {
                isLayoutSuccess = true;
                console.log(`[SCORM RUN ${runId}] [ISPRING LAYOUT] INITIAL_LAYOUT_COMPLETE`);
                console.log(`[SCORM RUN ${runId}] [ISPRING LAYOUT] observer=disconnected`);
                cleanupContentObserver();
              }
            });
          });
        });
      });
    }

    // Gắn MutationObserver vào content root của iSpring
    function setupContentAwareObserver(frameDoc, frameWin) {
      if (!frameDoc || !frameDoc.body || isLayoutSuccess) return;
      cleanupContentObserver();

      const initialState = checkMeaningfulContentAndGeometry(frameDoc, frameWin);
      if (initialState.isValidGeometry) {
        isLayoutSuccess = true;
        console.log(`[SCORM RUN ${runId}] [ISPRING LAYOUT] ALREADY_VALID (${initialState.geomStr})`);
        console.log(`[SCORM RUN ${runId}] [ISPRING LAYOUT] observer=disconnected`);
        logDeepVisibilityAndStyle('INITIAL_ALREADY_VALID');
        inspectElementFromPointAndOverlays('INITIAL_ALREADY_VALID');
        return;
      }

      const targetEl = frameDoc.querySelector('.playerView') || frameDoc.body;
      const targetTag = targetEl.tagName ? targetEl.tagName.toLowerCase() : 'div';
      const targetCls = typeof targetEl.className === 'string' && targetEl.className ? `.${targetEl.className.substring(0, 15)}` : '';
      console.log(`[SCORM RUN ${runId}] [ISPRING CONTENT] OBSERVER_ATTACHED target=<${targetTag}${targetCls}>`);

      activeContentObserver = new MutationObserver((mutations) => {
        if (isLayoutSuccess) {
          cleanupContentObserver();
          return;
        }

        let hasNewNodes = false;
        mutations.forEach((m) => {
          if (m.addedNodes && m.addedNodes.length > 0) hasNewNodes = true;
          if (m.type === 'attributes') {
            const attr = m.attributeName;
            const target = m.target;
            const tTag = target.tagName ? target.tagName.toLowerCase() : 'el';
            const tCls = target.className || '-';
            const oldV = m.oldValue;
            const newV = target.getAttribute(attr);
            console.log(`[SCORM RUN ${runId}] [ISPRING VISIBILITY MUTATION] target=<${tTag} cls="${tCls}"> attr=${attr} old="${oldV}" new="${newV}"`);
          }
        });

        if (hasNewNodes) {
          const s = checkMeaningfulContentAndGeometry(frameDoc, frameWin);
          console.log(`[SCORM RUN ${runId}] [ISPRING CONTENT] MUTATION ${s.countsStr} geometry=${s.geomStr}`);
          tryContentAwareLayout('MUTATION_BATCH');
        }
      });

      activeContentObserver.observe(targetEl, { childList: true, subtree: true, attributes: true, attributeOldValue: true });

      if (initialState.hasMeaningfulContent) {
        tryContentAwareLayout('INITIAL_CONTENT_CHECK');
      }
    }

    // Lắng nghe Native User Resize để đo lường so sánh trước và sau
    window.addEventListener('resize', () => {
      const frameWin = contentFrame ? contentFrame.contentWindow : null;
      const frameDoc = contentFrame ? (contentFrame.contentDocument || frameWin?.document) : null;
      if (frameDoc && frameWin) {
        console.log(`[SCORM RUN ${runId}] 🖱️ [NATIVE RESIZE TRIGGERED]`);
        logDeepVisibilityAndStyle('NATIVE_RESIZE_BEFORE');
        inspectElementFromPointAndOverlays('NATIVE_RESIZE_BEFORE');

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            logDeepVisibilityAndStyle('NATIVE_RESIZE_AFTER');
            inspectElementFromPointAndOverlays('NATIVE_RESIZE_AFTER');
          });
        });
      }
    });

    // Hook Element setAttribute & className setter để bắt chính xác Call Stack của iSpring khi kích hoạt slide
    function hookSlideActivationCallStack(frameWin) {
      if (!frameWin || frameWin.__activation_stack_hooked) return;
      frameWin.__activation_stack_hooked = true;

      try {
        const origSetAttribute = frameWin.Element.prototype.setAttribute;
        frameWin.Element.prototype.setAttribute = function (name, value) {
          const sVal = String(value);
          const cls = this.className || '';
          if (
            (name === 'class' && (sVal.includes('active') || sVal.includes('current')) && (cls.includes('slide') || cls.includes('frame') || cls.includes('quiz') || sVal.includes('slide'))) ||
            (name === 'style' && (sVal.includes('display: block') || sVal.includes('visibility: visible') || sVal.includes('opacity: 1')) && (cls.includes('slide') || cls.includes('frame') || cls.includes('quiz'))) ||
            (name === 'aria-hidden' && sVal === 'false')
          ) {
            const stack = new Error().stack || '';
            const tag = this.tagName ? this.tagName.toLowerCase() : 'node';
            const id = this.id ? `#${this.id}` : '';
            console.log(`[SCORM RUN ${runId}] 🎯 [SLIDE ACTIVATION STACK] target=<${tag}${id} class="${cls}"> attr=${name} value="${sVal}"`);
            console.log(`[SCORM RUN ${runId}] [SLIDE ACTIVATION CALL CHAIN]:\n${stack.split('\n').slice(1, 10).join('\n')}`);
          }
          return origSetAttribute.apply(this, arguments);
        };

        const classDesc = Object.getOwnPropertyDescriptor(frameWin.Element.prototype, 'className');
        if (classDesc && classDesc.set) {
          const origClassSet = classDesc.set;
          Object.defineProperty(frameWin.Element.prototype, 'className', {
            get: classDesc.get,
            set: function (val) {
              const sVal = String(val);
              if ((sVal.includes('active') || sVal.includes('current')) && ((this.className || '').includes('slide') || sVal.includes('slide'))) {
                const stack = new Error().stack || '';
                console.log(`[SCORM RUN ${runId}] 🎯 [SLIDE ACTIVATION STACK] className setter target=<${this.tagName.toLowerCase()} class="${this.className}"> new="${sVal}"`);
                console.log(`[SCORM RUN ${runId}] [SLIDE ACTIVATION CALL CHAIN]:\n${stack.split('\n').slice(1, 10).join('\n')}`);
              }
              return origClassSet.call(this, val);
            },
            configurable: true,
          });
        }
      } catch (hookErr) {
        console.warn('[SLIDE ACTIVATION STACK] hook error:', hookErr.message);
      }
    }

    contentFrame.onload = () => {
      console.log(`[SCORM RUN ${runId}] 🎯 SCO Content loaded successfully into frame from Same-Origin Gateway.`);
      inspectFrameState('onload');

      const frameWin = contentFrame.contentWindow;
      const frameDoc = contentFrame.contentDocument || frameWin?.document;

      if (frameWin) {
        hookSlideActivationCallStack(frameWin);
      }

      if (loadingOverlay) loadingOverlay.style.display = 'none';

      if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
        window.parent.postMessage({ type: 'SCORM_LOADED', payload: { scoUrl: finalScoUrl } }, parentOrigin);
      }

      setupContentAwareObserver(frameDoc, frameWin);
    };

    window.addEventListener('pagehide', cleanupContentObserver);
    window.addEventListener('beforeunload', cleanupContentObserver);

    contentFrame.onerror = (err) => {
      console.error(`[SCORM RUN ${runId}] ❌ Failed to load SCO content frame:`, err);
      inspectFrameState('onerror');
      showError('Không thể tải nội dung bài giảng qua Gateway.');
    };

    // Nạp đường dẫn cùng Origin B (Chỉ mount đúng 1 lần sau khi SCORM_RESTORE_READY)
    if (!hasScoMounted) {
      hasScoMounted = true;
      console.log(`[SCORM RUN ${runId}] [SCORM RESTORE] SCO_MOUNT_START url=${finalScoUrl}`);
      contentFrame.src = finalScoUrl;
    }
  }
})();
