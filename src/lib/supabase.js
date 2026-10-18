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
 * Strictly extract and validate project ref from Supabase URL using standard URL parser.
 * Requirements:
 * - Protocol MUST be strictly 'https:'
 * - Zero userinfo (no username or password)
 * - Zero custom port (only default 443 or empty)
 * - Zero path (pathname must be strictly '/' or '')
 * - Zero search query and zero hash
 * - Hostname MUST strictly match '<project-ref>.supabase.co' with no appended subdomains
 */
export function extractProjectRef(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return null;
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    if (parsed.port && parsed.port !== '443') {
      return null;
    }
    if (parsed.pathname !== '/' && parsed.pathname !== '') {
      return null;
    }
    if (parsed.search || parsed.hash) {
      return null;
    }
    const match = parsed.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
    if (!match) {
      return null;
    }
    return match[1];
  } catch {
    return null;
  }
}

/**
 * Accurately detect environment without relying on a single heuristic.
 * Combines Vercel system environment, browser hostname, and Vite development mode.
 * NOTE: Vite MODE=production alone is NEVER trusted as proof of Production environment.
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
  if (mode === 'development') return 'development';

  // Unknown or unverified environment: fail-closed by default
  return 'unknown';
}

const rawUrl = resolveEnv('VITE_SUPABASE_URL');
const rawKey = resolveEnv('VITE_SUPABASE_ANON_KEY');

const trimmedUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';
const trimmedKey = typeof rawKey === 'string' ? rawKey.trim() : '';

const detectedRef = extractProjectRef(trimmedUrl);
const currentEnv = detectEnvironment();

// Strict Environment Isolation Guard:
// 1. Preview environment MUST strictly use Staging project ref!
// 2. Production environment MUST strictly use Production project ref!
// 3. Unknown or unverified environment MUST fail-closed!
// 4. Development environment allows Staging project ref, never Production ref!
let isEnvironmentMismatch = false;
let mismatchReason = '';

if (currentEnv === 'unknown') {
  isEnvironmentMismatch = true;
  mismatchReason = 'Unknown or unverified environment cannot connect to Supabase (fail-closed).';
} else if (currentEnv === 'preview') {
  if (detectedRef === PROD_PROJECT_REF) {
    isEnvironmentMismatch = true;
    mismatchReason = `Preview environment cannot connect to Production Supabase project (${PROD_PROJECT_REF}).`;
  } else if (detectedRef !== STAGING_PROJECT_REF) {
    isEnvironmentMismatch = true;
    mismatchReason = `Preview environment must strictly use Staging Supabase project (${STAGING_PROJECT_REF}). Detected ref: ${detectedRef || 'NONE'}.`;
  }
} else if (currentEnv === 'production') {
  if (detectedRef === STAGING_PROJECT_REF) {
    isEnvironmentMismatch = true;
    mismatchReason = `Production environment cannot connect to Staging Supabase project (${STAGING_PROJECT_REF}).`;
  } else if (detectedRef !== PROD_PROJECT_REF) {
    isEnvironmentMismatch = true;
    mismatchReason = `Production environment must strictly use Production Supabase project (${PROD_PROJECT_REF}). Detected ref: ${detectedRef || 'NONE'}.`;
  }
} else if (currentEnv === 'development') {
  if (detectedRef === PROD_PROJECT_REF) {
    isEnvironmentMismatch = true;
    mismatchReason = `Development environment cannot connect to Production Supabase project (${PROD_PROJECT_REF}).`;
  }
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
  if (!trimmedUrl && !trimmedKey) {
    reason = 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing.';
  } else if (!trimmedUrl) {
    reason = 'VITE_SUPABASE_URL is missing.';
  } else if (!trimmedKey) {
    reason = 'VITE_SUPABASE_ANON_KEY is missing.';
  } else if (!detectedRef) {
    reason = 'VITE_SUPABASE_URL is missing, invalid or malformed.';
  } else if (isEnvironmentMismatch) {
    reason = mismatchReason;
  } else {
    reason = 'VITE_SUPABASE_URL is missing, invalid or malformed.';
  }
  console.warn(`[Supabase Fail-Closed] ${reason}`);
  clientInstance = createFailClosedClient(reason);
}

export const supabase = clientInstance;
