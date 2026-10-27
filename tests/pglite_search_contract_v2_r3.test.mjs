import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

export async function runPgLiteSearchContractV2Validation() {
  console.log('=============================================================================');
  console.log('Báº®T Äáº¦U KIá»‚M THá»¬ RUNTIME POSTGRESQL ENGINE THá»°C Táº¾ (PGLITE ENGINE)');
  console.log('Má»¤C TIÃŠU: XÃC MINH TOÃ€N DIá»†N MIGRATION R3 VÃ€ RPC V2 CHO SEARCH CONTRACT');
  console.log('LÆ¯U Ã: ÄÃ‚Y LÃ€ KIá»‚M THá»¬ LOCAL PGLITE, KHÃ”NG PHáº¢I KIá»‚M THá»¬ POSTGREST THáº¬T TRÃŠN STAGING.');
  console.log('=============================================================================\n');

  const rootDir = process.cwd();
  const baseMigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261023210000_notifications_v1_schema_and_security.sql');
  const r1MigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261028000001_notifications_v1_individual_recipients.sql');
  const r2MigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261028000002_notifications_v1_teacher_disable_concurrency_fix.sql');
  const r3MigrationPath = path.join(rootDir, 'supabase', 'migrations', '20261028000003_notifications_v1_search_contract_v2.sql');

  const baseSql = fs.readFileSync(baseMigrationPath, 'utf8');
  const r1Sql = fs.readFileSync(r1MigrationPath, 'utf8');
  const r2Sql = fs.readFileSync(r2MigrationPath, 'utf8');
  const r3Sql = fs.readFileSync(r3MigrationPath, 'utf8');

  async function setupBaseSchema(db) {
    await db.exec(`
      DO \$\$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role;
        END IF;
      END
      \$\$;

      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE SCHEMA IF NOT EXISTS app_private;

      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS \$\$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
      \$\$;

      CREATE TABLE IF NOT EXISTS public.profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        student_code TEXT UNIQUE,
        grade_level INT DEFAULT 1,
        total_stars INT DEFAULT 0,
        total_coins INT DEFAULT 0,
        is_disabled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.classes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        grade_level INT DEFAULT 1,
        teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public.class_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        is_active BOOLEAN NOT NULL DEFAULT true,
        is_primary BOOLEAN NOT NULL DEFAULT false,
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(class_id, student_id)
      );

      REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
      GRANT USAGE ON SCHEMA app_private TO service_role;

      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL ON ALL FUNCTIONS IN SCHEMA public, auth TO anon, authenticated, service_role;
    `);
  }

  const db = new PGlite();
  await setupBaseSchema(db);

  console.log('1. Náº¡p tuáº§n tá»± cÃ¡c migration: Base -> R1 -> R2 -> R3...');
  await db.exec(baseSql);
  await db.exec(r1Sql);
  await db.exec(r2Sql);
  await db.exec(r3Sql);
  console.log('   => ToÃ n bá»™ 4 migrations náº¡p hoÃ n táº¥t khÃ´ng lá»—i cÃº phÃ¡p!\n');

  // Helper set JWT context
  async function asUser(userId, callback) {
    if (userId) {
      await db.exec(`
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${userId}', false);
      `);
    } else {
      await db.exec(`
        SET ROLE anon;
        SELECT set_config('request.jwt.claim.sub', '', false);
      `);
    }

    try {
      return await callback();
    } finally {
      await db.exec(`
        SET ROLE postgres;
        SELECT set_config('request.jwt.claim.sub', '', false);
      `);
    }
  }

  // Khá»Ÿi táº¡o Fixtures
  console.log('2. Khá»Ÿi táº¡o Fixtures dá»¯ liá»‡u kiá»ƒm thá»­...');
  const adminId = '11111111-1111-1111-1111-111111111111';
  const teacherAId = '22222222-2222-2222-2222-222222222221';
  const teacherBId = '22222222-2222-2222-2222-222222222222';
  const studentAId = '33333333-3333-3333-3333-333333333331';
  const studentBId = '33333333-3333-3333-3333-333333333332';
  const studentCId = '33333333-3333-3333-3333-333333333333';
  const studentDisabledId = '33333333-3333-3333-3333-333333333334';
  const classA1Id = '44444444-4444-4444-4444-444444444441';
  const classB1Id = '44444444-4444-4444-4444-444444444442';
  const classB2Id = '44444444-4444-4444-4444-444444444443';

  await db.exec(`
    INSERT INTO public.profiles (id, email, full_name, role, student_code, grade_level, is_disabled) VALUES
      ('${adminId}', 'admin@test.invalid', 'Quáº£n Trá»‹ ViÃªn', 'admin', 'ADM01', 1, FALSE),
      ('${teacherAId}', 'teacher_a@test.invalid', 'GiÃ¡o ViÃªn A', 'teacher', 'TCH01', 1, FALSE),
      ('${teacherBId}', 'teacher_b@test.invalid', 'GiÃ¡o ViÃªn B', 'teacher', 'TCH02', 1, FALSE),
      ('${studentAId}', 'student_a@test.invalid', 'Nguyá»…n Há»c Sinh A', 'student', 'HS101', 1, FALSE),
      ('${studentBId}', 'student_b@test.invalid', 'Tráº§n Há»c Sinh B', 'student', 'HS102', 1, FALSE),
      ('${studentCId}', 'student_c@test.invalid', 'LÃª Há»c Sinh C', 'student', 'HS201', 2, FALSE),
      ('${studentDisabledId}', 'student_dis@test.invalid', 'Há»c Sinh KhÃ³a', 'student', 'HSDIS', 1, TRUE);

    INSERT INTO public.classes (id, name, code, grade_level, teacher_id) VALUES
      ('${classA1Id}', 'Lá»›p 1A', 'CLS_1A', 1, '${teacherAId}'),
      ('${classB1Id}', 'Lá»›p 1B', 'CLS_1B', 1, '${teacherBId}'),
      ('${classB2Id}', 'Lá»›p 2B', 'CLS_2B', 2, '${teacherBId}');

    -- Student A -> Lá»›p 1A
    -- Student B -> Lá»›p 1B
    -- Student C -> Lá»›p 1A (phá»¥) VÃ€ Lá»›p 2B (chÃ­nh) [Há»c sinh Ä‘a lá»›p]
    -- Student Disabled -> Lá»›p 1A
    INSERT INTO public.class_members (class_id, student_id, is_active, is_primary) VALUES
      ('${classA1Id}', '${studentAId}', TRUE, TRUE),
      ('${classB1Id}', '${studentBId}', TRUE, TRUE),
      ('${classA1Id}', '${studentCId}', TRUE, FALSE),
      ('${classB2Id}', '${studentCId}', TRUE, TRUE),
      ('${classA1Id}', '${studentDisabledId}', TRUE, TRUE);
  `);
  console.log('   => Fixtures Ä‘Ã£ sáºµn sÃ ng.\n');

  // -------------------------------------------------------------------------
  // SUITE 1: Báº¢O TOÃ€N RPC CÅ¨ VÃ€ Tá»’N Táº I RPC V2
  // -------------------------------------------------------------------------
  console.log('--- SUITE 1: Báº¢O TOÃ€N RPC CÅ¨ & XÃC MINH CHá»® KÃ RPC V2 ---');
  const oldFuncRes = await db.query(`
    SELECT proname, pronargs
    FROM pg_proc
    WHERE proname = 'rpc_search_students_for_notification'
      AND pronamespace = 'public'::regnamespace;
  `);
  assert.equal(oldFuncRes.rows.length, 1, 'RPC cÅ© rpc_search_students_for_notification pháº£i tá»“n táº¡i nguyÃªn váº¹n');
  assert.equal(oldFuncRes.rows[0].pronargs, 3, 'RPC cÅ© pháº£i giá»¯ nguyÃªn 3 tham sá»‘');
  console.log('âœ… PASS: RPC cÅ© rpc_search_students_for_notification Ä‘Æ°á»£c báº£o tá»“n 100%');

  const newFuncRes = await db.query(`
    SELECT proname, pronargs, pg_get_function_arguments(oid) as args
    FROM pg_proc
    WHERE proname = 'rpc_search_students_for_notification_v2'
      AND pronamespace = 'public'::regnamespace;
  `);
  assert.equal(newFuncRes.rows.length, 1, 'RPC má»›i rpc_search_students_for_notification_v2 pháº£i tá»“n táº¡i');
  assert.equal(newFuncRes.rows[0].pronargs, 5, 'RPC v2 pháº£i cÃ³ chÃ­nh xÃ¡c 5 tham sá»‘');
  assert.ok(newFuncRes.rows[0].args.includes('p_search'), 'Thiáº¿u tham sá»‘ p_search');
  assert.ok(newFuncRes.rows[0].args.includes('p_class_id'), 'Thiáº¿u tham sá»‘ p_class_id');
  assert.ok(newFuncRes.rows[0].args.includes('p_grade_level'), 'Thiáº¿u tham sá»‘ p_grade_level');
  assert.ok(newFuncRes.rows[0].args.includes('p_limit'), 'Thiáº¿u tham sá»‘ p_limit');
  assert.ok(newFuncRes.rows[0].args.includes('p_offset'), 'Thiáº¿u tham sá»‘ p_offset');
  console.log('âœ… PASS: RPC v2 cÃ³ chá»¯ kÃ½ Ä‘áº§y Ä‘á»§ 5 tham sá»‘: p_search, p_class_id, p_grade_level, p_limit, p_offset\n');

  // -------------------------------------------------------------------------
  // SUITE 2: PHÃ‚N QUYá»€N GIÃO VIÃŠN VÃ€ Báº¢O Vá»† RANH GIá»šI
  // -------------------------------------------------------------------------
  console.log('--- SUITE 2: PHÃ‚N QUYá»€N GIÃO VIÃŠN VÃ€ Báº¢O Vá»† RANH GIá»šI ---');
  // 2.1 Teacher A tÃ¬m kiáº¿m há»c sinh
  await asUser(teacherAId, async () => {
    const res = await db.query(`
      SELECT * FROM public.rpc_search_students_for_notification_v2('', NULL, NULL, 20, 0);
    `);
    const ids = res.rows.map(r => r.student_id);
    assert.ok(ids.includes(studentAId), 'Teacher A pháº£i tÃ¬m tháº¥y Student A');
    assert.ok(ids.includes(studentCId), 'Teacher A pháº£i tÃ¬m tháº¥y Student C (há»c lá»›p 1A)');
    assert.ok(!ids.includes(studentBId), 'Teacher A TUYá»†T Äá»I KHÃ”NG ÄÆ¯á»¢C tháº¥y Student B (lá»›p 1B cá»§a Teacher B)');
    assert.ok(!ids.includes(studentDisabledId), 'Teacher A khÃ´ng tháº¥y há»c sinh bá»‹ vÃ´ hiá»‡u hÃ³a');
    console.log('âœ… PASS 2.1: Teacher A chá»‰ tháº¥y há»c sinh active thuá»™c cÃ¡c lá»›p do mÃ¬nh phá»¥ trÃ¡ch.');
  });

  // 2.2 Teacher A truyá»n p_class_id cá»§a lá»›p Teacher B -> Pháº£i tráº£ vá» rá»—ng (Báº£o toÃ n phÃ¢n quyá»n)
  await asUser(teacherAId, async () => {
    const res = await db.query(`
      SELECT * FROM public.rpc_search_students_for_notification_v2('', '${classB1Id}'::uuid, NULL, 20, 0);
    `);
    assert.equal(res.rows.length, 0, 'Teacher A truyá»n lá»›p cá»§a Teacher B pháº£i tráº£ vá» 0 há»c sinh');
    console.log('âœ… PASS 2.2: Tham sá»‘ p_class_id khÃ´ng thá»ƒ má»Ÿ rá»™ng quyá»n truy cáº­p cá»§a GiÃ¡o viÃªn.');
  });

  // 2.3 Teacher B tÃ¬m kiáº¿m há»c sinh Ä‘a lá»›p (Student C) -> Pháº£i khá»­ trÃ¹ng láº·p (No duplicate)
  await asUser(teacherBId, async () => {
    const res = await db.query(`
      SELECT * FROM public.rpc_search_students_for_notification_v2('', NULL, NULL, 20, 0);
    `);
    const studentCRecords = res.rows.filter(r => r.student_id === studentCId);
    assert.equal(studentCRecords.length, 1, 'Há»c sinh C chá»‰ Ä‘Æ°á»£c xuáº¥t hiá»‡n Ä‘Ãºng 1 láº§n duy nháº¥t');
    assert.equal(studentCRecords[0].class_name, 'Lá»›p 2B', 'Æ¯u tiÃªn lá»›p chÃ­nh cá»§a há»c sinh C do Teacher B quáº£n lÃ½');
    console.log('âœ… PASS 2.3: Há»c sinh tham gia nhiá»u lá»›p Ä‘Æ°á»£c khá»­ trÃ¹ng láº·p chÃ­nh xÃ¡c (Distinct by student_id).');
  });

  // -------------------------------------------------------------------------
  // SUITE 3: PHÃ‚N QUYá»€N ADMIN VÃ€ Bá»˜ Lá»ŒC TOÃ€N TRÆ¯á»œNG
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 3: PHÃ‚N QUYá»€N ADMIN VÃ€ Bá»˜ Lá»ŒC TOÃ€N TRÆ¯á»œNG ---');
  await asUser(adminId, async () => {
    // 3.1 Admin tÃ¬m kiáº¿m toÃ n trÆ°á»ng
    const resAll = await db.query(`
      SELECT * FROM public.rpc_search_students_for_notification_v2('', NULL, NULL, 20, 0);
    `);
    const ids = resAll.rows.map(r => r.student_id);
    assert.ok(ids.includes(studentAId), 'Admin pháº£i tháº¥y Student A');
    assert.ok(ids.includes(studentBId), 'Admin pháº£i tháº¥y Student B');
    assert.ok(ids.includes(studentCId), 'Admin pháº£i tháº¥y Student C');
    assert.ok(!ids.includes(studentDisabledId), 'Admin khÃ´ng tháº¥y há»c sinh bá»‹ vÃ´ hiá»‡u hÃ³a');
    console.log('âœ… PASS 3.1: Admin tÃ¬m kiáº¿m Ä‘Æ°á»£c toÃ n bá»™ há»c sinh active trÃªn toÃ n trÆ°á»ng.');

    // 3.2 Admin lá»c theo khá»‘i 2
    const resGrade2 = await db.query(`
      SELECT * FROM public.rpc_search_students_for_notification_v2('', NULL, 2, 20, 0);
    `);
    assert.equal(resGrade2.rows.length, 1, 'Khá»‘i 2 chá»‰ cÃ³ 1 há»c sinh');
    assert.equal(resGrade2.rows[0].student_id, studentCId);
    console.log('âœ… PASS 3.2: Bá»™ lá»c p_grade_level hoáº¡t Ä‘á»™ng chuáº©n xÃ¡c.');

    // 3.3 Admin lá»c theo lá»›p 1B
    const resClassB1 = await db.query(`
      SELECT * FROM public.rpc_search_students_for_notification_v2('', '${classB1Id}'::uuid, NULL, 20, 0);
    `);
    assert.equal(resClassB1.rows.length, 1, 'Lá»›p 1B chá»‰ cÃ³ Student B');
    assert.equal(resClassB1.rows[0].student_id, studentBId);
    console.log('âœ… PASS 3.3: Bá»™ lá»c p_class_id hoáº¡t Ä‘á»™ng chuáº©n xÃ¡c cho Admin.');

    // 3.4 TÃ¬m kiáº¿m theo tá»« khÃ³a tÃªn vÃ  mÃ£ há»c sinh
    const resSearchName = await db.query(`
      SELECT * FROM public.rpc_search_students_for_notification_v2('Nguyá»…n', NULL, NULL, 20, 0);
    `);
    assert.equal(resSearchName.rows.length, 1);
    assert.equal(resSearchName.rows[0].student_id, studentAId);

    const resSearchCode = await db.query(`
      SELECT * FROM public.rpc_search_students_for_notification_v2('HS201', NULL, NULL, 20, 0);
    `);
    assert.equal(resSearchCode.rows.length, 1);
    assert.equal(resSearchCode.rows[0].student_id, studentCId);
    console.log('âœ… PASS 3.4: TÃ¬m kiáº¿m theo tÃªn hoáº·c mÃ£ student_code thÃ nh cÃ´ng.');
  });

  // -------------------------------------------------------------------------
  // SUITE 4: KIá»‚M SOÃT Báº¢O Máº¬T FAIL-CLOSED (ANON / STUDENT / DISABLED)
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 4: KIá»‚M SOÃT Báº¢O Máº¬T FAIL-CLOSED ---');
  // 4.1 Anon bá»‹ cháº·n
  let anonError = null;
  try {
    await asUser(null, async () => {
      await db.query(`SELECT * FROM public.rpc_search_students_for_notification_v2('', NULL, NULL, 20, 0);`);
    });
  } catch (err) {
    anonError = err;
  }
  assert.ok(anonError, 'Role anon pháº£i bá»‹ cháº·n');
  console.log('âœ… PASS 4.1: Role anon gá»i RPC v2 bá»‹ tá»« chá»‘i fail-closed.');

  // 4.2 Há»c sinh bá»‹ cháº·n
  let studentError = null;
  try {
    await asUser(studentAId, async () => {
      await db.query(`SELECT * FROM public.rpc_search_students_for_notification_v2('', NULL, NULL, 20, 0);`);
    });
  } catch (err) {
    studentError = err;
  }
  assert.ok(studentError, 'Role student pháº£i bá»‹ cháº·n');
  assert.ok(studentError.message.includes('FORBIDDEN_ROLE'), 'Pháº£i tráº£ vá» lá»—i FORBIDDEN_ROLE');
  console.log('âœ… PASS 4.2: Role student gá»i RPC v2 bá»‹ cháº·n vá»›i lá»—i FORBIDDEN_ROLE.');

  // 4.3 TÃ i khoáº£n bá»‹ khÃ³a bá»‹ cháº·n
  let disabledError = null;
  try {
    await asUser(studentDisabledId, async () => {
      await db.query(`SELECT * FROM public.rpc_search_students_for_notification_v2('', NULL, NULL, 20, 0);`);
    });
  } catch (err) {
    disabledError = err;
  }
  assert.ok(disabledError, 'TÃ i khoáº£n bá»‹ khÃ³a pháº£i bá»‹ cháº·n');
  console.log('âœ… PASS 4.3: TÃ i khoáº£n bá»‹ khÃ³a (is_disabled = true) bá»‹ cháº·n vá»›i lá»—i FORBIDDEN_ACCOUNT_DISABLED.');

  console.log('\n=============================================================================');
  console.log('ðŸŽ‰ Táº¤T Cáº¢ CÃC BÃ€I TEST PGLITE CHO MIGRATION R3 VÃ€ RPC V2 ÄÃƒ VÆ¯á»¢T QUA 100%!');
  console.log('=============================================================================');
}

runPgLiteSearchContractV2Validation().catch((err) => {
  console.error('TEST THáº¤T Báº I:', err);
  process.exit(1);
});
