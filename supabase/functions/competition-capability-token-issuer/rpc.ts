// supabase/functions/competition-capability-token-issuer/rpc.ts
import { AdminCredential, RpcVerificationResult, RpcVerificationRow } from './types.ts';
import { CapabilityIssuerError, mapDbErrorCodeToSafeError } from './errors.ts';
import { resolveSupabaseUrl } from './auth.ts';

export function resolveAdminCredential(): AdminCredential | null {
  // 1. Primary: SUPABASE_SECRET_KEYS['default']
  try {
    const rawSecretKeys = typeof Deno !== 'undefined' ? Deno.env?.get('SUPABASE_SECRET_KEYS') : undefined;
    if (rawSecretKeys) {
      const parsed = JSON.parse(rawSecretKeys);
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof parsed.default === 'string' &&
        parsed.default.trim() !== ''
      ) {
        return {
          type: 'secret_key',
          key: parsed.default.trim(),
        };
      }
    }
  } catch (_) {
    // Fail-soft JSON parsing
  }

  // 2. Fallback: SUPABASE_SERVICE_ROLE_KEY (Legacy JWT)
  const serviceKey = typeof Deno !== 'undefined' ? Deno.env?.get('SUPABASE_SERVICE_ROLE_KEY') : undefined;
  if (serviceKey && typeof serviceKey === 'string' && serviceKey.trim() !== '') {
    return {
      type: 'service_role',
      key: serviceKey.trim(),
    };
  }

  return null;
}

export async function executeAdminRpc(
  supabaseUrl: string,
  credential: AdminCredential,
  rpcName: string,
  payload: Record<string, unknown>,
  customFetch?: typeof fetch
): Promise<RpcVerificationResult> {
  const fetchFn = customFetch || fetch;
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${rpcName}`;

  // Build headers strictly based on credential transport contract:
  // Primary (secret_key): apikey ONLY, NO Authorization header.
  // Fallback (service_role): apikey + Authorization: Bearer <jwt>.
  const headers: Record<string, string> = {
    'apikey': credential.key,
    'Content-Type': 'application/json',
  };

  if (credential.type === 'service_role') {
    headers['Authorization'] = `Bearer ${credential.key}`;
  }

  let response: Response;
  try {
    response = await fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (_) {
    return {
      success: false,
      errorCode: 'internal_error',
      errorMessage: 'Database RPC transport failure',
    };
  }

  if (!response.ok) {
    return {
      success: false,
      errorCode: 'internal_error',
      errorMessage: 'Database RPC execution error',
    };
  }

  let rawData: unknown;
  try {
    rawData = await response.json();
  } catch (_) {
    return {
      success: false,
      errorCode: 'internal_error',
      errorMessage: 'Database RPC response parsing error',
    };
  }

  const row = (Array.isArray(rawData) ? rawData[0] : rawData) as RpcVerificationRow | undefined;
  if (!row || typeof row !== 'object') {
    return {
      success: false,
      errorCode: 'unauthorized',
      errorMessage: 'Invalid capability credentials',
    };
  }

  if (row.is_valid === true) {
    return { success: true, row };
  }

  const safe = mapDbErrorCodeToSafeError(row.error_code);
  return {
    success: false,
    row,
    errorCode: safe.errorCode,
    errorMessage: safe.message,
  };
}

export async function verifyGuestCapability(
  supabaseUrl: string,
  credential: AdminCredential,
  sessionId: string,
  participantId: string,
  guestToken: string,
  customFetch?: typeof fetch
): Promise<RpcVerificationResult> {
  return await executeAdminRpc(
    supabaseUrl,
    credential,
    'competition_verify_guest_capability_credentials',
    {
      p_session_id: sessionId,
      p_participant_id: participantId,
      p_guest_token: guestToken,
    },
    customFetch
  );
}

export async function verifyAuthCapability(
  supabaseUrl: string,
  credential: AdminCredential,
  sessionId: string,
  participantId: string,
  verifiedUserId: string,
  customFetch?: typeof fetch
): Promise<RpcVerificationResult> {
  return await executeAdminRpc(
    supabaseUrl,
    credential,
    'competition_verify_auth_capability_credentials',
    {
      p_session_id: sessionId,
      p_participant_id: participantId,
      p_user_id: verifiedUserId,
    },
    customFetch
  );
}
