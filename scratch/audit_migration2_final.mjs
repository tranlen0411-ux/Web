import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

async function auditMigration2() {
  console.log('================================================================================');
  console.log('🔍 BẮT ĐẦU FINAL AUDIT MIGRATION 2');
  console.log('================================================================================\n');

  const m1Path = path.resolve('supabase/migrations/20260926000001_competition_v1_baseline_schema.sql');
  const m1Sql = fs.readFileSync(m1Path, 'utf8');
  const m1Hash = crypto.createHash('sha256').update(m1Sql).digest('hex');
  const expectedM1Hash = '8e3231f34b3a57e43b0e1bcd7d863359a770d6334f59cff9a45c4662ed76b168';

  console.log('1. MIGRATION 1 SHA256:', m1Hash);
  console.log('   MATCH EXPECTED:', m1Hash === expectedM1Hash ? 'YES' : 'NO');

  const m2Path = path.resolve('supabase/migrations/20260926161245_competition_v1_rpc_and_business_logic.sql');
  const m2Sql = fs.readFileSync(m2Path, 'utf8');

  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE ROLE authenticated;
    CREATE ROLE anon;
    CREATE TABLE auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
    CREATE TABLE public.profiles (
      id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'teacher', 'student', 'parent')),
      full_name TEXT NOT NULL DEFAULT 'Test User',
      avatar_url TEXT DEFAULT NULL
    );
    CREATE OR REPLACE FUNCTION extensions.digest(data bytea, type text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(data); $$;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID; $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon'); $$;
  `);

  await db.exec(m1Sql);
  await db.exec(m2Sql);

  const funcs = await db.query(`
    SELECT 
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_arguments(p.oid) as arguments,
      pg_get_function_result(p.oid) as return_type,
      p.prosecdef as is_security_definer,
      p.provolatile as volatility
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname IN ('public', 'private')
      AND p.proname LIKE 'competition_%'
    ORDER BY n.nspname, p.proname;
  `);

  console.log('\n2. EXACT FUNCTION INVENTORY (Total:', funcs.rows.length, '):');
  for (const f of funcs.rows) {
    console.log(`- ${f.schema_name}.${f.function_name}(${f.arguments}) -> ${f.return_type} [secdef: ${f.is_security_definer}]`);
  }

  const grants = await db.query(`
    SELECT 
      routine_schema,
      routine_name,
      grantee,
      privilege_type
    FROM information_schema.routine_privileges
    WHERE routine_schema IN ('public', 'private')
      AND routine_name LIKE 'competition_%'
    ORDER BY routine_schema, routine_name, grantee;
  `);

  console.log('\n3. ROUTINE PRIVILEGES:');
  for (const g of grants.rows) {
    console.log(`- ${g.routine_schema}.${g.routine_name}: ${g.privilege_type} TO ${g.grantee}`);
  }

  // Static checks on Migration 2 file
  console.log('\n4. STATIC FILE AUDIT:');
  const forbiddenKeywords = [
    'DROP TABLE',
    'TRUNCATE',
    'DELETE FROM profiles',
    'DELETE FROM users',
    'ALTER TABLE profiles',
    'ALTER TABLE auth',
    'supabase_realtime',
    'service_role',
    'BEGIN;',
    'COMMIT;'
  ];

  for (const kw of forbiddenKeywords) {
    const hasKw = m2Sql.includes(kw);
    console.log(`- Contains "${kw}": ${hasKw ? 'YES (WARNING)' : 'NO'}`);
  }
}

auditMigration2().catch(console.error);
