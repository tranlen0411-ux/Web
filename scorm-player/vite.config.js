import { defineConfig } from 'vite';
import { sanitizeScormRelativePath, getMimeTypeForAsset } from '../src/utils/scormPathSecurity.js';

/**
 * ====================================================================
 * [LOCAL DEV GATEWAY ONLY - NOT FOR PRODUCTION DEPLOYMENT]
 * Vite Dev Server Gateway Middleware cho SCORM Player (Port 4174)
 * Cung cấp Asset Gateway cùng Origin B cho SCO Content và Player Wrapper trong môi trường Local Dev.
 * Trong môi trường Production, Asset Gateway sẽ được triển khai độc lập tại Edge / Cloud Gateway.
 * ====================================================================
 */
function scormAssetGatewayPlugin() {
  return {
    name: 'scorm-asset-gateway-local-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost:4174'}`);

        // Endpoint 1: Thông tin phiên /session-info?session=<token>
        if (url.pathname === '/session-info') {
          const sessionToken = url.searchParams.get('session');
          if (!sessionToken) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ valid: false, message: 'Thiếu session token.' }));
            return;
          }

          // Trong dev server fallback/mock hoặc kết nối backend
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            valid: true,
            launch_path: 'index.html',
            scorm_version: '1.2',
          }));
          return;
        }

        // Endpoint 2: Asset Gateway /session/:sessionToken/<relative-path...>
        const sessionMatch = url.pathname.match(/^\/session\/([^/]+)\/(.*)$/);
        if (sessionMatch) {
          const [, sessionToken, rawRelativePath] = sessionMatch;

          // 1. Kiểm tra session token
          if (!sessionToken || sessionToken.length < 8) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('403 Forbidden: Invalid session token');
            return;
          }

          // 2. Kiểm tra Path Traversal và Sanitization
          const pathCheck = sanitizeScormRelativePath(rawRelativePath || 'index.html');
          if (!pathCheck.valid) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`403 Forbidden: Path traversal attempt blocked (${pathCheck.reason})`);
            return;
          }

          // 3. Trả về MIME type và security headers
          const mimeType = getMimeTypeForAsset(pathCheck.normalizedPath);
          res.setHeader('Content-Type', mimeType);
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Cache-Control', 'private, no-transform, max-age=300');

          next();
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [scormAssetGatewayPlugin()],
  server: {
    port: 4174,
    strictPort: true,
    cors: true,
    headers: {
      'X-Content-Type-Options': 'nosniff',
    },
  },
  preview: {
    port: 4174,
    strictPort: true,
    cors: true,
  },
});
