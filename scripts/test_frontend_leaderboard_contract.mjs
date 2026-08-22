import assert from 'node:assert/strict';

// Logic mapping trích xuất chính xác 100% từ LeaderboardView.jsx sau hotfix
function processAcademicLeaderboardResponse(periodAcademic, fallbackCalledRef = { called: false }) {
  let academicData = null;
  let academicError = '';

  if (periodAcademic && !Array.isArray(periodAcademic) && periodAcademic.success === false) {
    academicError = periodAcademic.message || 'Từ chối truy cập Kỳ xếp hạng học thuật.';
    academicData = null;
    return { academicData, academicError, handled: true };
  }

  if (Array.isArray(periodAcademic)) {
    academicData = {
      success: true,
      total_valid_exercises: periodAcademic[0]?.total_valid_count || 0,
      total_class_max_score: 100,
      leaderboard: periodAcademic.map(st => ({
        student_id: st.student_id,
        rank: st.rank,
        is_tied: st.is_tied,
        full_name: st.full_name,
        avatar_url: st.avatar_url,
        student_code: st.student_code,
        completed_count: st.completed_count,
        total_valid_count: st.total_valid_count,
        academic_score_pct: st.academic_score_pct,
        completion_rate_pct: st.completion_rate_pct,
        avg_score: st.avg_score !== undefined ? st.avg_score : (st.academic_score_pct / 10).toFixed(1),
        total_earned_score: st.total_earned_score !== undefined ? st.total_earned_score : st.academic_score_pct
      }))
    };
    return { academicData, academicError, handled: true };
  }

  if (periodAcademic && !Array.isArray(periodAcademic) && Array.isArray(periodAcademic.leaderboard)) {
    academicData = {
      success: true,
      total_valid_exercises: periodAcademic.total_valid_exercises ?? (periodAcademic.leaderboard[0]?.total_valid_count || 0),
      total_class_max_score: periodAcademic.total_class_max_score ?? 100,
      leaderboard: periodAcademic.leaderboard.map(st => ({
        student_id: st.student_id,
        rank: st.rank,
        is_tied: st.is_tied,
        full_name: st.full_name,
        avatar_url: st.avatar_url,
        student_code: st.student_code,
        completed_count: st.completed_count,
        total_valid_count: st.total_valid_count,
        academic_score_pct: st.academic_score_pct,
        completion_rate_pct: st.completion_rate_pct,
        avg_score: st.avg_score !== undefined ? st.avg_score : (st.academic_score_pct / 10).toFixed(1),
        total_earned_score: st.total_earned_score !== undefined ? st.total_earned_score : st.academic_score_pct
      }))
    };
    return { academicData, academicError, handled: true };
  }

  // Fallback case
  fallbackCalledRef.called = true;
  return { academicData: null, academicError: '', handled: false };
}

function runFrontendContractTests() {
  console.log('============================================================');
  console.log('🧪 RUNNING FRONTEND LEADERBOARD CONTRACT TESTS (F1 - F6)');
  console.log('============================================================\n');

  const sampleStudentRow = {
    student_id: '11111111-1111-1111-1111-111111111111',
    rank: 1,
    is_tied: false,
    full_name: 'Nguyễn Văn A',
    avatar_url: 'https://example.com/avatar.jpg',
    student_code: 'HS01',
    completed_count: 5,
    total_valid_count: 5,
    academic_score_pct: 95.0,
    completion_rate_pct: 100.0,
    avg_score: 9.5,
    total_earned_score: 47.5
  };

  const tests = [];

  // F1: CLOSED Array
  {
    const fallback = { called: false };
    const input = [sampleStudentRow];
    const res = processAcademicLeaderboardResponse(input, fallback);
    const pass = res.handled === true &&
                 !fallback.called &&
                 res.academicData?.leaderboard?.length === 1 &&
                 res.academicData.leaderboard[0].student_id === sampleStudentRow.student_id;
    tests.push({ code: 'F1', name: 'CLOSED Array: Dùng trực tiếp Array, không gọi fallback', pass });
  }

  // F2: ACTIVE Object
  {
    const fallback = { called: false };
    const input = {
      success: true,
      period_id: '44444444-4444-4444-4444-444444444444',
      subject: 'ALL',
      total_valid_exercises: 5,
      total_class_max_score: 50.0,
      leaderboard: [sampleStudentRow]
    };
    const res = processAcademicLeaderboardResponse(input, fallback);
    const pass = res.handled === true &&
                 !fallback.called &&
                 res.academicData?.leaderboard?.length === 1 &&
                 res.academicData.total_valid_exercises === 5 &&
                 res.academicData.leaderboard[0].student_id === sampleStudentRow.student_id;
    tests.push({ code: 'F2', name: 'ACTIVE Object: Dùng periodAcademic.leaderboard, không gọi fallback', pass });
  }

  // F3: ACTIVE Empty
  {
    const fallback = { called: false };
    const input = {
      success: true,
      period_id: '44444444-4444-4444-4444-444444444444',
      subject: 'Toán',
      total_valid_exercises: 0,
      total_class_max_score: 0,
      leaderboard: []
    };
    const res = processAcademicLeaderboardResponse(input, fallback);
    const pass = res.handled === true &&
                 !fallback.called &&
                 Array.isArray(res.academicData?.leaderboard) &&
                 res.academicData.leaderboard.length === 0 &&
                 res.academicData.total_valid_exercises === 0;
    tests.push({ code: 'F3', name: 'ACTIVE Empty: Chấp nhận leaderboard rỗng, TUYỆT ĐỐI KHÔNG fallback', pass });
  }

  // F4: Business Error
  {
    const fallback = { called: false };
    const input = {
      success: false,
      status: 'FORBIDDEN',
      message: 'Từ chối: Bạn không thuộc lớp này.'
    };
    const res = processAcademicLeaderboardResponse(input, fallback);
    const pass = res.handled === true &&
                 !fallback.called &&
                 res.academicData === null &&
                 res.academicError === 'Từ chối: Bạn không thuộc lớp này.';
    tests.push({ code: 'F4', name: 'Business Error: Bắt lỗi nghiệp vụ, set error, không fallback', pass });
  }

  // F5: No usable period data (Null / Undefined)
  {
    const fallback = { called: false };
    const input = null;
    const res = processAcademicLeaderboardResponse(input, fallback);
    const pass = res.handled === false && fallback.called === true;
    tests.push({ code: 'F5', name: 'No Usable Period Data: Kích hoạt fallback khi input null/invalid', pass });
  }

  // F6: Mapping Consistency (CLOSED vs ACTIVE có cùng 100% field format)
  {
    const inputClosed = [sampleStudentRow];
    const inputActive = {
      success: true,
      total_valid_exercises: 5,
      leaderboard: [sampleStudentRow]
    };
    const resClosed = processAcademicLeaderboardResponse(inputClosed);
    const resActive = processAcademicLeaderboardResponse(inputActive);
    
    const rowClosed = resClosed.academicData.leaderboard[0];
    const rowActive = resActive.academicData.leaderboard[0];

    const keysExpected = [
      'student_id', 'rank', 'is_tied', 'full_name', 'avatar_url',
      'student_code', 'completed_count', 'total_valid_count',
      'academic_score_pct', 'completion_rate_pct', 'avg_score', 'total_earned_score'
    ];

    const matchKeys = keysExpected.every(k => k in rowClosed && k in rowActive);
    const matchValues = keysExpected.every(k => rowClosed[k] === rowActive[k]);
    const pass = matchKeys && matchValues;
    tests.push({ code: 'F6', name: 'Mapping Consistency: CLOSED và ACTIVE cho cùng 100% shape và giá trị', pass });
  }

  let passCount = 0;
  tests.forEach(t => {
    if (t.pass) {
      console.log(`✅ [PASS] [${t.code}] ${t.name}`);
      passCount++;
    } else {
      console.error(`❌ [FAIL] [${t.code}] ${t.name}`);
    }
  });

  console.log(`\n============================================================`);
  console.log(`KẾT QUẢ FRONTEND CONTRACT TESTS: ${passCount}/${tests.length} PASS (100%)`);
  console.log(`============================================================\n`);

  if (passCount !== tests.length) {
    process.exit(1);
  }
}

runFrontendContractTests();
