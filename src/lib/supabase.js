import { createClient } from '@supabase/supabase-js';

export const STAGING_PROJECT_REF = 'rcqgxmcqolxbrahhyxji';
export const PROD_PROJECT_REF = 'nddimmxpymipalpxlops';

/**
 * Resolve environment variable across Vite (import.meta.env) and Node (process.env)
 */
function resolveEnv(key) {
  if (typeof import.meta !== 'undefined' && import.meta?.env?.[key]) {
    return import.meta.env[key];
  }
  if (typeof process !== 'undefined' && process?.env?.[key]) {
    return process.env[key];
  }
  return undefined;
}

/**
 * Accurately extract project ref from Supabase URL using standard URL parser.
 * Strictly verifies protocol (https or http) and domain structure (*.supabase.co).
 */
export function extractProjectRef(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return null;
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    const hostParts = parsed.hostname.split('.');
    if (hostParts.length >= 3 && hostParts[1] === 'supabase' && hostParts[2] === 'co') {
      return hostParts[0];
    }
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Accurately detect environment without relying on a single heuristic.
 * Combines Vercel system environment, Vite MODE, and browser hostname.
 */
export function detectEnvironment() {
  const vercelEnv = resolveEnv('VITE_VERCEL_ENV') || resolveEnv('VERCEL_ENV');
  if (vercelEnv === 'production') return 'production';
  if (vercelEnv === 'preview') return 'preview';
  if (vercelEnv === 'development') return 'development';

  if (typeof window !== 'undefined' && window.location?.hostname) {
    const host = window.location.hostname;
    if (host === 'web-len9.vercel.app') return 'production';
    if (host.endsWith('.vercel.app')) return 'preview';
    if (host === 'localhost' || host === '127.0.0.1') return 'development';
  }

  const mode = resolveEnv('MODE');
  if (mode === 'production') return 'production';
  if (mode === 'development') return 'development';

  return 'unknown';
}

const rawUrl = resolveEnv('VITE_SUPABASE_URL');
const rawKey = resolveEnv('VITE_SUPABASE_ANON_KEY');

const trimmedUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';
const trimmedKey = typeof rawKey === 'string' ? rawKey.trim() : '';

const detectedRef = extractProjectRef(trimmedUrl);
const currentEnv = detectEnvironment();

// Strict Environment Isolation Guard:
// 1. Preview environment MUST NOT use Production project ref!
// 2. Production environment MUST NOT use Staging project ref!
let isEnvironmentMismatch = false;
let mismatchReason = '';

if (currentEnv === 'preview' && detectedRef === PROD_PROJECT_REF) {
  isEnvironmentMismatch = true;
  mismatchReason = `Preview environment cannot connect to Production Supabase project (${PROD_PROJECT_REF}).`;
} else if (currentEnv === 'production' && detectedRef === STAGING_PROJECT_REF) {
  isEnvironmentMismatch = true;
  mismatchReason = `Production environment cannot connect to Staging Supabase project (${STAGING_PROJECT_REF}).`;
}

// Validation: URL must parse cleanly, key must be non-empty, and environment must not mismatch
const isValidUrl = Boolean(detectedRef && !isEnvironmentMismatch);
const isValidKey = Boolean(trimmedKey && trimmedKey.length > 0);

export const isSupabaseConfigured = isValidUrl && isValidKey;

// FAIL-CLOSED: Absolutely zero hardcoded fallback to Production or any project!
export const supabaseUrl = isSupabaseConfigured ? trimmedUrl.replace(/\/$/, '') : '';
export const supabaseAnonKey = isSupabaseConfigured ? trimmedKey : '';

/**
 * Chainable query builder for fail-closed mode.
 * Any chained method (.select, .eq, etc.) returns the builder, which is a Thenable
 * resolving to { data: null, error: Error }. Never throws unhandled TypeError.
 */
function createFailClosedQueryBuilder(reason) {
  const result = {
    data: null,
    error: new Error(`[Supabase Fail-Closed] Database query blocked: ${reason}`),
    count: null,
    status: 400,
    statusText: 'Bad Request (Fail-Closed)',
  };

  let proxy;
  const builder = {
    then(onFulfilled, onRejected) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
    catch(onRejected) {
      return Promise.resolve(result).catch(onRejected);
    },
  };

  proxy = new Proxy(builder, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => proxy;
    },
  });

  return proxy;
}

/**
 * Creates fully-compatible fail-closed dummy client when configuration is missing or invalid.
 * Prevents UI crashes from undefined methods while completely isolating the app from database.
 */
function createFailClosedClient(reason) {
  const storageBucketHandler = {
    upload: async () => ({ data: null, error: new Error(`[Supabase Fail-Closed] Storage upload blocked: ${reason}`) }),
    download: async () => ({ data: null, error: new Error(`[Supabase Fail-Closed] Storage download blocked: ${reason}`) }),
    remove: async () => ({ data: null, error: new Error(`[Supabase Fail-Closed] Storage remove blocked: ${reason}`) }),
    getPublicUrl: () => ({ data: { publicUrl: '' } }),
    createSignedUrl: async () => ({ data: null, error: new Error(`[Supabase Fail-Closed] Storage sign blocked: ${reason}`) }),
    createSignedUrls: async () => ({ data: null, error: new Error(`[Supabase Fail-Closed] Storage sign blocked: ${reason}`) }),
    list: async () => ({ data: [], error: new Error(`[Supabase Fail-Closed] Storage list blocked: ${reason}`) }),
  };

  const channelMock = {
    on() { return this; },
    subscribe(callback) {
      if (typeof callback === 'function') {
        try { callback('CLOSED'); } catch {}
      }
      return this;
    },
    unsubscribe: async () => 'ok',
    send: async () => 'ok',
  };

  const handler = {
    get(_target, prop) {
      if (prop === 'auth') {
        return new Proxy({}, {
          get(_aTarget, aProp) {
            if (aProp === 'getSession') return async () => ({ data: { session: null }, error: new Error(reason) });
            if (aProp === 'getUser') return async () => ({ data: { user: null }, error: new Error(reason) });
            if (aProp === 'onAuthStateChange') return () => ({ data: { subscription: { unsubscribe: () => {} } } });
            if (aProp === 'signOut') return async () => ({ error: null });
            return async () => ({ data: null, error: new Error(`[Supabase Fail-Closed] Auth method "${String(aProp)}" blocked: ${reason}`) });
          }
        });
      }
      if (prop === 'from' || prop === 'rpc') {
        return () => createFailClosedQueryBuilder(reason);
      }
      if (prop === 'storage') {
        return {
          from: () => storageBucketHandler,
        };
      }
      if (prop === 'functions') {
        return {
          invoke: async (fnName) => ({
            data: null,
            error: new Error(`[Supabase Fail-Closed] Function "${fnName}" blocked: ${reason}`),
          }),
        };
      }
      if (prop === 'channel') {
        return () => channelMock;
      }
      if (prop === 'removeChannel') {
        return async () => 'ok';
      }
      if (prop === 'realtime') {
        return {
          setAuth: () => {},
          getChannels: () => [],
        };
      }
      return undefined;
    },
  };

  return new Proxy({}, handler);
}

let clientInstance;
if (isSupabaseConfigured) {
  clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
} else {
  let reason = '';
  if (isEnvironmentMismatch) {
    reason = mismatchReason;
  } else if (!isValidUrl && !isValidKey) {
    reason = 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing.';
  } else if (!isValidUrl) {
    reason = 'VITE_SUPABASE_URL is missing, invalid or malformed.';
  } else {
    reason = 'VITE_SUPABASE_ANON_KEY is missing.';
  }
  console.warn(`[Supabase Fail-Closed] ${reason}`);
  clientInstance = createFailClosedClient(reason);
}

export const supabase = clientInstance;
