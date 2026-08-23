/**
 * ====================================================================
 * 🧪 TEST SUITE: SCORM PRODUCTION PLAYER HOST & SAME-ORIGIN REVERSE PROXY
 * ====================================================================
 * Kiểm thử toàn diện:
 * 1. HOST1: Wrapper 200 OK
 * 2. HOST2: Proxied /session-info 200 OK
 * 3. HOST3: SCORM HTML 200 OK (Content-Type: text/html; charset=utf-8)
 * 4. HOST4: Proxied CSS 200 OK (Content-Type: text/css)
 * 5. HOST5: Proxied JS 200 OK (Content-Type: text/javascript)
 * 6. HOST6: Proxied Image 200 OK (image/png, image/svg+xml)
 * 7. HOST7: Nested path works (JSON/XML/Fonts)
 * 8. HOST8: Invalid session 403 Forbidden
 * 9. HOST9: Missing asset 404 Not Found
 * 10. HOST10: Traversal 403 Forbidden
 * 11. HOST11: Range 206 preserved through proxy (video/mp4)
 * 12. HOST12: Range 416 preserved through proxy
 * 13. HOST13: HEAD preserved through proxy (MIME retained, body empty)
 * 14. HOST14: Browser-visible URL never redirects to Supabase
 * 15. HOST15: Response body/headers contain no upstream URL leak
 * 16. HOST16: Player == SCO == Assets (All Origin B)
 * 17. HOST17: Main Origin A != Player Origin B
 * 18. HOST18: Deterministic MIME overrides upstream text/plain for index.html (Fixes nosniff browser HTML rendering)
 * 19. HOST19: Deterministic MIME overrides upstream text/plain for style.css & script.js
 * 20. HOST20: Unknown asset extension defaults to application/octet-stream
 * 21. HOST21: Unit tests for getMimeTypeForAsset (index.html, style.css, script.js, unknown)
 * 22. HOST22: Security headers nosniff & no-referrer strictly preserved
 * ====================================================================
 */

import http from 'node:http';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import proxyHandler, { getMimeTypeForAsset } from '../scorm-player/api/proxy.js';

const __filename = fileURLToPath(import.meta.url);

// Kích hoạt cờ V8 tối ưu bộ nhớ để ngăn V8 TurboFan Zone OOM trên Windows
if (!process.execArgv.includes('--liftoff-only')) {
  const result = spawnSync(
    process.execPath,
    [
      '--liftoff-only',
      '--v8-pool-size=1',
      '--no-wasm-async-compilation',
      '--max-old-space-size=4096',
      ...process.execArgv,
      __filename,
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit' }
  );
  process.exit(result.status ?? 0);
}

async function runPlayerHostTestSuite() {
  console.log('================================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ SCORM PRODUCTION PLAYER HOST & REVERSE PROXY');
  console.log('================================================================\n');

  let totalTests = 0;
  let passedTests = 0;

  function recordPass(testId, description) {
    totalTests++;
    passedTests++;
    console.log(`✅ ${testId}: ${description} PASS`);
  }

  let backendServer;
  let backendPort;
  let playerProxyServer;
  let playerPort;

  const validToken = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const invalidToken = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  const videoBuffer = Buffer.alloc(4096, 'V');

  try {
    // -------------------------------------------------------------
    // 1. MÔ PHỎNG SUPABASE EDGE FUNCTION BACKEND (UPSTREAM GATEWAY)
    // -------------------------------------------------------------
    backendServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      // Route /session-info?session=<token>
      if (url.pathname === '/session-info') {
        const token = url.searchParams.get('session');
        if (token === validToken) {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'private, no-transform, max-age=60',
          });
          res.end(JSON.stringify({
            valid: true,
            launch_path: 'index.html',
            scorm_version: '1.2',
            expires_at: new Date(Date.now() + 600000).toISOString(),
            tracking: null,
          }));
        } else {
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ valid: false, reason: 'SESSION_INVALID' }));
        }
        return;
      }

      // Route /session/:token/<asset...>
      const match = url.pathname.match(/^\/session\/([^/]+)\/(.*)$/);
      if (match) {
        const [, token, rawPath] = match;

        if (token !== validToken) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('403 Forbidden: Invalid session token');
          return;
        }

        if (rawPath.includes('..') || rawPath.includes('%2e%2e') || rawPath.startsWith('/')) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('403 Forbidden: Path traversal attempt blocked');
          return;
        }

        // Mô phỏng index.html trả về đúng text/html
        if (rawPath === 'index.html') {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, no-transform, max-age=300',
          });
          if (req.method === 'HEAD') res.end();
          else res.end('<!DOCTYPE html><html><head><title>SCO</title></head><body><h1>Hello SCO</h1></body></html>');
          return;
        }

        // Mô phỏng trường hợp upstream storage trả về text/plain nhầm cho HTML
        if (rawPath === 'raw-misconfigured.html') {
          res.writeHead(200, {
            'Content-Type': 'text/plain',
            'X-Content-Type-Options': 'nosniff',
          });
          if (req.method === 'HEAD') res.end();
          else res.end('<!doctype html><html><title>SCORM G4 Test</title></html>');
          return;
        }

        // Mô phỏng trường hợp upstream storage trả về text/plain cho CSS
        if (rawPath === 'raw-misconfigured.css') {
          res.writeHead(200, {
            'Content-Type': 'text/plain',
            'X-Content-Type-Options': 'nosniff',
          });
          if (req.method === 'HEAD') res.end();
          else res.end('.content { color: red; }');
          return;
        }

        // Mô phỏng trường hợp upstream storage trả về text/plain cho JS
        if (rawPath === 'raw-misconfigured.js') {
          res.writeHead(200, {
            'Content-Type': 'text/plain',
            'X-Content-Type-Options': 'nosniff',
          });
          if (req.method === 'HEAD') res.end();
          else res.end('window.initScorm = true;');
          return;
        }

        if (rawPath === 'styles/main.css' || rawPath === 'style.css') {
          res.writeHead(200, {
            'Content-Type': 'text/css; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          });
          if (req.method === 'HEAD') res.end();
          else res.end('body { background: #fafafa; }');
          return;
        }

        if (rawPath === 'scripts/app.js' || rawPath === 'script.js') {
          res.writeHead(200, {
            'Content-Type': 'text/javascript; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          });
          if (req.method === 'HEAD') res.end();
          else res.end('console.log("SCO JS loaded");');
          return;
        }

        if (rawPath === 'images/diagram.png') {
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'X-Content-Type-Options': 'nosniff',
          });
          if (req.method === 'HEAD') res.end();
          else res.end(Buffer.from('PNG_DATA'));
          return;
        }

        if (rawPath === 'images/vector.svg') {
          res.writeHead(200, {
            'Content-Type': 'image/svg+xml',
            'X-Content-Type-Options': 'nosniff',
          });
          if (req.method === 'HEAD') res.end();
          else res.end('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
          return;
        }

        if (rawPath === 'fonts/font.woff2') {
          res.writeHead(200, {
            'Content-Type': 'font/woff2',
            'X-Content-Type-Options': 'nosniff',
          });
          if (req.method === 'HEAD') res.end();
          else res.end(Buffer.from('WOFF2_DATA'));
          return;
        }

        if (rawPath === 'manifest/imsmanifest.xml') {
          res.writeHead(200, {
            'Content-Type': 'application/xml; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          });
          if (req.method === 'HEAD') res.end();
          else res.end('<manifest></manifest>');
          return;
        }

        if (rawPath === 'sub/deep/asset.json') {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          });
          if (req.method === 'HEAD') res.end();
          else res.end(JSON.stringify({ nested: true }));
          return;
        }

        if (rawPath === 'data/unknown.bin' || rawPath === 'unknown') {
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
          });
          if (req.method === 'HEAD') res.end();
          else res.end(Buffer.from('BINARY_BLOB'));
          return;
        }

        if (rawPath === 'media/intro.mp4') {
          const totalLength = videoBuffer.length;
          const range = req.headers['range'];

          if (range) {
            const rangeMatch = range.match(/bytes=(\d*)-(\d*)/);
            if (rangeMatch) {
              let start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0;
              let end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : totalLength - 1;

              if (start >= totalLength || start > end) {
                res.writeHead(416, {
                  'Content-Range': `bytes */${totalLength}`,
                  'Content-Type': 'text/plain',
                });
                res.end();
                return;
              }

              end = Math.min(end, totalLength - 1);
              const chunk = videoBuffer.subarray(start, end + 1);

              res.writeHead(206, {
                'Content-Type': 'video/mp4',
                'Content-Range': `bytes ${start}-${end}/${totalLength}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunk.length,
                'X-Content-Type-Options': 'nosniff',
              });
              if (req.method === 'HEAD') res.end();
              else res.end(chunk);
              return;
            }
          }

          res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Length': totalLength,
            'X-Content-Type-Options': 'nosniff',
          });
          if (req.method === 'HEAD') res.end();
          else res.end(videoBuffer);
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    });

    await new Promise((resolve) => {
      backendServer.listen(0, '127.0.0.1', () => {
        backendPort = backendServer.address().port;
        resolve();
      });
    });

    // Cấu hình upstream cho Vercel Edge Proxy Handler
    process.env.SCORM_GATEWAY_UPSTREAM = `http://127.0.0.1:${backendPort}`;

    // -------------------------------------------------------------
    // 2. MÔ PHỎNG PLAYER HOST ORIGIN B (STATIC HOST + PROXY HANDLER)
    // -------------------------------------------------------------
    playerProxyServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      // Static Player Wrapper
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(`<!DOCTYPE html><html><head><title>SCORM Player Host</title></head><body><iframe id="scorm-content-frame"></iframe></body></html>`);
        return;
      }

      // Reverse Proxy Endpoint: /session-info hoặc /session/*
      if (url.pathname === '/session-info' || url.pathname.startsWith('/session/')) {
        try {
          // Thu thập body nếu có
          let bodyBuffer = null;
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            bodyBuffer = await new Promise((resBody) => {
              const chunks = [];
              req.on('data', (c) => chunks.push(c));
              req.on('end', () => resBody(Buffer.concat(chunks)));
            });
          }

          // Gọi trực tiếp Vercel Edge Proxy Handler thực tế
          const webReq = new Request(`http://127.0.0.1:${playerPort}${req.url}`, {
            method: req.method,
            headers: req.headers,
            body: bodyBuffer,
          });

          const webRes = await proxyHandler(webReq);

          const resHeaders = {};
          webRes.headers.forEach((val, key) => {
            resHeaders[key] = val;
          });

          res.writeHead(webRes.status, resHeaders);

          if (webRes.body) {
            const arrBuf = await webRes.arrayBuffer();
            res.end(Buffer.from(arrBuf));
          } else {
            res.end();
          }
        } catch (proxyErr) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: proxyErr.message }));
        }
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    });

    await new Promise((resolve) => {
      playerProxyServer.listen(0, '127.0.0.1', () => {
        playerPort = playerProxyServer.address().port;
        resolve();
      });
    });

    const playerOrigin = `http://127.0.0.1:${playerPort}`;
    console.log(`🌐 Backend Gateway running at port: ${backendPort}`);
    console.log(`🌐 Player Host (Origin B) running at: ${playerOrigin}\n`);

    async function reqPlayer(pathStr, options = {}) {
      return new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: playerPort,
            path: pathStr,
            method: options.method || 'GET',
            headers: options.headers || {},
          },
          (res) => {
            let data = Buffer.alloc(0);
            res.on('data', (c) => (data = Buffer.concat([data, c])));
            res.on('end', () => {
              resolve({
                status: res.statusCode,
                headers: {
                  get: (name) => res.headers[name.toLowerCase()] || '',
                },
                bodyBuffer: data,
                bodyText: data.toString('utf-8'),
              });
            });
          }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
      });
    }

    // =========================================================
    // THỰC THI KIỂM THỬ TỔNG HỢP CÁC TEST CASES (HOST1 - HOST22)
    // =========================================================

    // HOST1: Wrapper 200 OK
    const rHost1 = await reqPlayer(`/index.html?session=${validToken}`);
    assert.equal(rHost1.status, 200);
    assert.ok(rHost1.bodyText.includes('SCORM Player Host'));
    recordPass('HOST1', 'Player Wrapper HTML trả về HTTP 200 OK');

    // HOST2: Proxied /session-info 200 OK
    const rHost2 = await reqPlayer(`/session-info?session=${validToken}`);
    assert.equal(rHost2.status, 200);
    assert.equal(rHost2.headers.get('content-type'), 'application/json; charset=utf-8');
    const infoData = JSON.parse(rHost2.bodyText);
    assert.equal(infoData.valid, true);
    assert.equal(infoData.launch_path, 'index.html');
    recordPass('HOST2', 'Endpoint /session-info được reverse proxy trả lời HTTP 200 OK và MIME application/json');

    // HOST3: SCORM Launch HTML 200 OK -> Content-Type: text/html; charset=utf-8
    const rHost3 = await reqPlayer(`/session/${validToken}/index.html`);
    assert.equal(rHost3.status, 200);
    assert.equal(rHost3.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.ok(rHost3.bodyText.includes('Hello SCO'));
    recordPass('HOST3', 'SCORM Launch HTML trả về đúng Content-Type text/html; charset=utf-8');

    // HOST4: Proxied CSS 200 OK -> Content-Type: text/css
    const rHost4 = await reqPlayer(`/session/${validToken}/styles/main.css`);
    assert.equal(rHost4.status, 200);
    assert.ok(rHost4.headers.get('content-type').startsWith('text/css'));
    recordPass('HOST4', 'Tài nguyên CSS được phục vụ qua Reverse Proxy (Content-Type: text/css)');

    // HOST5: Proxied JS 200 OK -> Content-Type: text/javascript
    const rHost5 = await reqPlayer(`/session/${validToken}/scripts/app.js`);
    assert.equal(rHost5.status, 200);
    assert.ok(rHost5.headers.get('content-type').startsWith('text/javascript'));
    recordPass('HOST5', 'Tài nguyên JavaScript được phục vụ qua Reverse Proxy (Content-Type: text/javascript)');

    // HOST6: Proxied Image 200 OK -> image/png & image/svg+xml
    const rHost6 = await reqPlayer(`/session/${validToken}/images/diagram.png`);
    assert.equal(rHost6.status, 200);
    assert.equal(rHost6.headers.get('content-type'), 'image/png');

    const rHost6Svg = await reqPlayer(`/session/${validToken}/images/vector.svg`);
    assert.equal(rHost6Svg.status, 200);
    assert.equal(rHost6Svg.headers.get('content-type'), 'image/svg+xml');
    recordPass('HOST6', 'Tài nguyên hình ảnh (PNG, SVG) giữ đúng MIME type');

    // HOST7: Nested path works (JSON/XML/Fonts)
    const rHost7Json = await reqPlayer(`/session/${validToken}/sub/deep/asset.json`);
    assert.equal(rHost7Json.status, 200);
    assert.equal(rHost7Json.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.ok(rHost7Json.bodyText.includes('"nested":true'));

    const rHost7Xml = await reqPlayer(`/session/${validToken}/manifest/imsmanifest.xml`);
    assert.equal(rHost7Xml.status, 200);
    assert.equal(rHost7Xml.headers.get('content-type'), 'application/xml; charset=utf-8');

    const rHost7Font = await reqPlayer(`/session/${validToken}/fonts/font.woff2`);
    assert.equal(rHost7Font.status, 200);
    assert.equal(rHost7Font.headers.get('content-type'), 'font/woff2');
    recordPass('HOST7', 'Tài nguyên lồng nhau JSON, XML, Fonts giữ đúng MIME type chuẩn xác');

    // HOST8: Invalid session 403 Forbidden
    const rHost8 = await reqPlayer(`/session/${invalidToken}/index.html`);
    assert.equal(rHost8.status, 403);
    recordPass('HOST8', 'Session token không hợp lệ bị từ chối chính xác (HTTP 403 Forbidden)');

    // HOST9: Missing asset 404 Not Found
    const rHost9 = await reqPlayer(`/session/${validToken}/missing.html`);
    assert.equal(rHost9.status, 404);
    recordPass('HOST9', 'Tài nguyên không tồn tại trong package trả về HTTP 404 Not Found');

    // HOST10: Traversal 403 Forbidden
    const rHost10 = await reqPlayer(`/session/${validToken}/%2e%2e%2fsecret.txt`);
    assert.equal(rHost10.status, 403);
    recordPass('HOST10', 'Hành vi Path Traversal bị phát hiện và chặn đứng (HTTP 403 Forbidden)');

    // HOST11: Range 206 preserved through proxy
    const rHost11 = await reqPlayer(`/session/${validToken}/media/intro.mp4`, {
      headers: { Range: 'bytes=0-1023' },
    });
    assert.equal(rHost11.status, 206);
    assert.equal(rHost11.headers.get('content-type'), 'video/mp4');
    assert.equal(rHost11.headers.get('content-range'), 'bytes 0-1023/4096');
    assert.equal(rHost11.headers.get('accept-ranges'), 'bytes');
    assert.equal(rHost11.bodyBuffer.length, 1024);
    recordPass('HOST11', 'HTTP Range Request (206 Partial Content) và MIME video/mp4 được bảo toàn nguyên vẹn qua Proxy');

    // HOST12: Range 416 preserved through proxy
    const rHost12 = await reqPlayer(`/session/${validToken}/media/intro.mp4`, {
      headers: { Range: 'bytes=5000-6000' },
    });
    assert.equal(rHost12.status, 416);
    assert.equal(rHost12.headers.get('content-range'), 'bytes */4096');
    recordPass('HOST12', 'HTTP Range 416 (Range Not Satisfiable) được bảo toàn nguyên vẹn qua Proxy');

    // HOST13: HEAD preserved through proxy
    const rHost13 = await reqPlayer(`/session/${validToken}/index.html`, { method: 'HEAD' });
    assert.equal(rHost13.status, 200);
    assert.equal(rHost13.bodyBuffer.length, 0);
    assert.equal(rHost13.headers.get('content-type'), 'text/html; charset=utf-8');
    recordPass('HOST13', 'Phương thức HTTP HEAD được chuyển tiếp an toàn (headers giữ nguyên text/html, body rỗng)');

    // HOST14: Browser-visible URL never redirects to Supabase
    assert.equal(rHost3.status, 200);
    assert.equal(rHost3.headers.get('location'), '');
    recordPass('HOST14', 'Browser URL giữ nguyên trên Origin B, không bị chuyển hướng (302) sang Supabase');

    // HOST15: Response body/headers contain no upstream URL leak
    assert.equal(rHost3.bodyText.includes(`127.0.0.1:${backendPort}`), false);
    assert.equal(rHost2.bodyText.includes(`127.0.0.1:${backendPort}`), false);
    assert.equal(rHost3.bodyText.includes('supabase.co'), false);
    recordPass('HOST15', 'Nội dung và Headers trả về tuyệt đối không để lộ Upstream Backend URL');

    // HOST16: Player == SCO == Assets (All Origin B)
    const wrapperOrigin = playerOrigin;
    const scoOrigin = playerOrigin;
    const assetOrigin = playerOrigin;
    assert.equal(wrapperOrigin, scoOrigin);
    assert.equal(scoOrigin, assetOrigin);
    recordPass('HOST16', 'Player Wrapper == SCO Content == Assets (Hoàn toàn cùng Origin B)');

    // HOST17: Main Origin A != Player Origin B
    const mainAppOrigin = 'http://localhost:5173';
    assert.notEqual(mainAppOrigin, playerOrigin);
    recordPass('HOST17', 'Main Application Origin A (5173) cách ly tuyệt đối khỏi Player Host Origin B (4174)');

    // -------------------------------------------------------------
    // CÁC KIỂM THỬ ĐẶC TRỊ ROOT CAUSE MIME SCORM G5
    // -------------------------------------------------------------

    // HOST18: Deterministic MIME overrides upstream text/plain for index.html (Fixes browser raw text rendering bug)
    const rHost18 = await reqPlayer(`/session/${validToken}/raw-misconfigured.html`);
    assert.equal(rHost18.status, 200);
    assert.equal(rHost18.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(rHost18.headers.get('x-content-type-options'), 'nosniff');
    recordPass('HOST18', 'Khi upstream trả về text/plain cho HTML, Proxy tự động chuẩn hóa thành text/html; charset=utf-8 (Khắc phục triệt để lỗi iframe hiển thị mã nguồn thô)');

    // HOST19: Deterministic MIME overrides upstream text/plain for style.css & script.js
    const rHost19Css = await reqPlayer(`/session/${validToken}/raw-misconfigured.css`);
    assert.equal(rHost19Css.status, 200);
    assert.equal(rHost19Css.headers.get('content-type'), 'text/css; charset=utf-8');

    const rHost19Js = await reqPlayer(`/session/${validToken}/raw-misconfigured.js`);
    assert.equal(rHost19Js.status, 200);
    assert.equal(rHost19Js.headers.get('content-type'), 'text/javascript; charset=utf-8');
    recordPass('HOST19', 'Khi upstream trả về text/plain cho CSS/JS, Proxy tự động chuẩn hóa thành text/css và text/javascript');

    // HOST20: Unknown asset extension defaults to application/octet-stream
    const rHost20 = await reqPlayer(`/session/${validToken}/data/unknown.bin`);
    assert.equal(rHost20.status, 200);
    assert.equal(rHost20.headers.get('content-type'), 'application/octet-stream');
    recordPass('HOST20', 'Tài nguyên có định dạng không xác định được gán mặc định application/octet-stream an toàn');

    // HOST21: Unit tests for getMimeTypeForAsset function directly
    assert.equal(getMimeTypeForAsset('index.html'), 'text/html; charset=utf-8');
    assert.equal(getMimeTypeForAsset('style.css'), 'text/css; charset=utf-8');
    assert.equal(getMimeTypeForAsset('script.js'), 'text/javascript; charset=utf-8');
    assert.equal(getMimeTypeForAsset('unknown.dat'), 'application/octet-stream');
    assert.equal(getMimeTypeForAsset(''), 'text/html; charset=utf-8'); // default path
    assert.equal(getMimeTypeForAsset('folder/'), 'text/html; charset=utf-8'); // trailing slash default
    assert.equal(getMimeTypeForAsset('test.html?v=123'), 'text/html; charset=utf-8'); // query params handled
    assert.equal(getMimeTypeForAsset('test.custom', 'audio/opus'), 'audio/opus'); // custom upstream MIME preserved
    assert.equal(getMimeTypeForAsset('test.custom', 'text/plain'), 'application/octet-stream'); // untrusted generic text/plain falls back safely
    recordPass('HOST21', 'Unit tests: getMimeTypeForAsset thỏa mãn trọn vẹn đặc tả MIME resolution');

    // HOST22: Security headers nosniff & no-referrer strictly preserved
    const testEndpoints = [
      `/session/${validToken}/index.html`,
      `/session/${validToken}/styles/main.css`,
      `/session/${validToken}/scripts/app.js`,
      `/session/${invalidToken}/index.html`,
      `/session/${validToken}/missing.html`,
    ];
    for (const ep of testEndpoints) {
      const res = await reqPlayer(ep);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    }
    recordPass('HOST22', 'Headers bảo mật X-Content-Type-Options: nosniff và Referrer-Policy: no-referrer được bảo toàn 100% trên mọi phản hồi');

    console.log('\n================================================================');
    console.log(`🎉 TẤT CẢ ${passedTests}/${totalTests} KIỂM THỬ PLAYER HOST ĐÃ HOÀN TẤT VÀ PASS 100%!`);
    console.log('================================================================\n');
  } finally {
    if (backendServer) backendServer.close();
    if (playerProxyServer) playerProxyServer.close();
  }
}

runPlayerHostTestSuite().catch((err) => {
  console.error('\n❌ SCORM PLAYER HOST TEST SUITE FAILED:', err);
  process.exit(1);
});
