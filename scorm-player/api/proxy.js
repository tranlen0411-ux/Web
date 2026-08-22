export const config = {
  runtime: 'edge',
};

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
