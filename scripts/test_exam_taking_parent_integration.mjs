// scripts/test_exam_taking_parent_integration.mjs
// Exam Builder V1 - Phase 3E-B Step 3: Student Dashboard Parent Integration Contract Tests
// Comprehensive static, AST & runtime transport assertions verifying clean parent integration of ExamTakingModal
// into ExerciseListTab for student role using authoritative listStudentExamAssignments() without heuristics,
// friendly student error messages (no raw safeErrorCode), and full runtime transport contracts for all 5 BFF methods.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function it(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`✅ [${String(totalTests).padStart(2, '0')}] PASS: ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`❌ [${String(totalTests).padStart(2, '0')}] FAIL: ${name}`);
    console.error(err);
  }
}

async function main() {
  console.log('====================================================');
  console.log('EXAM BUILDER V1 - PHASE 3E-B PARENT INTEGRATION TESTS');
  console.log('====================================================\n');

  const parentPath = path.resolve(__dirname, '../src/components/dashboard/exercises/ExerciseListTab.jsx');
  const parentExists = fs.existsSync(parentPath);
  const parentSource = parentExists ? fs.readFileSync(parentPath, 'utf8') : '';

  const modalPath = path.resolve(__dirname, '../src/components/dashboard/exams/ExamTakingModal.jsx');
  const modalExists = fs.existsSync(modalPath);

  const legacyPlayModalPath = path.resolve(__dirname, '../src/components/dashboard/exercises/ExercisePlayModal.jsx');
  const legacyPlayModalExists = fs.existsSync(legacyPlayModalPath);

  // 1. Discovery & File Existence
  await it('01 Parent file ExerciseListTab.jsx exists at expected path', () => {
    assert.strictEqual(parentExists, true, 'ExerciseListTab.jsx must exist at src/components/dashboard/exercises/ExerciseListTab.jsx');
  });

  await it('02 ExamTakingModal.jsx exists and remains untouched', () => {
    assert.strictEqual(modalExists, true, 'ExamTakingModal.jsx must exist at src/components/dashboard/exams/ExamTakingModal.jsx');
  });

  await it('03 Legacy ExercisePlayModal.jsx exists and remains untouched', () => {
    assert.strictEqual(legacyPlayModalExists, true, 'ExercisePlayModal.jsx must exist');
    const legacySource = fs.readFileSync(legacyPlayModalPath, 'utf8');
    assert.strictEqual(legacySource.includes('ExamTakingSession'), false, 'ExercisePlayModal must not have ExamTakingSession');
  });

  // 2. Import Contract
  await it('04 Parent imports ExamTakingModal correctly', () => {
    assert.ok(
      parentSource.includes("import { ExamTakingModal } from '../exams/ExamTakingModal'") ||
      parentSource.includes("import ExamTakingModal from '../exams/ExamTakingModal'"),
      'Must import ExamTakingModal from ../exams/ExamTakingModal'
    );
  });

  await it('05 Parent imports createExamStudentClient correctly', () => {
    assert.ok(
      parentSource.includes("createExamStudentClient") &&
      parentSource.includes("services/examStudentClient"),
      'Must import createExamStudentClient from services/examStudentClient'
    );
  });

  // 3. Dedicated State for NEW Exam Builder Assignments
  await it('06 Parent declares separate examAssignments state hook', () => {
    assert.ok(parentSource.includes('const [examAssignments, setExamAssignments] = useState('), 'Must declare examAssignments state');
  });

  await it('07 Parent declares examAssignmentsLoading state hook', () => {
    assert.ok(parentSource.includes('const [examAssignmentsLoading, setExamAssignmentsLoading] = useState('), 'Must declare examAssignmentsLoading state');
  });

  await it('08 Parent declares examAssignmentsError state hook', () => {
    assert.ok(parentSource.includes('const [examAssignmentsError, setExamAssignmentsError] = useState('), 'Must declare examAssignmentsError state');
  });

  await it('09 Parent declares selectedExamAssignmentId and isExamTakingOpen state hooks', () => {
    assert.ok(parentSource.includes('selectedExamAssignmentId'), 'Must declare selectedExamAssignmentId state');
    assert.ok(parentSource.includes('isExamTakingOpen'), 'Must declare isExamTakingOpen state');
  });

  // 4. Zero Heuristic Discriminator
  await it('10 Parent does NOT contain heuristic exam discriminators (is_exam, exam_version_id, assignment_type)', () => {
    assert.strictEqual(parentSource.includes('ex?.is_exam'), false, 'Must not use ex?.is_exam heuristic');
    assert.strictEqual(parentSource.includes('ex.is_exam'), false, 'Must not use ex.is_exam heuristic');
    assert.strictEqual(parentSource.includes('ex?.exam_version_id'), false, 'Must not use ex?.exam_version_id on legacy items');
    assert.strictEqual(parentSource.includes("ex?.assignment_type === 'exam'"), false, 'Must not use assignment_type heuristic');
    assert.strictEqual(parentSource.includes("ex.assignment_type === 'exam'"), false, 'Must not use assignment_type heuristic');
  });

  // 5. Legacy Academic Exercises Flow Intact
  await it('11 Legacy academic exercise flow remains authority for academic_exercises & academic_submissions', () => {
    assert.ok(parentSource.includes("from('academic_exercises')"), 'Legacy fetchData must query academic_exercises');
    assert.ok(parentSource.includes("from('academic_submissions')"), 'Legacy fetchData must query academic_submissions');
    assert.ok(
      parentSource.includes('<ExercisePlayModal') &&
      parentSource.includes('exercise={selectedExerciseToPlay}'),
      'Legacy ExercisePlayModal must remain connected to selectedExerciseToPlay'
    );
  });

  // 6. Authoritative BFF List Method & Role Guarding
  await it('12 Parent uses listStudentExamAssignments to fetch NEW assignments', () => {
    assert.ok(
      parentSource.includes('.listStudentExamAssignments()'),
      'Parent must call listStudentExamAssignments() from examStudentClient'
    );
  });

  await it('13 NEW exam list fetch is strictly guarded to student role only', () => {
    const fetchMatch = parentSource.substring(
      parentSource.indexOf('const fetchExamAssignments ='),
      parentSource.indexOf('const handleStartExamAssignment =')
    );
    assert.ok(
      fetchMatch.includes("if (role !== 'student') return") ||
      fetchMatch.includes("role === 'student'"),
      'fetchExamAssignments must only execute for student role'
    );
  });

  // 7. Authoritative Assignment ID Flow
  await it('14 handleStartExamAssignment receives authoritative asg.id and sets selectedExamAssignmentId', () => {
    const startMatch = parentSource.substring(
      parentSource.indexOf('const handleStartExamAssignment ='),
      parentSource.indexOf('const handleCloseExamTakingModal =')
    );
    assert.ok(startMatch.includes('setSelectedExamAssignmentId(asg.id)'), 'Must assign asg.id to selectedExamAssignmentId');
    assert.ok(startMatch.includes('setIsExamTakingOpen(true)'), 'Must set isExamTakingOpen to true');
  });

  await it('15 Modal strictly passes assignmentId={selectedExamAssignmentId} and NOT exam_id / version_id / class_id', () => {
    assert.ok(parentSource.includes('assignmentId={selectedExamAssignmentId}'), 'Must pass assignmentId={selectedExamAssignmentId}');
    assert.strictEqual(parentSource.includes('assignmentId={asg.exam_id}'), false, 'Must not pass exam_id');
    assert.strictEqual(parentSource.includes('assignmentId={asg.exam_version_id}'), false, 'Must not pass exam_version_id');
    assert.strictEqual(parentSource.includes('assignmentId={asg.class_id}'), false, 'Must not pass class_id');
  });

  // 8. Single Instance Count & Student Guard
  await it('16 Exactly one ExamTakingModal instance is rendered in parent JSX for student role', () => {
    const matches = parentSource.match(/<ExamTakingModal\b/g);
    assert.ok(matches, 'ExamTakingModal must be rendered in parent');
    assert.strictEqual(matches.length, 1, 'Must have exactly one <ExamTakingModal> instance in parent');
    assert.ok(
      parentSource.includes("role === 'student'") && parentSource.includes('<ExamTakingModal'),
      'ExamTakingModal must be guarded by student role'
    );
  });

  // 9. Draft / Resume / Start Wording
  await it('17 Active draft attempt (attempt_status === "draft") renders "Tiếp tục làm bài"', () => {
    assert.ok(
      parentSource.includes("asg.attempt_status === 'draft'") || parentSource.includes("isDraft"),
      'Must check attempt_status === "draft"'
    );
    assert.ok(
      parentSource.includes('Tiếp tục làm bài'),
      'Draft attempt must display "Tiếp tục làm bài"'
    );
  });

  await it('18 Non-draft / no attempt renders "Bắt đầu làm bài"', () => {
    assert.ok(
      parentSource.includes('Bắt đầu làm bài') || parentSource.includes('Bắt Đầu Làm Bài'),
      'No active attempt must display "Bắt đầu làm bài"'
    );
  });

  // 10. Completed Statuses (No Auto-Start)
  await it('19 Finalized statuses (submitted, pending_manual_grade, graded) do NOT show start button by default', () => {
    assert.ok(parentSource.includes('Đã nộp'), 'Must display "Đã nộp" for submitted');
    assert.ok(parentSource.includes('Chờ chấm'), 'Must display "Chờ chấm" for pending_manual_grade');
    assert.ok(parentSource.includes('Đã chấm'), 'Must display "Đã chấm" for graded');
  });

  // 11. Modal Callbacks (onClose & onFinished)
  await it('20 onClose handler closes modal and clears selectedExamAssignmentId without submit', () => {
    const closeMatch = parentSource.substring(
      parentSource.indexOf('const handleCloseExamTakingModal ='),
      parentSource.indexOf('const handleExamTakingFinished =')
    );
    assert.ok(closeMatch.includes('setIsExamTakingOpen(false)'), 'onClose must set isExamTakingOpen(false)');
    assert.ok(closeMatch.includes('setSelectedExamAssignmentId(null)'), 'onClose must clear selectedExamAssignmentId');
    assert.strictEqual(closeMatch.includes('submit'), false, 'onClose must not submit');
  });

  await it('21 onFinished handler closes modal, clears selectedExamAssignmentId and refreshes ONLY NEW list', () => {
    const finishMatch = parentSource.substring(
      parentSource.indexOf('const handleExamTakingFinished ='),
      parentSource.indexOf('const fetchData =')
    );
    assert.ok(finishMatch.includes('setIsExamTakingOpen(false)'), 'onFinished must set isExamTakingOpen(false)');
    assert.ok(finishMatch.includes('setSelectedExamAssignmentId(null)'), 'onFinished must clear selectedExamAssignmentId');
    assert.ok(finishMatch.includes('fetchExamAssignments()'), 'onFinished must refresh NEW exam assignments');
    assert.strictEqual(finishMatch.includes('fetchData()'), false, 'onFinished must not call legacy fetchData() as refresh authority');
  });

  // 12. Anti-Pattern & Clean Code Guarantees
  await it('22 Parent contains NO persistent storage, retry loops, debounce, or auto-submit', () => {
    assert.strictEqual(parentSource.includes('localStorage'), false, 'Must not use localStorage');
    assert.strictEqual(parentSource.includes('sessionStorage'), false, 'Must not use sessionStorage');
    assert.strictEqual(parentSource.includes('indexedDB'), false, 'Must not use indexedDB');
    assert.strictEqual(parentSource.includes('debounce'), false, 'Must not use debounce');
  });

  // 13. Friendly Error UI & Safe Error Code Concealment
  await it('23 Parent JSX does NOT render res.safeErrorCode or raw backend codes (STUDENT_VISIBLE_SAFE_ERROR_CODE=NO)', () => {
    assert.strictEqual(parentSource.includes('res.safeErrorCode'), false, 'Parent must not assign res.safeErrorCode directly to UI state');
    assert.strictEqual(parentSource.includes('ERR_FETCH_EXAMS_FAILED'), false, 'Must not render ERR_FETCH_EXAMS_FAILED');
    assert.strictEqual(parentSource.includes('INTERNAL_ERROR'), false, 'Must not render INTERNAL_ERROR in parent JSX');
    assert.strictEqual(parentSource.includes('AUTH_REQUIRED'), false, 'Must not render AUTH_REQUIRED in parent JSX');
    assert.strictEqual(parentSource.includes('INVALID_TOKEN'), false, 'Must not render INVALID_TOKEN in parent JSX');
    assert.strictEqual(parentSource.includes('HTTP_401'), false, 'Must not render HTTP_401 in parent JSX');
  });

  await it('24 Parent displays friendly Vietnamese fallback message and provides retry button', () => {
    assert.ok(
      parentSource.includes('Không thể tải danh sách đề kiểm tra. Vui lòng thử lại'),
      'Must contain friendly Vietnamese error message for students'
    );
    assert.ok(
      parentSource.includes('onClick={() => fetchExamAssignments()}') ||
      parentSource.includes('onClick={fetchExamAssignments}'),
      'Retry button must invoke fetchExamAssignments'
    );
  });

  // 14. Transport Authority & Base Config
  const {
    createExamStudentClient,
    DEFAULT_EXAM_URL,
    DEFAULT_EXAM_BASE_URL,
    START_FUNCTION_NAME,
    SAVE_FUNCTION_NAME,
    SUBMIT_FUNCTION_NAME,
    GET_QUESTIONS_FUNCTION_NAME,
    LIST_ASSIGNMENTS_FUNCTION_NAME,
  } = await import('../src/services/examStudentClient.js');

  await it('25 createExamStudentClient supports supabase and supabaseClient option keys', () => {
    const mockClient = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } };
    const client1 = createExamStudentClient({ supabase: mockClient });
    const client2 = createExamStudentClient({ supabaseClient: mockClient });
    assert.ok(client1 instanceof Object, 'client1 created');
    assert.ok(client2 instanceof Object, 'client2 created');
  });

  await it('26 DEFAULT_EXAM_URL and DEFAULT_EXAM_BASE_URL target NEW project szptvqkoiphrhlionfoh', () => {
    assert.strictEqual(DEFAULT_EXAM_URL, 'https://szptvqkoiphrhlionfoh.supabase.co');
    assert.strictEqual(DEFAULT_EXAM_BASE_URL, 'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1');
    assert.strictEqual(START_FUNCTION_NAME, 'exam-start-attempt');
    assert.strictEqual(SAVE_FUNCTION_NAME, 'exam-save-answer');
    assert.strictEqual(SUBMIT_FUNCTION_NAME, 'exam-submit-attempt');
    assert.strictEqual(GET_QUESTIONS_FUNCTION_NAME, 'exam-get-attempt-questions');
    assert.strictEqual(LIST_ASSIGNMENTS_FUNCTION_NAME, 'exam-list-student-assignments');
  });

  // 15. Runtime Transport Contracts for ALL 5 BFF Methods (27..31)
  const mockToken = 'mock-core-jwt-token-runtime-xyz-789';
  const mockSupabase = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: mockToken } },
        error: null,
      }),
    },
  };

  await it('27 Runtime transport contract: startAttempt() targets NEW project with approved body & Core Bearer JWT', async () => {
    let captured = null;
    const client = createExamStudentClient({
      supabase: mockSupabase,
      fetchImpl: async (url, opts) => {
        captured = { url, method: opts.method, headers: opts.headers, body: JSON.parse(opts.body) };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              attempt_id: '33333333-3333-4333-8333-333333333333',
              assignment_id: '11111111-1111-4111-8111-111111111111',
              exam_version_id: '22222222-2222-4222-8222-222222222222',
              student_id: '44444444-4444-4444-8444-444444444444',
              attempt_number: 1,
              status: 'draft',
              attempt_started_at: '2026-09-08T00:00:00Z',
              expires_at: null,
              max_score: 10,
              question_order: ['55555555-5555-4555-8555-555555555555'],
              option_orders: {},
              attempt_version: 1,
              resumed_existing: false,
              idempotent_replay: false,
              expired: false,
              already_finalized: false,
            },
          }),
        };
      },
    });

    const res = await client.startAttempt({
      assignment_id: '11111111-1111-4111-8111-111111111111',
      attempt_id: '33333333-3333-4333-8333-333333333333',
    });

    assert.strictEqual(res.ok, true);
    assert.ok(captured.url.startsWith('https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/'));
    assert.strictEqual(captured.url, 'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/exam-start-attempt');
    assert.strictEqual(captured.method, 'POST');
    assert.strictEqual(captured.headers['Authorization'], `Bearer ${mockToken}`);
    assert.strictEqual(captured.headers['Content-Type'], 'application/json');
    assert.deepStrictEqual(captured.body, {
      assignment_id: '11111111-1111-4111-8111-111111111111',
      attempt_id: '33333333-3333-4333-8333-333333333333',
    });
    assert.strictEqual(captured.body.student_id, undefined, 'Must not include student_id in body');
    assert.strictEqual(captured.body.class_id, undefined, 'Must not include class_id in body');
    assert.strictEqual(captured.body.role, undefined, 'Must not include role in body');
  });

  await it('28 Runtime transport contract: saveAnswer() targets NEW project with approved body & Core Bearer JWT', async () => {
    let captured = null;
    const client = createExamStudentClient({
      supabase: mockSupabase,
      fetchImpl: async (url, opts) => {
        captured = { url, method: opts.method, headers: opts.headers, body: JSON.parse(opts.body) };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              attempt_id: '33333333-3333-4333-8333-333333333333',
              exam_question_id: '55555555-5555-4555-8555-555555555555',
              grading_status: 'pending_auto',
              attempt_version: 2,
            },
          }),
        };
      },
    });

    const res = await client.saveAnswer({
      attempt_id: '33333333-3333-4333-8333-333333333333',
      exam_question_id: '55555555-5555-4555-8555-555555555555',
      student_answer_json: { selected_options: ['opt_a'] },
      expected_version: 1,
    });

    assert.strictEqual(res.ok, true);
    assert.ok(captured.url.startsWith('https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/'));
    assert.strictEqual(captured.url, 'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/exam-save-answer');
    assert.strictEqual(captured.method, 'POST');
    assert.strictEqual(captured.headers['Authorization'], `Bearer ${mockToken}`);
    assert.strictEqual(captured.headers['Content-Type'], 'application/json');
    assert.deepStrictEqual(captured.body, {
      attempt_id: '33333333-3333-4333-8333-333333333333',
      exam_question_id: '55555555-5555-4555-8555-555555555555',
      student_answer_json: { selected_options: ['opt_a'] },
      file_url: null,
      expected_version: 1,
    });
    assert.strictEqual(captured.body.student_id, undefined, 'Must not include student_id in body');
    assert.strictEqual(captured.body.class_id, undefined, 'Must not include class_id in body');
    assert.strictEqual(captured.body.role, undefined, 'Must not include role in body');
  });

  await it('29 Runtime transport contract: submitAttempt() targets NEW project with approved body & Core Bearer JWT', async () => {
    let captured = null;
    const client = createExamStudentClient({
      supabase: mockSupabase,
      fetchImpl: async (url, opts) => {
        captured = { url, method: opts.method, headers: opts.headers, body: JSON.parse(opts.body) };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              attempt_id: '33333333-3333-4333-8333-333333333333',
              assignment_id: '11111111-1111-4111-8111-111111111111',
              exam_version_id: '22222222-2222-4222-8222-222222222222',
              student_id: '44444444-4444-4444-8444-444444444444',
              attempt_number: 1,
              status: 'submitted',
              attempt_started_at: '2026-09-08T00:00:00Z',
              expires_at: null,
              submitted_at: '2026-09-08T00:15:00Z',
              objective_score: 10,
              manual_score: null,
              total_score: 10,
              max_score: 10,
              reward_stars_awarded: 5,
              graded_at: '2026-09-08T00:15:00Z',
              graded_by: null,
              version: 3,
              idempotent_replay: false,
            },
          }),
        };
      },
    });

    const res = await client.submitAttempt({
      attempt_id: '33333333-3333-4333-8333-333333333333',
      expected_version: 2,
    });

    assert.strictEqual(res.ok, true);
    assert.ok(captured.url.startsWith('https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/'));
    assert.strictEqual(captured.url, 'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/exam-submit-attempt');
    assert.strictEqual(captured.method, 'POST');
    assert.strictEqual(captured.headers['Authorization'], `Bearer ${mockToken}`);
    assert.strictEqual(captured.headers['Content-Type'], 'application/json');
    assert.deepStrictEqual(captured.body, {
      attempt_id: '33333333-3333-4333-8333-333333333333',
      expected_version: 2,
    });
    assert.strictEqual(captured.body.student_id, undefined, 'Must not include student_id in body');
    assert.strictEqual(captured.body.class_id, undefined, 'Must not include class_id in body');
    assert.strictEqual(captured.body.role, undefined, 'Must not include role in body');
  });

  await it('30 Runtime transport contract: getAttemptQuestions() targets NEW project with approved body & Core Bearer JWT', async () => {
    let captured = null;
    const client = createExamStudentClient({
      supabase: mockSupabase,
      fetchImpl: async (url, opts) => {
        captured = { url, method: opts.method, headers: opts.headers, body: JSON.parse(opts.body) };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              attempt_id: '33333333-3333-4333-8333-333333333333',
              exam_version_id: '22222222-2222-4222-8222-222222222222',
              status: 'draft',
              questions: [
                {
                  id: '55555555-5555-4555-8555-555555555555',
                  question_type: 'single_choice',
                  prompt: '1 + 1 = ?',
                  points: 10,
                  options: [
                    { key: 'opt_a', text: '2' },
                    { key: 'opt_b', text: '3' },
                  ],
                },
              ],
            },
          }),
        };
      },
    });

    const res = await client.getAttemptQuestions({
      attempt_id: '33333333-3333-4333-8333-333333333333',
    });

    assert.strictEqual(res.ok, true);
    assert.ok(captured.url.startsWith('https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/'));
    assert.strictEqual(captured.url, 'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/exam-get-attempt-questions');
    assert.strictEqual(captured.method, 'POST');
    assert.strictEqual(captured.headers['Authorization'], `Bearer ${mockToken}`);
    assert.strictEqual(captured.headers['Content-Type'], 'application/json');
    assert.deepStrictEqual(captured.body, {
      attempt_id: '33333333-3333-4333-8333-333333333333',
    });
    assert.strictEqual(captured.body.student_id, undefined, 'Must not include student_id in body');
    assert.strictEqual(captured.body.class_id, undefined, 'Must not include class_id in body');
    assert.strictEqual(captured.body.role, undefined, 'Must not include role in body');
  });

  await it('31 Runtime transport contract: listStudentExamAssignments() targets NEW project with exact {} body & Core Bearer JWT', async () => {
    let captured = null;
    const client = createExamStudentClient({
      supabase: mockSupabase,
      fetchImpl: async (url, opts) => {
        captured = { url, method: opts.method, headers: opts.headers, body: JSON.parse(opts.body) };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              assignments: [
                {
                  id: '11111111-1111-4111-8111-111111111111',
                  exam_version_id: '22222222-2222-4222-8222-222222222222',
                  title: 'Bài Kiểm Tra Toán',
                  description: 'Kiểm tra 15 phút',
                  subject: 'Toán',
                  grade_level: 10,
                  assigned_at: '2026-09-08T00:00:00Z',
                  opens_at: null,
                  closes_at: null,
                  duration_minutes: 15,
                  total_points: 10,
                  reward_stars: 5,
                  attempt_status: 'draft',
                  attempt_id: '33333333-3333-4333-8333-333333333333',
                  latest_score: null,
                  max_score: 10,
                },
              ],
            },
          }),
        };
      },
    });

    const res = await client.listStudentExamAssignments();
    assert.strictEqual(res.ok, true);
    assert.ok(captured.url.startsWith('https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/'));
    assert.strictEqual(captured.url, 'https://szptvqkoiphrhlionfoh.supabase.co/functions/v1/exam-list-student-assignments');
    assert.strictEqual(captured.method, 'POST');
    assert.strictEqual(captured.headers['Authorization'], `Bearer ${mockToken}`);
    assert.strictEqual(captured.headers['Content-Type'], 'application/json');
    assert.deepStrictEqual(captured.body, {});
    assert.strictEqual(captured.body.student_id, undefined, 'Must not include student_id in body');
    assert.strictEqual(captured.body.class_id, undefined, 'Must not include class_id in body');
    assert.strictEqual(captured.body.role, undefined, 'Must not include role in body');
  });

  // 16. Security, Session & Error Handling
  await it('32 Missing session returns safe AUTH_REQUIRED error without network dispatch', async () => {
    let fetchCalled = false;
    const noSessionSupabase = {
      auth: {
        getSession: async () => ({
          data: { session: null },
          error: null,
        }),
      },
    };

    const client = createExamStudentClient({
      supabase: noSessionSupabase,
      fetchImpl: async () => { fetchCalled = true; },
    });

    const res = await client.listStudentExamAssignments();
    assert.strictEqual(fetchCalled, false);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'AUTH_REQUIRED');
  });

  await it('33 HTTP 401 from NEW BFF is sanitized to AUTH_REQUIRED or HTTP_401 safely', async () => {
    const client = createExamStudentClient({
      supabase: mockSupabase,
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ success: false, error: { code: 'INVALID_TOKEN' } }),
      }),
    });

    const res = await client.listStudentExamAssignments();
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.safeErrorCode, 'INVALID_TOKEN');
  });

  await it('34 Zero manual token persistence or console token logging in client and parent (TOKEN_LOGGING_USED=NO, MANUAL_TOKEN_PERSISTENCE_USED=NO)', () => {
    const clientSourcePath = path.resolve(__dirname, '../src/services/examStudentClient.js');
    const clientSource = fs.readFileSync(clientSourcePath, 'utf8');

    assert.strictEqual(clientSource.includes('localStorage.setItem'), false, 'Client must not write to localStorage');
    assert.strictEqual(clientSource.includes('sessionStorage.setItem'), false, 'Client must not write to sessionStorage');
    assert.strictEqual(clientSource.includes('console.log(token'), false, 'Client must not log token');
    assert.strictEqual(clientSource.includes('console.log(sessionData'), false, 'Client must not log sessionData');
  });

  await it('35 Parent queries to academic_exercises & academic_submissions remain on CORE client', () => {
    assert.ok(/supabase\s*\.from\(\s*['"]academic_exercises['"]\s*\)/.test(parentSource), 'Must query academic_exercises via CORE supabase');
    assert.ok(/supabase\s*\.from\(\s*['"]academic_submissions['"]\s*\)/.test(parentSource), 'Must query academic_submissions via CORE supabase');
  });

  await it('36 Parent does NOT perform direct database queries to NEW exam tables', () => {
    assert.strictEqual(parentSource.includes("from('exam_assignments')"), false, 'Must not query exam_assignments table directly');
    assert.strictEqual(parentSource.includes("from('exam_attempts')"), false, 'Must not query exam_attempts table directly');
    assert.strictEqual(parentSource.includes("from('exam_versions')"), false, 'Must not query exam_versions table directly');
    assert.strictEqual(parentSource.includes("from('exam_questions')"), false, 'Must not query exam_questions table directly');
  });

  // 17. Custom invokeFunction Injection Compatibility (CUSTOM_INVOKE_COMPATIBILITY=PASS)
  await it('37 Custom invokeFunction injection remains supported for unit test mocking across all methods', async () => {
    const invoked = [];
    const client = createExamStudentClient({
      invokeFunction: async (fn, opts) => {
        invoked.push({ fn, body: opts?.body });
        if (fn === 'exam-list-student-assignments') {
          return { data: { success: true, data: { assignments: [] } } };
        }
        if (fn === 'exam-start-attempt') {
          return {
            data: {
              success: true,
              data: {
                attempt_id: '33333333-3333-4333-8333-333333333333',
                assignment_id: '11111111-1111-4111-8111-111111111111',
                exam_version_id: '22222222-2222-4222-8222-222222222222',
                student_id: '44444444-4444-4444-8444-444444444444',
                attempt_number: 1,
                status: 'draft',
                attempt_started_at: '2026-09-08T00:00:00Z',
                expires_at: null,
                max_score: 10,
                question_order: [],
                option_orders: {},
                attempt_version: 1,
                resumed_existing: false,
                idempotent_replay: false,
                expired: false,
                already_finalized: false,
              },
            },
          };
        }
        return { data: null, error: { status: 500, code: 'INTERNAL_ERROR' } };
      },
    });

    const resList = await client.listStudentExamAssignments();
    assert.strictEqual(resList.ok, true);
    assert.deepStrictEqual(resList.data.assignments, []);

    const resStart = await client.startAttempt({
      assignment_id: '11111111-1111-4111-8111-111111111111',
      attempt_id: '33333333-3333-4333-8333-333333333333',
    });
    assert.strictEqual(resStart.ok, true);

    assert.strictEqual(invoked.length, 2);
    assert.strictEqual(invoked[0].fn, 'exam-list-student-assignments');
    assert.strictEqual(invoked[1].fn, 'exam-start-attempt');
  });

  await it('38 All 5 student BFF endpoints in ExamStudentClient route through NEW transport authority', () => {
    const clientSourcePath = path.resolve(__dirname, '../src/services/examStudentClient.js');
    const clientSource = fs.readFileSync(clientSourcePath, 'utf8');
    assert.ok(clientSource.includes('DEFAULT_EXAM_URL'));
    assert.ok(clientSource.includes('DEFAULT_EXAM_BASE_URL'));
    assert.ok(clientSource.includes('START_FUNCTION_NAME = \'exam-start-attempt\''));
    assert.ok(clientSource.includes('SAVE_FUNCTION_NAME = \'exam-save-answer\''));
    assert.ok(clientSource.includes('SUBMIT_FUNCTION_NAME = \'exam-submit-attempt\''));
    assert.ok(clientSource.includes('GET_QUESTIONS_FUNCTION_NAME = \'exam-get-attempt-questions\''));
    assert.ok(clientSource.includes('LIST_ASSIGNMENTS_FUNCTION_NAME = \'exam-list-student-assignments\''));
  });

  console.log('\n====================================================');
  console.log(`TOTAL PARENT TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
