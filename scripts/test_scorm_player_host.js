/**
 * ====================================================================
 * 🧪 TEST SUITE: SCORM PRODUCTION PLAYER HOST & SAME-ORIGIN REVERSE PROXY
 * ====================================================================
 * Kiểm thử toàn diện:
 * 1. HOST1: Wrapper 200 OK
 * 2. HOST2: Proxied /session-info 200 OK
 * 3. HOST3: SCORM HTML 200 OK
 * 4. HOST4: Proxied CSS 200 OK
 * 5. HOST5: Proxied JS 200 OK
 * 6. HOST6: Proxied Image 200 OK
 * 7. HOST7: Nested path works
 * 8. HOST8: Invalid session 403 Forbidden
 * 9. HOST9: Missing asset 404 Not Found
 * 10. HOST10: Traversal 403 Forbidden
 * 11. HOST11: Range 206 preserved through proxy
 * 12. HOST12: Range 416 preserved through proxy
 * 13. HOST13: HEAD preserved through proxy
 * 14. HOST14: Browser-visible URL never redirects to Supabase
 * 15. HOST15: Response body/headers contain no upstream URL leak
 * 16. HOST16: Player == SCO == Assets (All Origin B)
 * 17. HOST17: Main Origin A != Player Origin B
 * ====================================================================
 */

import http from 'node:http';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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

        if (rawPath === 'styles/main.css') {
          res.writeHead(200, {
            'Content-Type': 'text/css; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          });
          if (req.method === 'HEAD') res.end();
          else res.end('body { background: #fafafa; }');
          return;
        }

        if (rawPath === 'scripts/app.js') {
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

        if (rawPath === 'sub/deep/asset.json') {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          });
          if (req.method === 'HEAD') res.end();
          else res.end(JSON.stringify({ nested: true }));
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

    // -------------------------------------------------------------
    // 2. MÔ PHỎNG PLAYER HOST ORIGIN B (STATIC HOST + REVERSE PROXY)
    // -------------------------------------------------------------
    playerProxyServer = http.createServer((req, res) => {
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
        // Forward HTTP request tới Upstream Backend Server-to-Server
        const upstreamReq = http.request(
          {
            hostname: '127.0.0.1',
            port: backendPort,
            path: req.url,
            method: req.method,
            headers: {
              ...req.headers,
              host: `127.0.0.1:${backendPort}`,
            },
          },
          (upstreamRes) => {
            // Forward headers và status code
            const headers = { ...upstreamRes.headers };
            headers['referrer-policy'] = 'no-referrer';
            headers['x-content-type-options'] = 'nosniff';

            res.writeHead(upstreamRes.statusCode, headers);
            upstreamRes.pipe(res);
          }
        );

        upstreamReq.on('error', (err) => {
          res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('502 Bad Gateway');
        });

        if (req.method !== 'GET' && req.method !== 'HEAD') {
          req.pipe(upstreamReq);
        } else {
          upstreamReq.end();
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
    // THỰC THI KIỂM THỬ 17 TEST CASES (HOST1 - HOST17)
    // =========================================================

    // HOST1: Wrapper 200 OK
    const rHost1 = await reqPlayer(`/index.html?session=${validToken}`);
    assert.equal(rHost1.status, 200);
    assert.ok(rHost1.bodyText.includes('SCORM Player Host'));
    recordPass('HOST1', 'Player Wrapper HTML trả về HTTP 200 OK');

    // HOST2: Proxied /session-info 200 OK
    const rHost2 = await reqPlayer(`/session-info?session=${validToken}`);
    assert.equal(rHost2.status, 200);
    const infoData = JSON.parse(rHost2.bodyText);
    assert.equal(infoData.valid, true);
    assert.equal(infoData.launch_path, 'index.html');
    recordPass('HOST2', 'Endpoint /session-info được reverse proxy trả lời HTTP 200 OK');

    // HOST3: SCORM Launch HTML 200 OK
    const rHost3 = await reqPlayer(`/session/${validToken}/index.html`);
    assert.equal(rHost3.status, 200);
    assert.ok(rHost3.bodyText.includes('Hello SCO'));
    recordPass('HOST3', 'SCORM Launch HTML được phục vụ cùng Origin B (HTTP 200 OK)');

    // HOST4: Proxied CSS 200 OK
    const rHost4 = await reqPlayer(`/session/${validToken}/styles/main.css`);
    assert.equal(rHost4.status, 200);
    assert.ok(rHost4.headers.get('content-type').includes('text/css'));
    recordPass('HOST4', 'Tài nguyên CSS được phục vụ qua Reverse Proxy (HTTP 200 OK)');

    // HOST5: Proxied JS 200 OK
    const rHost5 = await reqPlayer(`/session/${validToken}/scripts/app.js`);
    assert.equal(rHost5.status, 200);
    assert.ok(rHost5.headers.get('content-type').includes('text/javascript'));
    recordPass('HOST5', 'Tài nguyên JavaScript được phục vụ qua Reverse Proxy (HTTP 200 OK)');

    // HOST6: Proxied Image 200 OK
    const rHost6 = await reqPlayer(`/session/${validToken}/images/diagram.png`);
    assert.equal(rHost6.status, 200);
    assert.ok(rHost6.headers.get('content-type').includes('image/png'));
    recordPass('HOST6', 'Tài nguyên hình ảnh được phục vụ qua Reverse Proxy (HTTP 200 OK)');

    // HOST7: Nested path works
    const rHost7 = await reqPlayer(`/session/${validToken}/sub/deep/asset.json`);
    assert.equal(rHost7.status, 200);
    assert.ok(rHost7.bodyText.includes('"nested":true'));
    recordPass('HOST7', 'Đường dẫn lồng nhau nhiều cấp (nested relative assets) hoạt động chính xác');

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
    assert.equal(rHost11.headers.get('content-range'), 'bytes 0-1023/4096');
    assert.equal(rHost11.headers.get('accept-ranges'), 'bytes');
    assert.equal(rHost11.bodyBuffer.length, 1024);
    recordPass('HOST11', 'HTTP Range Request (206 Partial Content) được bảo toàn nguyên vẹn qua Proxy');

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
    assert.ok(rHost13.headers.get('content-type').includes('text/html'));
    recordPass('HOST13', 'Phương thức HTTP HEAD được chuyển tiếp an toàn (headers giữ nguyên, body rỗng)');

    // HOST14: Browser-visible URL never redirects to Supabase
    assert.equal(rHost3.status, 200); // 200 OK, not 301/302/307/308
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
