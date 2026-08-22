/**
 * ====================================================================
 * SUPABASE EDGE FUNCTION: SCORM ASSET GATEWAY (PRODUCTION-CAPABLE)
 * ====================================================================
 * Phục vụ phân phối tài nguyên SCORM đóng gói trong Private Bucket (scorm-content)
 *
 * Luồng hoạt động:
 * 1. Nhận yêu cầu: /session/<opaque-session-token>/<relative-path> hoặc /session-info?session=<opaque-session-token>
 * 2. Kiểm tra định dạng token (64 hex characters - 256 bits CSPRNG entropy).
 * 3. Băm SHA-256 token và gọi RPC nội bộ resolve_scorm_session_asset qua Service Role.
 * 4. Tự động kiểm tra: TTL hết hạn, trạng thái thu hồi (revoked), Dynamic Public Visibility recheck.
 * 5. Khử độc và kiểm duyệt đường dẫn chống Path Traversal (sanitizeScormRelativePath).
 * 6. Tải tệp nhị phân từ Private Storage Bucket (scorm-content) và stream cho client.
 * 7. Hỗ trợ HTTP Range Requests (206 Partial Content, 416 Range Not Satisfiable) cho Audio/Video và HEAD requests.
 * 8. Bảo mật nghiêm ngặt: Không để lộ raw storage path, bucket name, SQL errors hay Service Role keys.
 * ====================================================================
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, range',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Type',
};

// MIME Types Map
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
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
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

function getFileExtension(filePath: string): string {
  if (!filePath) return '';
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const fileName = lastSlash !== -1 ? filePath.substring(lastSlash + 1) : filePath;
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0) return '';
  return fileName.substring(lastDot).toLowerCase();
}

function getMimeTypeForAsset(filePath: string): string {
  if (!filePath) return 'application/octet-stream';
  const ext = getFileExtension(filePath);
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function normalizePosixPath(p: string): string {
  const parts = p.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length > 0) {
        stack.pop();
      } else {
        return '../';
      }
    } else {
      stack.push(part);
    }
  }
  return stack.join('/');
}

function sanitizeScormRelativePath(rawRelativePath: string): { valid: boolean; normalizedPath?: string; reason?: string } {
  if (typeof rawRelativePath !== 'string' || !rawRelativePath.trim()) {
    return { valid: false, reason: 'EMPTY_PATH' };
  }

  if (rawRelativePath.length > 1024) {
    return { valid: false, reason: 'EXCESSIVE_PATH_LENGTH' };
  }

  let decoded = rawRelativePath.trim();

  if (decoded.includes('\0') || decoded.includes('%00')) {
    return { valid: false, reason: 'NULL_BYTE_DETECTED' };
  }

  let prevDecoded = '';
  let decodeAttempts = 0;
  while (decoded !== prevDecoded && decodeAttempts < 5) {
    prevDecoded = decoded;
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return { valid: false, reason: 'MALFORMED_URI_ENCODING' };
    }
    decodeAttempts++;
  }

  if (decoded.includes('\0') || decoded.includes('%00')) {
    return { valid: false, reason: 'NULL_BYTE_DETECTED' };
  }

  if (/^[a-zA-Z]:/.test(decoded)) {
    return { valid: false, reason: 'DRIVE_PREFIX_DETECTED' };
  }

  const normalizedSlashes = decoded.replace(/\\/g, '/');

  if (
    normalizedSlashes.includes('../') ||
    normalizedSlashes.includes('/..') ||
    normalizedSlashes === '..' ||
    normalizedSlashes.includes('..\\') ||
    normalizedSlashes.includes('..')
  ) {
    return { valid: false, reason: 'PATH_TRAVERSAL_DETECTED' };
  }

  // 6. Chặn absolute paths bắt đầu bằng /
  if (normalizedSlashes.startsWith('/')) {
    return { valid: false, reason: 'ABSOLUTE_PATH_DETECTED' };
  }

  const normalized = normalizePosixPath(normalizedSlashes);


  if (
    normalized.startsWith('../') ||
    normalized === '..' ||
    normalized.startsWith('/') ||
    normalized === '.' ||
    !normalized
  ) {
    return { valid: false, reason: 'ESCAPED_PACKAGE_ROOT' };
  }

  return {
    valid: true,
    normalizedPath: normalized,
  };
}

async function hashTokenSha256(token: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(token.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // 2. Method Guard: Chỉ chấp nhận GET và HEAD
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(
      JSON.stringify({ success: false, message: '405 Method Not Allowed: Chỉ hỗ trợ phương thức GET và HEAD.' }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json; charset=utf-8',
          Allow: 'GET, HEAD, OPTIONS',
        },
      }
    );
  }

  try {
    const rawUrl = req.url || '';

    // Kiểm tra sớm Path Traversal trên raw URL
    if (
      rawUrl.includes('/../') ||
      rawUrl.includes('/..') ||
      rawUrl.includes('\\..') ||
      rawUrl.includes('..\\') ||
      rawUrl.includes('%2e%2e') ||
      rawUrl.includes('%2E%2E') ||
      rawUrl.includes('\0') ||
      rawUrl.includes('%00')
    ) {
      return new Response('403 Forbidden: Path traversal attempt blocked', {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const url = new URL(rawUrl);
    let pathname = url.pathname;

    // Chuẩn hóa tiền tố path (Hỗ trợ cả direct /session và qua prefix /scorm-asset-gateway/session)
    pathname = pathname.replace(/^\/scorm-asset-gateway/, '');

    // Khởi tạo Supabase client với Service Role Key nội bộ (chỉ đọc server-side env)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // -------------------------------------------------------------
    // ROUTE 1: /session-info?session=<rawToken>
    // -------------------------------------------------------------
    if (pathname === '/session-info') {
      const rawToken = url.searchParams.get('session');
      if (!rawToken || !/^[0-9a-f]{64}$/.test(rawToken)) {
        return new Response(
          JSON.stringify({ valid: false, reason: 'INVALID_OR_MISSING_SESSION_TOKEN' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
          }
        );
      }

      const tokenHash = await hashTokenSha256(rawToken);
      const { data: info, error: rpcError } = await supabase.rpc('resolve_scorm_session_asset', {
        p_session_token_hash: tokenHash,
      });

      if (rpcError || !info || !info.valid) {
        return new Response(
          JSON.stringify({ valid: false, reason: info?.reason || 'SESSION_INVALID' }),
          {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
          }
        );
      }

      // Trả về metadata sanitized cho player (Tuyệt đối không để lộ content_root hay bucket name)
      const sessionInfoBody = JSON.stringify({
        valid: true,
        launch_path: info.launch_path,
        scorm_version: info.scorm_version,
        expires_at: info.expires_at,
      });

      return new Response(req.method === 'HEAD' ? null : sessionInfoBody, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'private, no-transform, max-age=60',
        },
      });
    }

    // -------------------------------------------------------------
    // ROUTE 2: /session/:sessionToken/<relative_path...>
    // -------------------------------------------------------------
    const match = pathname.match(/^\/session\/([^/]+)\/(.*)$/);
    if (match) {
      const [, rawToken, rawRelativePath] = match;

      // 1. Kiểm tra format token sớm (64 hex characters)
      if (!rawToken || !/^[0-9a-f]{64}$/.test(rawToken)) {
        return new Response('403 Forbidden: Invalid token format', {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      // 2. Hash token và đối chiếu DB qua Trusted Resolver
      const tokenHash = await hashTokenSha256(rawToken);
      const { data: info, error: rpcError } = await supabase.rpc('resolve_scorm_session_asset', {
        p_session_token_hash: tokenHash,
      });

      if (rpcError || !info || !info.valid) {
        return new Response(`403 Forbidden: Session invalid (${info?.reason || 'NOT_FOUND'})`, {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      // 3. Khử độc và kiểm tra Path Traversal
      const pathCheck = sanitizeScormRelativePath(rawRelativePath || info.launch_path);
      if (!pathCheck.valid) {
        return new Response(`403 Forbidden: Path traversal blocked (${pathCheck.reason})`, {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      // 4. Ghép đường dẫn Storage và nạp tệp từ Private Storage Bucket (scorm-content)
      const storagePath = `${info.content_root}/${pathCheck.normalizedPath}`;
      const { data: blob, error: downloadError } = await supabase.storage
        .from('scorm-content')
        .download(storagePath);

      if (downloadError || !blob) {
        return new Response('404 Not Found: Asset does not exist', {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      const arrayBuffer = await blob.arrayBuffer();
      const totalLength = arrayBuffer.byteLength;
      const mimeType = getMimeTypeForAsset(pathCheck.normalizedPath);

      // Tính toán TTL còn lại cho Cache-Control (không vượt quá expires_at)
      const remainingTtlSeconds = Math.min(
        300,
        Math.max(0, Math.floor((new Date(info.expires_at).getTime() - Date.now()) / 1000))
      );

      // 5. Xử lý HTTP Range Request (206 Partial Content / 416 Range Not Satisfiable)
      const rangeHeader = req.headers.get('range');
      if (rangeHeader) {
        const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/);
        if (rangeMatch) {
          const rawStart = rangeMatch[1];
          const rawEnd = rangeMatch[2];

          let start = rawStart ? parseInt(rawStart, 10) : NaN;
          let end = rawEnd ? parseInt(rawEnd, 10) : NaN;

          if (isNaN(start) && isNaN(end)) {
            return new Response('416 Range Not Satisfiable', {
              status: 416,
              headers: {
                ...corsHeaders,
                'Content-Range': `bytes */${totalLength}`,
                'Content-Type': 'text/plain; charset=utf-8',
              },
            });
          }

          if (isNaN(start)) {
            // Suffix range: bytes=-500
            const suffixLength = end;
            start = Math.max(0, totalLength - suffixLength);
            end = totalLength - 1;
          } else if (isNaN(end)) {
            // Prefix range: bytes=100-
            end = totalLength - 1;
          }

          if (start >= totalLength || start > end || start < 0) {
            return new Response('416 Range Not Satisfiable', {
              status: 416,
              headers: {
                ...corsHeaders,
                'Content-Range': `bytes */${totalLength}`,
                'Content-Type': 'text/plain; charset=utf-8',
              },
            });
          }

          end = Math.min(end, totalLength - 1);
          const chunk = arrayBuffer.slice(start, end + 1);

          return new Response(req.method === 'HEAD' ? null : chunk, {
            status: 206,
            headers: {
              ...corsHeaders,
              'Content-Type': mimeType,
              'Content-Range': `bytes ${start}-${end}/${totalLength}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': `${chunk.byteLength}`,
              'X-Content-Type-Options': 'nosniff',
              'Cache-Control': `private, no-transform, max-age=${remainingTtlSeconds}`,
            },
          });
        }
      }

      // 6. Trả về toàn bộ tệp (200 OK)
      return new Response(req.method === 'HEAD' ? null : arrayBuffer, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
          'Content-Length': `${totalLength}`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': `private, no-transform, max-age=${remainingTtlSeconds}`,
        },
      });
    }

    return new Response('404 Not Found', {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err) {
    return new Response('500 Internal Server Error', {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
});
