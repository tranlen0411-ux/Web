import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appContent = fs.readFileSync('src/App.jsx', 'utf8');
const spectatorPageContent = fs.readFileSync('src/pages/CompetitionSpectatorPage.jsx', 'utf8');
const waitingViewContent = fs.readFileSync('src/components/competition/spectator/SpectatorWaitingView.jsx', 'utf8');
const liveViewContent = fs.readFileSync('src/components/competition/spectator/SpectatorLiveQuestionView.jsx', 'utf8');
const resultsViewContent = fs.readFileSync('src/components/competition/spectator/SpectatorQuestionResultsView.jsx', 'utf8');
const leaderboardViewContent = fs.readFileSync('src/components/competition/spectator/SpectatorLeaderboardView.jsx', 'utf8');
const finishedViewContent = fs.readFileSync('src/components/competition/spectator/SpectatorFinishedView.jsx', 'utf8');
const hostContent = fs.readFileSync('src/pages/CompetitionHostPage.jsx', 'utf8');
const clientContent = fs.readFileSync('src/services/competitionClient.js', 'utf8');

const allSpectatorBundle = [
  spectatorPageContent,
  waitingViewContent,
  liveViewContent,
  resultsViewContent,
  leaderboardViewContent,
  finishedViewContent
].join('\n');

// UUID format regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUUID(v) {
  return typeof v === 'string' && UUID_REGEX.test(v.trim());
}

// Logic helper simulating SpectatorLeaderboardView rank filtering
function getPodiumGroups(leaderboard = []) {
  const rank1 = leaderboard.filter((p) => Number(p.rank) === 1);
  const rank2 = leaderboard.filter((p) => Number(p.rank) === 2);
  const rank3 = leaderboard.filter((p) => Number(p.rank) === 3);
  return { rank1, rank2, rank3 };
}

test('COMPETITION V1 R13 — SPECTATOR / PROJECTOR VIEW TEST SUITE', async (t) => {

  await t.test('Group 1: Route, Access Control & Layout Guard', async (t) => {
    await t.test('1. spectator route exists in App.jsx', () => {
      assert.match(appContent, /path="\/competition\/spectator"/);
    });

    await t.test('2. route requires teacher and admin roles', () => {
      assert.match(appContent, /<Route\s+path="\/competition\/spectator"\s+element={\s*<ProtectedRoute\s+allowedRoles={\['admin',\s*'teacher'\]}/);
    });

    await t.test('3. student is excluded from spectator allowedRoles', () => {
      const match = appContent.match(/<Route\s+path="\/competition\/spectator"[\s\S]*?allowedRoles={([^}]+)}/);
      assert.ok(match, 'Route must have allowedRoles');
      assert.ok(!match[1].includes('student'), 'Student must NOT be allowed in Phase 1 spectator view');
    });

    await t.test('4. anonymous access is denied via ProtectedRoute', () => {
      assert.ok(appContent.includes('<ProtectedRoute allowedRoles='));
      assert.match(appContent, /if \(!user\) {\s*return <Navigate to="\/auth" replace \/>;\s*\}/);
    });

    await t.test('5. Navbar and Footer are hidden for spectator route', () => {
      assert.match(appContent, /const isSpectator = location\.pathname\.startsWith\('\/competition\/spectator'\)/);
      assert.match(appContent, /{!isSpectator && <Navbar \/>}/);
      assert.match(appContent, /{!isSpectator && <Footer \/>}/);
    });
  });

  await t.test('Group 2: Security & Read-Only Invariants', async (t) => {
    await t.test('7. spectator imports zero Host mutation RPCs', () => {
      const forbiddenMutationRpcs = [
        'hostCreateSession',
        'hostStartSession',
        'hostNextQuestion',
        'hostPauseSession',
        'hostResumeSession',
        'hostCloseQuestion',
        'hostFinishSession',
        'hostCancelSession'
      ];
      for (const rpc of forbiddenMutationRpcs) {
        assert.ok(!allSpectatorBundle.includes(rpc), `Spectator bundle must not import or use mutation RPC ${rpc}`);
      }
    });

    await t.test('8. spectator never calls studentSubmitAnswer or answer submission', () => {
      assert.ok(!allSpectatorBundle.includes('studentSubmitAnswer'));
      assert.ok(!allSpectatorBundle.includes('competition_submit_answer'));
    });

    await t.test('26. no raw competition_answers table query', () => {
      assert.ok(!allSpectatorBundle.includes(".from('competition_answers')"));
    });

    await t.test('27. no user_id exposure in spectator view', () => {
      assert.ok(!allSpectatorBundle.includes('user_id'));
    });

    await t.test('28. no guest_token exposure', () => {
      assert.ok(!allSpectatorBundle.includes('guest_token'));
    });

    await t.test('29. no guest_token_hash exposure', () => {
      assert.ok(!allSpectatorBundle.includes('guest_token_hash'));
    });
  });

  await t.test('Group 3: Session Validation & Fail-Closed Behavior', async (t) => {
    await t.test('5a. valid UUID is accepted', () => {
      assert.ok(isValidUUID('c1e08920-7f28-4444-a123-112233445566'));
      assert.ok(isValidUUID('a0000000-0000-4000-8000-000000000001'));
    });

    await t.test('5b. malformed sessionId fails validation', () => {
      assert.strictEqual(isValidUUID(''), false);
      assert.strictEqual(isValidUUID('invalid-uuid'), false);
      assert.strictEqual(isValidUUID('12345'), false);
      assert.strictEqual(isValidUUID(null), false);
      assert.strictEqual(isValidUUID(undefined), false);
      assert.strictEqual(isValidUUID('../admin'), false);
    });

    await t.test('5c. spectator page contains fail-closed screen on invalid UUID or error', () => {
      assert.match(spectatorPageContent, /if \(!isValidUUID \|\| errorMessage\)/);
      assert.match(spectatorPageContent, /Không Thể Mở Màn Hình Trình Chiếu/);
      assert.match(spectatorPageContent, /Fail-Closed/);
    });
  });

  await t.test('Group 4: Host Entry Point & Projector Action', async (t) => {
    await t.test('6a. Host page defines handleOpenSpectator with active session UUID', () => {
      assert.match(hostContent, /const handleOpenSpectator = \(/);
      assert.match(hostContent, /\/competition\/spectator\?sessionId=/);
    });

    await t.test('6b. handleOpenSpectator uses window.open with _blank and noopener,noreferrer', () => {
      assert.match(hostContent, /window\.open\(url,\s*'_blank',\s*'noopener,noreferrer'\)/);
    });

    await t.test('6c. Host page contains buttons to open spectator in waiting, in_progress, and finished', () => {
      assert.match(hostContent, /onClick={\(\) => handleOpenSpectator\(snapshot\.id\)}/);
      assert.match(hostContent, /Màn hình trình chiếu|Trình Chiếu Trực Tiếp|Trình Chiếu Kết Quả/);
    });
  });

  await t.test('Group 5: View States & Presentation Integrity', async (t) => {
    await t.test('20. waiting screen displays room code prominently and participant count', () => {
      assert.match(waitingViewContent, /MÃ PHÒNG THI ĐẤU/);
      assert.match(waitingViewContent, /snapshot\?\.room_code/);
      assert.match(waitingViewContent, /Danh Sách Thí Sinh Trong Sảnh Chờ/);
    });

    await t.test('21-22. LIVE screen shows Question X / Y and countdown timer', () => {
      assert.match(liveViewContent, /Câu {snapshot\?\.current_question_index \|\| 1} \/ {effectiveTotalQuestions}/);
      assert.match(liveViewContent, /timeLeftSeconds/);
      assert.match(liveViewContent, /Tiến độ nộp bài/);
    });

    await t.test('9-10. LIVE screen does not leak correct answer or correct distribution', () => {
      assert.ok(!liveViewContent.includes('is_correct'), 'Live question view must not check or use is_correct');
      assert.ok(!liveViewContent.includes('correct_answer'), 'Live question view must not use correct_answer');
      assert.ok(!liveViewContent.includes('Đáp án đúng'), 'Live question view must not label correct answer');
      assert.ok(!liveViewContent.includes('correct_percentage'), 'Live question view must not display correctness percentage');
    });

    await t.test('23. paused state clearly displays pause banner and freezes timer', () => {
      assert.match(liveViewContent, /snapshot\?\.status === 'paused'/);
      assert.match(liveViewContent, /Trận Đấu Đang Tạm Dừng/);
    });

    await t.test('11 & 24. question results view displays aggregate counts and correctness percentage', () => {
      assert.match(resultsViewContent, /KẾT QUẢ CÂU HỎI ĐÃ ĐÓNG/);
      assert.match(resultsViewContent, /correct_percentage/);
      assert.match(resultsViewContent, /submitted_count/);
      assert.match(resultsViewContent, /correct_count/);
      assert.match(resultsViewContent, /incorrect_count/);
      assert.match(resultsViewContent, /Đáp án đúng/);
    });

    await t.test('15 & 25. finished ceremony podium handles tie rank 1 safely', () => {
      assert.match(finishedViewContent, /KẾT QUẢ CHUNG CUỘC/);
      assert.match(finishedViewContent, /Vinh Danh Nhà Vô Địch/);
      assert.ok(finishedViewContent.includes('leaderboard.filter((p) => p.rank === 1)'));
      assert.ok(finishedViewContent.includes('leaderboard.filter((p) => p.rank === 2)'));
      assert.ok(finishedViewContent.includes('leaderboard.filter((p) => p.rank === 3)'));
    });
  });

  await t.test('Group 6: Live Leaderboard Tie-Safe Podium & Rank Gaps (Direct Review Fix 1)', async (t) => {
    await t.test('A. preserves two Rank 1 rows (1, 1, 3)', () => {
      const mockData = [
        { rank: 1, display_name: 'Alpha', total_score: 100, correct_count: 5 },
        { rank: 1, display_name: 'Beta', total_score: 100, correct_count: 5 },
        { rank: 3, display_name: 'Gamma', total_score: 80, correct_count: 4 }
      ];
      const { rank1, rank2, rank3 } = getPodiumGroups(mockData);
      assert.strictEqual(rank1.length, 2, 'Rank 1 must preserve both tied participants');
      assert.strictEqual(rank1[0].display_name, 'Alpha');
      assert.strictEqual(rank1[1].display_name, 'Beta');
      assert.strictEqual(rank2.length, 0, 'Rank 2 must remain empty for 1,1,3 gap');
      assert.strictEqual(rank3.length, 1, 'Rank 3 must have Gamma');
      assert.strictEqual(rank3[0].display_name, 'Gamma');
    });

    await t.test('B. does not fabricate Rank 2 when backend returns 1, 1, 3', () => {
      const mockData = [
        { rank: 1, display_name: 'Alpha', total_score: 100 },
        { rank: 1, display_name: 'Beta', total_score: 100 },
        { rank: 3, display_name: 'Gamma', total_score: 80 }
      ];
      const { rank2 } = getPodiumGroups(mockData);
      assert.strictEqual(rank2.length, 0, 'Rank 2 must not be fabricated from 1,1,3');
    });

    await t.test('C. preserves tied Rank 2 (1, 2, 2)', () => {
      const mockData = [
        { rank: 1, display_name: 'Winner', total_score: 100 },
        { rank: 2, display_name: 'Silver A', total_score: 90 },
        { rank: 2, display_name: 'Silver B', total_score: 90 },
        { rank: 4, display_name: 'Fourth', total_score: 70 }
      ];
      const { rank1, rank2, rank3 } = getPodiumGroups(mockData);
      assert.strictEqual(rank1.length, 1);
      assert.strictEqual(rank2.length, 2, 'Rank 2 must preserve both tied participants');
      assert.strictEqual(rank2[0].display_name, 'Silver A');
      assert.strictEqual(rank2[1].display_name, 'Silver B');
      assert.strictEqual(rank3.length, 0, 'Rank 3 is absent due to 1,2,2,4 gap');
    });

    await t.test('D. preserves three Rank 1 participants (1, 1, 1)', () => {
      const mockData = [
        { rank: 1, display_name: 'Champion 1', total_score: 100 },
        { rank: 1, display_name: 'Champion 2', total_score: 100 },
        { rank: 1, display_name: 'Champion 3', total_score: 100 }
      ];
      const { rank1, rank2, rank3 } = getPodiumGroups(mockData);
      assert.strictEqual(rank1.length, 3, 'All three Rank 1 winners must be preserved');
      assert.strictEqual(rank2.length, 0);
      assert.strictEqual(rank3.length, 0);
    });

    await t.test('E. no find((p) => p.rank === 1) single-winner logic in SpectatorLeaderboardView', () => {
      assert.ok(!leaderboardViewContent.includes('leaderboard.find('), 'Must not use find() for leaderboard podium');
      assert.ok(leaderboardViewContent.includes('leaderboard.filter((p) => Number(p.rank) === 1)'), 'Must filter Rank 1');
      assert.ok(leaderboardViewContent.includes('leaderboard.filter((p) => Number(p.rank) === 2)'), 'Must filter Rank 2');
      assert.ok(leaderboardViewContent.includes('leaderboard.filter((p) => Number(p.rank) === 3)'), 'Must filter Rank 3');
    });

    await t.test('F. no index-based re-ranking or client sorting', () => {
      assert.ok(!leaderboardViewContent.includes('leaderboard.sort('), 'Leaderboard must not do client-side re-sorting');
      assert.ok(!leaderboardViewContent.includes('rank = index + 1'), 'Leaderboard must not fabricate sequential ranks');
      assert.match(leaderboardViewContent, /#{row.rank}/);
    });
  });

  await t.test('Group 7: Polling, Promise.allSettled & Data Extraction (Direct Review Fix 2 & Cleanup)', async (t) => {
    await t.test('16. polling cadence is >= 2 seconds (2000ms for active, 3000ms for idle)', () => {
      assert.match(spectatorPageContent, /\(snapshot\?\.status === 'in_progress'\) \? 2000 : 3000/);
    });

    await t.test('17. polling timers cleaned up on unmount or session change', () => {
      assert.match(spectatorPageContent, /if \(pollingTimerRef\.current\) clearTimeout\(pollingTimerRef\.current\)/);
      assert.match(spectatorPageContent, /if \(timerIntervalRef\.current\) clearInterval\(timerIntervalRef\.current\)/);
      assert.match(spectatorPageContent, /isMountedRef\.current = false/);
    });

    await t.test('18. stale request guard discards responses from outdated request IDs', () => {
      assert.match(spectatorPageContent, /const currentRequestId = \+\+activeRequestIdRef\.current/);
      assert.match(spectatorPageContent, /if \(!isMountedRef\.current \|\| currentRequestId !== activeRequestIdRef\.current\) return/);
    });

    await t.test('Fix 2. fulfilled Promise.allSettled participant response uses partRes.value.data', () => {
      // Must use partRes.value?.data || [] in finished status handler
      assert.match(spectatorPageContent, /if \(partRes\.status === 'fulfilled' && partRes\.value\?\.success\) {\s*setParticipants\(partRes\.value\?\.data \|\| \[\]\);/);
      // Ensure no buggy partRes.data in finished handler
      const finishedBlockMatch = spectatorPageContent.match(/currentSession.status === 'finished'[\s\S]*?setParticipants\(([^)]+)\)/);
      assert.ok(finishedBlockMatch, 'Finished block must contain setParticipants');
      assert.ok(!finishedBlockMatch[1].includes('partRes.data'), 'Finished block must not use partRes.data');
      assert.ok(finishedBlockMatch[1].includes('partRes.value'), 'Finished block must use partRes.value');
    });

    await t.test('Cleanup. unused import getHostQuestionResultByOrder is removed', () => {
      assert.ok(!spectatorPageContent.includes('getHostQuestionResultByOrder'), 'Spectator page must not import unused getHostQuestionResultByOrder');
    });
  });

  await t.test('Group 8: Fullscreen & Projector Ergonomics', async (t) => {
    await t.test('19. fullscreen button and browser Fullscreen API integration present', () => {
      assert.match(spectatorPageContent, /requestFullscreen/);
      assert.match(spectatorPageContent, /exitFullscreen/);
      assert.match(spectatorPageContent, /Toàn Màn Hình|Thu Nhỏ/);
    });
  });
});
