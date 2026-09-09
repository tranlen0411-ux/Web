import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

async function main() {
  console.log('====================================================');
  console.log('EXAM BUILDER V1 - PHASE 2B2 PGLITE LOCAL TEST SUITE');
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

  // Apply baseline migrations 1..5 in order
  const migrationFiles = [
    '20260905000001_exam_builder_v1_phase1_schema.sql',
    '20260905000002_exam_builder_v1_phase1_1_grading_status.sql',
    '20260905000003_exam_builder_v1_phase2a_authoring_rpcs.sql',
    '20260905000004_exam_builder_v1_phase2b1_assignment_attempt_rpcs.sql',
    '20260905000005_exam_builder_v1_phase2b2_answer_submit_rpcs.sql'
  ];

  for (let i = 0; i < migrationFiles.length; i++) {
    const f = migrationFiles[i];
    const sql = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', f), 'utf8');
    const t0 = Date.now();
    await db.exec(sql);
    console.log(`✅ Applied migration ${i + 1}/5: ${f} (${Date.now() - t0}ms)`);
  }

  // Define test fixtures
  const teacherId = '11111111-1111-4111-8111-111111111111';
  const student1Id = '22222222-2222-4222-8222-222222222221';
  const student2Id = '22222222-2222-4222-8222-222222222222';
  const student3Id = '22222222-2222-4222-8222-222222222223';
  const student4Id = '22222222-2222-4222-8222-222222222224';
  const student5Id = '22222222-2222-4222-8222-222222222225';
  const student6Id = '22222222-2222-4222-8222-222222222226';
  const student7Id = '22222222-2222-4222-8222-222222222227';
  const student8Id = '22222222-2222-4222-8222-222222222228';
  const student9Id = '22222222-2222-4222-8222-222222222229';
  const class1Id = '33333333-3333-4333-8333-333333333331';

  const examId = '44444444-4444-4444-8444-444444444441';
  const exam2Id = '44444444-4444-4444-8444-444444444442'; // Mixed auto+manual exam
  const ver1Id = '55555555-5555-4555-8555-555555555551'; // All auto
  const ver2Id = '55555555-5555-4555-8555-555555555552'; // Mixed auto+manual

  const assign1Id = '66666666-6666-4666-8666-666666666661';
  const assign2Id = '66666666-6666-4666-8666-666666666662';

  const attempt1Id = '77777777-7777-4777-8777-777777777771';
  const attempt2Id = '77777777-7777-4777-8777-777777777772';
  const attemptMixedId = '77777777-7777-4777-8777-777777777773';

  // Questions for Version 1 (All AUTO: Single Choice, Multiple Choice, Fill Blank, Short Answer)
  const qSingleId = '88888888-8888-4888-8888-888888888881'; // 2.5 pts
  const qMultiId = '88888888-8888-4888-8888-888888888882';  // 2.5 pts
  const qBlankId = '88888888-8888-4888-8888-888888888883';  // 2.5 pts
  const qShortId = '88888888-8888-4888-8888-888888888884';  // 2.5 pts

  // Questions for Version 2 (Mixed: Single Choice + Essay + File Upload)
  const qSingle2Id = '99999999-9999-4999-8999-999999999991'; // 4.0 pts (Auto)
  const qEssayId = '99999999-9999-4999-8999-999999999992';   // 4.0 pts (Manual)
  const qFileId = '99999999-9999-4999-8999-999999999993';    // 2.0 pts (Manual)

  // 1. Create Exam 1 (All-Auto)
  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Toán Trắc Nghiệm', 'MATH', 10);`, [teacherId, examId, ver1Id]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Toán Trắc Nghiệm', 'MATH', 10, 'Mô tả',
      45, NOW() - interval '1 hour', NOW() + interval '14 days', 3, 5, true, true, 'WARN_AND_LOG', true, false,
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
        prompt: '2 + 2 = ?',
        points: 2.50,
        options_json: [
          { key: 'A', text: '4' },
          { key: 'B', text: '3' },
          { key: 'C', text: '5' },
          { key: 'D', text: '6' }
        ],
        answer_key: { correct_answer: 'A' }
      },
      {
        id: qMultiId,
        question_number: 2,
        question_type: 'multiple_choice',
        prompt: 'Số chẵn là:',
        points: 2.50,
        options_json: [
          { key: 'A', text: '2' },
          { key: 'B', text: '3' },
          { key: 'C', text: '4' },
          { key: 'D', text: '5' }
        ],
        answer_key: { correct_answer: ['A', 'C'] }
      },
      {
        id: qBlankId,
        question_number: 3,
        question_type: 'fill_blank',
        prompt: 'Thủ đô của Pháp là [blank]',
        points: 2.50,
        options_json: [],
        answer_key: {
          correct_answer: 'Paris',
          accepted_answers: ['Ba Lê', 'PARIS'],
          case_sensitive: false
        }
      },
      {
        id: qShortId,
        question_number: 4,
        question_type: 'short_answer',
        prompt: 'Tên viết tắt của Việt Nam là gì?',
        points: 2.50,
        options_json: [],
        answer_key: {
          correct_answer: 'VN',
          accepted_answers: ['VNM', 'VietNam'],
          case_sensitive: true
        }
      }
    ])
  ]);
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2, true);`, [teacherId, ver1Id]);

  // Create Assignment 1 & Start Attempt 1
  await db.query(`
    SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NOW() + interval '5 days', true, true);
  `, [teacherId, assign1Id, ver1Id, class1Id]);

  await db.query(`
    SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);
  `, [student1Id, attempt1Id, assign1Id, student1Id]);

  // Create Attempt 2 (for student 2)
  await db.query(`
    SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);
  `, [student2Id, attempt2Id, assign1Id, student2Id]);

  // 2. Create Exam 2 (Mixed Auto + Manual)
  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Văn Tự Luận', 'LIT', 10);`, [teacherId, exam2Id, ver2Id]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Văn Tự Luận', 'LIT', 10, 'Mô tả',
      60, NOW() - interval '1 hour', NOW() + interval '14 days', 5, 10, false, false, 'WARN_AND_LOG', true, false,
      $3::jsonb, true
    );
  `, [
    teacherId,
    ver2Id,
    JSON.stringify([
      {
        id: qSingle2Id,
        question_number: 1,
        question_type: 'single_choice',
        prompt: 'Tác giả Truyện Kiều là ai?',
        points: 4.00,
        options_json: [{ key: 'A', text: 'Nguyễn Du' }, { key: 'B', text: 'Nguyễn Trãi' }],
        answer_key: { correct_answer: 'A' }
      },
      {
        id: qEssayId,
        question_number: 2,
        question_type: 'essay',
        prompt: 'Phân tích đoạn trích...',
        points: 4.00,
        options_json: []
      },
      {
        id: qFileId,
        question_number: 3,
        question_type: 'file_upload',
        prompt: 'Nộp sơ đồ tư duy (file PDF)',
        points: 2.00,
        options_json: []
      }
    ])
  ]);
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2, true);`, [teacherId, ver2Id]);

  await db.query(`
    SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NOW() + interval '5 days', true, true);
  `, [teacherId, assign2Id, ver2Id, class1Id]);

  await db.query(`
    SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);
  `, [student1Id, attemptMixedId, assign2Id, student1Id]);

  let passCount = 0;
  let failCount = 0;

  async function test(num, name, fn) {
    try {
      await fn();
      console.log(`✅ [${num}/70] PASS: ${name}`);
      passCount++;
    } catch (err) {
      console.error(`❌ [${num}/70] FAIL: ${name} -> ${err.message}`);
      failCount++;
    }
  }

  console.log('\n--- EXECUTING 70 TEST CASES ---\n');

  // [1] Save single choice valid
  await test(1, 'save single choice valid', async () => {
    const res = await db.query(`
      SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, NULL, 1) AS result;
    `, [student1Id, attempt1Id, qSingleId]);
    const r = res.rows[0].result;
    if (r.grading_status !== 'pending_auto' || r.attempt_version !== 2) throw new Error(JSON.stringify(r));
  });

  // [2] Save single choice invalid option rejected
  await test(2, 'save single choice invalid option rejected', async () => {
    try {
      await db.query(`
        SELECT public.rpc_exam_save_answer($1, $2, $3, '"Z"'::jsonb, NULL, 2) AS result;
      `, [student1Id, attempt1Id, qSingleId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_OPTION_KEY')) throw err;
    }
  });

  // [3] Save multiple choice valid
  await test(3, 'save multiple choice valid', async () => {
    const res = await db.query(`
      SELECT public.rpc_exam_save_answer($1, $2, $3, '["A", "C"]'::jsonb, NULL, 2) AS result;
    `, [student1Id, attempt1Id, qMultiId]);
    const r = res.rows[0].result;
    if (r.grading_status !== 'pending_auto' || r.attempt_version !== 3) throw new Error(JSON.stringify(r));
  });

  // [4] Reject duplicate multi keys
  await test(4, 'reject duplicate multi keys', async () => {
    try {
      await db.query(`
        SELECT public.rpc_exam_save_answer($1, $2, $3, '["A", "A"]'::jsonb, NULL, 3) AS result;
      `, [student1Id, attempt1Id, qMultiId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_DUPLICATE_OPTION_KEYS')) throw err;
    }
  });

  // [5] Reject unknown multi key
  await test(5, 'reject unknown multi key', async () => {
    try {
      await db.query(`
        SELECT public.rpc_exam_save_answer($1, $2, $3, '["A", "X"]'::jsonb, NULL, 3) AS result;
      `, [student1Id, attempt1Id, qMultiId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_OPTION_KEY')) throw err;
    }
  });

  // [6] Save fill blank
  await test(6, 'save fill blank', async () => {
    const res = await db.query(`
      SELECT public.rpc_exam_save_answer($1, $2, $3, '"Paris"'::jsonb, NULL, 3) AS result;
    `, [student1Id, attempt1Id, qBlankId]);
    const r = res.rows[0].result;
    if (r.grading_status !== 'pending_auto' || r.attempt_version !== 4) throw new Error(JSON.stringify(r));
  });

  // [7] Save short answer
  await test(7, 'save short answer', async () => {
    const res = await db.query(`
      SELECT public.rpc_exam_save_answer($1, $2, $3, '"VN"'::jsonb, NULL, 4) AS result;
    `, [student1Id, attempt1Id, qShortId]);
    const r = res.rows[0].result;
    if (r.grading_status !== 'pending_auto' || r.attempt_version !== 5) throw new Error(JSON.stringify(r));
  });

  // [8] Save essay pending_manual
  await test(8, 'save essay pending_manual', async () => {
    const res = await db.query(`
      SELECT public.rpc_exam_save_answer($1, $2, $3, '"Bài làm chi tiết..."'::jsonb, NULL, 1) AS result;
    `, [student1Id, attemptMixedId, qEssayId]);
    const r = res.rows[0].result;
    if (r.grading_status !== 'pending_manual' || r.attempt_version !== 2) throw new Error(JSON.stringify(r));
  });

  // [9] File type payload validation
  await test(9, 'file type payload validation', async () => {
    const res = await db.query(`
      SELECT public.rpc_exam_save_answer($1, $2, $3, NULL, 'https://storage/mindmap.pdf', 2) AS result;
    `, [student1Id, attemptMixedId, qFileId]);
    const r = res.rows[0].result;
    if (r.grading_status !== 'pending_manual' || r.attempt_version !== 3) throw new Error(JSON.stringify(r));
  });

  // [10] Reject wrong student
  await test(10, 'reject wrong student', async () => {
    try {
      await db.query(`
        SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, NULL, 5) AS result;
      `, [student2Id, attempt1Id, qSingleId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_STUDENT_IDENTITY_MISMATCH')) throw err;
    }
  });

  // [11] Reject wrong-version question
  await test(11, 'reject wrong-version question', async () => {
    try {
      await db.query(`
        SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, NULL, 5) AS result;
      `, [student1Id, attempt1Id, qEssayId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_QUESTION_VERSION_MISMATCH')) throw err;
    }
  });

  // [12] Reject finalized attempt save
  await test(12, 'reject finalized attempt save', async () => {
    await db.query(`UPDATE public.exam_attempts SET status = 'submitted' WHERE id = $1;`, [attempt2Id]);
    try {
      await db.query(`
        SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, NULL, 1) AS result;
      `, [student2Id, attempt2Id, qSingleId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_ATTEMPT_FINALIZED')) throw err;
    } finally {
      await db.query(`UPDATE public.exam_attempts SET status = 'draft' WHERE id = $1;`, [attempt2Id]);
    }
  });

  // [13] Reject expired attempt save
  await test(13, 'reject expired attempt save', async () => {
    await db.query(`UPDATE public.exam_attempts SET expires_at = NOW() - interval '10 minutes' WHERE id = $1;`, [attempt2Id]);
    try {
      await db.query(`
        SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, NULL, 1) AS result;
      `, [student2Id, attempt2Id, qSingleId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_ATTEMPT_EXPIRED')) throw err;
    } finally {
      await db.query(`UPDATE public.exam_attempts SET expires_at = NOW() + interval '45 minutes' WHERE id = $1;`, [attempt2Id]);
    }
  });

  // [14] Optimistic version success
  await test(14, 'optimistic version success', async () => {
    const res = await db.query(`
      SELECT public.rpc_exam_save_answer($1, $2, $3, '"B"'::jsonb, NULL, 5) AS result;
    `, [student1Id, attempt1Id, qSingleId]);
    const r = res.rows[0].result;
    if (r.attempt_version !== 6) throw new Error(JSON.stringify(r));
  });

  // [15] Optimistic version stale rejection
  await test(15, 'optimistic version stale rejection', async () => {
    try {
      await db.query(`
        SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, NULL, 4) AS result;
      `, [student1Id, attempt1Id, qSingleId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_OPTIMISTIC_LOCK_CONFLICT')) throw err;
    }
  });

  // [16] Upsert same answer
  await test(16, 'upsert same answer', async () => {
    const res = await db.query(`
      SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, NULL, 6) AS result;
    `, [student1Id, attempt1Id, qSingleId]);
    const r = res.rows[0].result;
    if (r.attempt_version !== 7) throw new Error(JSON.stringify(r));
    const cnt = await db.query(`SELECT count(*)::int as c FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [attempt1Id, qSingleId]);
    if (cnt.rows[0].c !== 1) throw new Error(`Expected 1 row, got ${cnt.rows[0].c}`);
  });

  // [17] Submit all-auto
  await test(17, 'submit all-auto', async () => {
    const res = await db.query(`
      SELECT public.rpc_exam_submit_attempt($1, $2, 7) AS result;
    `, [student1Id, attempt1Id]);
    const r = res.rows[0].result;
    if (r.status !== 'graded' || r.objective_score !== 10 || r.total_score !== 10 || r.idempotent_replay !== false) {
      throw new Error(JSON.stringify(r));
    }
  });

  // [18] Single choice correct in DB
  await test(18, 'single choice correct in DB', async () => {
    const ans = await db.query(`SELECT is_correct, points_earned, grading_status FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [attempt1Id, qSingleId]);
    const r = ans.rows[0];
    if (r.is_correct !== true || r.points_earned !== '2.50' || r.grading_status !== 'auto_graded') throw new Error(JSON.stringify(r));
  });

  // [19] Single choice wrong
  await test(19, 'single choice wrong', async () => {
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"B"'::jsonb, NULL, 1);`, [student2Id, attempt2Id, qSingleId]);
    const res = await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 2) AS result;`, [student2Id, attempt2Id]);
    const ans = await db.query(`SELECT is_correct, points_earned FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [attempt2Id, qSingleId]);
    if (ans.rows[0].is_correct !== false || ans.rows[0].points_earned !== '0.00') throw new Error(JSON.stringify(ans.rows[0]));
  });

  // [20] Multiple order-insensitive correct
  await test(20, 'multiple order-insensitive correct', async () => {
    const ans = await db.query(`SELECT is_correct, points_earned FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [attempt1Id, qMultiId]);
    if (ans.rows[0].is_correct !== true || ans.rows[0].points_earned !== '2.50') throw new Error(JSON.stringify(ans.rows[0]));
  });

  // [21] Multiple wrong
  await test(21, 'multiple wrong', async () => {
    const ans = await db.query(`SELECT is_correct, points_earned FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [attempt2Id, qMultiId]);
    if (ans.rows[0].is_correct !== false || ans.rows[0].points_earned !== '0.00') throw new Error(JSON.stringify(ans.rows[0]));
  });

  // [22] Fill blank correct normalization
  await test(22, 'fill blank correct normalization', async () => {
    const ans = await db.query(`SELECT is_correct, points_earned FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [attempt1Id, qBlankId]);
    if (ans.rows[0].is_correct !== true || ans.rows[0].points_earned !== '2.50') throw new Error(JSON.stringify(ans.rows[0]));
  });

  // [23] Fill blank wrong
  await test(23, 'fill blank wrong', async () => {
    const ans = await db.query(`SELECT is_correct, points_earned FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [attempt2Id, qBlankId]);
    if (ans.rows[0].is_correct !== false || ans.rows[0].points_earned !== '0.00') throw new Error(JSON.stringify(ans.rows[0]));
  });

  // [24] Short answer accepted answer
  await test(24, 'short answer accepted answer', async () => {
    const ans = await db.query(`SELECT is_correct, points_earned FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [attempt1Id, qShortId]);
    if (ans.rows[0].is_correct !== true || ans.rows[0].points_earned !== '2.50') throw new Error(JSON.stringify(ans.rows[0]));
  });

  // [25] Case-sensitive behavior
  await test(25, 'case-sensitive behavior', async () => {
    const ans = await db.query(`SELECT is_correct FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [attempt1Id, qShortId]);
    if (ans.rows[0].is_correct !== true) throw new Error('Expected true');
  });

  // [26] Submit mixed auto/manual
  await test(26, 'submit mixed auto/manual', async () => {
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, NULL, 3);`, [student1Id, attemptMixedId, qSingle2Id]);
    const res = await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 4) AS result;`, [student1Id, attemptMixedId]);
    const r = res.rows[0].result;
    if (r.status !== 'pending_manual_grade') throw new Error(JSON.stringify(r));
  });

  // [27] Objective score correct on mixed attempt
  await test(27, 'objective_score correct on mixed attempt', async () => {
    const att = await db.query(`SELECT objective_score, manual_score, total_score, status FROM public.exam_attempts WHERE id = $1;`, [attemptMixedId]);
    const r = att.rows[0];
    if (r.objective_score !== '4.00') throw new Error(`Expected objective_score 4.00, got ${r.objective_score}`);
  });

  // [28] Mixed total_score NULL
  await test(28, 'mixed total_score NULL', async () => {
    const att = await db.query(`SELECT total_score, manual_score FROM public.exam_attempts WHERE id = $1;`, [attemptMixedId]);
    if (att.rows[0].total_score !== null || att.rows[0].manual_score !== null) throw new Error(JSON.stringify(att.rows[0]));
  });

  // [29] Pending manual grade status
  await test(29, 'pending_manual_grade status', async () => {
    const att = await db.query(`SELECT status FROM public.exam_attempts WHERE id = $1;`, [attemptMixedId]);
    if (att.rows[0].status !== 'pending_manual_grade') throw new Error(JSON.stringify(att.rows[0]));
  });

  // [30] All-auto graded status
  await test(30, 'all-auto graded status', async () => {
    const att = await db.query(`SELECT status, total_score, manual_score FROM public.exam_attempts WHERE id = $1;`, [attempt1Id]);
    if (att.rows[0].status !== 'graded' || att.rows[0].total_score !== '10.00' || att.rows[0].manual_score !== '0.00') throw new Error(JSON.stringify(att.rows[0]));
  });

  // [31] Submitted at set server-side
  await test(31, 'submitted_at set server-side', async () => {
    const att = await db.query(`SELECT submitted_at FROM public.exam_attempts WHERE id = $1;`, [attempt1Id]);
    if (!att.rows[0].submitted_at) throw new Error('submitted_at was not set');
  });

  // [32] Question order unchanged
  await test(32, 'question order unchanged', async () => {
    const att = await db.query(`SELECT question_order FROM public.exam_attempts WHERE id = $1;`, [attempt1Id]);
    if (!Array.isArray(att.rows[0].question_order) || att.rows[0].question_order.length !== 4) throw new Error(JSON.stringify(att.rows[0]));
  });

  // [33] Option orders unchanged
  await test(33, 'option orders unchanged', async () => {
    const att = await db.query(`SELECT option_orders FROM public.exam_attempts WHERE id = $1;`, [attempt1Id]);
    if (typeof att.rows[0].option_orders !== 'object') throw new Error(JSON.stringify(att.rows[0]));
  });

  // [34] Exact finalized replay
  await test(34, 'exact finalized replay', async () => {
    const res = await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 8) AS result;`, [student1Id, attempt1Id]);
    const r = res.rows[0].result;
    if (r.idempotent_replay !== true || r.status !== 'graded' || r.total_score !== 10) throw new Error(JSON.stringify(r));
  });

  // [35] No double grading on replay
  await test(35, 'no double grading on replay', async () => {
    const res = await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 1) AS result;`, [student1Id, attempt1Id]);
    const r = res.rows[0].result;
    if (r.idempotent_replay !== true || r.total_score !== 10) throw new Error(JSON.stringify(r));
  });

  // [36] No answer key leaked in submit payload
  await test(36, 'no answer key leaked in submit payload', async () => {
    const res = await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 8) AS result;`, [student1Id, attempt1Id]);
    const r = res.rows[0].result;
    if (r.correct_answer || r.answer_key || r.accepted_answers) throw new Error('Leaked answer key!');
  });

  // [37] Unanswered question submit policy
  await test(37, 'unanswered question submit policy', async () => {
    const cnt = await db.query(`SELECT count(*)::int as c FROM public.exam_attempt_answers WHERE attempt_id = $1;`, [attempt2Id]);
    if (cnt.rows[0].c !== 4) throw new Error(`Expected 4 answer rows for 4 questions, found ${cnt.rows[0].c}`);
  });

  // [38] Malformed answer JSON rejected
  await test(38, 'malformed answer JSON rejected', async () => {
    const testAttemptId = '77777777-7777-4777-8777-777777777799';
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student3Id, testAttemptId, assign1Id, student3Id]);
    try {
      await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '123'::jsonb, NULL, 1);`, [student3Id, testAttemptId, qMultiId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_ANSWER_PAYLOAD')) throw err;
    }
  });

  // [39] Expired submit policy
  await test(39, 'expired submit policy', async () => {
    const expiredAttemptId = '77777777-7777-4777-8777-777777777788';
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student4Id, expiredAttemptId, assign1Id, student4Id]);
    await db.query(`UPDATE public.exam_attempts SET expires_at = NOW() - interval '1 hour' WHERE id = $1;`, [expiredAttemptId]);
    try {
      await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 1);`, [student4Id, expiredAttemptId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_ATTEMPT_EXPIRED')) throw err;
    }
  });

  // [40] Cross-attempt answer isolation
  await test(40, 'cross-attempt answer isolation', async () => {
    const ans1 = await db.query(`SELECT points_earned FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [attempt1Id, qSingleId]);
    const ans2 = await db.query(`SELECT points_earned FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [attempt2Id, qSingleId]);
    if (ans1.rows[0].points_earned !== '2.50' || ans2.rows[0].points_earned !== '0.00') {
      throw new Error(`Isolation failed: att1=${ans1.rows[0].points_earned}, att2=${ans2.rows[0].points_earned}`);
    }
  });

  // [41] Wrong caller finalized replay rejected
  await test(41, 'wrong caller finalized replay rejected', async () => {
    try {
      await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 1);`, [student2Id, attempt1Id]); // attempt1 belongs to student1
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_STUDENT_IDENTITY_MISMATCH')) throw err;
    }
  });

  // [42] Finalized replay after expiry succeeds for correct caller
  await test(42, 'finalized replay after expiry succeeds for correct caller', async () => {
    await db.query(`UPDATE public.exam_attempts SET expires_at = NOW() - interval '2 days' WHERE id = $1;`, [attempt1Id]);
    const res = await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 99) AS result;`, [student1Id, attempt1Id]);
    const r = res.rows[0].result;
    if (r.idempotent_replay !== true || r.status !== 'graded') throw new Error(JSON.stringify(r));
  });

  // [43] Finalized replay with stale expected version succeeds
  await test(43, 'finalized replay with stale expected version succeeds', async () => {
    const res = await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 1) AS result;`, [student1Id, attempt1Id]);
    const r = res.rows[0].result;
    if (r.idempotent_replay !== true) throw new Error(JSON.stringify(r));
  });

  // [44] Finalized replay does not increment version
  await test(44, 'finalized replay does not increment version', async () => {
    const before = await db.query(`SELECT version FROM public.exam_attempts WHERE id = $1;`, [attempt1Id]);
    await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 1);`, [student1Id, attempt1Id]);
    const after = await db.query(`SELECT version FROM public.exam_attempts WHERE id = $1;`, [attempt1Id]);
    if (before.rows[0].version !== after.rows[0].version) throw new Error(`Version changed from ${before.rows[0].version} to ${after.rows[0].version}`);
  });

  // [45] Finalized replay does not rewrite submitted_at
  await test(45, 'finalized replay does not rewrite submitted_at', async () => {
    const before = await db.query(`SELECT submitted_at FROM public.exam_attempts WHERE id = $1;`, [attempt1Id]);
    await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 1);`, [student1Id, attempt1Id]);
    const after = await db.query(`SELECT submitted_at FROM public.exam_attempts WHERE id = $1;`, [attempt1Id]);
    if (before.rows[0].submitted_at.getTime() !== after.rows[0].submitted_at.getTime()) throw new Error('submitted_at was rewritten');
  });

  // Setup test environment for answer key validation & rollback tests
  const rollbackExamId = '44444444-4444-4444-8444-444444444455';
  const rollbackVerId = '55555555-5555-4555-8555-555555555555';
  const rollbackAssignId = '66666666-6666-4666-8666-666666666655';
  const rollbackAttemptId = '77777777-7777-4777-8777-777777777755';
  const qMissingKeyId = '88888888-8888-4888-8888-888888888855';

  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Test Rollback', 'MATH', 10);`, [teacherId, rollbackExamId, rollbackVerId]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Test Rollback', 'MATH', 10, 'Mô tả',
      45, NOW() - interval '1 hour', NOW() + interval '14 days', 3, 5, true, true, 'WARN_AND_LOG', true, false,
      $3::jsonb, true
    );
  `, [
    teacherId,
    rollbackVerId,
    JSON.stringify([
      {
        id: qMissingKeyId,
        question_number: 1,
        question_type: 'single_choice',
        prompt: '1 + 1 = ?',
        points: 10.00,
        options_json: [{ key: 'A', text: '2' }, { key: 'B', text: '3' }],
        answer_key: { correct_answer: 'A' }
      }
    ])
  ]);
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2, true);`, [teacherId, rollbackVerId]);
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NOW() + interval '5 days', true, true);`, [teacherId, rollbackAssignId, rollbackVerId, class1Id]);
  await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student5Id, rollbackAttemptId, rollbackAssignId, student5Id]);
  await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, NULL, 1);`, [student5Id, rollbackAttemptId, qMissingKeyId]);

  // Delete answer key to test missing key rejection
  await db.query(`DELETE FROM app_private.exam_answer_keys WHERE question_id = $1;`, [qMissingKeyId]);

  // [46] Missing AUTO answer key rejected
  await test(46, 'missing AUTO answer key rejected', async () => {
    try {
      await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 2);`, [student5Id, rollbackAttemptId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_ANSWER_KEY_MISSING')) throw err;
    }
  });

  // [47] Malformed AUTO answer key rejected
  await test(47, 'malformed AUTO answer key rejected', async () => {
    // Insert malformed answer key (number instead of string for single_choice)
    await db.query(`INSERT INTO app_private.exam_answer_keys (question_id, correct_answer) VALUES ($1, '123'::jsonb);`, [qMissingKeyId]);
    try {
      await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 2);`, [student5Id, rollbackAttemptId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_ANSWER_KEY')) throw err;
    }
  });

  // [48] Missing key rollback leaves attempt draft
  await test(48, 'missing key rollback leaves attempt draft', async () => {
    const att = await db.query(`SELECT status FROM public.exam_attempts WHERE id = $1;`, [rollbackAttemptId]);
    if (att.rows[0].status !== 'draft') throw new Error(`Expected draft status, found ${att.rows[0].status}`);
  });

  // [49] Missing key rollback leaves prior answer grading state unchanged
  await test(49, 'missing key rollback leaves prior answer grading state unchanged', async () => {
    const ans = await db.query(`SELECT grading_status, points_earned FROM public.exam_attempt_answers WHERE attempt_id = $1;`, [rollbackAttemptId]);
    if (ans.rows[0].grading_status !== 'pending_auto' || ans.rows[0].points_earned !== null) {
      throw new Error(JSON.stringify(ans.rows[0]));
    }
  });

  // [50] Reward stars all-auto remains 0
  await test(50, 'reward stars all-auto remains 0', async () => {
    const att = await db.query(`SELECT reward_stars_awarded FROM public.exam_attempts WHERE id = $1;`, [attempt1Id]);
    if (att.rows[0].reward_stars_awarded !== 0) throw new Error(`Expected 0, got ${att.rows[0].reward_stars_awarded}`);
  });

  // [51] Reward stars mixed remains 0
  await test(51, 'reward stars mixed remains 0', async () => {
    const att = await db.query(`SELECT reward_stars_awarded FROM public.exam_attempts WHERE id = $1;`, [attemptMixedId]);
    if (att.rows[0].reward_stars_awarded !== 0) throw new Error(`Expected 0, got ${att.rows[0].reward_stars_awarded}`);
  });

  // Fresh attempt for payload testing
  const payloadAttemptId = '77777777-7777-4777-8777-777777777766';
  await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student6Id, payloadAttemptId, assign1Id, student6Id]);

  // [52] fill_blank rejects non-string JSON
  await test(52, 'fill_blank rejects non-string JSON', async () => {
    try {
      await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '{"text": "Paris"}'::jsonb, NULL, 1);`, [student6Id, payloadAttemptId, qBlankId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_ANSWER_PAYLOAD')) throw err;
    }
  });

  // [53] short_answer rejects non-string JSON
  await test(53, 'short_answer rejects non-string JSON', async () => {
    try {
      await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '["VN"]'::jsonb, NULL, 1);`, [student6Id, payloadAttemptId, qShortId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_ANSWER_PAYLOAD')) throw err;
    }
  });

  // Fresh mixed attempt for payload testing
  const payloadMixedAttemptId = '77777777-7777-4777-8777-777777777767';
  await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student6Id, payloadMixedAttemptId, assign2Id, student6Id]);

  // [54] essay rejects non-string JSON
  await test(54, 'essay rejects non-string JSON', async () => {
    try {
      await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '{"essay": "content"}'::jsonb, NULL, 1);`, [student6Id, payloadMixedAttemptId, qEssayId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_ANSWER_PAYLOAD')) throw err;
    }
  });

  // [55] upload rejects student_answer_json payload
  await test(55, 'upload rejects student_answer_json payload', async () => {
    try {
      await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"essay text"'::jsonb, 'https://storage/file.pdf', 1);`, [student6Id, payloadMixedAttemptId, qFileId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_ANSWER_PAYLOAD_NOT_ALLOWED')) throw err;
    }
  });

  // [56] non-upload rejects file_url
  await test(56, 'non-upload rejects file_url', async () => {
    try {
      await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, 'https://storage/file.pdf', 1);`, [student6Id, payloadAttemptId, qSingleId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_FILE_URL_NOT_ALLOWED')) throw err;
    }
  });

  // Setup attempt for normalization testing
  const normAttemptId = '77777777-7777-4777-8777-777777777777';
  await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student7Id, normAttemptId, assign1Id, student7Id]);

  // [57] trim normalization fill_blank
  await test(57, 'trim normalization fill_blank', async () => {
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"  Paris   "'::jsonb, NULL, 1);`, [student7Id, normAttemptId, qBlankId]);
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"VietNam"'::jsonb, NULL, 2);`, [student7Id, normAttemptId, qShortId]);
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, NULL, 3);`, [student7Id, normAttemptId, qSingleId]);
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '["A", "C"]'::jsonb, NULL, 4);`, [student7Id, normAttemptId, qMultiId]);
    await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 5);`, [student7Id, normAttemptId]);

    const ans = await db.query(`SELECT is_correct, points_earned FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [normAttemptId, qBlankId]);
    if (ans.rows[0].is_correct !== true || ans.rows[0].points_earned !== '2.50') throw new Error(JSON.stringify(ans.rows[0]));
  });

  // [58] case-insensitive fill_blank
  await test(58, 'case-insensitive fill_blank', async () => {
    // qBlank has case_sensitive: false. 'paris' in lowercase should match 'Paris'
    const caseAttemptId = '77777777-7777-4777-8777-777777777778';
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student8Id, caseAttemptId, assign1Id, student8Id]);
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"paris"'::jsonb, NULL, 1);`, [student8Id, caseAttemptId, qBlankId]);
    await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 2);`, [student8Id, caseAttemptId]);

    const ans = await db.query(`SELECT is_correct FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [caseAttemptId, qBlankId]);
    if (ans.rows[0].is_correct !== true) throw new Error('Expected true for case-insensitive match');
  });

  // [59] case-sensitive fill_blank / short_answer
  await test(59, 'case-sensitive short_answer', async () => {
    // qShort has case_sensitive: true for 'VN'. 'vn' should fail.
    const caseAttemptId = '77777777-7777-4777-8777-777777777779';
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student9Id, caseAttemptId, assign1Id, student9Id]);
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"vn"'::jsonb, NULL, 1);`, [student9Id, caseAttemptId, qShortId]);
    await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 2);`, [student9Id, caseAttemptId]);

    const ans = await db.query(`SELECT is_correct FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [caseAttemptId, qShortId]);
    if (ans.rows[0].is_correct !== false) throw new Error('Expected false for case-sensitive mismatch');
  });

  // [60] accepted_answers short_answer
  await test(60, 'accepted_answers short_answer', async () => {
    // In normAttemptId, student submitted 'VietNam' which is in accepted_answers ['VNM', 'VietNam']
    const ans = await db.query(`SELECT is_correct, points_earned FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [normAttemptId, qShortId]);
    if (ans.rows[0].is_correct !== true || ans.rows[0].points_earned !== '2.50') throw new Error(JSON.stringify(ans.rows[0]));
  });

  // [61] successful NEW submit increments attempt.version once
  await test(61, 'successful NEW submit increments attempt.version once', async () => {
    const vAttemptId = '77777777-7777-4777-8777-777777777780';
    const student10Id = '22222222-2222-4222-8222-222222222210';
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student10Id, vAttemptId, assign1Id, student10Id]);
    // Version starts at 1
    const before = await db.query(`SELECT version FROM public.exam_attempts WHERE id = $1;`, [vAttemptId]);
    if (before.rows[0].version !== 1) throw new Error(`Expected initial version 1, got ${before.rows[0].version}`);

    await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 1);`, [student10Id, vAttemptId]);
    const after = await db.query(`SELECT version FROM public.exam_attempts WHERE id = $1;`, [vAttemptId]);
    if (after.rows[0].version !== 2) throw new Error(`Expected submitted version 2, got ${after.rows[0].version}`);
  });

  // [62] save-vs-submit serialization contract/static proof
  await test(62, 'save-vs-submit serialization contract/static proof', async () => {
    const saveDef = await db.query(`
      SELECT pg_get_functiondef(oid) AS def
      FROM pg_proc
      WHERE proname = 'rpc_exam_save_answer';
    `);
    const submitDef = await db.query(`
      SELECT pg_get_functiondef(oid) AS def
      FROM pg_proc
      WHERE proname = 'rpc_exam_submit_attempt';
    `);

    const saveHasLock = saveDef.rows[0].def.includes('FOR UPDATE');
    const submitHasLock = submitDef.rows[0].def.includes('FOR UPDATE');

    if (!saveHasLock || !submitHasLock) {
      throw new Error(`Serialization lock missing: saveLock=${saveHasLock}, submitLock=${submitHasLock}`);
    }
  });

  // Additional student fixtures for tests 63..70
  const student11Id = '22222222-2222-4222-8222-222222222231';
  const student12Id = '22222222-2222-4222-8222-222222222232';
  const student13Id = '22222222-2222-4222-8222-222222222233';
  const student14Id = '22222222-2222-4222-8222-222222222234';
  const student15Id = '22222222-2222-4222-8222-222222222235';

  const att63Id = '77777777-7777-4777-8777-777777777781';
  await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student11Id, att63Id, assign1Id, student11Id]);

  // [63] non-upload file_url='' rejected
  await test(63, "non-upload file_url='' rejected", async () => {
    try {
      await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, '', 1);`, [student11Id, att63Id, qSingleId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_FILE_URL_NOT_ALLOWED')) throw err;
    }
  });

  // [64] non-upload file_url='   ' rejected
  await test(64, "non-upload file_url='   ' rejected", async () => {
    try {
      await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, '   ', 1);`, [student11Id, att63Id, qSingleId]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_FILE_URL_NOT_ALLOWED')) throw err;
    }
  });

  // Setup dedicated exam & attempt for answer key hardening tests (65..70)
  const testExamId = '44444444-4444-4444-8444-444444444488';
  const testVerId = '55555555-5555-4555-8555-555555555588';
  const testAssignId = '66666666-6666-4666-8666-666666666688';
  const qTestSingleId = '88888888-8888-4888-8888-888888888891';
  const qTestMultiId = '88888888-8888-4888-8888-888888888892';

  await db.query(`SELECT public.rpc_exam_create_test($1, $2, $3, 'Hardening Test Exam', 'MATH', 10);`, [teacherId, testExamId, testVerId]);
  await db.query(`
    SELECT public.rpc_exam_save_draft_version(
      $1, $2, 'Hardening Test Exam', 'MATH', 10, 'Mô tả',
      45, NOW() - interval '1 hour', NOW() + interval '14 days', 10, 10, true, true, 'WARN_AND_LOG', true, false,
      $3::jsonb, true
    );
  `, [
    teacherId,
    testVerId,
    JSON.stringify([
      {
        id: qTestSingleId,
        question_number: 1,
        question_type: 'single_choice',
        prompt: 'Single choice question',
        points: 5.00,
        options_json: [{ key: 'A', text: 'Option A' }, { key: 'B', text: 'Option B' }],
        answer_key: { correct_answer: 'A' }
      },
      {
        id: qTestMultiId,
        question_number: 2,
        question_type: 'multiple_choice',
        prompt: 'Multiple choice question',
        points: 5.00,
        options_json: [{ key: 'A', text: 'Option A' }, { key: 'B', text: 'Option B' }, { key: 'C', text: 'Option C' }],
        answer_key: { correct_answer: ['A', 'B'] }
      }
    ])
  ]);
  await db.query(`SELECT public.rpc_exam_publish_version($1, $2, true);`, [teacherId, testVerId]);
  await db.query(`SELECT public.rpc_exam_create_assignment($1, $2, $3, $4, NOW() + interval '5 days', true, true);`, [teacherId, testAssignId, testVerId, class1Id]);

  // [65] multiple answer key duplicate rejected
  await test(65, 'multiple answer key duplicate rejected', async () => {
    const att65Id = '77777777-7777-4777-8777-777777777783';
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student12Id, att65Id, testAssignId, student12Id]);
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '["A", "B"]'::jsonb, NULL, 1);`, [student12Id, att65Id, qTestMultiId]);

    // Set duplicate answer key ["A", "A", "B"]
    await db.query(`UPDATE app_private.exam_answer_keys SET correct_answer = '["A", "A", "B"]'::jsonb WHERE question_id = $1;`, [qTestMultiId]);

    try {
      await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 2);`, [student12Id, att65Id]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_ANSWER_KEY')) throw err;
    }
  });

  // [66] multiple answer key empty key rejected
  await test(66, 'multiple answer key empty key rejected', async () => {
    const att66Id = '77777777-7777-4777-8777-777777777784';
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student13Id, att66Id, testAssignId, student13Id]);
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '["A"]'::jsonb, NULL, 1);`, [student13Id, att66Id, qTestMultiId]);

    // Set empty key in array ["A", "   "]
    await db.query(`UPDATE app_private.exam_answer_keys SET correct_answer = '["A", "   "]'::jsonb WHERE question_id = $1;`, [qTestMultiId]);

    try {
      await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 2);`, [student13Id, att66Id]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_ANSWER_KEY')) throw err;
    }
  });

  // [67] multiple answer key unknown option rejected
  await test(67, 'multiple answer key unknown option rejected', async () => {
    const att67Id = '77777777-7777-4777-8777-777777777785';
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student14Id, att67Id, testAssignId, student14Id]);
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '["A"]'::jsonb, NULL, 1);`, [student14Id, att67Id, qTestMultiId]);

    // Set unknown option "Z"
    await db.query(`UPDATE app_private.exam_answer_keys SET correct_answer = '["A", "Z"]'::jsonb WHERE question_id = $1;`, [qTestMultiId]);

    try {
      await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 2);`, [student14Id, att67Id]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_ANSWER_KEY')) throw err;
    }
  });

  // [68] single answer key unknown option rejected
  await test(68, 'single answer key unknown option rejected', async () => {
    const att68Id = '77777777-7777-4777-8777-777777777786';
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student15Id, att68Id, testAssignId, student15Id]);
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, NULL, 1);`, [student15Id, att68Id, qTestSingleId]);

    // Set unknown option "Z" for single_choice
    await db.query(`UPDATE app_private.exam_answer_keys SET correct_answer = '"Z"'::jsonb WHERE question_id = $1;`, [qTestSingleId]);

    try {
      await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 2);`, [student15Id, att68Id]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_ANSWER_KEY')) throw err;
    }
  });

  // [69] valid multiple key with reordered student answer still PASS
  await test(69, 'valid multiple key with reordered student answer still PASS', async () => {
    // Reset valid keys: single = 'A', multi = ['A', 'B']
    await db.query(`UPDATE app_private.exam_answer_keys SET correct_answer = '"A"'::jsonb WHERE question_id = $1;`, [qTestSingleId]);
    await db.query(`UPDATE app_private.exam_answer_keys SET correct_answer = '["A", "B"]'::jsonb WHERE question_id = $1;`, [qTestMultiId]);

    const student16Id = '22222222-2222-4222-8222-222222222236';
    const att69Id = '77777777-7777-4777-8777-777777777787';
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student16Id, att69Id, testAssignId, student16Id]);
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, NULL, 1);`, [student16Id, att69Id, qTestSingleId]);
    // Student answers in reverse order ['B', 'A']
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '["B", "A"]'::jsonb, NULL, 2);`, [student16Id, att69Id, qTestMultiId]);

    const res = await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 3) AS result;`, [student16Id, att69Id]);
    const r = res.rows[0].result;
    if (r.status !== 'graded' || Number(r.total_score) !== 10 || Number(r.objective_score) !== 10) {
      throw new Error(`Expected graded with 10.00 score, got: ${JSON.stringify(r)}`);
    }

    const multiAns = await db.query(`SELECT is_correct, points_earned FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [att69Id, qTestMultiId]);
    if (multiAns.rows[0].is_correct !== true || Number(multiAns.rows[0].points_earned) !== 5) {
      throw new Error(JSON.stringify(multiAns.rows[0]));
    }
  });

  // [70] malformed multiple key failure rolls back submit
  await test(70, 'malformed multiple key failure rolls back submit', async () => {
    const student17Id = '22222222-2222-4222-8222-222222222237';
    const att70Id = '77777777-7777-4777-8777-777777777770';
    await db.query(`SELECT public.rpc_exam_start_attempt($1, $2, $3, $4);`, [student17Id, att70Id, testAssignId, student17Id]);
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '"A"'::jsonb, NULL, 1);`, [student17Id, att70Id, qTestSingleId]);
    await db.query(`SELECT public.rpc_exam_save_answer($1, $2, $3, '["A", "B"]'::jsonb, NULL, 2);`, [student17Id, att70Id, qTestMultiId]);

    // Corrupt key to duplicate ["A", "A"]
    await db.query(`UPDATE app_private.exam_answer_keys SET correct_answer = '["A", "A"]'::jsonb WHERE question_id = $1;`, [qTestMultiId]);

    try {
      await db.query(`SELECT public.rpc_exam_submit_attempt($1, $2, 3);`, [student17Id, att70Id]);
      throw new Error('Should have failed');
    } catch (err) {
      if (!err.message.includes('ERR_INVALID_ANSWER_KEY')) throw err;
    }

    // Verify rollback: attempt must remain draft, version 3, submitted_at NULL
    const attRec = await db.query(`SELECT status, version, submitted_at, total_score FROM public.exam_attempts WHERE id = $1;`, [att70Id]);
    if (attRec.rows[0].status !== 'draft' || attRec.rows[0].version !== 3 || attRec.rows[0].submitted_at !== null || attRec.rows[0].total_score !== null) {
      throw new Error(`Rollback failed for attempt: ${JSON.stringify(attRec.rows[0])}`);
    }

    // Verify answer grading status remains pending_auto, points_earned NULL
    const ansRec = await db.query(`SELECT grading_status, points_earned, is_correct FROM public.exam_attempt_answers WHERE attempt_id = $1 AND exam_question_id = $2;`, [att70Id, qTestMultiId]);
    if (ansRec.rows[0].grading_status !== 'pending_auto' || ansRec.rows[0].points_earned !== null || ansRec.rows[0].is_correct !== null) {
      throw new Error(`Rollback failed for answers: ${JSON.stringify(ansRec.rows[0])}`);
    }
  });

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passCount}/70 PASSED, ${failCount} FAILED`);
  console.log('====================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});

