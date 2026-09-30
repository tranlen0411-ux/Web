// supabase/functions/competition-capability-token-issuer/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { AdminCredential } from './types.ts';
import { getCorsHeaders, handleOptions } from './cors.ts';
import { createErrorResponse, CapabilityIssuerError } from './errors.ts';
import { parseAndValidateRequest } from './validation.ts';
import { createAuthValidationClient, verifyCallerIdentity, resolveSupabaseUrl } from './auth.ts';
import { resolveAdminCredential, verifyGuestCapability, verifyAuthCapability } from './rpc.ts';
import { mintCapabilityToken } from './signer.ts';

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'req-' + Math.random().toString(36).substring(2, 15);
}

export async function handleCapabilityIssuerRequest(
  req: Request,
  injectedAuthClient?: any,
  injectedAdminCredential?: AdminCredential | null,
  injectedSigningKey?: string,
  injectedFetch?: typeof fetch
): Promise<Response> {
  const requestId = req.headers.get('x-request-id') || generateRequestId();
  const origin = req.headers.get('origin');
  const startTime = Date.now();

  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return handleOptions(req);
  }

  let mode: 'guest' | 'auth' = 'guest';

  try {
    // 2. Parse & Validate Request Body and Headers
    const validated = await parseAndValidateRequest(req);
    mode = validated.mode;

    // 3. Resolve Supabase URL and Admin Backend Credential (fail closed if unavailable)
    const supabaseUrl = resolveSupabaseUrl() || 'http://localhost:54321';
    const adminCredential = injectedAdminCredential !== undefined ? injectedAdminCredential : resolveAdminCredential();

    if (!adminCredential || !adminCredential.key) {
      throw new CapabilityIssuerError('internal_error', 'Backend RPC admin credentials unavailable');
    }

    if (validated.mode === 'guest') {
      // 4a. Guest Flow: Call DB Verifier RPC
      const result = await verifyGuestCapability(
        supabaseUrl,
        adminCredential,
        validated.data.session_id,
        validated.data.participant_id,
        validated.data.guest_token,
        injectedFetch
      );

      if (!result.success) {
        return createErrorResponse(
          result.errorCode || 'unauthorized',
          result.errorMessage || 'Invalid guest credentials',
          requestId,
          origin
        );
      }

      // Mint capability token
      const tokenResponse = await mintCapabilityToken(
        validated.data.session_id,
        validated.data.participant_id,
        injectedSigningKey
      );

      const latencyMs = Date.now() - startTime;
      console.log(JSON.stringify({
        request_id: requestId,
        mode: 'guest',
        status: 200,
        latency_ms: latencyMs,
        outcome: 'capability_minted',
      }));

      return new Response(JSON.stringify(tokenResponse), {
        status: 200,
        headers: {
          ...getCorsHeaders(origin),
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    } else {
      // 4b. Auth Flow: Verify Bearer JWT using Auth Client
      const authClient = injectedAuthClient || createAuthValidationClient(supabaseUrl);
      const verifiedUserId = await verifyCallerIdentity(authClient, validated.bearerToken, injectedFetch);

      // Call DB Verifier RPC with verified user UUID
      const result = await verifyAuthCapability(
        supabaseUrl,
        adminCredential,
        validated.data.session_id,
        validated.data.participant_id,
        verifiedUserId,
        injectedFetch
      );

      if (!result.success) {
        return createErrorResponse(
          result.errorCode || 'unauthorized',
          result.errorMessage || 'Invalid authenticated participant credentials',
          requestId,
          origin
        );
      }

      // Mint capability token
      const tokenResponse = await mintCapabilityToken(
        validated.data.session_id,
        validated.data.participant_id,
        injectedSigningKey
      );

      const latencyMs = Date.now() - startTime;
      console.log(JSON.stringify({
        request_id: requestId,
        mode: 'auth',
        status: 200,
        latency_ms: latencyMs,
        outcome: 'capability_minted',
      }));

      return new Response(JSON.stringify(tokenResponse), {
        status: 200,
        headers: {
          ...getCorsHeaders(origin),
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    }
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    if (err instanceof CapabilityIssuerError) {
      console.log(JSON.stringify({
        request_id: requestId,
        mode,
        status: err.httpStatus,
        latency_ms: latencyMs,
        outcome: err.errorCode,
      }));
      return createErrorResponse(err.errorCode, err.message, requestId, origin);
    }

    // Unexpected internal error: Log only sanitized category + request_id
    console.error(JSON.stringify({
      request_id: requestId,
      mode,
      status: 500,
      latency_ms: latencyMs,
      outcome: 'unexpected_error',
    }));

    return createErrorResponse('internal_error', 'An internal server error occurred', requestId, origin);
  }
}

// Deno Deploy Entrypoint (only active when running under Deno)
if (typeof Deno !== 'undefined' && typeof Deno.env?.get === 'function') {
  serve(handleCapabilityIssuerRequest);
}
