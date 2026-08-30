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
    let lastRecordedSizes = {};

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

          console.log(`[SCORM DIAG] ${prefix} #${depth}.${idx + 1} src=${src} id=${ifr.id || '-'} name=${ifr.name || '-'} rect=${rectStr} display=${style.display || 'unknown'} visibility=${style.visibility || 'unknown'} opacity=${style.opacity || '1'} readyState=${readyState} href=${href}`);

          results.push({ ifr, ifrWin, ifrDoc, depth, index: idx, rect, src, href });

          // Hook iframe listeners & iSpring layout APIs trong nested window
          if (ifrWin && !ifrWin.__scorm_diag_attached) {
            ifrWin.__scorm_diag_attached = true;
            hookIspringLayoutApi(ifrWin, `nested frame #${depth}.${idx + 1}`);

            ifrWin.addEventListener('resize', () => {
              console.log(`[SCORM DIAG] [Nested Frame resize #${depth}.${idx + 1}] size=${ifrWin.innerWidth}x${ifrWin.innerHeight}`);
              diagnoseQuizDom(`Nested Frame resize #${depth}.${idx + 1}`);
            });
          }

          if (ifrDoc) {
            const deeper = enumerateNestedFrames(ifrDoc, depth + 1, `${prefix} #${depth}.${idx + 1} > nested frame`);
            results = results.concat(deeper);
          }
        } catch (nestErr) {
          console.warn(`[SCORM DIAG] Nested frame scan error:`, nestErr.message);
        }
      });
      return results;
    }

    // 2. Hook và Log an toàn iSpring APIs layout
    function hookIspringLayoutApi(win, contextLabel = 'SCO Window') {
      if (!win) return;
      try {
        if (typeof win.invalidatePlayerSize === 'function' && !win.invalidatePlayerSize.__wrapped) {
          const origInvalidate = win.invalidatePlayerSize;
          win.invalidatePlayerSize = function (...args) {
            console.log(`[SCORM DIAG] [${contextLabel}] [iSpring API Call] invalidatePlayerSize() invoked!`);
            const res = origInvalidate.apply(this, args);
            setTimeout(() => diagnoseQuizDom(`post-${contextLabel}-invalidatePlayerSize`), 50);
            return res;
          };
          win.invalidatePlayerSize.__wrapped = true;
        }

        if (typeof win.setPlayerSize === 'function' && !win.setPlayerSize.__wrapped) {
          const origSetSize = win.setPlayerSize;
          win.setPlayerSize = function (w, h, ...args) {
            console.log(`[SCORM DIAG] [${contextLabel}] [iSpring API Call] setPlayerSize(${w}, ${h}) invoked!`);
            const res = origSetSize.apply(this, [w, h, ...args]);
            setTimeout(() => diagnoseQuizDom(`post-${contextLabel}-setPlayerSize(${w}x${h})`), 50);
            return res;
          };
          win.setPlayerSize.__wrapped = true;
        }

        // Quét các global player objects
        ['player', 'quizPlayer', 'ispringCourse', 'presentation', 'quiz'].forEach((key) => {
          if (win[key] && typeof win[key] === 'object') {
            if (typeof win[key].invalidateSize === 'function' && !win[key].invalidateSize.__wrapped) {
              const orig = win[key].invalidateSize;
              win[key].invalidateSize = function (...args) {
                console.log(`[SCORM DIAG] [${contextLabel}] [iSpring API Call] ${key}.invalidateSize() invoked!`);
                return orig.apply(this, args);
              };
              win[key].invalidateSize.__wrapped = true;
            }
          }
        });
      } catch (hookErr) {
        console.warn(`[SCORM DIAG] Hook iSpring layout on ${contextLabel} note:`, hookErr.message);
      }
    }

    // 3. Khám phá và phân tích các nút điều khiển thật (Real Interactive Controls)
    function inspectRealInteractiveControls(doc, win, docLabel = 'SCO Document') {
      if (!doc || !doc.body) return;

      const nonControlPattern = /slides?background|background|stage|container|wrapper|scorm-content|overlay/i;
      const allElements = Array.from(doc.querySelectorAll('*'));
      const interactiveCandidates = [];

      allElements.forEach((el) => {
        try {
          const id = (el.id || '').toLowerCase();
          const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
          const tag = el.tagName.toUpperCase();
          const role = (el.getAttribute('role') || '').toLowerCase();
          const type = (el.getAttribute('type') || '').toLowerCase();

          // Bỏ qua false positives rõ ràng
          if (nonControlPattern.test(id) || (cls && nonControlPattern.test(cls) && !/button|btn|control|nav/i.test(cls))) {
            return;
          }
          if (tag === 'HTML' || tag === 'BODY' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HEAD' || tag === 'META' || tag === 'IFRAME') {
            return;
          }

          const style = win ? win.getComputedStyle(el) : {};
          const rect = el.getBoundingClientRect();
          const text = (el.innerText || el.textContent || el.value || '').trim();
          const aria = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
          const isButtonTag = tag === 'BUTTON' || (tag === 'INPUT' && (type === 'button' || type === 'submit'));
          const isRoleButton = role === 'button';
          const isPointerCursor = style.cursor === 'pointer';
          const hasOnClick = typeof el.onclick === 'function' || el.hasAttribute('onclick');
          const isInteractive = isButtonTag || isRoleButton || isPointerCursor || hasOnClick || el.tabIndex >= 0;

          if (isInteractive || /submit|next|prev|back|nộp|tiếp|quay/i.test(text) || /submit|next|prev|back/i.test(aria) || /submit|next|prev|btn|button|control/i.test(cls) || /submit|next|prev|btn|button|control/i.test(id)) {
            const display = style.display || 'unknown';
            const visibility = style.visibility || 'unknown';
            const opacity = style.opacity || '1';
            const pe = style.pointerEvents || 'auto';
            const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true' || cls.includes('disabled');
            const rectStr = `[${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}]`;

            interactiveCandidates.push({
              tag: tag.toLowerCase(),
              id: el.id || '-',
              cls: cls ? cls.substring(0, 30) : '-',
              text: text ? text.substring(0, 20).replace(/\s+/g, ' ') : '-',
              aria: aria ? aria.substring(0, 20) : '-',
              rectStr,
              rect,
              display,
              visibility,
              opacity,
              pe,
              disabled,
              isZeroSize: rect.width === 0 || rect.height === 0,
            });
          }
        } catch {
          // ignore
        }
      });

      console.log(`[SCORM DIAG] [${docLabel}] Found ${interactiveCandidates.length} potential interactive controls:`);
      interactiveCandidates.slice(0, 12).forEach((c, idx) => {
        console.log(`[SCORM DIAG] [${docLabel}] #${idx + 1} <${c.tag}> id=${c.id} cls=${c.cls} text="${c.text}" aria="${c.aria}" display=${c.display} vis=${c.visibility} op=${c.opacity} pe=${c.pe} disabled=${c.disabled} rect=${c.rectStr}`);
      });

      // Phân loại nút Submit, Next, Prev thực thụ
      function findBestControl(patterns) {
        return interactiveCandidates.find((c) => {
          const matchText = patterns.some((p) => p.test(c.text) || p.test(c.aria));
          const matchIdCls = patterns.some((p) => p.test(c.id) || p.test(c.cls));
          return (matchText || matchIdCls) && !c.cls.includes('slidesbackground') && !c.id.includes('slidesbackground');
        });
      }

      const realSubmit = findBestControl([/submit/i, /nộp/i, /check/i, /xác nhận/i, /answer/i]);
      const realNext = findBestControl([/next/i, /tiếp/i, /forward/i, /continue/i, /chevron-right/i]);
      const realPrev = findBestControl([/prev/i, /previous/i, /back/i, /trước/i, /lùi/i, /quay lại/i, /chevron-left/i]);

      console.log(`[SCORM DIAG] [${docLabel}] CLASSIFIED REAL CONTROLS:`);
      console.log(`  - REAL_SUBMIT_CONTROL: ${realSubmit ? `<${realSubmit.tag} id=${realSubmit.id}> text="${realSubmit.text}" rect=${realSubmit.rectStr} dis=${realSubmit.disabled} vis=${realSubmit.visibility} op=${realSubmit.opacity}` : 'missing'}`);
      console.log(`  - REAL_NEXT_CONTROL: ${realNext ? `<${realNext.tag} id=${realNext.id}> text="${realNext.text}" rect=${realNext.rectStr} dis=${realNext.disabled} vis=${realNext.visibility} op=${realNext.opacity}` : 'missing'}`);
      console.log(`  - REAL_PREVIOUS_CONTROL: ${realPrev ? `<${realPrev.tag} id=${realPrev.id}> text="${realPrev.text}" rect=${realPrev.rectStr} dis=${realPrev.disabled} vis=${realPrev.visibility} op=${realPrev.opacity}` : 'missing'}`);

      // Cây DOM rút gọn quanh Quiz Root nếu tìm thấy
      const quizRoot = doc.querySelector('[class*="quiz"], [id*="quiz"], [class*="player"], [class*="navigation"], [class*="toolbar"]') || doc.body;
      if (quizRoot) {
        const rootTag = quizRoot.tagName.toLowerCase();
        const rootId = quizRoot.id || '-';
        const rootCls = typeof quizRoot.className === 'string' ? quizRoot.className.substring(0, 40) : '-';
        const rootRect = quizRoot.getBoundingClientRect();
        console.log(`[SCORM DIAG] REAL_QUIZ_ROOT: <${rootTag} id="${rootId}" class="${rootCls}"> rect=[${Math.round(rootRect.left)},${Math.round(rootRect.top)},${Math.round(rootRect.width)}x${Math.round(rootRect.height)}] childNodes=${quizRoot.children.length}`);
      }
    }

    // 4. Quét Read-Only iSpring Quiz Runtime State
    function inspectIspringRuntimeState(win, contextLabel = 'SCO Window') {
      if (!win) return;
      try {
        const knownGlobals = ['ispring', 'iSpring', 'PresentationPlayer', 'player', 'quizPlayer', 'ispringCourse', 'quiz', 'courseData'];
        const stateSummary = {};

        knownGlobals.forEach((k) => {
          if (win[k] && typeof win[k] === 'object') {
            const obj = win[k];
            const safeProps = {};
            const keysToScan = ['currentSlideIndex', 'slideIndex', 'currentSlide', 'questionIndex', 'currentQuestion', 'attempts', 'maxAttempts', 'isAnswered', 'answered', 'isSubmitted', 'submitted', 'isCompleted', 'completed', 'navigationLocked', 'isNavigationLocked', 'navigationEnabled', 'isSubmitEnabled', 'submitEnabled', 'feedbackState', 'state', 'mode', 'status'];

            keysToScan.forEach((prop) => {
              if (prop in obj && typeof obj[prop] !== 'function') {
                safeProps[prop] = obj[prop];
              }
            });

            stateSummary[k] = safeProps;
          }
        });

        console.log(`[SCORM DIAG] [${contextLabel}] QUIZ_RUNTIME_STATE:`, JSON.stringify(stateSummary));
      } catch (stErr) {
        console.warn(`[SCORM DIAG] Read runtime state error:`, stErr.message);
      }
    }

    // 5. Tổng hợp snapshot chẩn đoán toàn diện
    function runComprehensiveQuizDiagnostics(triggerLabel = 'Snapshot') {
      try {
        const frameWin = contentFrame.contentWindow;
        const frameDoc = contentFrame.contentDocument || frameWin?.document;
        const vpSize = `${window.innerWidth}x${window.innerHeight}`;
        const frameClient = `${contentFrame.clientWidth}x${contentFrame.clientHeight}`;

        console.log(`========================================================`);
        console.log(`[SCORM DIAG] === QUIZ DIAGNOSTIC SNAPSHOT: ${triggerLabel} ===`);
        console.log(`[SCORM DIAG] viewport=${vpSize} frame=${frameClient}`);

        if (!frameDoc || !frameDoc.body) {
          console.log(`[SCORM DIAG] frameDoc not ready`);
          return;
        }

        // A. Quét SCO Top Document
        inspectRealInteractiveControls(frameDoc, frameWin, 'SCO Top Document');
        inspectIspringRuntimeState(frameWin, 'SCO Top Window');

        // B. Quét Nested Frame Documents
        const nestedFrames = enumerateNestedFrames(frameDoc);
        nestedFrames.forEach((nf) => {
          if (nf.ifrDoc) {
            inspectRealInteractiveControls(nf.ifrDoc, nf.ifrWin, `Nested Frame #${nf.depth}.${nf.index + 1} (${nf.src || nf.ifr.id || 'frame'})`);
            inspectIspringRuntimeState(nf.ifrWin, `Nested Frame #${nf.depth}.${nf.index + 1}`);
          }
        });

        console.log(`========================================================`);
      } catch (diagErr) {
        console.warn(`[SCORM DIAG] Snapshot error:`, diagErr.message);
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
          hookIspringLayoutApi(frameWin, 'SCO Top Window');

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
            runComprehensiveQuizDiagnostics('Frame resize');
          });

          frameWin.addEventListener('focus', () => {
            console.log('[SCORM DIAG] [Frame focus event]');
            runComprehensiveQuizDiagnostics('Frame focus');
          });

          frameWin.addEventListener('click', () => {
            setTimeout(() => runComprehensiveQuizDiagnostics('Frame click + 300ms'), 300);
            setTimeout(() => runComprehensiveQuizDiagnostics('Frame click + 1000ms'), 1000);
          });
        }
      } catch (inspectErr) {
        console.warn('[SCORM DIAG] Frame inspection note:', inspectErr.message);
      }
    }

    // Lắng nghe các sự kiện repaint/resize/visibility trên player window
    window.addEventListener('resize', () => {
      console.log(`[SCORM DIAG] [Window resize event] size=${window.innerWidth}x${window.innerHeight}`);
      runComprehensiveQuizDiagnostics('Window resize');
    });

    document.addEventListener('visibilitychange', () => {
      console.log(`[SCORM DIAG] [VisibilityChange event] state=${document.visibilityState}`);
      runComprehensiveQuizDiagnostics(`Visibility ${document.visibilityState}`);
    });

    window.addEventListener('focus', () => {
      console.log('[SCORM DIAG] [Window focus event]');
      runComprehensiveQuizDiagnostics('Window focus');
    });

    window.addEventListener('click', () => {
      setTimeout(() => runComprehensiveQuizDiagnostics('Window click + 300ms'), 300);
      setTimeout(() => runComprehensiveQuizDiagnostics('Window click + 1000ms'), 1000);
    });

    contentFrame.onload = () => {
      console.log('🎯 [SCORM Player] SCO Content loaded successfully into frame from Same-Origin Gateway.');
      inspectFrameState('onload');
      runComprehensiveQuizDiagnostics('onload T+0');

      if (loadingOverlay) loadingOverlay.style.display = 'none';

      if (window.parent && window.parent !== window && parentOrigin && parentOrigin !== '*') {
        window.parent.postMessage({ type: 'SCORM_LOADED', payload: { scoUrl: finalScoUrl } }, parentOrigin);
      }

      // Schedule interval diagnostics để bắt trạng thái sau khi user bấm YES Resume
      setTimeout(() => runComprehensiveQuizDiagnostics('Post-load T+1s'), 1000);
      setTimeout(() => runComprehensiveQuizDiagnostics('Post-load T+2s'), 2000);
      setTimeout(() => runComprehensiveQuizDiagnostics('Post-load T+4s'), 4000);
      setTimeout(() => runComprehensiveQuizDiagnostics('Post-load T+7s'), 7000);
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
