// supabase/functions/_shared/examRuntime.ts
// Secure Runtime Configuration & Fallback Resolution for Two-Project Architecture

export interface RuntimeConfig {
  coreUrl: string;
  coreAnonKey: string;
  coreServiceKey: string;
  examUrl: string;
  examServiceKey: string;
}

export function resolveRuntimeConfig(envGetter?: (key: string) => string | undefined): RuntimeConfig | null {
  const getEnv = (key: string): string | undefined => {
    try {
      if (envGetter) {
        const val = envGetter(key);
        if (typeof val === 'string') return val;
      }
      // Deno runtime check
      if (typeof Deno !== 'undefined' && typeof Deno.env?.get === 'function') {
        return Deno.env.get(key);
      }
      return undefined;
    } catch (_) {
      return undefined;
    }
  };

  const coreUrl = getEnv('CORE_SUPABASE_URL');
  const coreAnonKey = getEnv('CORE_SUPABASE_ANON_KEY');
  const coreServiceKey = getEnv('CORE_SUPABASE_SERVICE_ROLE_KEY');

  // NEW Exam URL resolution order:
  // 1. EXAM_SUPABASE_URL
  // 2. NEW_SUPABASE_URL
  // 3. SUPABASE_URL (Hosted Edge runtime default on host project)
  const examUrl =
    getEnv('EXAM_SUPABASE_URL') ||
    getEnv('NEW_SUPABASE_URL') ||
    getEnv('SUPABASE_URL');

  // NEW Exam Service Role Key resolution order:
  // 1. EXAM_SUPABASE_SERVICE_ROLE_KEY
  // 2. NEW_SUPABASE_SERVICE_ROLE_KEY
  // 3. SUPABASE_SERVICE_ROLE_KEY
  // 4. SUPABASE_SECRET_KEYS['default']
  let examServiceKey =
    getEnv('EXAM_SUPABASE_SERVICE_ROLE_KEY') ||
    getEnv('NEW_SUPABASE_SERVICE_ROLE_KEY') ||
    getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!examServiceKey) {
    const rawSecretKeys = getEnv('SUPABASE_SECRET_KEYS');
    if (rawSecretKeys) {
      try {
        const parsed = JSON.parse(rawSecretKeys);
        if (
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          typeof parsed.default === 'string' &&
          parsed.default.trim() !== ''
        ) {
          examServiceKey = parsed.default.trim();
        }
      } catch (_) {
        // Fail-closed: Malformed JSON -> examServiceKey remains undefined
      }
    }
  }

  if (!coreUrl || !coreAnonKey || !coreServiceKey || !examUrl || !examServiceKey) {
    return null;
  }

  return {
    coreUrl,
    coreAnonKey,
    coreServiceKey,
    examUrl,
    examServiceKey,
  };
}
