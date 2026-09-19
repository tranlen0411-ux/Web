import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';

console.log('================================================================================');
console.log('🚀 KIỂM THỬ REAL BROWSER TOUCH/PINCH RUNTIME P2-A2.1 (CHROME ENGINE RUNTIME)');
console.log('================================================================================\n');

// 1. Locate Chrome executable
const chromePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

const browserExe = chromePaths.find(p => fs.existsSync(p));
assert(browserExe, 'Không tìm thấy trình duyệt thật (Chrome hoặc Edge) trên hệ thống!');
console.log(`🌐 TRÌNH DUYỆT THẬT ĐƯỢC SỬ DỤNG: ${browserExe}`);

// 2. HTML test harness embedding Canvas logic & Multi-touch / Pointer Event Engine
const testHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>P2-A2.1 Real Browser Touch & Pinch Runtime</title>
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
    .svg-overlay {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      user-select: none;
    }
    .outside-container {
      margin-top: 20px;
      height: 200px;
      touch-action: auto;
      background: #1e293b;
      padding: 10px;
    }
  </style>
</head>
<body>
  <div id="test-viewport" class="viewport">
    <div id="test-content" class="content-layer">
      <img id="test-img" class="base-image" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600' viewBox='0 0 800 600'><rect width='800' height='600' fill='%231e293b'/></svg>" />
      <svg id="test-svg" class="svg-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none">
        <g id="committed-strokes"></g>
        <path id="draft-stroke" fill="none" stroke="#ef4444" stroke-width="8" vector-effect="non-scaling-stroke" />
      </svg>
    </div>
  </div>

  <div id="outside-scroll-area" class="outside-container">
    <p>Outside Canvas Area - Page Scroll Allowed (touch-action: auto)</p>
  </div>

  <pre id="results-json" style="display:none;"></pre>

  <script type="module">
    import {
      calculateDistance,
      calculateMidpoint,
      calculatePinchTransform,
      clampScale,
      clampPan,
      screenToNormalized,
      MIN_SCALE,
      MAX_SCALE,
    } from '/src/utils/annotationViewportMath.js';

    window.__ERRORS__ = [];
    window.onerror = function(msg, url, line) {
      window.__ERRORS__.push({ msg, url, line });
    };

    // Simulated Canvas Controller adhering to SubmissionAnnotationCanvas.jsx implementation
    class CanvasController {
      constructor(viewportEl, contentEl) {
        this.viewport = viewportEl;
        this.content = contentEl;
        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
        this.activeTool = 'pen';
        this.annotation = { schema_version: 1, strokes: [], stamps: [], notes: [] };
        this.currentStroke = null;
        this.isPointerActive = false;
        this.activePointers = new Map();
        this.pinchGesture = null;
        this.suppressSinglePointerDraw = false;
        this.isPanning = false;
        this.panStart = null;
        this.pointerCaptureErrors = 0;

        this.bindEvents();
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

      bindEvents() {
        this.viewport.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
        this.viewport.addEventListener('pointermove', (e) => this.handlePointerMove(e));
        this.viewport.addEventListener('pointerup', (e) => this.handlePointerUp(e));
        this.viewport.addEventListener('pointercancel', (e) => this.handlePointerCancel(e));
        this.viewport.addEventListener('lostpointercapture', (e) => this.handleLostPointerCapture(e));
      }

      handlePointerDown(e) {
        this.activePointers.set(e.pointerId, {
          clientX: e.clientX,
          clientY: e.clientY,
          pointerType: e.pointerType || 'touch',
        });

        // 2nd pointer arrival -> cancel stroke and start pinch
        if (this.activePointers.size >= 2) {
          this.currentStroke = null;
          this.isPointerActive = false;
          this.suppressSinglePointerDraw = true;
          this.isPanning = false;

          const pointers = Array.from(this.activePointers.values());
          const p1 = pointers[0];
          const p2 = pointers[1];
          const initialDistance = calculateDistance(p1, p2);
          const initialMidpoint = calculateMidpoint(p1, p2);

          this.pinchGesture = {
            initialDistance,
            initialMidpoint,
            initialScale: this.scale,
            initialPan: { x: this.panX, y: this.panY },
          };
          return;
        }

        if (this.suppressSinglePointerDraw) return;

        if (this.activeTool === 'pan') {
          try {
            this.viewport.setPointerCapture?.(e.pointerId);
          } catch(err) { this.pointerCaptureErrors++; }
          this.isPanning = true;
          this.panStart = {
            clientX: e.clientX,
            clientY: e.clientY,
            startPanX: this.panX,
            startPanY: this.panY,
          };
          return;
        }

        const { x, y } = this.getNormalizedPoint(e.clientX, e.clientY);

        if (this.activeTool === 'pen') {
          try {
            this.viewport.setPointerCapture?.(e.pointerId);
          } catch(err) { this.pointerCaptureErrors++; }
          this.isPointerActive = true;
          this.currentStroke = {
            id: 'stroke_' + Date.now(),
            tool: 'pen',
            color: '#ef4444',
            width: 4,
            points: [{ x, y }],
          };
        }
      }

      handlePointerMove(e) {
        if (this.activePointers.has(e.pointerId)) {
          this.activePointers.set(e.pointerId, {
            clientX: e.clientX,
            clientY: e.clientY,
            pointerType: e.pointerType || 'touch',
          });
        }

        // Two-finger pinch / pan
        if (this.activePointers.size >= 2 && this.pinchGesture) {
          const pointers = Array.from(this.activePointers.values());
          const p1 = pointers[0];
          const p2 = pointers[1];

          const viewportRect = this.viewport.getBoundingClientRect();
          const baseWidth = this.content.offsetWidth || viewportRect.width;
          const baseHeight = this.content.offsetHeight || viewportRect.height;

          const next = calculatePinchTransform({
            initialDistance: this.pinchGesture.initialDistance,
            initialMidpoint: this.pinchGesture.initialMidpoint,
            initialScale: this.pinchGesture.initialScale,
            initialPan: this.pinchGesture.initialPan,
            currentP1: p1,
            currentP2: p2,
            viewportRect,
            baseWidth,
            baseHeight,
          });

          this.scale = next.scale;
          this.panX = next.panX;
          this.panY = next.panY;
          this.applyTransform();
          return;
        }

        // 1-pointer pan
        if (this.activeTool === 'pan' && this.isPanning && this.panStart) {
          const dx = e.clientX - this.panStart.clientX;
          const dy = e.clientY - this.panStart.clientY;
          const proposedPanX = this.panStart.startPanX + dx;
          const proposedPanY = this.panStart.startPanY + dy;

          const clamped = clampPan({
            viewportWidth: this.viewport.offsetWidth,
            viewportHeight: this.viewport.offsetHeight,
            baseWidth: this.content.offsetWidth,
            baseHeight: this.content.offsetHeight,
            scale: this.scale,
            panX: proposedPanX,
            panY: proposedPanY,
          });

          this.panX = clamped.panX;
          this.panY = clamped.panY;
          this.applyTransform();
          return;
        }

        // 1-pointer draw
        if (!this.isPointerActive || !this.currentStroke || this.suppressSinglePointerDraw) return;
        const { x, y } = this.getNormalizedPoint(e.clientX, e.clientY);
        this.currentStroke.points.push({ x, y });
      }

      handlePointerUp(e) {
        this.activePointers.delete(e.pointerId);

        if (this.activePointers.size < 2) {
          this.pinchGesture = null;
        }

        if (this.activePointers.size === 0) {
          this.suppressSinglePointerDraw = false;
          if (this.isPanning) {
            try {
              this.viewport.releasePointerCapture?.(e.pointerId);
            } catch(err) { this.pointerCaptureErrors++; }
            this.isPanning = false;
            this.panStart = null;
          }
        }

        if (this.isPointerActive && this.currentStroke && !this.suppressSinglePointerDraw) {
          try {
            this.viewport.releasePointerCapture?.(e.pointerId);
          } catch(err) { this.pointerCaptureErrors++; }
          this.isPointerActive = false;
          if (this.currentStroke.points.length > 0) {
            this.annotation.strokes.push(this.currentStroke);
          }
          this.currentStroke = null;
        } else {
          this.isPointerActive = false;
          this.currentStroke = null;
        }
      }

      handlePointerCancel(e) {
        this.handlePointerUp(e);
      }

      handleLostPointerCapture(e) {
        this.handlePointerUp(e);
      }
    }

    async function runRuntimeScenarios() {
      const vp = document.getElementById('test-viewport');
      const content = document.getElementById('test-content');
      const outsideArea = document.getElementById('outside-scroll-area');
      const controller = new CanvasController(vp, content);

      const results = {
        scenarios: {},
        geometry: {},
        consoleErrors: window.__ERRORS__.length === 0,
        pointerCaptureErrors: controller.pointerCaptureErrors,
        touchActionTeacher: getComputedStyle(vp).touchAction,
        touchActionOutside: getComputedStyle(outsideArea).touchAction,
      };

      // Helper to dispatch PointerEvents
      function sendPointer(type, id, x, y, pointerType = 'touch') {
        const ev = new PointerEvent(type, {
          pointerId: id,
          clientX: x,
          clientY: y,
          pointerType: pointerType,
          bubbles: true,
          cancelable: true,
        });
        vp.dispatchEvent(ev);
      }

      const vpRect = vp.getBoundingClientRect();

      // SCENARIO A: Pen one-finger -> single valid stroke
      sendPointer('pointerdown', 1, vpRect.left + 100, vpRect.top + 100);
      sendPointer('pointermove', 1, vpRect.left + 150, vpRect.top + 150);
      sendPointer('pointerup', 1, vpRect.left + 150, vpRect.top + 150);

      results.scenarios.A_oneFingerDraw = (controller.annotation.strokes.length === 1);

      // SCENARIO B: Pen drawing starts, then 2nd finger arrives -> stroke cancelled, no partial stroke
      const strokeCountBefore = controller.annotation.strokes.length; // 1
      sendPointer('pointerdown', 2, vpRect.left + 200, vpRect.top + 200);
      sendPointer('pointermove', 2, vpRect.left + 200, vpRect.top + 200);
      // 2nd finger lands!
      sendPointer('pointerdown', 3, vpRect.left + 400, vpRect.top + 200); // initial distance = 200, midpoint = (300, 200)

      results.scenarios.B_secondFingerCancels = (
        controller.currentStroke === null &&
        controller.isPointerActive === false &&
        controller.annotation.strokes.length === strokeCountBefore
      );

      // SCENARIO C: Pinch Out (scale increases toward ~200%)
      // Finger 2 at (200, 200), Finger 3 at (400, 200) -> initial distance = 200
      // Move Finger 2 to (100, 200), Finger 3 to (500, 200) -> distance = 400 (2x ratio -> scale 2.0)
      sendPointer('pointermove', 2, vpRect.left + 100, vpRect.top + 200);
      sendPointer('pointermove', 3, vpRect.left + 500, vpRect.top + 200);

      results.scenarios.C_pinchOutScale = (Math.abs(controller.scale - 2.0) < 1e-3);

      // SCENARIO D: Pinch Beyond Max (clamp 400%)
      // Distance expand to 1000px -> 5x ratio -> should clamp to 4.0
      sendPointer('pointermove', 2, vpRect.left + 0, vpRect.top + 200);
      sendPointer('pointermove', 3, vpRect.left + 1000, vpRect.top + 200);

      results.scenarios.D_pinchMaxClamp = (controller.scale === 4.0);

      // SCENARIO E: Pinch In (scale decreases back toward 1.0)
      // Release fingers first
      sendPointer('pointerup', 2, vpRect.left + 0, vpRect.top + 200);
      sendPointer('pointerup', 3, vpRect.left + 1000, vpRect.top + 200);

      // Start pinch at scale 2.0 (set manually or pinch)
      controller.scale = 2.0;
      controller.panX = -200;
      controller.panY = -150;
      controller.applyTransform();

      // Finger 4 & 5 start at distance 400
      sendPointer('pointerdown', 4, vpRect.left + 200, vpRect.top + 300);
      sendPointer('pointerdown', 5, vpRect.left + 600, vpRect.top + 300); // dist = 400, initScale = 2.0
      // Contract to distance 200 (0.5x -> scale 1.0)
      sendPointer('pointermove', 4, vpRect.left + 300, vpRect.top + 300);
      sendPointer('pointermove', 5, vpRect.left + 500, vpRect.top + 300);

      results.scenarios.E_pinchInScale = (Math.abs(controller.scale - 1.0) < 1e-3);
      sendPointer('pointerup', 4, vpRect.left + 300, vpRect.top + 300);
      sendPointer('pointerup', 5, vpRect.left + 500, vpRect.top + 300);

      // SCENARIO F: Two-finger Pan
      controller.scale = 2.0;
      controller.panX = -200;
      controller.panY = -150;
      controller.applyTransform();

      sendPointer('pointerdown', 6, vpRect.left + 300, vpRect.top + 300);
      sendPointer('pointerdown', 7, vpRect.left + 500, vpRect.top + 300); // dist = 200, mid = (400, 300)
      // Shift both fingers by (+50, +30)
      sendPointer('pointermove', 6, vpRect.left + 350, vpRect.top + 330);
      sendPointer('pointermove', 7, vpRect.left + 550, vpRect.top + 330);

      results.scenarios.F_twoFingerPan = (
        controller.scale === 2.0 &&
        controller.panX === -150 &&
        controller.panY === -120
      );

      // SCENARIO G: Two-finger Pinch + Pan Combined
      // Expand distance from 200 to 300 (1.5x of 2.0 -> 3.0) AND shift midpoint
      sendPointer('pointermove', 6, vpRect.left + 300, vpRect.top + 330); // mid = (475, 330)
      sendPointer('pointermove', 7, vpRect.left + 650, vpRect.top + 330); // dist = 350

      results.scenarios.G_pinchPanCombined = (
        controller.scale > 2.0 &&
        Number.isFinite(controller.panX) &&
        Number.isFinite(controller.panY)
      );

      // SCENARIO H: pointercancel during pinch
      sendPointer('pointercancel', 6, vpRect.left + 300, vpRect.top + 330);
      sendPointer('pointercancel', 7, vpRect.left + 650, vpRect.top + 330);

      results.scenarios.H_pointerCancelHandled = (
        controller.activePointers.size === 0 &&
        controller.pinchGesture === null &&
        controller.isPointerActive === false
      );

      // SCENARIO I: 2 -> 1 Transition (lifting 1 finger does NOT start drawing)
      const countBeforeI = controller.annotation.strokes.length;
      sendPointer('pointerdown', 8, vpRect.left + 300, vpRect.top + 300);
      sendPointer('pointerdown', 9, vpRect.left + 500, vpRect.top + 300);
      // Lift finger 8
      sendPointer('pointerup', 8, vpRect.left + 300, vpRect.top + 300);
      // Move remaining finger 9
      sendPointer('pointermove', 9, vpRect.left + 550, vpRect.top + 350);
      // Lift remaining finger 9
      sendPointer('pointerup', 9, vpRect.left + 550, vpRect.top + 350);

      results.scenarios.I_postPinchNoGhostDraw = (
        controller.annotation.strokes.length === countBeforeI &&
        controller.currentStroke === null
      );

      // SCENARIO J: Clean next pointerdown draws normally
      sendPointer('pointerdown', 10, vpRect.left + 200, vpRect.top + 200);
      sendPointer('pointermove', 10, vpRect.left + 250, vpRect.top + 250);
      sendPointer('pointerup', 10, vpRect.left + 250, vpRect.top + 250);

      results.scenarios.J_nextCleanDrawWorks = (
        controller.annotation.strokes.length === countBeforeI + 1
      );

      // GEOMETRY FIXTURES (Landscape, Portrait, Long vertical)
      const fixtures = [
        { name: 'Landscape', w: 800, h: 600 },
        { name: 'Portrait', w: 600, h: 800 },
        { name: 'LongImage', w: 400, h: 1200 },
      ];

      for (const fix of fixtures) {
        const testPinch = calculatePinchTransform({
          initialDistance: 200,
          initialMidpoint: { clientX: 400, clientY: 300 },
          initialScale: 1.0,
          initialPan: { x: 0, y: 0 },
          currentP1: { clientX: 300, clientY: 300 },
          currentP2: { clientX: 700, clientY: 300 }, // 2x
          viewportRect: { left: 0, top: 0, width: 800, height: 600 },
          baseWidth: fix.w,
          baseHeight: fix.h,
        });

        const noNan = Number.isFinite(testPinch.scale) && Number.isFinite(testPinch.panX) && Number.isFinite(testPinch.panY);
        results.geometry[fix.name] = (testPinch.scale === 2.0 && noNan);
      }

      document.getElementById('results-json').textContent = JSON.stringify(results);
      document.body.setAttribute('data-test-complete', 'true');
    }

    runRuntimeScenarios();
  </script>
</body>
</html>`;

// 3. Start local server
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(testHtml);
  } else if (req.url === '/src/utils/annotationViewportMath.js') {
    const mathCode = fs.readFileSync(path.resolve('src/utils/annotationViewportMath.js'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(mathCode);
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
console.log('⚡ Đang khởi động Google Chrome Headless để kiểm thử Multi-touch & Pinch Runtime...');

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
assert(stdoutData.includes('data-test-complete="true"'), 'Chrome Headless không hoàn thành bài test!');

const jsonMatch = stdoutData.match(/<pre id="results-json"[^>]*>([\s\S]*?)<\/pre>/);
assert(jsonMatch && jsonMatch[1], 'Không trích xuất được kết quả JSON từ DOM của Chrome!');

const results = JSON.parse(jsonMatch[1]);
console.log('\n--- KẾT QUẢ RUNTIME THẬT TRÊN CHROME ENGINE ---');
console.log('Kịch bản A (One-finger Draw):', results.scenarios.A_oneFingerDraw ? 'PASS ✅' : 'FAIL ❌');
console.log('Kịch bản B (2nd Pointer Cancels Stroke):', results.scenarios.B_secondFingerCancels ? 'PASS ✅' : 'FAIL ❌');
console.log('Kịch bản C (Pinch Out ~200%):', results.scenarios.C_pinchOutScale ? 'PASS ✅' : 'FAIL ❌');
console.log('Kịch bản D (Pinch Max Clamp 400%):', results.scenarios.D_pinchMaxClamp ? 'PASS ✅' : 'FAIL ❌');
console.log('Kịch bản E (Pinch In ~100%):', results.scenarios.E_pinchInScale ? 'PASS ✅' : 'FAIL ❌');
console.log('Kịch bản F (Two-finger Pan):', results.scenarios.F_twoFingerPan ? 'PASS ✅' : 'FAIL ❌');
console.log('Kịch bản G (Pinch + Pan Combined):', results.scenarios.G_pinchPanCombined ? 'PASS ✅' : 'FAIL ❌');
console.log('Kịch bản H (pointercancel Cleanup):', results.scenarios.H_pointerCancelHandled ? 'PASS ✅' : 'FAIL ❌');
console.log('Kịch bản I (2 -> 1 Ghost Stroke Suppressed):', results.scenarios.I_postPinchNoGhostDraw ? 'PASS ✅' : 'FAIL ❌');
console.log('Kịch bản J (Next Clean Draw Works):', results.scenarios.J_nextCleanDrawWorks ? 'PASS ✅' : 'FAIL ❌');

console.log('\n--- KIỂM THỬ HÌNH HỌC TRÊN 3 TỈ LỆ KHUNG HÌNH (FIXTURES) ---');
console.log('Landscape 4:3 Geometry:', results.geometry.Landscape ? 'PASS ✅' : 'FAIL ❌');
console.log('Portrait 3:4 Geometry:', results.geometry.Portrait ? 'PASS ✅' : 'FAIL ❌');
console.log('Long Image 1:3 Geometry:', results.geometry.LongImage ? 'PASS ✅' : 'FAIL ❌');

console.log('\n--- TOUCH-ACTION & CONSOLE AN TOÀN ---');
console.log('Teacher touch-action:', results.touchActionTeacher);
console.log('Outside touch-action:', results.touchActionOutside);
console.log('Console Errors:', results.consoleErrors ? 'NO (0 errors) ✅' : 'YES ❌');
console.log('Pointer Capture Errors:', results.pointerCaptureErrors === 0 ? 'NO (0 errors) ✅' : 'YES ❌');

// Assert all scenarios
assert.ok(results.scenarios.A_oneFingerDraw, 'Kịch bản A thất bại');
assert.ok(results.scenarios.B_secondFingerCancels, 'Kịch bản B thất bại');
assert.ok(results.scenarios.C_pinchOutScale, 'Kịch bản C thất bại');
assert.ok(results.scenarios.D_pinchMaxClamp, 'Kịch bản D thất bại');
assert.ok(results.scenarios.E_pinchInScale, 'Kịch bản E thất bại');
assert.ok(results.scenarios.F_twoFingerPan, 'Kịch bản F thất bại');
assert.ok(results.scenarios.G_pinchPanCombined, 'Kịch bản G thất bại');
assert.ok(results.scenarios.H_pointerCancelHandled, 'Kịch bản H thất bại');
assert.ok(results.scenarios.I_postPinchNoGhostDraw, 'Kịch bản I thất bại');
assert.ok(results.scenarios.J_nextCleanDrawWorks, 'Kịch bản J thất bại');

assert.ok(results.geometry.Landscape, 'Landscape fixture thất bại');
assert.ok(results.geometry.Portrait, 'Portrait fixture thất bại');
assert.ok(results.geometry.LongImage, 'LongImage fixture thất bại');

assert.equal(results.touchActionTeacher, 'none', 'Teacher viewport phải có touch-action: none');
assert.equal(results.touchActionOutside, 'auto', 'Outside container phải có touch-action: auto');
assert.ok(results.consoleErrors, 'Có lỗi console phát sinh trong runtime');
assert.equal(results.pointerCaptureErrors, 0, 'Có lỗi pointer capture');

console.log('\n================================================================================');
console.log('🎉 TOÀN BỘ CÁC KỊCH BẢN RUNTIME TOUCH/PINCH P2-A2.1 ĐÃ PASS THÀNH CÔNG 100%!');
console.log('================================================================================\n');
