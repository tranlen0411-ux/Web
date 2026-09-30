// supabase/functions/competition-capability-token-issuer/auth.ts
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isValidUuid } from './validation.ts';
import { CapabilityIssuerError } from './errors.ts';
import { resolveAdminCredential } from './rpc.ts';

export function resolvePublishableKey(): string | null {
  try {
    const rawSecretKeys = typeof Deno !== 'undefined' ? Deno.env?.get('SUPABASE_PUBLISHABLE_KEYS') : undefined;
    if (rawSecretKeys) {
      const parsed = JSON.parse(rawSecretKeys);
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof parsed.default === 'string' &&
        parsed.default.trim() !== ''
      ) {
        return parsed.default.trim();
      }
    }
  } catch (_) {
    // Fail-soft JSON parsing
  }

  const pubKey = typeof Deno !== 'undefined' ? Deno.env?.get('SUPABASE_PUBLISHABLE_KEY') : undefined;
  if (pubKey && typeof pubKey === 'string' && pubKey.trim() !== '') {
    return pubKey.trim();
  }

  const anonKey = typeof Deno !== 'undefined' ? Deno.env?.get('SUPABASE_ANON_KEY') : undefined;
  if (anonKey && typeof anonKey === 'string' && anonKey.trim() !== '') {
    return anonKey.trim();
  }

  const adminCred = resolveAdminCredential();
  if (adminCred && adminCred.key) {
    return adminCred.key;
  }

  return null;
}

export function resolveSupabaseUrl(): string | null {
  const url = typeof Deno !== 'undefined' ? Deno.env?.get('SUPABASE_URL') : undefined;
  if (url && typeof url === 'string' && url.trim() !== '') {
    return url.trim();
  }
  return null;
}

export function createAuthValidationClient(url?: string, key?: string): SupabaseClient {
  const supabaseUrl = url || resolveSupabaseUrl();
  const publishableKey = key || resolvePublishableKey();

  if (!supabaseUrl || !publishableKey) {
    throw new CapabilityIssuerError('internal_error', 'Auth validation client configuration unavailable');
  }

  return createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Validates caller identity using Supabase Auth JWT.
 * Primary method: supabase.auth.getClaims(bearerToken)
 * Fallback freshness check: Direct GoTrue /auth/v1/user fetch + supabase.auth.getUser(bearerToken)
 * Returns verified user UUID (subject) or throws CapabilityIssuerError.
 */
export async function verifyCallerIdentity(
  authClient: SupabaseClient,
  bearerToken: string,
  customFetch?: typeof fetch
): Promise<string> {
  let verifiedUserId: string | null = null;

  // 1. Primary: supabase.auth.getClaims(token)
  try {
    if (typeof (authClient.auth as any).getClaims === 'function') {
      const { data, error } = await (authClient.auth as any).getClaims(bearerToken);
      if (!error && data) {
        const sub = data?.claims?.sub || data?.sub;
        if (sub && typeof sub === 'string' && isValidUuid(sub)) {
          verifiedUserId = sub;
        }
      }
    }
  } catch (_) {
    // Fail-soft, continue to direct GoTrue check
  }

  // 2. Direct GoTrue /auth/v1/user verification
  if (!verifiedUserId) {
    try {
      const supabaseUrl = resolveSupabaseUrl() || 'http://localhost:54321';
      const apiKey = resolvePublishableKey() || '';
      const fetchFn = customFetch || fetch;

      const userRes = await fetchFn(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          'apikey': apiKey,
          'Authorization': `Bearer ${bearerToken}`,
        },
      });

      if (userRes.ok) {
        const userData = await userRes.json();
        if (userData && userData.id && isValidUuid(userData.id)) {
          verifiedUserId = userData.id;
        }
      }
    } catch (_) {
      // Fail-soft
    }
  }

  // 3. Fallback: supabase.auth.getUser(token)
  if (!verifiedUserId) {
    try {
      const { data, error } = await authClient.auth.getUser(bearerToken);
      if (!error && data?.user?.id && isValidUuid(data.user.id)) {
        verifiedUserId = data.user.id;
      }
    } catch (_) {
      // Fail-soft
    }
  }

  if (!verifiedUserId) {
    throw new CapabilityIssuerError('unauthorized', 'Invalid or expired authentication token');
  }

  return verifiedUserId;
}
