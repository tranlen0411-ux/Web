import { PGlite } from '@electric-sql/pglite';

async function runAuthStubTest() {
  let db;
  try {
    db = new PGlite();

    // 1. Tạo role anon và authenticated nếu chưa có
    await db.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated;
        END IF;
      END
      $$;
    `);

    // 2. Tạo schema auth
    await db.exec(`CREATE SCHEMA IF NOT EXISTS auth;`);

    // 3. Tạo function auth.uid() trả về current_setting('app.current_user_id', true)::uuid
    await db.exec(`
      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $$
        SELECT current_setting('app.current_user_id', true)::uuid;
      $$;
    `);

    // 4. Đặt app.current_user_id
    const expectedUuid = '11111111-1111-1111-1111-111111111111';
    await db.exec(`SELECT set_config('app.current_user_id', '${expectedUuid}', false);`);

    // 5. Chạy SELECT auth.uid() AS uid;
    const res = await db.query('SELECT auth.uid() AS uid;');
    const actualUid = res.rows[0]?.uid;

    // 6. Assert kết quả
    if (actualUid !== expectedUuid) {
      throw new Error(`UID không khớp: mong đợi ${expectedUuid}, nhận được ${actualUid}`);
    }

    await db.close();
    console.log('✅ PGLITE AUTH STUB PASS');
    process.exit(0);
  } catch (err) {
    console.error('❌ PGLITE AUTH STUB FAIL:', err);
    if (db) {
      try {
        await db.close();
      } catch (_) {}
    }
    process.exit(1);
  }
}

runAuthStubTest();
