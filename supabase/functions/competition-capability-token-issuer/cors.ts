// supabase/functions/competition-capability-token-issuer/cors.ts

const ALLOWED_ORIGIN_WHITELIST = [
  'https://web-len9.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };

  if (origin) {
    const cleanOrigin = origin.trim().replace(/\/$/, '');
    if (ALLOWED_ORIGIN_WHITELIST.includes(cleanOrigin)) {
      headers['Access-Control-Allow-Origin'] = cleanOrigin;
      return headers;
    }
    // Check if custom allowed origin env is set
    const customOrigin = (typeof Deno !== 'undefined' && Deno.env?.get('CORS_ALLOWED_ORIGIN')) || null;
    if (customOrigin && cleanOrigin === customOrigin.trim().replace(/\/$/, '')) {
      headers['Access-Control-Allow-Origin'] = cleanOrigin;
      return headers;
    }
  }

  // Safe default: no echo of arbitrary untrusted origin
  return headers;
}

export function handleOptions(req: Request): Response {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}
