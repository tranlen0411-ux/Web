import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://nddimmxpymipalpxlops.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kZGltbXhweW1pcGFscHhsb3BzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1MjYzMTIsImV4cCI6MjEwMjEwMjMxMn0.Nax9THcWwP9LS106tFPcyqJRgqntS65Y2nf6xmcWxkI';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
