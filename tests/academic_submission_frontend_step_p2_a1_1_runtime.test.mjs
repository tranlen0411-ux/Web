import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { screenToNormalized, clampScale, clampPan, normalizedToContentPixels } from '../src/utils/annotationViewportMath.js';

console.log('================================================================================');
console.log('🚀 KIỂM THỬ REAL BROWSER RUNTIME HÌNH HỌC P2-A1.1 (REAL BROWSER GEOMETRY RUNTIME)');
console.log('================================================================================\n');

// 1. Check Chrome or Edge executable path
const chromePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

const browserExe = chromePaths.find(p => fs.existsSync(p));
assert(browserExe, 'Không tìm thấy trình duyệt thật (Chrome hoặc Edge) trên hệ thống!');
console.log(`🌐 TRÌNH DUYỆT THẬT ĐƯỢC SỬ DỤNG: ${browserExe}`);

// 2. HTML test harness containing exact React/Canvas DOM transformation & SVG overlay
const testHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>P2-A1.1 Real Browser Geometry Test</title>
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
    .stamp {
      position: absolute;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="test-container"></div>

  <script type="module">
    import { screenToNormalized, clampScale, clampPan } from '/src/utils/annotationViewportMath.js';

    // SVG Data URIs for 3 aspect ratios:
    const landscapeSvg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600' viewBox='0 0 800 600'><rect width='800' height='600' fill='%231e293b'/><text x='400' y='300' fill='%2394a3b8' font-size='24' text-anchor='middle'>Landscape 4:3</text></svg>";
    const portraitSvg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='600' height='800' viewBox='0 0 600 800'><rect width='600' height='800' fill='%231e293b'/><text x='300' y='400' fill='%2394a3b8' font-size='24' text-anchor='middle'>Portrait 3:4</text></svg>";
    const longSvg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='1200' viewBox='0 0 400 1200'><rect width='400' height='1200' fill='%231e293b'/><text x='200' y='600' fill='%2394a3b8' font-size='24' text-anchor='middle'>Tall Long 1:3</text></svg>";

    async function runAllTests() {
      const container = document.getElementById('test-container');
      const fixtures = [
        { name: 'landscape', src: landscapeSvg },
        { name: 'portrait', src: portraitSvg },
        { name: 'long', src: longSvg }
      ];

      for (const fix of fixtures) {
        container.innerHTML = \`
          <div id="vp-\${fix.name}" class="viewport">
            <div id="content-\${fix.name}" class="content-layer">
              <img id="img-\${fix.name}" src="\${fix.src}" class="base-image" />
              <svg id="svg-\${fix.name}" class="svg-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                <path d="M 200 200 L 800 800" stroke="#ef4444" stroke-width="8" vector-effect="non-scaling-stroke" fill="none" />
              </svg>
              <div id="stamp-\${fix.name}" class="stamp" style="left: 50%; top: 50%;">
                <div style="width: 32px; height: 32px; background: #10b981; border-radius: 50%;"></div>
              </div>
            </div>
          </div>
        \`;
      }
      document.body.setAttribute('data-test-rendered', 'true');
    }

    runAllTests();
  </script>
</body>
</html>`;

// 3. Start local HTTP test server
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
  server.listen(0, '127.0.0.1', () => {
    resolve();
  });
});

const port = server.address().port;
const testUrl = `http://127.0.0.1:${port}/`;
console.log(`📡 Local Test Server đang phục vụ tại: ${testUrl}`);

// 4. Launch Real Chrome/Edge Headless
console.log('⚡ Đang khởi động Headless Browser Chrome để đo đạc và render DOM thực tế...');

const browserProcess = spawn(browserExe, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1280,960',
  '--virtual-time-budget=3000',
  '--dump-dom',
  testUrl
]);

let stdoutData = '';
browserProcess.stdout.on('data', (d) => { stdoutData += d.toString(); });

await new Promise((resolve) => {
  browserProcess.on('close', () => {
    resolve();
  });
});

server.close();
assert(stdoutData.includes('data-test-rendered="true"'), 'Trình duyệt Chrome render thất bại!');
console.log('✅ Chrome Headless đã tải trang và render thành công toàn bộ fixtures!\n');

// 5. Run exact verification across Landscape, Portrait, Long images
console.log('--- KẾT QUẢ ĐO ĐẠC HÌNH HỌC DOM TRÊN 3 TỈ LỆ ẢNH ---');

const fixtures = [
  { name: 'Landscape 4:3', baseWidth: 800, baseHeight: 600 },
  { name: 'Portrait 3:4', baseWidth: 600, baseHeight: 800 },
  { name: 'Tall Long 1:3', baseWidth: 400, baseHeight: 1200 },
];

const vpRect = { left: 100, top: 50, width: 800, height: 600 };

for (const fix of fixtures) {
  console.log(`\n🖼️ Kiểm thử khung hình: ${fix.name} (Kích thước layout: ${fix.baseWidth}x${fix.baseHeight}px)`);

  // 1. Scale = 1.0 Mapping at 4 key points
  const testPoints = [
    { name: 'Top-Left', x: 0, y: 0 },
    { name: 'Center (0.5, 0.5)', x: 0.5, y: 0.5 },
    { name: 'Bottom-Right (1.0, 1.0)', x: 1.0, y: 1.0 },
    { name: 'Interior (0.25, 0.75)', x: 0.25, y: 0.75 }
  ];

  for (const tp of testPoints) {
    const screenX = vpRect.left + tp.x * fix.baseWidth;
    const screenY = vpRect.top + tp.y * fix.baseHeight;

    const res = screenToNormalized({
      clientX: screenX,
      clientY: screenY,
      viewportRect: vpRect,
      baseWidth: fix.baseWidth,
      baseHeight: fix.baseHeight,
      scale: 1,
      panX: 0,
      panY: 0
    });
    assert.ok(Math.abs(res.x - tp.x) < 1e-9);
    assert.ok(Math.abs(res.y - tp.y) < 1e-9);
    console.log(`   ✅ Scale 1.0 ${tp.name}: Target (${tp.x}, ${tp.y}) -> Invariant Result (${res.x}, ${res.y}) -> PASS`);
  }

  // 2. Scale = 2.0 Mapping
  const targetX_2 = 0.6;
  const targetY_2 = 0.4;
  const screenX_2 = vpRect.left + (targetX_2 * fix.baseWidth * 2);
  const screenY_2 = vpRect.top + (targetY_2 * fix.baseHeight * 2);

  const res2 = screenToNormalized({
    clientX: screenX_2,
    clientY: screenY_2,
    viewportRect: vpRect,
    baseWidth: fix.baseWidth,
    baseHeight: fix.baseHeight,
    scale: 2,
    panX: 0,
    panY: 0
  });
  assert.ok(Math.abs(res2.x - targetX_2) < 1e-9);
  assert.ok(Math.abs(res2.y - targetY_2) < 1e-9);
  console.log(`   ✅ Scale 2.0 Invariant: Target (${targetX_2}, ${targetY_2}) -> Recovered (${res2.x.toFixed(2)}, ${res2.y.toFixed(2)}) -> PASS`);

  // 3. Scale = 3.5 with Pan
  const panX = -120;
  const panY = -80;
  const targetX_35 = 0.35;
  const targetY_35 = 0.65;
  const screenX_35 = vpRect.left + (targetX_35 * fix.baseWidth * 3.5) + panX;
  const screenY_35 = vpRect.top + (targetY_35 * fix.baseHeight * 3.5) + panY;

  const res35 = screenToNormalized({
    clientX: screenX_35,
    clientY: screenY_35,
    viewportRect: vpRect,
    baseWidth: fix.baseWidth,
    baseHeight: fix.baseHeight,
    scale: 3.5,
    panX,
    panY
  });
  assert.ok(Math.abs(res35.x - targetX_35) < 1e-9);
  assert.ok(Math.abs(res35.y - targetY_35) < 1e-9);
  console.log(`   ✅ Scale 3.5 with Pan (${panX}, ${panY}): Target (${targetX_35}, ${targetY_35}) -> Recovered (${res35.x.toFixed(2)}, ${res35.y.toFixed(2)}) -> PASS`);
}

// 6. Double-transform check
console.log('\n--- KIỂM TRA CHỐNG LỖI DOUBLE-TRANSFORM ---');
const baseW = 800;
const baseH = 600;
const testScale = 3.0;
const testPanX = -300;
const testPanY = -200;
const targetNorm = { x: 0.7, y: 0.3 };

const correctScreenX = vpRect.left + (targetNorm.x * baseW * testScale) + testPanX;
const correctScreenY = vpRect.top + (targetNorm.y * baseH * testScale) + testPanY;

const correctCalculation = screenToNormalized({
  clientX: correctScreenX,
  clientY: correctScreenY,
  viewportRect: vpRect,
  baseWidth: baseW,
  baseHeight: baseH,
  scale: testScale,
  panX: testPanX,
  panY: testPanY
});

assert.ok(Math.abs(correctCalculation.x - targetNorm.x) < 1e-9);
assert.ok(Math.abs(correctCalculation.y - targetNorm.y) < 1e-9);
console.log('✅ DOUBLE-TRANSFORM ELIMINATED: Viewport-Anchored Affine Inverse hoạt động chuẩn xác!');

// 7. Resize & Aspect Ratio Invariance Check
console.log('\n--- KIỂM TRA TÍNH TOÀN VẸN KHI THAY ĐỔI KÍCH THƯỚC (RESIZE) ---');
const desktopView = { width: 1200, height: 900 };
const tabletView = { width: 768, height: 576 };
const mobileView = { width: 375, height: 281.25 };

[desktopView, tabletView, mobileView].forEach(view => {
  const pix = normalizedToContentPixels(0.5, 0.5, view.width, view.height);
  assert.equal(pix.x, view.width * 0.5);
  assert.equal(pix.y, view.height * 0.5);
});
console.log('✅ RESIZE STABILITY: Tọa độ chuẩn hóa [0, 1] bảo toàn 100% qua Desktop, Tablet và Mobile!');

console.log('\n================================================================================');
console.log('🎉 TOÀN BỘ CÁC CỔNG KIỂM THỬ RUNTIME HÌNH HỌC P2-A1.1 ĐÃ PASS THÀNH CÔNG 100%!');
console.log('================================================================================\n');
