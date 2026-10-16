import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const STAGING_REF = 'rcqgxmcqolxbrahhyxji';
const PROD_REF = 'nddimmxpymipalpxlops';

/**
 * Helper to run an isolated Node child process with specific environment variables.
 * Guarantees zero pollution across test cases and reproduces exact module imports.
 */
function runClientSimulation(envOverrides) {
  const runnerScript = `
    const { supabase, supabaseUrl, supabaseAnonKey, isSupabaseConfigured, extractProjectRef, detectEnvironment } = await import('./src/lib/supabase.js');
    const { competitionRealtimeClient } = await import('./src/services/competitionClient.js');

    const result = {
      isSupabaseConfigured,
      supabaseUrl,
      supabaseAnonKey,
      detectedEnvironment: detectEnvironment(),
      extractedRef: extractProjectRef(supabaseUrl),
      clientType: typeof supabase,
      realtimeClientType: typeof competitionRealtimeClient,
    };

    if (!isSupabaseConfigured) {
      // 1. Test database query fail-closed builder
      try {
        const qRes = await supabase.from('test_table').select('*').eq('id', 1).maybeSingle();
        result.queryResult = { success: true, data: qRes.data, errorMsg: qRes.error?.message };
      } catch (err) {
        result.queryResult = { success: false, crashError: err.message };
      }

      // 2. Test RPC fail-closed builder
      try {
        const rpcRes = await supabase.rpc('test_rpc', { arg: 1 });
        result.rpcResult = { success: true, data: rpcRes.data, errorMsg: rpcRes.error?.message };
      } catch (err) {
        result.rpcResult = { success: false, crashError: err.message };
      }

      // 3. Test Auth fail-closed methods
      try {
        const sessionRes = await supabase.auth.getSession();
        const userRes = await supabase.auth.getUser();
        const oauthRes = await supabase.auth.signInWithOAuth({ provider: 'google' });
        const passRes = await supabase.auth.signInWithPassword({ email: 't@t.com', password: 'p' });
        const { data: subData } = supabase.auth.onAuthStateChange(() => {});
        subData?.subscription?.unsubscribe();
        result.authResult = {
          success: true,
          sessionNull: sessionRes.data?.session === null,
          userNull: userRes.data?.user === null,
          oauthBlocked: Boolean(oauthRes.error),
          passBlocked: Boolean(passRes.error),
        };
      } catch (err) {
        result.authResult = { success: false, crashError: err.message };
      }

      // 4. Test Storage fail-closed methods
      try {
        const uploadRes = await supabase.storage.from('test-bucket').upload('file.txt', 'content');
        const pubUrlRes = supabase.storage.from('test-bucket').getPublicUrl('file.txt');
        const listRes = await supabase.storage.from('test-bucket').list();
        result.storageResult = {
          success: true,
          uploadBlocked: Boolean(uploadRes.error),
          publicUrlEmpty: pubUrlRes.data?.publicUrl === '',
          listEmpty: Array.isArray(listRes.data) && listRes.data.length === 0,
        };
      } catch (err) {
        result.storageResult = { success: false, crashError: err.message };
      }

      // 5. Test Functions invoke fail-closed
      try {
        const fnRes = await supabase.functions.invoke('test-func', { body: {} });
        result.functionsResult = {
          success: true,
          invokeBlocked: Boolean(fnRes.error),
          invokeErrorMsg: fnRes.error?.message,
        };
      } catch (err) {
        result.functionsResult = { success: false, crashError: err.message };
      }

      // 6. Test Realtime channel fail-closed
      try {
        const ch = competitionRealtimeClient.channel('test_topic');
        ch.on('broadcast', {}, () => {}).subscribe();
        await ch.unsubscribe();
        await competitionRealtimeClient.removeChannel(ch);
        result.realtimeResult = { success: true };
      } catch (err) {
        result.realtimeResult = { success: false, crashError: err.message };
      }
    }

    console.log(JSON.stringify(result));
    process.exit(0);
  `;

  const cleanEnv = { ...process.env };
  delete cleanEnv.VITE_SUPABASE_URL;
  delete cleanEnv.VITE_SUPABASE_ANON_KEY;
  delete cleanEnv.VITE_VERCEL_ENV;
  delete cleanEnv.VERCEL_ENV;
  delete cleanEnv.MODE;

  Object.assign(cleanEnv, envOverrides);

  const proc = spawnSync('node', ['--input-type=module', '-e', runnerScript], {
    cwd: ROOT_DIR,
    env: cleanEnv,
    encoding: 'utf8',
  });

  if (proc.status !== 0) {
    throw new Error(`Execution failed (code ${proc.status}):\n${proc.stderr}\n${proc.stdout}`);
  }

  const lines = proc.stdout.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

test('SUPABASE FAIL-CLOSED & ENVIRONMENT ISOLATION HARDENING SUITE', async (t) => {

  // TEST 1: Thiếu URL
  await t.test('1. Fail-closed khi thiếu VITE_SUPABASE_URL', () => {
    const res = runClientSimulation({
      VITE_SUPABASE_ANON_KEY: 'valid-test-key-without-url'
    });
    assert.equal(res.isSupabaseConfigured, false, 'Phải đánh dấu isSupabaseConfigured = false');
    assert.equal(res.supabaseUrl, '', 'URL phải rỗng, không được fallback');
  });

  // TEST 2: Thiếu Anon Key
  await t.test('2. Fail-closed khi thiếu VITE_SUPABASE_ANON_KEY', () => {
    const res = runClientSimulation({
      VITE_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`
    });
    assert.equal(res.isSupabaseConfigured, false, 'Phải đánh dấu isSupabaseConfigured = false');
    assert.equal(res.supabaseAnonKey, '', 'Key phải rỗng, không được fallback');
  });

  // TEST 3: URL sai định dạng
  await t.test('3. Fail-closed khi VITE_SUPABASE_URL sai giao thức / malformed', () => {
    const res = runClientSimulation({
      VITE_SUPABASE_URL: 'ftp://not-a-valid-supabase-url.com',
      VITE_SUPABASE_ANON_KEY: 'test-key'
    });
    assert.equal(res.isSupabaseConfigured, false, 'URL không hợp lệ phải bị từ chối');
    assert.equal(res.supabaseUrl, '', 'URL phải rỗng khi sai giao thức');
  });

  // TEST 4: Preview + Staging đúng
  await t.test('4. Preview R19 + Supabase Staging đúng -> Kích hoạt hợp lệ', () => {
    const res = runClientSimulation({
      VERCEL_ENV: 'preview',
      VITE_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
      VITE_SUPABASE_ANON_KEY: 'staging-valid-key'
    });
    assert.equal(res.detectedEnvironment, 'preview', 'Phải nhận diện đúng môi trường preview');
    assert.equal(res.isSupabaseConfigured, true, 'Preview + Staging phải được cấu hình thành công');
    assert.equal(res.supabaseUrl, `https://${STAGING_REF}.supabase.co`);
  });

  // TEST 5: Preview + Production sai -> BẮT BUỘC FAIL
  await t.test('5. Preview R19 + Production sai -> BẮT BUỘC CHẶN (Fail-Closed)', () => {
    const res = runClientSimulation({
      VERCEL_ENV: 'preview',
      VITE_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
      VITE_SUPABASE_ANON_KEY: 'prod-key-in-preview'
    });
    assert.equal(res.detectedEnvironment, 'preview', 'Nhận diện preview');
    assert.equal(res.isSupabaseConfigured, false, 'Preview nhận URL Production BẮT BUỘC bị vô hiệu hóa!');
    assert.equal(res.supabaseUrl, '', 'URL phải bị xóa rỗng để ngăn chặn kết nối lén lút');
    assert.equal(res.queryResult.data, null, 'Không được phép truy vấn dữ liệu');
    assert.match(res.queryResult.errorMsg, /Preview environment cannot connect to Production Supabase project/);
  });

  // TEST 6: Production + Production đúng -> Kích hoạt hợp lệ
  await t.test('6. Production + Supabase Production đúng -> Kích hoạt hợp lệ', () => {
    const res = runClientSimulation({
      VERCEL_ENV: 'production',
      VITE_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
      VITE_SUPABASE_ANON_KEY: 'prod-valid-key'
    });
    assert.equal(res.detectedEnvironment, 'production', 'Nhận diện production');
    assert.equal(res.isSupabaseConfigured, true, 'Production + Production ref phải được cấu hình thành công');
    assert.equal(res.supabaseUrl, `https://${PROD_REF}.supabase.co`);
  });

  // TEST 7: Production + Staging sai -> BẮT BUỘC CHẶN
  await t.test('7. Production + Staging sai -> BẮT BUỘC CHẶN (Fail-Closed)', () => {
    const res = runClientSimulation({
      VERCEL_ENV: 'production',
      VITE_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
      VITE_SUPABASE_ANON_KEY: 'staging-key-in-prod'
    });
    assert.equal(res.detectedEnvironment, 'production', 'Nhận diện production');
    assert.equal(res.isSupabaseConfigured, false, 'Production nhận Staging ref BẮT BUỘC bị vô hiệu hóa!');
    assert.equal(res.supabaseUrl, '', 'URL phải bị xóa rỗng');
    assert.match(res.queryResult.errorMsg, /Production environment cannot connect to Staging Supabase project/);
  });

  // TEST 8: Fail-closed toàn bộ API (Auth, Storage, Functions, Realtime không crash UI)
  await t.test('8. Fail-closed đầy đủ API: Auth, Storage, Functions, Realtime không crash UI', () => {
    const res = runClientSimulation({
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: ''
    });

    // Query & RPC
    assert.equal(res.queryResult.success, true, 'from() chained methods must not throw TypeError');
    assert.equal(res.queryResult.data, null);
    assert.match(res.queryResult.errorMsg, /Database query blocked/);
    assert.equal(res.rpcResult.success, true, 'rpc() must not throw TypeError');

    // Auth
    assert.equal(res.authResult.success, true, 'Auth methods must not throw TypeError');
    assert.equal(res.authResult.sessionNull, true, 'session must be null');
    assert.equal(res.authResult.userNull, true, 'user must be null');
    assert.equal(res.authResult.oauthBlocked, true, 'signInWithOAuth must return error gracefully');
    assert.equal(res.authResult.passBlocked, true, 'signInWithPassword must return error gracefully');

    // Storage
    assert.equal(res.storageResult.success, true, 'Storage methods must not throw TypeError');
    assert.equal(res.storageResult.uploadBlocked, true, 'upload must return error gracefully');
    assert.equal(res.storageResult.publicUrlEmpty, true, 'getPublicUrl must return empty string');
    assert.equal(res.storageResult.listEmpty, true, 'list must return empty array');

    // Functions
    assert.equal(res.functionsResult.success, true, 'Functions invoke must not throw TypeError');
    assert.equal(res.functionsResult.invokeBlocked, true, 'invoke must return error gracefully');

    // Realtime
    assert.equal(res.realtimeResult.success, true, 'Realtime channel methods must not throw');
  });

  // TEST 9: Build-time Guard chặn đứng build sai môi trường trên Vercel
  await t.test('9. Build Guard chặn đứng build khi Preview nhận nhầm Production ref', () => {
    const buildCheckScript = `
      import { spawnSync } from 'node:child_process';
      const cleanEnv = { ...process.env, VERCEL_ENV: 'preview', VITE_SUPABASE_URL: 'https://${PROD_REF}.supabase.co' };
      const proc = spawnSync('node', ['./node_modules/vite/bin/vite.js', 'build'], { env: cleanEnv, encoding: 'utf8' });
      const failedAsExpected = proc.status !== 0 && proc.stderr.includes('[SECURITY BUILD GUARD]');
      console.log(JSON.stringify({ failedAsExpected, exitCode: proc.status }));
    `;
    const checkProc = spawnSync('node', ['--input-type=module', '-e', buildCheckScript], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
    });
    const parsed = JSON.parse(checkProc.stdout.trim().split('\n').pop());
    assert.equal(parsed.failedAsExpected, true, 'Vite build BẮT BUỘC ném lỗi [SECURITY BUILD GUARD] khi Preview dùng Prod ref!');
  });

  // TEST 10: Quét tĩnh mã nguồn không có chuỗi Production URL hoặc key fallback hardcoded
  await t.test('10. Quét tĩnh toàn bộ src/: 100% không còn Production URL ref hoặc JWT key fallback', () => {
    function scanDir(dir) {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const full = path.join(dir, f);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          scanDir(full);
        } else if (f.endsWith('.js') || f.endsWith('.jsx') || f.endsWith('.ts') || f.endsWith('.tsx')) {
          const content = fs.readFileSync(full, 'utf8');
          // Cho phép hằng số PROD_PROJECT_REF trong supabase.js để phục vụ việc cấm đoán
          if (full.endsWith('supabase.js')) {
            assert.equal(
              content.includes('https://nddimmxpymipalpxlops.supabase.co'),
              false,
              'supabase.js must NOT contain hardcoded Production URL string'
            );
            assert.equal(
              content.includes('Nax9THcWwP9LS106tFPcyqJRgqntS65Y2nf6xmcWxkI'),
              false,
              'supabase.js must NOT contain hardcoded Production anon key'
            );
          } else {
            assert.equal(
              content.includes(PROD_REF),
              false,
              `File ${full} must NOT contain Production ref ${PROD_REF}`
            );
          }
        }
      }
    }
    scanDir(path.join(ROOT_DIR, 'src'));
  });

});
