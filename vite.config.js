import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const STAGING_REF = 'rcqgxmcqolxbrahhyxji';
const PROD_REF = 'nddimmxpymipalpxlops';

function getProjectRef(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const parts = parsed.hostname.split('.');
    if (parts.length >= 3 && parts[1] === 'supabase' && parts[2] === 'co') {
      return parts[0];
    }
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Build-time verification plugin:
 * Guarantees that Preview builds only accept Staging Supabase,
 * and Production builds only accept Production Supabase.
 */
function supabaseBuildGuardPlugin() {
  return {
    name: 'supabase-build-guard',
    buildStart() {
      const vercelEnv = process.env.VERCEL_ENV || process.env.VITE_VERCEL_ENV;
      const supabaseUrl = process.env.VITE_SUPABASE_URL;
      const ref = getProjectRef(supabaseUrl);

      // On Vercel Preview builds:
      if (vercelEnv === 'preview') {
        if (!supabaseUrl || ref !== STAGING_REF) {
          throw new Error(
            `[SECURITY BUILD GUARD] Preview build rejected! ` +
            `Preview must strictly use Staging Supabase project (${STAGING_REF}). ` +
            `Detected ref: ${ref || 'MISSING'}.`
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
