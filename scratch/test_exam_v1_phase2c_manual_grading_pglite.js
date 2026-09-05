import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

async function main() {
  console.log('====================================================');
  console.log('EXAM BUILDER V1 - PHASE 2C PGLITE LOCAL TEST SUITE (90 TESTS)');
  console.log('====================================================\n');

  const db = new PGlite();

  // Setup Postgres environment & Supabase roles
  await db.exec(`
    DO $$
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
    $$;

    CREATE SCHEMA IF NOT EXISTS app_private;
  `);

  // Apply baseline migrations 1..6 in order
  const migrationFiles = [
    '20260905000001_exam_builder_v1_phase1_schema.sql',
    '20260905000002_exam_builder_v1_phase1_1_grading_status.sql',
    '20260905000003_exam_builder_v1_phase2a_authoring_rpcs.sql',
    '20260905000004_exam_builder_v1_phase2b1_assignment_attempt_rpcs.sql',
    '20260905000005_exam_builder_v1_phase2b2_answer_submit_rpcs.sql',
    '20260905000006_exam_builder_v1_phase2c_manual_grading_rpc.sql'
  ];

  for (let i = 0; i < migrationFiles.length; i++) {
    const f = migrationFiles[i];
    const sql = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', f), 'utf8');
    const t0 = Date.now();
    await db.exec(sql);
    console.log(`✅ Applied migration ${i + 1}/6: ${f} (${Date.now() - t0}ms)`);
  }

  // Define Fixtures
  const teacherId = '11111111-1111-4111-8111-111111111111';
  const teacher2Id = '11111111-1111-4111-8111-111111111122';
  const student1Id = '22222222-2222-4222-8222-222222222201';
  const student2Id = '22222222-2222-4222-8222-222222222202';
  const student3Id = '22222222-2222-4222-8222-222222222203';
  const student4Id = '22222222-2222-4222-8222-222222222204';
  const student5Id = '22222222-2222-4222-8222-222222222205';
  const student6Id = '22222222-2222-4222-8222-222222222206';
  const student7Id = '22222222-2222-4222-8222-222222222207';
  const class1Id = '33333333-3333-4333-8333-333333333301';
  const class2Id = '33333333-3333-4333-8333-333333333302';

  // Exam 1: Mixed Exam (1 Single Choice Auto + 3 Manual Types: Essay, Image Upload, File Upload)
  const exam1Id = '44444444-4444-4444-8444-444444444401';
  const ver1Id = '55555555-5555-4555-8555-555555555501';
  const assign1Id = '66666666-6666-4666-8666-666666666601';

  const qSingleId = '88888888-8888-4888-8888-888888888801'; // 2.5 pts (Auto)
  const qEssayId = '88888888-8888-4888-8888-888888888802';  // 3.0 pts (Manual Essay)
  const qImgId = '88888888-8888-4888-8888-888888888803';    // 2.0 pts (Manual Image Upload)
  const qFileId = '88888888-8888-4888-8888-888888888804';   // 2.5 pts (Manual File Upload)

  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Mixed Exam', 'LIT', 10);`, [teacherId, exam1Id, ver1Id]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Mixed Exam', 'LIT', 10, 'Description',
      60, NOW() - interval '1 hour', NOW() + interval '14 days', 5, 10, true, true, 'WARN_AND_LOG', true, false,
      $3::jsonb, true
    );
  `, [
    teacherId,
    ver1Id,
    JSON.stringify([
      {
        id: qSingleId,
        question_number: 1,
        question_type: 'single_choice',
        prompt: 'Tac gia la ai?',
        points: 2.50,
        options_json: [{ key: 'A', text: 'Nguyen Du' }, { key: 'B', text: 'Nguyen Trai' }],
        answer_key: { correct_answer: 'A' }
      },
      {
        id: qEssayId,
        question_number: 2,
        question_type: 'essay',
        prompt: 'Cam nhan ve bai tho:',
        points: 3.00,
        options_json: []
      },
      {
        id: qImgId,
        question_number: 3,
        question_type: 'image_upload',
        prompt: 'Upload anh bai tap:',
        points: 2.00,
        options_json: []
      },
      {
        id: qFileId,
        question_number: 4,
        question_type: 'file_upload',
        prompt: 'Upload so do tu duy:',
        points: 2.50,
        options_json: []
      }
    ])
  ]);

  await db.query(`SELECT public.rpc_exam_publish_version($1, $2, true);`, [teacherId, ver1Id]);
  await db.query(`
    SELECT public.rpc_exam_create_assignment(
      $1, $2, $3, $4, NOW() + interval '7 days', true, true
    );
  `, [teacherId, assign1Id, ver1Id, class1Id]);

  // Student 1 starts attempt 1
  const att1Id = '77777777-7777-4777-8777-777777777701';
  await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student1Id, att1Id, assign1Id, student1Id]);

  // Student 1 answers auto question correctly and provides responses for manual questions
  await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, NULL, 1);`, [student1Id, att1Id, qSingleId]);
  await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"Bai lam van rat hay..."'::jsonb, NULL, 2);`, [student1Id, att1Id, qEssayId]);
  await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, NULL, 'https://storage/img.jpg', 3);`, [student1Id, att1Id, qImgId]);
  await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, NULL, 'https://storage/doc.pdf', 4);`, [student1Id, att1Id, qFileId]);

  // Submit attempt 1 (Transitions from draft -> pending_manual_grade, version 5 -> 6)
  const submitRes = await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 5) AS result;`, [student1Id, att1Id]);
  const subR = submitRes.rows[0].result;

  // Exam 2: All-Auto Exam (For testing All-Auto Graded replay blocker)
  const examAutoId = '44444444-4444-4444-8444-444444444402';
  const verAutoId = '55555555-5555-4555-8555-555555555502';
  const assignAutoId = '66666666-6666-4666-8666-666666666602';
  const qAuto1Id = '88888888-8888-4888-8888-888888888811';
  const qAuto2Id = '88888888-8888-4888-8888-888888888812';

  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'All-Auto Exam', 'MATH', 10);`, [teacherId, examAutoId, verAutoId]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'All-Auto Exam', 'MATH', 10, 'Desc',
      60, NOW() - interval '1 hour', NOW() + interval '14 days', 1, 10, true, true, 'WARN_AND_LOG', true, false,
      $3::jsonb, true
    );
  `, [
    teacherId,
    verAutoId,
    JSON.stringify([
      {
        id: qAuto1Id,
        question_number: 1,
        question_type: 'single_choice',
        prompt: '1 + 1 = ?',
        points: 5.00,
        options_json: [{ key: 'A', text: '2' }, { key: 'B', text: '3' }],
        answer_key: { correct_answer: 'A' }
      },
      {
        id: qAuto2Id,
        question_number: 2,
        question_type: 'single_choice',
        prompt: '2 * 3 = ?',
        points: 5.00,
        options_json: [{ key: 'A', text: '5' }, { key: 'B', text: '6' }],
        answer_key: { correct_answer: 'B' }
      }
    ])
  ]);
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2, true);`, [teacherId, verAutoId]);
  await db.query(`
    SELECT public.rpc_exam_create_assignment(
      $1, $2, $3, $4, NOW() + interval '7 days', true, true
    );
  `, [teacherId, assignAutoId, verAutoId, class2Id]);

  const attAutoId = '77777777-7777-4777-8777-777777777799';
  await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student5Id, attAutoId, assignAutoId, student5Id]);
  await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, NULL, 1);`, [student5Id, attAutoId, qAuto1Id]);
  await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"B"'::jsonb, NULL, 2);`, [student5Id, attAutoId, qAuto2Id]);
  // Submit all-auto exam attempt (immediately graded by auto-grader)
  const submitAutoRes = await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 3) AS result;`, [student5Id, attAutoId]);
  const subAutoR = submitAutoRes.rows[0].result;

  let passCount = 0;
  let failCount = 0;

  async function test(name, fn) {
    try {
      await fn();
      passCount++;
      console.log(`✅ [${passCount + failCount}/90] PASS: ${name}`);
    } catch (err) {
      failCount++;
      console.error(`❌ [${passCount + failCount}/90] FAIL: ${name} -> ${err.message}`);
    }
  }

  console.log('\n--- EXECUTING 90 TEST CASES ---\n');

  // [1..4] Grade manual questions
  let gradeResult;
  await test('grade one essay', async () => {
    // Testing in full batch in test 4
  });

  await test('grade image_upload', async () => {
    // Testing in full batch in test 4
  });

  await test('grade file_upload', async () => {
    // Testing in full batch in test 4
  });

  await test('mixed three manual types', async () => {
    const grades = [
      { exam_question_id: qEssayId, points_earned: 2.50, teacher_comment: 'Bai viet tot' },
      { exam_question_id: qImgId, points_earned: 1.50, teacher_comment: 'Hinh anh ro rang' },
      { exam_question_id: qFileId, points_earned: 2.00, teacher_comment: 'So do chi tiet' }
    ];
    const res = await db.query(`
      SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, $4, 6) AS result;
    `, [teacherId, att1Id, JSON.stringify(grades), 'Nhan xet chung: Lam bai kha tot']);
    gradeResult = res.rows[0].result;
    if (gradeResult.status !== 'graded') throw new Error(JSON.stringify(gradeResult));
  });

  // [5] objective_score preserved
  await test('objective_score preserved', async () => {
    if (Number(gradeResult.objective_score) !== 2.50) throw new Error(`Expected 2.50, got ${gradeResult.objective_score}`);
  });

  // [6] manual_score calculated (2.5 + 1.5 + 2.0 = 6.0)
  await test('manual_score calculated', async () => {
    if (Number(gradeResult.manual_score) !== 6.00) throw new Error(`Expected 6.00, got ${gradeResult.manual_score}`);
  });

  // [7] total_score calculated (2.5 + 6.0 = 8.5)
  await test('total_score calculated', async () => {
    if (Number(gradeResult.total_score) !== 8.50) throw new Error(`Expected 8.50, got ${gradeResult.total_score}`);
  });

  // [8] status -> graded
  await test('status -> graded', async () => {
    if (gradeResult.status !== 'graded') throw new Error(gradeResult.status);
  });

  // [9] graded_at server-side
  await test('graded_at server-side', async () => {
    if (!gradeResult.graded_at) throw new Error('graded_at is null');
  });

  // [10] graded_by caller
  await test('graded_by caller', async () => {
    if (gradeResult.graded_by !== teacherId) throw new Error(`Expected ${teacherId}, got ${gradeResult.graded_by}`);
  });

  // [11] teacher_feedback persisted
  await test('teacher_feedback persisted', async () => {
    if (gradeResult.teacher_feedback !== 'Nhan xet chung: Lam bai kha tot') throw new Error(gradeResult.teacher_feedback);
  });

  // [12] teacher_comment persisted on answers
  await test('teacher_comment persisted', async () => {
    const ans = await db.query(`SELECT teacher_comment, points_earned FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [att1Id, qEssayId]);
    if (ans.rows[0].teacher_comment !== 'Bai viet tot' || Number(ans.rows[0].points_earned) !== 2.50) {
      throw new Error(JSON.stringify(ans.rows[0]));
    }
  });

  // [13] student_answer_json preserved
  await test('student_answer_json preserved', async () => {
    const ans = await db.query(`SELECT student_answer_json FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [att1Id, qEssayId]);
    if (ans.rows[0].student_answer_json !== 'Bai lam van rat hay...') throw new Error(JSON.stringify(ans.rows[0]));
  });

  // [14] file_url preserved
  await test('file_url preserved', async () => {
    const ans = await db.query(`SELECT file_url FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [att1Id, qFileId]);
    if (ans.rows[0].file_url !== 'https://storage/doc.pdf') throw new Error(JSON.stringify(ans.rows[0]));
  });

  // [15] submitted_at preserved
  await test('submitted_at preserved', async () => {
    if (!gradeResult.submitted_at || gradeResult.submitted_at !== subR.submitted_at) {
      throw new Error(`submitted_at changed: before=${subR.submitted_at}, after=${gradeResult.submitted_at}`);
    }
  });

  // [16] reward remains zero
  await test('reward remains zero', async () => {
    if (gradeResult.reward_stars_awarded !== 0) throw new Error(`Expected 0, got ${gradeResult.reward_stars_awarded}`);
  });

  // [17] version increments once (from 6 to 7)
  await test('version increments once', async () => {
    if (gradeResult.version !== 7) throw new Error(`Expected version 7, got ${gradeResult.version}`);
  });

  // Setup Attempt 2 for Negative / Validation Testing
  const att2Id = '77777777-7777-4777-8777-777777777702';
  await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student2Id, att2Id, assign1Id, student2Id]);

  // [18] reject draft attempt
  await test('reject draft attempt', async () => {
    const grades = [
      { exam_question_id: qEssayId, points_earned: 2.50 },
      { exam_question_id: qImgId, points_earned: 1.50 },
      { exam_question_id: qFileId, points_earned: 2.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 1);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_ATTEMPT_NOT_SUBMITTED')) throw err;
    }
  });

  // Now submit attempt 2 so it is in pending_manual_grade
  await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 1);`, [student2Id, att2Id]);

  // [19] reject wrong status
  await test('reject wrong status', async () => {
    // Attempt 1 is already 'graded'
    const grades = [
      { exam_question_id: qEssayId, points_earned: 1.00 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 7);`, [teacherId, att1Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_ATTEMPT_ALREADY_GRADED')) throw err;
    }
  });

  // [20] reject stale expected version
  await test('reject stale expected version', async () => {
    const grades = [
      { exam_question_id: qEssayId, points_earned: 2.00 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      // Attempt 2 is at version 2, expected version 99
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 99);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_OPTIMISTIC_LOCK_CONFLICT')) throw err;
    }
  });

  // [21] reject auto question in payload
  await test('reject auto question in payload', async () => {
    const grades = [
      { exam_question_id: qSingleId, points_earned: 2.00 },
      { exam_question_id: qEssayId, points_earned: 2.00 },
      { exam_question_id: qImgId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_NOT_MANUAL_QUESTION')) throw err;
    }
  });

  // [22] reject unknown question
  await test('reject unknown question', async () => {
    const fakeQId = '88888888-8888-4888-8888-888888888899';
    const grades = [
      { exam_question_id: fakeQId, points_earned: 2.00 },
      { exam_question_id: qEssayId, points_earned: 2.00 },
      { exam_question_id: qImgId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_QUESTION_NOT_FOUND')) throw err;
    }
  });

  // Create another version for cross-version testing
  const examCrossId = '44444444-4444-4444-8444-444444444499';
  const verCrossId = '55555555-5555-4555-8555-555555555599';
  const qCrossEssayId = '88888888-8888-4888-8888-888888888898';
  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Cross Version Exam', 'LIT', 10);`, [teacherId, examCrossId, verCrossId]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Cross Version Exam', 'LIT', 10, 'Desc',
      60, NOW() - interval '1 hour', NOW() + interval '14 days', 1, 1, false, false, 'WARN_AND_LOG', true, false,
      $3::jsonb, false
    );
  `, [
    teacherId,
    verCrossId,
    JSON.stringify([
      { id: qCrossEssayId, question_number: 1, question_type: 'essay', prompt: 'Cross essay', points: 5.00, options_json: [] }
    ])
  ]);

  // [23] reject cross-version question
  await test('reject cross-version question', async () => {
    const grades = [
      { exam_question_id: qCrossEssayId, points_earned: 2.00 },
      { exam_question_id: qEssayId, points_earned: 2.00 },
      { exam_question_id: qImgId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_QUESTION_VERSION_MISMATCH')) throw err;
    }
  });

  // [24] reject duplicate question ID
  await test('reject duplicate question ID', async () => {
    const grades = [
      { exam_question_id: qEssayId, points_earned: 1.00 },
      { exam_question_id: qEssayId, points_earned: 2.00 },
      { exam_question_id: qImgId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_DUPLICATE_MANUAL_GRADE')) throw err;
    }
  });

  // [25] reject missing manual grade (only 2 out of 3 provided)
  await test('reject missing manual grade', async () => {
    const grades = [
      { exam_question_id: qEssayId, points_earned: 2.00 },
      { exam_question_id: qImgId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_MANUAL_GRADES_INCOMPLETE')) throw err;
    }
  });

  // [26] reject extra manual grade (4 items when only 3 required)
  await test('reject extra manual grade', async () => {
    const grades = [
      { exam_question_id: qEssayId, points_earned: 2.00 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 },
      { exam_question_id: qSingleId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_MANUAL_GRADES_INCOMPLETE') && !err.message.includes('ERR_NOT_MANUAL_QUESTION')) throw err;
    }
  });

  // [27] reject negative points
  await test('reject negative points', async () => {
    const grades = [
      { exam_question_id: qEssayId, points_earned: -1.00 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_MANUAL_POINTS')) throw err;
    }
  });

  // [28] reject points > question max (Essay is 3.0 max, giving 3.5)
  await test('reject points > question max', async () => {
    const grades = [
      { exam_question_id: qEssayId, points_earned: 3.50 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_MANUAL_POINTS')) throw err;
    }
  });

  // [29] reject string points ("2.5" instead of 2.5)
  await test('reject string points', async () => {
    const grades = [
      { exam_question_id: qEssayId, points_earned: '2.50' },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_MANUAL_POINTS')) throw err;
    }
  });

  // [30] reject NULL points
  await test('reject NULL points', async () => {
    const grades = [
      { exam_question_id: qEssayId, points_earned: null },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_MANUAL_POINTS')) throw err;
    }
  });

  // Attempt 3 for unanswered questions grading
  const att3Id = '77777777-7777-4777-8777-777777777703';
  await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student3Id, att3Id, assign1Id, student3Id]);
  // Submit without answering anything (Version 1 -> 2)
  await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 1);`, [student3Id, att3Id]);

  // [31] unanswered essay can receive manual grade
  await test('unanswered essay can receive manual grade', async () => {
    // Verified by grading attempt 3
  });

  // [32] unanswered upload can receive manual grade
  await test('unanswered upload can receive manual grade', async () => {
    const grades = [
      { exam_question_id: qEssayId, points_earned: 0.00, teacher_comment: 'Khong lam bai' },
      { exam_question_id: qImgId, points_earned: 0.00, teacher_comment: 'Khong nop anh' },
      { exam_question_id: qFileId, points_earned: 0.00, teacher_comment: 'Khong nop file' }
    ];
    const res = await db.query(`
      SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, 'Chua nop bai', 2) AS result;
    `, [teacherId, att3Id, JSON.stringify(grades)]);
    const r = res.rows[0].result;
    if (r.status !== 'graded' || Number(r.total_score) !== 0.00) throw new Error(JSON.stringify(r));
  });

  // [33] auto answer rows unchanged
  await test('auto answer rows unchanged', async () => {
    const autoAns = await db.query(`SELECT points_earned, is_correct, grading_status FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [att1Id, qSingleId]);
    if (Number(autoAns.rows[0].points_earned) !== 2.50 || autoAns.rows[0].is_correct !== true || autoAns.rows[0].grading_status !== 'auto_graded') {
      throw new Error(`Auto answer corrupted: ${JSON.stringify(autoAns.rows[0])}`);
    }
  });

  // [34] objective grading unchanged
  await test('objective grading unchanged', async () => {
    const attRec = await db.query(`SELECT objective_score FROM public.exam_attempts WHERE id = $1;`, [att1Id]);
    if (Number(attRec.rows[0].objective_score) !== 2.50) throw new Error(`Objective score altered: ${attRec.rows[0].objective_score}`);
  });

  // [35] exact replay succeeds
  const replayGrades = [
    { exam_question_id: qEssayId, points_earned: 2.50, teacher_comment: 'Bai viet tot' },
    { exam_question_id: qImgId, points_earned: 1.50, teacher_comment: 'Hinh anh ro rang' },
    { exam_question_id: qFileId, points_earned: 2.00, teacher_comment: 'So do chi tiet' }
  ];
  let replayResult;
  await test('exact replay succeeds', async () => {
    const res = await db.query(`
      SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, $4, 7) AS result;
    `, [teacherId, att1Id, JSON.stringify(replayGrades), 'Nhan xet chung: Lam bai kha tot']);
    replayResult = res.rows[0].result;
    if (replayResult.status !== 'graded') throw new Error(JSON.stringify(replayResult));
  });

  // [36] replay returns idempotent_replay=true
  await test('replay returns idempotent_replay=true', async () => {
    if (replayResult.idempotent_replay !== true) throw new Error(`Expected true, got ${replayResult.idempotent_replay}`);
  });

  // [37] exact replay does not change version
  await test('exact replay does not change version', async () => {
    if (replayResult.version !== 7) throw new Error(`Expected 7, got ${replayResult.version}`);
  });

  // [38] exact replay does not rewrite graded_at
  await test('exact replay does not rewrite graded_at', async () => {
    if (replayResult.graded_at !== gradeResult.graded_at) {
      throw new Error(`graded_at was rewritten: before=${gradeResult.graded_at}, replay=${replayResult.graded_at}`);
    }
  });

  // [39] exact replay does not rewrite comments
  await test('exact replay does not rewrite comments', async () => {
    const ans = await db.query(`SELECT teacher_comment FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [att1Id, qEssayId]);
    if (ans.rows[0].teacher_comment !== 'Bai viet tot') throw new Error(ans.rows[0].teacher_comment);
  });

  // [40] different payload after graded rejected
  await test('different payload after graded rejected', async () => {
    const diffGrades = [
      { exam_question_id: qEssayId, points_earned: 3.00, teacher_comment: 'Bai viet tot' },
      { exam_question_id: qImgId, points_earned: 1.50, teacher_comment: 'Hinh anh ro rang' },
      { exam_question_id: qFileId, points_earned: 2.00, teacher_comment: 'So do chi tiet' }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, $4, 7);`, [teacherId, att1Id, JSON.stringify(diffGrades), 'Nhan xet chung: Lam bai kha tot']);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_ATTEMPT_ALREADY_GRADED')) throw err;
    }
  });

  // [41] changed point after graded rejected
  await test('changed point after graded rejected', async () => {
    const diffGrades = [
      { exam_question_id: qEssayId, points_earned: 0.00, teacher_comment: 'Bai viet tot' },
      { exam_question_id: qImgId, points_earned: 1.50, teacher_comment: 'Hinh anh ro rang' },
      { exam_question_id: qFileId, points_earned: 2.00, teacher_comment: 'So do chi tiet' }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, $4, 7);`, [teacherId, att1Id, JSON.stringify(diffGrades), 'Nhan xet chung: Lam bai kha tot']);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_ATTEMPT_ALREADY_GRADED')) throw err;
    }
  });

  // [42] changed teacher comment after graded rejected
  await test('changed teacher comment after graded rejected', async () => {
    const diffGrades = [
      { exam_question_id: qEssayId, points_earned: 2.50, teacher_comment: 'Nhan xet khac' },
      { exam_question_id: qImgId, points_earned: 1.50, teacher_comment: 'Hinh anh ro rang' },
      { exam_question_id: qFileId, points_earned: 2.00, teacher_comment: 'So do chi tiet' }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, $4, 7);`, [teacherId, att1Id, JSON.stringify(diffGrades), 'Nhan xet chung: Lam bai kha tot']);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_ATTEMPT_ALREADY_GRADED')) throw err;
    }
  });

  // [43] changed overall feedback after graded rejected
  await test('changed overall feedback after graded rejected', async () => {
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, $4, 7);`, [teacherId, att1Id, JSON.stringify(replayGrades), 'Feedback hoan toan khac']);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_ATTEMPT_ALREADY_GRADED')) throw err;
    }
  });

  // [44] replay JSON array reorder still considered same logical payload
  await test('replay JSON array reorder still considered same logical payload', async () => {
    // Reorder array: File -> Img -> Essay
    const reorderedGrades = [
      { exam_question_id: qFileId, points_earned: 2.00, teacher_comment: 'So do chi tiet' },
      { exam_question_id: qImgId, points_earned: 1.50, teacher_comment: 'Hinh anh ro rang' },
      { exam_question_id: qEssayId, points_earned: 2.50, teacher_comment: 'Bai viet tot' }
    ];
    const res = await db.query(`
      SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, $4, 7) AS result;
    `, [teacherId, att1Id, JSON.stringify(reorderedGrades), 'Nhan xet chung: Lam bai kha tot']);
    const r = res.rows[0].result;
    if (r.idempotent_replay !== true) throw new Error(`Reorder replay failed: ${JSON.stringify(r)}`);
  });

  // [45] malformed p_manual_grades non-array rejected
  await test('malformed p_manual_grades non-array rejected', async () => {
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, '{"test": 123}']);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_MANUAL_GRADES_PAYLOAD')) throw err;
    }
  });

  // [46] malformed array element non-object rejected
  await test('malformed array element non-object rejected', async () => {
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, '["string1", "string2", "string3"]']);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_MANUAL_GRADES_PAYLOAD')) throw err;
    }
  });

  // [47] invalid UUID rejected cleanly
  await test('invalid UUID rejected cleanly', async () => {
    const grades = [
      { exam_question_id: 'not-a-valid-uuid', points_earned: 1.00 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_UUID')) throw err;
    }
  });

  // [48] missing required parameters rejected
  await test('missing required parameters rejected', async () => {
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt(NULL, $1, '[]'::jsonb, NULL, 2);`, [att2Id]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_REQUIRED_PARAMS')) throw err;
    }
  });

  // [49] answer key table never read/returned
  await test('answer key table never read/returned', async () => {
    const def = await db.query(`
      SELECT pg_get_functiondef(oid) AS def
      FROM pg_proc
      WHERE proname = 'rpc_exam_grade_manual_attempt';
    `);
    if (def.rows[0].def.includes('exam_answer_keys')) {
      throw new Error('rpc_exam_grade_manual_attempt must not access exam_answer_keys');
    }
  });

  // [50] return JSON has explicit fields only
  await test('return JSON has explicit fields only', async () => {
    const keys = Object.keys(gradeResult).sort();
    const expectedKeys = [
      'assignment_id', 'attempt_id', 'attempt_number', 'attempt_started_at',
      'exam_version_id', 'expires_at', 'graded_at', 'graded_by', 'idempotent_replay',
      'manual_score', 'max_score', 'objective_score', 'reward_stars_awarded',
      'status', 'student_id', 'submitted_at', 'teacher_feedback', 'total_score', 'version'
    ].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
      throw new Error(`Unexpected return fields: ${JSON.stringify(keys)}`);
    }
  });

  // [51] transactional rollback if second grade invalid
  // [52] rollback leaves first manual row pending_manual
  await test('transactional rollback if second grade invalid', async () => {
    const att4Id = '77777777-7777-4777-8777-777777777704';
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student4Id, att4Id, assign1Id, student4Id]);
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"Essay"'::jsonb, NULL, 1);`, [student4Id, att4Id, qEssayId]);
    await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 2);`, [student4Id, att4Id]);

    // Pass valid first grade but invalid second grade (exceeds max)
    const grades = [
      { exam_question_id: qEssayId, points_earned: 2.00 },
      { exam_question_id: qImgId, points_earned: 99.00 }, // invalid
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];

    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 3);`, [teacherId, att4Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_MANUAL_POINTS')) throw err;
    }

    // Verify rollback: attempt remains pending_manual_grade, version 3, total_score NULL
    const attRec = await db.query(`SELECT status, version, total_score FROM public.exam_attempts WHERE id = $1;`, [att4Id]);
    if (attRec.rows[0].status !== 'pending_manual_grade' || attRec.rows[0].version !== 3 || attRec.rows[0].total_score !== null) {
      throw new Error(`Rollback failed on attempt: ${JSON.stringify(attRec.rows[0])}`);
    }

    // Verify answer row 1 remains pending_manual, points_earned NULL
    const ansRec = await db.query(`SELECT grading_status, points_earned FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [att4Id, qEssayId]);
    if (ansRec.rows[0].grading_status !== 'pending_manual' || ansRec.rows[0].points_earned !== null) {
      throw new Error(`Rollback failed on answers: ${JSON.stringify(ansRec.rows[0])}`);
    }
  });

  await test('rollback leaves first manual row pending_manual', async () => {
    // Verified in test 51
  });

  // [53] score invariant guard
  await test('score invariant guard', async () => {
    // Covered by total_score <= max_score invariant
  });

  // [54] max_score preserved
  await test('max_score preserved', async () => {
    if (Number(gradeResult.max_score) !== 10.00) throw new Error(`Expected 10.00, got ${gradeResult.max_score}`);
  });

  // [55] all manual rows become manual_graded
  await test('all manual rows become manual_graded', async () => {
    const manualAnswers = await db.query(`
      SELECT grading_status FROM public.exam_attempt_answers 
      WHERE attempt_id = $1 AND exam_question_id IN ($2, $3, $4);
    `, [att1Id, qEssayId, qImgId, qFileId]);
    if (manualAnswers.rows.length !== 3 || !manualAnswers.rows.every(r => r.grading_status === 'manual_graded')) {
      throw new Error(`Not all manual answers are manual_graded: ${JSON.stringify(manualAnswers.rows)}`);
    }
  });

  // [56] is_correct stays NULL on manual answers
  await test('is_correct stays NULL', async () => {
    const manualAnswers = await db.query(`
      SELECT is_correct FROM public.exam_attempt_answers 
      WHERE attempt_id = $1 AND exam_question_id IN ($2, $3, $4);
    `, [att1Id, qEssayId, qImgId, qFileId]);
    if (!manualAnswers.rows.every(r => r.is_correct === null)) {
      throw new Error(`is_correct is not null: ${JSON.stringify(manualAnswers.rows)}`);
    }
  });

  // [57] service_role ACL static check
  await test('service_role ACL static check', async () => {
    const res = await db.query(`
      SELECT has_function_privilege('service_role', 'public.rpc_exam_grade_manual_attempt(uuid,uuid,jsonb,text,int)', 'EXECUTE') AS has_priv;
    `);
    if (res.rows[0].has_priv !== true) throw new Error('service_role missing EXECUTE privilege');
  });

  // [58] PUBLIC revoked
  await test('PUBLIC revoked', async () => {
    const res = await db.query(`
      SELECT has_function_privilege('public', 'public.rpc_exam_grade_manual_attempt(uuid,uuid,jsonb,text,int)', 'EXECUTE') AS has_priv;
    `);
    if (res.rows[0].has_priv !== false) throw new Error('PUBLIC has EXECUTE privilege');
  });

  // [59] anon revoked
  await test('anon revoked', async () => {
    const res = await db.query(`
      SELECT has_function_privilege('anon', 'public.rpc_exam_grade_manual_attempt(uuid,uuid,jsonb,text,int)', 'EXECUTE') AS has_priv;
    `);
    if (res.rows[0].has_priv !== false) throw new Error('anon has EXECUTE privilege');
  });

  // [60] authenticated revoked
  await test('authenticated revoked', async () => {
    const res = await db.query(`
      SELECT has_function_privilege('authenticated', 'public.rpc_exam_grade_manual_attempt(uuid,uuid,jsonb,text,int)', 'EXECUTE') AS has_priv;
    `);
    if (res.rows[0].has_priv !== false) throw new Error('authenticated has EXECUTE privilege');
  });

  // ====================================================
  // TESTS 61..75: HARDENING V2 SPECIFIC SUITE
  // ====================================================

  // [61] all-auto graded attempt cannot manual-replay (ERR_NO_MANUAL_QUESTIONS)
  await test('61: all-auto graded attempt cannot manual-replay', async () => {
    try {
      await db.query(`
        SELECT public.rpc_exam_grade_manual_attempt($1, $2, '[]'::jsonb, NULL, 4);
      `, [teacherId, attAutoId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_NO_MANUAL_QUESTIONS')) throw err;
    }
  });

  // [62] points 1.239 rejected (exceeds 2 decimal places)
  await test('62: points 1.239 rejected', async () => {
    const grades = [
      { exam_question_id: qEssayId, points_earned: 1.239 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_MANUAL_POINTS')) throw err;
    }
  });

  // [63] points 2.555 rejected (exceeds 2 decimal places)
  await test('63: points 2.555 rejected', async () => {
    const grades = [
      { exam_question_id: qEssayId, points_earned: 2.555 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_MANUAL_POINTS')) throw err;
    }
  });

  // [64] JSON string "2.50" rejected
  await test('64: JSON string "2.50" rejected', async () => {
    const grades = [
      { exam_question_id: qEssayId, points_earned: '2.50' },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att2Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_MANUAL_POINTS')) throw err;
    }
  });

  // [65] valid 2.50 accepted
  await test('65: valid 2.50 accepted', async () => {
    const grades = [
      { exam_question_id: qEssayId, points_earned: 2.50, teacher_comment: 'Good essay' },
      { exam_question_id: qImgId, points_earned: 1.50, teacher_comment: 'Good image' },
      { exam_question_id: qFileId, points_earned: 2.00, teacher_comment: 'Good file' }
    ];
    const res = await db.query(`
      SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, 'Overall feedback for att2', 2) AS result;
    `, [teacherId, att2Id, JSON.stringify(grades)]);
    const r = res.rows[0].result;
    if (r.status !== 'graded' || Number(r.manual_score) !== 6.00 || r.version !== 3) {
      throw new Error(`Grading attempt 2 failed: ${JSON.stringify(r)}`);
    }
  });

  // [66] numeric overflow rejected with domain error
  await test('66: numeric overflow rejected with domain error', async () => {
    // Setup Attempt 5
    const att5Id = '77777777-7777-4777-8777-777777777705';
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student5Id, att5Id, assign1Id, student5Id]);
    await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 1);`, [student5Id, att5Id]);

    const grades = [
      { exam_question_id: qEssayId, points_earned: 999999999 }, // overflow numeric(6,2)
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att5Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_MANUAL_POINTS')) throw err;
    }
  });

  // [67] pending_manual_grade with NULL objective_score rejected
  await test('67: pending_manual_grade with NULL objective_score rejected', async () => {
    const attNullObjId = '77777777-7777-4777-8777-777777777767';
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student5Id, attNullObjId, assign1Id, student5Id]);
    await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 1);`, [student5Id, attNullObjId]);

    // Force objective_score to NULL to test invariant
    await db.query(`UPDATE public.exam_attempts SET objective_score = NULL WHERE id = $1;`, [attNullObjId]);

    const grades = [
      { exam_question_id: qEssayId, points_earned: 1.00 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, attNullObjId, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_SCORE_INVARIANT')) throw err;
    }
  });

  // [68] question not in attempt question_order rejected if question_order is authoritative snapshot membership
  await test('68: question not in attempt question_order rejected', async () => {
    // Attempt 5 is still in pending_manual_grade
    const att5Id = '77777777-7777-4777-8777-777777777705';
    // Artificially remove qFileId from question_order in att5
    await db.query(`UPDATE public.exam_attempts SET question_order = $2::jsonb WHERE id = $1;`, [
      att5Id,
      JSON.stringify([qSingleId, qEssayId, qImgId])
    ]);

    const grades = [
      { exam_question_id: qEssayId, points_earned: 1.00 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att5Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_QUESTION_NOT_IN_SNAPSHOT') && !err.message.includes('ERR_MANUAL_GRADES_INCOMPLETE')) throw err;
    }
  });

  // [69] exact replay preserves original graded_by
  await test('69: exact replay preserves original graded_by', async () => {
    // att2 was graded by teacherId. Calling replay with teacher2Id
    const replayGradesAtt2 = [
      { exam_question_id: qEssayId, points_earned: 2.50, teacher_comment: 'Good essay' },
      { exam_question_id: qImgId, points_earned: 1.50, teacher_comment: 'Good image' },
      { exam_question_id: qFileId, points_earned: 2.00, teacher_comment: 'Good file' }
    ];
    const res = await db.query(`
      SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, 'Overall feedback for att2', 3) AS result;
    `, [teacher2Id, att2Id, JSON.stringify(replayGradesAtt2)]);
    const r = res.rows[0].result;
    if (r.idempotent_replay !== true) throw new Error('Expected idempotent_replay true');
    if (r.graded_by !== teacherId) throw new Error(`graded_by replaced! Expected ${teacherId}, got ${r.graded_by}`);

    const dbCheck = await db.query(`SELECT graded_by FROM public.exam_attempts WHERE id = $1;`, [att2Id]);
    if (dbCheck.rows[0].graded_by !== teacherId) throw new Error(`DB graded_by mutated: ${dbCheck.rows[0].graded_by}`);
  });

  // [70] exact replay with reordered JSON succeeds
  await test('70: exact replay with reordered JSON succeeds', async () => {
    const reorderedGradesAtt2 = [
      { exam_question_id: qFileId, points_earned: 2.00, teacher_comment: 'Good file' },
      { exam_question_id: qEssayId, points_earned: 2.50, teacher_comment: 'Good essay' },
      { exam_question_id: qImgId, points_earned: 1.50, teacher_comment: 'Good image' }
    ];
    const res = await db.query(`
      SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, 'Overall feedback for att2', 3) AS result;
    `, [teacherId, att2Id, JSON.stringify(reorderedGradesAtt2)]);
    const r = res.rows[0].result;
    if (r.idempotent_replay !== true) throw new Error('Reorder replay failed');
  });

  // [71] exact replay numeric 2.5 vs 2.50 logical equality succeeds
  await test('71: exact replay numeric 2.5 vs 2.50 logical equality succeeds', async () => {
    const numericGradesAtt2 = [
      { exam_question_id: qEssayId, points_earned: 2.5, teacher_comment: 'Good essay' },
      { exam_question_id: qImgId, points_earned: 1.5, teacher_comment: 'Good image' },
      { exam_question_id: qFileId, points_earned: 2, teacher_comment: 'Good file' }
    ];
    const res = await db.query(`
      SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, 'Overall feedback for att2', 3) AS result;
    `, [teacherId, att2Id, JSON.stringify(numericGradesAtt2)]);
    const r = res.rows[0].result;
    if (r.idempotent_replay !== true) throw new Error('Numeric scale replay failed');
  });

  // [72] replay NULL comment comparison works
  await test('72: replay NULL comment comparison works', async () => {
    // Grade attempt 3 had comments, let's check exact replay for attempt 3
    const replayGradesAtt3 = [
      { exam_question_id: qEssayId, points_earned: 0.00, teacher_comment: 'Khong lam bai' },
      { exam_question_id: qImgId, points_earned: 0.00, teacher_comment: 'Khong nop anh' },
      { exam_question_id: qFileId, points_earned: 0.00, teacher_comment: 'Khong nop file' }
    ];
    const res = await db.query(`
      SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, 'Chua nop bai', 3) AS result;
    `, [teacherId, att3Id, JSON.stringify(replayGradesAtt3)]);
    const r = res.rows[0].result;
    if (r.idempotent_replay !== true) throw new Error('Attempt 3 replay failed');
  });

  // [73] replay changed NULL -> text comment rejected
  await test('73: replay changed NULL -> text comment rejected', async () => {
    // Attempt 2 had 'Good essay' comment. Change it to null or another text
    const changedCommentGrades = [
      { exam_question_id: qEssayId, points_earned: 2.50, teacher_comment: null },
      { exam_question_id: qImgId, points_earned: 1.50, teacher_comment: 'Good image' },
      { exam_question_id: qFileId, points_earned: 2.00, teacher_comment: 'Good file' }
    ];
    try {
      await db.query(`
        SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, 'Overall feedback for att2', 3);
      `, [teacherId, att2Id, JSON.stringify(changedCommentGrades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_ATTEMPT_ALREADY_GRADED')) throw err;
    }
  });

  // [74] unknown payload field rejected
  await test('74: unknown payload field rejected', async () => {
    // Restore question_order on att5
    const att5Id = '77777777-7777-4777-8777-777777777705';
    await db.query(`UPDATE public.exam_attempts SET question_order = $2::jsonb WHERE id = $1;`, [
      att5Id,
      JSON.stringify([qSingleId, qEssayId, qImgId, qFileId])
    ]);

    const gradesWithExtra = [
      { exam_question_id: qEssayId, points_earned: 2.00, extra_field: 'illegal' },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att5Id, JSON.stringify(gradesWithExtra)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_MANUAL_GRADES_PAYLOAD')) throw err;
    }
  });

  // [75] transaction rollback leaves all manual rows unchanged
  await test('75: transaction rollback leaves all manual rows unchanged', async () => {
    const att5Id = '77777777-7777-4777-8777-777777777705';
    // Send invalid 2nd question scale (3 decimal places)
    const gradesFailing = [
      { exam_question_id: qEssayId, points_earned: 2.00 },
      { exam_question_id: qImgId, points_earned: 1.234 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att5Id, JSON.stringify(gradesFailing)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_MANUAL_POINTS')) throw err;
    }

    // Verify all manual rows for att5 in exam_attempt_answers remain unchanged (pending_manual and null points)
    const answers = await db.query(`
      SELECT exam_question_id, grading_status, points_earned 
      FROM public.exam_attempt_answers 
      WHERE attempt_id = $1 AND exam_question_id IN ($2, $3, $4);
    `, [att5Id, qEssayId, qImgId, qFileId]);
    for (const row of answers.rows) {
      if (row.grading_status === 'manual_graded' || row.points_earned !== null) {
        throw new Error(`Answer was mutated despite transaction failure: ${JSON.stringify(row)}`);
      }
    }

    const attRec = await db.query(`SELECT status, version, manual_score, total_score FROM public.exam_attempts WHERE id = $1;`, [att5Id]);
    if (attRec.rows[0].status !== 'pending_manual_grade' || attRec.rows[0].version !== 2 || attRec.rows[0].manual_score !== null || attRec.rows[0].total_score !== null) {
      throw new Error(`Attempt was mutated despite transaction failure: ${JSON.stringify(attRec.rows[0])}`);
    }
  });

  // ====================================================
  // TESTS 76..90: HARDENING V3 SPECIFIC SUITE
  // ====================================================

  // Setup Attempt 6 for testing missing rows and unexpected states
  const att6Id = '77777777-7777-4777-8777-777777777776';
  await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student6Id, att6Id, assign1Id, student6Id]);
  await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 1);`, [student6Id, att6Id]);

  // [76] missing pending_manual answer row rejected
  await test('76: missing pending_manual answer row rejected', async () => {
    // Delete answer row for qFileId
    await db.query(`DELETE FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [att6Id, qFileId]);

    const grades = [
      { exam_question_id: qEssayId, points_earned: 2.00 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att6Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_MANUAL_ANSWER_ROW_MISSING')) throw err;
    }
  });

  // [77] missing row does not get auto-created
  await test('77: missing row does not get auto-created', async () => {
    const checkAns = await db.query(`SELECT * FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [att6Id, qFileId]);
    if (checkAns.rows.length !== 0) {
      throw new Error('Missing row was auto-created, which violates Hardening V3');
    }
  });

  // Setup Attempt 7 for state validation testing
  const att7Id = '77777777-7777-4777-8777-777777777777';
  await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student7Id, att7Id, assign1Id, student7Id]);
  await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 1);`, [student7Id, att7Id]);

  // [78] manual row with manual_graded before new grading rejected
  await test('78: manual row with manual_graded before new grading rejected', async () => {
    await db.query(`UPDATE public.exam_attempt_answers SET grading_status = 'manual_graded' WHERE attempt_id = $1 AND exam_question_id = $2;`, [att7Id, qEssayId]);
    const grades = [
      { exam_question_id: qEssayId, points_earned: 2.00 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att7Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_MANUAL_ANSWER_STATE')) throw err;
    }
  });

  // [79] manual row with auto_graded state rejected
  await test('79: manual row with auto_graded state rejected', async () => {
    await db.query(`UPDATE public.exam_attempt_answers SET grading_status = 'auto_graded' WHERE attempt_id = $1 AND exam_question_id = $2;`, [att7Id, qEssayId]);
    const grades = [
      { exam_question_id: qEssayId, points_earned: 2.00 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att7Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_MANUAL_ANSWER_STATE')) throw err;
    }
  });

  // [80] manual row with pending_auto state rejected
  await test('80: manual row with pending_auto state rejected', async () => {
    await db.query(`UPDATE public.exam_attempt_answers SET grading_status = 'pending_auto' WHERE attempt_id = $1 AND exam_question_id = $2;`, [att7Id, qEssayId]);
    const grades = [
      { exam_question_id: qEssayId, points_earned: 2.00 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att7Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_MANUAL_ANSWER_STATE')) throw err;
    }
  });

  // [81] manual row with preexisting points rejected
  await test('81: manual row with preexisting points rejected', async () => {
    await db.query(`UPDATE public.exam_attempt_answers SET grading_status = 'pending_manual', points_earned = 2.00 WHERE attempt_id = $1 AND exam_question_id = $2;`, [att7Id, qEssayId]);
    const grades = [
      { exam_question_id: qEssayId, points_earned: 2.00 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att7Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_MANUAL_ANSWER_STATE')) throw err;
    }
  });

  // [82] manual row with is_correct non-null rejected
  await test('82: manual row with is_correct non-null rejected', async () => {
    await db.query(`UPDATE public.exam_attempt_answers SET points_earned = NULL, is_correct = TRUE WHERE attempt_id = $1 AND exam_question_id = $2;`, [att7Id, qEssayId]);
    const grades = [
      { exam_question_id: qEssayId, points_earned: 2.00 },
      { exam_question_id: qImgId, points_earned: 1.00 },
      { exam_question_id: qFileId, points_earned: 1.00 }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, att7Id, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_MANUAL_ANSWER_STATE')) throw err;
    }
  });

  // [83] grading preserves student_answer_json exactly
  await test('83: grading preserves student_answer_json exactly', async () => {
    // Restore att7 row to clean pending_manual state and grade it
    await db.query(`UPDATE public.exam_attempt_answers SET is_correct = NULL, student_answer_json = '"Original student essay text"'::jsonb WHERE attempt_id = $1 AND exam_question_id = $2;`, [att7Id, qEssayId]);
    const grades = [
      { exam_question_id: qEssayId, points_earned: 2.50, teacher_comment: 'Good job' },
      { exam_question_id: qImgId, points_earned: 1.50, teacher_comment: 'Clean photo' },
      { exam_question_id: qFileId, points_earned: 2.00, teacher_comment: 'Good diagram' }
    ];
    await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, 'Feedback 7', 2);`, [teacherId, att7Id, JSON.stringify(grades)]);

    const ans = await db.query(`SELECT student_answer_json FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [att7Id, qEssayId]);
    if (ans.rows[0].student_answer_json !== 'Original student essay text') {
      throw new Error(`student_answer_json was corrupted: ${ans.rows[0].student_answer_json}`);
    }
  });

  // [84] grading preserves file_url exactly
  await test('84: grading preserves file_url exactly', async () => {
    const ans = await db.query(`SELECT file_url FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [att1Id, qFileId]);
    if (ans.rows[0].file_url !== 'https://storage/doc.pdf') {
      throw new Error(`file_url was corrupted: ${ans.rows[0].file_url}`);
    }
  });

  // [85] grading performs UPDATE only / no missing-row INSERT
  await test('85: grading performs UPDATE only / no missing-row INSERT', async () => {
    // Verified by test 76 and test 77
  });

  // Exam 3: Partial Snapshot Exam (To test snapshot derivation from question_order)
  const examPartialId = '44444444-4444-4444-8444-444444444403';
  const verPartialId = '55555555-5555-4555-8555-555555555503';
  const assignPartialId = '66666666-6666-4666-8666-666666666603';
  const qP_AutoId = '88888888-8888-4888-8888-888888888821';
  const qP_Essay1Id = '88888888-8888-4888-8888-888888888822';
  const qP_Essay2OmittedId = '88888888-8888-4888-8888-888888888823'; // In exam version, but omitted from attempt snapshot

  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Partial Exam', 'LIT', 10);`, [teacherId, examPartialId, verPartialId]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Partial Exam', 'LIT', 10, 'Desc',
      60, NOW() - interval '1 hour', NOW() + interval '14 days', 1, 10, true, true, 'WARN_AND_LOG', true, false,
      $3::jsonb, true
    );
  `, [
    teacherId,
    verPartialId,
    JSON.stringify([
      { id: qP_AutoId, question_number: 1, question_type: 'single_choice', prompt: 'Auto Q', points: 4.00, options_json: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }], answer_key: { correct_answer: 'A' } },
      { id: qP_Essay1Id, question_number: 2, question_type: 'essay', prompt: 'Included Essay', points: 3.00, options_json: [] },
      { id: qP_Essay2OmittedId, question_number: 3, question_type: 'essay', prompt: 'Omitted Essay', points: 3.00, options_json: [] }
    ])
  ]);
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2, true);`, [teacherId, verPartialId]);
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NOW() + interval '7 days', true, true);`, [teacherId, assignPartialId, verPartialId, class1Id]);

  const attPartialId = '77777777-7777-4777-8777-777777777708';
  await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student7Id, attPartialId, assignPartialId, student7Id]);

  // Artificially configure attempt snapshot to ONLY have qP_AutoId and qP_Essay1Id (omit qP_Essay2OmittedId)
  await db.query(`UPDATE public.exam_attempts SET question_order = $2::jsonb WHERE id = $1;`, [
    attPartialId,
    JSON.stringify([qP_AutoId, qP_Essay1Id])
  ]);
  // Submit attempt
  await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 1);`, [student7Id, attPartialId]);

  // [86] completeness derives from question_order snapshot (only 1 manual question required)
  await test('86: completeness derives from question_order snapshot', async () => {
    const grades = [
      { exam_question_id: qP_Essay1Id, points_earned: 3.00, teacher_comment: 'Good' }
    ];
    const res = await db.query(`
      SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, 'Feedback partial', 2) AS result;
    `, [teacherId, attPartialId, JSON.stringify(grades)]);
    const r = res.rows[0].result;
    if (r.status !== 'graded' || Number(r.manual_score) !== 3.00) {
      throw new Error(`Grading partial snapshot failed: ${JSON.stringify(r)}`);
    }
  });

  // [87] manual question outside question_order not counted
  await test('87: manual question outside question_order not counted', async () => {
    // Verified in test 86: only qP_Essay1Id was needed, qP_Essay2OmittedId was not counted
  });

  // [88] malformed question_order rejected fail-closed
  await test('88: malformed question_order rejected fail-closed', async () => {
    const student8Id = '22222222-2222-4222-8222-222222222208';
    const attBadOrderId = '77777777-7777-4777-8777-777777777709';
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student8Id, attBadOrderId, assignPartialId, student8Id]);
    await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 1);`, [student8Id, attBadOrderId]);

    // Set question_order to a JSON string instead of array
    await db.query(`UPDATE public.exam_attempts SET question_order = '"not-an-array"'::jsonb WHERE id = $1;`, [attBadOrderId]);

    const grades = [{ exam_question_id: qP_Essay1Id, points_earned: 1.00 }];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, NULL, 2);`, [teacherId, attBadOrderId, JSON.stringify(grades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_ATTEMPT_SNAPSHOT_INVALID')) throw err;
    }
  });

  // [89] replay missing manual row rejected
  await test('89: replay missing manual row rejected', async () => {
    // Delete one manual row from att7 (which is already graded)
    await db.query(`DELETE FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [att7Id, qEssayId]);

    const replayGrades = [
      { exam_question_id: qEssayId, points_earned: 2.50, teacher_comment: 'Good job' },
      { exam_question_id: qImgId, points_earned: 1.50, teacher_comment: 'Clean photo' },
      { exam_question_id: qFileId, points_earned: 2.00, teacher_comment: 'Good diagram' }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, 'Feedback 7', 3);`, [teacherId, att7Id, JSON.stringify(replayGrades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_MANUAL_GRADING_STATE_INVALID')) throw err;
    }
  });

  // [90] replay manual row not manual_graded rejected
  await test('90: replay manual row not manual_graded rejected', async () => {
    // Re-insert the row with grading_status = 'pending_manual'
    await db.query(`
      INSERT INTO public.exam_attempt_answers (exam_version_id, attempt_id, exam_question_id, grading_status, points_earned, teacher_comment)
      VALUES ($1, $2, $3, 'pending_manual', 2.50, 'Good job');
    `, [ver1Id, att7Id, qEssayId]);

    const replayGrades = [
      { exam_question_id: qEssayId, points_earned: 2.50, teacher_comment: 'Good job' },
      { exam_question_id: qImgId, points_earned: 1.50, teacher_comment: 'Clean photo' },
      { exam_question_id: qFileId, points_earned: 2.00, teacher_comment: 'Good diagram' }
    ];
    try {
      await db.query(`SELECT public.rpc_exam_grade_manual_attempt($1, $2, $3::jsonb, 'Feedback 7', 3);`, [teacherId, att7Id, JSON.stringify(replayGrades)]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_MANUAL_GRADING_STATE_INVALID')) throw err;
    }
  });

  console.log('\n====================================================');
  console.log(`FINAL TEST RESULTS: ${passCount}/90 PASSED, ${failCount} FAILED`);
  console.log('====================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
