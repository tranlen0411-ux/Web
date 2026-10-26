import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const STAGING_REF = 'rcqgxmcqolxbrahhyxji';
const PROD_REF = 'nddimmxpymipalpxlops';

/**
 * Strictly extract and validate project ref from Supabase URL:
 * - Protocol MUST be strictly 'https:'
 * - Zero userinfo, custom ports, paths, query, or hash
 * - Hostname MUST strictly match '<project-ref>.supabase.co'
 */
function getProjectRef(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  // Reject quotes explicitly (strict validation - malformed input must be blocked, not auto-stripped)
  if (trimmed.includes('"') || trimmed.includes("'")) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.port && parsed.port !== '443') return null;
    if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
    if (parsed.search || parsed.hash) return null;
    const match = parsed.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Build-time verification plugin:
 * Guarantees that Preview builds only accept Staging Supabase,
 * and Production builds only accept Production Supabase.
 * Strictly verifies both URL and ANON_KEY without logging secret values.
 * Any attempt to bundle Production Supabase outside verified Production environment is rejected.
 */
function supabaseBuildGuardPlugin() {
  return {
    name: 'supabase-build-guard',
    buildStart() {
      const vercelEnv = process.env.VERCEL_ENV || process.env.VITE_VERCEL_ENV;
      const supabaseUrl = process.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
      const ref = getProjectRef(supabaseUrl);
      const isKeyValid = typeof supabaseAnonKey === 'string' &&
                         supabaseAnonKey.trim().length > 0 &&
                         !supabaseAnonKey.includes('"') &&
                         !supabaseAnonKey.includes("'");

      // On Vercel Preview builds:
      if (vercelEnv === 'preview') {
        if (!supabaseUrl || ref !== STAGING_REF) {
          throw new Error(
            `[SECURITY BUILD GUARD] Preview build rejected! ` +
            `Preview must strictly use Staging Supabase project (${STAGING_REF}). ` +
            `Detected ref: ${ref || 'MISSING'}.`
          );
        }
        if (!isKeyValid) {
          throw new Error(
            `[SECURITY BUILD GUARD] Preview build rejected! ` +
            `Preview must strictly have a valid non-empty VITE_SUPABASE_ANON_KEY.`
          );
        }
      }

      // On Vercel Production builds:
      if (vercelEnv === 'production') {
        if (!supabaseUrl || ref !== PROD_REF) {
          throw new Error(
            `[SECURITY BUILD GUARD] Production build rejected! ` +
            `Production must strictly use Production Supabase project (${PROD_REF}). ` +
            `Detected ref: ${ref || 'MISSING'}.`
          );
        }
        if (!isKeyValid) {
          throw new Error(
            `[SECURITY BUILD GUARD] Production build rejected! ` +
            `Production must strictly have a valid non-empty VITE_SUPABASE_ANON_KEY.`
          );
        }
      }

      // Reject any attempt to bundle Production ref outside official Vercel Production:
      if (ref === PROD_REF && vercelEnv !== 'production') {
        throw new Error(
          `[SECURITY BUILD GUARD] Production Supabase project (${PROD_REF}) cannot be bundled outside official Vercel Production environment!`
        );
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), supabaseBuildGuardPlugin()],
  define: {
    'import.meta.env.VITE_ENABLE_BULK_CREATE': JSON.stringify(process.env.VITE_ENABLE_BULK_CREATE || 'true'),
    'import.meta.env.VITE_VERCEL_ENV': JSON.stringify(process.env.VERCEL_ENV || process.env.VITE_VERCEL_ENV || '')
  },
  server: {
    port: 3000,
    host: true
  }
});
