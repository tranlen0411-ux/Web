export const config = {
  runtime: 'edge',
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.wasm': 'application/wasm',
};

function getFileExtension(filePath) {
  if (!filePath) return '';
  const clean = filePath.split('?')[0].split('#')[0];
  const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  const fileName = lastSlash !== -1 ? clean.substring(lastSlash + 1) : clean;
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0) return '';
  return fileName.substring(lastDot).toLowerCase();
}

export function getMimeTypeForAsset(filePath, upstreamContentType) {
  const cleanPath = filePath ? filePath.split('?')[0].split('#')[0] : '';
  const effectivePath = (!cleanPath || cleanPath.endsWith('/')) ? 'index.html' : cleanPath;
  const ext = getFileExtension(effectivePath);

  if (ext && MIME_TYPES[ext]) {
    return MIME_TYPES[ext];
  }

  // Preserve upstream MIME type if specific and not a generic text/plain or octet-stream fallback
  if (
    upstreamContentType &&
    upstreamContentType !== 'application/octet-stream' &&
    upstreamContentType !== 'text/plain' &&
    upstreamContentType !== 'text/plain; charset=utf-8'
  ) {
    return upstreamContentType;
  }

  return 'application/octet-stream';
}

/**
 * Vercel Edge Serverless Reverse Proxy Handler for SCORM Player Host (Origin B)
 * Dynamically proxies /session-info and /session/* to the upstream SCORM Gateway
 * configured via SCORM_GATEWAY_UPSTREAM environment variable.
 */
export default async function handler(request) {
  const upstreamBase = process.env.SCORM_GATEWAY_UPSTREAM;
  if (!upstreamBase) {
    return new Response(
      JSON.stringify({ error: 'SCORM_GATEWAY_UPSTREAM environment variable is not configured on server' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        },
      }
    );
  }

  const url = new URL(request.url);
  const cleanBase = upstreamBase.replace(/\/+$/, '');
  const targetUrl = new URL(`${cleanBase}${url.pathname}${url.search}`);

  const headers = new Headers(request.headers);
  headers.delete('host');

  try {
    const upstreamRes = await fetch(targetUrl.toString(), {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'manual',
    });

    const responseHeaders = new Headers(upstreamRes.headers);
    responseHeaders.set('Referrer-Policy', 'no-referrer');
    responseHeaders.set('X-Content-Type-Options', 'nosniff');

    // Prevent upstream location leak
    if (upstreamRes.status >= 300 && upstreamRes.status < 400) {
      responseHeaders.delete('Location');
    }

    // Filter CSP on SCORM asset endpoints (/session/<token>/...) so upstream CSP sandbox does not block SCO scripts
    const sessionMatch = url.pathname.match(/^\/session\/[^/]+(?:\/(.*))?$/);
    if (sessionMatch) {
      responseHeaders.delete('content-security-policy');
      responseHeaders.delete('content-security-policy-report-only');
    }

    // Deterministic MIME preservation for SCORM assets and session-info
    if (upstreamRes.status === 200 || upstreamRes.status === 206) {
      if (url.pathname === '/session-info') {
        responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
      } else if (sessionMatch) {
        const relativeAssetPath = sessionMatch[1] || '';
        const upstreamContentType = upstreamRes.headers.get('content-type');
        const resolvedMime = getMimeTypeForAsset(relativeAssetPath, upstreamContentType);
        responseHeaders.set('Content-Type', resolvedMime);
      }
    }

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: '502 Bad Gateway: Upstream gateway connection failed', message: err.message }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        },
      }
    );
  }
}
