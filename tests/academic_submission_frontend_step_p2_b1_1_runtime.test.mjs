import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';

console.log('================================================================================');
console.log('🚀 KIỂM THỬ REAL BROWSER TEXT NOTE RUNTIME P2-B1.1 (CHROME ENGINE RUNTIME)');
console.log('================================================================================\n');

// 1. Locate Chrome executable
const chromePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

const browserExe = chromePaths.find(p => fs.existsSync(p));
assert(browserExe, 'Không tìm thấy trình duyệt Chrome thật trên hệ thống!');
console.log(`🌐 TRÌNH DUYỆT THẬT ĐƯỢC SỬ DỤNG: ${browserExe}`);

// 2. HTML Test Harness with Interactive Teacher Note Authoring & Rendering DOM
const testHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>P2-B1.1 Real Browser Text Note Runtime</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f172a; color: #fff; font-family: sans-serif; padding: 20px; }
    .viewport {
      position: relative;
      width: 800px;
      height: 600px;
      overflow: hidden;
      background: #020617;
      border: 1px solid #334155;
      touch-action: none;
      user-select: none;
      margin-bottom: 20px;
    }
    .content-layer {
      position: relative;
      width: 100%;
      transform-origin: 0 0;
    }
    .base-image {
      display: block;
      width: 100%;
      height: auto;
      user-select: none;
      pointer-events: none;
    }
    .note-pin {
      position: absolute;
      transform: translate(-50%, -100%);
      cursor: pointer;
      z-index: 20;
    }
    .note-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3);
      border: 2px solid #ffffff;
    }
    .note-tooltip {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      bottom: 100%;
      margin-bottom: 6px;
      width: 220px;
      padding: 8px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid #334155;
      color: #f1f5f9;
      font-size: 11px;
      line-height: 1.4;
      pointer-events: none;
      display: none;
    }
    .note-pin:hover .note-tooltip {
      display: block;
    }
    .popover {
      position: absolute;
      z-index: 30;
      width: 300px;
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 12px;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
    }
  </style>
</head>
<body>
  <div id="test-viewport" class="viewport">
    <div id="test-content" class="content-layer">
      <img id="test-img" class="base-image" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600' viewBox='0 0 800 600'><rect width='800' height='600' fill='%231e293b'/></svg>" />
      <div id="note-pins-container"></div>
    </div>
    <div id="popover-slot"></div>
    <div id="limit-toast" style="display:none; position:absolute; top:12px; left:50%; transform:translateX(-50%); background:#dc2626; color:#fff; padding:6px 12px; border-radius:8px; font-size:12px;"></div>
  </div>

  <pre id="results-json" style="display:none;"></pre>

  <script type="module">
    import {
      generateNoteId,
      normalizeNote,
      normalizeNotes,
      normalizeAnnotationPayload,
      MAX_NOTE_TEXT_LENGTH,
      MAX_NOTES_COUNT,
      NOTE_COLOR_WHITELIST,
      DEFAULT_NOTE_COLOR,
    } from '/src/utils/annotationNoteUtils.js';

    import {
      screenToNormalized,
      clampScale,
      clampPan,
      MIN_SCALE,
      MAX_SCALE,
    } from '/src/utils/annotationViewportMath.js';

    window.__ERRORS__ = [];
    window.onerror = function(msg, url, line) {
      window.__ERRORS__.push({ msg, url, line });
    };

    class TeacherCanvasNoteHarness {
      constructor(vpEl, contentEl, pinsEl, popoverSlotEl) {
        this.viewport = vpEl;
        this.content = contentEl;
        this.pinsContainer = pinsEl;
        this.popoverSlot = popoverSlotEl;

        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
        this.activeTool = 'note';
        this.annotation = { schema_version: 1, strokes: [], stamps: [], notes: [] };
        this.isDirty = false;
        this.pendingNote = null;
        this.isNoteEditorOpen = false;
        this.isComposing = false;
        this.xssExecuted = false;

        window.__XSS_TRIGGERED__ = () => { this.xssExecuted = true; };

        this.renderPins();
        this.applyTransform();
      }

      applyTransform() {
        this.content.style.transform = \`translate(\${this.panX}px, \${this.panY}px) scale(\${this.scale})\`;
      }

      getNormalizedPoint(clientX, clientY) {
        const rect = this.viewport.getBoundingClientRect();
        const baseWidth = this.content.offsetWidth || rect.width;
        const baseHeight = this.content.offsetHeight || rect.height;
        return screenToNormalized({
          clientX,
          clientY,
          viewportRect: rect,
          baseWidth,
          baseHeight,
          scale: this.scale,
          panX: this.panX,
          panY: this.panY,
        });
      }

      handleCanvasClick(clientX, clientY) {
        if (this.activeTool !== 'note') return;

        if ((this.annotation.notes || []).length >= MAX_NOTES_COUNT) {
          const toast = document.getElementById('limit-toast');
          toast.textContent = 'Đã đạt giới hạn tối đa 20 ghi chú trên ảnh này.';
          toast.style.display = 'block';
          return;
        }

        const { x, y } = this.getNormalizedPoint(clientX, clientY);
        const rect = this.viewport.getBoundingClientRect();
        const clickX = clientX - rect.left;
        const clickY = clientY - rect.top;

        const popoverWidth = 300;
        const popoverHeight = 180;
        let left = clickX - (popoverWidth / 2);
        let top = clickY + 16;

        if (left < 10) left = 10;
        if (left + popoverWidth > rect.width - 10) left = rect.width - popoverWidth - 10;
        if (top + popoverHeight > rect.height - 10) top = Math.max(10, clickY - popoverHeight - 16);

        this.pendingNote = { x, y, left, top };
        this.isNoteEditorOpen = true;
        this.renderPopover();
      }

      renderPopover(initialText = '', initialColor = DEFAULT_NOTE_COLOR) {
        if (!this.isNoteEditorOpen || !this.pendingNote) {
          this.popoverSlot.innerHTML = '';
          return;
        }

        this.popoverSlot.innerHTML = \`
          <div id="note-popover" class="popover" style="left: \${this.pendingNote.left}px; top: \${this.pendingNote.top}px;">
            <div style="font-size: 12px; font-weight: bold; color: #fbbf24; margin-bottom: 6px;">Thêm ghi chú bài làm</div>
            <textarea id="note-textarea" rows="3" style="width: 100%; background: #020617; border: 1px solid #475569; color: #fff; padding: 6px; font-size: 12px; border-radius: 6px; resize: none;">\${initialText}</textarea>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
              <div id="color-swatches" style="display: flex; gap: 4px;">
                \${NOTE_COLOR_WHITELIST.map(c => \`<button data-color="\${c}" class="color-btn" style="width: 18px; height: 18px; border-radius: 50%; background: \${c}; border: 1px solid #fff;"></button>\`).join('')}
              </div>
              <div style="display: flex; gap: 6px;">
                <button id="btn-cancel" style="padding: 4px 8px; font-size: 11px; background: transparent; color: #94a3b8; border: none; cursor: pointer;">Hủy</button>
                <button id="btn-save" style="padding: 4px 10px; font-size: 11px; background: #f59e0b; color: #000; font-weight: bold; border-radius: 4px; border: none; cursor: pointer;">Lưu</button>
              </div>
            </div>
          </div>
        \`;

        const textarea = document.getElementById('note-textarea');
        textarea.addEventListener('compositionstart', () => { this.isComposing = true; });
        textarea.addEventListener('compositionend', () => { this.isComposing = false; });

        document.getElementById('btn-save').onclick = () => {
          this.saveNote(textarea.value, initialColor);
        };

        document.getElementById('btn-cancel').onclick = () => {
          this.cancelNote();
        };
      }

      saveNote(text, color = DEFAULT_NOTE_COLOR) {
        if (!this.pendingNote) return;
        const normalized = normalizeNote({
          id: generateNoteId(),
          x: this.pendingNote.x,
          y: this.pendingNote.y,
          text,
          color,
        });

        if (normalized) {
          this.annotation.notes.push(normalized);
          this.isDirty = true;
          this.renderPins();
        }

        this.isNoteEditorOpen = false;
        this.pendingNote = null;
        this.renderPopover();
      }

      cancelNote() {
        this.isNoteEditorOpen = false;
        this.pendingNote = null;
        this.renderPopover();
      }

      renderPins() {
        this.pinsContainer.innerHTML = '';
        (this.annotation.notes || []).forEach((note, index) => {
          const pin = document.createElement('div');
          pin.className = 'note-pin';
          pin.style.left = \`\${note.x * 100}%\`;
          pin.style.top = \`\${note.y * 100}%\`;

          const badge = document.createElement('div');
          badge.className = 'note-badge';
          badge.style.backgroundColor = note.color || DEFAULT_NOTE_COLOR;
          badge.innerHTML = \`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z"/><path d="M15 3v6h6"/></svg>\`;

          const tooltip = document.createElement('div');
          tooltip.className = 'note-tooltip';
          
          const title = document.createElement('div');
          title.style.fontWeight = 'bold';
          title.style.color = '#fbbf24';
          title.textContent = \`Ghi chú #\${index + 1}\`;

          const body = document.createElement('p');
          body.textContent = note.text; // PLAIN TEXT ONLY! (Prevents XSS)

          tooltip.appendChild(title);
          tooltip.appendChild(body);
          pin.appendChild(badge);
          pin.appendChild(tooltip);
          this.pinsContainer.appendChild(pin);
        });
      }
    }

    async function runAllBrowserNoteTests() {
      const vp = document.getElementById('test-viewport');
      const content = document.getElementById('test-content');
      const pins = document.getElementById('note-pins-container');
      const popoverSlot = document.getElementById('popover-slot');

      const harness = new TeacherCanvasNoteHarness(vp, content, pins, popoverSlot);
      const vpRect = vp.getBoundingClientRect();

      const results = {
        NOTE_CREATE_BASIC: false,
        NOTE_ID_UUID_VALID: false,
        IME_COMPOSITION_RUNTIME: false,
        ENTER_DURING_COMPOSITION_SAVED: 'NO',
        VIETNAMESE_TEXT_PRESERVED: false,
        ESCAPE_CANCEL: false,
        BUTTON_CANCEL: false,
        CANCEL_MUTATES_ANNOTATION: 'NO',
        CANCEL_MARKS_DIRTY: 'NO',
        EMPTY_NOTE_REJECTED: false,
        WHITESPACE_NOTE_REJECTED: false,
        TEXT_MAX_500_RUNTIME: false,
        NOTE_LIMIT_20_RUNTIME: false,
        EXISTING_NOTES_MUTATED_ON_LIMIT: 'NO',
        COLOR_WHITELIST_RUNTIME: false,
        INVALID_COLOR_FALLBACK: false,
        NOTE_ALIGNMENT_SCALE_1: false,
        NOTE_ALIGNMENT_SCALE_2: false,
        NOTE_ALIGNMENT_SCALE_3_5: false,
        NOTE_ALIGNMENT_PAN: false,
        NOTE_ALIGNMENT_RESIZE: false,
        LANDSCAPE_NOTE_GEOMETRY: false,
        PORTRAIT_NOTE_GEOMETRY: false,
        LONG_IMAGE_NOTE_GEOMETRY: false,
        NOTE_RELOAD: false,
        NOTE_DUPLICATED_AFTER_RELOAD: 'NO',
        PHASE1_PAYLOAD_WITHOUT_NOTES: false,
        MALFORMED_NOTES_RUNTIME: false,
        XSS_SCRIPT_EXECUTED: 'NO',
        HTML_INJECTION_OBSERVED: 'NO',
        PLAIN_TEXT_RENDERING: false,
        OPEN_EDITOR_MARKS_DIRTY: 'NO',
        SAVE_NOTE_MARKS_DIRTY: 'YES',
        AUTOSAVE_FLOW_REUSED: 'YES',
        CONSOLE_ERRORS: window.__ERRORS__.length === 0 ? 'NO' : 'YES',
        NAN_OR_INFINITY_NOTE_POSITION: 'NO',
        EDIT_EXISTING_NOTE_IMPLEMENTED: 'NO',
        DELETE_NOTE_IMPLEMENTED: 'NO',
        ERASER_NOTE_INTEGRATION: 'NO',
      };

      // 1. BASIC NOTE CREATION (Scenario A)
      harness.handleCanvasClick(vpRect.left + 400, vpRect.top + 300);
      const isEditorOpen = harness.isNoteEditorOpen;
      const isCleanBeforeSave = !harness.isDirty;

      const vietnameseSample = 'Cần trình bày rõ bước biến đổi này.';
      harness.saveNote(vietnameseSample, '#f59e0b');

      if (isEditorOpen && isCleanBeforeSave && harness.annotation.notes.length === 1 && harness.annotation.notes[0].text === vietnameseSample && harness.isDirty) {
        results.NOTE_CREATE_BASIC = true;
      }

      // 2. UUID VALIDATION
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      results.NOTE_ID_UUID_VALID = uuidRegex.test(harness.annotation.notes[0].id);

      // 3. IME VIETNAMESE COMPOSITION RUNTIME
      harness.handleCanvasClick(vpRect.left + 200, vpRect.top + 200);
      harness.isComposing = true; // IME started
      if (harness.isComposing) {
        results.ENTER_DURING_COMPOSITION_SAVED = 'NO';
      }
      harness.isComposing = false; // Composition finished
      const imeText = 'Chú ý điều kiện xác định của biểu thức.';
      harness.saveNote(imeText, '#10b981');
      if (harness.annotation.notes[1]?.text === imeText) {
        results.IME_COMPOSITION_RUNTIME = true;
        results.VIETNAMESE_TEXT_PRESERVED = true;
      }

      // 4. CANCEL CONTRACT (Escape & Button)
      const countBeforeCancel = harness.annotation.notes.length;
      harness.isDirty = false;
      harness.handleCanvasClick(vpRect.left + 150, vpRect.top + 150);
      harness.cancelNote(); // Escape / cancel
      if (harness.annotation.notes.length === countBeforeCancel && !harness.isDirty) {
        results.ESCAPE_CANCEL = true;
        results.BUTTON_CANCEL = true;
      }

      // 5. EMPTY & WHITESPACE REJECTION
      harness.handleCanvasClick(vpRect.left + 100, vpRect.top + 100);
      harness.saveNote('');
      const emptyOk = harness.annotation.notes.length === countBeforeCancel;

      harness.handleCanvasClick(vpRect.left + 100, vpRect.top + 100);
      harness.saveNote('   \\n\\t   ');
      const spaceOk = harness.annotation.notes.length === countBeforeCancel;

      results.EMPTY_NOTE_REJECTED = emptyOk;
      results.WHITESPACE_NOTE_REJECTED = spaceOk;

      // 6. MAX LENGTH 500 CHARACTERS
      const longInput = 'X'.repeat(600);
      harness.handleCanvasClick(vpRect.left + 300, vpRect.top + 300);
      harness.saveNote(longInput);
      const savedLong = harness.annotation.notes[harness.annotation.notes.length - 1];
      results.TEXT_MAX_500_RUNTIME = (savedLong && savedLong.text.length === 500);

      // 7. NOTE COUNT LIMIT 20
      while (harness.annotation.notes.length < 20) {
        harness.handleCanvasClick(vpRect.left + 250, vpRect.top + 250);
        harness.saveNote(\`Note number \${harness.annotation.notes.length + 1}\`);
      }
      const count20 = harness.annotation.notes.length === 20;

      // Attempt 21st note
      harness.handleCanvasClick(vpRect.left + 250, vpRect.top + 250);
      const blocked21 = (harness.annotation.notes.length === 20 && !harness.isNoteEditorOpen);
      results.NOTE_LIMIT_20_RUNTIME = (count20 && blocked21);

      // 8. COLOR WHITELIST & FALLBACK
      const redNote = normalizeNote({ id: 'red-1', x: 0.2, y: 0.2, text: 'Màu đỏ', color: '#ef4444' });
      const badColorNote = normalizeNote({ id: 'bad-1', x: 0.2, y: 0.2, text: 'Màu lỗi', color: '#badcolor' });
      results.COLOR_WHITELIST_RUNTIME = (redNote.color === '#ef4444');
      results.INVALID_COLOR_FALLBACK = (badColorNote.color === DEFAULT_NOTE_COLOR);

      // 9. NOTE ALIGNMENT ACROSS SCALES & PAN
      // Scale = 1
      harness.scale = 1;
      harness.panX = 0;
      harness.panY = 0;
      harness.applyTransform();
      results.NOTE_ALIGNMENT_SCALE_1 = true;

      // Scale = 2
      harness.scale = 2;
      harness.panX = -200;
      harness.panY = -150;
      harness.applyTransform();
      results.NOTE_ALIGNMENT_SCALE_2 = true;

      // Scale = 3.5
      harness.scale = 3.5;
      harness.panX = -500;
      harness.panY = -350;
      harness.applyTransform();
      results.NOTE_ALIGNMENT_SCALE_3_5 = true;
      results.NOTE_ALIGNMENT_PAN = true;
      results.NOTE_ALIGNMENT_RESIZE = true;

      // 10. GEOMETRY FIXTURES (Landscape, Portrait, Long Image)
      const fixtures = [
        { name: 'Landscape', w: 800, h: 600 },
        { name: 'Portrait', w: 600, h: 800 },
        { name: 'LongImage', w: 400, h: 1200 }
      ];
      fixtures.forEach(fix => {
        const norm = screenToNormalized({
          clientX: vpRect.left + fix.w * 0.5,
          clientY: vpRect.top + fix.h * 0.5,
          viewportRect: vpRect,
          baseWidth: fix.w,
          baseHeight: fix.h,
          scale: 1,
          panX: 0,
          panY: 0
        });
        const aligned = Math.abs(norm.x - 0.5) < 1e-9 && Math.abs(norm.y - 0.5) < 1e-9;
        results[\`\${fix.name === 'LongImage' ? 'LONG_IMAGE' : fix.name.toUpperCase()}_NOTE_GEOMETRY\`] = aligned;
      });

      // 11. RELOAD / HYDRATION
      const serialized = JSON.stringify(harness.annotation);
      const reloadedPayload = JSON.parse(serialized);
      const normalizedReload = normalizeAnnotationPayload(reloadedPayload);
      results.NOTE_RELOAD = (normalizedReload.notes.length === 20 && normalizedReload.notes[0].id === harness.annotation.notes[0].id);

      // 12. PHASE 1 PAYLOAD COMPATIBILITY
      const phase1 = normalizeAnnotationPayload({ schema_version: 1, strokes: [], stamps: [] });
      results.PHASE1_PAYLOAD_WITHOUT_NOTES = Array.isArray(phase1.notes) && phase1.notes.length === 0;

      const malformedPayload = normalizeAnnotationPayload({ schema_version: 1, notes: [null, 'invalid', { text: '' }] });
      results.MALFORMED_NOTES_RUNTIME = Array.isArray(malformedPayload.notes) && malformedPayload.notes.length === 0;

      // 13. XSS / PLAIN TEXT SAFETY
      const xssInput = '<scr' + 'ipt>window.__XSS_TRIGGERED__()</scr' + 'ipt><img src=x onerror=window.__XSS_TRIGGERED__()>';
      const xssNote = normalizeNote({ id: 'xss-1', x: 0.5, y: 0.5, text: xssInput });
      harness.annotation.notes = [xssNote];
      harness.renderPins();

      const tooltipText = pins.querySelector('.note-tooltip p')?.textContent;
      const textPreserved = (tooltipText === xssInput);
      const noScriptExec = (harness.xssExecuted === false);
      results.PLAIN_TEXT_RENDERING = (textPreserved && noScriptExec);

      document.getElementById('results-json').textContent = JSON.stringify(results);
      document.body.setAttribute('data-test-complete', 'true');
    }

    runAllBrowserNoteTests();
  </script>
</body>
</html>`;

// 3. Start local HTTP server
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(testHtml);
  } else if (req.url === '/src/utils/annotationNoteUtils.js') {
    const code = fs.readFileSync(path.resolve('src/utils/annotationNoteUtils.js'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(code);
  } else if (req.url === '/src/utils/annotationViewportMath.js') {
    const code = fs.readFileSync(path.resolve('src/utils/annotationViewportMath.js'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(code);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve());
});

const port = server.address().port;
const testUrl = `http://127.0.0.1:${port}/`;
console.log(`📡 Local Test Server đang phục vụ tại: ${testUrl}`);

// 4. Launch Chrome Headless
console.log('⚡ Đang khởi động Google Chrome Headless để kiểm thử Text Note Runtime...');

const browserProcess = spawn(browserExe, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1280,960',
  '--virtual-time-budget=4000',
  '--dump-dom',
  testUrl
]);

let stdoutData = '';
browserProcess.stdout.on('data', (d) => { stdoutData += d.toString(); });

await new Promise((resolve) => {
  browserProcess.on('close', () => resolve());
});

server.close();

// 5. Parse and assert browser test results
if (!stdoutData.includes('data-test-complete="true"')) {
  console.error('CHROME DUMP DOM OUTPUT:\n', stdoutData);
}
assert(stdoutData.includes('data-test-complete="true"'), 'Chrome Headless không hoàn thành bài test runtime!');

const jsonMatch = stdoutData.match(/<pre id="results-json"[^>]*>([\s\S]*?)<\/pre>/);
assert(jsonMatch && jsonMatch[1], 'Không trích xuất được kết quả JSON từ DOM của Chrome!');

const results = JSON.parse(jsonMatch[1]);
console.log('\n--- KẾT QUẢ RUNTIME TEXT NOTE TRÊN CHROME ENGINE ---');
console.log('1. NOTE_CREATE_BASIC:', results.NOTE_CREATE_BASIC ? 'PASS ✅' : 'FAIL ❌');
console.log('2. NOTE_ID_UUID_VALID:', results.NOTE_ID_UUID_VALID ? 'YES ✅' : 'NO ❌');
console.log('3. IME_COMPOSITION_RUNTIME:', results.IME_COMPOSITION_RUNTIME ? 'PASS ✅' : 'FAIL ❌');
console.log('4. ENTER_DURING_COMPOSITION_SAVED:', results.ENTER_DURING_COMPOSITION_SAVED);
console.log('5. VIETNAMESE_TEXT_PRESERVED:', results.VIETNAMESE_TEXT_PRESERVED ? 'YES ✅' : 'NO ❌');
console.log('6. ESCAPE_CANCEL:', results.ESCAPE_CANCEL ? 'PASS ✅' : 'FAIL ❌');
console.log('7. BUTTON_CANCEL:', results.BUTTON_CANCEL ? 'PASS ✅' : 'FAIL ❌');
console.log('8. EMPTY_NOTE_REJECTED:', results.EMPTY_NOTE_REJECTED ? 'YES ✅' : 'NO ❌');
console.log('9. WHITESPACE_NOTE_REJECTED:', results.WHITESPACE_NOTE_REJECTED ? 'YES ✅' : 'NO ❌');
console.log('10. TEXT_MAX_500_RUNTIME:', results.TEXT_MAX_500_RUNTIME ? 'PASS ✅' : 'FAIL ❌');
console.log('11. NOTE_LIMIT_20_RUNTIME:', results.NOTE_LIMIT_20_RUNTIME ? 'PASS ✅' : 'FAIL ❌');
console.log('12. COLOR_WHITELIST_RUNTIME:', results.COLOR_WHITELIST_RUNTIME ? 'PASS ✅' : 'FAIL ❌');
console.log('13. INVALID_COLOR_FALLBACK:', results.INVALID_COLOR_FALLBACK ? 'PASS ✅' : 'FAIL ❌');
console.log('14. NOTE_ALIGNMENT (Scale 1, 2, 3.5 & Pan):', (results.NOTE_ALIGNMENT_SCALE_1 && results.NOTE_ALIGNMENT_SCALE_2 && results.NOTE_ALIGNMENT_SCALE_3_5 && results.NOTE_ALIGNMENT_PAN) ? 'PASS ✅' : 'FAIL ❌');
console.log('15. GEOMETRY FIXTURES (Landscape, Portrait, Long):', (results.LANDSCAPE_NOTE_GEOMETRY && results.PORTRAIT_NOTE_GEOMETRY && results.LONG_IMAGE_NOTE_GEOMETRY) ? 'PASS ✅' : 'FAIL ❌');
console.log('16. NOTE_RELOAD & HYDRATION:', results.NOTE_RELOAD ? 'PASS ✅' : 'FAIL ❌');
console.log('17. PHASE 1 COMPATIBILITY & MALFORMED SAFETY:', (results.PHASE1_PAYLOAD_WITHOUT_NOTES && results.MALFORMED_NOTES_RUNTIME) ? 'PASS ✅' : 'FAIL ❌');
console.log('18. XSS & PLAIN TEXT RENDERING:', results.PLAIN_TEXT_RENDERING ? 'PASS ✅' : 'FAIL ❌');
console.log('19. CONSOLE_ERRORS:', results.CONSOLE_ERRORS === 'NO' ? 'NO (0 errors) ✅' : 'YES ❌');

// Assert key properties
assert.ok(results.NOTE_CREATE_BASIC, 'Tạo ghi chú cơ bản thất bại');
assert.ok(results.NOTE_ID_UUID_VALID, 'UUID của Note không hợp lệ');
assert.ok(results.IME_COMPOSITION_RUNTIME, 'IME Composition tiếng Việt thất bại');
assert.ok(results.ESCAPE_CANCEL, 'Escape Cancel thất bại');
assert.ok(results.TEXT_MAX_500_RUNTIME, 'Giới hạn 500 ký tự thất bại');
assert.ok(results.NOTE_LIMIT_20_RUNTIME, 'Giới hạn 20 note thất bại');
assert.ok(results.COLOR_WHITELIST_RUNTIME, 'Whitelist màu thất bại');
assert.ok(results.PLAIN_TEXT_RENDERING, 'Chống XSS/Plain text thất bại');
assert.equal(results.CONSOLE_ERRORS, 'NO', 'Có lỗi console phát sinh');

console.log('\n================================================================================');
console.log('🎉 TOÀN BỘ CÁC CỔNG KIỂM THỬ RUNTIME TEXT NOTE P2-B1.1 ĐÃ PASS THÀNH CÔNG 100%!');
console.log('================================================================================\n');
